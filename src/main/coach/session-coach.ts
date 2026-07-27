/**
 * SessionCoachEngine - on-demand session analysis.
 *
 * Loads all laps, setups and prior analyses for a session from SQLite,
 * builds a session-level prompt, streams Claude response, persists a new
 * session_analyses_<game> row with incremental version.
 */

import Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";
import {
  COMMENT_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildCommentPrompt,
  buildSummaryPrompt,
} from "./prompt-builder.js";
import { computeSessionStats } from "./session-stats.js";
import { extractVoiceSummary, stripVoiceTag } from "./voice-summary.js";
import {
  parseAnalysisComments,
  parseSetupRow,
  tableFor,
} from "../db/setup-row.js";
import type {
  Alert,
  AnalysisComment,
  GameSource,
  LapRow,
  SessionAnalysisRow,
  SessionRow,
  SessionSetupRow,
} from "../../shared/types.js";

export const isCreditOrQuotaError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("credit") ||
    msg.includes("balance") ||
    msg.includes("billing") ||
    msg.includes("quota") ||
    msg.includes("insufficient") ||
    msg.includes("payment") ||
    msg.includes("status code 402") ||
    msg.includes("status code 403") ||
    msg.includes("status code 429")
  );
};

export const buildAnthropicErrorMessage = (err: unknown): string => {
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (
    msg.includes("401") ||
    msg.includes("authentication") ||
    msg.includes("invalid") ||
    msg.includes("api key")
  ) {
    return "API Anthropic: chiave non valida. Verifica nelle impostazioni.";
  }
  if (msg.includes("429") || msg.includes("rate") || msg.includes("too many")) {
    return "API Anthropic: limite di frequenza superato. Riprova tra qualche istante.";
  }
  return "API Anthropic: credito insufficiente o quota esaurita. Controlla il saldo su console.anthropic.com.";
};

type SessionCoachOptions = {
  db: Database.Database;
  apiKey?: string;
  model?: string;
  onChunk?: (data: {
    sessionId: number;
    version: number;
    token: string;
  }) => void;
  onDone?: (data: { sessionId: number; analysis: SessionAnalysisRow }) => void;
  onError?: (message: string) => void;
};

export type SessionCoachEngine = {
  updateApiKey: (apiKey: string) => void;
  updateCornerNames: (names: Map<number, string>) => void;
  analyzeSession: (
    sessionId: number,
    game: GameSource,
    resolved?: { carName?: string; trackName?: string; layoutName?: string },
    alerts?: Alert[],
    flags?: { leaderboardMode?: boolean; fixedSetup?: boolean },
  ) => Promise<SessionAnalysisRow | null>;
  commentAnalysis: (
    analysisId: number,
    game: GameSource,
    comment: string,
    resolved?: { carName?: string; trackName?: string },
  ) => Promise<SessionAnalysisRow | null>;
};

