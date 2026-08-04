/**
 * useVoiceCoach - integrates gamepad trigger, MediaRecorder (audio capture),
 * Azure STT via IPC, voice query IPC, and Azure/Web Speech TTS playback.
 *
 * Flow:
 *   gamepad button press
 *     → getUserMedia + MediaRecorder (up to MAX_RECORD_MS)
 *     → audio ArrayBuffer → IPC stt:transcribe (Azure STT)
 *     → transcript → IPC coach:voiceQuery
 *     → streaming tokens via coach:voiceChunk
 *     → coach:voiceDone (full answer)
 *     → coach:voiceAudio (MP3 buffer, if Azure TTS enabled)
 *
 * Replaces Web Speech API which fails in Electron with a "network" error
 * because Chrome's embedded speech API key is not usable outside Chrome.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { convertToWav, pickMimeType } from "../lib/audio";
import { preprocessTTSText } from "../../shared/format";

export type VoiceCoachState = "idle" | "listening" | "processing" | "speaking";

type UseVoiceCoachOptions = {
  triggerButtonIndex: number | null;
  enabled: boolean;
  azureTtsEnabled: boolean;
};

type UseVoiceCoachResult = {
  state: VoiceCoachState;
  transcript: string;
  answer: string;
  triggerListening: () => void;
};

/** Convert an IPC-transferred value (Buffer serialized as plain object) to ArrayBuffer. */
const toArrayBuffer = (data: unknown): ArrayBuffer => {
  if (data instanceof ArrayBuffer) return data;
  const values = Object.values(data as Record<string, number>);
  return new Uint8Array(values).buffer;
};

/** Max recording duration in ms before auto-stopping. */
const MAX_RECORD_MS = 5000;

/**
 * Play a short activation beep (two ascending tones) to signal mic is live.
 * Uses a throw-away AudioContext so it never interferes with TTS playback.
 */
const playActivationSound = (): void => {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    // Two short tones: 660 Hz then 880 Hz
    const tones = [
      { freq: 660, start: 0, duration: 0.08 },
      { freq: 880, start: 0.1, duration: 0.1 },
    ];

    for (const { freq, start, duration } of tones) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.25, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + start + duration,
      );
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration + 0.01);
    }

    // Close context shortly after playback ends
    setTimeout(() => ctx.close(), 400);
  } catch {
    // Non-critical - ignore if AudioContext is unavailable
  }
};

/**
 * Play a short deactivation sound (two descending tones) to signal mic has stopped.
 */
const playDeactivationSound = (): void => {
  try {
    const ctx = new AudioContext();

    const tones = [
      { freq: 880, start: 0, duration: 0.08 },
      { freq: 660, start: 0.1, duration: 0.1 },
    ];

    for (const { freq, start, duration } of tones) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.25, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + start + duration,
      );
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration + 0.01);
    }

    setTimeout(() => ctx.close(), 400);
  } catch {
    // Non-critical - ignore if AudioContext is unavailable
  }
};

