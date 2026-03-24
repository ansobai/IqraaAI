from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import json
import logging
import os
import secrets
import statistics
import threading
import time
import uuid
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Dict, Optional

import anyio
import asyncpg
import jwt
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from jwt import PyJWKClient
from pydantic import BaseModel, Field

from .tasmee_alignment import align_recitation
from .tasmee_engine import (
    BaseTasmeeRecognizer,
    ChunkRecognitionInput,
    ChunkRecognitionResult,
    create_tasmee_recognizer,
)
from .tasmee_matching import (
    best_reference_prefix_match,
    build_verse_spans,
    find_best_verse_span_match,
    merge_recited_tokens,
)
from .tasmee_page_lexicon import load_page_lexicon

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.85
HEARTBEAT_INTERVAL_SECONDS = 1.0
SILENCE_WINDOW_SECONDS = 1.2
MAX_EVENT_QUEUE_SIZE = 64
SESSION_MAX_AGE_SECONDS = 3600


def _float_env(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("invalid %s=%s, using default=%s", name, raw, default)
        return default


def _int_env(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("invalid %s=%s, using default=%s", name, raw, default)
        return default


def _bool_env(name: str, default: bool = False) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


HARD_SPEECH_LEVEL_DB_THRESHOLD = _float_env(
    "TASMEE_HARD_SPEECH_LEVEL_DB_THRESHOLD",
    -35.0,
)
PAUSE_AFTER_SILENCE_SECONDS = _float_env("TASMEE_PAUSE_SILENCE_SECONDS", 10.0)
ANCHOR_MIN_WORDS = max(1, _int_env("TASMEE_ANCHOR_MIN_WORDS", 3))
RECOGNIZER_MODE = (os.getenv("TASMEE_RECOGNIZER_MODE") or "heuristic").strip().lower() or "heuristic"
RECOGNIZER_SHADOW = _bool_env("TASMEE_RECOGNIZER_SHADOW", False)
VERSE_MATCH_THRESHOLD = _float_env("TASMEE_VERSE_MATCH_THRESHOLD", 0.90)
MATCH_SLACK = max(0, _int_env("TASMEE_MATCH_SLACK", 2))
MAX_TOKEN_BUFFER = max(1, _int_env("TASMEE_MAX_TOKEN_BUFFER", 256))
MAX_ANCHOR_TOKENS = max(1, _int_env("TASMEE_MAX_ANCHOR_TOKENS", 16))
FUZZY_OVERLAP_MAX_DISTANCE = max(0, _int_env("TASMEE_FUZZY_OVERLAP_MAX_DISTANCE", 0))
PARTIAL_PROGRESS_MIN_STABILITY = max(
    0.0,
    min(1.0, _float_env("TASMEE_PARTIAL_PROGRESS_MIN_STABILITY", 0.55)),
)
PARTIAL_ANCHOR_MIN_TOKENS = max(
    1,
    _int_env("TASMEE_PARTIAL_ANCHOR_MIN_TOKENS", ANCHOR_MIN_WORDS),
)
PARTIAL_TRACK_MIN_TOKENS = max(1, _int_env("TASMEE_PARTIAL_TRACK_MIN_TOKENS", 2))
REQUIRE_AUTH = _bool_env("TASMEE_REQUIRE_AUTH", True)
WS_TOKEN_TTL_SECONDS = max(30, _int_env("TASMEE_WS_TOKEN_TTL_SECONDS", 900))
MAX_CHUNK_BYTES = max(1, _int_env("TASMEE_MAX_CHUNK_BYTES", 2_000_000))
RATE_LIMIT_CHUNKS_PER_SECOND = max(0.1, _float_env("TASMEE_RATE_LIMIT_CHUNKS_PER_SECOND", 8.0))
RATE_LIMIT_BURST = max(1.0, _float_env("TASMEE_RATE_LIMIT_BURST", 20.0))
PRUNE_INTERVAL_SECONDS = max(10, _int_env("TASMEE_PRUNE_INTERVAL_SECONDS", 60))
WS_AUDIO_UPLOAD_ENABLED = _bool_env("TASMEE_WS_AUDIO_UPLOAD_ENABLED", True)
MAX_ACTIVE_SESSIONS = max(1, _int_env("TASMEE_MAX_ACTIVE_SESSIONS", 5000))
RECOGNIZER_MAX_INFLIGHT = max(1, _int_env("TASMEE_RECOGNIZER_MAX_INFLIGHT", 8))
RECOGNIZER_QUEUE_TIMEOUT_SECONDS = max(
    0.01,
    _float_env("TASMEE_RECOGNIZER_QUEUE_TIMEOUT_SECONDS", 0.25),
)
RECOGNIZER_HARD_TIMEOUT_SECONDS = max(
    0.05,
    _float_env("TASMEE_RECOGNIZER_HARD_TIMEOUT_SECONDS", 3.0),
)
DEGRADE_ON_RECOGNIZER_STALL = _bool_env("TASMEE_DEGRADE_ON_RECOGNIZER_STALL", True)


class TasmeeSessionCreateRequest(BaseModel):
    page_number: int = Field(ge=1)
    surah_id: int = Field(ge=1)


class TasmeeSessionCreateResponse(BaseModel):
    session_id: str
    ws_url: str
    ws_token: Optional[str] = None
    fallback_url: Optional[str] = None


class TasmeeSessionStopResponse(BaseModel):
    session_id: str
    status: str = "stopped"


class TasmeeSessionResumeResponse(BaseModel):
    session_id: str
    status: str = "resumed"


class TasmeeChunkUploadRequest(BaseModel):
    seq: int = Field(ge=0)
    audio_base64: str = Field(min_length=1)
    mime_type: str = Field(default="audio/mp4", min_length=1)
    duration_ms: int = Field(ge=1)
    level_db: float | None = None
    has_speech: bool | None = None
    client_chunk_started_at_ms: int | None = None
    client_chunk_ended_at_ms: int | None = None
    client_sent_at_ms: int | None = None


class TasmeeChunkUploadResponse(BaseModel):
    session_id: str
    seq_ack: int
    accepted: bool


class TasmeeWsChunkUploadRequest(TasmeeChunkUploadRequest):
    type: str = Field(default="chunk.upload")


@dataclass
class SessionState:
    page_number: int
    surah_id: int
    created_at: float
    stopped: bool = False
    last_seq_ack: int = -1
    speech_open: bool = False
    last_speech_ts: float | None = None
    anchor_set: bool = False
    next_word_index: int = 0
    chunks_received: int = 0
    chunks_with_speech: int = 0
    deltas_emitted: int = 0
    deltas_blocked_by_gate: int = 0
    paused: bool = False
    pause_reason: str | None = None
    paused_at: float | None = None
    recitation_state: str = "awaiting_anchor"
    anchor_word_index: int | None = None
    anchor_verse_end_word_index: int | None = None
    page_words: list[str] = field(default_factory=list)
    verse_start_word_indexes: list[int] = field(default_factory=list)
    verse_spans: list[tuple[int, int]] = field(default_factory=list)
    recited_tokens: list[str] = field(default_factory=list)
    recognizer_mode: str = "heuristic"
    shadow_mode: bool = False
    clerk_user_id: str | None = None
    attempt_id: str | None = None
    transport_mode: str = "http"
    max_confirmed_word_index: int = -1
    confirmed_word_count: int = 0
    latency_total_ms_samples: list[float] = field(default_factory=list)
    rate_limit_tokens: float = RATE_LIMIT_BURST
    rate_limit_updated_at: float = field(default_factory=time.time)
    recognizer_timeouts: int = 0
    recognizer_backpressure: int = 0
    degraded_fallbacks: int = 0
    listener_event_drops: int = 0
    last_degraded_reason: str | None = None
    listeners: set[asyncio.Queue[dict]] = field(default_factory=set, repr=False)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)


@dataclass
class TasmeeLoadState:
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    recognizer_inflight: int = 0
    recognizer_queue_depth: int = 0
    recognizer_backpressure: int = 0
    recognizer_timeouts: int = 0
    degraded_fallbacks: int = 0

    def add(self, key: str, delta: int = 1) -> None:
        with self.lock:
            current = int(getattr(self, key))
            setattr(self, key, max(0, current + delta))

    def snapshot(self) -> dict[str, int]:
        with self.lock:
            return {
                "recognizer_inflight": self.recognizer_inflight,
                "recognizer_queue_depth": self.recognizer_queue_depth,
                "recognizer_backpressure": self.recognizer_backpressure,
                "recognizer_timeouts": self.recognizer_timeouts,
                "degraded_fallbacks": self.degraded_fallbacks,
            }


class SessionStore:
    def __init__(self, recognizer_mode: str = "heuristic", shadow_mode: bool = False):
        self._sessions: Dict[str, SessionState] = {}
        self._ws_tokens: Dict[str, tuple[str, str | None, float]] = {}
        self._lock = asyncio.Lock()
        self._recognizer_mode = recognizer_mode
        self._shadow_mode = shadow_mode

    async def create(
        self,
        page_number: int,
        surah_id: int,
        *,
        clerk_user_id: str | None = None,
        attempt_id: str | None = None,
    ) -> str:
        lexicon = load_page_lexicon(page_number)
        spans = build_verse_spans(len(lexicon.words), lexicon.verse_start_word_indexes)

        async with self._lock:
            active_sessions = sum(1 for session in self._sessions.values() if not session.stopped)
            if active_sessions >= MAX_ACTIVE_SESSIONS:
                raise RuntimeError("tasmee overloaded: active session limit reached")
            session_id = str(uuid.uuid4())
            self._sessions[session_id] = SessionState(
                page_number=page_number,
                surah_id=surah_id,
                created_at=time.time(),
                page_words=lexicon.words,
                verse_start_word_indexes=lexicon.verse_start_word_indexes,
                verse_spans=spans,
                recognizer_mode=self._recognizer_mode,
                shadow_mode=self._shadow_mode,
                clerk_user_id=clerk_user_id,
                attempt_id=attempt_id,
            )
            return session_id

    async def get(self, session_id: str) -> Optional[SessionState]:
        async with self._lock:
            return self._sessions.get(session_id)

    async def stop(self, session_id: str) -> Optional[SessionState]:
        async with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return None
            session.stopped = True
            self._clear_ws_tokens_locked(session_id)
            return session

    async def mint_ws_token(
        self,
        *,
        session_id: str,
        clerk_user_id: str | None,
        ttl_seconds: int = WS_TOKEN_TTL_SECONDS,
    ) -> str:
        token = secrets.token_urlsafe(24)
        expires_at = time.time() + ttl_seconds
        async with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise RuntimeError("session not found while minting ws token")
            self._ws_tokens[token] = (session_id, clerk_user_id, expires_at)
        return token

    async def validate_ws_token(
        self,
        *,
        session_id: str,
        token: str | None,
    ) -> bool:
        if not token:
            return False
        now = time.time()
        async with self._lock:
            stored = self._ws_tokens.get(token)
            if stored is None:
                return False
            token_session_id, _, expires_at = stored
            if token_session_id != session_id or expires_at < now:
                self._ws_tokens.pop(token, None)
                return False
            return True

    async def register_listener(self, session_id: str) -> Optional[asyncio.Queue[dict]]:
        async with self._lock:
            session = self._sessions.get(session_id)
            if not session or session.stopped:
                return None
            queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=MAX_EVENT_QUEUE_SIZE)
            session.listeners.add(queue)
            return queue

    async def unregister_listener(self, session_id: str, queue: asyncio.Queue[dict]) -> None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return
            session.listeners.discard(queue)

    async def broadcast_event(self, session_id: str, event: dict) -> None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return
            listeners = list(session.listeners)

        for queue in listeners:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    # Drop event if consumer is too slow.
                    session.listener_event_drops += 1

    async def stats(self) -> dict[str, int]:
        async with self._lock:
            active_sessions = sum(1 for session in self._sessions.values() if not session.stopped)
            total_listeners = sum(len(session.listeners) for session in self._sessions.values())
            total_listener_drops = sum(
                session.listener_event_drops for session in self._sessions.values()
            )
            return {
                "active_sessions": active_sessions,
                "stored_sessions": len(self._sessions),
                "active_ws_listeners": total_listeners,
                "listener_event_drops": total_listener_drops,
                "issued_ws_tokens": len(self._ws_tokens),
            }

    def _prune_locked(self, max_age_seconds: int) -> None:
        now = time.time()
        expired = [
            session_id
            for session_id, session in self._sessions.items()
            if session.stopped or now - session.created_at > max_age_seconds
        ]
        for session_id in expired:
            self._clear_ws_tokens_locked(session_id)
            self._sessions.pop(session_id, None)

    async def prune_expired(self, max_age_seconds: int) -> list[tuple[str, SessionState]]:
        now = time.time()
        async with self._lock:
            expired_ids = [
                session_id
                for session_id, session in self._sessions.items()
                if session.stopped or now - session.created_at > max_age_seconds
            ]
            removed: list[tuple[str, SessionState]] = []
            for session_id in expired_ids:
                session = self._sessions.pop(session_id, None)
                if session is None:
                    continue
                self._clear_ws_tokens_locked(session_id)
                removed.append((session_id, session))
            return removed

    def _clear_ws_tokens_locked(self, session_id: str) -> None:
        stale_tokens = [
            token
            for token, (token_session_id, _, _) in self._ws_tokens.items()
            if token_session_id == session_id
        ]
        for token in stale_tokens:
            self._ws_tokens.pop(token, None)


