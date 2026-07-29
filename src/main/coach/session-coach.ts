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
  SESSION_SYSTEM_PROMPT,
  SYNTHESIS_SYSTEM_PROMPT,
  buildCommentPrompt,
  buildSessionPrompt,
  buildSynthesisPrompt,
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
  // analysis === null means the attempt ended without producing a row (API
  // error): the renderer uses it to release the spinner it holds while working.
  onDone?: (data: {
    sessionId: number;
    analysis: SessionAnalysisRow | null;
  }) => void;
  onError?: (message: string) => void;
};

export type SessionCoachEngine = {
  updateApiKey: (apiKey: string) => void;
  updateCornerNames: (names: Map<number, string>) => void;
  analyzeSession: (
    sessionId: number,
    game: GameSource,
    resolved?: { carName?: string; trackName?: string; layoutName?: string },
    // Live-session alerts (in-memory only in main.ts, never persisted).
    // undefined for a past session. leaderboardMode/fixedSetup are NOT params:
    // both levels read them off the session row via loadSessionBundle.
    alerts?: Alert[],
  ) => Promise<SessionAnalysisRow | null>;
  expandAnalysis: (
    analysisId: number,
    game: GameSource,
    resolved?: { carName?: string; trackName?: string; layoutName?: string },
    // Live-session alerts (in-memory only in main.ts, never persisted). Without
    // them the deep-dive ranks critical corners on an empty alert set — exactly
    // the section this level exists for. undefined for a past session.
    alerts?: Alert[],
    modelOverride?: string, // Level-2 model (anthropicModelDetail); default = base model
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

  /**
   * Shared session-data loader used by analyzeSession and expandAnalysis.
   * Returns null when the session row does not exist.
   * `beforeVersion` (expandAnalysis) restricts priorAnalyses to versions < it;
   * omitted (analyzeSession) returns all versions.
   */
  const loadSessionBundle = (
    game: GameSource,
    sessionId: number,
    opts?: { beforeVersion?: number },
  ): {
    session: SessionRow;
    laps: LapRow[];
    setups: SessionSetupRow[];
    priorAnalyses: SessionAnalysisRow[];
    flags: { leaderboardMode: boolean; fixedSetup: boolean };
  } | null => {
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

    // Single source of truth for both levels: derived from the row the SELECT
    // above already carries, so no caller passes these in. Both columns are
    // NOT NULL DEFAULT 1, so a missing value can only mean a pre-migration row
    // and `!== 0` maps that to true.
    const flagOn = (v: unknown): boolean => v !== 0;
    const flags = {
      leaderboardMode: flagOn(sessionRow.leaderboard_mode),
      fixedSetup: flagOn(sessionRow.fixed_setup),
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

    const priorAnalysesRaw = (
      opts?.beforeVersion != null
        ? db
            .prepare(
              `SELECT * FROM ${analysesTable} WHERE session_id = ? AND version < ? ORDER BY version ASC`,
            )
            .all(sessionId, opts.beforeVersion)
        : db
            .prepare(
              `SELECT * FROM ${analysesTable} WHERE session_id = ? ORDER BY version ASC`,
            )
            .all(sessionId)
    ) as Array<{
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

    return { session, laps, setups, priorAnalyses, flags };
  };

  return {
    updateApiKey: (apiKey) => {
      client = new Anthropic({ apiKey });
    },
    updateCornerNames: (names) => {
      cornerNames = names;
    },

    analyzeSession: async (sessionId, game, resolved, alerts) => {
      const analysesTable = tableFor(game, "session_analyses");
      const bundle = loadSessionBundle(game, sessionId);
      if (!bundle) return null;
      const { session, laps, setups, priorAnalyses, flags } = bundle;

      const stats = computeSessionStats({
        laps,
        bestLap: session.best_lap,
        setups,
        alerts,
        cornerNames,
      });

      const prompt = buildSynthesisPrompt({
        session,
        laps,
        setups,
        priorAnalyses,
        cornerNames,
        carName: resolved?.carName,
        trackName: resolved?.trackName,
        layoutName: resolved?.layoutName,
        alerts,
        leaderboardMode: flags.leaderboardMode,
        fixedSetup: flags.fixedSetup,
        stats,
      });

      const nextVersion = (priorAnalyses.at(-1)?.version ?? 0) + 1;

      // Level 1 is NOT streamed to the UI: partial markdown rendering added no
      // value on a short output. The renderer only needs to know a version is
      // being worked on so it can hold the spinner, so one empty token opens the
      // placeholder panel and the finished text arrives in one go via onDone.
      options.onChunk?.({ sessionId, version: nextVersion, token: "" });

      let fullText: string;
      try {
        // Two short sections plus the voice block: 2k tokens is ~3x the typical
        // output. Non-streaming create() mirrors commentAnalysis and is safe at
        // this budget; the deep-dive still streams (see expandAnalysis).
        const msg = await client.messages.create({
          model,
          max_tokens: 2000,
          system: SYNTHESIS_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });
        fullText = msg.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("");

        // Surface truncation instead of silently saving a partial analysis.
        // A truncated Level 1 can also lose the <sintesi-vocale> block, which
        // would leave the post-analysis TTS silent with no visible cause.
        if (msg.stop_reason === "max_tokens") {
          options.onError?.(
            "Sintesi troncata: raggiunto il limite di token. Il testo parziale è stato salvato; riesegui l'analisi.",
          );
        }
      } catch (err) {
        console.error("[SessionCoach] Claude API error:", err);
        if (isCreditOrQuotaError(err)) {
          options.onError?.(buildAnthropicErrorMessage(err));
        }
        // Release the spinner opened by the start signal above.
        options.onDone?.({ sessionId, analysis: null });
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

    expandAnalysis: async (
      analysisId,
      game,
      resolved,
      alerts,
      modelOverride,
    ) => {
      const useModel = modelOverride ?? model;
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
      const sessionId = row.session_id;

      const bundle = loadSessionBundle(game, sessionId, {
        beforeVersion: row.version,
      });
      if (!bundle) return null;
      const { session, laps, setups, priorAnalyses, flags } = bundle;

      const stats = computeSessionStats({
        laps,
        bestLap: session.best_lap,
        setups,
        alerts,
        cornerNames,
      });

      const prompt = buildSessionPrompt({
        session,
        laps,
        setups,
        priorAnalyses,
        cornerNames,
        carName: resolved?.carName,
        trackName: resolved?.trackName,
        layoutName: resolved?.layoutName,
        alerts,
        // This is the level that proposes setup changes: without fixedSetup it
        // would confidently suggest edits a Fixed Setup session cannot apply.
        leaderboardMode: flags.leaderboardMode,
        fixedSetup: flags.fixedSetup,
        stats,
      });

      let fullText = "";
      try {
        // Level 2 keeps streaming (unlike Level 1): the output is long enough
        // that progressive rendering is the difference between a live panel and
        // a frozen one. Generous cap + truncation surfacing.
        // No cache_control here, deliberately. A breakpoint on this system block
        // caches ~1050 tokens, below the 4096-token floor of the default
        // claude-haiku-4-5, so it silently never wrote an entry; and the block
        // is the one part Level 1 and Level 2 do NOT share (different system
        // prompts diverge the prefix before the shared context is reached), so
        // even above the floor it could only be hit by re-expanding within the
        // TTL - which the UI has no path for. The reusable prefix is the shared
        // buildSessionContext, and caching it means moving the per-level format
        // rules out of both system prompts into a trailing user block; not worth
        // the output-format risk for ~0.003 USD per analysis.
        const stream = client.messages.stream({
          model: useModel,
          max_tokens: 32000,
          system: SESSION_SYSTEM_PROMPT,
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
              version: row.version,
              token: event.delta.text,
            });
          }
        }

        const finalMsg = await stream.finalMessage();

        // The real cost of a deep-dive, which is the only reliable way to know
        // how close `out` runs to the 32000 cap and whether the prompt is
        // growing. Cache counters dropped with the breakpoint: nothing writes a
        // cache on this path, so they would print 0 forever.
        const u = finalMsg.usage;
        console.log(
          `[SessionCoach] L2 usage model=${useModel} ` +
            `in=${u.input_tokens} out=${u.output_tokens}`,
        );

        if (finalMsg.stop_reason === "max_tokens") {
          options.onError?.(
            "Analisi approfondita troncata: raggiunto il limite di token. Il testo parziale è stato salvato; riprova.",
          );
        }
      } catch (err) {
        console.error("[SessionCoach] expand API error:", err);
        if (isCreditOrQuotaError(err)) {
          options.onError?.(buildAnthropicErrorMessage(err));
        }
        // Release the streaming panel the chunks above opened in the renderer.
        options.onDone?.({ sessionId, analysis: null });
        return null;
      }

      db.prepare(`UPDATE ${analysesTable} SET detail = ? WHERE id = ?`).run(
        fullText,
        analysisId,
      );

      const analysis: SessionAnalysisRow = {
        id: row.id,
        session_id: sessionId,
        version: row.version,
        synthesis: row.synthesis,
        detail: fullText,
        summary: row.summary,
        created_at: row.created_at,
        comments: parseAnalysisComments(row.comments_json),
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
