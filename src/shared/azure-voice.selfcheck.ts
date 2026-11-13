import assert from "node:assert/strict";
import {
  DEFAULT_AZURE_VOICE,
  resolveVoice,
  voiceConfigKey,
} from "./azure-voice.js";

assert.equal(resolveVoice("de", "it-IT-ElsaNeural"), "de-DE-KatjaNeural");
assert.equal(resolveVoice("de", "de-DE-ConradNeural"), "de-DE-ConradNeural");
assert.equal(resolveVoice("en", undefined), "en-GB-SoniaNeural");
assert.equal(resolveVoice("en", ""), DEFAULT_AZURE_VOICE.en);
assert.equal(resolveVoice("it", "it-IT-DiegoNeural"), "it-IT-DiegoNeural");
assert.equal(voiceConfigKey("es"), "azureVoiceName_es");

console.log("azure-voice.selfcheck OK");