def _parse_cors_origins() -> list[str]:
    raw = os.getenv("TASMEE_CORS_ORIGINS") or os.getenv("CORS_ORIGINS") or "*"
    parsed = [item.strip() for item in raw.split(",") if item.strip()]
    return parsed or ["*"]


def _public_base_urls(request: Request) -> tuple[str, str]:
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip().lower()
    is_https = forwarded_proto == "https"

    host = (
        request.headers.get("x-forwarded-host")
        or request.headers.get("host")
        or request.url.netloc
    )

    http_scheme = "https" if is_https else "http"
    ws_scheme = "wss" if is_https else "ws"
    http_base = f"{http_scheme}://{host}".rstrip("/")
    ws_base = f"{ws_scheme}://{host}".rstrip("/")
    return http_base, ws_base


def _now_ms() -> int:
    return int(time.time() * 1000)


def _session_feedback_state(session: SessionState, now: float) -> str:
    if session.paused:
        return "paused"
    if session.chunks_received == 0:
        return "listening"
    if session.last_speech_ts and now - session.last_speech_ts <= SILENCE_WINDOW_SECONDS:
        return "reciting"
    return "silent"


def _build_status_event(
    session_id: str,
    session: SessionState,
    state: str | None = None,
    has_speech: bool | None = None,
    level_db: float | None = None,
    pause_reason: str | None = None,
    silence_ms: int | None = None,
    capabilities: dict | None = None,
) -> dict:
    now = time.time()
    resolved_state = state or _session_feedback_state(session, now)
    recent_speech = (
        session.last_speech_ts is not None
        and now - session.last_speech_ts <= SILENCE_WINDOW_SECONDS
    )

    event: dict = {
        "type": "session.status",
        "session_id": session_id,
        "recognizer_mode": session.recognizer_mode,
        "state": resolved_state,
        "has_speech": has_speech if has_speech is not None else recent_speech,
        "level_db": level_db,
        "seq_ack": session.last_seq_ack,
        "ts_ms": _now_ms(),
    }
    if capabilities:
        event["capabilities"] = capabilities

    if session.last_degraded_reason:
        event["degraded"] = True
        event["degraded_reason"] = session.last_degraded_reason

    if resolved_state == "paused":
        resolved_pause_reason = pause_reason or session.pause_reason or "silence_timeout"
        event["pause_reason"] = resolved_pause_reason

        if silence_ms is None and session.last_speech_ts is not None:
            silence_ms = int(max(0, (now - session.last_speech_ts) * 1000))
        if silence_ms is not None:
            event["silence_ms"] = silence_ms

    return event


