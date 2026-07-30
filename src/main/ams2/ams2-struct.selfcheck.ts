/**
 * Runnable self-check for the pCARS2 struct offset math.
 *
 * `npx ts-node --esm --project tsconfig.node.json src/main/ams2/ams2-struct.selfcheck.ts`
 * is BROKEN in this environment (Node 24 + ts-node 10.9.2 ESM-loader bug).
 *
 * WORKING approach: compile this file + ams2-struct.ts directly with tsc to a scratch
 * outDir (NodeNext module/moduleResolution, strict, esModuleInterop, node types), then
 * run the emitted .js with plain node:
 *
 *   npx tsc --ignoreConfig --module NodeNext --moduleResolution NodeNext --target ES2022 \
 *     --strict --esModuleInterop --types node --outDir <scratch-dir> \
 *     src/main/ams2/ams2-struct.ts src/main/ams2/ams2-struct.selfcheck.ts
 *   node <scratch-dir>/ams2-struct.selfcheck.js
 *
 * (`--ignoreConfig` is required on TypeScript 6.x when passing files on the command line
 * while a tsconfig.json is present in the project root.)
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
assert.equal(OFF.brakeTempCelsius, 7184, "mBrakeTempCelsius offset");
assert.equal(OFF.sequenceNumber, 7320, "mSequenceNumber offset");

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
