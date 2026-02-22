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
  chunkStartedAtMs: number;
  chunkEndedAtMs: number;
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
  enableAutoCalibration?: boolean;
  calibrationDurationMs?: number;
  calibrationMarginDb?: number;
  calibrationMinThresholdDb?: number;
  calibrationMaxThresholdDb?: number;
};

const DEFAULT_CHUNK_DURATION_MS = 1000;
const DEFAULT_SPEECH_LEVEL_DB_THRESHOLD = -48;
const DEFAULT_CALIBRATION_DURATION_MS = 1200;
const DEFAULT_CALIBRATION_MARGIN_DB = 12;
const DEFAULT_CALIBRATION_MIN_THRESHOLD_DB = -60;
const DEFAULT_CALIBRATION_MAX_THRESHOLD_DB = -20;

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

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, p));
  const index = Math.floor((sorted.length - 1) * clamped);
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const useTasmeeAudioStream = ({
  enabled,
  sessionId,
  onChunk,
  onSpeechActivity,
  onError,
  chunkDurationMs = DEFAULT_CHUNK_DURATION_MS,
  speechLevelDbThreshold = DEFAULT_SPEECH_LEVEL_DB_THRESHOLD,
  enableAutoCalibration = true,
  calibrationDurationMs = DEFAULT_CALIBRATION_DURATION_MS,
  calibrationMarginDb = DEFAULT_CALIBRATION_MARGIN_DB,
  calibrationMinThresholdDb = DEFAULT_CALIBRATION_MIN_THRESHOLD_DB,
  calibrationMaxThresholdDb = DEFAULT_CALIBRATION_MAX_THRESHOLD_DB,
}: UseTasmeeAudioStreamArgs) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastLevelDb, setLastLevelDb] = useState<number | null>(null);
  const [noiseFloorDb, setNoiseFloorDb] = useState<number | null>(null);
  const [effectiveSpeechLevelDbThreshold, setEffectiveSpeechLevelDbThreshold] =
    useState(speechLevelDbThreshold);
  const effectiveThresholdRef = useRef(speechLevelDbThreshold);

  const onChunkRef = useRef(onChunk);
  const onSpeechActivityRef = useRef(onSpeechActivity);
  const onErrorRef = useRef(onError);

  const calibrationStartedAtRef = useRef<number | null>(null);
  const calibrationSamplesRef = useRef<number[]>([]);
  const calibrationDoneRef = useRef(false);

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
    setEffectiveSpeechLevelDbThreshold(speechLevelDbThreshold);
    effectiveThresholdRef.current = speechLevelDbThreshold;
  }, [speechLevelDbThreshold]);

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

      const startedAtMs = Date.now();
      calibrationStartedAtRef.current = startedAtMs;
      calibrationSamplesRef.current = [];
      calibrationDoneRef.current = false;
      setNoiseFloorDb(null);
      setEffectiveSpeechLevelDbThreshold(speechLevelDbThreshold);
      effectiveThresholdRef.current = speechLevelDbThreshold;

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
        const chunkStartedAtMs = Date.now();
        const recording = new Audio.Recording();
        activeRecording = recording;
        let peakLevelDb: number | null = null;
        const meteringSamples: number[] = [];

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
          meteringSamples.push(status.metering);
          if (meteringSamples.length > 240) {
            meteringSamples.shift();
          }

          if (
            enableAutoCalibration &&
            !calibrationDoneRef.current &&
            calibrationStartedAtRef.current != null &&
            Date.now() - calibrationStartedAtRef.current <= calibrationDurationMs
          ) {
            calibrationSamplesRef.current.push(status.metering);
            if (calibrationSamplesRef.current.length > 500) {
              calibrationSamplesRef.current.shift();
            }
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
          if (polledLevelDb != null) {
            meteringSamples.push(polledLevelDb);
            if (meteringSamples.length > 240) {
              meteringSamples.shift();
            }
            if (
              enableAutoCalibration &&
              !calibrationDoneRef.current &&
              calibrationStartedAtRef.current != null &&
              Date.now() - calibrationStartedAtRef.current <= calibrationDurationMs
            ) {
              calibrationSamplesRef.current.push(polledLevelDb);
              if (calibrationSamplesRef.current.length > 500) {
                calibrationSamplesRef.current.shift();
              }
            }
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

        if (
          enableAutoCalibration &&
          !calibrationDoneRef.current &&
          calibrationStartedAtRef.current != null &&
          timestampMs - calibrationStartedAtRef.current > calibrationDurationMs
        ) {
          const noiseCandidate = percentile(calibrationSamplesRef.current, 0.2);
          if (noiseCandidate != null) {
            const nextThreshold = clamp(
              noiseCandidate + calibrationMarginDb,
              calibrationMinThresholdDb,
              calibrationMaxThresholdDb,
            );
            calibrationDoneRef.current = true;
            setNoiseFloorDb(noiseCandidate);
            setEffectiveSpeechLevelDbThreshold(nextThreshold);
            effectiveThresholdRef.current = nextThreshold;
            logTasmeeAudio("calibrated threshold", {
              noiseFloorDb: noiseCandidate,
              thresholdDb: nextThreshold,
              sampleCount: calibrationSamplesRef.current.length,
            });
          } else {
            calibrationDoneRef.current = true;
          }
        }

        const thresholdDb = enableAutoCalibration
          ? effectiveThresholdRef.current
          : speechLevelDbThreshold;
        const hasSpeech =
          levelDb != null ? levelDb >= thresholdDb : null;
        logTasmeeAudio("chunk metering", {
          seq: sequence,
          levelDb,
          hasSpeech,
          thresholdDb,
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
          const emittedChunk: TasmeeAudioChunk = {
            seq: sequence,
            audioBase64,
            mimeType: "audio/mp4",
            durationMs: Math.max(chunkDurationMs, timestampMs - chunkStartedAtMs),
            levelDb,
            hasSpeech,
            timestampMs,
            chunkStartedAtMs,
            chunkEndedAtMs: timestampMs,
          };
          Promise.resolve(onChunkRef.current(emittedChunk)).catch((error) => {
            if (onErrorRef.current) {
              onErrorRef.current(
                error instanceof Error
                  ? error
                  : new Error("Failed to enqueue tasmee audio chunk."),
              );
            }
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
    noiseFloorDb,
    effectiveSpeechLevelDbThreshold,
  };
};
