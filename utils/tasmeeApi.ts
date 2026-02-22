import { Platform } from "react-native";

import type {
  TasmeeChunkUploadRequest,
  TasmeeChunkUploadResponse,
  TasmeeFeedbackDeltaEvent,
  TasmeeSessionCreateRequest,
  TasmeeSessionCreateResponse,
  TasmeeSessionResumeResponse,
  TasmeeSessionStatusEvent,
  TasmeeWsEvent,
  TasmeeWsChunkUploadRequest,
} from "../types/tasmee";

type TokenProvider = (() => Promise<string | null>) | undefined;

type TasmeeSocketHandlers = {
  onDelta: (event: TasmeeFeedbackDeltaEvent) => void;
  onStatus?: (event: TasmeeSessionStatusEvent) => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
};

export interface TasmeeSocketConnection {
  close: () => void;
  isOpen: () => boolean;
  sendJson: (payload: Record<string, unknown>) => boolean;
}

const rawTasmeeBaseUrl = process.env.EXPO_PUBLIC_TASMEE_API_URL?.trim() ?? "";
const rawApiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim() ?? "";

const normalizeApiBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (Platform.OS !== "android") return trimmed;

  if (trimmed.startsWith("http://localhost")) {
    return trimmed.replace("http://localhost", "http://10.0.2.2");
  }
  if (trimmed.startsWith("http://127.0.0.1")) {
    return trimmed.replace("http://127.0.0.1", "http://10.0.2.2");
  }
  if (trimmed.startsWith("https://localhost")) {
    return trimmed.replace("https://localhost", "https://10.0.2.2");
  }
  if (trimmed.startsWith("https://127.0.0.1")) {
    return trimmed.replace("https://127.0.0.1", "https://10.0.2.2");
  }

  return trimmed;
};

const getApiBaseUrl = () => {
  const selected = rawTasmeeBaseUrl || rawApiBaseUrl;
  if (!selected) return null;
  return normalizeApiBaseUrl(selected);
};

const toWebSocketBase = (httpBaseUrl: string) => {
  if (httpBaseUrl.startsWith("https://")) {
    return `wss://${httpBaseUrl.slice("https://".length)}`;
  }
  if (httpBaseUrl.startsWith("http://")) {
    return `ws://${httpBaseUrl.slice("http://".length)}`;
  }
  return httpBaseUrl;
};

const appendQuery = (url: string, key: string, value: string) => {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};

const parseApiError = async (response: Response) => {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body?.detail === "string" && body.detail.length > 0) {
      return body.detail;
    }
  } catch {
    // Ignore parse failures and fallback to status text.
  }
  return `${response.status} ${response.statusText}`.trim();
};

const buildHeaders = async (
  tokenProvider: TokenProvider,
  includeJsonContentType: boolean,
) => {
  const headers = new Headers();

  if (includeJsonContentType) {
    headers.set("Content-Type", "application/json");
  }

  if (tokenProvider) {
    const token = await tokenProvider();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  return headers;
};

export const createTasmeeSession = async (
  payload: TasmeeSessionCreateRequest,
  tokenProvider?: TokenProvider,
): Promise<TasmeeSessionCreateResponse> => {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error("Missing EXPO_PUBLIC_TASMEE_API_URL or EXPO_PUBLIC_API_URL");
  }

  const response = await fetch(`${baseUrl}/v1/tasmee/sessions`, {
    method: "POST",
    headers: await buildHeaders(tokenProvider, true),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const body = (await response.json()) as Partial<TasmeeSessionCreateResponse>;
  if (!body.session_id || typeof body.session_id !== "string") {
    throw new Error("Invalid tasmee session response: missing session_id");
  }

  const fallbackWsUrl = `${toWebSocketBase(baseUrl)}/v1/tasmee/ws`;
  const wsUrl = body.ws_url && typeof body.ws_url === "string" ? body.ws_url : fallbackWsUrl;

  return {
    session_id: body.session_id,
    ws_url: appendQuery(wsUrl, "session_id", body.session_id),
    ws_token: typeof body.ws_token === "string" ? body.ws_token : undefined,
    fallback_url:
      typeof body.fallback_url === "string"
        ? body.fallback_url
        : `${baseUrl}/v1/tasmee/sessions/${encodeURIComponent(body.session_id)}/chunks`,
  };
};

export const stopTasmeeSession = async (
  sessionId: string,
  tokenProvider?: TokenProvider,
) => {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return;

  const response = await fetch(
    `${baseUrl}/v1/tasmee/sessions/${encodeURIComponent(sessionId)}/stop`,
    {
      method: "POST",
      headers: await buildHeaders(tokenProvider, true),
    },
  );

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }
};

export const resumeTasmeeSession = async (
  sessionId: string,
  tokenProvider?: TokenProvider,
): Promise<TasmeeSessionResumeResponse> => {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error("Missing EXPO_PUBLIC_TASMEE_API_URL or EXPO_PUBLIC_API_URL");
  }

  const response = await fetch(
    `${baseUrl}/v1/tasmee/sessions/${encodeURIComponent(sessionId)}/resume`,
    {
      method: "POST",
      headers: await buildHeaders(tokenProvider, true),
    },
  );

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const body = (await response.json()) as Partial<TasmeeSessionResumeResponse>;
  if (typeof body.session_id !== "string" || body.status !== "resumed") {
    throw new Error("Invalid tasmee resume response");
  }
  return {
    session_id: body.session_id,
    status: "resumed",
  };
};