def _decode_audio_base64(audio_base64: str) -> bytes:
    try:
        return base64.b64decode(audio_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="Invalid audio_base64 payload") from error


@dataclass(frozen=True)
class TasmeeAuthSettings:
    require_auth: bool
    clerk_issuer: str | None
    clerk_audience: str | None


@lru_cache(maxsize=8)
def _jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url)


def _jwks_url(issuer: str) -> str:
    return issuer.rstrip("/") + "/.well-known/jwks.json"


def _resolve_auth_settings() -> TasmeeAuthSettings:
    require_auth = _bool_env("TASMEE_REQUIRE_AUTH", REQUIRE_AUTH)
    issuer = (os.getenv("CLERK_ISSUER") or "").strip().rstrip("/") or None
    audience = (os.getenv("CLERK_AUDIENCE") or "").strip() or None
    return TasmeeAuthSettings(
        require_auth=require_auth,
        clerk_issuer=issuer,
        clerk_audience=audience,
    )


def _verify_clerk_token(token: str, settings: TasmeeAuthSettings) -> str:
    if not settings.clerk_issuer:
        raise HTTPException(status_code=500, detail="Missing CLERK_ISSUER for tasmee auth")
    jwks_url = _jwks_url(settings.clerk_issuer)
    try:
        signing_key = _jwks_client(jwks_url).get_signing_key_from_jwt(token).key
        decoded = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer,
            audience=settings.clerk_audience if settings.clerk_audience else None,
            options={"verify_aud": bool(settings.clerk_audience)},
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    sub = decoded.get("sub")
    if not isinstance(sub, str) or not sub.strip():
        raise HTTPException(status_code=401, detail="Invalid token")
    return sub.strip()


def _extract_bearer_token(authorization_header: str | None) -> str | None:
    if not authorization_header:
        return None
    parts = authorization_header.strip().split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def _resolve_user_id_from_authorization(
    authorization_header: str | None,
    auth_settings: TasmeeAuthSettings,
) -> str | None:
    if not auth_settings.require_auth:
        return None
    token = _extract_bearer_token(authorization_header)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return _verify_clerk_token(token, auth_settings)


def _assert_session_owner(session: SessionState, resolved_user_id: str | None) -> None:
    if session.clerk_user_id is None:
        return
    if not resolved_user_id:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    if session.clerk_user_id != resolved_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")


def _record_confirmed_progress(session: SessionState, confirmed_word_indexes: list[int]) -> None:
    if not confirmed_word_indexes:
        return
    session.max_confirmed_word_index = max(
        session.max_confirmed_word_index,
        max(confirmed_word_indexes),
    )
    session.confirmed_word_count = max(
        session.confirmed_word_count,
        session.max_confirmed_word_index + 1,
    )


def _consume_rate_limit_token(session: SessionState, now: float) -> bool:
    elapsed = max(0.0, now - session.rate_limit_updated_at)
    refilled = elapsed * RATE_LIMIT_CHUNKS_PER_SECOND
    session.rate_limit_tokens = min(RATE_LIMIT_BURST, session.rate_limit_tokens + refilled)
    session.rate_limit_updated_at = now
    if session.rate_limit_tokens < 1.0:
        return False
    session.rate_limit_tokens -= 1.0
    return True


def _p95(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(round(0.95 * len(ordered))) - 1))
    return float(ordered[index])


@dataclass(frozen=True)
class SpeechGateDecision:
    open: bool
    hard_gate_open: bool
    mode: str
    speech_hint_from_client: bool
    speech_meter_from_client: bool
    speech_stt_output: bool


def _resolve_speech_gate_mode(raw: str | None) -> str:
    normalized = (raw or "auto").strip().lower()
    allowed = {"auto", "strict_meter", "client_hint", "stt_output"}
    return normalized if normalized in allowed else "auto"


