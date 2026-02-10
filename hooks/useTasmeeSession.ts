import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  TasmeeFeedbackDeltaEvent,
  TasmeeSessionStatus,
  TasmeeTransportMode,
  TasmeeWordState,
} from "../types/tasmee";
import { createTasmeeSession, openTasmeeSocket, stopTasmeeSession, type TasmeeSocketConnection } from "../utils/tasmeeApi";
import { loadMushafPage, type MushafPageLines } from "../utils/mushafData";
import {
  getTasmeeStartFailurePolicy,
  isDeltaForActiveTasmeeSession,
} from "../utils/tasmeeSessionPolicy";
import { applyFeedbackDelta, buildTasmeeWordStates } from "../utils/tasmeeState";

type UseTasmeeSessionArgs = {
  pageNumber: number;
  surahId: number;
};

const MOCK_ANCHOR_DELAY_MS = 1200;
const MOCK_REVEAL_INTERVAL_MS = 420;
const ANCHOR_CONFIDENCE_THRESHOLD = 0.72;
const SOCKET_INTERRUPTED_MESSAGE =
  "Tasmee connection was interrupted. Please tap the mic to retry.";

const countPageWords = (pageData: MushafPageLines | null) => {
  if (!pageData) return 0;
  return pageData.lines.reduce(
    (wordCount, line) =>
      wordCount + line.words.filter((word) => word.charType === "word").length,
    0,
  );
};

const clearTimeoutIfSet = (
  timeoutRef: { current: ReturnType<typeof setTimeout> | null },
) => {
  if (!timeoutRef.current) return;
  clearTimeout(timeoutRef.current);
  timeoutRef.current = null;
};

const clearIntervalIfSet = (
  intervalRef: { current: ReturnType<typeof setInterval> | null },
) => {
  if (!intervalRef.current) return;
  clearInterval(intervalRef.current);
  intervalRef.current = null;
};

