import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { KoffiFunc } from "koffi";
import type { GameFrame, LapRecord } from "../../shared/types.js";
import { createAms2Reader, readStableAms2Snapshot } from "./ams2-reader.js";
import {
  AMS2_STRUCT_SIZE,
  OFF,
  PART,
  participantOffset,
} from "./ams2-struct.js";

const snapshot = Buffer.alloc(AMS2_STRUCT_SIZE);
snapshot.writeUInt32LE(10, OFF.sequenceNumber);
assert.equal(
  readStableAms2Snapshot(
    () => 10,
    () => snapshot,
  ),
  snapshot,
);
let copied = false;
assert.equal(
  readStableAms2Snapshot(
    () => 11,
    () => {
      copied = true;
      return snapshot;
    },
  ),
  null,
);
assert.equal(copied, false, "an in-progress write must not be copied");
assert.equal(
  readStableAms2Snapshot(
    () => 8,
    () => snapshot,
  ),
  null,
  "a write between the initial sequence read and its copy must be rejected",
);
let reads = 0;
assert.equal(
  readStableAms2Snapshot(
    () => (reads++ === 0 ? 10 : 12),
    () => snapshot,
  ),
  null,
  "a write during the copy must be rejected",
);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (
  condition: () => boolean,
  message: string,
  timeout = 1500,
): Promise<void> => {
  const deadline = Date.now() + timeout;
  while (!condition() && Date.now() < deadline) await sleep(10);
  assert.ok(condition(), message);
};