def _speech_gate_decision(
    *,
    mode: str,
    alignment_mode: bool,
    payload_has_speech: bool | None,
    payload_level_db: float | None,
    recognition: ChunkRecognitionResult | None,
) -> SpeechGateDecision:
    speech_hint = payload_has_speech is True
    speech_meter = payload_level_db is not None and payload_level_db >= HARD_SPEECH_LEVEL_DB_THRESHOLD
    hard_gate_open = speech_hint and speech_meter

    has_tokens = bool(getattr(recognition, "recognized_tokens", None) or [])
    has_transcript = bool((getattr(recognition, "transcript", None) or "").strip())
    speech_stt_output = bool(alignment_mode and (has_tokens or has_transcript))

    resolved = _resolve_speech_gate_mode(mode)

    if resolved == "strict_meter":
        open_gate = speech_meter
    elif resolved == "client_hint":
        open_gate = speech_hint
    elif resolved == "stt_output":
        open_gate = speech_stt_output
    else:
        # auto: keep heuristic strict; allow alignment modes to proceed with any
        # reasonable speech signal (meter/hint/STT output).
        open_gate = (
            (speech_hint and speech_meter)
            if not alignment_mode
            else (speech_hint or speech_meter or speech_stt_output)
        )

    return SpeechGateDecision(
        open=open_gate,
        hard_gate_open=hard_gate_open,
        mode=resolved,
        speech_hint_from_client=speech_hint,
        speech_meter_from_client=speech_meter,
        speech_stt_output=speech_stt_output,
    )


@dataclass(frozen=True)
class ProgressUpdate:
    confirmed_word_indexes: list[int]
    confidence: float
    start_anchor_word_index: int | None = None
    start_anchor_confidence: float | None = None


def _is_alignment_mode(mode: str) -> bool:
    return mode.strip().lower() in {"google", "remote", "remote_ws", "openai"}


def _apply_alignment_progress(session: SessionState, recognition: ChunkRecognitionResult) -> ProgressUpdate:
    if recognition.recognized_tokens:
        effective_max_tokens = max(MAX_TOKEN_BUFFER, len(session.page_words) + 32)
        session.recited_tokens = merge_recited_tokens(
            session.recited_tokens,
            recognition.recognized_tokens,
            max_overlap=8,
            max_tokens=effective_max_tokens,
            fuzzy_overlap_max_distance=FUZZY_OVERLAP_MAX_DISTANCE,
        )

    if not session.page_words or not session.recited_tokens:
        return ProgressUpdate(confirmed_word_indexes=[], confidence=0.0)

    start_anchor_word_index: int | None = None
    start_anchor_confidence: float | None = None

    if session.recitation_state != "tracking":
        # Use the most recent partial tokens for anchor detection.
        anchor_spoken = session.recited_tokens[-MAX_ANCHOR_TOKENS:]
        if len(anchor_spoken) < ANCHOR_MIN_WORDS:
            return ProgressUpdate(confirmed_word_indexes=[], confidence=0.0)

        candidate_spans = session.verse_spans
        # After completing a verse, prefer re-locking forward on the page.
        if session.next_word_index > 0 and session.verse_spans:
            min_start = max(0, session.next_word_index - MATCH_SLACK)
            candidate_spans = [span for span in session.verse_spans if span[0] >= min_start]
            if not candidate_spans:
                candidate_spans = session.verse_spans

        anchor_start, anchor_end, anchor_match = find_best_verse_span_match(
            session.page_words,
            candidate_spans,
            anchor_spoken,
            slack=MATCH_SLACK,
        )

        if (
            anchor_start is None
            or anchor_end is None
            or anchor_match.score < VERSE_MATCH_THRESHOLD
            or anchor_match.matched_reference_words < ANCHOR_MIN_WORDS
        ):
            return ProgressUpdate(
                confirmed_word_indexes=[],
                confidence=anchor_match.score,
            )

        session.anchor_set = True
        session.anchor_word_index = anchor_start
        session.anchor_verse_end_word_index = anchor_end
        session.recitation_state = "tracking"
        session.next_word_index = anchor_start
        # Reset buffer so tracking compares spoken tokens against the anchored verse.
        session.recited_tokens = list(anchor_spoken)

        start_anchor_word_index = anchor_start
        start_anchor_confidence = anchor_match.score

    anchor_start = session.anchor_word_index
    if (
        anchor_start is None
        or anchor_start < 0
        or anchor_start >= len(session.page_words)
    ):
        return ProgressUpdate(confirmed_word_indexes=[], confidence=0.0)

    anchor_end = session.anchor_verse_end_word_index or len(session.page_words)
    anchor_end = max(anchor_start + 1, min(anchor_end, len(session.page_words)))

    if session.next_word_index >= anchor_end:
        # Verse complete: re-lock on next verse when recited.
        session.anchor_set = False
        session.anchor_word_index = None
        session.anchor_verse_end_word_index = None
        session.recitation_state = "awaiting_anchor"
        session.recited_tokens = []
        return ProgressUpdate(confirmed_word_indexes=[], confidence=0.0)

    reference_words = session.page_words[anchor_start:anchor_end]
    verse_len = len(reference_words)
    spoken_for_match = session.recited_tokens[:verse_len] if verse_len > 0 else session.recited_tokens
    match = best_reference_prefix_match(reference_words, spoken_for_match, slack=MATCH_SLACK)
    confidence = match.score
    if confidence < VERSE_MATCH_THRESHOLD:
        return ProgressUpdate(
            confirmed_word_indexes=[],
            confidence=confidence,
            start_anchor_word_index=start_anchor_word_index,
            start_anchor_confidence=start_anchor_confidence,
        )

    candidate_next = min(anchor_start + match.matched_reference_words, anchor_end)
    old_next = max(anchor_start, session.next_word_index)
    new_next = max(old_next, candidate_next)
    confirmed = list(range(old_next, new_next))
    if not confirmed:
        return ProgressUpdate(
            confirmed_word_indexes=[],
            confidence=confidence,
            start_anchor_word_index=start_anchor_word_index,
            start_anchor_confidence=start_anchor_confidence,
        )

    session.next_word_index = new_next

    if session.next_word_index >= anchor_end:
        overflow_tokens = session.recited_tokens[verse_len:] if verse_len > 0 else []
        session.anchor_set = False
        session.anchor_word_index = None
        session.anchor_verse_end_word_index = None
        session.recitation_state = "awaiting_anchor"
        # Keep any overflow so we can immediately re-lock the next verse if the
        # chunk crossed the verse boundary.
        session.recited_tokens = overflow_tokens[-MAX_ANCHOR_TOKENS:]

    return ProgressUpdate(
        confirmed_word_indexes=confirmed,
        confidence=confidence,
        start_anchor_word_index=start_anchor_word_index,
        start_anchor_confidence=start_anchor_confidence,
    )


