import { EventEmitter } from "events";
import { createRequire } from "module";
import {
  AMS2_SHM_NAME,
  AMS2_STRUCT_SIZE,
  AMS2_VERSION,
  CAR_TCS,
  MAX_PARTICIPANTS,
  OFF,
  PART,
  participantOffset,
  RACESTATE_RACING,
  readFloat,
  readFloatArray,
  readInt32,
  readString,
  readUint32,
} from "./ams2-struct.js";
import {
  POLL_INTERVAL_MS,
  RECONNECT_INTERVAL_MS,
} from "../../shared/alert-types.js";
import type { CompactFrame, GameFrame } from "../../shared/types.js";
import { logChannels } from "../channel-log.js";

const _require = createRequire(import.meta.url);

const G = 9.80665; // m/s^2 per g

type Ams2ReaderOptions = { mock?: boolean };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NativePointer = any;

type Kernel32 = {
  OpenFileMappingA: (a: number, i: number, n: string) => NativePointer;
  MapViewOfFile: (
    h: NativePointer,
    a: number,
    oh: number,
    ol: number,
    b: number,
  ) => NativePointer;
  UnmapViewOfFile: (addr: NativePointer) => boolean;
  CloseHandle: (h: NativePointer) => boolean;
  GetLastError: () => number;
};

const FILE_MAP_READ = 0x0004;
const STALE_LIMIT = 120; // ~2s of frozen sequence number while playing → disconnect

export type Ams2SessionInfo = {
  car: string;
  track: string;
  layout: string;
  trackLength: number;
};

export type Ams2Reader = {
  start: () => void;
  stop: () => void;
  on: EventEmitter["on"];
  getSessionInfo: () => Ams2SessionInfo;
};

