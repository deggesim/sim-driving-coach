/**
 * pCARS2 / Automobilista 2 shared-memory struct layout (SHARED_MEMORY_VERSION = 14).
 * Offsets derived from SharedMemory.h with Pack=4 alignment (all members <= 4 bytes,
 * so effective alignment is 4; `bool` occupies 1 byte + padding to the next 4-byte field).
 * Single memory-mapped page named "$pcars2$" (App.cpp:15).
 *
 * IMPORTANT: validate empirically on first connection (log mVersion, mSpeed, lapDistance,
 * car/track name) against the in-game HUD — see CLAUDE.md §Struct Offset Debugging.
 */

// ── Constants ──
export const AMS2_SHM_NAME = "$pcars2$";
export const AMS2_VERSION = 14;
export const MAX_PARTICIPANTS = 64;
export const PARTICIPANT_SIZE = 100; // sizeof(ParticipantInfo), Pack=4
export const AMS2_STRUCT_SIZE = 20700; // sizeof(SharedMemory), Pack=4

// mRaceState enum (Type#3): the car is in a live, running session.
// NOTE: we intentionally gate coach data on mRaceState, NOT mGameState. AMS2 does
// not honour the documented pCARS2 mGameState enum — it reports mGameState=3
// (nominally GAME_INGAME_PAUSED) during normal driving — so gating on
// GAME_INGAME_PLAYING (2) would drop every driving frame. mRaceState is reliable.
export const RACESTATE_RACING = 2;

// mCarFlags bits (Type#9)
export const CAR_ABS = 1 << 4; // 16
export const CAR_TCS = 1 << 6; // 64

// Tyre order matches TYRE_* enum: FL=0, FR=1, RL=2, RR=3.

/**
 * ParticipantInfo field offsets (relative to the participant's base).
 * bool(1)+char[64] → 65; float[3] aligns to 68 → 80; then four 4-byte fields.
 */
export const PART = {
  isActive: 0, // bool
  name: 1, // char[64]
  worldPosition: 68, // float[3] X,Y,Z
  currentLapDistance: 80, // float (metres)
  racePosition: 84, // uint
  lapsCompleted: 88, // uint
  currentLap: 92, // uint
  currentSector: 96, // int
} as const;

/**
 * Top-level SharedMemory field offsets used by the coach.
 * mParticipantInfo occupies 28 .. 28 + 64*100 = 6428, hence the jump after it.
 */
export const OFF = {
  version: 0, // uint  mVersion
  buildVersionNumber: 4, // uint
  gameState: 8, // uint  mGameState (2 = ingame playing)
  sessionState: 12, // uint
  raceState: 16, // uint
  viewedParticipantIndex: 20, // int   mViewedParticipantIndex
  numParticipants: 24, // int
  participantInfo: 28, // ParticipantInfo[64], stride 100

  carName: 6444, // char[64]  mCarName
  carClassName: 6508, // char[64]  mCarClassName
  trackLocation: 6576, // char[64]  mTrackLocation
  trackVariation: 6640, // char[64]  mTrackVariation
  trackLength: 6704, // float     mTrackLength (metres)

  lapInvalidated: 6712, // bool   mLapInvalidated (current lap)
  lastLapTime: 6720, // float  mLastLapTime (seconds)
  currentSector1Time: 6752, // float mCurrentSector1Time
  currentSector2Time: 6756, // float mCurrentSector2Time
  currentSector3Time: 6760, // float mCurrentSector3Time

  carFlags: 6816, // uint   mCarFlags
  speed: 6848, // float  mSpeed (m/s)
  rpm: 6852, // float  mRpm
  brake: 6860, // float  mBrake (0..1)
  throttle: 6864, // float  mThrottle (0..1)
  steering: 6872, // float  mSteering (-1..1)
  gear: 6876, // int    mGear
  antiLockActive: 6888, // bool   mAntiLockActive

  tyreTemp: 7072, // float[4]  mTyreTemp (Celsius)
  brakeTempCelsius: 7184, // float[4]  mBrakeTempCelsius (Celsius)

  sequenceNumber: 7320, // uint   mSequenceNumber (odd = write in progress)
} as const;

export const participantOffset = (index: number, fieldOffset: number): number =>
  OFF.participantInfo + index * PARTICIPANT_SIZE + fieldOffset;

// ── Read helpers (offset-based, mirror ace-struct.ts) ──
export const readInt32 = (buf: Buffer, offset: number): number =>
  buf.readInt32LE(offset);

export const readUint32 = (buf: Buffer, offset: number): number =>
  buf.readUInt32LE(offset);

export const readFloat = (buf: Buffer, offset: number): number =>
  buf.readFloatLE(offset);

export const readUint8 = (buf: Buffer, offset: number): number =>
  buf.readUInt8(offset);

/** Read a null-terminated ASCII string from a fixed-size char[n] field. */
export const readString = (
  buf: Buffer,
  offset: number,
  maxLen: number,
): string => {
  const end = buf.indexOf(0, offset);
  const actualEnd = end === -1 || end > offset + maxLen ? offset + maxLen : end;
  return buf.toString("ascii", offset, actualEnd).replace(/\0/g, "").trim();
};

/** Read float[count] into a number[]. */
export const readFloatArray = (
  buf: Buffer,
  offset: number,
  count: number,
): number[] => {
  const result: number[] = [];
  for (let i = 0; i < count; i++) result.push(buf.readFloatLE(offset + i * 4));
  return result;
};