def _apply_heuristic_progress(session: SessionState, recognition: ChunkRecognitionResult) -> ProgressUpdate:
    if recognition.start_anchor_word_index is not None:
        session.anchor_set = True
        session.anchor_word_index = recognition.start_anchor_word_index
        session.recitation_state = "tracking"

    confirmed = recognition.confirmed_word_indexes
    if confirmed:
        session.next_word_index = confirmed[-1] + 1

    return ProgressUpdate(
        confirmed_word_indexes=confirmed,
        confidence=recognition.confidence,
        start_anchor_word_index=recognition.start_anchor_word_index,
        start_anchor_confidence=recognition.start_anchor_confidence,
    )


def _apply_progress_from_recognition(
    session: SessionState,
    recognition: ChunkRecognitionResult,
) -> ProgressUpdate:
    if _is_alignment_mode(session.recognizer_mode):
        return _apply_alignment_progress(session, recognition)
    return _apply_heuristic_progress(session, recognition)


def _allow_alignment_partial_progress(
    session: SessionState,
    recognition: ChunkRecognitionResult,
) -> bool:
    if recognition.token_source != "partial":
        return True
    tokens = recognition.recognized_tokens or []
    if not tokens:
        return False

    min_tokens = (
        PARTIAL_TRACK_MIN_TOKENS
        if session.recitation_state == "tracking"
        else PARTIAL_ANCHOR_MIN_TOKENS
    )
    if len(tokens) < min_tokens:
        return False

    if recognition.partial_stability is None:
        return True
    return recognition.partial_stability >= PARTIAL_PROGRESS_MIN_STABILITY


def _apply_shadow_recognition(
    session: SessionState,
    payload: ChunkRecognitionInput,
    shadow_recognizer: BaseTasmeeRecognizer | None,
) -> None:
    if not session.shadow_mode or shadow_recognizer is None:
        return

    try:
        shadow = shadow_recognizer.analyze_chunk(payload)
        awaiting_anchor = session.recitation_state != "tracking"
        alignment = align_recitation(
            page_words=session.page_words,
            verse_start_word_indexes=session.verse_start_word_indexes,
            spoken_words=shadow.recognized_tokens,
            next_word_index=session.next_word_index,
            awaiting_anchor=awaiting_anchor,
            min_anchor_words=ANCHOR_MIN_WORDS,
        )
        logger.info(
            "tasmee shadow: %s",
            json.dumps(
                {
                    "page_number": session.page_number,
                    "next_word_index": session.next_word_index,
                    "tokens": shadow.recognized_tokens,
                    "anchor": alignment.start_anchor_word_index,
                    "confirmed": alignment.confirmed_word_indexes,
                },
                ensure_ascii=False,
            ),
        )
    except Exception as error:  # pragma: no cover - defensive logging path
        logger.warning("tasmee shadow recognizer failed: %s", error)


def _pause_session_for_silence(session: SessionState, now: float) -> bool:
    if session.paused:
        return True
    if session.last_speech_ts is None:
        return False
    if now - session.last_speech_ts < PAUSE_AFTER_SILENCE_SECONDS:
        return False

    session.paused = True
    session.pause_reason = "silence_timeout"
    session.paused_at = now
    session.speech_open = False
    return True


