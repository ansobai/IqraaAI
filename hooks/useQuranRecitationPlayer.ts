import { Audio, type AVPlaybackStatus } from "expo-av";
import { useCallback, useEffect, useRef, useState } from "react";

import type { MushafPage } from "../utils/mushafData";
import {
  buildPageVerseQueue,
  buildVerseAudioCandidates,
  fetchTimedVerseRecitationAudio,
  formatVerseAudioKey,
  resolveCurrentWordIndexFromSegments,
  type QuranRecitationVerse,
  type QuranRecitationWordSyncSource,
  type QuranTimedWordSegment,
} from "../utils/quranRecitationAudio";

export type QuranRecitationMode = "idle" | "verse" | "page";
export type QuranRecitationStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "error";

export type QuranRecitationState = {
  mode: QuranRecitationMode;
  status: QuranRecitationStatus;
  errorMessage: string | null;
  currentVerse: QuranRecitationVerse | null;
  currentWordInVerse: number | null;
  wordSyncSource: QuranRecitationWordSyncSource | null;
};

type UseQuranRecitationPlayerOptions = {
  onError?: (message: string) => void;
};

type RecitationQueueState = {
  items: QuranRecitationVerse[];
  index: number;
} | null;

type PlaybackCandidate = {
  uri: string;
  wordSyncSource: QuranRecitationWordSyncSource;
  timedSegments: QuranTimedWordSegment[] | null;
};

const AUDIO_LOAD_FAILURE_MESSAGE =
  "Couldn't load recitation. Check internet and try again.";
const PLAYBACK_PROGRESS_INTERVAL_MS = 120;

const initialState: QuranRecitationState = {
  mode: "idle",
  status: "idle",
  errorMessage: null,
  currentVerse: null,
  currentWordInVerse: null,
  wordSyncSource: null,
};

const buildPlaybackCandidates = (
  timedAudioUri: string | null,
  timedSegments: QuranTimedWordSegment[],
  fallbackCandidates: string[],
): PlaybackCandidate[] => {
  const candidates: PlaybackCandidate[] = [];
  const seenUris = new Set<string>();
  const hasTimedSegments = timedSegments.length > 0;

  const pushCandidate = (candidate: PlaybackCandidate) => {
    const trimmedUri = candidate.uri.trim();
    if (!trimmedUri || seenUris.has(trimmedUri)) return;
    seenUris.add(trimmedUri);
    candidates.push({ ...candidate, uri: trimmedUri });
  };

  if (timedAudioUri) {
    pushCandidate({
      uri: timedAudioUri,
      wordSyncSource: hasTimedSegments ? "timed" : "fallback",
      timedSegments: hasTimedSegments ? timedSegments : null,
    });
  }

  for (const uri of fallbackCandidates) {
    pushCandidate({
      uri,
      wordSyncSource: "fallback",
      timedSegments: null,
    });
  }

  return candidates;
};

