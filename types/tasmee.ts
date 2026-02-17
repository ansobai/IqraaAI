export type TasmeeSessionStatus =
  | "idle"
  | "starting"
  | "listening"
  | "active"
  | "stopped"
  | "error";

export type TasmeeTransportMode = "websocket" | "http" | "mock";

export type TasmeeWordState =
  | "visible_static"
  | "hidden_pending"
  | "revealed_correct";

export interface TasmeeSessionCreateRequest {
  page_number: number;
  surah_id: number;
}

export interface TasmeeSessionCreateResponse {
  session_id: string;
  ws_url: string;
  ws_token?: string;
  fallback_url?: string;
}

export interface TasmeeCorrection {
  word_index: number;
  error_type: string;
  hint?: string;
}

export interface TasmeeFeedbackDeltaEvent {
  type: "feedback.delta";
  session_id: string;
  seq_ack?: number;
  start_anchor_word_index?: number;
  start_anchor_confidence?: number;
  confirmed_word_indexes?: number[];
  corrections?: TasmeeCorrection[];
}

export interface TasmeeSessionStopResponse {
  session_id: string;
  status: "stopped";
}