export const useTasmeeSession = ({ pageNumber, surahId }: UseTasmeeSessionArgs) => {
  const [status, setStatus] = useState<TasmeeSessionStatus>("idle");
  const [transportMode, setTransportMode] = useState<TasmeeTransportMode | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pageData, setPageData] = useState<MushafPageLines | null>(null);
  const [anchorWordIndex, setAnchorWordIndex] = useState<number | null>(null);
  const [revealedWordIndexes, setRevealedWordIndexes] = useState<number[]>([]);

  const socketRef = useRef<TasmeeSocketConnection | null>(null);
  const statusRef = useRef<TasmeeSessionStatus>("idle");
  const transportModeRef = useRef<TasmeeTransportMode | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const anchorWordIndexRef = useRef<number | null>(null);
  const revealedWordIndexesRef = useRef<number[]>([]);
  const activePageNumberRef = useRef<number>(pageNumber);
  const totalWordCountRef = useRef<number>(0);
  const mockAnchorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mockRevealIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const clearMockProgressTimers = useCallback(() => {
    clearTimeoutIfSet(mockAnchorTimeoutRef);
    clearIntervalIfSet(mockRevealIntervalRef);
  }, []);

  const clearTransport = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    clearMockProgressTimers();
  }, [clearMockProgressTimers]);

  const applyDeltaEvent = useCallback((event: TasmeeFeedbackDeltaEvent) => {
    if (!isDeltaForActiveTasmeeSession(sessionIdRef.current, event)) {
      return;
    }

    const next = applyFeedbackDelta(
      {
        anchorWordIndex: anchorWordIndexRef.current,
        revealedWordIndexes: revealedWordIndexesRef.current,
      },
      event,
      totalWordCountRef.current,
      ANCHOR_CONFIDENCE_THRESHOLD,
    );

    if (next.anchorWordIndex !== anchorWordIndexRef.current) {
      anchorWordIndexRef.current = next.anchorWordIndex;
      setAnchorWordIndex(next.anchorWordIndex);
    }

    if (next.revealedWordIndexes !== revealedWordIndexesRef.current) {
      revealedWordIndexesRef.current = next.revealedWordIndexes;
      setRevealedWordIndexes(next.revealedWordIndexes);
    }

    if (next.anchorWordIndex == null) {
      setStatus("listening");
      return;
    }

    setStatus("active");
  }, []);

  const startMockProgress = useCallback((currentSessionId: string) => {
    const totalWordCount = totalWordCountRef.current;
    if (totalWordCount <= 0) {
      setStatus("error");
      setErrorMessage("Current page has no line words for tasmee.");
      return;
    }

    setTransportMode("mock");
    setStatus("listening");

    mockAnchorTimeoutRef.current = setTimeout(() => {
      const nextAnchor =
        totalWordCount > 6 ? Math.floor(totalWordCount * 0.35) : 0;

      applyDeltaEvent({
        type: "feedback.delta",
        session_id: currentSessionId,
        start_anchor_word_index: nextAnchor,
        start_anchor_confidence: 0.92,
        confirmed_word_indexes: [nextAnchor],
      });

      let cursor = nextAnchor + 1;
      mockRevealIntervalRef.current = setInterval(() => {
        if (cursor >= totalWordCount) {
          clearIntervalIfSet(mockRevealIntervalRef);
          return;
        }

        applyDeltaEvent({
          type: "feedback.delta",
          session_id: currentSessionId,
          confirmed_word_indexes: [cursor],
        });
        cursor += 1;
      }, MOCK_REVEAL_INTERVAL_MS);
    }, MOCK_ANCHOR_DELAY_MS);
  }, [applyDeltaEvent]);

  const resetProgress = useCallback(() => {
    anchorWordIndexRef.current = null;
    revealedWordIndexesRef.current = [];
    setAnchorWordIndex(null);
    setRevealedWordIndexes([]);
  }, []);

  const startSession = useCallback(async () => {
    if (statusRef.current === "starting") return;
    if (statusRef.current === "listening" || statusRef.current === "active") return;

    statusRef.current = "starting";
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

    const currentSessionId = `tasmee-${Date.now()}`;
    sessionIdRef.current = currentSessionId;
    setSessionId(currentSessionId);

    try {
      const remoteSession = await createTasmeeSession({
        page_number: pageNumber,
        surah_id: surahId,
      });

      sessionIdRef.current = remoteSession.session_id;
      setSessionId(remoteSession.session_id);
      setTransportMode("websocket");
      statusRef.current = "listening";
      setStatus("listening");

      socketRef.current = openTasmeeSocket(remoteSession, {
        onDelta: applyDeltaEvent,
        onClose: () => {
          if (statusRef.current === "idle" || statusRef.current === "stopped") {
            return;
          }
          statusRef.current = "error";
          setStatus("error");
          setErrorMessage(SOCKET_INTERRUPTED_MESSAGE);
          setTransportMode("http");
        },
        onError: (error) => {
          if (statusRef.current === "idle" || statusRef.current === "stopped") {
            return;
          }
          statusRef.current = "error";
          setStatus("error");
          setErrorMessage(error.message || SOCKET_INTERRUPTED_MESSAGE);
          setTransportMode("http");
        },
      });
      return;
    } catch {
      const startFailurePolicy = getTasmeeStartFailurePolicy();
      if (startFailurePolicy.useMockProgress) {
        startMockProgress(currentSessionId);
        return;
      }

      sessionIdRef.current = null;
      setSessionId(null);
      setTransportMode(null);
      statusRef.current = startFailurePolicy.nextStatus;
      setStatus(startFailurePolicy.nextStatus);
      setErrorMessage(startFailurePolicy.errorMessage);
      return;
    }
  }, [applyDeltaEvent, clearTransport, pageData, pageNumber, resetProgress, startMockProgress, surahId]);

  const stopSession = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    const currentTransport = transportModeRef.current;

    statusRef.current = "idle";
    transportModeRef.current = null;
    sessionIdRef.current = null;
    setStatus("idle");
    setTransportMode(null);
    setSessionId(null);
    setErrorMessage(null);

    clearTransport();

    if (currentSessionId && currentTransport !== "mock") {
      try {
        await stopTasmeeSession(currentSessionId);
      } catch {
        // Stopping should still reset UI state when network call fails.
      }
    }
    resetProgress();
  }, [clearTransport, resetProgress]);

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
      (statusRef.current === "listening" || statusRef.current === "active") &&
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

  const totalWordCount = useMemo(() => countPageWords(pageData), [pageData]);
  const wordStates: TasmeeWordState[] = useMemo(
    () =>
      buildTasmeeWordStates(totalWordCount, anchorWordIndex, revealedWordIndexes),
    [anchorWordIndex, revealedWordIndexes, totalWordCount],
  );

  const isRunning = status === "starting" || status === "listening" || status === "active";
  const isLocked = anchorWordIndex != null;
  const isListeningForStart = isRunning && anchorWordIndex == null;

  return {
    status,
    transportMode,
    sessionId,
    errorMessage,
    pageData,
    anchorWordIndex,
    revealedWordIndexes,
    wordStates,
    isRunning,
    isLocked,
    isListeningForStart,
    startSession,
    stopSession,
  };
};
