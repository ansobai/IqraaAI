export type TasmeeSessionStatus =
  | "idle"
  | "starting"
  | "listening"
  | "active"
  | "paused"
  | "stopped"
  | "error";

export type TasmeeTransportMode = "websocket" | "http";

export type TasmeeFeedbackState =
  | "listening"
  | "reciting"
  | "silent"
  | "paused"
  | "processing";

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

export type TasmeeDebugPayload = {
  recognizer_mode?: string;
  speech_gate_mode?: string;
  hard_gate_open?: boolean;
  level_db?: number | null;
  payload_has_speech?: boolean | null;
  recognizer_has_speech?: boolean | null;
  recited_token_count?: number;
  anchor_word_index?: number | null;
  anchor_verse_end_word_index?: number | null;
  match_score?: number | null;
  rate_limited?: boolean;
  timing?: {
    decode_ms?: number;
    recognize_ms?: number;
    match_ms?: number;
    total_ms?: number;
  };
};

export interface TasmeeFeedbackDeltaEvent {
  type: "feedback.delta";
  session_id: string;
  recognizer_mode?: string;
  seq_ack?: number;
  chunk_seq?: number;
  has_speech?: boolean;
  confidence?: number;
  start_anchor_word_index?: number;
  start_anchor_confidence?: number;
  confirmed_word_indexes?: number[];
  corrections?: TasmeeCorrection[];
  ts_ms?: number;
  debug?: TasmeeDebugPayload;
}

export interface TasmeeSessionStatusEvent {
  type: "session.status";
  session_id: string;
  recognizer_mode?: string;
  state: TasmeeFeedbackState;
  has_speech: boolean;
  level_db?: number;
  pause_reason?: "silence_timeout";
  silence_ms?: number;
  seq_ack?: number;
  ts_ms: number;
  capabilities?: {
    ws_audio_upload?: boolean;
  };
  debug?: TasmeeDebugPayload;
}

export type TasmeeWsEvent = TasmeeFeedbackDeltaEvent | TasmeeSessionStatusEvent;

export interface TasmeeChunkUploadRequest {
  seq: number;
  audio_base64: string;
  mime_type: string;
  duration_ms: number;
  level_db?: number;
  has_speech?: boolean;
  client_chunk_started_at_ms?: number;
  client_chunk_ended_at_ms?: number;
  client_sent_at_ms?: number;
}

export interface TasmeeWsChunkUploadRequest extends TasmeeChunkUploadRequest {
  type: "chunk.upload";
}

export interface TasmeeChunkUploadResponse {
  session_id: string;
  seq_ack: number;
  accepted: boolean;
}

export interface TasmeeSessionStopResponse {
  session_id: string;
  status: "stopped";
}

export interface TasmeeSessionResumeResponse {
  session_id: string;
  status: "resumed";
}
