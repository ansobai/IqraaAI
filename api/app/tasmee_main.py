from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .tasmee_alignment import align_recitation
from .tasmee_engine import ChunkRecognitionInput, create_tasmee_recognizer
from .tasmee_page_lexicon import load_page_lexicon

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.85
HEARTBEAT_INTERVAL_SECONDS = 1.0
SILENCE_WINDOW_SECONDS = 1.2
MAX_EVENT_QUEUE_SIZE = 64



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


class TasmeeChunkUploadResponse(BaseModel):
    session_id: str
    seq_ack: int
    accepted: bool


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
    page_words: list[str] = field(default_factory=list)
    verse_start_word_indexes: list[int] = field(default_factory=list)
    recognizer_mode: str = "heuristic"
    shadow_mode: bool = False
    listeners: set[asyncio.Queue[dict]] = field(default_factory=set, repr=False)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)


class SessionStore:
    def __init__(self):
        self._sessions: Dict[str, SessionState] = {}
        self._lock = asyncio.Lock()

    async def create(self, page_number: int, surah_id: int) -> str:
        lexicon = load_page_lexicon(page_number)

        async with self._lock:
            self._prune_locked(max_age_seconds=3600)
            session_id = str(uuid.uuid4())
            self._sessions[session_id] = SessionState(
                page_number=page_number,
                surah_id=surah_id,
                created_at=time.time(),
                page_words=lexicon.words,
                verse_start_word_indexes=lexicon.verse_start_word_indexes,
                recognizer_mode=RECOGNIZER_MODE,
                shadow_mode=RECOGNIZER_SHADOW and RECOGNIZER_MODE != "google",
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
            return session

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
                    pass

    def _prune_locked(self, max_age_seconds: int) -> None:
        now = time.time()
        expired = [
            session_id
            for session_id, session in self._sessions.items()
            if session.stopped or now - session.created_at > max_age_seconds
        ]
        for session_id in expired:
            self._sessions.pop(session_id, None)


store = SessionStore()
recognizer = create_tasmee_recognizer(RECOGNIZER_MODE)
shadow_recognizer = (
    create_tasmee_recognizer("google")
    if RECOGNIZER_SHADOW and RECOGNIZER_MODE != "google"
    else None
)


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
        "state": resolved_state,
        "has_speech": has_speech if has_speech is not None else recent_speech,
        "level_db": level_db,
        "seq_ack": session.last_seq_ack,
        "ts_ms": _now_ms(),
    }

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


def _hard_speech_gate(payload: TasmeeChunkUploadRequest) -> bool:
    if payload.has_speech is not True:
        return False
    if payload.level_db is None:
        return False
    return payload.level_db >= HARD_SPEECH_LEVEL_DB_THRESHOLD


def _apply_progress_from_recognition(
    session: SessionState,
    recognition,
) -> tuple[list[int], int | None, float | None]:
    if session.recognizer_mode == "google":
        awaiting_anchor = session.recitation_state != "tracking"
        alignment = align_recitation(
            page_words=session.page_words,
            verse_start_word_indexes=session.verse_start_word_indexes,
            spoken_words=recognition.recognized_tokens,
            next_word_index=session.next_word_index,
            awaiting_anchor=awaiting_anchor,
            min_anchor_words=ANCHOR_MIN_WORDS,
        )

        if alignment.start_anchor_word_index is not None:
            session.anchor_set = True
            session.anchor_word_index = alignment.start_anchor_word_index
            session.recitation_state = "tracking"

        if alignment.confirmed_word_indexes:
            session.next_word_index = alignment.confirmed_word_indexes[-1] + 1

        start_anchor_confidence = (
            recognition.confidence if alignment.start_anchor_word_index is not None else None
        )
        return (
            alignment.confirmed_word_indexes,
            alignment.start_anchor_word_index,
            start_anchor_confidence,
        )

    if recognition.start_anchor_word_index is not None:
        session.anchor_set = True
        session.anchor_word_index = recognition.start_anchor_word_index
        session.recitation_state = "tracking"

    confirmed = recognition.confirmed_word_indexes
    if confirmed:
        session.next_word_index = confirmed[-1] + 1

    return (
        confirmed,
        recognition.start_anchor_word_index,
        recognition.start_anchor_confidence,
    )


def _apply_shadow_recognition(session: SessionState, payload: ChunkRecognitionInput) -> None:
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


