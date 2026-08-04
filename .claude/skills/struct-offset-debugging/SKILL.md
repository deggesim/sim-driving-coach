---
name: struct-offset-debugging
description: Runbook for when a sim reader emits zeros, -1, or garbage — R3E, ACE, or AMS2 shared-memory struct offset mismatches. Covers the version fields to check first (R3E VersionMajor, ACE AC_LIVE, AMS2 mVersion=14), the reference sources to diff offsets against, and the selfcheck loop. Use when reader output looks wrong, after a sim update, or when adding a new SHM field.
---

# Struct Offset Debugging

If the reader logs all zeros or -1 (`npm run dev` with the sim running — there is no standalone reader script): struct offset mismatch. Check:

1. `VersionMajor` at offset 0 must be `3` (updated to v3.x for R3E)
2. If version OK but other fields wrong: `PlayerData` inline size differs from installed R3E version. Compare with `R3E.cs` from SecondMonitor connectors
3. For ACE: verify `AC_LIVE = 2` in PhysicsEvo status field; if 0, ACE is not running
4. For AMS2: the `[AMS2] connected: ...` log line must show `mVersion=14`. If `mVersion` is wrong or speed/lapDistance/car/track are zero or garbage, the offsets in `ams2-struct.ts` (`OFF`/`PART`) don't match the installed AMS2 version — compare against `SharedMemory.h` (likely a `PARTICIPANT_SIZE` or struct-padding change), update the offsets, then re-run `npm run selfcheck`

After any offset change, run `npm run selfcheck` — `ams2-struct.selfcheck.ts` validates the offset arithmetic without needing the sim running.
