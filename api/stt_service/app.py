from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import os
import subprocess
import threading
import time
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect

try:
    from faster_whisper import WhisperModel
except Exception:  # pragma: no cover - dependency/runtime dependent
    WhisperModel = None  # type: ignore[assignment]

try:
    from api.app.tasmee_text import tokenize_arabic_text
except Exception:  # pragma: no cover - fallback for standalone packaging
    def tokenize_arabic_text(text: str) -> list[str]:
        return [token for token in text.strip().split() if token]


logger = logging.getLogger(__name__)

DEFAULT_MODEL_ID = "Systran/faster-whisper-small"
DEFAULT_SAMPLE_RATE_HZ = 16000



def _bool_env(name: str, default: bool = False) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}



def _int_env(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("invalid %s=%s, using default=%s", name, raw, default)
        return default



def _float_env(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("invalid %s=%s, using default=%s", name, raw, default)
        return default



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



def _require_auth(request: Request) -> None:
    expected = (os.getenv("STT_AUTH_TOKEN") or "").strip()
    if not expected:
        return
    provided = _extract_bearer_token(request.headers.get("authorization"))
    if provided != expected:
        raise HTTPException(status_code=401, detail="Missing or invalid bearer token")



def _is_authorized(authorization_header: str | None) -> bool:
    expected = (os.getenv("STT_AUTH_TOKEN") or "").strip()
    if not expected:
        return True
    provided = _extract_bearer_token(authorization_header)
    return provided == expected



def _language_codes_from_header(value: str | None) -> list[str] | None:
    if not value:
        return None
    parsed = [item.strip() for item in value.split(",") if item.strip()]
    return parsed or None


class LowLatencyAsrRuntime:
    def __init__(self):
        if WhisperModel is None:  # pragma: no cover - dependency/runtime dependent
            raise RuntimeError("faster-whisper is not installed")

        model_id = (os.getenv("STT_MODEL_ID") or DEFAULT_MODEL_ID).strip() or DEFAULT_MODEL_ID
        force_cpu = _bool_env("STT_FORCE_CPU", False)
        use_cuda = _bool_env("STT_USE_CUDA", True) and not force_cpu
        device = "cuda" if use_cuda else "cpu"
        default_compute_type = "float16" if device == "cuda" else "int8"
        compute_type = (os.getenv("STT_COMPUTE_TYPE") or default_compute_type).strip() or default_compute_type
        final_model_id = (
            (os.getenv("STT_FINAL_MODEL_ID") or os.getenv("STT_QURAN_MODEL_ID") or model_id)
            .strip()
            or model_id
        )
        final_compute_type = (
            (os.getenv("STT_FINAL_COMPUTE_TYPE") or compute_type).strip() or compute_type
        )

        cpu_threads = _int_env("STT_CPU_THREADS", 0)
        num_workers = max(1, _int_env("STT_NUM_WORKERS", 1))
        download_root = (os.getenv("STT_MODEL_CACHE_DIR") or "").strip() or None

        self._model_id = model_id
        self._device = device
        self._compute_type = compute_type
        self._language = (os.getenv("STT_LANGUAGE") or "ar").strip() or "ar"
        self._task = (os.getenv("STT_TASK") or "transcribe").strip() or "transcribe"
        self._beam_size = max(1, _int_env("STT_BEAM_SIZE", 1))
        self._best_of = max(1, _int_env("STT_BEST_OF", 1))
        self._patience = max(0.1, _float_env("STT_PATIENCE", 1.0))
        self._length_penalty = max(0.1, _float_env("STT_LENGTH_PENALTY", 1.0))
        self._temperature = _float_env("STT_TEMPERATURE", 0.0)
        self._compression_ratio_threshold = _float_env("STT_COMPRESSION_RATIO_THRESHOLD", 2.4)
        self._log_prob_threshold = _float_env("STT_LOG_PROB_THRESHOLD", -1.0)
        self._no_speech_threshold = _float_env("STT_NO_SPEECH_THRESHOLD", 0.6)
        self._condition_on_previous_text = _bool_env("STT_CONDITION_ON_PREVIOUS_TEXT", False)
        self._vad_filter = _bool_env("STT_VAD_FILTER", True)
        self._vad_min_silence_ms = max(100, _int_env("STT_VAD_MIN_SILENCE_MS", 250))
        self._final_model_id = final_model_id
        self._final_compute_type = final_compute_type
        self._final_beam_size = max(1, _int_env("STT_FINAL_BEAM_SIZE", max(2, self._beam_size)))
        self._final_best_of = max(1, _int_env("STT_FINAL_BEST_OF", max(2, self._best_of)))
        self._final_condition_on_previous_text = _bool_env(
            "STT_FINAL_CONDITION_ON_PREVIOUS_TEXT",
            self._condition_on_previous_text,
        )
        self._final_vad_filter = _bool_env("STT_FINAL_VAD_FILTER", self._vad_filter)
        self._final_vad_min_silence_ms = max(
            100,
            _int_env("STT_FINAL_VAD_MIN_SILENCE_MS", self._vad_min_silence_ms),
        )
        self._final_prompt = (
            (os.getenv("STT_FINAL_PROMPT") or os.getenv("STT_QURAN_PROMPT") or "").strip() or None
        )
        self._sample_rate_hz = max(8000, _int_env("STT_SAMPLE_RATE_HZ", DEFAULT_SAMPLE_RATE_HZ))

        self._fast_lock = threading.Lock()
        self._fast_model = WhisperModel(
            model_id,
            device=device,
            compute_type=compute_type,
            cpu_threads=cpu_threads,
            num_workers=num_workers,
            download_root=download_root,
        )
        self._final_lock = self._fast_lock
        self._final_model = self._fast_model
        if self._final_model_id != self._model_id or self._final_compute_type != self._compute_type:
            self._final_lock = threading.Lock()
            self._final_model = WhisperModel(
                self._final_model_id,
                device=device,
                compute_type=self._final_compute_type,
                cpu_threads=cpu_threads,
                num_workers=num_workers,
                download_root=download_root,
            )

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def final_model_id(self) -> str:
        return self._final_model_id

    @property
    def device(self) -> str:
        return self._device

    @property
    def compute_type(self) -> str:
        return self._compute_type

    @property
    def final_compute_type(self) -> str:
        return self._final_compute_type

    @property
    def sample_rate_hz(self) -> int:
        return self._sample_rate_hz

    @property
    def default_language(self) -> str:
        return self._language

    @property
    def two_pass_enabled(self) -> bool:
        return self._final_model_id != self._model_id or self._final_compute_type != self._compute_type

    def transcribe_pcm(
        self,
        pcm_float32: np.ndarray,
        *,
        is_final: bool,
        language_codes: list[str] | None = None,
    ) -> tuple[str, float | None]:
        transcript, confidence, _ = self.transcribe_pcm_with_meta(
            pcm_float32,
            is_final=is_final,
            language_codes=language_codes,
        )
        return transcript, confidence

    def transcribe_pcm_with_meta(
        self,
        pcm_float32: np.ndarray,
        *,
        is_final: bool,
        language_codes: list[str] | None = None,
    ) -> tuple[str, float | None, str]:
        if pcm_float32.size == 0:
            return "", None, ("quran_final" if is_final else "fast_partial")

        language = None
        if language_codes:
            language = language_codes[0].strip() if language_codes[0].strip() else None
        if language is None:
            language = self._language

        if is_final:
            model = self._final_model
            model_lock = self._final_lock
            decoder_pass = "quran_final" if self.two_pass_enabled else "final"
            beam_size = self._final_beam_size
            best_of = self._final_best_of
            condition_on_previous_text = self._final_condition_on_previous_text
            vad_filter = self._final_vad_filter
            vad_min_silence_ms = self._final_vad_min_silence_ms
            initial_prompt = self._final_prompt
        else:
            model = self._fast_model
            model_lock = self._fast_lock
            decoder_pass = "fast_partial"
            beam_size = self._beam_size
            best_of = self._best_of
            condition_on_previous_text = False
            vad_filter = False
            vad_min_silence_ms = self._vad_min_silence_ms
            initial_prompt = None

        vad_parameters = {"min_silence_duration_ms": vad_min_silence_ms}

        with model_lock:
            segments_iter, _ = model.transcribe(
                pcm_float32,
                language=language,
                task=self._task,
                beam_size=beam_size,
                best_of=best_of,
                patience=self._patience,
                length_penalty=self._length_penalty,
                temperature=self._temperature,
                compression_ratio_threshold=self._compression_ratio_threshold,
                log_prob_threshold=self._log_prob_threshold,
                no_speech_threshold=self._no_speech_threshold,
                condition_on_previous_text=condition_on_previous_text,
                without_timestamps=True,
                word_timestamps=False,
                vad_filter=vad_filter,
                vad_parameters=vad_parameters,
                initial_prompt=initial_prompt,
            )
            segments = list(segments_iter)

        transcript = " ".join((segment.text or "").strip() for segment in segments).strip()
        confidence = _estimate_confidence_from_segments(segments)
        return transcript, confidence, decoder_pass



def _estimate_confidence_from_segments(segments: list[object]) -> float | None:
    if not segments:
        return None
    logprobs: list[float] = []
    for segment in segments:
        value = getattr(segment, "avg_logprob", None)
        if isinstance(value, (float, int)):
            logprobs.append(float(value))
    if not logprobs:
        return None
    avg_logprob = sum(logprobs) / len(logprobs)
    confidence = math.exp(avg_logprob)
    return max(0.0, min(1.0, confidence))



def _decode_audio_bytes_to_pcm16(audio_bytes: bytes, *, sample_rate_hz: int) -> bytes:
    if not audio_bytes:
        return b""
    ffmpeg_bin = (os.getenv("STT_FFMPEG_BIN") or "ffmpeg").strip() or "ffmpeg"
    command = [
        ffmpeg_bin,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-ac",
        "1",
        "-ar",
        str(sample_rate_hz),
        "-f",
        "s16le",
        "pipe:1",
    ]
    completed = subprocess.run(
        command,
        input=audio_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        stderr = (completed.stderr or b"").decode("utf-8", errors="ignore").strip()
        raise RuntimeError(f"ffmpeg decode failed (code={completed.returncode}): {stderr[:300]}")
    return completed.stdout or b""



def _pcm16_to_float32(pcm_bytes: bytes) -> np.ndarray:
    if not pcm_bytes:
        return np.empty((0,), dtype=np.float32)
    pcm_i16 = np.frombuffer(pcm_bytes, dtype=np.int16)
    if pcm_i16.size == 0:
        return np.empty((0,), dtype=np.float32)
    return pcm_i16.astype(np.float32) / 32768.0



def _pcm16_has_speech(frame_bytes: bytes, *, energy_threshold_db: float) -> bool:
    if not frame_bytes:
        return False
    pcm = np.frombuffer(frame_bytes, dtype=np.int16).astype(np.float32)
    if pcm.size == 0:
        return False
    normalized = pcm / 32768.0
    rms = float(np.sqrt(np.mean(np.square(normalized)) + 1e-12))
    level_db = 20.0 * math.log10(max(rms, 1e-12))
    return level_db >= energy_threshold_db


@lru_cache(maxsize=1)
def _asr_runtime() -> LowLatencyAsrRuntime:
    global _MODEL_READY, _MODEL_ERROR
    runtime = LowLatencyAsrRuntime()
    _MODEL_READY = True
    _MODEL_ERROR = None
    return runtime



def _transcribe_audio_bytes(
    *,
    audio_bytes: bytes,
    language_codes: list[str] | None = None,
) -> dict[str, object]:
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Missing request body audio bytes")
    runtime = _asr_runtime()
    try:
        pcm_bytes = _decode_audio_bytes_to_pcm16(
            audio_bytes,
            sample_rate_hz=runtime.sample_rate_hz,
        )
        pcm_float32 = _pcm16_to_float32(pcm_bytes)
        transcript, confidence, decoder_pass = runtime.transcribe_pcm_with_meta(
            pcm_float32,
            is_final=True,
            language_codes=language_codes,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"STT failed: {exc}") from exc

    return {
        "transcript": transcript,
        "tokens": tokenize_arabic_text(transcript),
        "confidence": float(confidence) if confidence is not None else 0.0,
        "decoder_pass": decoder_pass,
    }



def _now_ms() -> int:
    return int(time.time() * 1000)



def _clamp_frame_ms(value: int) -> int:
    return max(20, min(40, value))



def _buffer_ms(buffer_bytes: bytearray, sample_rate_hz: int) -> int:
    if not buffer_bytes:
        return 0
    samples = len(buffer_bytes) // 2
    if sample_rate_hz <= 0:
        return 0
    return int((samples / sample_rate_hz) * 1000)


@dataclass
class StreamingSessionState:
    sample_rate_hz: int
    frame_ms: int
    language_codes: list[str]
    rolling_context_ms: int
    partial_interval_ms: int
    min_partial_audio_ms: int
    vad_energy_threshold_db: float
    protocol_version: int
    pcm_buffer: bytearray = field(default_factory=bytearray)
    frames_received: int = 0
    partial_count: int = 0
    last_partial_audio_ms: int = 0
    last_partial_transcript: str = ""
    last_partial_tokens: list[str] = field(default_factory=list)
    last_partial_confidence: float | None = None
    vad_state: str = "silence"
    connected_at: float = field(default_factory=time.perf_counter)
    first_audio_received_at: float | None = None
    first_partial_sent_at: float | None = None
    final_sent_at: float | None = None
    partials_skipped_due_to_load: int = 0
    final_fallback_reason: str | None = None
    degraded_reasons: set[str] = field(default_factory=set)


class DecodeBackpressureError(RuntimeError):
    pass


class DecodeTimeoutError(RuntimeError):
    pass


@dataclass
class ServiceLoadState:
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    active_streams: int = 0
    queued_streams: int = 0
    active_decodes: int = 0
    queued_decodes: int = 0
    rejected_streams: int = 0
    backpressure_timeouts: int = 0
    decode_timeouts: int = 0
    skipped_partials: int = 0
    fallback_finals: int = 0

    def add(self, key: str, delta: int = 1) -> None:
        with self.lock:
            current = int(getattr(self, key))
            setattr(self, key, max(0, current + delta))

    def snapshot(self) -> dict[str, int]:
        with self.lock:
            return {
                "active_streams": self.active_streams,
                "queued_streams": self.queued_streams,
                "active_decodes": self.active_decodes,
                "queued_decodes": self.queued_decodes,
                "rejected_streams": self.rejected_streams,
                "backpressure_timeouts": self.backpressure_timeouts,
                "decode_timeouts": self.decode_timeouts,
                "skipped_partials": self.skipped_partials,
                "fallback_finals": self.fallback_finals,
            }


PRELOAD_MODEL_ON_STARTUP = _bool_env("STT_PRELOAD_MODEL", True)
FAIL_ON_PRELOAD_ERROR = _bool_env("STT_FAIL_ON_PRELOAD_ERROR", True)
_MODEL_READY = False
_MODEL_ERROR: str | None = None

STREAM_DEFAULT_FRAME_MS = _clamp_frame_ms(_int_env("STT_STREAM_FRAME_MS", 30))
STREAM_PARTIAL_INTERVAL_MS = max(40, _int_env("STT_STREAM_PARTIAL_INTERVAL_MS", 240))
STREAM_MIN_PARTIAL_AUDIO_MS = max(40, _int_env("STT_STREAM_MIN_PARTIAL_AUDIO_MS", 320))
STREAM_ROLLING_CONTEXT_MS = max(200, _int_env("STT_STREAM_ROLLING_CONTEXT_MS", 8000))
STREAM_VAD_ENERGY_THRESHOLD_DB = _float_env("STT_STREAM_VAD_ENERGY_THRESHOLD_DB", -47.0)
STREAM_MAX_ACTIVE_STREAMS = max(1, _int_env("STT_STREAM_MAX_ACTIVE_STREAMS", 64))
STREAM_SLOT_WAIT_SECONDS = max(0.01, _float_env("STT_STREAM_SLOT_WAIT_SECONDS", 0.05))
STREAM_DECODE_MAX_CONCURRENCY = max(1, _int_env("STT_STREAM_DECODE_MAX_CONCURRENCY", 2))
STREAM_DECODE_QUEUE_TIMEOUT_SECONDS = max(
    0.01,
    _float_env("STT_STREAM_DECODE_QUEUE_TIMEOUT_SECONDS", 0.25),
)
STREAM_PARTIAL_DECODE_TIMEOUT_SECONDS = max(
    0.05,
    _float_env("STT_STREAM_PARTIAL_DECODE_TIMEOUT_SECONDS", 1.2),
)
STREAM_FINAL_DECODE_TIMEOUT_SECONDS = max(
    0.05,
    _float_env("STT_STREAM_FINAL_DECODE_TIMEOUT_SECONDS", 4.0),
)
STREAM_SKIP_PARTIAL_UNDER_BACKPRESSURE = _bool_env(
    "STT_STREAM_SKIP_PARTIAL_UNDER_BACKPRESSURE",
    True,
)
GPU_METRICS_ENABLED = _bool_env("STT_GPU_METRICS_ENABLED", True)
GPU_METRICS_CACHE_TTL_SECONDS = max(
    0.2,
    _float_env("STT_GPU_METRICS_CACHE_TTL_SECONDS", 2.0),
)
RELEASE_CHANNEL = (os.getenv("STT_RELEASE_CHANNEL") or "stable").strip().lower() or "stable"

_STREAM_SLOTS = asyncio.Semaphore(STREAM_MAX_ACTIVE_STREAMS)
_DECODE_SLOTS = asyncio.Semaphore(STREAM_DECODE_MAX_CONCURRENCY)
_SERVICE_LOAD = ServiceLoadState()
_GPU_METRICS_CACHE: dict[str, float | dict[str, float]] = {
    "checked_at": 0.0,
    "value": {},
}

app = FastAPI(title="IqraaAI Quran STT")


async def _send_json(websocket: WebSocket, payload: dict[str, object]) -> None:
    await websocket.send_text(json.dumps(payload, ensure_ascii=False))


def _read_gpu_metrics() -> dict[str, float]:
    if not GPU_METRICS_ENABLED:
        return {}

    now = time.perf_counter()
    checked_at = float(_GPU_METRICS_CACHE.get("checked_at") or 0.0)
    if now - checked_at <= GPU_METRICS_CACHE_TTL_SECONDS:
        cached = _GPU_METRICS_CACHE.get("value")
        if isinstance(cached, dict):
            return dict(cached)
        return {}

    metrics: dict[str, float] = {}
    try:
        completed = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=1.0,
        )
        if completed.returncode == 0:
            lines = (completed.stdout or b"").decode("utf-8", errors="ignore").splitlines()
            parsed_rows: list[tuple[float, float, float, float]] = []
            for line in lines:
                parts = [part.strip() for part in line.split(",")]
                if len(parts) < 4:
                    continue
                try:
                    parsed_rows.append(
                        (
                            float(parts[0]),
                            float(parts[1]),
                            float(parts[2]),
                            float(parts[3]),
                        )
                    )
                except ValueError:
                    continue
            if parsed_rows:
                gpu_count = float(len(parsed_rows))
                util_sum = sum(item[0] for item in parsed_rows)
                mem_used_sum = sum(item[1] for item in parsed_rows)
                mem_total_sum = sum(item[2] for item in parsed_rows)
                temp_sum = sum(item[3] for item in parsed_rows)
                metrics = {
                    "gpu_count": gpu_count,
                    "gpu_utilization_pct_avg": round(util_sum / gpu_count, 2),
                    "gpu_memory_used_mb": round(mem_used_sum, 2),
                    "gpu_memory_total_mb": round(mem_total_sum, 2),
                    "gpu_memory_utilization_pct": (
                        round((mem_used_sum / mem_total_sum) * 100.0, 2)
                        if mem_total_sum > 0
                        else 0.0
                    ),
                    "gpu_temp_c_avg": round(temp_sum / gpu_count, 2),
                }
    except Exception:
        metrics = {}

    _GPU_METRICS_CACHE["checked_at"] = now
    _GPU_METRICS_CACHE["value"] = metrics
    return dict(metrics)


def _service_load_snapshot() -> dict[str, object]:
    payload: dict[str, object] = _SERVICE_LOAD.snapshot()
    payload["stream_capacity"] = STREAM_MAX_ACTIVE_STREAMS
    payload["decode_capacity"] = STREAM_DECODE_MAX_CONCURRENCY
    payload["degraded_mode"] = bool(
        int(payload.get("queued_decodes") or 0) > 0
        or int(payload.get("queued_streams") or 0) > 0
    )
    gpu_metrics = _read_gpu_metrics()
    if gpu_metrics:
        payload["gpu"] = gpu_metrics
    return payload


async def _transcribe_with_load_shedding(
    *,
    pcm_float32: np.ndarray,
    is_final: bool,
    language_codes: list[str],
) -> tuple[str, float | None, str]:
    runtime = _asr_runtime()
    timeout_seconds = (
        STREAM_FINAL_DECODE_TIMEOUT_SECONDS
        if is_final
        else STREAM_PARTIAL_DECODE_TIMEOUT_SECONDS
    )

    _SERVICE_LOAD.add("queued_decodes", 1)
    try:
        try:
            await asyncio.wait_for(
                _DECODE_SLOTS.acquire(),
                timeout=STREAM_DECODE_QUEUE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            _SERVICE_LOAD.add("backpressure_timeouts", 1)
            raise DecodeBackpressureError("decode queue timeout") from exc
    finally:
        _SERVICE_LOAD.add("queued_decodes", -1)

    _SERVICE_LOAD.add("active_decodes", 1)
    try:
        try:
            transcript, confidence, decoder_pass = await asyncio.wait_for(
                asyncio.to_thread(
                    runtime.transcribe_pcm_with_meta,
                    pcm_float32,
                    is_final=is_final,
                    language_codes=language_codes,
                ),
                timeout=timeout_seconds,
            )
            return transcript, confidence, decoder_pass
        except asyncio.TimeoutError as exc:
            _SERVICE_LOAD.add("decode_timeouts", 1)
            raise DecodeTimeoutError("decode hard timeout") from exc
    finally:
        _SERVICE_LOAD.add("active_decodes", -1)
        _DECODE_SLOTS.release()


async def _send_latency_meta(websocket: WebSocket, state: StreamingSessionState) -> None:
    now = time.perf_counter()
    payload: dict[str, object] = {
        "type": "latency_meta",
        "ts_ms": _now_ms(),
        "frames_received": state.frames_received,
        "buffered_audio_ms": _buffer_ms(state.pcm_buffer, state.sample_rate_hz),
        "partials_emitted": state.partial_count,
    }
    if state.first_audio_received_at is not None:
        payload["stream_elapsed_ms"] = int((now - state.first_audio_received_at) * 1000)
    if state.first_partial_sent_at is not None and state.first_audio_received_at is not None:
        payload["first_partial_latency_ms"] = int(
            (state.first_partial_sent_at - state.first_audio_received_at) * 1000
        )
    if state.final_sent_at is not None and state.first_audio_received_at is not None:
        payload["final_latency_ms"] = int((state.final_sent_at - state.first_audio_received_at) * 1000)
    payload["load"] = _service_load_snapshot()
    payload["release_channel"] = RELEASE_CHANNEL
    if state.partials_skipped_due_to_load > 0:
        payload["partials_skipped_due_to_load"] = state.partials_skipped_due_to_load
    if state.final_fallback_reason:
        payload["final_fallback_reason"] = state.final_fallback_reason
    if state.degraded_reasons:
        payload["degraded_reasons"] = sorted(state.degraded_reasons)
    await _send_json(websocket, payload)


async def _emit_partial_if_needed(websocket: WebSocket, state: StreamingSessionState) -> None:
    buffered_ms = _buffer_ms(state.pcm_buffer, state.sample_rate_hz)
    if buffered_ms < state.min_partial_audio_ms:
        return
    if buffered_ms - state.last_partial_audio_ms < state.partial_interval_ms:
        return
    if STREAM_SKIP_PARTIAL_UNDER_BACKPRESSURE:
        load = _SERVICE_LOAD.snapshot()
        if load["queued_decodes"] > 0 or load["queued_streams"] > 0:
            state.last_partial_audio_ms = buffered_ms
            state.partials_skipped_due_to_load += 1
            state.degraded_reasons.add("partial_skipped_due_to_load")
            _SERVICE_LOAD.add("skipped_partials", 1)
            return

    context_ms = min(state.rolling_context_ms, buffered_ms)
    context_samples = max(1, int((context_ms / 1000.0) * state.sample_rate_hz))
    context_bytes = context_samples * 2
    window_pcm = bytes(state.pcm_buffer[-context_bytes:])
    pcm_float32 = _pcm16_to_float32(window_pcm)
    try:
        transcript, confidence, decoder_pass = await _transcribe_with_load_shedding(
            pcm_float32=pcm_float32,
            is_final=False,
            language_codes=state.language_codes,
        )
    except DecodeBackpressureError:
        state.degraded_reasons.add("partial_backpressure_timeout")
        return
    except DecodeTimeoutError:
        state.degraded_reasons.add("partial_decode_timeout")
        return
    except Exception as exc:
        logger.warning("partial decode failed: %s", exc)
        state.degraded_reasons.add("partial_decode_error")
        return
    transcript = transcript.strip()
    state.last_partial_audio_ms = buffered_ms
    if not transcript:
        return

    tokens = tokenize_arabic_text(transcript)
    previous_partial = state.last_partial_transcript
    state.last_partial_transcript = transcript
    state.last_partial_tokens = tokens
    state.last_partial_confidence = float(confidence) if confidence is not None else 0.0
    if transcript == previous_partial and state.partial_count > 0:
        return

    state.partial_count += 1
    if state.first_partial_sent_at is None:
        state.first_partial_sent_at = time.perf_counter()

    await _send_json(
        websocket,
        {
            "type": "partial",
            "protocol_version": state.protocol_version,
            "ts_ms": _now_ms(),
            "transcript": transcript,
            "tokens": tokens,
            "confidence": float(confidence) if confidence is not None else 0.0,
            "decoder_pass": decoder_pass,
            "stream_offset_ms": buffered_ms,
        },
    )

    if state.partial_count == 1:
        await _send_latency_meta(websocket, state)


async def _ingest_pcm_frame(
    websocket: WebSocket,
    state: StreamingSessionState,
    frame_bytes: bytes,
) -> None:
    if not frame_bytes:
        return
    if state.first_audio_received_at is None:
        state.first_audio_received_at = time.perf_counter()
    state.frames_received += 1
    state.pcm_buffer.extend(frame_bytes)

    has_speech = _pcm16_has_speech(
        frame_bytes,
        energy_threshold_db=state.vad_energy_threshold_db,
    )
    next_vad_state = "speech" if has_speech else "silence"
    if next_vad_state != state.vad_state:
        state.vad_state = next_vad_state
        await _send_json(
            websocket,
            {
                "type": "vad_state",
                "protocol_version": state.protocol_version,
                "ts_ms": _now_ms(),
                "state": state.vad_state,
                "stream_offset_ms": _buffer_ms(state.pcm_buffer, state.sample_rate_hz),
            },
        )

    await _emit_partial_if_needed(websocket, state)


async def _emit_final(websocket: WebSocket, state: StreamingSessionState) -> None:
    transcript = ""
    tokens: list[str] = []
    confidence: float | None = None
    runtime = _asr_runtime()
    decoder_pass = "quran_final" if runtime.two_pass_enabled else "final"
    fallback_reason: str | None = None
    if state.pcm_buffer:
        pcm_float32 = _pcm16_to_float32(bytes(state.pcm_buffer))
        try:
            transcript, confidence, decoder_pass = await _transcribe_with_load_shedding(
                pcm_float32=pcm_float32,
                is_final=True,
                language_codes=state.language_codes,
            )
            transcript = transcript.strip()
            tokens = tokenize_arabic_text(transcript)
        except DecodeBackpressureError:
            fallback_reason = "final_backpressure_timeout"
        except DecodeTimeoutError:
            fallback_reason = "final_decode_timeout"
        except Exception as exc:
            logger.warning("final decode failed: %s", exc)
            fallback_reason = "final_decode_error"

    if fallback_reason:
        _SERVICE_LOAD.add("fallback_finals", 1)
        state.final_fallback_reason = fallback_reason
        state.degraded_reasons.add(fallback_reason)
        if state.last_partial_transcript:
            transcript = state.last_partial_transcript
            tokens = list(state.last_partial_tokens)
            confidence = state.last_partial_confidence
            decoder_pass = "fallback_partial"
        else:
            transcript = ""
            tokens = []
            confidence = 0.0
            decoder_pass = "fallback_empty"

    state.final_sent_at = time.perf_counter()
    await _send_latency_meta(websocket, state)
    await _send_json(
        websocket,
        {
            "type": "final",
            "protocol_version": state.protocol_version,
            "ts_ms": _now_ms(),
            "transcript": transcript,
            "tokens": tokens,
            "confidence": float(confidence) if confidence is not None else 0.0,
            "decoder_pass": decoder_pass,
            "stream_offset_ms": _buffer_ms(state.pcm_buffer, state.sample_rate_hz),
            "degraded": bool(state.degraded_reasons),
            "fallback_reason": state.final_fallback_reason,
        },
    )


async def _run_legacy_ws_once(websocket: WebSocket, request_payload: dict[str, object]) -> None:
    language_codes = None
    raw_language_codes = request_payload.get("language_codes")
    if isinstance(raw_language_codes, list):
        language_codes = [
            str(item).strip()
            for item in raw_language_codes
            if isinstance(item, str) and item.strip()
        ]

    audio_frame = await websocket.receive()
    audio_bytes = audio_frame.get("bytes") if isinstance(audio_frame, dict) else None
    if not isinstance(audio_bytes, (bytes, bytearray)):
        raise RuntimeError("Legacy WS mode expects a binary audio frame")

    result = await asyncio.to_thread(
        _transcribe_audio_bytes,
        audio_bytes=bytes(audio_bytes),
        language_codes=language_codes,
    )
    result["type"] = "final"
    result["protocol_version"] = 1
    result["ts_ms"] = _now_ms()
    await _send_json(websocket, result)


async def _run_streaming_ws(
    websocket: WebSocket,
    *,
    start_payload: dict[str, object] | None = None,
    first_audio_frame: bytes | None = None,
) -> None:
    stream_slot_acquired = False
    try:
        _SERVICE_LOAD.add("queued_streams", 1)
        try:
            await asyncio.wait_for(_STREAM_SLOTS.acquire(), timeout=STREAM_SLOT_WAIT_SECONDS)
        except asyncio.TimeoutError:
            _SERVICE_LOAD.add("rejected_streams", 1)
            await _send_json(
                websocket,
                {
                    "type": "error",
                    "ts_ms": _now_ms(),
                    "error": "stt_overloaded",
                    "retryable": True,
                },
            )
            return
        finally:
            _SERVICE_LOAD.add("queued_streams", -1)

        stream_slot_acquired = True
        _SERVICE_LOAD.add("active_streams", 1)

        runtime = _asr_runtime()
        payload = start_payload or {}
        sample_rate_hz = max(
            8000,
            int(payload.get("sample_rate_hz") or runtime.sample_rate_hz),
        )
        frame_ms = _clamp_frame_ms(int(payload.get("frame_ms") or STREAM_DEFAULT_FRAME_MS))
        partial_interval_ms = max(
            40,
            int(payload.get("partial_interval_ms") or STREAM_PARTIAL_INTERVAL_MS),
        )
        min_partial_audio_ms = max(
            40,
            int(payload.get("min_partial_audio_ms") or STREAM_MIN_PARTIAL_AUDIO_MS),
        )
        rolling_context_ms = max(
            200,
            int(payload.get("rolling_context_ms") or STREAM_ROLLING_CONTEXT_MS),
        )
        protocol_version = max(1, int(payload.get("protocol_version") or 2))
        raw_languages = payload.get("language_codes")
        language_codes = (
            [
                str(item).strip()
                for item in raw_languages
                if isinstance(item, str) and item.strip()
            ]
            if isinstance(raw_languages, list)
            else [runtime.default_language]
        )
        if not language_codes:
            language_codes = [runtime.default_language]

        state = StreamingSessionState(
            sample_rate_hz=sample_rate_hz,
            frame_ms=frame_ms,
            language_codes=language_codes,
            rolling_context_ms=rolling_context_ms,
            partial_interval_ms=partial_interval_ms,
            min_partial_audio_ms=min_partial_audio_ms,
            vad_energy_threshold_db=STREAM_VAD_ENERGY_THRESHOLD_DB,
            protocol_version=protocol_version,
        )

        if first_audio_frame:
            await _ingest_pcm_frame(websocket, state, first_audio_frame)

        while True:
            message = await websocket.receive()
            if not isinstance(message, dict):
                continue
            if message.get("type") == "websocket.disconnect":
                return

            binary_payload = message.get("bytes")
            if isinstance(binary_payload, (bytes, bytearray)):
                await _ingest_pcm_frame(websocket, state, bytes(binary_payload))
                continue

            text_payload = message.get("text")
            if not isinstance(text_payload, str):
                continue

            try:
                control = json.loads(text_payload)
            except json.JSONDecodeError:
                continue
            if not isinstance(control, dict):
                continue

            control_type = str(control.get("type") or "").strip().lower()
            if control_type in {"audio_end", "commit", "stop"}:
                await _emit_final(websocket, state)
                return
            if control_type in {"ping", "latency_meta"}:
                await _send_latency_meta(websocket, state)
                continue
            if control_type in {"audio.append", "audio_frame"}:
                audio_base64 = control.get("audio_base64")
                if isinstance(audio_base64, str) and audio_base64:
                    try:
                        decoded = base64.b64decode(audio_base64, validate=True)
                    except Exception:
                        continue
                    await _ingest_pcm_frame(websocket, state, decoded)
                    continue
    finally:
        if stream_slot_acquired:
            _SERVICE_LOAD.add("active_streams", -1)
            _STREAM_SLOTS.release()


@app.get("/healthz")
async def healthz():
    runtime_model = None
    runtime_final_model = None
    runtime_device = None
    runtime_compute_type = None
    runtime_final_compute_type = None
    two_pass_enabled = False
    if _MODEL_READY:
        runtime = _asr_runtime()
        runtime_model = runtime.model_id
        runtime_final_model = runtime.final_model_id
        runtime_device = runtime.device
        runtime_compute_type = runtime.compute_type
        runtime_final_compute_type = runtime.final_compute_type
        two_pass_enabled = runtime.two_pass_enabled
    return {
        "ok": True,
        "model_ready": _MODEL_READY,
        "model_id": runtime_model,
        "final_model_id": runtime_final_model,
        "device": runtime_device,
        "compute_type": runtime_compute_type,
        "final_compute_type": runtime_final_compute_type,
        "two_pass_enabled": two_pass_enabled,
        "preload_enabled": PRELOAD_MODEL_ON_STARTUP,
        "release_channel": RELEASE_CHANNEL,
        "load": _service_load_snapshot(),
    }


@app.get("/metrics")
async def metrics():
    return {
        "ok": True,
        "model_ready": _MODEL_READY,
        "release_channel": RELEASE_CHANNEL,
        "load": _service_load_snapshot(),
    }


@app.get("/readyz")
async def readyz():
    if PRELOAD_MODEL_ON_STARTUP and not _MODEL_READY:
        raise HTTPException(status_code=503, detail={"ok": False, "error": _MODEL_ERROR})
    return {"ok": True, "model_ready": _MODEL_READY}


@app.on_event("startup")
async def preload_model_on_startup():
    global _MODEL_READY, _MODEL_ERROR
    if not PRELOAD_MODEL_ON_STARTUP:
        return
    try:
        await asyncio.to_thread(_asr_runtime)
        _MODEL_READY = True
        _MODEL_ERROR = None
        logger.info("stt model preloaded on startup")
    except Exception as exc:  # pragma: no cover - depends on runtime/model availability
        _MODEL_READY = False
        _MODEL_ERROR = str(exc)
        logger.exception("stt model preload failed: %s", exc)
        if FAIL_ON_PRELOAD_ERROR:
            raise


@app.post("/score")
async def score(request: Request):
    _require_auth(request)
    audio_bytes = await request.body()
    language_codes = _language_codes_from_header(request.headers.get("x-tasmee-language-codes"))
    return await asyncio.to_thread(
        _transcribe_audio_bytes,
        audio_bytes=audio_bytes,
        language_codes=language_codes,
    )


@app.websocket("/ws")
async def ws_score(websocket: WebSocket):
    if not _is_authorized(websocket.headers.get("authorization")):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    try:
        first_message = await websocket.receive()
        if first_message.get("type") == "websocket.disconnect":
            return

        text_payload = first_message.get("text")
        binary_payload = first_message.get("bytes")

        if isinstance(text_payload, str):
            try:
                first_payload = json.loads(text_payload)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"Invalid WS JSON payload: {exc}") from exc
            if not isinstance(first_payload, dict):
                raise RuntimeError("Invalid WS payload; expected object")

            message_type = str(first_payload.get("type") or "").strip().lower()
            if message_type == "stt.request":
                await _run_legacy_ws_once(websocket, first_payload)
            else:
                await _run_streaming_ws(websocket, start_payload=first_payload)
            return

        if isinstance(binary_payload, (bytes, bytearray)):
            await _run_streaming_ws(websocket, first_audio_frame=bytes(binary_payload))
            return

        raise RuntimeError("Unsupported WS frame type")
    except WebSocketDisconnect:
        return
    except Exception as exc:
        message = str(exc)
        await _send_json(
            websocket,
            {
                "type": "error",
                "transcript": "",
                "confidence": 0.0,
                "error": message,
                "ts_ms": _now_ms(),
            },
        )
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
