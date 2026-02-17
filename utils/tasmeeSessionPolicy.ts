import type { TasmeeFeedbackDeltaEvent, TasmeeSessionStatus } from "../types/tasmee";

const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on"]);
const DEFAULT_SERVICE_DOWN_MESSAGE =
  "Tasmee service is currently unavailable. Please try again shortly.";

export type TasmeeStartFailurePolicy = {
  useMockProgress: boolean;
  nextStatus: TasmeeSessionStatus;
  errorMessage: string | null;
};

export const isTruthyEnvFlag = (rawValue: string | null | undefined) => {
  if (rawValue == null) return false;
  const normalized = rawValue.trim().toLowerCase();
  return TRUTHY_ENV_VALUES.has(normalized);
};

export const isTasmeeMockEnabled = (
  rawValue: string | null | undefined = process.env.EXPO_PUBLIC_TASMEE_ALLOW_MOCK,
) => isTruthyEnvFlag(rawValue);

export const getTasmeeStartFailurePolicy = (
  rawMockFlag: string | null | undefined = process.env.EXPO_PUBLIC_TASMEE_ALLOW_MOCK,
  serviceDownMessage = DEFAULT_SERVICE_DOWN_MESSAGE,
): TasmeeStartFailurePolicy => {
  if (isTasmeeMockEnabled(rawMockFlag)) {
    return {
      useMockProgress: true,
      nextStatus: "listening",
      errorMessage: null,
    };
  }

  return {
    useMockProgress: false,
    nextStatus: "error",
    errorMessage: serviceDownMessage,
  };
};

export const isDeltaForActiveTasmeeSession = (
  activeSessionId: string | null,
  event: Pick<TasmeeFeedbackDeltaEvent, "session_id">,
) => {
  if (!activeSessionId) return false;
  return event.session_id === activeSessionId;
};

