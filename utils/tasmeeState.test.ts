import assert from "node:assert/strict";
import test from "node:test";

import { applyFeedbackDelta, buildTasmeeWordStates } from "./tasmeeState";

test("mid-page anchor keeps pre-anchor words visible", () => {
  const states = buildTasmeeWordStates(8, 3, [3, 4, 6]);
  assert.deepEqual(states, [
    "visible_static",
    "visible_static",
    "visible_static",
    "revealed_correct",
    "revealed_correct",
    "hidden_pending",
    "revealed_correct",
    "hidden_pending",
  ]);
});

test("anchor at first word hides all pending words after index 0", () => {
  const states = buildTasmeeWordStates(5, 0, [0, 1]);
  assert.deepEqual(states, [
    "revealed_correct",
    "revealed_correct",
    "hidden_pending",
    "hidden_pending",
    "hidden_pending",
  ]);
});

test("low-confidence anchor is rejected and page remains visible", () => {
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

  assert.equal(next.anchorWordIndex, null);
  assert.deepEqual(next.revealedWordIndexes, [6]);
});

test("anchor shift is rejected after first lock", () => {
  const initial = applyFeedbackDelta(
    {
      anchorWordIndex: null,
      revealedWordIndexes: [],
    },
    {
      type: "feedback.delta",
      session_id: "s-1",
      start_anchor_word_index: 10,
      start_anchor_confidence: 0.91,
      confirmed_word_indexes: [10],
    },
    40,
  );

  const shifted = applyFeedbackDelta(
    initial,
    {
      type: "feedback.delta",
      session_id: "s-1",
      start_anchor_word_index: 3,
      start_anchor_confidence: 0.95,
      confirmed_word_indexes: [11],
    },
    40,
  );

  assert.equal(shifted.anchorWordIndex, 10);
  assert.deepEqual(shifted.revealedWordIndexes, [10, 11]);
});
