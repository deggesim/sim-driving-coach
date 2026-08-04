// Self-check: the voice command regexes used to live inline in main.ts with no
// test at all. They decide which simulator a spoken "apri sessione" starts, so a
// silent regression opens the wrong game.
import assert from "node:assert/strict";
import {
  classifyVoiceIntent,
  matchGame,
  GREETINGS,
  nextGreeting,
} from "./voice-intent.js";

const NAME = "Robert";

// ── Game matching: every spoken form from the spec ─────────────────────────────
assert.equal(matchGame("raceroom"), "r3e");
assert.equal(matchGame("Raceroom Racing Experience"), "r3e");
assert.equal(matchGame("r3e"), "r3e");
assert.equal(matchGame("R.3.E."), "r3e");
assert.equal(matchGame("r 3 e"), "r3e");
assert.equal(matchGame("rre"), "r3e");
assert.equal(matchGame("assetto corsa evo"), "ace");
assert.equal(matchGame("ac evo"), "ace");
assert.equal(matchGame("ace"), "ace");
assert.equal(matchGame("evo"), "ace");
assert.equal(matchGame("automobilista due"), "ams2");
assert.equal(matchGame("automobilista 2"), "ams2");
assert.equal(matchGame("ams2"), "ams2");
assert.equal(matchGame("ams 2"), "ams2");
// No game named, or two different ones: caller must ask instead of guessing
assert.equal(matchGame("apri una sessione"), null);
assert.equal(matchGame("apri sessione su raceroom o evo"), null);
// Long-form patterns need trailing word boundaries too, or they grab a prefix
// of a longer word/number instead of the whole spoken form
assert.equal(matchGame("che bella la terrace room"), null);
assert.equal(matchGame("automobilista duecento euro"), null);
assert.equal(matchGame("conosco un automobilista, 25enne, bravo pilota"), null);

// ── newSession carries the game ───────────────────────────────────────────────
assert.deepEqual(classifyVoiceIntent("apri una sessione su ACE", NAME), {
  kind: "newSession",
  game: "ace",
});
assert.deepEqual(
  classifyVoiceIntent("nuova sessione automobilista due", NAME),
  {
    kind: "newSession",
    game: "ams2",
  },
);
assert.deepEqual(classifyVoiceIntent("apri una sessione", NAME), {
  kind: "newSession",
  game: null,
});

// ── Existing intents must not regress ─────────────────────────────────────────
assert.deepEqual(classifyVoiceIntent("chiudi la sessione", NAME), {
  kind: "closeSession",
});
assert.deepEqual(classifyVoiceIntent("analizza la sessione", NAME), {
  kind: "analyze",
});
assert.deepEqual(classifyVoiceIntent("analizza gli ultimi giri", NAME), {
  kind: "analyze",
});

// ── Wake word ─────────────────────────────────────────────────────────────────
assert.deepEqual(classifyVoiceIntent("Ciao Robert", NAME), {
  kind: "greeting",
});
assert.deepEqual(classifyVoiceIntent("Robert", NAME), { kind: "greeting" });
assert.deepEqual(classifyVoiceIntent("Ehi Robert, ok", NAME), {
  kind: "greeting",
});
// Name + question in one breath: no wasted turn, prefix stripped
assert.deepEqual(
  classifyVoiceIntent(
    "Ciao Robert, a quanti metri devo frenare in curva 1?",
    NAME,
  ),
  { kind: "freeform", question: "a quanti metri devo frenare in curva 1?" },
);
// Name + command in one breath
assert.deepEqual(
  classifyVoiceIntent("Ciao Robert, apri sessione su rre", NAME),
  {
    kind: "newSession",
    game: "r3e",
  },
);
// A trailing name is part of the question, not a wake prefix
assert.deepEqual(classifyVoiceIntent("dimmi tutto Robert", NAME), {
  kind: "freeform",
  question: "dimmi tutto Robert",
});
// A game name inside a question must not turn it into a session command
assert.deepEqual(classifyVoiceIntent("come vado con la evo?", NAME), {
  kind: "freeform",
  question: "come vado con la evo?",
});
// Another configured name must work, and the default one too
assert.deepEqual(classifyVoiceIntent("Ciao Aria", "Aria"), {
  kind: "greeting",
});
// Empty configured name must never turn a question into a greeting
assert.deepEqual(classifyVoiceIntent("come vado?", ""), {
  kind: "freeform",
  question: "come vado?",
});
// A multi-word name is spoken by its first word only: wake detection and
// prefix stripping must agree on that same token
assert.deepEqual(classifyVoiceIntent("Ciao Jarvis", "Jarvis Prime"), {
  kind: "greeting",
});

// ── Freeform is the default, and keeps the original text ──────────────────────
assert.deepEqual(classifyVoiceIntent("Quanto perdo in curva 3?", NAME), {
  kind: "freeform",
  question: "Quanto perdo in curva 3?",
});

// ── Empty/whitespace transcript is a deliberate no-op, not a crash ────────────
// (the production caller already filters this out before reaching here, but
// the module must still answer deterministically for any future caller)
assert.deepEqual(classifyVoiceIntent("", NAME), {
  kind: "freeform",
  question: "",
});
assert.deepEqual(classifyVoiceIntent("   ", NAME), {
  kind: "freeform",
  question: "",
});

// ── Greeting rotation is deterministic ────────────────────────────────────────
assert.equal(GREETINGS.length, 10);
assert.equal(nextGreeting(0), GREETINGS[0]);
assert.equal(nextGreeting(3), GREETINGS[3]);
assert.equal(nextGreeting(10), GREETINGS[0]);
assert.equal(nextGreeting(13), GREETINGS[3]);

console.log("voice-intent.selfcheck OK");
