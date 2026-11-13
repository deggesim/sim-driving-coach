/**
 * pdf-generator.ts
 * Generates session analysis PDFs via Electron's printToPDF + HTML/CSS rendering.
 */

import { BrowserWindow } from "electron";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { marked } from "marked";
import type {
  GameSource,
  SessionAnalysisRow,
  SessionDetail,
} from "../shared/types.js";
import { localeOf } from "../shared/i18n.js";
import { localizeSetupName } from "../shared/setup-labels.js";
import { getLanguage, tm } from "./i18n-main.js";

const GAME_LABELS: Record<GameSource, { short: string; full: string }> = {
  r3e: { short: "R3E", full: "RaceRoom Racing Experience" },
  ace: { short: "ACE", full: "Assetto Corsa EVO" },
  ams2: { short: "AMS2", full: "Automobilista 2" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtTime = (s: number | null): string => {
  if (!s || s <= 0) return "--:--";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0
    ? `${m}:${sec.toFixed(3).padStart(6, "0")}`
    : `${sec.toFixed(3)}s`;
};

const escapeHtml = (str: string): string => {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

/**
 * Post-processes rendered HTML to add inline styling for:
 * - @Xm distance markers → blue badge
 * - ✔ → green
 * - ✗ → red
 * - "In sessione" / "Tra sessioni" hint text coloring
 */
const postProcess = (html: string): string => {
  html = html.replace(/@(\d+m)/g, '<span class="dist-marker">@$1</span>');
  html = html.replace(/✔/g, '<span class="avail-yes">✔</span>');
  html = html.replace(/✗/g, '<span class="avail-no">✗</span>');
  // ● bullet used for problem headers in some prompts
  html = html.replace(/●/g, "•");
  return html;
};

const md = (src: string): string =>
  postProcess(marked.parse(src, { async: false }) as string);

// ── Session PDF ───────────────────────────────────────────────────────────────

const buildSessionHtml = (detail: SessionDetail): string => {
  const { session, laps, setups, analyses } = detail;
  const gameLabel = GAME_LABELS[session.game];
  const lang = getLanguage();
  const locale = localeOf(lang);
  const startedAt = new Date(session.started_at).toLocaleString(locale);
  const endedAt = session.ended_at
    ? new Date(session.ended_at).toLocaleString(locale)
    : tm("pdf.ongoing");

  const lapRows = laps
    .map(
      (l) => `
        <tr>
          <td>${l.lap_number}</td>
          <td>${fmtTime(l.lap_time)}</td>
          <td>${fmtTime(l.sector1)}</td>
          <td>${fmtTime(l.sector2)}</td>
          <td>${fmtTime(l.sector3)}</td>
          <td>${l.valid ? "✔" : "✗"}</td>
          <td>${l.setup_id ?? ""}</td>
        </tr>`,
    )
    .join("");

  const setupsHtml = setups
    .map((s, i) => {
      const paramsRows = s.setup.params
        .map(
          (p) =>
            `<tr><td>${escapeHtml(localizeSetupName(tm, p.category))}</td><td>${escapeHtml(localizeSetupName(tm, p.parameter))}</td><td>${escapeHtml(p.value)}</td></tr>`,
        )
        .join("");
      return `
        <h3>${escapeHtml(tm("pdf.setupN", { n: i + 1, car: s.setup.carFound || "" }))} <span class="muted">(${new Date(s.loaded_at).toLocaleString(locale)})</span></h3>
        <table class="params"><thead><tr><th>${tm("pdf.colCategory")}</th><th>${tm("pdf.colParameter")}</th><th>${tm("pdf.colValue")}</th></tr></thead><tbody>${paramsRows}</tbody></table>`;
    })
    .join("");

  const commentsHtml = (a: SessionAnalysisRow): string =>
    a.comments.length === 0
      ? ""
      : a.comments
          .map(
            (c) => `
        <div class="comment-box">
          <div class="comment-label">${tm("pdf.driverComment")}</div>
          <div class="comment-text">${escapeHtml(c.comment)}</div>
          <div class="comment-response">${md(c.response)}</div>
        </div>`,
          )
          .join("");

  const analysesHtml = analyses
    .map(
      (a) => `
        <h2>${tm("pdf.analysisN", { n: a.version })} <span class="muted">(${new Date(a.created_at).toLocaleString(locale)})</span></h2>
        <div class="analysis-body">${md(a.synthesis)}</div>
        ${a.detail ? `<div class="analysis-body">${md(a.detail)}</div>` : ""}
        ${commentsHtml(a)}`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="UTF-8"/>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; padding: 24px; font-size: 12px; }
  h1 { color: #0a3d62; margin-bottom: 4px; }
  h2 { color: #0a3d62; margin-top: 24px; border-bottom: 2px solid #0a3d62; padding-bottom: 4px; }
  h3 { color: #222; margin-top: 16px; }
  .muted { color: #777; font-weight: normal; font-size: 10px; }
  .meta { color: #555; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  th { background: #eef3f9; }
  .dist-marker { display: inline-block; background: #0a3d62; color: white; padding: 1px 6px; border-radius: 3px; font-size: 10px; }
  .avail-yes { color: #2a9d48; font-weight: bold; }
  .avail-no { color: #c0392b; font-weight: bold; }
  .analysis-body { font-size: 11px; line-height: 1.5; }
  .analysis-body p { margin: 6px 0; }
  .comment-box { background: #f4f7fb; border: 1px solid #d0d9e6; border-left: 3px solid #0a3d62; border-radius: 4px; padding: 8px 10px; margin: 8px 0; }
  .comment-label { font-size: 9px; text-transform: uppercase; color: #5a6b80; margin-bottom: 3px; }
  .comment-text { font-style: italic; color: #333; margin-bottom: 6px; white-space: pre-wrap; }
  .comment-response { font-size: 11px; line-height: 1.5; }
  .footer { margin-top: 32px; font-size: 9px; color: #888; text-align: center; border-top: 1px solid #eee; padding-top: 8px; }
  .params td:first-child, .params td:nth-child(2) { width: 25%; }
</style></head><body>

<h1>${gameLabel.full} - ${escapeHtml(session.car_name ?? session.car)}</h1>
<div class="meta">
  <strong>${tm("pdf.track")}:</strong> ${escapeHtml(session.track_name ?? session.track)} (${escapeHtml(session.layout_name ?? session.layout)}) &bull;
  <strong>${tm("pdf.start")}:</strong> ${startedAt} &bull;
  <strong>${tm("pdf.end")}:</strong> ${endedAt} &bull;
  <strong>${tm("pdf.laps")}:</strong> ${session.lap_count} &bull;
  <strong>${tm("pdf.best")}:</strong> ${fmtTime(session.best_lap)}
</div>

<h2>${tm("pdf.laps")}</h2>
<table>
  <thead><tr><th>#</th><th>${tm("pdf.colTime")}</th><th>S1</th><th>S2</th><th>S3</th><th>${tm("pdf.colValid")}</th><th>${tm("pdf.colSetup")}</th></tr></thead>
  <tbody>${lapRows || `<tr><td colspan="7">${tm("pdf.noLaps")}</td></tr>`}</tbody>
</table>

${setups.length > 0 ? `<h2>${tm("pdf.setups")}</h2>${setupsHtml}` : ""}

${analyses.length > 0 ? analysesHtml : `<h2>${tm("pdf.analysisHeading")}</h2><p>${tm("pdf.noAnalyses")}</p>`}

<div class="footer">${tm("pdf.footer", { game: gameLabel.full })}</div>
</body></html>`;
};

export const generateSessionPdfBuffer = async (
  detail: SessionDetail,
): Promise<Buffer> => {
  const html = buildSessionHtml(detail);
  const tmpFile = path.join(
    os.tmpdir(),
    `sim-driving-coach-session-${Date.now()}.html`,
  );
  fs.writeFileSync(tmpFile, html, "utf-8");

  const win = new BrowserWindow({
    width: 794,
    height: 1123,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  try {
    await win.loadFile(tmpFile);
    const buffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
    });
    return buffer;
  } finally {
    win.close();
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // best-effort
    }
  }
};
