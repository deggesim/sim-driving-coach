/**
 * Electron main process entry point.
 *
 * Session-centric architecture:
 * - User explicitly starts/ends sessions (button or voice command).
 * - Laps persist under the current session; no auto-session creation.
 * - Analyses are on-demand (voice or button), versioned per session.
 * - Setups are cumulative per session and tagged on subsequent laps.
 */

import { app, BrowserWindow, ipcMain, shell } from "electron";
import { is } from "@electron-toolkit/utils";
import { createInputManager, type InputManager } from "./input-manager.js";
import fs from "fs";
import path from "path";
import { gunzipSync, gzipSync } from "zlib";
import type {
  Alert,
  Deviation,
  GameFrame,
  GameSource,
  GameStatus,
  LapRecord,
  LapRow,
  R3EFrame,
  SessionAnalysisRow,
  SessionDetail,
  SessionListParams,
  SessionListResult,
  SessionRow,
  SessionSetupRow,
  SessionStartResult,
  SetupData,
} from "../shared/types.js";
import { createAceReader, type AceReader } from "./ace/ace-reader.js";
import {
  decodeCarSetup,
  type AceSetupFileInfo,
} from "./ace/ace-setup-reader.js";
import { createAms2Reader, type Ams2Reader } from "./ams2/ams2-reader.js";
import {
  createAdaptiveBaseline,
  type AdaptiveBaseline,
} from "./coach/adaptive-baseline.js";
import {
  createAlertDispatcher,
  createRuleEngine,
} from "./coach/rule-engine.js";
import { createSessionCoachEngine } from "./coach/session-coach.js";
import { buildTrackMap } from "./coach/track-map-builder.js";
import {
  createVoiceCoachEngine,
  type VoiceCoachEngine,
} from "./coach/voice-coach.js";
import {
  closeDb,
  getCornerName,
  getDb,
  getTrackMap,
  hasCornerNames,
  saveTrackMap,
  seedCornersFromLap,
} from "./db/db.js";
import { toGameFrame } from "./game-adapter.js";
import { createLapRecorder } from "./lap-recorder.js";
import { generateSessionPdfBuffer } from "./pdf-generator.js";
import { parseAnalysisComments, parseSetupRow } from "./db/setup-row.js";
import {
  getCarClassName,
  getCarName,
  getLayoutName,
  getTrackName,
  loadR3EData,
} from "./r3e/r3e-data-loader.js";
import { createR3EReader, type R3EReader } from "./r3e/r3e-reader.js";
import {
  getAzureVoices,
  synthesizeAzure,
  transcribeAzure,
} from "./tts/azure-tts.js";
import {
  buildAnthropicErrorMessage,
  isCreditOrQuotaError,
} from "./coach/session-coach.js";
import { createZoneTracker } from "./zone-tracker.js";

let mainWindow: BrowserWindow | null = null;
let r3eReaderInst: R3EReader | null = null;
let aceReaderInst: AceReader | null = null;
let ams2ReaderInst: Ams2Reader | null = null;

// ──────────────────────────────────────────────
// Window creation
// ──────────────────────────────────────────────

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, "../../build/icon.ico"),
    frame: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep timers running at full rate when the window is not focused so
      // that navigator.getGamepads() polling in the renderer keeps working
      // while the user is driving in the simulator.
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.session.setPermissionCheckHandler(
    (_wc, permission) => permission === "media",
  );
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      callback(permission === "media");
    },
  );

  // Content Security Policy - blocks XSS from injected HTML (e.g. marked output)
  const devUrl =
    process.env["ELECTRON_RENDERER_URL"] ?? "http://localhost:5173";
  const devOrigin = new URL(devUrl).origin;
  const devHost = new URL(devUrl).host;
  const csp = is.dev
    ? [
        `default-src 'self' ${devOrigin}`,
        `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${devOrigin}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src blob:",
        `connect-src ws://${devHost} ${devOrigin}`,
        "font-src 'self' data:",
      ].join("; ")
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src blob:",
        "connect-src 'none'",
        "font-src 'self' data:",
      ].join("; ");

  mainWindow.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [csp],
        },
      });
    },
  );

  // Block navigation to external URLs; redirect them to the system browser.
  // Prevents markdown links in analysis text from hijacking the app window.
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedOrigins = is.dev
      ? [process.env["ELECTRON_RENDERER_URL"] ?? "http://localhost:5173"]
      : [`file://${path.join(__dirname, "../renderer")}`];
    if (!allowedOrigins.some((o) => url.startsWith(o))) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  // Deny all attempts to open a new window (e.g. target="_blank" in markdown).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

// ──────────────────────────────────────────────
// Window control IPC
// ──────────────────────────────────────────────

ipcMain.on("window:close", () => mainWindow?.close());
ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});

const pushToRenderer = (channel: string, data: unknown): void => {
  mainWindow?.webContents.send(channel, data);
};

const pushAppError = (message: string): void => {
  pushToRenderer("app:error", { message });
};

const buildAzureErrorMessage = (err: unknown): string => {
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (msg.includes("429") || msg.includes("too many") || msg.includes("rate")) {
    return "Azure TTS: limite di frequenza superato. Riprova tra qualche istante.";
  }
  return "Azure TTS: credito insufficiente o quota esaurita. Verifica la sottoscrizione Cognitive Services.";
};

// ──────────────────────────────────────────────
// Name resolution helpers (R3E numeric IDs → names; ACE: passthrough)
// ──────────────────────────────────────────────

const resolveNames = (
  game: GameSource,
  car: string,
  track: string,
  layout: string,
): {
  carName: string;
  trackName: string;
  layoutName: string;
  carClassName: string;
} => {
  if (game !== "r3e") {
    return {
      carName: car,
      trackName: track,
      layoutName: layout,
      carClassName: "",
    };
  }
  const carNum = Number(car);
  const trackNum = Number(track);
  const layoutNum = Number(layout);
  return {
    carName: !isNaN(carNum) ? getCarName(carNum) : car,
    trackName: !isNaN(trackNum) ? getTrackName(trackNum) : track,
    layoutName: !isNaN(layoutNum) ? getLayoutName(layoutNum) : layout,
    carClassName: !isNaN(carNum) ? getCarClassName(carNum) : "",
  };
};

const enrichSession = (
  row: Record<string, unknown>,
  game: GameSource,
): SessionRow => {
  const names = resolveNames(
    game,
    row.car as string,
    row.track as string,
    row.layout as string,
  );
  return {
    id: row.id as number,
    game,
    car: row.car as string,
    track: row.track as string,
    layout: row.layout as string,
    session_type: row.session_type as string,
    started_at: row.started_at as string,
    ended_at: (row.ended_at as string | null) ?? null,
    best_lap: (row.best_lap as number | null) ?? null,
    lap_count: row.lap_count as number,
    car_name: names.carName,
    track_name: names.trackName,
    layout_name: names.layoutName,
    car_class_name: names.carClassName,
    analysis_count:
      typeof row.analysis_count === "number" ? row.analysis_count : undefined,
    leaderboard_mode:
      typeof row.leaderboard_mode === "number" ? row.leaderboard_mode : 1,
    fixed_setup: typeof row.fixed_setup === "number" ? row.fixed_setup : 1,
  };
};

// ──────────────────────────────────────────────
// Setup pipeline
// ──────────────────────────────────────────────