export const createSessionCoachEngine = (
  options: SessionCoachOptions,
): SessionCoachEngine => {
  const db = options.db;
  const model = options.model ?? "claude-haiku-4-5-20251001";
  let client = new Anthropic({
    apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
  });
  let cornerNames = new Map<number, string>();

  return {
    updateApiKey: (apiKey) => {
      client = new Anthropic({ apiKey });
    },
    updateCornerNames: (names) => {
      cornerNames = names;
    },

    analyzeSession: async (sessionId, game, resolved, alerts, flags) => {
      const sessionsTable = tableFor(game, "sessions");
      const lapsTable = tableFor(game, "laps");
      const setupsTable = tableFor(game, "session_setups");
      const analysesTable = tableFor(game, "session_analyses");

      const sessionRow = db
        .prepare(`SELECT * FROM ${sessionsTable} WHERE id = ?`)
        .get(sessionId) as
        | (Omit<SessionRow, "game"> & Record<string, unknown>)
        | undefined;
      if (!sessionRow) return null;

      const session: SessionRow = {
        id: sessionRow.id as number,
        game,
        car: sessionRow.car as string,
        track: sessionRow.track as string,
        layout: sessionRow.layout as string,
        session_type: sessionRow.session_type as string,
        started_at: sessionRow.started_at as string,
        ended_at: (sessionRow.ended_at as string | null) ?? null,
        best_lap: (sessionRow.best_lap as number | null) ?? null,
        lap_count: sessionRow.lap_count as number,
      };

      const laps = db
        .prepare(
          `SELECT * FROM ${lapsTable} WHERE session_id = ? ORDER BY lap_number ASC`,
        )
        .all(sessionId) as LapRow[];

      const setupRowsRaw = db
        .prepare(
          `SELECT * FROM ${setupsTable} WHERE session_id = ? ORDER BY loaded_at ASC, id ASC`,
        )
        .all(sessionId) as Array<{
        id: number;
        session_id: number;
        loaded_at: string;
        setup_json: string;
        setup_screenshots: string | null;
      }>;

      const setups: SessionSetupRow[] = setupRowsRaw.map(parseSetupRow);

      const priorAnalysesRaw = db
        .prepare(
          `SELECT * FROM ${analysesTable} WHERE session_id = ? ORDER BY version ASC`,
        )
        .all(sessionId) as Array<{
        id: number;
        session_id: number;
        version: number;
        synthesis: string;
        summary: string | null;
        detail: string | null;
        created_at: string;
        comments_json: string | null;
      }>;
      const priorAnalyses: SessionAnalysisRow[] = priorAnalysesRaw.map((r) => ({
        id: r.id,
        session_id: r.session_id,
        version: r.version,
        synthesis: r.synthesis,
        detail: r.detail,
        summary: r.summary,
        created_at: r.created_at,
        comments: parseAnalysisComments(r.comments_json),
      }));

      const stats = computeSessionStats({
        laps,
        bestLap: session.best_lap,
        setups,
        alerts,
        cornerNames,
      });

      const prompt = buildSummaryPrompt({
        session,
        laps,
        setups,
        priorAnalyses,
        cornerNames,
        carName: resolved?.carName,
        trackName: resolved?.trackName,
        layoutName: resolved?.layoutName,
        alerts,
        leaderboardMode: flags?.leaderboardMode,
        fixedSetup: flags?.fixedSetup,
        stats,
      });

      const nextVersion = (priorAnalyses.at(-1)?.version ?? 0) + 1;

      let fullText = "";
      try {
        // Level 1 is two short sections plus the voice block: 2k tokens is ~3x
        // the typical output. The deep-dive keeps the generous cap (expandAnalysis).
        const stream = client.messages.stream({
          model,
          max_tokens: 2000,
          system: SUMMARY_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text;
            options.onChunk?.({
              sessionId,
              version: nextVersion,
              token: event.delta.text,
            });
          }
        }

        // Surface truncation instead of silently saving a partial analysis.
        // A truncated Level 1 can also lose the <sintesi-vocale> block, which
        // would leave the post-analysis TTS silent with no visible cause.
        const finalMsg = await stream.finalMessage();
        if (finalMsg.stop_reason === "max_tokens") {
          options.onError?.(
            "Sintesi troncata: raggiunto il limite di token. Il testo parziale è stato salvato; riesegui l'analisi.",
          );
        }
      } catch (err) {
        console.error("[SessionCoach] Claude API error:", err);
        if (isCreditOrQuotaError(err)) {
          options.onError?.(buildAnthropicErrorMessage(err));
        }
        return null;
      }

      const synthesis = stripVoiceTag(fullText);
      const summary = extractVoiceSummary(fullText);
      const createdAt = new Date().toISOString();

      const result = db
        .prepare(
          `INSERT INTO ${analysesTable} (session_id, version, synthesis, summary, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(sessionId, nextVersion, synthesis, summary, createdAt);

      const analysis: SessionAnalysisRow = {
        id: Number(result.lastInsertRowid),
        session_id: sessionId,
        version: nextVersion,
        synthesis,
        detail: null,
        summary,
        created_at: createdAt,
        comments: [],
      };

      options.onDone?.({ sessionId, analysis });
      return analysis;
    },

    commentAnalysis: async (analysisId, game, comment, resolved) => {
      const analysesTable = tableFor(game, "session_analyses");
      const row = db
        .prepare(`SELECT * FROM ${analysesTable} WHERE id = ?`)
        .get(analysisId) as
        | {
            id: number;
            session_id: number;
            version: number;
            synthesis: string;
            summary: string | null;
            detail: string | null;
            created_at: string;
            comments_json: string | null;
          }
        | undefined;
      if (!row) return null;

      const priorComments = parseAnalysisComments(row.comments_json);
      const prompt = buildCommentPrompt({
        analysisText: row.synthesis,
        priorComments,
        comment,
        carName: resolved?.carName,
        trackName: resolved?.trackName,
      });

      let responseText: string;
      try {
        const msg = await client.messages.create({
          model,
          max_tokens: 2000,
          system: COMMENT_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });
        responseText = msg.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("");
      } catch (err) {
        console.error("[SessionCoach] comment API error:", err);
        if (isCreditOrQuotaError(err)) {
          options.onError?.(buildAnthropicErrorMessage(err));
        }
        return null;
      }

      const newComment: AnalysisComment = {
        comment,
        response: responseText,
        created_at: new Date().toISOString(),
      };
      const comments = [...priorComments, newComment];

      db.prepare(
        `UPDATE ${analysesTable} SET comments_json = ? WHERE id = ?`,
      ).run(JSON.stringify(comments), analysisId);

      return {
        id: row.id,
        session_id: row.session_id,
        version: row.version,
        synthesis: row.synthesis,
        detail: row.detail,
        summary: row.summary,
        created_at: row.created_at,
        comments,
      };
    },
  };
};