def create_app(
    recognizer_override: BaseTasmeeRecognizer | None = None,
    recognizer_mode_override: str | None = None,
    shadow_recognizer_override: BaseTasmeeRecognizer | None = None,
) -> FastAPI:
    app = FastAPI(title="IqraaAI Tasmee Service")

    recognizer_mode = (recognizer_mode_override or RECOGNIZER_MODE).strip().lower() or "heuristic"
    debug_events_enabled = _bool_env("TASMEE_DEBUG_EVENTS", False)
    speech_gate_mode = _resolve_speech_gate_mode(os.getenv("TASMEE_SPEECH_GATE_MODE"))
    shadow_mode = (
        bool(shadow_recognizer_override)
        if shadow_recognizer_override is not None
        else (RECOGNIZER_SHADOW and recognizer_mode != "google")
    )
    store = SessionStore(
        recognizer_mode=recognizer_mode,
        shadow_mode=shadow_mode,
    )
    auth_settings = _resolve_auth_settings()
    recognizer = recognizer_override or create_tasmee_recognizer(recognizer_mode)
    shadow_recognizer = (
        shadow_recognizer_override
        if shadow_recognizer_override is not None
        else (
            create_tasmee_recognizer("google")
            if shadow_mode and recognizer_mode != "google"
            else None
        )
    )
    load_state = TasmeeLoadState()
    recognizer_slots = asyncio.Semaphore(RECOGNIZER_MAX_INFLIGHT)

    def _fallback_recognition_for_payload(
        payload: TasmeeChunkUploadRequest,
    ) -> ChunkRecognitionResult:
        resolved_level_db = (
            float(payload.level_db)
            if payload.level_db is not None
            else (-35.0 if payload.has_speech is True else -120.0)
        )
        has_speech = (
            payload.has_speech
            if payload.has_speech is not None
            else resolved_level_db >= HARD_SPEECH_LEVEL_DB_THRESHOLD
        )
        return ChunkRecognitionResult(
            has_speech=bool(has_speech),
            confidence=0.0,
            level_db=resolved_level_db,
            confirmed_word_indexes=[],
            transcript=None,
            recognized_tokens=[],
            token_source="fallback",
        )

    async def _analyze_with_limits(
        *,
        payload: TasmeeChunkUploadRequest,
        recognition_input: ChunkRecognitionInput,
    ) -> tuple[ChunkRecognitionResult, str | None]:
        load_state.add("recognizer_queue_depth", 1)
        try:
            try:
                await asyncio.wait_for(
                    recognizer_slots.acquire(),
                    timeout=RECOGNIZER_QUEUE_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                load_state.add("recognizer_backpressure", 1)
                if not DEGRADE_ON_RECOGNIZER_STALL:
                    raise
                return _fallback_recognition_for_payload(payload), "recognizer_backpressure"
        finally:
            load_state.add("recognizer_queue_depth", -1)

        load_state.add("recognizer_inflight", 1)
        try:
            try:
                result = await asyncio.wait_for(
                    anyio.to_thread.run_sync(
                        recognizer.analyze_chunk,
                        recognition_input,
                    ),
                    timeout=RECOGNIZER_HARD_TIMEOUT_SECONDS,
                )
                return result, None
            except asyncio.TimeoutError:
                load_state.add("recognizer_timeouts", 1)
                if not DEGRADE_ON_RECOGNIZER_STALL:
                    raise
                return _fallback_recognition_for_payload(payload), "recognizer_timeout"
            except Exception as exc:
                logger.warning("tasmee recognizer failed: %s", exc)
                if not DEGRADE_ON_RECOGNIZER_STALL:
                    raise
                return _fallback_recognition_for_payload(payload), "recognizer_error"
        finally:
            load_state.add("recognizer_inflight", -1)
            recognizer_slots.release()

    cors_origins = _parse_cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials="*" not in cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    async def _insert_attempt_row(session_id: str, session: SessionState) -> None:
        attempt_id = session.attempt_id
        if not attempt_id:
            return
        pool: asyncpg.Pool | None = getattr(app.state, "db_pool", None)
        if pool is None:
            return
        async with pool.acquire() as conn:
            await conn.execute(
                """
                insert into public.tasmee_attempts (
                    id, session_id, clerk_user_id, page_number, surah_id, recognizer_mode, transport_mode
                ) values ($1::uuid, $2, $3, $4, $5, $6, $7)
                on conflict (id) do nothing
                """,
                attempt_id,
                session_id,
                session.clerk_user_id or "anonymous",
                session.page_number,
                session.surah_id,
                session.recognizer_mode,
                session.transport_mode,
            )

    async def _finalize_attempt_row(session: SessionState) -> None:
        attempt_id = session.attempt_id
        if not attempt_id:
            return
        pool: asyncpg.Pool | None = getattr(app.state, "db_pool", None)
        if pool is None:
            return
        avg_total_ms = (
            float(statistics.fmean(session.latency_total_ms_samples))
            if session.latency_total_ms_samples
            else None
        )
        p95_total_ms = _p95(session.latency_total_ms_samples)
        async with pool.acquire() as conn:
            await conn.execute(
                """
                update public.tasmee_attempts
                set
                    ended_at = now(),
                    chunks_received = $2,
                    chunks_with_speech = $3,
                    deltas_emitted = $4,
                    deltas_blocked = $5,
                    anchor_word_index = $6,
                    anchor_verse_end_word_index = $7,
                    max_confirmed_word_index = $8,
                    confirmed_word_count = $9,
                    avg_total_ms = $10,
                    p95_total_ms = $11,
                    transport_mode = $12
                where id = $1::uuid
                """,
                attempt_id,
                session.chunks_received,
                session.chunks_with_speech,
                session.deltas_emitted,
                session.deltas_blocked_by_gate,
                session.anchor_word_index,
                session.anchor_verse_end_word_index,
                session.max_confirmed_word_index,
                session.confirmed_word_count,
                avg_total_ms,
                p95_total_ms,
                session.transport_mode,
            )

    @app.on_event("startup")
    async def _startup() -> None:
        database_url = (os.getenv("DATABASE_URL") or "").strip()
        if database_url:
            try:
                app.state.db_pool = await asyncpg.create_pool(database_url)
            except Exception as exc:  # pragma: no cover - depends on env/network
                logger.warning("tasmee db connection failed; continuing without db: %s", exc)
                app.state.db_pool = None
        else:
            app.state.db_pool = None
        app.state.prune_task = asyncio.create_task(_prune_expired_sessions_loop())

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        prune_task: asyncio.Task | None = getattr(app.state, "prune_task", None)
        if prune_task is not None:
            prune_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await prune_task

        removed = await store.prune_expired(max_age_seconds=0)
        for _, removed_session in removed:
            await _finalize_attempt_row(removed_session)

        pool: asyncpg.Pool | None = getattr(app.state, "db_pool", None)
        if pool is not None:
            await pool.close()
            app.state.db_pool = None

    async def _prune_expired_sessions_loop() -> None:
        while True:
            await asyncio.sleep(PRUNE_INTERVAL_SECONDS)
            removed = await store.prune_expired(max_age_seconds=SESSION_MAX_AGE_SECONDS)
            for _, removed_session in removed:
                await _finalize_attempt_row(removed_session)

    @app.get("/healthz")
    async def healthz():
        session_metrics = await store.stats()
        return {
            "ok": True,
            "recognizer_mode": recognizer_mode,
            "ws_audio_upload_enabled": WS_AUDIO_UPLOAD_ENABLED,
            "degrade_on_recognizer_stall": DEGRADE_ON_RECOGNIZER_STALL,
            "limits": {
                "max_active_sessions": MAX_ACTIVE_SESSIONS,
                "recognizer_max_inflight": RECOGNIZER_MAX_INFLIGHT,
                "recognizer_queue_timeout_seconds": RECOGNIZER_QUEUE_TIMEOUT_SECONDS,
                "recognizer_hard_timeout_seconds": RECOGNIZER_HARD_TIMEOUT_SECONDS,
            },
            "sessions": session_metrics,
            "load": load_state.snapshot(),
        }

    @app.post("/v1/tasmee/sessions", response_model=TasmeeSessionCreateResponse)
    async def create_session(payload: TasmeeSessionCreateRequest, request: Request):
        user_id = _resolve_user_id_from_authorization(
            request.headers.get("authorization"),
            auth_settings,
        )
        attempt_id = str(uuid.uuid4())
        try:
            session_id = await store.create(
                payload.page_number,
                payload.surah_id,
                clerk_user_id=user_id,
                attempt_id=attempt_id,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        session = await store.get(session_id)
        if session is not None:
            await _insert_attempt_row(session_id, session)
        base_url, ws_base = _public_base_urls(request)
        ws_token = (
            await store.mint_ws_token(session_id=session_id, clerk_user_id=user_id)
            if auth_settings.require_auth
            else None
        )
        return TasmeeSessionCreateResponse(
            session_id=session_id,
            ws_url=f"{ws_base}/v1/tasmee/ws",
            ws_token=ws_token,
            fallback_url=f"{base_url}/v1/tasmee/sessions/{session_id}/chunks",
        )

    async def _process_chunk_payload(
        *,
        session_id: str,
        session: SessionState,
        payload: TasmeeChunkUploadRequest,
        audio_bytes: bytes,
        decode_ms: float,
        transport_mode: str,
    ) -> tuple[dict, dict | None, bool, int]:
        accepted = False
        delta_event: dict | None = None
        status_event: dict
        recognize_ms = 0.0
        match_ms = 0.0

        now = time.time()
        session.transport_mode = transport_mode
        if payload.seq <= session.last_seq_ack:
            session.deltas_blocked_by_gate += 1
            status_event = _build_status_event(
                session_id=session_id,
                session=session,
                state="paused" if session.paused else "processing",
                has_speech=False if session.paused else session.speech_open,
                level_db=payload.level_db,
                capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
            )
            return status_event, delta_event, accepted, session.last_seq_ack

        if not _consume_rate_limit_token(session, now):
            session.deltas_blocked_by_gate += 1
            status_event = _build_status_event(
                session_id=session_id,
                session=session,
                state="processing",
                has_speech=False,
                level_db=payload.level_db,
                capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
            )
            return status_event, delta_event, accepted, session.last_seq_ack

        session.last_seq_ack = payload.seq
        session.chunks_received += 1
        session.last_degraded_reason = None

        if session.paused:
            status_event = _build_status_event(
                session_id=session_id,
                session=session,
                state="paused",
                has_speech=False,
                level_db=payload.level_db,
                capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
            )
        else:
            recognition_input = ChunkRecognitionInput(
                audio_bytes=audio_bytes,
                mime_type=payload.mime_type,
                level_db=payload.level_db,
                has_speech=payload.has_speech,
                duration_ms=payload.duration_ms,
                next_word_index=session.next_word_index,
                anchor_set=session.anchor_set,
            )

            alignment_mode = _is_alignment_mode(session.recognizer_mode)
            should_call_recognizer = (not alignment_mode) or (
                payload.has_speech is True
                or payload.level_db is None
                or (
                    payload.level_db is not None
                    and payload.level_db >= HARD_SPEECH_LEVEL_DB_THRESHOLD - 10.0
                )
            )

            recognize_started_ms = time.perf_counter() * 1000
            degraded_reason: str | None = None
            if should_call_recognizer:
                recognition, degraded_reason = await _analyze_with_limits(
                    payload=payload,
                    recognition_input=recognition_input,
                )
            else:
                resolved_level_db = (
                    float(payload.level_db)
                    if payload.level_db is not None
                    else (-35.0 if payload.has_speech is True else -120.0)
                )
                recognition = ChunkRecognitionResult(
                    has_speech=False,
                    confidence=0.0,
                    level_db=resolved_level_db,
                    confirmed_word_indexes=[],
                    transcript=None,
                    recognized_tokens=[],
                )
            recognize_ms = (time.perf_counter() * 1000) - recognize_started_ms

            if degraded_reason:
                session.last_degraded_reason = degraded_reason
                session.degraded_fallbacks += 1
                load_state.add("degraded_fallbacks", 1)
                if degraded_reason == "recognizer_timeout":
                    session.recognizer_timeouts += 1
                elif degraded_reason == "recognizer_backpressure":
                    session.recognizer_backpressure += 1

            _apply_shadow_recognition(session, recognition_input, shadow_recognizer)
            gate = _speech_gate_decision(
                mode=speech_gate_mode,
                alignment_mode=alignment_mode,
                payload_has_speech=payload.has_speech,
                payload_level_db=payload.level_db,
                recognition=recognition,
            )

            if gate.open:
                session.speech_open = True
                session.last_speech_ts = now
                session.chunks_with_speech += 1

                if not alignment_mode and recognition.confidence < CONFIDENCE_THRESHOLD:
                    session.deltas_blocked_by_gate += 1
                    status_event = _build_status_event(
                        session_id=session_id,
                        session=session,
                        state="processing",
                        has_speech=True,
                        level_db=recognition.level_db,
                        capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
                    )
                elif alignment_mode and not _allow_alignment_partial_progress(session, recognition):
                    session.deltas_blocked_by_gate += 1
                    status_event = _build_status_event(
                        session_id=session_id,
                        session=session,
                        state="processing",
                        has_speech=True,
                        level_db=recognition.level_db,
                        capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
                    )
                else:
                    match_started_ms = time.perf_counter() * 1000
                    progress = _apply_progress_from_recognition(session, recognition)
                    match_ms = (time.perf_counter() * 1000) - match_started_ms
                    min_confidence = (
                        VERSE_MATCH_THRESHOLD if alignment_mode else CONFIDENCE_THRESHOLD
                    )

                    if progress.confirmed_word_indexes and progress.confidence >= min_confidence:
                        accepted = True
                        session.deltas_emitted += 1
                        _record_confirmed_progress(session, progress.confirmed_word_indexes)
                        status_event = _build_status_event(
                            session_id=session_id,
                            session=session,
                            state="reciting",
                            has_speech=True,
                            level_db=recognition.level_db,
                            capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
                        )
                        delta_event = {
                            "type": "feedback.delta",
                            "session_id": session_id,
                            "recognizer_mode": session.recognizer_mode,
                            "seq_ack": session.last_seq_ack,
                            "chunk_seq": payload.seq,
                            "has_speech": True,
                            "confidence": progress.confidence,
                            "token_source": recognition.token_source,
                            "confirmed_word_indexes": progress.confirmed_word_indexes,
                            "ts_ms": _now_ms(),
                        }
                        if session.last_degraded_reason:
                            delta_event["degraded"] = True
                            delta_event["degraded_reason"] = session.last_degraded_reason
                        if progress.start_anchor_word_index is not None:
                            delta_event["start_anchor_word_index"] = progress.start_anchor_word_index
                            delta_event["start_anchor_confidence"] = progress.start_anchor_confidence
                    else:
                        session.deltas_blocked_by_gate += 1
                        status_event = _build_status_event(
                            session_id=session_id,
                            session=session,
                            state="processing",
                            has_speech=True,
                            level_db=recognition.level_db,
                            capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
                        )
            else:
                if session.last_speech_ts is None or (
                    now - session.last_speech_ts > SILENCE_WINDOW_SECONDS
                ):
                    session.speech_open = False
                fallback_state = "processing"
                if payload.has_speech is False:
                    fallback_state = "silent"
                elif (
                    payload.level_db is not None
                    and payload.level_db < HARD_SPEECH_LEVEL_DB_THRESHOLD
                ):
                    fallback_state = "silent"
                status_event = _build_status_event(
                    session_id=session_id,
                    session=session,
                    state=fallback_state,
                    has_speech=False,
                    level_db=recognition.level_db,
                    capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
                )

            if _pause_session_for_silence(session, now):
                status_event = _build_status_event(
                    session_id=session_id,
                    session=session,
                    state="paused",
                    has_speech=False,
                    level_db=payload.level_db,
                    pause_reason=session.pause_reason,
                    capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
                )

            total_ms = decode_ms + recognize_ms + match_ms
            session.latency_total_ms_samples.append(total_ms)
            if debug_events_enabled:
                debug_payload = {
                    "recognizer_mode": session.recognizer_mode,
                    "speech_gate_mode": gate.mode,
                    "level_db": payload.level_db,
                    "payload_has_speech": payload.has_speech,
                    "hard_gate_open": gate.hard_gate_open,
                    "recognizer_has_speech": recognition.has_speech,
                    "recited_token_count": len(session.recited_tokens),
                    "anchor_word_index": session.anchor_word_index,
                    "anchor_verse_end_word_index": session.anchor_verse_end_word_index,
                    "match_score": delta_event.get("confidence") if delta_event else None,
                    "token_source": recognition.token_source,
                    "partial_stability": recognition.partial_stability,
                    "stt_latency_meta": recognition.stt_latency_meta,
                    "degraded_reason": session.last_degraded_reason,
                    "load": load_state.snapshot(),
                    "timing": {
                        "decode_ms": round(decode_ms, 2),
                        "recognize_ms": round(recognize_ms, 2),
                        "match_ms": round(match_ms, 2),
                        "total_ms": round(total_ms, 2),
                    },
                }
                status_event["debug"] = debug_payload
                if delta_event is not None:
                    delta_event["debug"] = debug_payload

        return status_event, delta_event, accepted, session.last_seq_ack

    @app.post("/v1/tasmee/sessions/{session_id}/chunks", response_model=TasmeeChunkUploadResponse)
    async def upload_chunk(session_id: str, payload: TasmeeChunkUploadRequest, request: Request):
        session = await store.get(session_id)
        if not session or session.stopped:
            raise HTTPException(status_code=404, detail="Session not found")
        user_id = _resolve_user_id_from_authorization(
            request.headers.get("authorization"),
            auth_settings,
        )
        _assert_session_owner(session, user_id)

        decode_started_ms = time.perf_counter() * 1000
        audio_bytes = _decode_audio_base64(payload.audio_base64)
        if len(audio_bytes) > MAX_CHUNK_BYTES:
            raise HTTPException(status_code=413, detail="Audio chunk too large")
        decode_ms = (time.perf_counter() * 1000) - decode_started_ms

        async with session.lock:
            status_event, delta_event, accepted, seq_ack = await _process_chunk_payload(
                session_id=session_id,
                session=session,
                payload=payload,
                audio_bytes=audio_bytes,
                decode_ms=decode_ms,
                transport_mode="http",
            )

        await store.broadcast_event(session_id, status_event)
        if delta_event:
            await store.broadcast_event(session_id, delta_event)

        return TasmeeChunkUploadResponse(
            session_id=session_id,
            seq_ack=seq_ack,
            accepted=accepted,
        )

    @app.post(
        "/v1/tasmee/sessions/{session_id}/stop",
        response_model=TasmeeSessionStopResponse,
    )
    async def stop_session(session_id: str, request: Request):
        session = await store.get(session_id)
        if not session or session.stopped:
            raise HTTPException(status_code=404, detail="Session not found")
        user_id = _resolve_user_id_from_authorization(
            request.headers.get("authorization"),
            auth_settings,
        )
        _assert_session_owner(session, user_id)
        session = await store.stop(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        logger.info(
            "tasmee session stopped: %s",
            json.dumps(
                {
                    "session_id": session_id,
                    "chunks_received": session.chunks_received,
                    "chunks_with_speech": session.chunks_with_speech,
                    "deltas_emitted": session.deltas_emitted,
                    "deltas_blocked_by_gate": session.deltas_blocked_by_gate,
                    "paused": session.paused,
                    "recognizer_mode": session.recognizer_mode,
                    "transport_mode": session.transport_mode,
                    "recognizer_timeouts": session.recognizer_timeouts,
                    "recognizer_backpressure": session.recognizer_backpressure,
                    "degraded_fallbacks": session.degraded_fallbacks,
                }
            ),
        )
        await _finalize_attempt_row(session)
        return TasmeeSessionStopResponse(session_id=session_id)

    @app.post(
        "/v1/tasmee/sessions/{session_id}/resume",
        response_model=TasmeeSessionResumeResponse,
    )
    async def resume_session(session_id: str, request: Request):
        session = await store.get(session_id)
        if not session or session.stopped:
            raise HTTPException(status_code=404, detail="Session not found")
        user_id = _resolve_user_id_from_authorization(
            request.headers.get("authorization"),
            auth_settings,
        )
        _assert_session_owner(session, user_id)

        async with session.lock:
            session.paused = False
            session.pause_reason = None
            session.paused_at = None
            session.speech_open = False
            session.last_speech_ts = None
            status_event = _build_status_event(
                session_id=session_id,
                session=session,
                state="listening",
                has_speech=False,
                level_db=None,
                capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
            )

        await store.broadcast_event(session_id, status_event)
        return TasmeeSessionResumeResponse(session_id=session_id)

    @app.websocket("/v1/tasmee/ws")
    async def tasmee_ws(
        websocket: WebSocket,
        session_id: str = Query(...),
        token: str | None = Query(default=None),
    ):
        if auth_settings.require_auth:
            is_valid_token = await store.validate_ws_token(session_id=session_id, token=token)
            if not is_valid_token:
                await websocket.close(code=1008)
                return

        session = await store.get(session_id)
        if not session or session.stopped:
            await websocket.close(code=1008)
            return

        queue = await store.register_listener(session_id)
        if queue is None:
            await websocket.close(code=1008)
            return

        await websocket.accept()
        await websocket.send_json(
            _build_status_event(
                session_id=session_id,
                session=session,
                capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
            )
        )

        async def _receive_client_messages() -> None:
            try:
                while True:
                    incoming = await websocket.receive_json()
                    if not isinstance(incoming, dict):
                        continue
                    if incoming.get("type") != "chunk.upload":
                        continue
                    try:
                        ws_payload = TasmeeWsChunkUploadRequest.model_validate(incoming)
                    except Exception:
                        continue

                    decode_started_ms = time.perf_counter() * 1000
                    audio_bytes = _decode_audio_base64(ws_payload.audio_base64)
                    if len(audio_bytes) > MAX_CHUNK_BYTES:
                        continue
                    decode_ms = (time.perf_counter() * 1000) - decode_started_ms

                    async with session.lock:
                        status_event, delta_event, _, _ = await _process_chunk_payload(
                            session_id=session_id,
                            session=session,
                            payload=ws_payload,
                            audio_bytes=audio_bytes,
                            decode_ms=decode_ms,
                            transport_mode="websocket",
                        )
                    await store.broadcast_event(session_id, status_event)
                    if delta_event:
                        await store.broadcast_event(session_id, delta_event)
            except WebSocketDisconnect:
                return

        receive_task = asyncio.create_task(_receive_client_messages())

        try:
            while True:
                state = await store.get(session_id)
                if not state or state.stopped:
                    await websocket.close(code=1000)
                    return

                try:
                    outbound_event = await asyncio.wait_for(
                        queue.get(),
                        timeout=HEARTBEAT_INTERVAL_SECONDS,
                    )
                except asyncio.TimeoutError:
                    outbound_event = _build_status_event(
                        session_id=session_id,
                        session=state,
                        capabilities={"ws_audio_upload": WS_AUDIO_UPLOAD_ENABLED},
                    )
                try:
                    await websocket.send_json(outbound_event)
                except (RuntimeError, WebSocketDisconnect):
                    return
        except WebSocketDisconnect:
            return
        finally:
            receive_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect):
                await receive_task
            await store.unregister_listener(session_id, queue)

    return app


app = create_app()
