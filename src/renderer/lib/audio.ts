/**
 * Audio helpers shared by voice features (voice coach + analysis voice comments).
 * Records via MediaRecorder, converts to WAV PCM 16-bit mono 16 kHz for Azure STT.
 */

/** Pick the best supported MIME type for MediaRecorder. */
export const pickMimeType = (): string => {
  for (const type of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
};

/**
 * Convert any audio Blob (WebM/Opus, Ogg, etc.) to WAV PCM 16-bit mono 16 kHz.
 *
 * Azure STT REST API accepts WebM/Opus in theory but in practice returns
 * Success with an empty transcript. WAV/PCM is the only format the REST
 * endpoint handles reliably without the full Azure Speech SDK.
 */
export const convertToWav = async (blob: Blob): Promise<ArrayBuffer> => {
  const raw = await blob.arrayBuffer();

  // Decode compressed audio into a float32 PCM AudioBuffer
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(raw);
  await decodeCtx.close();

  // Resample + downmix to mono 16 kHz using OfflineAudioContext
  const TARGET_RATE = 16000;
  const numFrames = Math.ceil(decoded.duration * TARGET_RATE);
  const offlineCtx = new OfflineAudioContext(1, numFrames, TARGET_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();

  // Encode as WAV (RIFF PCM 16-bit LE)
  const samples = rendered.getChannelData(0);
  const dataBytes = samples.length * 2; // 16-bit = 2 bytes per sample
  const wav = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(wav);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_RATE, true); // sample rate
  view.setUint32(28, TARGET_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return wav;
};
