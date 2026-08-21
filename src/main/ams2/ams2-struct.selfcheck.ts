/**
 * Runnable self-check for the pCARS2 struct offset math.
 *
 * Run it (with every other self-check) via:
 *
 *   npm run selfcheck
 *
 * Two dead ends, recorded so they are not retried:
 * `npx ts-node --esm --project tsconfig.node.json …` is BROKEN here (Node 24 +
 * ts-node 10.9.2 ESM-loader bug), and compiling with explicit CLI flags needs
 * `--ignoreConfig` on TypeScript 6.x, which then makes `--types node` fail with
 * TS2688 — @types/node is not a declared dependency here, it is only reachable
 * transitively through electron-vite. tsconfig.selfcheck.json extends
 * tsconfig.node.json precisely to inherit that resolution.
 *
 * No test framework (assert only) — fails loudly if the offset arithmetic breaks.
 */
import assert from "node:assert/strict";
import {
  AMS2_STRUCT_SIZE,
  PARTICIPANT_SIZE,
  OFF,
  PART,
  participantOffset,
  readFloat,
  readUint32,
} from "./ams2-struct.js";

// Struct-level invariants (derived from SharedMemory.h, Pack=4).
assert.equal(PARTICIPANT_SIZE, 100, "ParticipantInfo size");
assert.equal(AMS2_STRUCT_SIZE, 20700, "SharedMemory total size");
assert.equal(OFF.version, 0, "mVersion offset");
assert.equal(OFF.viewedParticipantIndex, 20, "mViewedParticipantIndex offset");
assert.equal(OFF.participantInfo, 28, "mParticipantInfo base offset");
assert.equal(OFF.speed, 6848, "mSpeed offset");
assert.equal(OFF.brake, 6860, "mBrake offset");
assert.equal(OFF.throttle, 6864, "mThrottle offset");
assert.equal(OFF.carFlags, 6816, "mCarFlags offset");
assert.equal(OFF.localAcceleration, 6956, "mLocalAcceleration offset");
assert.equal(OFF.tyreTemp, 7072, "mTyreTemp offset");
assert.equal(OFF.brakeTempCelsius, 7184, "mBrakeTempCelsius offset");
assert.equal(OFF.sequenceNumber, 7320, "mSequenceNumber offset");
// SharedMemory.h declares these two AFTER mSequenceNumber, so offsets past 7320
// are correct here, not a copy-paste slip.
assert.equal(OFF.suspensionTravel, 7340, "mSuspensionTravel offset");
assert.equal(OFF.airPressure, 7372, "mAirPressure offset");
assert.ok(
  OFF.airPressure + 4 * 4 <= AMS2_STRUCT_SIZE,
  "per-wheel reads stay inside the mapped page",
);

// Participant arithmetic: player 0's lapDistance sits at 28 + 0*100 + 80 = 108.
assert.equal(PART.currentLapDistance, 80, "PART.currentLapDistance");
assert.equal(
  participantOffset(0, PART.currentLapDistance),
  108,
  "player 0 lapDistance",
);
assert.equal(
  participantOffset(1, PART.currentLapDistance),
  208,
  "player 1 lapDistance",
);

// Sample-buffer round-trip: write known values, read them back at computed offsets.
const buf = Buffer.alloc(AMS2_STRUCT_SIZE);
buf.writeUInt32LE(14, OFF.version);
buf.writeFloatLE(72.5, OFF.speed);
buf.writeUInt32LE(6, OFF.sequenceNumber);
buf.writeFloatLE(1234.5, participantOffset(3, PART.currentLapDistance));
assert.equal(readUint32(buf, OFF.version), 14, "read version");
assert.equal(readFloat(buf, OFF.speed), 72.5, "read speed");
assert.equal(readUint32(buf, OFF.sequenceNumber), 6, "read seq");
assert.equal(
  readFloat(buf, participantOffset(3, PART.currentLapDistance)),
  1234.5,
  "read player 3 dist",
);

console.log("ams2-struct self-check OK");
