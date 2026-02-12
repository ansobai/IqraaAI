import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  TasmeeFeedbackDeltaEvent,
  TasmeeFeedbackState,
  TasmeeSessionCreateResponse,
  TasmeeSessionStatus,
  TasmeeSessionStatusEvent,
  TasmeeTransportMode,
  TasmeeWordState,
} from "../types/tasmee";
import {
  createTasmeeSession,
  openTasmeeSocket,
  resumeTasmeeSession,
  stopTasmeeSession,
  type TasmeeSocketConnection,
  uploadTasmeeChunk,
} from "../utils/tasmeeApi";
import { loadMushafPage, type MushafPageLines } from "../utils/mushafData";
import {
  evaluateFeedbackDeltaGate,
  isSpeechWindowOpen,
} from "../utils/tasmeeFeedbackGate";
import { applyFeedbackDelta, buildTasmeeWordStates } from "../utils/tasmeeState";
import { useTasmeeAudioStream } from "./useTasmeeAudioStream";

type UseTasmeeSessionArgs = {
  pageNumber: number;
  surahId: number;
};

const REVEAL_CONFIDENCE_THRESHOLD = 0.9;
const RECENT_SPEECH_WINDOW_MS = 1200;
const AUDIO_SPEECH_LEVEL_DB_THRESHOLD = -35;
const AUDIO_CHUNK_DURATION_MS = 300;
const MIN_CONSECUTIVE_SPEECH_CHUNKS = 1;
const LOCAL_METERING_STALE_MS = 3000;
const DEBUG_TASMEE = true;

const logTasmee = (...args: unknown[]) => {
  if (!DEBUG_TASMEE) return;
  console.log("[tasmee-debug]", ...args);
};

const countPageWords = (pageData: MushafPageLines | null) => {
  if (!pageData) return 0;
  return pageData.lines.reduce(
    (wordCount, line) =>
      wordCount + line.words.filter((word) => word.charType === "word").length,
    0,
  );
};

const toErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const isChunkEndpointUnsupportedError = (message: string) =>
  /(^|\s)(404|not found)(\s|$)/i.test(message);