export const useVoiceCoach = ({
  triggerButtonIndex,
  enabled,
  azureTtsEnabled,
}: UseVoiceCoachOptions): UseVoiceCoachResult => {
  const [state, setState] = useState<VoiceCoachState>("idle");
  const stateRef = useRef<VoiceCoachState>("idle");
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const resetToIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setState("idle");
      setTranscript("");
      setAnswer("");
    }, 3000);
  }, []);

  const triggerListening = useCallback(() => {
    if (!enabled || stateRef.current !== "idle") return;

    // Cancel any ongoing TTS
    window.speechSynthesis.cancel();
    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    playActivationSound();
    setState("listening");
    setTranscript("");
    setAnswer("");

    const mimeType = pickMimeType();

    console.log(
      "[VoiceCoach] Requesting microphone, mimeType:",
      mimeType || "(browser default)",
    );

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        console.log(
          "[VoiceCoach] Mic stream acquired, tracks:",
          stream.getAudioTracks().map((t) => t.label),
        );
        streamRef.current = stream;

        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );
        recorderRef.current = recorder;
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (e) => {
          console.log("[VoiceCoach] ondataavailable size:", e.data.size);
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          playDeactivationSound();
          // Release mic
          stream.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          recorderRef.current = null;

          const effectiveMime = mimeType || "audio/webm;codecs=opus";
          const blob = new Blob(chunks, { type: effectiveMime });
          console.log(
            "[VoiceCoach] Recording stopped, blob size:",
            blob.size,
            "mime:",
            effectiveMime,
          );

          if (blob.size === 0) {
            console.warn(
              "[VoiceCoach] Empty recording - mic may be muted or silent",
            );
            setState("idle");
            return;
          }

          convertToWav(blob)
            .then((buf) => {
              console.log(
                "[VoiceCoach] Converted to WAV:",
                buf.byteLength,
                "bytes",
              );
              setState("processing");
              return window.electronAPI.sttTranscribe(buf, "audio/wav");
            })
            .then((text) => {
              if (text.trim()) {
                setTranscript(text);
                return window.electronAPI.voiceQuery(text);
              } else {
                // Nothing recognised - go back to idle
                setState("idle");
              }
            })
            .catch((err: unknown) => {
              console.error("[VoiceCoach] STT error:", err);
              setState("idle");
            });
        };

        recorder.start();
        console.log("[VoiceCoach] Recording started");

        // Auto-stop after MAX_RECORD_MS
        setTimeout(() => {
          if (recorder.state !== "inactive") recorder.stop();
        }, MAX_RECORD_MS);
      })
      .catch((err: unknown) => {
        console.error("[VoiceCoach] Microphone access error:", err);
        setState("idle");
      });
  }, [enabled]);

  // Subscribe to voice coach push channels
  useEffect(() => {
    if (!enabled) return;

    let accum = "";

    const handleChunk = (data: unknown) => {
      const { token } = data as { token: string };
      accum += token;
      setAnswer(accum);
      setState("speaking");
    };

    const handleDone = (data: unknown) => {
      const { answer: fullAnswer } = data as { answer: string };
      accum = fullAnswer;
      setAnswer(fullAnswer);
      setState("speaking");

      // If Azure TTS is NOT enabled, speak via Web Speech API
      if (!azureTtsEnabled) {
        // Azure preprocesses in the main process; the Web Speech fallback must do
        // it here, else numbers and distances are read as raw digit groups.
        const utterance = new SpeechSynthesisUtterance(
          preprocessTTSText(fullAnswer),
        );
        utterance.lang = "it-IT";
        utterance.rate = 0.9;
        const voices = window.speechSynthesis.getVoices();
        const itVoice = voices.find((v) => v.lang.startsWith("it"));
        if (itVoice) utterance.voice = itVoice;
        utterance.onend = resetToIdle;
        utterance.onerror = resetToIdle;
        window.speechSynthesis.speak(utterance);
      }
    };

    const handleAudio = async (data: unknown) => {
      if (!azureTtsEnabled) return;
      const { audio } = data as { audio: unknown };
      const arrayBuffer = toArrayBuffer(audio);

      setState("speaking");
      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start(0);
        source.onended = () => {
          ctx.close();
          audioCtxRef.current = null;
          resetToIdle();
        };
      } catch (err) {
        console.error("[VoiceCoach] Audio playback error:", err);
        resetToIdle();
      }
    };

    const unsubChunk = window.electronAPI.onVoiceChunk(handleChunk);
    const unsubDone = window.electronAPI.onVoiceDone(handleDone);
    const unsubAudio = window.electronAPI.onVoiceAudio((d) => {
      handleAudio(d).catch(console.error);
    });

    return () => {
      unsubChunk();
      unsubDone();
      unsubAudio();
    };
  }, [enabled, azureTtsEnabled, resetToIdle]);

  // Global input trigger from main process - handles keyboard shortcut.
  useEffect(() => {
    if (!enabled) return;
    const unsubInput = window.electronAPI.onInputTrigger(triggerListening);
    return () => {
      unsubInput();
    };
  }, [enabled, triggerListening]);

  // Gamepad trigger - poll navigator.getGamepads() in the renderer.
  // backgroundThrottling:false on the BrowserWindow keeps this running at
  // full rate even when the simulator is in the foreground.
  const prevGamepadRef = useRef<boolean>(false);
  useEffect(() => {
    if (!enabled || triggerButtonIndex === null) return;

    // Seed prevGamepadRef with the current button state so that a button still
    // held from the settings-capture phase does not fire a spurious trigger.
    const snapshot = navigator.getGamepads();
    for (const gp of snapshot) {
      if (!gp) continue;
      prevGamepadRef.current = gp.buttons[triggerButtonIndex]?.pressed ?? false;
      break;
    }

    const id = setInterval(() => {
      const gamepads = navigator.getGamepads();
      for (const gp of gamepads) {
        if (!gp) continue;
        const pressed = gp.buttons[triggerButtonIndex]?.pressed ?? false;
        if (pressed && !prevGamepadRef.current) triggerListening();
        prevGamepadRef.current = pressed;
        break;
      }
    }, 100);
    return () => {
      clearInterval(id);
      prevGamepadRef.current = false;
    };
  }, [enabled, triggerButtonIndex, triggerListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  return { state, transcript, answer, triggerListening };
};
