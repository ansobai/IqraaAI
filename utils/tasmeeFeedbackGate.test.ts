import assert from "node:assert/strict";
import test from "node:test";

import { evaluateFeedbackDeltaGate } from "./tasmeeFeedbackGate";

const BASE_EVENT = {
  type: "feedback.delta" as const,
  session_id: "session-1",
  confirmed_word_indexes: [1],
};

test("rejects delta when speech gate is closed", () => {
  const decision = evaluateFeedbackDeltaGate({
    event: {
      ...BASE_EVENT,
      has_speech: false,
      confidence: 0.93,
      seq_ack: 1,
    },
    lastSeqAck: 0,
    lastSpeechDetectedAtMs: null,
    nowMs: 10_000,
    speechWindowMs: 1200,
    confidenceThreshold: 0.85,
  });

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.feedbackState, "silent");
  assert.equal(decision.nextSeqAck, 1);
});

test("accepts delta when speech and confidence gates pass", () => {
  const decision = evaluateFeedbackDeltaGate({
    event: {
      ...BASE_EVENT,
      has_speech: true,
      confidence: 0.9,
      seq_ack: 4,
    },
    lastSeqAck: 3,
    lastSpeechDetectedAtMs: 9_600,
    nowMs: 10_000,
    speechWindowMs: 1200,
    confidenceThreshold: 0.85,
  });

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.feedbackState, "reciting");
  assert.equal(decision.nextSeqAck, 4);
});

test("rejects low-confidence delta while keeping processing state", () => {
  const decision = evaluateFeedbackDeltaGate({
    event: {
      ...BASE_EVENT,
      has_speech: true,
      confidence: 0.8,
      seq_ack: 8,
    },
    lastSeqAck: 7,
    lastSpeechDetectedAtMs: 9_300,
    nowMs: 10_000,
    speechWindowMs: 1200,
    confidenceThreshold: 0.85,
  });

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.feedbackState, "processing");
  assert.equal(decision.nextSeqAck, 8);
});

test("rejects out-of-order seq ack values", () => {
  const decision = evaluateFeedbackDeltaGate({
    event: {
      ...BASE_EVENT,
      has_speech: true,
      confidence: 0.95,
      seq_ack: 6,
    },
    lastSeqAck: 9,
    lastSpeechDetectedAtMs: 9_500,
    nowMs: 10_000,
    speechWindowMs: 1200,
    confidenceThreshold: 0.85,
  });

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.feedbackState, "processing");
  assert.equal(decision.nextSeqAck, 9);
});

test("explicit backend no-speech blocks reveal even with local speech", () => {
  const decision = evaluateFeedbackDeltaGate({
    event: {
      ...BASE_EVENT,
      has_speech: false,
      confidence: 0.92,
      seq_ack: 12,
    },
    lastSeqAck: 11,
    lastSpeechDetectedAtMs: 9_600,
    nowMs: 10_000,
    speechWindowMs: 1200,
    confidenceThreshold: 0.85,
  });

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.feedbackState, "silent");
  assert.equal(decision.nextSeqAck, 12);
});

test("local speech window can unlock gate when backend speech flag is omitted", () => {
  const decision = evaluateFeedbackDeltaGate({
    event: {
      ...BASE_EVENT,
      confidence: 0.92,
      seq_ack: 13,
    },
    lastSeqAck: 12,
    lastSpeechDetectedAtMs: 9_500,
    nowMs: 10_000,
    speechWindowMs: 1200,
    confidenceThreshold: 0.85,
  });

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.feedbackState, "reciting");
  assert.equal(decision.nextSeqAck, 13);
});

test("backend speech true is still blocked without local speech window", () => {
  const decision = evaluateFeedbackDeltaGate({
    event: {
      ...BASE_EVENT,
      has_speech: true,
      confidence: 0.98,
      seq_ack: 14,
    },
    lastSeqAck: 13,
    lastSpeechDetectedAtMs: null,
    nowMs: 10_000,
    speechWindowMs: 1200,
    confidenceThreshold: 0.85,
  });

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.feedbackState, "silent");
  assert.equal(decision.nextSeqAck, 14);
});

test("missing backend speech flag is blocked when local speech window is closed", () => {
  const decision = evaluateFeedbackDeltaGate({
    event: {
      ...BASE_EVENT,
      confidence: 0.99,
      seq_ack: 15,
    },
    lastSeqAck: 14,
    lastSpeechDetectedAtMs: null,
    nowMs: 10_000,
    speechWindowMs: 1200,
    confidenceThreshold: 0.85,
  });

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.feedbackState, "silent");
  assert.equal(decision.nextSeqAck, 15);
});