export const createAms2Reader = (
  options: Ams2ReaderOptions = {},
): Ams2Reader => {
  const emitter = new EventEmitter();
  const isMock = options.mock ?? process.platform !== "win32";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let koffi: any = null;
  let kernel32: Kernel32 | null = null;
  let handle: NativePointer = null;
  let view: NativePointer = null;

  let stopped = false;
  let connected = false;
  let pollTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let loggedOffsets = false;

  // Session cache
  let cachedCar = "";
  let cachedTrack = "";
  let cachedLayout = "";
  let cachedTrackLength = 0;

  // Lap accumulation
  let lapFrames: CompactFrame[] = [];
  let prevLapsCompleted = -1;
  let lapInvalidatedAccum = false;
  let lastSectors: [number, number, number] = [-1, -1, -1];
  let lastSeq = -1;
  let staleCount = 0;

  const isNullPtr = (ptr: NativePointer): boolean => {
    try {
      return koffi.address(ptr) === 0n;
    } catch {
      return ptr === null || ptr === undefined;
    }
  };

  const decodeBuffer = (v: NativePointer, size: number): Buffer => {
    const raw: Uint8Array = koffi.decode(v, koffi.array("uint8_t", size));
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  };

  const cleanup = (): void => {
    if (view && kernel32) {
      try {
        kernel32.UnmapViewOfFile(view);
      } catch {
        /* ignore */
      }
    }
    if (handle && kernel32) {
      try {
        kernel32.CloseHandle(handle);
      } catch {
        /* ignore */
      }
    }
    view = null;
    handle = null;
    lapFrames = [];
    prevLapsCompleted = -1;
    lapInvalidatedAccum = false;
    lastSectors = [-1, -1, -1];
    lastSeq = -1;
    staleCount = 0;
    if (connected) {
      connected = false;
      emitter.emit("disconnected");
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    reconnectTimer = setTimeout(() => tryConnect(), RECONNECT_INTERVAL_MS);
  };

  const tryConnect = (): void => {
    if (stopped) return;
    try {
      if (!koffi) {
        koffi = _require("koffi");
        const lib = koffi.load("kernel32.dll");
        kernel32 = {
          OpenFileMappingA: lib.func(
            "void* __stdcall OpenFileMappingA(uint32 dwDesiredAccess, int bInheritHandle, const char* lpName)",
          ),
          MapViewOfFile: lib.func(
            "void* __stdcall MapViewOfFile(void* hFileMappingObject, uint32 dwDesiredAccess, uint32 dwFileOffsetHigh, uint32 dwFileOffsetLow, size_t dwNumberOfBytesToMap)",
          ),
          UnmapViewOfFile: lib.func(
            "bool __stdcall UnmapViewOfFile(const void* lpBaseAddress)",
          ),
          CloseHandle: lib.func("bool __stdcall CloseHandle(void* hObject)"),
          GetLastError: lib.func("uint32 __stdcall GetLastError()"),
        } as Kernel32;
      }
      handle = kernel32!.OpenFileMappingA(FILE_MAP_READ, 0, AMS2_SHM_NAME);
      if (isNullPtr(handle)) {
        handle = null;
        scheduleReconnect();
        return;
      }
      view = kernel32!.MapViewOfFile(
        handle,
        FILE_MAP_READ,
        0,
        0,
        AMS2_STRUCT_SIZE,
      );
      if (isNullPtr(view)) {
        kernel32!.CloseHandle(handle);
        handle = null;
        view = null;
        scheduleReconnect();
        return;
      }
      connected = true;
      staleCount = 0;
      emitter.emit("connected");
      poll();
    } catch (err) {
      console.error("[AMS2] connect error:", err);
      cleanup();
      scheduleReconnect();
    }
  };

  /** Read a stable snapshot using the sequence-number protocol (App.cpp:64-77). */
  const readStable = (): Buffer | null => {
    const buf = decodeBuffer(view, AMS2_STRUCT_SIZE);
    const seq = readUint32(buf, OFF.sequenceNumber);
    if (seq % 2 !== 0) return null; // write in progress
    const buf2 = decodeBuffer(view, AMS2_STRUCT_SIZE);
    if (readUint32(buf2, OFF.sequenceNumber) !== seq) return null; // torn read
    // Stale detection: sequence frozen while we expect fresh data.
    if (seq === lastSeq) staleCount++;
    else {
      staleCount = 0;
      lastSeq = seq;
    }
    return buf;
  };

  const updateSession = (buf: Buffer): void => {
    cachedCar = readString(buf, OFF.carName, 64) || cachedCar;
    cachedTrack = readString(buf, OFF.trackLocation, 64) || cachedTrack;
    const variation = readString(buf, OFF.trackVariation, 64);
    cachedLayout = variation || cachedTrack;
    const len = readFloat(buf, OFF.trackLength);
    if (len > 0) cachedTrackLength = len;
  };

  const poll = (): void => {
    if (stopped) return;
    try {
      const buf = readStable();
      if (staleCount > STALE_LIMIT) {
        cleanup();
        scheduleReconnect();
        return;
      }
      if (!buf) {
        pollTimer = setTimeout(() => poll(), POLL_INTERVAL_MS);
        return;
      }

      const version = readUint32(buf, OFF.version);
      const raceState = readUint32(buf, OFF.raceState);

      if (!loggedOffsets) {
        loggedOffsets = true;
        console.log(
          `[AMS2] connected: mVersion=${version} (expected ${AMS2_VERSION}) ` +
            `speed=${(readFloat(buf, OFF.speed) * 3.6).toFixed(1)}km/h ` +
            `car="${readString(buf, OFF.carName, 64)}" ` +
            `track="${readString(buf, OFF.trackLocation, 64)}"`,
        );
      }

      // Only produce coach data while actually on track. We gate on mRaceState,
      // not mGameState: AMS2 reports mGameState=3 (nominally paused) during normal
      // driving, so the documented GAME_INGAME_PLAYING check would drop every
      // driving frame. RACESTATE_RACING means the car is in a live, running session.
      if (raceState !== RACESTATE_RACING) {
        pollTimer = setTimeout(() => poll(), POLL_INTERVAL_MS);
        return;
      }

      updateSession(buf);

      let idx = readInt32(buf, OFF.viewedParticipantIndex);
      if (idx < 0 || idx >= MAX_PARTICIPANTS) idx = 0;

      const lapDistance = readFloat(
        buf,
        participantOffset(idx, PART.currentLapDistance),
      );
      const lapsCompleted = readUint32(
        buf,
        participantOffset(idx, PART.lapsCompleted),
      );
      const wpos = readFloatArray(
        buf,
        participantOffset(idx, PART.worldPosition),
        3,
      );

      const speed = readFloat(buf, OFF.speed); // m/s
      const throttle = readFloat(buf, OFF.throttle);
      const brake = readFloat(buf, OFF.brake);
      const steering = readFloat(buf, OFF.steering);
      const gear = readInt32(buf, OFF.gear);
      const rpm = readFloat(buf, OFF.rpm);
      const carFlags = readUint32(buf, OFF.carFlags);
      const antiLock = buf.readUInt8(OFF.antiLockActive) !== 0;
      const brakeTemps = readFloatArray(buf, OFF.brakeTempCelsius, 4);
      const tyreTemps = readFloatArray(buf, OFF.tyreTemp, 4);
      const tyrePressures = readFloatArray(buf, OFF.airPressure, 4);
      const suspTravel = readFloatArray(buf, OFF.suspensionTravel, 4);
      // mLocalAcceleration is m/s^2; the gLat/gLon channels are in g.
      const localAcc = readFloatArray(buf, OFF.localAcceleration, 3);

      // ── Driver aids ──
      // ponytail: AMS2 exposes NO "TC cutting now" flag. Heuristic: TCS enabled +
      // near-full throttle. Kept conservative (0.95) to avoid P2 alert spam.
      // Upgrade path: derive from rear-wheel slip (mTyreRPS vs mSpeed) if needed.
      const tcsEnabled = (carFlags & CAR_TCS) !== 0;
      const tcActive = tcsEnabled && throttle > 0.95 ? 1 : 0;
      const absActive = brake > 0.05 && antiLock ? 1 : 0;

      const gameFrame: GameFrame = {
        lapDistance,
        tcActive,
        absActive,
        brakeTempFL: brakeTemps[0] ?? -1,
        brakeTempFR: brakeTemps[1] ?? -1,
        brakeTempRL: brakeTemps[2] ?? -1,
        brakeTempRR: brakeTemps[3] ?? -1,
      };
      emitter.emit("ams2:frame", gameFrame);

      // Full frame for telemetry logging.
      emitter.emit("ams2:fullFrame", {
        car: cachedCar,
        track: cachedTrack,
        layout: cachedLayout,
        lapDistance,
        speedKmh: speed * 3.6,
        throttle,
        brake,
        steering,
        gear,
        rpm,
        tcActive,
        absActive,
        brakeTemps,
        wx: wpos[0],
        wy: wpos[1],
        wz: wpos[2],
      });

      // Accumulate frame + lap-invalidation over the lap.
      if (buf.readUInt8(OFF.lapInvalidated) !== 0) lapInvalidatedAccum = true;
      lapFrames.push({
        d: lapDistance,
        spd: speed * 3.6,
        thr: throttle,
        brk: brake,
        str: steering,
        gear,
        abs: absActive,
        tc: tcActive,
        bt: [...brakeTemps],
        ts: Date.now(),
        rpm,
        gLat: localAcc[0] / G,
        gLon: localAcc[2] / G,
        tp: [...tyrePressures],
        sus: [...suspTravel],
        tt: [...tyreTemps],
        // No `sr`: AMS2 has no slip-ratio channel and mTyreRPS needs a tyre
        // radius the SHM does not expose. Absent beats a floored zero.
        wx: wpos[0],
        wy: wpos[1],
        wz: wpos[2],
      });
      logChannels("AMS2", lapFrames.at(-1));

      // ── Lap completion: mLapsCompleted increment ──
      if (prevLapsCompleted >= 0 && lapsCompleted > prevLapsCompleted) {
        const lapTime = readFloat(buf, OFF.lastLapTime);
        emitter.emit("lapComplete", {
          lapNumber: lapsCompleted,
          lapTime: lapTime > 0 ? lapTime : 0,
          // ponytail: sector times from the previous poll (locked-in values before
          // the line reset them); ~1 frame imprecision, still better than ACE's [-1].
          sectorTimes: lastSectors,
          frames: [...lapFrames],
          car: cachedCar,
          track: cachedTrack,
          layout: cachedLayout,
          layoutLength: cachedTrackLength,
          valid: !lapInvalidatedAccum,
        });
        lapFrames = [];
        lapInvalidatedAccum = false;
      }
      prevLapsCompleted = lapsCompleted;
      lastSectors = [
        readFloat(buf, OFF.currentSector1Time),
        readFloat(buf, OFF.currentSector2Time),
        readFloat(buf, OFF.currentSector3Time),
      ];

      pollTimer = setTimeout(() => poll(), POLL_INTERVAL_MS);
    } catch (err) {
      console.error("[AMS2] poll error:", err);
      cleanup();
      scheduleReconnect();
    }
  };

  // ── Mock mode (non-Windows) ──
  const startMock = (): void => {
    connected = true;
    emitter.emit("connected");
    cachedCar = "formula_ultimate_gen2";
    cachedTrack = "Interlagos";
    cachedLayout = "Grand Prix";
    cachedTrackLength = 4309;
    let dist = 0;
    const tick = (): void => {
      if (stopped) return;
      dist = (dist + 40) % cachedTrackLength;
      emitter.emit("ams2:frame", {
        lapDistance: dist,
        tcActive: 0,
        absActive: 0,
        brakeTempFL: 450,
        brakeTempFR: 450,
        brakeTempRL: 430,
        brakeTempRR: 430,
      } as GameFrame);
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();
  };

  return {
    start: () => {
      stopped = false;
      if (isMock) startMock();
      else tryConnect();
    },
    stop: () => {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      cleanup();
    },
    on: emitter.on.bind(emitter),
    getSessionInfo: (): Ams2SessionInfo => ({
      car: cachedCar,
      track: cachedTrack,
      layout: cachedLayout,
      trackLength: cachedTrackLength,
    }),
  };
};
