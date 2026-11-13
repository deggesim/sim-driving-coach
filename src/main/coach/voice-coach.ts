/**
 * VoiceCoach - handles free-form voice questions about the current driving session.
 *
 * Does NOT query the DB: the caller owns the session identity and pushes laps,
 * setups and analyses in via updateContext. It used to re-derive the session
 * itself with a car+track lookup, which picked the most recently started session
 * instead of the active one - so a reopened session got another session's data.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  Alert,
  Deviation,
  LapRow,
  SessionAnalysisRow,
  SessionSetupRow,
} from "../../shared/types.js";
import { formatLapTime } from "../../shared/format.js";
import { getLanguage } from "../i18n-main.js";
import { outputLanguageBlock } from "./output-language.js";
import { nestHeadings } from "./prompt-builder.js";

const VOICE_BODY = `You are an expert driving coach answering a driver's specific questions during a driving session.
Always answer concisely and directly. Maximum 3-4 sentences.
The driver is driving right now - be practical, use numeric data, cite corners by name when available.
Do not repeat the question. Do not use bullet lists. Answer as if you were talking to the driver live over the radio.
The answer is read by a speech synthesizer: write ONLY plain text, no markdown formatting (never **bold**, *italic*, \`code\`, titles with # or lists with -).
When you quote a lap time ALWAYS use the form "the time of X" in the output language (e.g. "the time of 1:16.322" or "the time of 58.322s"). Never put an article contracted with the number in front of it (never "l'1:16").
MANDATORY units of measure for the TTS: ALWAYS write the unit next to the number. Distances: "XXXm" (never just "XXX"). Time deltas: "X seconds" or "X s" (never just "X" or "~X"). Correct example: "braking delayed by 24m", "you can gain about 0.2 seconds". The TTS reads "m" as "metres" and "s" as "seconds".`;

type SessionContext = {
  carName: string;
  trackName: string;
  layoutName: string;
  laps: LapRow[];
  lastLapZones: string | null;
  deviations: Deviation[] | null;
  cornerMap: Map<number, string>;
  setups: SessionSetupRow[];
  analyses: SessionAnalysisRow[];
  alerts: Alert[];
};

const buildVoiceContext = (ctx: SessionContext): string => {
  const parts: string[] = [];

  parts.push(`## Current session`);
  parts.push(`- Car: ${ctx.carName}`);
  parts.push(`- Track: ${ctx.trackName} (${ctx.layoutName})`);
  parts.push(`- Laps completed: ${ctx.laps.length}`);

  if (ctx.laps.length > 0) {
    const valid = ctx.laps.filter((l) => l.lap_time > 0);
    if (valid.length > 0) {
      const best = valid.reduce((a, b) => (a.lap_time < b.lap_time ? a : b));
      parts.push(
        `- Best time: ${formatLapTime(best.lap_time)} (Lap ${best.lap_number})`,
      );
    }

    const recent = ctx.laps.slice(-5).reverse();
    parts.push(`\n## Latest laps (most recent first)`);
    for (const lap of recent) {
      const s1 = lap.sector1 != null ? formatLapTime(lap.sector1) : "--";
      const s2 = lap.sector2 != null ? formatLapTime(lap.sector2) : "--";
      const s3 = lap.sector3 != null ? formatLapTime(lap.sector3) : "--";
      parts.push(
        `- Lap ${lap.lap_number}: ${formatLapTime(lap.lap_time)} [S1:${s1} S2:${s2} S3:${s3}] ${lap.valid ? "✓" : "✗"}`,
      );
    }
  }

  if (ctx.cornerMap.size > 0) {
    const cornerList = Array.from(ctx.cornerMap.entries())
      .map(([zone, name]) => `@${zone * 50}m → ${name}`)
      .join(", ");
    parts.push(`\n## Track corners\n${cornerList}`);
  }

  if (ctx.lastLapZones) {
    try {
      const zones = JSON.parse(ctx.lastLapZones) as Array<{
        zone: number;
        dist: number;
        minSpeedKmh: number;
        maxBrakePct: number;
        avgThrottlePct: number;
        tcActivations: number;
        absActivations: number;
      }>;
      const significant = zones.filter(
        (z) => z.maxBrakePct > 0.2 || z.avgThrottlePct < 0.5,
      );
      if (significant.length > 0) {
        parts.push(`\n## Last lap telemetry (relevant zones)`);
        for (const z of significant.slice(0, 20)) {
          const cn = ctx.cornerMap.get(z.zone);
          const label = cn ? ` [${cn}]` : "";
          parts.push(
            `- @${z.dist}m${label}: min ${z.minSpeedKmh.toFixed(0)}km/h, brake ${(z.maxBrakePct * 100).toFixed(0)}%, throttle ${(z.avgThrottlePct * 100).toFixed(0)}%, ABS:${z.absActivations} TC:${z.tcActivations}`,
          );
        }
      }
    } catch {
      // ignore
    }
  }

  if (ctx.deviations && ctx.deviations.length > 0) {
    parts.push(`\n## Deviations from the baseline`);
    for (const d of ctx.deviations) {
      const cn = ctx.cornerMap.get(Math.floor(d.dist / 50));
      const label = cn ? ` [${cn}]` : "";
      parts.push(`- ${d.type} @${d.dist}m${label}: ${d.message}`);
    }
  }

  if (ctx.alerts.length > 0) {
    const PRIORITY_LABEL: Record<number, string> = {
      1: "P1",
      2: "P2",
      3: "P3",
    };
    parts.push(`\n## Alerts raised in the session (${ctx.alerts.length})`);
    for (const a of ctx.alerts) {
      const prio = PRIORITY_LABEL[a.priority] ?? `P${a.priority}`;
      parts.push(`- [${prio}] @${Math.round(a.dist)}m: ${a.message}`);
    }
  }

  if (ctx.setups.length > 0) {
    parts.push(`\n## Setups loaded in the session (${ctx.setups.length})`);
    ctx.setups.forEach((s, idx) => {
      parts.push(
        `### Setup #${idx + 1} (${s.loaded_at}) - ${s.setup.carFound}`,
      );
      for (const p of s.setup.params.slice(0, 30)) {
        parts.push(`- ${p.category} / ${p.parameter}: ${p.value}`);
      }
    });
  }

  if (ctx.analyses.length > 0) {
    // Same rule as the written prompts: the most recent analysis goes in whole,
    // because the concrete setup proposals live in `detail` and no 3-sentence
    // voice summary can carry them. Driver comments always go in - they are
    // corrections, so ignoring them means repeating advice already rejected.
    const latestVersion = ctx.analyses.at(-1)?.version;
    parts.push(`\n## Previous analyses of the session`);
    for (const a of ctx.analyses) {
      parts.push(`### Analysis #${a.version} (${a.created_at})`);
      if (a.version === latestVersion) {
        parts.push(nestHeadings(a.synthesis, 2));
        if (a.detail) parts.push(nestHeadings(a.detail, 2));
      } else if (a.summary) parts.push(a.summary);
      else parts.push(a.synthesis.slice(0, 600));
      for (const c of a.comments) {
        parts.push(`- Driver: ${c.comment}`);
        parts.push(`  Addition: ${c.response}`);
      }
    }
  }

  return parts.join("\n");
};

export type VoiceCoachEngine = {
  handleVoiceQuery: (
    question: string,
    onChunk: (token: string) => void,
  ) => Promise<string>;
  updateContext: (ctx: Partial<SessionContext>) => void;
};

export const createVoiceCoachEngine = (
  apiKey: string,
  model: string = "claude-haiku-4-5-20251001",
): VoiceCoachEngine => {
  const client = new Anthropic({ apiKey });
  const currentContext: SessionContext = {
    carName: "Unknown",
    trackName: "Unknown",
    layoutName: "",
    laps: [],
    lastLapZones: null,
    deviations: null,
    cornerMap: new Map(),
    setups: [],
    analyses: [],
    alerts: [],
  };

  return {
    updateContext: (ctx) => {
      if (ctx.carName !== undefined) currentContext.carName = ctx.carName;
      if (ctx.trackName !== undefined) currentContext.trackName = ctx.trackName;
      if (ctx.layoutName !== undefined)
        currentContext.layoutName = ctx.layoutName;
      if (ctx.lastLapZones !== undefined)
        currentContext.lastLapZones = ctx.lastLapZones;
      if (ctx.deviations !== undefined)
        currentContext.deviations = ctx.deviations;
      if (ctx.cornerMap !== undefined) currentContext.cornerMap = ctx.cornerMap;
      if (ctx.laps !== undefined) currentContext.laps = ctx.laps;
      if (ctx.setups !== undefined) currentContext.setups = ctx.setups;
      if (ctx.analyses !== undefined) currentContext.analyses = ctx.analyses;
      if (ctx.alerts !== undefined) currentContext.alerts = ctx.alerts;
    },

    handleVoiceQuery: async (question, onChunk) => {
      const contextText = buildVoiceContext(currentContext);
      const userMessage = `${contextText}\n\n---\n\n## Driver question\n${question}`;

      let fullText = "";
      const stream = client.messages.stream({
        model,
        max_tokens: 500,
        system: `${VOICE_BODY}\n\n${outputLanguageBlock(getLanguage(), "voice")}`,
        messages: [{ role: "user", content: userMessage }],
      });
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          fullText += event.delta.text;
          onChunk(event.delta.text);
        }
      }
      await stream.finalMessage();
      return fullText;
    },
  };
};