export const useTasmeeSession = ({ pageNumber, surahId }: UseTasmeeSessionArgs) => {
  const [status, setStatus] = useState<TasmeeSessionStatus>("idle");
  const [transportMode, setTransportMode] = useState<TasmeeTransportMode | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pageData, setPageData] = useState<MushafPageLines | null>(null);
  const [anchorWordIndex, setAnchorWordIndex] = useState<number | null>(null);
  const [revealedWordIndexes, setRevealedWordIndexes] = useState<number[]>([]);
  const [feedbackState, setFeedbackState] =
    useState<TasmeeFeedbackState>("listening");
  const [lastAcceptedAtMs, setLastAcceptedAtMs] = useState<number | null>(null);
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);

  const socketRef = useRef<TasmeeSocketConnection | null>(null);
  const statusRef = useRef<TasmeeSessionStatus>("idle");
  const transportModeRef = useRef<TasmeeTransportMode | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const sessionInfoRef = useRef<TasmeeSessionCreateResponse | null>(null);
  const anchorWordIndexRef = useRef<number | null>(null);
  const revealedWordIndexesRef = useRef<number[]>([]);
  const activePageNumberRef = useRef<number>(pageNumber);
  const totalWordCountRef = useRef<number>(0);
  const feedbackStateRef = useRef<TasmeeFeedbackState>("listening");
  const lastServerSeqAckRef = useRef<number>(-1);
  const lastSpeechDetectedAtRef = useRef<number | null>(null);
  const localSpeechStreakRef = useRef<number>(0);
  const lastLocalMeteringAtRef = useRef<number | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    transportModeRef.current = transportMode;
  }, [transportMode]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    anchorWordIndexRef.current = anchorWordIndex;
  }, [anchorWordIndex]);

  useEffect(() => {
    revealedWordIndexesRef.current = revealedWordIndexes;
  }, [revealedWordIndexes]);

  useEffect(() => {
    feedbackStateRef.current = feedbackState;
  }, [feedbackState]);

  const updateSpeechWindowState = useCallback(() => {
    const detected = isSpeechWindowOpen(
      lastSpeechDetectedAtRef.current,
      Date.now(),
      RECENT_SPEECH_WINDOW_MS,
    );
    setIsSpeechDetected((current) => (current === detected ? current : detected));
    return detected;
  }, []);

  const clearTransport = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    sessionInfoRef.current = null;
  }, []);

  const resetProgress = useCallback(() => {
    anchorWordIndexRef.current = null;
    revealedWordIndexesRef.current = [];
    lastServerSeqAckRef.current = -1;
    lastSpeechDetectedAtRef.current = null;
    localSpeechStreakRef.current = 0;
    lastLocalMeteringAtRef.current = null;

    setAnchorWordIndex(null);
    setRevealedWordIndexes([]);
    setFeedbackState("listening");
    setLastAcceptedAtMs(null);
    setIsSpeechDetected(false);
  }, []);

  const markSpeechDetected = useCallback((timestampMs: number) => {
    lastSpeechDetectedAtRef.current = timestampMs;
    setIsSpeechDetected(true);
  }, []);

  const applyLocalSpeechActivity = useCallback(
    (hasSpeech: boolean | null, timestampMs: number) => {
      if (hasSpeech == null) {
        return;
      }
      if (!hasSpeech) {
        localSpeechStreakRef.current = 0;
        return;
      }

      localSpeechStreakRef.current += 1;
      if (localSpeechStreakRef.current < MIN_CONSECUTIVE_SPEECH_CHUNKS) {
        return;
      }

      markSpeechDetected(timestampMs);
    },
    [markSpeechDetected],
  );

  const applyStatusEvent = useCallback(
    (event: TasmeeSessionStatusEvent) => {
      if (
        statusRef.current === "idle" ||
        statusRef.current === "stopped" ||
        statusRef.current === "error"
      ) {
        return;
      }
      logTasmee("ws status", event);
      if (event.seq_ack != null && Number.isFinite(event.seq_ack)) {
        if (event.seq_ack < lastServerSeqAckRef.current) {
          logTasmee("drop status out-of-order", {
            seqAck: event.seq_ack,
            lastSeqAck: lastServerSeqAckRef.current,
          });
          return;
        }
        lastServerSeqAckRef.current = Math.max(
          lastServerSeqAckRef.current,
          event.seq_ack,
        );
      }
      const nowMs = Date.now();
      const shouldUseServerSpeechFallback =
        lastLocalMeteringAtRef.current == null ||
        nowMs - lastLocalMeteringAtRef.current > LOCAL_METERING_STALE_MS;
      if (shouldUseServerSpeechFallback && event.has_speech) {
        markSpeechDetected(nowMs);
      }

      const localSpeechOpen = updateSpeechWindowState();
      const nextFeedbackState =
        !localSpeechOpen && event.state === "reciting" ? "silent" : event.state;

      if (nextFeedbackState === "paused") {
        lastSpeechDetectedAtRef.current = null;
        localSpeechStreakRef.current = 0;
        setIsSpeechDetected(false);
      }

      setFeedbackState(nextFeedbackState);
      if (nextFeedbackState === "paused") {
        setStatus("paused");
      } else if (
        nextFeedbackState === "reciting" ||
        nextFeedbackState === "processing"
      ) {
        setStatus("active");
      } else {
        setStatus("listening");
      }
    },
    [markSpeechDetected, updateSpeechWindowState],
  );

  const applyDeltaEvent = useCallback(
    (event: TasmeeFeedbackDeltaEvent) => {
      if (
        statusRef.current === "idle" ||
        statusRef.current === "stopped" ||
        statusRef.current === "error"
      ) {
        return;
      }

      const nowMs = Date.now();
      const isOutOfOrderDelta =
        event.seq_ack != null &&
        Number.isFinite(event.seq_ack) &&
        event.seq_ack < lastServerSeqAckRef.current;
      const shouldUseServerSpeechFallback =
        lastLocalMeteringAtRef.current == null ||
        nowMs - lastLocalMeteringAtRef.current > LOCAL_METERING_STALE_MS;
      if (
        shouldUseServerSpeechFallback &&
        event.has_speech === true &&
        !isOutOfOrderDelta
      ) {
        markSpeechDetected(nowMs);
      }
      updateSpeechWindowState();

      const gate = evaluateFeedbackDeltaGate({
        event,
        lastSeqAck: lastServerSeqAckRef.current,
        lastSpeechDetectedAtMs: lastSpeechDetectedAtRef.current,
        nowMs,
        speechWindowMs: RECENT_SPEECH_WINDOW_MS,
        confidenceThreshold: REVEAL_CONFIDENCE_THRESHOLD,
      });
      logTasmee("ws delta + gate", {
        delta: event,
        gate,
        lastSpeechDetectedAtMs: lastSpeechDetectedAtRef.current,
      });

      lastServerSeqAckRef.current = gate.nextSeqAck;
      if (!gate.shouldApply) {
        logTasmee("delta blocked", {
          feedbackState: gate.feedbackState,
          seqAck: event.seq_ack ?? null,
          hasSpeech: event.has_speech ?? null,
          confidence: event.confidence ?? event.start_anchor_confidence ?? null,
          lastSpeechDetectedAtMs: lastSpeechDetectedAtRef.current,
          nowMs,
        });
        setFeedbackState(gate.feedbackState);
        if (gate.feedbackState === "silent") {
          setStatus("listening");
        }
        return;
      }

      const previousAnchorWordIndex = anchorWordIndexRef.current;
      const previousRevealedCount = revealedWordIndexesRef.current.length;
      const next = applyFeedbackDelta(
        {
          anchorWordIndex: anchorWordIndexRef.current,
          revealedWordIndexes: revealedWordIndexesRef.current,
        },
        event,
        totalWordCountRef.current,
        REVEAL_CONFIDENCE_THRESHOLD,
      );

      if (next.anchorWordIndex !== anchorWordIndexRef.current) {
        anchorWordIndexRef.current = next.anchorWordIndex;
        setAnchorWordIndex(next.anchorWordIndex);
      }

      if (next.revealedWordIndexes !== revealedWordIndexesRef.current) {
        revealedWordIndexesRef.current = next.revealedWordIndexes;
        setRevealedWordIndexes(next.revealedWordIndexes);
      }
      logTasmee("delta applied progress", {
        seqAck: event.seq_ack ?? null,
        chunkSeq: event.chunk_seq ?? null,
        anchorBefore: previousAnchorWordIndex,
        anchorAfter: next.anchorWordIndex,
        revealedBefore: previousRevealedCount,
        revealedAfter: next.revealedWordIndexes.length,
        confirmedFromDelta: event.confirmed_word_indexes?.length ?? 0,
      });

      setFeedbackState(gate.feedbackState);
      setLastAcceptedAtMs(nowMs);
      setStatus(next.anchorWordIndex == null ? "listening" : "active");
    },
    [markSpeechDetected, updateSpeechWindowState],
  );

  const uploadAudioChunk = useCallback(
    async (payload: {
      seq: number;
      audioBase64: string;
      mimeType: string;
      durationMs: number;
      levelDb: number | null;
      hasSpeech: boolean | null;
      timestampMs: number;
    }) => {
      const currentSessionId = sessionIdRef.current;
      if (!currentSessionId) return;

      try {
        logTasmee("upload chunk", {
          seq: payload.seq,
          levelDb: payload.levelDb,
          hasSpeech: payload.hasSpeech,
          durationMs: payload.durationMs,
        });
        const response = await uploadTasmeeChunk(
          currentSessionId,
          {
            seq: payload.seq,
            audio_base64: payload.audioBase64,
            mime_type: payload.mimeType,
            duration_ms: payload.durationMs,
            level_db: payload.levelDb ?? undefined,
            has_speech: payload.hasSpeech ?? undefined,
          },
          sessionInfoRef.current,
        );

        if (response.seq_ack < lastServerSeqAckRef.current) {
          logTasmee("drop upload ack out-of-order", {
            ack: response.seq_ack,
            lastSeqAck: lastServerSeqAckRef.current,
          });
          return;
        }
        lastServerSeqAckRef.current = response.seq_ack;
        logTasmee("upload ack", response);
      } catch (error) {
        if (statusRef.current === "idle" || statusRef.current === "stopped") {
          return;
        }
        logTasmee("upload chunk error", error);
        const message = toErrorMessage(error, "Failed to upload tasmee audio chunk.");
        if (isChunkEndpointUnsupportedError(message)) {
          clearTransport();
          statusRef.current = "error";
          transportModeRef.current = null;
          setTransportMode(null);
          setSessionId(null);
          setStatus("error");
          setErrorMessage(
            "Tasmee service is outdated (missing /chunks). Deploy the latest tasmee backend.",
          );
          return;
        }
        setStatus("error");
        setErrorMessage(message);
      }
    },
    [clearTransport],
  );

  const startSession = useCallback(async () => {
    if (statusRef.current === "starting") return;
    if (
      statusRef.current === "listening" ||
      statusRef.current === "active" ||
      statusRef.current === "paused"
    ) {
      return;
    }

    setStatus("starting");
    setErrorMessage(null);
    clearTransport();
    resetProgress();
    activePageNumberRef.current = pageNumber;

    let effectivePageData = pageData;
    if (!effectivePageData) {
      effectivePageData = await loadMushafPage(pageNumber);
      setPageData(effectivePageData);
    }

    totalWordCountRef.current = countPageWords(effectivePageData);
    if (totalWordCountRef.current <= 0) {
      setStatus("error");
      setErrorMessage("Current page has no line words for tasmee.");
      return;
    }

    try {
      logTasmee("start session", { pageNumber, surahId });
      const remoteSession = await createTasmeeSession({
        page_number: pageNumber,
        surah_id: surahId,
      });
      logTasmee("session created", remoteSession);

      sessionInfoRef.current = remoteSession;
      setSessionId(remoteSession.session_id);
      setTransportMode("websocket");
      setStatus("listening");
      setFeedbackState("listening");

      socketRef.current = openTasmeeSocket(remoteSession, {
        onDelta: applyDeltaEvent,
        onStatus: applyStatusEvent,
        onClose: () => {
          if (
            statusRef.current === "idle" ||
            statusRef.current === "stopped" ||
            statusRef.current === "error"
          ) {
            return;
          }
          logTasmee("socket closed unexpectedly");
          setStatus("error");
          setErrorMessage("Tasmee connection closed.");
          setTransportMode(null);
        },
        onError: (error) => {
          if (
            statusRef.current === "idle" ||
            statusRef.current === "stopped" ||
            statusRef.current === "error"
          ) {
            return;
          }
          logTasmee("socket error", error.message);
          setErrorMessage(error.message);
          setStatus("error");
          setTransportMode(null);
        },
      });
      return;
    } catch (error) {
      logTasmee("start session error", error);
      setStatus("error");
      setTransportMode(null);
      setErrorMessage(
        toErrorMessage(error, "Failed to start tasmee session."),
      );
    }
  }, [
    applyDeltaEvent,
    applyStatusEvent,
    clearTransport,
    pageData,
    pageNumber,
    resetProgress,
    surahId,
  ]);

  const stopSession = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    statusRef.current = "idle";
    transportModeRef.current = null;
    sessionIdRef.current = null;

    setStatus("idle");
    setTransportMode(null);
    setSessionId(null);
    setErrorMessage(null);
    resetProgress();
    clearTransport();

    if (currentSessionId) {
      try {
        logTasmee("stop session", { sessionId: currentSessionId });
        await stopTasmeeSession(currentSessionId);
      } catch {
        // Stopping should still reset UI state when network call fails.
      }
    }
  }, [clearTransport, resetProgress]);

  const resumeSession = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) return;
    if (statusRef.current !== "paused" && feedbackStateRef.current !== "paused") {
      return;
    }

    try {
      await resumeTasmeeSession(currentSessionId);
      lastSpeechDetectedAtRef.current = null;
      localSpeechStreakRef.current = 0;
      setIsSpeechDetected(false);
      setFeedbackState("listening");
      setStatus(anchorWordIndexRef.current == null ? "listening" : "active");
      setErrorMessage(null);
    } catch (error) {
      setStatus("error");
      setErrorMessage(toErrorMessage(error, "Failed to resume tasmee session."));
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    loadMushafPage(pageNumber).then((loadedPage) => {
      if (!isMounted) return;
      setPageData(loadedPage);
      totalWordCountRef.current = countPageWords(loadedPage);
    });

    return () => {
      isMounted = false;
    };
  }, [pageNumber]);

  useEffect(() => {
    if (
      (statusRef.current === "listening" ||
        statusRef.current === "active" ||
        statusRef.current === "paused") &&
      activePageNumberRef.current !== pageNumber
    ) {
      void stopSession();
    }
  }, [pageNumber, stopSession]);

  useEffect(
    () => () => {
      clearTransport();
    },
    [clearTransport],
  );

  const isRunning =
    status === "starting" ||
    status === "listening" ||
    status === "active" ||
    status === "paused";
  const isCapturingAudio =
    status === "starting" || status === "listening" || status === "active";

  useEffect(() => {
    if (!isRunning) {
      setIsSpeechDetected(false);
      return;
    }

    const interval = setInterval(() => {
      const detected = updateSpeechWindowState();
      if (!detected && feedbackStateRef.current === "reciting") {
        logTasmee("speech window expired -> silent", {
          lastSpeechDetectedAtMs: lastSpeechDetectedAtRef.current,
          nowMs: Date.now(),
        });
        setFeedbackState("silent");
      }
    }, 250);

    return () => {
      clearInterval(interval);
    };
  }, [isRunning, updateSpeechWindowState]);

  useTasmeeAudioStream({
    enabled: isCapturingAudio && sessionId != null,
    sessionId,
    onChunk: uploadAudioChunk,
    onSpeechActivity: (activity) => {
      logTasmee("local speech activity", activity);
      if (activity.levelDb != null) {
        lastLocalMeteringAtRef.current = activity.timestampMs;
      }
      applyLocalSpeechActivity(activity.hasSpeech, activity.timestampMs);
    },
    onError: (error) => {
      if (
        statusRef.current === "idle" ||
        statusRef.current === "stopped" ||
        statusRef.current === "error"
      ) {
        return;
      }
      setStatus("error");
      setErrorMessage(error.message);
    },
    chunkDurationMs: AUDIO_CHUNK_DURATION_MS,
    speechLevelDbThreshold: AUDIO_SPEECH_LEVEL_DB_THRESHOLD,
  });

  const totalWordCount = useMemo(() => countPageWords(pageData), [pageData]);
  const wordStates: TasmeeWordState[] = useMemo(
    () =>
      buildTasmeeWordStates(totalWordCount, anchorWordIndex, revealedWordIndexes),
    [anchorWordIndex, revealedWordIndexes, totalWordCount],
  );

  const isLocked = anchorWordIndex != null;
  const isPaused = status === "paused" || feedbackState === "paused";
  const isListeningForStart = isRunning && !isPaused && anchorWordIndex == null;
  const correctWordCount = revealedWordIndexes.length;

  return {
    status,
    feedbackState,
    transportMode,
    sessionId,
    errorMessage,
    pageData,
    anchorWordIndex,
    revealedWordIndexes,
    wordStates,
    totalWordCount,
    correctWordCount,
    lastAcceptedAtMs,
    isSpeechDetected,
    isRunning,
    isPaused,
    isLocked,
    isListeningForStart,
    startSession,
    resumeSession,
    stopSession,
  };
};
