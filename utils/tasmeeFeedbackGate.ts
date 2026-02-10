import type { TasmeeFeedbackDeltaEvent, TasmeeFeedbackState } from "../types/tasmee";

export type TasmeeDeltaGateDecision = {
  shouldApply: boolean;
  nextSeqAck: number;
  feedbackState: TasmeeFeedbackState;
};

type EvaluateFeedbackDeltaGateArgs = {
  event: TasmeeFeedbackDeltaEvent;
  lastSeqAck: number;
  lastSpeechDetectedAtMs: number | null;
  nowMs: number;
  speechWindowMs: number;
  confidenceThreshold: number;
};

const finiteOrNull = (value: number | undefined) =>
  Number.isFinite(value) ? (value as number) : null;

export const isSpeechWindowOpen = (
  lastSpeechDetectedAtMs: number | null,
  nowMs: number,
  speechWindowMs: number,
) => {
  if (lastSpeechDetectedAtMs == null) return false;
  return nowMs - lastSpeechDetectedAtMs <= speechWindowMs;
};

export const getEventConfidence = (event: TasmeeFeedbackDeltaEvent) => {
  const direct = finiteOrNull(event.confidence);
  if (direct != null) return direct;
  const anchor = finiteOrNull(event.start_anchor_confidence);
  if (anchor != null) return anchor;
  return 0;
};

export const evaluateFeedbackDeltaGate = ({
  event,
  lastSeqAck,
  lastSpeechDetectedAtMs,
  nowMs,
  speechWindowMs,
  confidenceThreshold,
}: EvaluateFeedbackDeltaGateArgs): TasmeeDeltaGateDecision => {
  const seqAck = finiteOrNull(event.seq_ack);
  if (seqAck != null && seqAck < lastSeqAck) {
    return {
      shouldApply: false,
      nextSeqAck: lastSeqAck,
      feedbackState: "processing",
    };
  }

  const nextSeqAck = seqAck != null ? Math.max(lastSeqAck, seqAck) : lastSeqAck;
  const localSpeechOpen = isSpeechWindowOpen(
    lastSpeechDetectedAtMs,
    nowMs,
    speechWindowMs,
  );
  const speechGateOpen = localSpeechOpen && event.has_speech !== false;

  if (!speechGateOpen) {
    return {
      shouldApply: false,
      nextSeqAck,
      feedbackState: "silent",
    };
  }

  const confidence = getEventConfidence(event);
  if (confidence < confidenceThreshold) {
    return {
      shouldApply: false,
      nextSeqAck,
      feedbackState: "processing",
    };
  }

  return {
    shouldApply: true,
    nextSeqAck,
    feedbackState: "reciting",
  };
};
