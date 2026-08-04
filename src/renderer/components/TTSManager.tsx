/**
 * TTSManager - Headless component that manages TTS output.
 *
 * When azureEnabled: routes through Azure Cognitive Services TTS (MP3 via IPC).
 * When not: uses Web Speech API (SpeechSynthesisUtterance, it-IT).
 *
 * Priority queue: P1 interrupts current speech, P2/P3 are queued.
 * The <sintesi-vocale> extract of a Level-1 analysis arrives through the same
 * one-shot `announce` slot as any other spoken notice (see sessionStore).
 */

import { useEffect, useRef, useCallback } from "react";
import { useIPCStore } from "../store/ipcStore";
import { assistantIntro, preprocessTTSText } from "../../shared/format";

type TTSManagerProps = {
  enabled?: boolean;
  azureEnabled?: boolean;
  assistantName?: string;
  settingsLoaded?: boolean;
};

type QueuedUtterance = {
  text: string;
  priority: 1 | 2 | 3;
};

// Decode an IPC-transferred Buffer/object to ArrayBuffer
const toArrayBuffer = (data: unknown): ArrayBuffer => {
  if (data instanceof ArrayBuffer) return data;
  // Buffer serialized over IPC arrives as a plain object with numeric keys
  const bytes = new Uint8Array(Object.values(data as Record<string, number>));
  return bytes.buffer;
};

const TTSManager = ({
  enabled = true,
  azureEnabled = false,
  assistantName = "Aria",
  settingsLoaded = false,
}: TTSManagerProps) => {
  const queueRef = useRef<QueuedUtterance[]>([]);
  const speakingRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const welcomeSpokenRef = useRef(false);

  // ── Azure TTS path ──────────────────────────────────────────────────────────

  const speakAzure = useCallback(async (text: string, onDone: () => void) => {
    try {
      const raw = await window.electronAPI.ttsSynthesize(text);
      const arrayBuffer = toArrayBuffer(raw);
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
        onDone();
      };
    } catch (err) {
      console.error("[TTSManager] Azure TTS error:", err);
      onDone();
    }
  }, []);

  // ── Web Speech path ─────────────────────────────────────────────────────────

  const speakNext = useCallback(() => {
    if (!enabled || speakingRef.current || queueRef.current.length === 0)
      return;

    const item = queueRef.current.shift()!;
    speakingRef.current = true;

    if (azureEnabled) {
      speakAzure(item.text, () => {
        speakingRef.current = false;
        speakNext();
      });
      return;
    }

    // The Azure path preprocesses in the main process (synthesizeAzure); here the
    // renderer does it, else the it-IT voice reads "55.020" as a thousands group.
    const utterance = new SpeechSynthesisUtterance(
      preprocessTTSText(item.text),
    );
    utterance.lang = "it-IT";
    utterance.rate = 0.9;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const itVoice = voices.find((v) => v.lang.startsWith("it"));
    if (itVoice) utterance.voice = itVoice;

    utterance.onend = () => {
      speakingRef.current = false;
      speakNext();
    };

    utterance.onerror = () => {
      speakingRef.current = false;
      speakNext();
    };

    window.speechSynthesis.speak(utterance);
  }, [enabled, azureEnabled, speakAzure]);

  const stopCurrent = useCallback(() => {
    if (azureEnabled) {
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
    } else {
      window.speechSynthesis.cancel();
    }
    speakingRef.current = false;
  }, [azureEnabled]);

  const enqueue = useCallback(
    (text: string, priority: 1 | 2 | 3) => {
      if (!enabled) return;

      if (priority === 1) {
        stopCurrent();
        queueRef.current = [
          { text, priority },
          ...queueRef.current.filter((q) => q.priority === 1),
        ];
      } else {
        const insertAt = queueRef.current.findIndex(
          (q) => q.priority > priority,
        );
        if (insertAt === -1) {
          queueRef.current.push({ text, priority });
        } else {
          queueRef.current.splice(insertAt, 0, { text, priority });
        }
      }

      speakNext();
    },
    [enabled, stopCurrent, speakNext],
  );

  // One-shot announcements (session-open outcome, Level-1 <sintesi-vocale>).
  // Cleared after enqueue so an identical message can fire again next time.
  const announce = useIPCStore((s) => s.announce);
  const setAnnounce = useIPCStore((s) => s.setAnnounce);
  useEffect(() => {
    if (!announce) return;
    enqueue(announce, 2);
    setAnnounce(null);
  }, [announce, enqueue, setAnnounce]);

  // Welcome message - fires once when settings are loaded from config
  useEffect(() => {
    if (!settingsLoaded) return;
    if (welcomeSpokenRef.current) return;
    welcomeSpokenRef.current = true;

    const welcomeText = assistantIntro(assistantName);

    const speakWelcomeWebSpeech = () => {
      const utterance = new SpeechSynthesisUtterance(welcomeText);
      utterance.lang = "it-IT";
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const itVoice = voices.find((v) => v.lang.startsWith("it"));
      if (itVoice) utterance.voice = itVoice;
      window.speechSynthesis.speak(utterance);
    };

    const speakWelcome = async () => {
      if (azureEnabled) {
        try {
          const raw = await window.electronAPI.ttsSynthesize(welcomeText);
          const arrayBuffer = toArrayBuffer(raw);
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
          };
          return;
        } catch {
          // Fall through to Web Speech
        }
      }
      speakWelcomeWebSpeech();
    };

    if (azureEnabled || window.speechSynthesis.getVoices().length > 0) {
      speakWelcome().catch(console.error);
    } else {
      const timer = setTimeout(() => speakWelcome().catch(console.error), 500);
      return () => clearTimeout(timer);
    }
  }, [settingsLoaded, azureEnabled, assistantName]);

  useEffect(() => {
    window.speechSynthesis.onvoiceschanged = () => {
      /* voices now available - next speak call will pick them up */
    };
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      audioCtxRef.current?.close();
    };
  }, []);

  return null;
};

export default TTSManager;