const parseFeedbackDeltaEvent = (payload: string) => {
  const parsed = JSON.parse(payload) as Partial<TasmeeWsEvent>;
  if (!parsed || typeof parsed !== "object") return null;
  if (!parsed.session_id || typeof parsed.session_id !== "string") return null;
  if (parsed.type === "feedback.delta") {
    return parsed as TasmeeFeedbackDeltaEvent;
  }
  if (parsed.type === "session.status") {
    if (
      parsed.state === "listening" ||
      parsed.state === "reciting" ||
      parsed.state === "silent" ||
      parsed.state === "paused" ||
      parsed.state === "processing"
    ) {
      return parsed as TasmeeSessionStatusEvent;
    }
  }
  return null;
};

export const openTasmeeSocket = (
  session: TasmeeSessionCreateResponse,
  handlers: TasmeeSocketHandlers,
): TasmeeSocketConnection => {
  const socketUrl = session.ws_token
    ? appendQuery(session.ws_url, "token", session.ws_token)
    : session.ws_url;
  const socket = new WebSocket(socketUrl);

  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;

    try {
      const delta = parseFeedbackDeltaEvent(event.data);
      if (!delta) return;
      if (delta.type === "feedback.delta") {
        handlers.onDelta(delta);
        return;
      }
      if (handlers.onStatus) {
        handlers.onStatus(delta);
      }
    } catch (error) {
      if (handlers.onError) {
        handlers.onError(
          error instanceof Error
            ? error
            : new Error("Failed to parse tasmee websocket event"),
        );
      }
    }
  };

  socket.onerror = () => {
    if (handlers.onError) {
      handlers.onError(new Error("Tasmee websocket connection error"));
    }
  };

  socket.onclose = () => {
    if (handlers.onClose) {
      handlers.onClose();
    }
  };

  return {
    close: () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
    isOpen: () => socket.readyState === WebSocket.OPEN,
    sendJson: (payload: Record<string, unknown>) => {
      if (socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(payload));
      return true;
    },
  };
};

export const sendTasmeeChunkOverSocket = (
  socket: TasmeeSocketConnection | null,
  payload: TasmeeWsChunkUploadRequest,
) => {
  if (!socket || !socket.isOpen()) return false;
  return socket.sendJson(payload as unknown as Record<string, unknown>);
};

export const uploadTasmeeChunk = async (
  sessionId: string,
  payload: TasmeeChunkUploadRequest,
  session?: Pick<TasmeeSessionCreateResponse, "fallback_url"> | null,
  tokenProvider?: TokenProvider,
): Promise<TasmeeChunkUploadResponse> => {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error("Missing EXPO_PUBLIC_TASMEE_API_URL or EXPO_PUBLIC_API_URL");
  }

  const fallbackUrl =
    typeof session?.fallback_url === "string" && session.fallback_url.length > 0
      ? session.fallback_url
      : `${baseUrl}/v1/tasmee/sessions/${encodeURIComponent(sessionId)}/chunks`;

  const response = await fetch(fallbackUrl, {
    method: "POST",
    headers: await buildHeaders(tokenProvider, true),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const body = (await response.json()) as Partial<TasmeeChunkUploadResponse>;
  if (
    typeof body.session_id !== "string" ||
    !Number.isFinite(body.seq_ack) ||
    typeof body.accepted !== "boolean"
  ) {
    throw new Error("Invalid tasmee chunk response");
  }

  const seqAck = Number(body.seq_ack);
  return {
    session_id: body.session_id,
    seq_ack: seqAck,
    accepted: body.accepted,
  };
};
