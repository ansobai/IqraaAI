import assert from "node:assert/strict";
import test from "node:test";

import { applyFeedbackDelta, buildTasmeeWordStates } from "./tasmeeState";

test("session starts fully hidden", () => {
  const states = buildTasmeeWordStates(5, null, []);
  assert.deepEqual(states, [
    "hidden_pending",
    "hidden_pending",
    "hidden_pending",
    "hidden_pending",
    "hidden_pending",
  ]);
});

test("first mid-page anchor auto-reveals words before it", () => {
  const next = applyFeedbackDelta(
    {
      anchorWordIndex: null,
      revealedWordIndexes: [],
    },
    {
      type: "feedback.delta",
      session_id: "s-1",
      start_anchor_word_index: 3,
      start_anchor_confidence: 0.95,
      confirmed_word_indexes: [3],
    },
    8,
  );

  assert.equal(next.anchorWordIndex, 3);
  assert.deepEqual(next.revealedWordIndexes, [0, 1, 2, 3]);

  const states = buildTasmeeWordStates(8, next.anchorWordIndex, next.revealedWordIndexes);
  assert.deepEqual(states, [
    "revealed_correct",
    "revealed_correct",
    "revealed_correct",
    "revealed_correct",
    "hidden_pending",
    "hidden_pending",
    "hidden_pending",
    "hidden_pending",
  ]);
});

test("confirmed indexes continue revealing monotonically after first anchor", () => {
  const initial = applyFeedbackDelta(
    {
      anchorWordIndex: null,
      revealedWordIndexes: [],
    },
    {
      type: "feedback.delta",
      session_id: "s-1",
      start_anchor_word_index: 2,
      start_anchor_confidence: 0.92,
      confirmed_word_indexes: [2],
    },
    10,
  );

  const next = applyFeedbackDelta(
    initial,
    {
      type: "feedback.delta",
      session_id: "s-1",
      confirmed_word_indexes: [4, 5],
    },
    10,
  );

  assert.equal(next.anchorWordIndex, 2);
  assert.deepEqual(next.revealedWordIndexes, [0, 1, 2, 4, 5]);
});

test("low-confidence start anchor can fallback to confirmed index", () => {
  const next = applyFeedbackDelta(
    {
      anchorWordIndex: null,
      revealedWordIndexes: [],
    },
    {
      type: "feedback.delta",
      session_id: "s-1",
      start_anchor_word_index: 6,
      start_anchor_confidence: 0.42,
      confirmed_word_indexes: [6],
    },
    20,
    0.72,
  );

  assert.equal(next.anchorWordIndex, 6);
  assert.deepEqual(next.revealedWordIndexes, [0, 1, 2, 3, 4, 5, 6]);
});

test("out-of-range confirmed indexes are clamped and merged", () => {
  const initial = applyFeedbackDelta(
    {
      anchorWordIndex: null,
      revealedWordIndexes: [],
    },
    {
      type: "feedback.delta",
      session_id: "s-1",
      start_anchor_word_index: 1,
      start_anchor_confidence: 0.91,
      confirmed_word_indexes: [1],
    },
    6,
  );

  const next = applyFeedbackDelta(
    initial,
    {
      type: "feedback.delta",
      session_id: "s-1",
      confirmed_word_indexes: [-4, 99],
    },
    6,
  );

  assert.equal(next.anchorWordIndex, 1);
  assert.deepEqual(next.revealedWordIndexes, [0, 1, 5]);
});
