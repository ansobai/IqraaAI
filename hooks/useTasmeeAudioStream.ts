import { Audio } from "expo-av";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { useEffect, useRef, useState } from "react";

export type TasmeeAudioChunk = {
  seq: number;
  audioBase64: string;
  mimeType: string;
  durationMs: number;
  levelDb: number | null;
  hasSpeech: boolean | null;
  timestampMs: number;
};

export type TasmeeSpeechActivity = {
  seq: number;
  hasSpeech: boolean | null;
  levelDb: number | null;
  timestampMs: number;
};

type UseTasmeeAudioStreamArgs = {
  enabled: boolean;
  sessionId: string | null;
  onChunk: (chunk: TasmeeAudioChunk) => Promise<void> | void;
  onSpeechActivity?: (activity: TasmeeSpeechActivity) => void;
  onError?: (error: Error) => void;
  chunkDurationMs?: number;
  speechLevelDbThreshold?: number;
};

const DEFAULT_CHUNK_DURATION_MS = 1000;
const DEFAULT_SPEECH_LEVEL_DB_THRESHOLD = -48;

const logTasmeeAudio = (...args: unknown[]) => {
  console.log("[tasmee-audio]", ...args);
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const readMeteringValue = async (recording: Audio.Recording) => {
  try {
    const status = await recording.getStatusAsync();
    if (!("metering" in status)) return null;
    return typeof status.metering === "number" ? status.metering : null;
  } catch {
    return null;
  }
};

export const useTasmeeAudioStream = ({
  enabled,
  sessionId,
  onChunk,
  onSpeechActivity,
  onError,
  chunkDurationMs = DEFAULT_CHUNK_DURATION_MS,
  speechLevelDbThreshold = DEFAULT_SPEECH_LEVEL_DB_THRESHOLD,
}: UseTasmeeAudioStreamArgs) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastLevelDb, setLastLevelDb] = useState<number | null>(null);

  const onChunkRef = useRef(onChunk);
  const onSpeechActivityRef = useRef(onSpeechActivity);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onChunkRef.current = onChunk;
  }, [onChunk]);

  useEffect(() => {
    onSpeechActivityRef.current = onSpeechActivity;
  }, [onSpeechActivity]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      setIsStreaming(false);
      return;
    }

    let cancelled = false;
    let sequence = 0;
    let activeRecording: Audio.Recording | null = null;

    const safeStopRecording = async () => {
      if (!activeRecording) return;
      try {
        await activeRecording.stopAndUnloadAsync();
      } catch {
        // Ignore stop/unload errors during shutdown.
      }
      activeRecording = null;
    };

    const run = async () => {
      const permission = await Audio.requestPermissionsAsync();
      logTasmeeAudio("mic permission", permission);
      if (!permission.granted) {
        throw new Error("Microphone permission is required for tasmee.");
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      logTasmeeAudio("audio mode configured", {
        chunkDurationMs,
        speechLevelDbThreshold,
      });

      if (!cancelled) {
        setIsStreaming(true);
      }

      while (!cancelled) {
        sequence += 1;
        const startedAtMs = Date.now();
        const recording = new Audio.Recording();
        activeRecording = recording;
        let peakLevelDb: number | null = null;

        await recording.prepareToRecordAsync({
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        } as Audio.RecordingOptions);
        recording.setProgressUpdateInterval(120);
        recording.setOnRecordingStatusUpdate((status) => {
          if (typeof status.metering !== "number") return;
          if (peakLevelDb == null || status.metering > peakLevelDb) {
            peakLevelDb = status.metering;
          }
        });
        await recording.startAsync();
        const chunkEndsAt = Date.now() + chunkDurationMs;
        while (!cancelled && Date.now() < chunkEndsAt) {
          const remainingMs = chunkEndsAt - Date.now();
          await delay(Math.max(20, Math.min(120, remainingMs)));
          const polledLevelDb = await readMeteringValue(recording);
          if (
            polledLevelDb != null &&
            (peakLevelDb == null || polledLevelDb > peakLevelDb)
          ) {
            peakLevelDb = polledLevelDb;
          }
        }

        if (cancelled) {
          await safeStopRecording();
          break;
        }

        await recording.stopAndUnloadAsync();
        activeRecording = null;
        const fallbackLevelDb = await readMeteringValue(recording);
        const levelDb = peakLevelDb ?? fallbackLevelDb;
        setLastLevelDb(levelDb);

        const timestampMs = Date.now();
        const hasSpeech =
          levelDb != null ? levelDb >= speechLevelDbThreshold : null;
        logTasmeeAudio("chunk metering", {
          seq: sequence,
          levelDb,
          hasSpeech,
        });

        if (onSpeechActivityRef.current) {
          onSpeechActivityRef.current({
            seq: sequence,
            hasSpeech,
            levelDb,
            timestampMs,
          });
        }

        const uri = recording.getURI();
        if (!uri) {
          continue;
        }

        const audioBase64 = await LegacyFileSystem.readAsStringAsync(uri, {
          encoding: LegacyFileSystem.EncodingType.Base64,
        });

        if (audioBase64.length > 0) {
          await onChunkRef.current({
            seq: sequence,
            audioBase64,
            mimeType: "audio/mp4",
            durationMs: Math.max(chunkDurationMs, timestampMs - startedAtMs),
            levelDb,
            hasSpeech,
            timestampMs,
          });
        }

        await LegacyFileSystem.deleteAsync(uri, { idempotent: true }).catch(
          () => {},
        );
      }
    };

    run()
      .catch((error) => {
        if (cancelled) return;
        if (onErrorRef.current) {
          onErrorRef.current(
            error instanceof Error
              ? error
              : new Error("Failed to stream tasmee audio chunks."),
          );
        }
      })
      .finally(() => {
        setIsStreaming(false);
      });

    return () => {
      cancelled = true;
      setIsStreaming(false);
      void safeStopRecording();
    };
  }, [chunkDurationMs, enabled, sessionId, speechLevelDbThreshold]);

  return {
    isStreaming,
    lastLevelDb,
  };
};