def create_app() -> FastAPI:
    app = FastAPI(title="IqraaAI Tasmee Service")

    cors_origins = _parse_cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials="*" not in cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz")
    async def healthz():
        return {"ok": True}

    @app.post("/v1/tasmee/sessions", response_model=TasmeeSessionCreateResponse)
    async def create_session(payload: TasmeeSessionCreateRequest, request: Request):
        session_id = await store.create(payload.page_number, payload.surah_id)
        base_url, ws_base = _public_base_urls(request)
        return TasmeeSessionCreateResponse(
            session_id=session_id,
            ws_url=f"{ws_base}/v1/tasmee/ws",
            fallback_url=f"{base_url}/v1/tasmee/sessions/{session_id}/chunks",
        )

    @app.post("/v1/tasmee/sessions/{session_id}/chunks", response_model=TasmeeChunkUploadResponse)
    async def upload_chunk(session_id: str, payload: TasmeeChunkUploadRequest):
        session = await store.get(session_id)
        if not session or session.stopped:
            raise HTTPException(status_code=404, detail="Session not found")

        audio_bytes = _decode_audio_base64(payload.audio_base64)
        accepted = False
        delta_event: dict | None = None
        status_event: dict

        async with session.lock:
            if payload.seq <= session.last_seq_ack:
                session.deltas_blocked_by_gate += 1
                status_event = _build_status_event(
                    session_id=session_id,
                    session=session,
                    state="paused" if session.paused else "processing",
                    has_speech=False if session.paused else session.speech_open,
                    level_db=payload.level_db,
                )
            else:
                now = time.time()
                session.last_seq_ack = payload.seq
                session.chunks_received += 1

                if session.paused:
                    status_event = _build_status_event(
                        session_id=session_id,
                        session=session,
                        state="paused",
                        has_speech=False,
                        level_db=payload.level_db,
                    )
                else:
                    recognition_input = ChunkRecognitionInput(
                        audio_bytes=audio_bytes,
                        level_db=payload.level_db,
                        has_speech=payload.has_speech,
                        duration_ms=payload.duration_ms,
                        next_word_index=session.next_word_index,
                        anchor_set=session.anchor_set,
                    )

                    recognition = recognizer.analyze_chunk(recognition_input)
                    _apply_shadow_recognition(session, recognition_input)

                    hard_gate_open = _hard_speech_gate(payload)
                    if hard_gate_open:
                        session.speech_open = True
                        session.last_speech_ts = now
                        session.chunks_with_speech += 1

                        if recognition.confidence < CONFIDENCE_THRESHOLD:
                            session.deltas_blocked_by_gate += 1
                            status_event = _build_status_event(
                                session_id=session_id,
                                session=session,
                                state="processing",
                                has_speech=True,
                                level_db=recognition.level_db,
                            )
                        else:
                            (
                                confirmed_word_indexes,
                                start_anchor_word_index,
                                start_anchor_confidence,
                            ) = _apply_progress_from_recognition(session, recognition)

                            if confirmed_word_indexes:
                                accepted = True
                                session.deltas_emitted += 1
                                status_event = _build_status_event(
                                    session_id=session_id,
                                    session=session,
                                    state="reciting",
                                    has_speech=True,
                                    level_db=recognition.level_db,
                                )
                                delta_event = {
                                    "type": "feedback.delta",
                                    "session_id": session_id,
                                    "seq_ack": session.last_seq_ack,
                                    "chunk_seq": payload.seq,
                                    "has_speech": True,
                                    "confidence": recognition.confidence,
                                    "confirmed_word_indexes": confirmed_word_indexes,
                                    "ts_ms": _now_ms(),
                                }
                                if start_anchor_word_index is not None:
                                    delta_event["start_anchor_word_index"] = start_anchor_word_index
                                    delta_event["start_anchor_confidence"] = start_anchor_confidence
                            else:
                                session.deltas_blocked_by_gate += 1
                                status_event = _build_status_event(
                                    session_id=session_id,
                                    session=session,
                                    state="processing",
                                    has_speech=True,
                                    level_db=recognition.level_db,
                                )
                    else:
                        if session.last_speech_ts is None or (
                            now - session.last_speech_ts > SILENCE_WINDOW_SECONDS
                        ):
                            session.speech_open = False

                        if payload.has_speech is True and payload.level_db is None:
                            fallback_state = "processing"
                        elif payload.has_speech is False:
                            fallback_state = "silent"
                        elif payload.level_db is not None and payload.level_db < HARD_SPEECH_LEVEL_DB_THRESHOLD:
                            fallback_state = "silent"
                        else:
                            fallback_state = "processing"

                        status_event = _build_status_event(
                            session_id=session_id,
                            session=session,
                            state=fallback_state,
                            has_speech=False,
                            level_db=recognition.level_db,
                        )

                    if _pause_session_for_silence(session, now):
                        status_event = _build_status_event(
                            session_id=session_id,
                            session=session,
                            state="paused",
                            has_speech=False,
                            level_db=payload.level_db,
                            pause_reason=session.pause_reason,
                        )

            seq_ack = session.last_seq_ack

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
    async def stop_session(session_id: str):
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
                }
            ),
        )
        return TasmeeSessionStopResponse(session_id=session_id)

    @app.post(
        "/v1/tasmee/sessions/{session_id}/resume",
        response_model=TasmeeSessionResumeResponse,
    )
    async def resume_session(session_id: str):
        session = await store.get(session_id)
        if not session or session.stopped:
            raise HTTPException(status_code=404, detail="Session not found")

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
            )

        await store.broadcast_event(session_id, status_event)
        return TasmeeSessionResumeResponse(session_id=session_id)

    @app.websocket("/v1/tasmee/ws")
    async def tasmee_ws(
        websocket: WebSocket,
        session_id: str = Query(...),
    ):
        session = await store.get(session_id)
        if not session or session.stopped:
            await websocket.close(code=1008)
            return

        queue = await store.register_listener(session_id)
        if queue is None:
            await websocket.close(code=1008)
            return

        await websocket.accept()
        await websocket.send_json(_build_status_event(session_id=session_id, session=session))

        try:
            while True:
                state = await store.get(session_id)
                if not state or state.stopped:
                    await websocket.close(code=1000)
                    return

                try:
                    event = await asyncio.wait_for(
                        queue.get(),
                        timeout=HEARTBEAT_INTERVAL_SECONDS,
                    )
                    await websocket.send_json(event)
                except asyncio.TimeoutError:
                    heartbeat = _build_status_event(session_id=session_id, session=state)
                    await websocket.send_json(heartbeat)
        except WebSocketDisconnect:
            return
        finally:
            await store.unregister_listener(session_id, queue)

    return app


app = create_app()