const setupPipeline = (): void => {
  const userDataPath = app.getPath("userData");
  const db = getDb(userDataPath);

  const getConfig = (key: string): string | undefined =>
    (
      db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as
        { value: string } | undefined
    )?.value;

  // Register config handlers immediately - renderer may call configGet before
  // the rest of setupPipeline (readers, baseline, etc.) finishes initializing.
  ipcMain.handle("config:get", (_event, key: string) => {
    return db.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as
      { value: string } | undefined;
  });

  let inputManager: InputManager | null = null;

  ipcMain.handle("config:set", (_event, key: string, value: unknown) => {
    db.prepare(
      "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
    ).run(key, String(value));
    if (key === "anthropicApiKey" || key === "anthropicModel")
      voiceCoach = null;
    if (key === "telemetryLogEnabled") {
      telemetryEnabled = String(value) === "true";
      if (!telemetryEnabled) closeTelemetryFile();
    }
    if (key === "keyboardVoiceKey") {
      inputManager?.setKeyboard(String(value) || null);
    }
  });

  loadR3EData();

  // ── Telemetry logger ─────────────────────────────────────────────────────────
  const telemetryLogDir = path.join(userDataPath, "telemetry");

  let telemetryEnabled = getConfig("telemetryLogEnabled") === "true";

  let telemetryStream: ReturnType<typeof fs.createWriteStream> | null = null;
  let telemetryCurrentPath: string | null = null;

  const openTelemetryFile = (
    game: GameSource,
    car: string,
    track: string,
    layout: string,
  ): void => {
    if (!telemetryEnabled || telemetryStream) return;
    if (!fs.existsSync(telemetryLogDir))
      fs.mkdirSync(telemetryLogDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_");
    const sanitize = (s: string) =>
      s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    let carLabel = car,
      trackLabel = track,
      layoutLabel = layout;
    if (game === "r3e") {
      carLabel = getCarName(Number(car)) || car;
      trackLabel = getTrackName(Number(track)) || track;
      layoutLabel = getLayoutName(Number(layout)) || layout;
    }
    const filename = `${ts}-${game}-${sanitize(carLabel)}-${sanitize(trackLabel)}-${sanitize(layoutLabel)}.jsonl`;
    telemetryCurrentPath = path.join(telemetryLogDir, filename);
    telemetryStream = fs.createWriteStream(telemetryCurrentPath, {
      flags: "w",
    });
    console.log(`[Main] Telemetry log opened: ${telemetryCurrentPath}`);
  };

  const closeTelemetryFile = (): void => {
    if (telemetryStream) {
      telemetryStream.end();
      telemetryStream = null;
      console.log(`[Main] Telemetry log closed: ${telemetryCurrentPath}`);
    }
  };

  const writeFrame = (frame: object): void => {
    telemetryStream?.write(JSON.stringify(frame) + "\n");
  };
  // ─────────────────────────────────────────────────────────────────────────────

  console.log(`[Main] setupPipeline - triple-reader mode (R3E/ACE/AMS2)`);

  // Live reader state
  let currentCar = "";
  let currentTrack = "";
  let currentLayout = "";
  let currentLayoutLength = 6000;
  // Connection state is frame-recency based: a game counts as "live" only if it
  // emitted a frame within LIVE_STALE_MS. A closed sim whose SHM survives (e.g.
  // ACE held open by Steam) stops emitting frames, so it drops off the badges
  // instead of showing as connected forever (the old raw-flag bug).
  const lastFrameAt: Record<GameSource, number> = { r3e: 0, ace: 0, ams2: 0 };
  const LIVE_STALE_MS = 2500;
  const isLive = (g: GameSource): boolean =>
    Date.now() - lastFrameAt[g] < LIVE_STALE_MS;
  // activeGame is picked by the user at session start (no auto-detection). While
  // idle it mirrors whichever sim is currently emitting frames, for correct
  // status/lap processing; during a session it stays locked to the session game.
  let activeGame: GameSource = "r3e";

  // Session lifecycle state
  let currentSessionId: number | null = null;
  let currentSessionGame: GameSource = "r3e";
  let currentSetupId: number | null = null;
  let currentLapNumber = 0;
  // Session-level sequential lap counter. Incremented by saveLap() so that
  // lap_number in DB is always monotonically increasing within a session,
  // regardless of the game's own lap counter resetting after a pit stop.
  let sessionLapSeq = 0;
  let lastDeviations: Deviation[] | null = null;

  const lookupCorner = (dist: number): string | null => {
    if (activeGame !== "r3e") {
      return getCornerName(db, activeGame, currentTrack, currentLayout, dist);
    }
    return getCornerName(
      db,
      "r3e",
      currentTrack ? Number(currentTrack) : 0,
      currentLayout ? Number(currentLayout) : 0,
      dist,
    );
  };

  const buildCornerMap = (): Map<number, string> => {
    const map = new Map<number, string>();
    const limit = Math.max(currentLayoutLength, 6000);
    for (let d = 0; d < limit; d += 50) {
      const name = lookupCorner(d);
      if (name) map.set(Math.floor(d / 50), name);
    }
    return map;
  };

  // Components
  const dispatcher = createAlertDispatcher();
  const zoneTracker = createZoneTracker();

  let baseline: AdaptiveBaseline = createAdaptiveBaseline(
    "unknown",
    "unknown",
    "unknown",
    db,
    activeGame,
  );
  let ruleEngine = createRuleEngine(dispatcher, baseline, lookupCorner);

  const recorder = createLapRecorder(baseline.isReady());

  const pushStatus = (): void => {
    // Resolve R3E numeric ids to names, but only when the value is actually
    // numeric: while idle another sim's string ids may sit in the globals.
    const numeric = (v: string): boolean => /^\d+$/.test(v);
    const names =
      activeGame === "r3e"
        ? {
            carName:
              currentCar && numeric(currentCar)
                ? getCarName(Number(currentCar))
                : currentCar,
            trackName:
              currentTrack && numeric(currentTrack)
                ? getTrackName(Number(currentTrack))
                : currentTrack,
            layoutName:
              currentLayout && numeric(currentLayout)
                ? getLayoutName(Number(currentLayout))
                : currentLayout,
          }
        : {
            carName: currentCar,
            trackName: currentTrack,
            layoutName: currentLayout,
          };
    const r3eLive = isLive("r3e");
    const aceLive = isLive("ace");
    const ams2Live = isLive("ams2");
    const status: GameStatus = {
      connected: r3eLive || aceLive || ams2Live,
      r3eConnected: r3eLive,
      aceConnected: aceLive,
      ams2Connected: ams2Live,
      calibrating: recorder.isCalibrating(),
      lapsToCalibration: recorder.lapsToCalibration(),
      car: names.carName || null,
      track: names.trackName || null,
      layout: names.layoutName || null,
      game: activeGame,
    };
    pushToRenderer("status", status);
  };

  const getAnthropicApiKey = (): string | undefined =>
    getConfig("anthropicApiKey");
  const getAnthropicModel = (): string =>
    getConfig("anthropicModel") ?? "claude-haiku-4-5-20251001";

  const sessionCoach = createSessionCoachEngine({
    db,
    apiKey: getAnthropicApiKey(),
    model: getAnthropicModel(),
    onStart: (data) => pushToRenderer("session:analysisStart", data),
    onDone: (data) => pushToRenderer("session:analysisDone", data),
    onError: (message) => pushAppError(message),
  });
  const analyzingInProgress = new Set<string>();

  let voiceCoach: VoiceCoachEngine | null = null;
  const getVoiceCoach = (): VoiceCoachEngine | null => {
    const apiKey = getConfig("anthropicApiKey");
    if (!apiKey) return null;
    if (!voiceCoach) {
      voiceCoach = createVoiceCoachEngine(apiKey, getAnthropicModel());
    }
    return voiceCoach;
  };

  const MAX_SESSION_ALERTS = 500;
  const sessionAlerts: Alert[] = [];

  dispatcher.on("alert", (alert: Alert) => {
    sessionAlerts.push(alert);
    if (sessionAlerts.length > MAX_SESSION_ALERTS) {
      sessionAlerts.splice(0, sessionAlerts.length - MAX_SESSION_ALERTS);
    }
  });

  // ──────────────────────────────────────────────
  // Session DB helpers (inline closures - need db + game + push)
  // ──────────────────────────────────────────────

  const t = (base: string, game: GameSource = activeGame): string =>
    `${base}_${game}`;

  const loadSessionDetail = (
    sessionId: number,
    game: GameSource,
  ): SessionDetail | null => {
    const raw = db
      .prepare(`SELECT * FROM ${t("sessions", game)} WHERE id = ?`)
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!raw) return null;

    const session = enrichSession(raw, game);

    const laps = db
      .prepare(
        `SELECT id, session_id, setup_id, lap_number, lap_time, sector1, sector2, sector3, valid, zones_json, recorded_at
         FROM ${t("laps", game)} WHERE session_id = ? ORDER BY lap_number ASC`,
      )
      .all(sessionId) as LapRow[];

    const setupsRaw = db
      .prepare(
        `SELECT * FROM ${t("session_setups", game)} WHERE session_id = ? ORDER BY loaded_at ASC, id ASC`,
      )
      .all(sessionId) as Array<{
      id: number;
      session_id: number;
      loaded_at: string;
      setup_json: string;
      setup_screenshots: string | null;
    }>;

    const setups: SessionSetupRow[] = setupsRaw.map(parseSetupRow);

    const analysesRaw = db
      .prepare(
        `SELECT * FROM ${t("session_analyses", game)} WHERE session_id = ? ORDER BY version ASC`,
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
    const analyses: SessionAnalysisRow[] = analysesRaw.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      version: r.version,
      synthesis: r.synthesis,
      detail: r.detail,
      summary: r.summary,
      created_at: r.created_at,
      comments: parseAnalysisComments(r.comments_json),
    }));

    return { session, laps, setups, analyses };
  };

  const closeSession = (reason: string): void => {
    if (!currentSessionId) return;
    const id = currentSessionId;
    const game = currentSessionGame;
    try {
      db.prepare(
        `UPDATE ${t("sessions", currentSessionGame)} SET ended_at = ? WHERE id = ? AND ended_at IS NULL`,
      ).run(new Date().toISOString(), id);
    } catch (err) {
      console.error("[Main] closeSession error:", err);
    }
    console.log(`[Main] session closed (${reason}) id=${id}`);
    currentSessionId = null;
    currentSetupId = null;
    pushToRenderer("session:closed", { id, game });
    stopAllReaders(); // back to idle: no SHM polling until the next session
  };

  const saveLap = (sessionId: number, lap: LapRecord): void => {
    const lapsTable = t("laps", currentSessionGame);
    const sessionsTable = t("sessions", currentSessionGame);
    try {
      const framesBlob = gzipSync(
        Buffer.from(JSON.stringify(lap.frames), "utf8"),
      );

      const insertResult = db
        .prepare(
          `INSERT INTO ${lapsTable}
           (session_id, setup_id, lap_number, lap_time, sector1, sector2, sector3, valid, zones_json, frames_blob, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sessionId,
          currentSetupId,
          ++sessionLapSeq,
          lap.lapTime,
          lap.sectorTimes[0] > 0 ? lap.sectorTimes[0] : null,
          lap.sectorTimes[1] > 0 ? lap.sectorTimes[1] : null,
          lap.sectorTimes[2] > 0 ? lap.sectorTimes[2] : null,
          lap.valid ? 1 : 0,
          JSON.stringify(lap.zones),
          framesBlob,
          new Date().toISOString(),
        );

      db.prepare(
        `UPDATE ${sessionsTable} SET
           best_lap = CASE WHEN ? AND (best_lap IS NULL OR ? < best_lap) THEN ? ELSE best_lap END,
           lap_count = lap_count + 1
         WHERE id = ?`,
      ).run(lap.valid ? 1 : 0, lap.lapTime, lap.lapTime, sessionId);

      // Push lap added (exclude frames_blob - renderer fetches on demand)
      const lapRow = db
        .prepare(
          `SELECT id, session_id, setup_id, lap_number, lap_time, sector1, sector2, sector3, valid, zones_json, recorded_at
           FROM ${lapsTable} WHERE id = ?`,
        )
        .get(insertResult.lastInsertRowid) as LapRow | undefined;
      if (lapRow) {
        pushToRenderer("session:lapAdded", {
          sessionId,
          game: activeGame,
          lap: lapRow,
        });
      }
    } catch (err) {
      console.error("[Main] saveLap error:", err);
    }
  };

  // ──────────────────────────────────────────────
  // Reader lifecycle - on-demand, one reader at a time
  // SHM is only polled during an active session, or briefly while probing at
  // session start/reopen. Idle = no reader running (zero SHM reads).
  // ──────────────────────────────────────────────

  const r3eReader = createR3EReader();
  const aceReader = createAceReader();
  const ams2Reader = createAms2Reader();
  r3eReaderInst = r3eReader;
  aceReaderInst = aceReader;
  ams2ReaderInst = ams2Reader;

  // Session open keeps probing for up to a minute so the user can start the sim /
  // enter the track after clicking. ponytail: awaitReaderReady polls every 100ms
  // and the reader auto-reconnects every 2s, so this is a finer retry than the
  // requested 5s cadence (catches readiness sooner) — no per-attempt restart needed.
  const READER_READY_TIMEOUT_MS = 60_000;
  const readerRunning: Record<GameSource, boolean> = {
    r3e: false,
    ace: false,
    ams2: false,
  };
  const getReader = (
    game: GameSource,
  ): { start: () => void; stop: () => void } =>
    game === "r3e" ? r3eReader : game === "ace" ? aceReader : ams2Reader;

  const startReader = (game: GameSource): void => {
    if (readerRunning[game]) return;
    getReader(game).start();
    readerRunning[game] = true;
  };

  const stopReader = (game: GameSource): void => {
    if (!readerRunning[game]) return;
    getReader(game).stop();
    readerRunning[game] = false;
    lastFrameAt[game] = 0; // avoid a stale isLive() hit on the next probe
  };

  // Stop every reader and clear the shared car/track globals, so a later probe
  // never mistakes another sim's leftover identifiers for freshly read data.
  const stopAllReaders = (): void => {
    stopReader("r3e");
    stopReader("ace");
    stopReader("ams2");
    currentCar = "";
    currentTrack = "";
    currentLayout = "";
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  // Ready = live frames AND car/track (and layout for R3E) resolved.
  const readerReady = (game: GameSource): boolean =>
    isLive(game) &&
    !!currentCar &&
    !!currentTrack &&
    (game !== "r3e" || !!currentLayout);

  // Start the reader for `game` and wait until it emits usable data, or time out.
  const awaitReaderReady = async (
    game: GameSource,
    timeoutMs: number,
  ): Promise<"ok" | "not-live" | "no-data"> => {
    startReader(game);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (readerReady(game)) return "ok";
      await sleep(100);
    }
    return isLive(game) ? "no-data" : "not-live";
  };

  const gameLabel = (game: GameSource): string =>
    game === "ace"
      ? "Assetto Corsa EVO"
      : game === "ams2"
        ? "Automobilista 2"
        : "RaceRoom";

  // Connection events only trigger a status push / telemetry cleanup now.
  // The active game is no longer derived from them (see startSession).
  r3eReader.on("connected", () => {
    pushStatus();
  });

  r3eReader.on("disconnected", () => {
    closeTelemetryFile();
    pushStatus();
  });

  aceReader.on("connected", () => {
    // Track/layout come from StaticEvo and are available immediately on connect
    const info = aceReader.getSessionInfo();
    if (info.track) currentTrack = info.track;
    if (info.layout) currentLayout = info.layout;
    if (info.car) currentCar = info.car;
    pushStatus();
  });

  aceReader.on("disconnected", () => {
    closeTelemetryFile();
    pushStatus();
  });

  ams2Reader.on("connected", () => {
    const info = ams2Reader.getSessionInfo();
    if (info.track) currentTrack = info.track;
    if (info.layout) currentLayout = info.layout;
    if (info.car) currentCar = info.car;
    pushStatus();
  });

  ams2Reader.on("disconnected", () => {
    closeTelemetryFile();
    pushStatus();
  });

  // Re-push status on a timer so a sim that stopped emitting frames (closed, or
  // SHM gone stale) drops off the badges within LIVE_STALE_MS even when no other
  // status-changing event fires.
  let lastLiveSnapshot = "";
  const liveTicker = setInterval(() => {
    const snap = `${isLive("r3e")}|${isLive("ace")}|${isLive("ams2")}`;
    if (snap !== lastLiveSnapshot) {
      lastLiveSnapshot = snap;
      pushStatus();
    }
  }, 1000);

  r3eReader.on("r3e:frame", (frame: R3EFrame) => {
    lastFrameAt.r3e = Date.now();
    if (currentSessionId !== null && currentSessionGame !== "r3e") return;
    if (currentSessionId === null) activeGame = "r3e";
    let statusDirty = false;
    if (frame.carModelId > 0 && String(frame.carModelId) !== currentCar) {
      currentCar = String(frame.carModelId);
      statusDirty = true;
    }
    if (frame.trackId > 0 && String(frame.trackId) !== currentTrack) {
      currentTrack = String(frame.trackId);
      statusDirty = true;
    }
    if (frame.layoutId > 0 && String(frame.layoutId) !== currentLayout) {
      currentLayout = String(frame.layoutId);
      statusDirty = true;
    }
    if (statusDirty) pushStatus();

    if (telemetryEnabled && activeGame === "r3e") {
      if (!telemetryStream && frame.carModelId > 0 && frame.trackId > 0) {
        openTelemetryFile(
          "r3e",
          String(frame.carModelId),
          String(frame.trackId),
          String(frame.layoutId),
        );
      }
      writeFrame(frame);
    }

    const gameFrame = toGameFrame(frame);
    if (currentSessionId) {
      zoneTracker.update(gameFrame);
      ruleEngine.processFrame(gameFrame, currentLapNumber);
    }
    pushToRenderer("session:frame", frame);
  });

  aceReader.on("ace:frame", (frame: GameFrame) => {
    lastFrameAt.ace = Date.now();
    if (currentSessionId !== null && currentSessionGame !== "ace") return;
    if (currentSessionId === null) activeGame = "ace";
    // Update car/track/layout from every AC_LIVE frame, re-syncing when StaticEvo
    // was not yet populated at connect time (app launched before ACE session loads).
    const info = aceReader.getSessionInfo();
    let statusDirty = false;
    if (info.car && info.car !== currentCar) {
      currentCar = info.car;
      statusDirty = true;
    }
    if (info.track && info.track !== currentTrack) {
      currentTrack = info.track;
      statusDirty = true;
    }
    if (info.layout && info.layout !== currentLayout) {
      currentLayout = info.layout;
      statusDirty = true;
    }
    if (statusDirty) {
      pushStatus();
    }
    if (currentSessionId) {
      zoneTracker.update(frame);
      ruleEngine.processFrame(frame, currentLapNumber);
    }
    pushToRenderer("session:frame", frame);
  });

  aceReader.on("ace:fullFrame", (frame: Record<string, unknown>) => {
    if (telemetryEnabled && activeGame === "ace") {
      if (!telemetryStream && frame.car) {
        openTelemetryFile(
          "ace",
          frame.car as string,
          frame.track as string,
          frame.layout as string,
        );
      }
      writeFrame(frame);
    }
  });

  ams2Reader.on("ams2:frame", (frame: GameFrame) => {
    lastFrameAt.ams2 = Date.now();
    if (currentSessionId !== null && currentSessionGame !== "ams2") return;
    if (currentSessionId === null) activeGame = "ams2";
    const info = ams2Reader.getSessionInfo();
    let statusDirty = false;
    if (info.car && info.car !== currentCar) {
      currentCar = info.car;
      statusDirty = true;
    }
    if (info.track && info.track !== currentTrack) {
      currentTrack = info.track;
      statusDirty = true;
    }
    if (info.layout && info.layout !== currentLayout) {
      currentLayout = info.layout;
      statusDirty = true;
    }
    if (statusDirty) pushStatus();
    if (currentSessionId) {
      zoneTracker.update(frame);
      ruleEngine.processFrame(frame, currentLapNumber);
    }
    pushToRenderer("session:frame", frame);
  });

  ams2Reader.on("ams2:fullFrame", (frame: Record<string, unknown>) => {
    if (telemetryEnabled && activeGame === "ams2") {
      if (!telemetryStream && frame.car) {
        openTelemetryFile(
          "ams2",
          frame.car as string,
          frame.track as string,
          frame.layout as string,
        );
      }
      writeFrame(frame);
    }
  });

  const handleLapComplete = (lapData: LapRecord, game: GameSource): void => {
    if (activeGame !== game) return;
    if (currentSessionId !== null && currentSessionGame !== game) return;
    console.log(
      `[Main] ${game}:lapComplete - lap=${lapData.lapNumber} time=${lapData.lapTime.toFixed(3)}s ` +
        `valid=${lapData.valid} car="${lapData.car}" track="${lapData.track}" layout="${lapData.layout}"`,
    );

    if (game !== "r3e") {
      if (lapData.car) currentCar = lapData.car;
      if (lapData.track) currentTrack = lapData.track;
      if (lapData.layout) currentLayout = lapData.layout;
    }
    if (lapData.layoutLength > 0) currentLayoutLength = lapData.layoutLength;

    // Baseline/rule engine reset (per-car/track/layout)
    if (
      lapData.car !== baseline.car ||
      lapData.track !== baseline.track ||
      lapData.layout !== baseline.layout
    ) {
      baseline = createAdaptiveBaseline(
        lapData.car,
        lapData.track,
        lapData.layout ?? currentLayout,
        db,
        activeGame,
      );
      ruleEngine = createRuleEngine(dispatcher, baseline, lookupCorner);
      recorder.reset(baseline.isReady());
      sessionCoach.updateCornerNames(buildCornerMap());
    }

    zoneTracker.reset();

    // Auto-close session if car/track/layout differ from the current session's
    if (currentSessionId) {
      const sessionRow = db
        .prepare(
          `SELECT car, track, layout FROM ${t("sessions", currentSessionGame)} WHERE id = ?`,
        )
        .get(currentSessionId) as
        { car: string; track: string; layout: string } | undefined;
      if (sessionRow) {
        // For ACE/AMS2 sessions started before the track layout was populated,
        // the stored layout may be "". Treat it as a pending fill-in rather than a mismatch.
        const aceLayoutPending =
          game !== "r3e" && sessionRow.layout === "" && lapData.layout !== "";
        if (
          sessionRow.car !== lapData.car ||
          sessionRow.track !== lapData.track ||
          (!aceLayoutPending && sessionRow.layout !== lapData.layout)
        ) {
          closeSession("car/track changed");
        } else if (aceLayoutPending) {
          db.prepare(
            `UPDATE ${t("sessions", currentSessionGame)} SET layout = ? WHERE id = ?`,
          ).run(lapData.layout, currentSessionId);
        }
      }
    }

    // Only persist if an explicit session is open
    if (currentSessionId) {
      saveLap(currentSessionId, lapData as LapRecord);
    }
  };

  r3eReader.on("lapComplete", (lapData) =>
    handleLapComplete(lapData as LapRecord, "r3e"),
  );
  aceReader.on("lapComplete", (lapData) =>
    handleLapComplete(lapData as LapRecord, "ace"),
  );
  ams2Reader.on("lapComplete", (lapData) =>
    handleLapComplete(lapData as LapRecord, "ams2"),
  );

  recorder.attach(r3eReader);
  recorder.attach(aceReader);
  recorder.attach(ams2Reader);

  recorder.on(
    "lapRecorded",
    async (lap: LapRecord, { calibrating }: { calibrating: boolean }) => {
      console.log(
        `[Main] recorder:lapRecorded - lap=${lap.lapNumber} calibrating=${calibrating}`,
      );

      const names = resolveNames(activeGame, lap.car, lap.track, lap.layout);
      const lapWithNames: LapRecord = {
        ...lap,
        game: activeGame,
        carName: names.carName,
        trackName: names.trackName,
        layoutName: names.layoutName,
      };

      currentLapNumber = sessionLapSeq;
      pushToRenderer("lapComplete", lapWithNames);
      pushStatus();

      // Seed corner names from first lap if not already present
      const cnTrack = activeGame === "r3e" ? Number(lap.track) : lap.track;
      const cnLayout = activeGame === "r3e" ? Number(lap.layout) : lap.layout;
      if (!hasCornerNames(db, activeGame, cnTrack, cnLayout)) {
        seedCornersFromLap(db, activeGame, cnTrack, cnLayout, lap.zones);
      }

      // Build track map geometry from the first valid lap on this car/track/layout
      if (lap.valid) {
        const geometry = buildTrackMap(lap.frames, lap.layoutLength);
        if (geometry) {
          const tmTrack = activeGame === "r3e" ? Number(lap.track) : lap.track;
          const tmLayout =
            activeGame === "r3e" ? Number(lap.layout) : lap.layout;
          saveTrackMap(db, activeGame, tmTrack, tmLayout, geometry);
          console.log(
            `[Main] trackMap saved - game=${activeGame} ` +
              `track=${lap.track} layout=${lap.layout} samples=${geometry.sampleCount}`,
          );
        }
      }

      // Patch zones_json: handleLapComplete saves the lap before the recorder
      // builds zones (ACE reader emits lapComplete without zones). Update in-place.
      if (currentSessionId && lap.zones.length > 0) {
        try {
          db.prepare(
            `UPDATE ${t("laps", currentSessionGame)} SET zones_json = ? WHERE session_id = ? AND lap_number = ?`,
          ).run(JSON.stringify(lap.zones), currentSessionId, sessionLapSeq);
        } catch (err) {
          console.error("[Main] zones_json update error:", err);
        }
      }

      const deviations = baseline.ingestLap(
        lap.zones,
        sessionLapSeq,
        calibrating,
      );
      if (currentSessionId && deviations && deviations.length > 0) {
        ruleEngine.processLapDeviations(deviations, sessionLapSeq);
      }
      lastDeviations = deviations;

      // Live per-lap slice of the voice context. Setups and analyses are pushed
      // separately, right before a query, from the active session's detail.
      const zonesJson = JSON.stringify(lapWithNames.zones);
      voiceCoach?.updateContext({
        carName: lapWithNames.carName,
        trackName: lapWithNames.trackName,
        layoutName: lapWithNames.layoutName,
        lastLapZones: zonesJson,
        deviations: lastDeviations,
        cornerMap: buildCornerMap(),
        alerts: [...sessionAlerts],
      });
    },
  );

  recorder.on("calibrationComplete", () => {
    pushStatus();
  });

  ipcMain.handle("telemetry:getLogDir", () => telemetryLogDir);

  ipcMain.handle("reader:reset", (_event, { game }: { game: GameSource }) => {
    // Only the active session's reader polls; a reset is a forced stop+start of
    // that reader. A no-op if the game isn't currently running (idle).
    if (!readerRunning[game]) return;
    stopReader(game);
    setTimeout(() => startReader(game), 150);
  });

  // ──────────────────────────────────────────────
  // Session lifecycle IPC
  // ──────────────────────────────────────────────

  const startSession = async (
    game: GameSource,
  ): Promise<SessionStartResult> => {
    if (currentSessionId) {
      // Close the existing session (explicit intent: new session)
      closeSession("new session requested");
    }
    // Fresh probe: ensure no reader is polling and no stale globals linger.
    stopAllReaders();
    const probe = await awaitReaderReady(game, READER_READY_TIMEOUT_MS);
    if (probe !== "ok") {
      stopReader(game);
      return {
        ok: false,
        reason:
          probe === "not-live"
            ? `${gameLabel(game)} non è connesso. Avvialo ed entra in pista prima di aprire una sessione.`
            : "Auto/circuito non ancora rilevati. Entra in pista e riprova.",
      };
    }
    activeGame = game;
    console.log(
      `[startSession] activeGame="${activeGame}" car="${currentCar}" track="${currentTrack}" layout="${currentLayout}"`,
    );

    try {
      const result = db
        .prepare(
          `INSERT INTO ${t("sessions")} (car, track, layout, session_type, started_at)
           VALUES (?, ?, ?, 'practice', ?)`,
        )
        .run(currentCar, currentTrack, currentLayout, new Date().toISOString());
      currentSessionId = Number(result.lastInsertRowid);
      currentSessionGame = activeGame;
      currentSetupId = null;
      sessionLapSeq = 0;
      sessionAlerts.length = 0;

      const row = db
        .prepare(`SELECT * FROM ${t("sessions")} WHERE id = ?`)
        .get(currentSessionId) as Record<string, unknown>;
      const session = enrichSession(row, activeGame);
      pushToRenderer("session:started", session);
      return {
        ok: true,
        sessionId: currentSessionId,
        game: activeGame,
        car: session.car_name ?? session.car,
        track: session.track_name ?? session.track,
      };
    } catch (err) {
      console.error("[Main] startSession error:", err);
      stopAllReaders(); // failed to persist: back to idle
      return { ok: false, reason: String(err) };
    }
  };

  ipcMain.handle("session:start", (_event, game: GameSource) =>
    startSession(game),
  );

  ipcMain.handle("session:end", () => {
    if (!currentSessionId) return;
    closeSession("user ended");
  });

  ipcMain.handle(
    "session:loadSetup",
    (
      _event,
      {
        setup,
        sessionId: sid,
        game: g,
      }: { setup: SetupData; sessionId?: number; game?: GameSource },
    ) => {
      const targetId = sid ?? currentSessionId;
      const targetGame = g ?? currentSessionGame;
      if (!targetId) {
        throw new Error(
          "Nessuna sessione attiva. Apri una sessione prima di caricare un setup.",
        );
      }
      const result = db
        .prepare(
          `INSERT INTO ${t("session_setups", targetGame)} (session_id, loaded_at, setup_json, setup_screenshots)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          targetId,
          new Date().toISOString(),
          JSON.stringify(setup),
          targetGame === "ace" ? null : JSON.stringify(setup.screenshots ?? []),
        );
      const setupId = Number(result.lastInsertRowid);
      // Only advance currentSetupId when loading into the current live session
      if (targetId === currentSessionId) currentSetupId = setupId;

      const row: SessionSetupRow = {
        id: setupId,
        session_id: targetId,
        loaded_at: new Date().toISOString(),
        setup,
        setup_screenshots:
          targetGame === "ace" ? null : JSON.stringify(setup.screenshots ?? []),
      };
      pushToRenderer("session:setupLoaded", {
        sessionId: targetId,
        game: targetGame,
        setup: row,
      });
      return { setupId };
    },
  );

  ipcMain.handle(
    "session:updateFlags",
    (
      _event,
      params: {
        sessionId?: number;
        game?: GameSource;
        leaderboardMode: boolean;
        fixedSetup: boolean;
      },
    ) => {
      const sessionId = params.sessionId ?? currentSessionId;
      const game = params.game ?? currentSessionGame;
      if (!sessionId) return;
      db.prepare(
        `UPDATE ${t("sessions", game)} SET leaderboard_mode = ?, fixed_setup = ? WHERE id = ?`,
      ).run(
        params.leaderboardMode ? 1 : 0,
        params.fixedSetup ? 1 : 0,
        sessionId,
      );
    },
  );

  ipcMain.handle(
    "session:analyze",
    async (
      _event,
      params: {
        sessionId?: number;
        game?: GameSource;
      } = {},
    ) => {
      const sessionId = params.sessionId ?? currentSessionId;
      const game = params.game ?? currentSessionGame;
      if (!sessionId) {
        return { ok: false, reason: "Nessuna sessione selezionata." };
      }
      const apiKey = getAnthropicApiKey();
      if (!apiKey) {
        return { ok: false, reason: "API Key Anthropic non configurata." };
      }
      sessionCoach.updateApiKey(apiKey);
      sessionCoach.updateCornerNames(buildCornerMap());

      // Names only: leaderboard_mode/fixed_setup are read off the same session
      // row inside loadSessionBundle, so both analysis levels and both callers
      // of analyzeSession (this one and the voice path) agree by construction.
      const sRow = db
        .prepare(
          `SELECT car, track, layout FROM ${t("sessions", game)} WHERE id = ?`,
        )
        .get(sessionId) as
        { car: string; track: string; layout: string } | undefined;
      const resolved = sRow
        ? resolveNames(game, sRow.car, sRow.track, sRow.layout)
        : undefined;

      const analyzeKey = `${sessionId}:${game}`;
      if (analyzingInProgress.has(analyzeKey)) {
        return {
          ok: false,
          reason: "Analisi già in corso per questa sessione.",
        };
      }

      const alertsForSession =
        sessionId === currentSessionId ? [...sessionAlerts] : undefined;

      analyzingInProgress.add(analyzeKey);
      sessionCoach
        .analyzeSession(sessionId, game, resolved, alertsForSession)
        .catch((err) => console.error("[SessionCoach] error:", err))
        .finally(() => analyzingInProgress.delete(analyzeKey));

      return { ok: true };
    },
  );

  ipcMain.handle(
    "session:expandAnalysis",
    async (_event, params: { analysisId: number; game?: GameSource }) => {
      const game = params.game ?? currentSessionGame;
      if (!params.analysisId) {
        return { ok: false, reason: "Nessuna analisi selezionata." };
      }
      const apiKey = getAnthropicApiKey();
      if (!apiKey) {
        return { ok: false, reason: "API Key Anthropic non configurata." };
      }
      sessionCoach.updateApiKey(apiKey);
      sessionCoach.updateCornerNames(buildCornerMap());

      // session_id comes along for free here and decides the alerts below.
      const sRow = db
        .prepare(
          `SELECT s.id AS session_id, s.car, s.track, s.layout FROM ${t("sessions", game)} s
           JOIN ${t("session_analyses", game)} a ON a.session_id = s.id
           WHERE a.id = ?`,
        )
        .get(params.analysisId) as
        | { session_id: number; car: string; track: string; layout: string }
        | undefined;
      if (!sRow) return { ok: false, reason: "Analisi non trovata." };
      const resolved = resolveNames(game, sRow.car, sRow.track, sRow.layout);

      // Same rule as session:analyze: sessionAlerts is in-memory only, so it
      // describes the current session and nothing else.
      const alertsForAnalysis =
        sRow.session_id === currentSessionId ? [...sessionAlerts] : undefined;

      // Resolve the Level-2 model live: anthropicModelDetail override, else base.
      const detailModel =
        getConfig("anthropicModelDetail") || getAnthropicModel();

      const expandKey = `expand:${params.analysisId}:${game}`;
      if (analyzingInProgress.has(expandKey)) {
        return { ok: false, reason: "Approfondimento già in corso." };
      }
      analyzingInProgress.add(expandKey);
      sessionCoach
        .expandAnalysis(
          params.analysisId,
          game,
          resolved,
          alertsForAnalysis,
          detailModel,
        )
        .catch((err) => console.error("[SessionCoach] expand error:", err))
        .finally(() => analyzingInProgress.delete(expandKey));

      return { ok: true };
    },
  );

  ipcMain.handle("session:getCurrent", () => {
    if (!currentSessionId) return null;
    return loadSessionDetail(currentSessionId, currentSessionGame);
  });

  ipcMain.handle(
    "session:getDetail",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      return loadSessionDetail(id, game);
    },
  );

  ipcMain.handle(
    "trackMap:get",
    (
      _event,
      {
        game,
        track,
        layout,
      }: { game: GameSource; track: string; layout: string },
    ) => {
      const tmTrack = game === "r3e" ? Number(track) : track;
      const tmLayout = game === "r3e" ? Number(layout) : layout;
      return getTrackMap(db, game, tmTrack, tmLayout);
    },
  );

  ipcMain.handle(
    "lap:assignSetup",
    (
      _event,
      {
        lapId,
        setupId,
        game,
      }: { lapId: number; setupId: number | null; game: GameSource },
    ) => {
      const lapsTable = t("laps", game);
      db.prepare(`UPDATE ${lapsTable} SET setup_id = ? WHERE id = ?`).run(
        setupId ?? null,
        lapId,
      );
    },
  );

  ipcMain.handle(
    "lap:delete",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      const lapsTable = t("laps", game);
      const sessionsTable = t("sessions", game);
      const lap = db
        .prepare(`SELECT session_id FROM ${lapsTable} WHERE id = ?`)
        .get(id) as { session_id: number } | undefined;
      if (!lap) return;
      db.transaction(() => {
        db.prepare(`DELETE FROM ${lapsTable} WHERE id = ?`).run(id);
        db.prepare(
          `UPDATE ${sessionsTable} SET
             lap_count = (SELECT COUNT(*) FROM ${lapsTable} WHERE session_id = ?),
             best_lap  = (SELECT MIN(lap_time) FROM ${lapsTable} WHERE session_id = ? AND valid = 1)
           WHERE id = ?`,
        ).run(lap.session_id, lap.session_id, lap.session_id);
      })();
    },
  );

  ipcMain.handle(
    "lap:getFrames",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      const lapsTable = t("laps", game);
      const row = db
        .prepare(`SELECT frames_blob FROM ${lapsTable} WHERE id = ?`)
        .get(id) as { frames_blob: Buffer | null } | undefined;
      if (!row || !row.frames_blob) return [];
      try {
        const json = gunzipSync(row.frames_blob).toString("utf8");
        return JSON.parse(json);
      } catch (err) {
        console.error("[Main] lap:getFrames decode error:", err);
        return [];
      }
    },
  );

  ipcMain.handle(
    "session:list",
    (_event, params: SessionListParams = {}): SessionListResult => {
      const page = params.page ?? 0;
      const pageSize = params.pageSize ?? 10;
      const sort = params.sort === "asc" ? "ASC" : "DESC";
      const rawGame = params.game ?? null;
      const game: GameSource | null =
        rawGame === "r3e" || rawGame === "ace" || rawGame === "ams2"
          ? rawGame
          : null;
      const carFilter = params.car ?? null;
      const trackFilter = params.track ?? null;

      const buildWhere = (): { sql: string; args: unknown[] } => {
        const parts: string[] = [];
        const args: unknown[] = [];
        if (carFilter) {
          parts.push("car = ?");
          args.push(carFilter);
        }
        if (trackFilter) {
          parts.push("track = ?");
          args.push(trackFilter);
        }
        return {
          sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "",
          args,
        };
      };

      const w = buildWhere();

      const unionSql = game
        ? `SELECT s.*, '${game}' AS _game, (SELECT COUNT(*) FROM session_analyses_${game} WHERE session_id = s.id) AS analysis_count FROM ${t("sessions", game)} s ${w.sql}`
        : `SELECT s.*, 'r3e' AS _game, (SELECT COUNT(*) FROM session_analyses_r3e WHERE session_id = s.id) AS analysis_count FROM sessions_r3e s ${w.sql}
           UNION ALL
           SELECT s.*, 'ace' AS _game, (SELECT COUNT(*) FROM session_analyses_ace WHERE session_id = s.id) AS analysis_count FROM sessions_ace s ${w.sql}
           UNION ALL
           SELECT s.*, 'ams2' AS _game, (SELECT COUNT(*) FROM session_analyses_ams2 WHERE session_id = s.id) AS analysis_count FROM sessions_ams2 s ${w.sql}`;

      const countSql = `SELECT COUNT(*) AS c FROM (${unionSql})`;
      const countArgs = game ? w.args : [...w.args, ...w.args, ...w.args];
      const countRow = db.prepare(countSql).get(...countArgs) as { c: number };

      const pageSql = `
        SELECT * FROM (${unionSql})
        ORDER BY COALESCE(ended_at, started_at) ${sort}, id ${sort}
        LIMIT ? OFFSET ?
      `;
      const pageArgs = [...countArgs, pageSize, page * pageSize];
      const rows = db.prepare(pageSql).all(...pageArgs) as Array<
        Record<string, unknown> & { _game: string }
      >;

      const items = rows.map((r) => enrichSession(r, r._game as GameSource));

      return { items, total: countRow.c, page, pageSize };
    },
  );

  ipcMain.handle(
    "session:delete",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      db.prepare(`DELETE FROM ${t("sessions", game)} WHERE id = ?`).run(id);
      if (currentSessionId === id) {
        currentSessionId = null;
        currentSetupId = null;
      }
    },
  );

  ipcMain.handle(
    "session:deleteAll",
    (_event, items: Array<{ id: number; game: GameSource }>) => {
      const delR3e = db.prepare("DELETE FROM sessions_r3e WHERE id = ?");
      const delAce = db.prepare("DELETE FROM sessions_ace WHERE id = ?");
      const delAms2 = db.prepare("DELETE FROM sessions_ams2 WHERE id = ?");
      db.transaction(() => {
        for (const { id, game } of items) {
          if (game === "ace") delAce.run(id);
          else if (game === "ams2") delAms2.run(id);
          else delR3e.run(id);
          if (currentSessionId === id) {
            currentSessionId = null;
            currentSetupId = null;
          }
        }
      })();
    },
  );

  ipcMain.handle(
    "session:deleteAnalysis",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      db.prepare(`DELETE FROM ${t("session_analyses", game)} WHERE id = ?`).run(
        id,
      );
    },
  );

  ipcMain.handle(
    "session:commentAnalysis",
    async (
      _event,
      { id, game, comment }: { id: number; game: GameSource; comment: string },
    ) => {
      const text = (comment ?? "").trim();
      if (!text) return { ok: false, reason: "Commento vuoto." };

      const apiKey = getAnthropicApiKey();
      if (!apiKey) {
        return { ok: false, reason: "API Key Anthropic non configurata." };
      }
      sessionCoach.updateApiKey(apiKey);
      sessionCoach.updateCornerNames(buildCornerMap());

      const sRow = db
        .prepare(
          `SELECT s.car AS car, s.track AS track, s.layout AS layout
             FROM ${t("session_analyses", game)} a
             JOIN ${t("sessions", game)} s ON s.id = a.session_id
            WHERE a.id = ?`,
        )
        .get(id) as { car: string; track: string; layout: string } | undefined;
      const resolved = sRow
        ? resolveNames(game, sRow.car, sRow.track, sRow.layout)
        : undefined;

      const analysis = await sessionCoach.commentAnalysis(
        id,
        game,
        text,
        resolved,
      );
      if (!analysis) {
        return { ok: false, reason: "Impossibile generare l'integrazione." };
      }
      return { ok: true, analysis };
    },
  );

  ipcMain.handle(
    "session:deleteSetup",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      const lapCountRow = db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM ${t("laps", game)} WHERE setup_id = ?`,
        )
        .get(id) as { cnt: number };
      if (lapCountRow.cnt > 0) {
        return { ok: false, lapCount: lapCountRow.cnt };
      }
      db.prepare(`DELETE FROM ${t("session_setups", game)} WHERE id = ?`).run(
        id,
      );
      return { ok: true };
    },
  );

  ipcMain.handle(
    "session:exportPdf",
    async (_event, { id, game }: { id: number; game: GameSource }) => {
      const { dialog } = await import("electron");

      const detail = loadSessionDetail(id, game);
      if (!detail) return null;

      const pdfBuffer = await generateSessionPdfBuffer(detail);
      const carLabel = detail.session.car_name ?? detail.session.car;
      const trackLabel = detail.session.track_name ?? detail.session.track;
      const d = new Date(detail.session.started_at);
      const dateLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const defaultFilename = `${dateLabel} - ${carLabel} - ${trackLabel}`;
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Salva PDF sessione",
        defaultPath: `${defaultFilename}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (canceled || !filePath) return null;
      fs.writeFileSync(filePath, pdfBuffer);
      return filePath;
    },
  );

  ipcMain.handle(
    "session:reopen",
    async (_event, { id, game }: { id: number; game: GameSource }) => {
      // Reopening a different session ends the current one first (frees its reader).
      if (currentSessionId && currentSessionId !== id) {
        closeSession("reopen: different session requested");
      }

      // Validation 1: probe the session's game on demand — it must be live with
      // usable data (car/track derived from the historical session below).
      stopAllReaders();
      const probe = await awaitReaderReady(game, READER_READY_TIMEOUT_MS);
      if (probe !== "ok") {
        stopReader(game);
        return {
          ok: false,
          reason:
            probe === "not-live"
              ? `${gameLabel(game)} non è connesso. Avvia il simulatore prima di riaprire la sessione.`
              : "Auto/circuito non ancora rilevati. Entra in pista e riprova.",
        };
      }

      // Validation 2: car/track/layout must match the current in-game values
      const sessionRow = db
        .prepare(
          `SELECT car, track, layout FROM ${t("sessions", game)} WHERE id = ?`,
        )
        .get(id) as { car: string; track: string; layout: string } | undefined;
      if (!sessionRow) {
        stopReader(game);
        return { ok: false, reason: "Sessione non trovata." };
      }

      if (
        sessionRow.car !== currentCar ||
        sessionRow.track !== currentTrack ||
        (game === "r3e" && sessionRow.layout !== currentLayout)
      ) {
        stopReader(game);
        const names = resolveNames(
          game,
          sessionRow.car,
          sessionRow.track,
          sessionRow.layout,
        );
        return {
          ok: false,
          reason: `Auto o circuito non corrispondono alla sessione. La sessione richiede ${names.carName} a ${names.trackName}${names.layoutName && names.layoutName !== names.trackName ? ` - ${names.layoutName}` : ""}, ma il simulatore ha rilevato ${resolveNames(game, currentCar, currentTrack, currentLayout).carName}.`,
        };
      }

      activeGame = game;
      try {
        db.prepare(
          `UPDATE ${t("sessions", game)} SET ended_at = NULL WHERE id = ?`,
        ).run(id);
      } catch (err) {
        console.error("[Main] session:reopen error:", err);
        stopAllReaders();
        return { ok: false, reason: String(err) };
      }

      currentSessionId = id;
      currentSessionGame = game;
      sessionAlerts.length = 0;

      // Resume sequential lap counter from existing laps in the session
      const lapCountRow = db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM ${t("laps", game)} WHERE session_id = ?`,
        )
        .get(id) as { cnt: number };
      sessionLapSeq = lapCountRow.cnt;

      // Restore last loaded setup
      const lastSetupRow = db
        .prepare(
          `SELECT id FROM ${t("session_setups", game)} WHERE session_id = ? ORDER BY loaded_at DESC, id DESC LIMIT 1`,
        )
        .get(id) as { id: number } | undefined;
      currentSetupId = lastSetupRow?.id ?? null;

      const raw = db
        .prepare(`SELECT * FROM ${t("sessions", game)} WHERE id = ?`)
        .get(id) as Record<string, unknown>;
      const session = enrichSession(raw, game);
      pushToRenderer("session:started", session);

      console.log(
        `[Main] session reopened id=${id} game=${game} setupId=${currentSetupId ?? "none"}`,
      );
      return {
        ok: true,
        sessionId: id,
        game,
        car: session.car_name ?? session.car,
        track: session.track_name ?? session.track,
      };
    },
  );

  ipcMain.handle(
    "session:getSetupHistory",
    (
      _event,
      {
        car,
        track,
        layout,
        game,
      }: { car: string; track: string; layout: string; game: GameSource },
    ) => {
      const setupsRaw = db
        .prepare(
          `SELECT ss.* FROM ${t("session_setups", game)} ss
           JOIN ${t("sessions", game)} s ON ss.session_id = s.id
           WHERE s.car = ? AND s.track = ? AND s.layout = ?
           ORDER BY ss.loaded_at DESC
           LIMIT 20`,
        )
        .all(car, track, layout) as Array<{
        id: number;
        session_id: number;
        loaded_at: string;
        setup_json: string;
        setup_screenshots: string | null;
      }>;

      return setupsRaw.map(parseSetupRow);
    },
  );

  // Reuse an existing setup row: just update currentSetupId, no new DB row
  ipcMain.handle(
    "session:reuseSetup",
    (_event, { setupId }: { setupId: number }) => {
      if (!currentSessionId) {
        throw new Error("Nessuna sessione attiva.");
      }
      currentSetupId = setupId;
    },
  );

  // ──────────────────────────────────────────────
  // Azure TTS / STT IPC (unchanged)
  // ──────────────────────────────────────────────

  ipcMain.handle("tts:getVoices", async () => {
    const key = getConfig("azureSpeechKey");
    const region = getConfig("azureRegion");
    if (!key || !region)
      throw new Error("Azure Speech Key e Region non configurati");
    return getAzureVoices(key, region);
  });

  ipcMain.handle("tts:synthesize", async (_event, text: string) => {
    const key = getConfig("azureSpeechKey");
    const region = getConfig("azureRegion");
    const voice = getConfig("azureVoiceName");
    if (!key || !region || !voice)
      throw new Error("Azure TTS non completamente configurato");
    try {
      return await synthesizeAzure(text, key, region, voice);
    } catch (err) {
      if (isCreditOrQuotaError(err)) pushAppError(buildAzureErrorMessage(err));
      throw err;
    }
  });

  ipcMain.handle("tts:test", async (_event, voiceName: string) => {
    const key = getConfig("azureSpeechKey");
    const region = getConfig("azureRegion");
    if (!key || !region)
      throw new Error("Azure Speech Key e Region non configurati");
    const assistantName = getConfig("assistantName") ?? "Aria";
    const testPhrase = `Ciao, sono ${assistantName} e oggi sono il tuo assistente in pista.`;
    return synthesizeAzure(testPhrase, key, region, voiceName);
  });

  // Live list of Claude models for the analysis model selector.
  // ponytail: returns [] on missing key / API error — the renderer falls back
  // to showing the saved model and skips the obsolete-model check.
  ipcMain.handle("anthropic:listModels", async () => {
    const apiKey = getAnthropicApiKey();
    if (!apiKey) return [];
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });
      const models = [];
      for await (const m of client.models.list()) {
        models.push({ id: m.id, display_name: m.display_name });
      }
      return models;
    } catch (err) {
      console.error("[anthropic] listModels failed:", err);
      return [];
    }
  });

  ipcMain.handle(
    "stt:transcribe",
    async (_event, audioBuffer: ArrayBuffer, mimeType?: string) => {
      const key = getConfig("azureSpeechKey");
      const region = getConfig("azureRegion");
      if (!key || !region)
        throw new Error("Azure Speech Key e Region non configurati");
      return transcribeAzure(Buffer.from(audioBuffer), key, region, mimeType);
    },
  );

  // ──────────────────────────────────────────────
  // Voice query IPC - classifies intent, routes to session commands or freeform
  // ──────────────────────────────────────────────

  const classifyVoiceIntent = (
    q: string,
  ): "newSession" | "closeSession" | "analyze" | "freeform" => {
    const s = q.toLowerCase();
    const hasSession = /\bsession/.test(s);
    if (
      hasSession &&
      /\b(nuova|apri|inizia|inizio|avvia|avvio|comincia|crea|start|apre|partenza|parti)\b/.test(
        s,
      )
    )
      return "newSession";
    if (
      hasSession &&
      /\b(chiudi|termina|fine|ferma|concludi|stop|finisci|chiude)\b/.test(s)
    )
      return "closeSession";
    if (
      /\b(analizza|analisi|valuta|valutazione|esegui\s+analisi)\b[\s\S]*\b(sessione|giri|ultimi\s+giri)\b/.test(
        s,
      ) ||
      /\banalizza\s+gli\s+ultimi\s+giri\b/.test(s) ||
      /\b(analizza|analisi|valuta|valutazione|esegui\s+analisi)\b/.test(s)
    )
      return "analyze";
    return "freeform";
  };

  const speakText = async (text: string): Promise<void> => {
    pushToRenderer("coach:voiceDone", { answer: text });
    if (getConfig("azureTtsEnabled") !== "true") return;
    const key = getConfig("azureSpeechKey");
    const region = getConfig("azureRegion");
    const voice = getConfig("azureVoiceName");
    if (!key || !region || !voice) return;
    try {
      const audio = await synthesizeAzure(text, key, region, voice);
      pushToRenderer("coach:voiceAudio", { audio });
    } catch (err) {
      console.error("[VoiceCoach] TTS synthesis error:", err);
      if (isCreditOrQuotaError(err)) pushAppError(buildAzureErrorMessage(err));
    }
  };

  ipcMain.handle("coach:voiceQuery", async (_event, question: string) => {
    console.log("[VoiceCoach] question:", question);
    const intent = classifyVoiceIntent(question);
    console.log("[VoiceCoach] intent:", intent);

    if (intent === "newSession") {
      // No picker over voice: retry the last known game (activeGame). Readers are
      // idle until now, so startSession starts it on demand and validates it is
      // actually live; if the user is on a different sim, use the UI picker.
      const res = await startSession(activeGame);
      if (res.ok) {
        const names = resolveNames(
          activeGame,
          currentCar,
          currentTrack,
          currentLayout,
        );
        const car = names.carName || "auto sconosciuta";
        const track = names.trackName || "circuito sconosciuto";
        const layout =
          names.layoutName && names.layoutName !== track
            ? `, ${names.layoutName}`
            : "";
        await speakText(`Sessione aperta. ${car} - ${track}${layout}.`);
      } else {
        await speakText(`Impossibile aprire la sessione. ${res.reason}`);
      }
      return;
    }
    if (intent === "closeSession") {
      if (!currentSessionId) {
        await speakText("Non c'è nessuna sessione aperta.");
        return;
      }
      closeSession("voice command");
      await speakText("Sessione chiusa.");
      return;
    }
    if (intent === "analyze") {
      if (!currentSessionId) {
        await speakText("Non c'è nessuna sessione aperta da analizzare.");
        return;
      }
      const apiKey = getAnthropicApiKey();
      if (!apiKey) {
        await speakText("API Key Anthropic non configurata.");
        return;
      }
      sessionCoach.updateApiKey(apiKey);
      sessionCoach.updateCornerNames(buildCornerMap());
      const sRow = db
        .prepare(
          `SELECT car, track, layout FROM ${t("sessions", currentSessionGame)} WHERE id = ?`,
        )
        .get(currentSessionId) as
        { car: string; track: string; layout: string } | undefined;
      const resolved = sRow
        ? resolveNames(currentSessionGame, sRow.car, sRow.track, sRow.layout)
        : undefined;
      const analysis = await sessionCoach.analyzeSession(
        currentSessionId,
        activeGame,
        resolved,
        [...sessionAlerts],
      );
      if (analysis?.summary) {
        await speakText(analysis.summary);
      } else {
        await speakText("Analisi completata.");
      }
      return;
    }

    // Freeform
    const coach = getVoiceCoach();
    if (!coach) {
      await speakText("API Key Anthropic non configurata.");
      return;
    }
    coach.updateContext({ cornerMap: buildCornerMap() });
    // Full session view, resolved by id+game rather than re-derived from car and
    // track: this is the only place that knows WHICH session is active, and a
    // reopened one is not necessarily the most recently started for that car.
    // Cleared when no session is open, otherwise the previous one's setups and
    // analyses would keep answering questions about a session that ended.
    const detail = currentSessionId
      ? loadSessionDetail(currentSessionId, currentSessionGame)
      : null;
    coach.updateContext({
      laps: detail?.laps ?? [],
      setups: detail?.setups ?? [],
      analyses: detail?.analyses ?? [],
    });

    let fullAnswer =
      "Si è verificato un errore durante l'elaborazione della domanda.";
    try {
      fullAnswer = await coach.handleVoiceQuery(question, (token) => {
        pushToRenderer("coach:voiceChunk", { token });
      });
    } catch (err) {
      console.error("[VoiceCoach] Error:", err);
      if (isCreditOrQuotaError(err))
        pushAppError(buildAnthropicErrorMessage(err));
    }
    await speakText(fullAnswer);
  });

  // ACE setup file-based IPC
  // getAceSetupsBase reads the user-configurable path from the DB, falling back
  // to the default installation path when the config key is not set.
  const ACE_SETUPS_DEFAULT = "D:\\Salvataggi\\ACE\\Car Setups";
  const getAceSetupsBase = (): string =>
    getConfig("aceSetupsPath")?.trim() || ACE_SETUPS_DEFAULT;

  ipcMain.handle(
    "ace:listSetupFiles",
    (_event, { car, track }: { car: string; track: string }) => {
      const aceSetupsBase = getAceSetupsBase();
      const dir = path.join(aceSetupsBase, car, track);
      try {
        const files = fs
          .readdirSync(dir)
          .filter((f: string) => f.endsWith(".carsetup"))
          .sort()
          .reverse();
        return files.map((filename: string): AceSetupFileInfo => {
          const filePath = path.join(dir, filename);
          const stat = fs.statSync(filePath);
          return { filename, filePath, modifiedAt: stat.mtime.toISOString() };
        });
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    "ace:readSetup",
    (_event, { filePath }: { filePath: string }) => {
      const aceSetupsBase = getAceSetupsBase();
      const resolvedBase = path.resolve(aceSetupsBase);
      const resolvedPath = path.resolve(filePath);
      // Prevent path traversal: filePath must be inside the ACE setups directory
      if (!resolvedPath.startsWith(resolvedBase + path.sep)) {
        throw new Error("Percorso file non consentito.");
      }
      const buf = fs.readFileSync(resolvedPath);
      const parts = resolvedPath.split(path.sep);
      const carIdx = parts.findIndex((p) => p.toLowerCase() === "car setups");
      const carId =
        carIdx >= 0
          ? (parts[carIdx + 1] ?? "")
          : path.basename(path.dirname(path.dirname(resolvedPath)));
      return decodeCarSetup(buf, carId);
    },
  );

  ipcMain.handle("ace:listSetupCars", () => {
    const aceSetupsBase = getAceSetupsBase();
    try {
      return fs
        .readdirSync(aceSetupsBase)
        .filter((f: string) =>
          fs.statSync(path.join(aceSetupsBase, f)).isDirectory(),
        )
        .sort();
    } catch {
      return [];
    }
  });

  ipcMain.handle("ace:listSetupTracks", (_event, { car }: { car: string }) => {
    const aceSetupsBase = getAceSetupsBase();
    const carDir = path.join(aceSetupsBase, car);
    try {
      return fs
        .readdirSync(carDir)
        .filter((f: string) => fs.statSync(path.join(carDir, f)).isDirectory())
        .sort();
    } catch {
      return [];
    }
  });

  // ──────────────────────────────────────────────
  // AMS2 setup decoding IPC (screenshot → Claude Vision → SetupData)
  // ──────────────────────────────────────────────

  const AMS2_STEAM_APPID = "1066890";
  const SETUP_VISION_MODEL = "claude-sonnet-5";

  /** Auto-detect the single Steam userdata account and return the AMS2 screenshots dir. */
  const getAms2ScreenshotsDir = async (): Promise<string | null> => {
    const fs = await import("fs");
    const pathMod = await import("path");
    const steamBase = "C:\\Program Files (x86)\\Steam\\userdata";
    try {
      const accounts = fs.readdirSync(steamBase).filter((d) => /^\d+$/.test(d));
      if (accounts.length === 0) return null;
      return pathMod.join(
        steamBase,
        accounts[0],
        "760",
        "remote",
        AMS2_STEAM_APPID,
        "screenshots",
      );
    } catch {
      return null;
    }
  };

  ipcMain.handle("setup:listScreenshots", async () => {
    const fs = await import("fs");
    const pathMod = await import("path");
    const screenshotsDir = await getAms2ScreenshotsDir();
    if (!screenshotsDir) return [];
    const thumbnailsDir = pathMod.join(screenshotsDir, "thumbnails");

    // Annotate screenshots already used by a prior AMS2 setup.
    const usedMap = new Map<
      string,
      { setupName: string; loadedAt: string; sessionId: number }
    >();
    try {
      const rows = db
        .prepare(
          "SELECT id, session_id, loaded_at, setup_json, setup_screenshots FROM session_setups_ams2 WHERE setup_screenshots IS NOT NULL",
        )
        .all() as Array<{
        id: number;
        session_id: number;
        loaded_at: string;
        setup_json: string;
        setup_screenshots: string;
      }>;
      for (const row of rows) {
        let filenames: string[] = [];
        try {
          filenames = JSON.parse(row.setup_screenshots);
        } catch {
          continue;
        }
        let setupName = "";
        try {
          setupName =
            (JSON.parse(row.setup_json) as { name?: string }).name ?? "";
        } catch {
          /* ignore */
        }
        for (const fname of filenames) {
          if (!usedMap.has(fname)) {
            usedMap.set(fname, {
              setupName,
              loadedAt: row.loaded_at,
              sessionId: row.session_id,
            });
          }
        }
      }
    } catch {
      /* table missing / not ready — no annotations */
    }

    try {
      const files = fs
        .readdirSync(screenshotsDir)
        .filter((f: string) => /\.(jpg|jpeg|png)$/i.test(f))
        .sort()
        .reverse();
      return files.map((name: string) => {
        const thumbPath = pathMod.join(thumbnailsDir, name);
        const fullPath = pathMod.join(screenshotsDir, name);
        const src = fs.existsSync(thumbPath) ? thumbPath : fullPath;
        const thumbnailB64 = fs.readFileSync(src).toString("base64");
        const alreadyUsed = usedMap.get(name);
        return { name, thumbnailB64, ...(alreadyUsed ? { alreadyUsed } : {}) };
      });
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    "setup:decodeSetup",
    async (
      _event,
      { filenames, expectedCar }: { filenames: string[]; expectedCar: string },
    ) => {
      const fs = await import("fs");
      const pathMod = await import("path");
      const screenshotsDir = await getAms2ScreenshotsDir();
      if (!screenshotsDir)
        throw new Error("Cartella screenshot AMS2 non trovata");

      const apiKey = getAnthropicApiKey();
      if (!apiKey) throw new Error("Anthropic API Key non configurata");

      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });

      const imageContents = filenames.map((name) => {
        // Renderer-supplied names must be bare filenames; a path component
        // ("..", "/" or "\\") would escape the screenshots directory.
        if (pathMod.basename(name) !== name) {
          throw new Error(`Nome file screenshot non valido: ${name}`);
        }
        const fullPath = pathMod.join(screenshotsDir, name);
        const data = fs.readFileSync(fullPath).toString("base64");
        const mediaType: "image/png" | "image/jpeg" = /\.png$/i.test(name)
          ? "image/png"
          : "image/jpeg";
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: mediaType,
            data,
          },
        };
      });

      const systemPrompt = `Sei un esperto di setup per il simulatore di guida Automobilista 2 (AMS2).
Analizza le schermate del setup dell'auto e restituisci un JSON con questa struttura esatta:
{
  "carVerified": boolean,
  "carFound": "nome auto trovato nelle schermate",
  "setupText": "riepilogo markdown del setup",
  "params": [
    { "category": "categoria", "parameter": "nome parametro", "value": "valore" }
  ]
}
Devi verificare se l'auto nelle schermate corrisponde a: "${expectedCar}".
Estrai TUTTI i parametri di setup visibili.
Per ogni parametro assegna "category" ESATTAMENTE uno di questi valori:
- "Gomme": parametri gomma per singola ruota (pressioni, ecc.)
- "Freni": pressione/bilanciamento freni, condotti freni
- "Chassis": parametri telaio non per-ruota (zavorra, ripartizione pesi, sterzo)
- "Sospensioni": parametri sospensione per singola ruota (altezza, molla, camber, convergenza, ammortizzatori bump/rebound, ecc.)
- "Anteriore": parametri sospensione assale anteriore non per-ruota (es. barra antirollio anteriore)
- "Posteriore": parametri sospensione assale posteriore non per-ruota (es. barra antirollio posteriore)
- "Sospensioni attive": parametri di sospensione attiva, se presenti
- "Motore/Elettronica": mappa motore, freno motore, boost, TC, ABS, ecc.
- "Rapporti del cambio": rapporto finale e singole marce
- "Differenziale": precarico, rampe power/coast, dischi, differenziale anteriore e posteriore
Per i parametri per singola ruota (category "Gomme" e "Sospensioni") crea un parametro per ruota e aggiungi il codice ruota in fondo al nome del parametro: " FL", " FR", " RL", " RR" (es. "Pressione FL"). Non usare categorie diverse da quelle elencate.
IMPORTANTE — precisione numerica: leggi ogni cifra di ogni valore con la massima attenzione. Gli slider e altri elementi grafici dell'UI possono apparire adiacenti ai numeri: ignorali e trascrivi solo le cifre del testo numerico visualizzato sullo schermo.
Restituisci solo il JSON, senza testo aggiuntivo.`;

      const response = await client.messages.create({
        model: SETUP_VISION_MODEL,
        max_tokens: 4000,
        thinking: { type: "disabled" },
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              ...imageContents,
              {
                type: "text" as const,
                text: `Analizza queste ${filenames.length} schermate del setup e restituisci il JSON.`,
              },
            ],
          },
        ],
      });

      // sonnet-5 may emit a leading thinking block; find the text block explicitly
      // rather than assuming content[0], then guard the parse.
      const textBlock = response.content.find((b) => b.type === "text");
      const raw = textBlock?.type === "text" ? textBlock.text : "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(
          "Claude Vision non ha restituito un JSON di setup valido. Riprova o seleziona schermate più leggibili.",
        );
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        throw new Error(
          "Risposta di Claude Vision non interpretabile (JSON malformato). Riprova.",
        );
      }

      return {
        carVerified: parsed.carVerified ?? false,
        carFound: parsed.carFound ?? "",
        setupText: parsed.setupText ?? "",
        params: parsed.params ?? [],
        screenshots: filenames,
      } as SetupData;
    },
  );

  // Close any sessions left open by a previous crash or forced quit
  const crashCloseTs = new Date().toISOString();
  db.prepare("UPDATE sessions_r3e SET ended_at = ? WHERE ended_at IS NULL").run(
    crashCloseTs,
  );
  db.prepare("UPDATE sessions_ace SET ended_at = ? WHERE ended_at IS NULL").run(
    crashCloseTs,
  );
  db.prepare(
    "UPDATE sessions_ams2 SET ended_at = ? WHERE ended_at IS NULL",
  ).run(crashCloseTs);

  // Global input listener - works even when the app window is not focused.
  inputManager = createInputManager(() => {
    pushToRenderer("input:trigger", {});
  });

  const kbKey = getConfig("keyboardVoiceKey");
  if (kbKey) inputManager.setKeyboard(kbKey);

  // Ensure the active session is closed and all resources released on exit.
  // This is the single before-quit handler; the module-level one has been removed
  // to avoid double execution of cleanup logic.
  app.on("before-quit", () => {
    clearInterval(liveTicker);
    closeSession("app closing");
    inputManager?.destroy();
    r3eReader.stop();
    aceReader.stop();
    ams2Reader.stop();
    closeDb();
  });

  // Readers are NOT started here. They run on demand, one at a time, only for
  // an active session (or briefly while probing at session start/reopen). Idle
  // means zero SHM polling. See startSession / session:reopen.
  pushStatus();

  mainWindow?.webContents.once("did-finish-load", () => {
    pushStatus();
  });
};

// ──────────────────────────────────────────────
// App lifecycle
// ──────────────────────────────────────────────

app.whenReady().then(() => {
  // setupPipeline must run before createWindow so that all ipcMain.handle
  // registrations are in place before the renderer sends its first IPC calls.
  setupPipeline();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  r3eReaderInst?.stop();
  aceReaderInst?.stop();
  ams2ReaderInst?.stop();
  if (process.platform !== "darwin") app.quit();
});

// Note: reader stop on quit is handled by the before-quit listener in setupPipeline()
// which has direct closure access to r3eReader and aceReader instances.
// The r3eReaderInst / aceReaderInst module-level refs are kept for window-all-closed below.