const checkReader = async (): Promise<void> => {
  const require = createRequire(import.meta.url);
  const koffi = require("koffi") as typeof import("koffi");
  const kernel = koffi.load("kernel32.dll");
  const createMapping = kernel.func(
    "void* __stdcall CreateFileMappingA(intptr_t file, void* attrs, uint32 protection, uint32 high, uint32 low, const char* name)",
  ) as KoffiFunc<
    (
      file: number,
      attrs: null,
      protection: number,
      high: number,
      low: number,
      name: string,
    ) => unknown
  >;
  const mapView = kernel.func(
    "void* __stdcall MapViewOfFile(void* handle, uint32 access, uint32 high, uint32 low, size_t size)",
  ) as KoffiFunc<
    (
      handle: unknown,
      access: number,
      high: number,
      low: number,
      size: number,
    ) => unknown
  >;
  const unmapView = kernel.func(
    "bool __stdcall UnmapViewOfFile(void* view)",
  ) as KoffiFunc<(view: unknown) => boolean>;
  const closeHandle = kernel.func(
    "bool __stdcall CloseHandle(void* handle)",
  ) as KoffiFunc<(handle: unknown) => boolean>;
  const getLastError = kernel.func(
    "uint32 __stdcall GetLastError()",
  ) as KoffiFunc<() => number>;

  const name = `sdc-ams2-selfcheck-${randomUUID()}`;
  const handle = createMapping(-1, null, 4, 0, AMS2_STRUCT_SIZE, name);
  assert.notEqual(koffi.address(handle), 0n, "CreateFileMappingA failed");
  const view = mapView(handle, 6, 0, 0, AMS2_STRUCT_SIZE);
  if (koffi.address(view) === 0n) {
    const error = getLastError();
    closeHandle(handle);
    throw new Error(`MapViewOfFile failed: ${error}`);
  }

  const page = Buffer.from(koffi.view(view, AMS2_STRUCT_SIZE));
  page.fill(0);
  page.writeUInt32LE(14, OFF.version);
  page.writeUInt32LE(3, OFF.gameState);
  page.writeUInt32LE(1, OFF.sessionState);
  page.writeUInt32LE(1, OFF.raceState);
  page.writeInt32LE(0, OFF.viewedParticipantIndex);
  page.writeInt32LE(1, OFF.numParticipants);
  page.writeUInt8(1, participantOffset(0, PART.isActive));
  page.writeFloatLE(1234.5, participantOffset(0, PART.currentLapDistance));
  page.write("BMW M4 GT4", OFF.carName, "ascii");
  page.write("Monza", OFF.trackLocation, "ascii");
  page.write("GP", OFF.trackVariation, "ascii");
  page.writeFloatLE(5793, OFF.trackLength);
  [450, 451, 430, 431].forEach((value, i) =>
    page.writeFloatLE(value, OFF.brakeTempCelsius + i * 4),
  );
  [82, 83, 84, 85].forEach((value, i) =>
    page.writeFloatLE(value, 20584 + i * 4),
  );
  [84, 85, 86, 87].forEach((value, i) =>
    page.writeFloatLE(value, 20600 + i * 4),
  );
  [86, 87, 88, 89].forEach((value, i) =>
    page.writeFloatLE(value, 20616 + i * 4),
  );
  [5.1, 5.2, 6.1, 6.2].forEach((value, i) =>
    page.writeFloatLE(value, 20636 + i * 4),
  );
  [180, 181, 182, 183].forEach((value, i) =>
    page.writeFloatLE(value, 7372 + i * 4),
  );
  let sequence = 2;
  page.writeUInt32LE(sequence, OFF.sequenceNumber);

  const update = (write: (buf: Buffer) => void): void => {
    page.writeUInt32LE(++sequence, OFF.sequenceNumber);
    write(page);
    page.writeUInt32LE(++sequence, OFF.sequenceNumber);
  };
  const restorePrestart = (buf: Buffer): void => {
    buf.writeUInt32LE(3, OFF.gameState);
    buf.writeUInt32LE(1, OFF.sessionState);
    buf.writeUInt32LE(1, OFF.raceState);
    buf.writeInt32LE(0, OFF.viewedParticipantIndex);
    buf.writeInt32LE(1, OFF.numParticipants);
    buf.writeUInt8(1, participantOffset(0, PART.isActive));
  };

  const loadDescriptor = Object.getOwnPropertyDescriptor(koffi, "load");
  assert.ok(loadDescriptor, "koffi.load descriptor missing");
  const originalLoad = koffi.load;
  Object.defineProperty(koffi, "load", {
    ...loadDescriptor,
    value: (libraryName: string | null) => {
      const library = originalLoad(libraryName);
      return new Proxy(library, {
        get: (target, property, receiver) => {
          if (property !== "func")
            return Reflect.get(target, property, receiver);
          return (declaration: string) => {
            const fn = target.func(declaration);
            return declaration.includes(" OpenFileMappingA(")
              ? (access: number, inherit: number) => fn(access, inherit, name)
              : fn;
          };
        },
      });
    },
  });

  const reader = createAms2Reader({ mock: false });
  const frames: GameFrame[] = [];
  const laps: LapRecord[] = [];
  const connectedInfo: ReturnType<typeof reader.getSessionInfo>[] = [];
  let connections = 0;
  let disconnections = 0;
  reader.on("connected", () => {
    connections++;
    connectedInfo.push(reader.getSessionInfo());
  });
  reader.on("disconnected", () => disconnections++);
  reader.on("ams2:frame", (frame: GameFrame) => frames.push(frame));
  reader.on("lapComplete", (lap: LapRecord) => laps.push(lap));

  try {
    reader.start();
    await sleep(80);
    assert.equal(frames.length, 0, "a frozen initial snapshot is not live");

    update(() => {});
    await waitFor(
      () => frames.length > 0,
      "an active participant in a pre-start session must produce frames",
    );
    assert.deepEqual(frames[0], {
      lapDistance: 1234.5,
      tcActive: 0,
      absActive: 0,
      brakeTempFL: 450,
      brakeTempFR: 451,
      brakeTempRL: 430,
      brakeTempRR: 431,
    });
    assert.deepEqual(reader.getSessionInfo(), {
      car: "BMW M4 GT4",
      track: "Monza",
      layout: "GP",
      trackLength: 5793,
    });

    let count = frames.length;
    update((buf) => {
      buf.writeUInt32LE(2, OFF.gameState);
      buf.writeUInt32LE(6, OFF.sessionState);
    });
    await waitFor(
      () => frames.length > count,
      "pre-start frames must also work in playing/time-attack state",
    );

    count = frames.length;
    await waitFor(
      () => frames.length >= count + 2,
      "live snapshots must keep the 16ms sampling cadence between updates",
    );

    count = frames.length;
    update((buf) => {
      buf.writeUInt32LE(3, OFF.gameState);
      buf.writeUInt32LE(2, OFF.raceState);
    });
    await waitFor(
      () => frames.length > count,
      "racing frames must still work with gameState=3",
    );
    count = frames.length;
    update((buf) => {
      buf.writeFloatLE(60, OFF.speed);
      buf.writeFloatLE(1240, participantOffset(0, PART.currentLapDistance));
    });
    await waitFor(
      () => frames.at(-1)?.lapDistance === 1240,
      "a moving car must emit",
    );
    update((buf) => {
      buf.writeUInt32LE(1, participantOffset(0, PART.lapsCompleted));
      buf.writeFloatLE(90, OFF.lastLapTime);
      buf.writeFloatLE(1245, participantOffset(0, PART.currentLapDistance));
    });
    await waitFor(() => laps.length === 1, "lap completion must still work");
    assert.equal(laps[0].lapNumber, 1);
    assert.equal(laps[0].lapTime, 90);
    assert.equal(laps[0].car, "BMW M4 GT4");
    assert.ok(
      laps[0].frames.length <= 3 && laps[0].frames.every((f) => f.spd >= 1),
      `the standstill before the start must not reach the lap (${laps[0].frames.length})`,
    );
    const recorded = laps[0].frames[0];
    assert.deepEqual(recorded.tti, [86, 83, 88, 85]);
    assert.deepEqual(recorded.ttc, [84, 85, 86, 87]);
    assert.deepEqual(recorded.tto, [82, 87, 84, 89]);
    const rideHeights = recorded.rh;
    assert.ok(rideHeights);
    [0.051, 0.052, 0.061, 0.062].forEach((value, i) =>
      assert.ok(Math.abs(rideHeights[i] - value) < 1e-6),
    );
    const pressures = recorded.tp;
    assert.ok(pressures);
    [180, 181, 182, 183].forEach((value, i) =>
      assert.ok(Math.abs(pressures[i] - value * 0.145038) < 1e-6),
    );
    assert.ok(frames.length > count);

    update((buf) => {
      buf.writeFloatLE(60, OFF.speed);
      buf.writeFloatLE(1250, participantOffset(0, PART.currentLapDistance));
    });
    await waitFor(
      () => frames.at(-1)?.lapDistance === 1250,
      "a moving car must emit",
    );
    await sleep(40);
    count = frames.length;
    update(() => {});
    update(() => {});
    await sleep(80);
    assert.equal(frames.length, count, "a frozen moving car must not emit");
    update((buf) =>
      buf.writeFloatLE(1300, participantOffset(0, PART.currentLapDistance)),
    );
    await waitFor(() => frames.length > count, "a moving car must resume");
    count = frames.length;
    update((buf) => {
      buf.writeFloatLE(0, OFF.speed);
      buf.writeUInt32LE(2, participantOffset(0, PART.lapsCompleted));
    });
    await waitFor(() => laps.length === 2, "second lap must complete");
    assert.ok(
      laps[1].frames.length <= 3,
      `frozen samples must not reach the lap (${laps[1].frames.length})`,
    );

    const rejected: [string, (buf: Buffer) => void][] = [
      ["finished race", (buf) => buf.writeUInt32LE(3, OFF.raceState)],
      ["invalid race state", (buf) => buf.writeUInt32LE(0, OFF.raceState)],
      ["frontend", (buf) => buf.writeUInt32LE(1, OFF.gameState)],
      ["in-game menu", (buf) => buf.writeUInt32LE(4, OFF.gameState)],
      ["restarting", (buf) => buf.writeUInt32LE(5, OFF.gameState)],
      ["replay", (buf) => buf.writeUInt32LE(6, OFF.gameState)],
      ["invalid session", (buf) => buf.writeUInt32LE(0, OFF.sessionState)],
      ["unknown session", (buf) => buf.writeUInt32LE(7, OFF.sessionState)],
      [
        "invalid participant",
        (buf) => buf.writeInt32LE(-1, OFF.viewedParticipantIndex),
      ],
      [
        "missing participant",
        (buf) => buf.writeInt32LE(0, OFF.numParticipants),
      ],
      [
        "participant outside the array",
        (buf) => {
          buf.writeInt32LE(65, OFF.numParticipants);
          buf.writeInt32LE(64, OFF.viewedParticipantIndex);
        },
      ],
      [
        "inactive participant",
        (buf) => buf.writeUInt8(0, participantOffset(0, PART.isActive)),
      ],
    ];
    for (const [label, change] of rejected) {
      count = frames.length;
      update((buf) => {
        restorePrestart(buf);
        change(buf);
      });
      await sleep(80);
      assert.equal(frames.length, count, `${label} must not produce frames`);
    }

    count = frames.length;
    update(restorePrestart);
    await waitFor(() => frames.length > count, "pre-start frames must resume");
    await waitFor(() => disconnections > 0, "frozen SHM must disconnect", 3000);
    count = frames.length;
    await waitFor(() => connections > 1, "frozen SHM must be re-probed", 3000);
    await sleep(80);
    assert.equal(
      frames.length,
      count,
      "reconnecting must not revive frozen SHM",
    );
    update(() => {});
    await waitFor(() => frames.length > count, "fresh SHM must recover");

    reader.stop();
    reader.start();
    assert.deepEqual(
      connectedInfo.at(-1),
      { car: "", track: "", layout: "", trackLength: 0 },
      "a new probe must not reuse the previous session's identifiers",
    );
    count = frames.length;
    update(() => {});
    await waitFor(() => frames.length > count, "the restarted reader must run");
    const previousDisconnections = disconnections;
    page.writeUInt32LE(++sequence, OFF.sequenceNumber);
    await waitFor(
      () => disconnections > previousDisconnections,
      "a sequence stuck during a write must disconnect",
      3000,
    );
  } finally {
    reader.stop();
    Object.defineProperty(koffi, "load", loadDescriptor);
    unmapView(view);
    closeHandle(handle);
  }
};

if (process.platform === "win32") {
  await checkReader();
  console.log("ams2-reader self-check OK");
} else {
  console.log("ams2-reader native self-check skipped (Windows only)");
}
