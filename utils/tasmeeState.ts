import type { TasmeeFeedbackDeltaEvent, TasmeeWordState } from "../types/tasmee";

const sameNumberArray = (left: number[], right: number[]) => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const clampIndex = (index: number, totalWordCount: number) =>
  Math.max(0, Math.min(index, Math.max(0, totalWordCount - 1)));

const normalizeIncomingIndexes = (
  incomingIndexes: number[] | undefined,
  totalWordCount: number,
) => {
  if (!incomingIndexes?.length || totalWordCount <= 0) return [];
  return incomingIndexes
    .filter((rawIndex) => Number.isFinite(rawIndex))
    .map((rawIndex) => clampIndex(rawIndex, totalWordCount));
};

export const resolveAnchorWordIndex = (
  currentAnchor: number | null,
  nextAnchor: number | undefined,
  confidence: number | undefined,
  totalWordCount: number,
  confidenceThreshold = 0.72,
) => {
  if (nextAnchor == null || !Number.isFinite(nextAnchor)) return currentAnchor;
  if (totalWordCount <= 0) return currentAnchor;
  if (confidence != null && confidence < confidenceThreshold) return currentAnchor;
  const clamped = clampIndex(nextAnchor, totalWordCount);
  if (currentAnchor == null) return clamped;
  // Allow re-locking to a new verse anchor (server can emit a new anchor later).
  return currentAnchor === clamped ? currentAnchor : clamped;
};

export const resolveAnchorFromConfirmedWordIndexes = (
  currentAnchor: number | null,
  incomingIndexes: number[] | undefined,
  totalWordCount: number,
) => {
  if (currentAnchor != null) return currentAnchor;

  const normalized = normalizeIncomingIndexes(incomingIndexes, totalWordCount);
  if (!normalized.length) return currentAnchor;

  return normalized.reduce(
    (minimum, current) => Math.min(minimum, current),
    normalized[0],
  );
};

export const mergeRevealedWordIndexes = (
  currentIndexes: number[],
  incomingIndexes: number[] | undefined,
  _anchorWordIndex: number | null,
  totalWordCount: number,
) => {
  if (totalWordCount <= 0) return currentIndexes;

  const nextSet = new Set<number>(currentIndexes);

  normalizeIncomingIndexes(incomingIndexes, totalWordCount).forEach(
    (normalized) => {
      nextSet.add(normalized);
    },
  );

  const nextIndexes = Array.from(nextSet).sort((left, right) => left - right);
  return sameNumberArray(nextIndexes, currentIndexes) ? currentIndexes : nextIndexes;
};

export const buildTasmeeWordStates = (
  totalWordCount: number,
  _anchorWordIndex: number | null,
  revealedWordIndexes: number[],
): TasmeeWordState[] => {
  const revealedSet = new Set(revealedWordIndexes);
  const states: TasmeeWordState[] = [];

  for (let wordIndex = 0; wordIndex < totalWordCount; wordIndex += 1) {
    if (revealedSet.has(wordIndex)) {
      states.push("revealed_correct");
      continue;
    }

    states.push("hidden_pending");
  }

  return states;
};

export type TasmeeProgressState = {
  anchorWordIndex: number | null;
  revealedWordIndexes: number[];
};

export const applyFeedbackDelta = (
  state: TasmeeProgressState,
  event: TasmeeFeedbackDeltaEvent,
  totalWordCount: number,
  confidenceThreshold = 0.72,
): TasmeeProgressState => {
  const nextAnchorFromStart = resolveAnchorWordIndex(
    state.anchorWordIndex,
    event.start_anchor_word_index,
    event.start_anchor_confidence,
    totalWordCount,
    confidenceThreshold,
  );
  const nextAnchor = resolveAnchorFromConfirmedWordIndexes(
    nextAnchorFromStart,
    event.confirmed_word_indexes,
    totalWordCount,
  );

  const nextRevealed = mergeRevealedWordIndexes(
    state.revealedWordIndexes,
    event.confirmed_word_indexes,
    nextAnchor,
    totalWordCount,
  );

  if (
    nextAnchor === state.anchorWordIndex &&
    nextRevealed === state.revealedWordIndexes
  ) {
    return state;
  }

  return {
    anchorWordIndex: nextAnchor,
    revealedWordIndexes: nextRevealed,
  };
};
