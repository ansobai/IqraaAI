import { Audio, type AVPlaybackStatus } from "expo-av";
import { useCallback, useEffect, useRef, useState } from "react";

import type { MushafPage } from "../utils/mushafData";
import {
  buildPageVerseQueue,
  buildVerseAudioCandidates,
  formatVerseAudioKey,
  type QuranRecitationVerse,
} from "../utils/quranRecitationAudio";

export type QuranRecitationMode = "idle" | "verse" | "page";
export type QuranRecitationStatus = "idle" | "loading" | "playing" | "error";

export type QuranRecitationState = {
  mode: QuranRecitationMode;
  status: QuranRecitationStatus;
  errorMessage: string | null;
};

type UseQuranRecitationPlayerOptions = {
  onError?: (message: string) => void;
};

type RecitationQueueState = {
  items: QuranRecitationVerse[];
  index: number;
} | null;

const AUDIO_LOAD_FAILURE_MESSAGE =
  "Couldn't load recitation. Check internet and try again.";

const initialState: QuranRecitationState = {
  mode: "idle",
  status: "idle",
  errorMessage: null,
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

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const updateState = useCallback((next: QuranRecitationState) => {
    setState(next);
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

      const audioKey = formatVerseAudioKey(verse.surahId, verse.verseNumber);
      const candidates = buildVerseAudioCandidates(audioKey);
      updateState({ mode, status: "loading", errorMessage: null });

      for (const uri of candidates) {
        if (requestId !== requestIdRef.current) return false;

        try {
          await releaseSound();
          const { sound } = await Audio.Sound.createAsync(
            { uri },
            { shouldPlay: true },
          );

          if (requestId !== requestIdRef.current) {
            sound.setOnPlaybackStatusUpdate(null);
            await sound.unloadAsync();
            return false;
          }

          soundRef.current = sound;
          sound.setOnPlaybackStatusUpdate((playbackStatus: AVPlaybackStatus) => {
            if (!playbackStatus.isLoaded || !playbackStatus.didJustFinish) return;
            handlePlaybackFinishedRef.current(requestId);
          });

          updateState({ mode, status: "playing", errorMessage: null });
          return true;
        } catch {
          // Try next provider.
        }
      }

      if (requestId !== requestIdRef.current) return false;

      await releaseSound();
      queueRef.current = null;
      updateState({
        mode: "idle",
        status: "error",
        errorMessage: AUDIO_LOAD_FAILURE_MESSAGE,
      });
      onErrorRef.current?.(AUDIO_LOAD_FAILURE_MESSAGE);
      return false;
    },
    [configureAudioMode, releaseSound, updateState],
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
      updateState(initialState);
    },
    [playVerseWithMode, releaseSound, updateState],
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
    updateState(initialState);
  }, [releaseSound, updateState]);

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
          mode: "idle",
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
    stop,
    state,
  };
};