export const useQuranRecitationPlayer = (
  options: UseQuranRecitationPlayerOptions = {},
) => {
  const { onError } = options;
  const [state, setState] = useState<QuranRecitationState>(initialState);
  const soundRef = useRef<Audio.Sound | null>(null);
  const queueRef = useRef<RecitationQueueState>(null);
  const requestIdRef = useRef(0);
  const onErrorRef = useRef(onError);
  const audioModeConfiguredRef = useRef(false);
  const handlePlaybackFinishedRef = useRef<(requestId: number) => void>(() => {});
  const activeTimedSegmentsRef = useRef<QuranTimedWordSegment[] | null>(null);
  const activeWordInVerseRef = useRef<number | null>(null);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const updateState = useCallback((next: QuranRecitationState) => {
    setState(next);
  }, []);

  const clearWordSyncRefs = useCallback(() => {
    activeTimedSegmentsRef.current = null;
    activeWordInVerseRef.current = null;
  }, []);

  const releaseSound = useCallback(async () => {
    const existing = soundRef.current;
    soundRef.current = null;

    if (!existing) return;

    existing.setOnPlaybackStatusUpdate(null);
    try {
      await existing.unloadAsync();
    } catch {
      // Best effort cleanup.
    }
  }, []);

  const configureAudioMode = useCallback(async () => {
    if (audioModeConfiguredRef.current) return;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
      audioModeConfiguredRef.current = true;
    } catch {
      // Continue; playback may still work on current platform.
    }
  }, []);

  const playVerseWithMode = useCallback(
    async (
      verse: QuranRecitationVerse,
      mode: Extract<QuranRecitationMode, "verse" | "page">,
      requestId: number,
    ) => {
      await configureAudioMode();

      const normalizedVerse: QuranRecitationVerse = {
        surahId: verse.surahId,
        verseNumber: String(verse.verseNumber),
      };

      const audioKey = formatVerseAudioKey(
        normalizedVerse.surahId,
        normalizedVerse.verseNumber,
      );
      const fallbackCandidates = buildVerseAudioCandidates(audioKey);

      let timedAudioUri: string | null = null;
      let timedSegments: QuranTimedWordSegment[] = [];
      if (mode === "page") {
        const timedAudio = await fetchTimedVerseRecitationAudio(normalizedVerse);
        if (requestId !== requestIdRef.current) return false;
        timedAudioUri = timedAudio?.audioUrl ?? null;
        timedSegments = timedAudio?.segments ?? [];
      }

      const candidates = buildPlaybackCandidates(
        timedAudioUri,
        timedSegments,
        fallbackCandidates,
      );

      clearWordSyncRefs();
      updateState({
        mode,
        status: "loading",
        errorMessage: null,
        currentVerse: mode === "page" ? normalizedVerse : null,
        currentWordInVerse: null,
        wordSyncSource: null,
      });

      for (const candidate of candidates) {
        if (requestId !== requestIdRef.current) return false;

        try {
          await releaseSound();
          const { sound } = await Audio.Sound.createAsync(
            { uri: candidate.uri },
            {
              shouldPlay: true,
              progressUpdateIntervalMillis: PLAYBACK_PROGRESS_INTERVAL_MS,
            },
          );

          if (requestId !== requestIdRef.current) {
            sound.setOnPlaybackStatusUpdate(null);
            await sound.unloadAsync();
            return false;
          }

          soundRef.current = sound;
          activeTimedSegmentsRef.current =
            mode === "page" ? candidate.timedSegments : null;
          activeWordInVerseRef.current =
            mode === "page" && candidate.timedSegments?.length
              ? resolveCurrentWordIndexFromSegments(candidate.timedSegments, 0)
              : null;

          sound.setOnPlaybackStatusUpdate((playbackStatus: AVPlaybackStatus) => {
            if (requestId !== requestIdRef.current) return;
            if (mode === "page" && playbackStatus.isLoaded) {
              const timedSegmentsForVerse = activeTimedSegmentsRef.current;
              if (timedSegmentsForVerse?.length) {
                const nextWordIndex = resolveCurrentWordIndexFromSegments(
                  timedSegmentsForVerse,
                  playbackStatus.positionMillis,
                );
                if (
                  nextWordIndex != null &&
                  nextWordIndex !== activeWordInVerseRef.current
                ) {
                  activeWordInVerseRef.current = nextWordIndex;
                  setState((previous) => {
                    if (previous.mode !== "page") return previous;
                    if (previous.currentWordInVerse === nextWordIndex) {
                      return previous;
                    }

                    return {
                      ...previous,
                      currentWordInVerse: nextWordIndex,
                    };
                  });
                }
              }
            }

            if (!playbackStatus.isLoaded || !playbackStatus.didJustFinish) return;
            handlePlaybackFinishedRef.current(requestId);
          });

          updateState({
            mode,
            status: "playing",
            errorMessage: null,
            currentVerse: mode === "page" ? normalizedVerse : null,
            currentWordInVerse:
              mode === "page" ? activeWordInVerseRef.current : null,
            wordSyncSource: mode === "page" ? candidate.wordSyncSource : null,
          });
          return true;
        } catch {
          // Try next provider.
        }
      }

      if (requestId !== requestIdRef.current) return false;

      await releaseSound();
      queueRef.current = null;
      clearWordSyncRefs();
      updateState({
        ...initialState,
        status: "error",
        errorMessage: AUDIO_LOAD_FAILURE_MESSAGE,
      });
      onErrorRef.current?.(AUDIO_LOAD_FAILURE_MESSAGE);
      return false;
    },
    [clearWordSyncRefs, configureAudioMode, releaseSound, updateState],
  );

  const handlePlaybackFinished = useCallback(
    async (requestId: number) => {
      if (requestId !== requestIdRef.current) return;

      const queue = queueRef.current;
      if (queue && queue.index < queue.items.length - 1) {
        const nextIndex = queue.index + 1;
        queueRef.current = { ...queue, index: nextIndex };
        const nextVerse = queue.items[nextIndex];
        await playVerseWithMode(nextVerse, "page", requestId);
        return;
      }

      queueRef.current = null;
      await releaseSound();
      clearWordSyncRefs();
      updateState(initialState);
    },
    [clearWordSyncRefs, playVerseWithMode, releaseSound, updateState],
  );

  useEffect(() => {
    handlePlaybackFinishedRef.current = (requestId: number) => {
      void handlePlaybackFinished(requestId);
    };
  }, [handlePlaybackFinished]);

  const stop = useCallback(async () => {
    requestIdRef.current += 1;
    queueRef.current = null;
    await releaseSound();
    clearWordSyncRefs();
    updateState(initialState);
  }, [clearWordSyncRefs, releaseSound, updateState]);

  const pause = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;

    try {
      await sound.pauseAsync();
      setState((previous) => ({
        ...previous,
        status: previous.mode === "idle" ? previous.status : "paused",
      }));
    } catch {
      // Keep current state if pausing fails.
    }
  }, []);

  const resume = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;

    try {
      await sound.playAsync();
      setState((previous) => ({
        ...previous,
        status: previous.mode === "idle" ? previous.status : "playing",
      }));
    } catch {
      // Keep current state if resume fails.
    }
  }, []);

  const playVerse = useCallback(
    async (verse: QuranRecitationVerse) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      queueRef.current = null;

      await playVerseWithMode(
        {
          surahId: verse.surahId,
          verseNumber: String(verse.verseNumber),
        },
        "verse",
        requestId,
      );
    },
    [playVerseWithMode],
  );

  const playPageFromStart = useCallback(
    async (page: MushafPage) => {
      const queue = buildPageVerseQueue(page);
      if (queue.length === 0) {
        updateState({
          ...initialState,
          status: "error",
          errorMessage: AUDIO_LOAD_FAILURE_MESSAGE,
        });
        onErrorRef.current?.(AUDIO_LOAD_FAILURE_MESSAGE);
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      queueRef.current = { items: queue, index: 0 };

      await playVerseWithMode(queue[0], "page", requestId);
    },
    [playVerseWithMode, updateState],
  );

  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  return {
    playVerse,
    playPageFromStart,
    pause,
    resume,
    stop,
    state,
  };
};
