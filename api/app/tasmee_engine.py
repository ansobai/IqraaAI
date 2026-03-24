from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx

from .tasmee_text import tokenize_arabic_text

logger = logging.getLogger(__name__)
AZURE_STT_HOST_PATTERN = re.compile(
    r"^[^.]+\.([a-z0-9-]+)\.inference\.ml\.azure\.com$",
    re.IGNORECASE,
)


@dataclass
class ChunkRecognitionInput:
    audio_bytes: bytes
    mime_type: str
    level_db: float | None
    has_speech: bool | None
    duration_ms: int
    next_word_index: int
    anchor_set: bool


@dataclass
class ChunkRecognitionResult:
    has_speech: bool
    confidence: float
    level_db: float
    confirmed_word_indexes: list[int]
    start_anchor_word_index: int | None = None
    start_anchor_confidence: float | None = None
    transcript: str | None = None
    recognized_tokens: list[str] = field(default_factory=list)
    stt_latency_meta: dict[str, float] | None = None
    token_source: str = "none"
    partial_stability: float | None = None


class BaseTasmeeRecognizer:
    def analyze_chunk(self, payload: ChunkRecognitionInput) -> ChunkRecognitionResult:
        raise NotImplementedError


def _bool_env(name: str, default: bool = False) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _extract_azure_region_from_url(endpoint_url: str) -> str | None:
    try:
        host = (urlparse(endpoint_url).hostname or "").strip().lower()
    except Exception:
        return None
    if not host:
        return None
    match = AZURE_STT_HOST_PATTERN.match(host)
    if not match:
        return None
    return match.group(1).strip().lower() or None


def _validate_remote_stt_region(endpoint_url: str) -> None:
    expected_region = (os.getenv("TASMEE_EXPECTED_STT_REGION") or "").strip().lower()
    strict = _bool_env("TASMEE_STRICT_STT_REGION_CHECK", False)
    if not expected_region:
        return

    detected_region = _extract_azure_region_from_url(endpoint_url)
    if not detected_region:
        logger.warning(
            "tasmee remote stt region check skipped: unable to parse azure region from %s",
            endpoint_url,
        )
        return
    if detected_region == expected_region:
        return

    message = (
        f"TASMEE_REMOTE_STT endpoint region mismatch: expected={expected_region}, "
        f"detected={detected_region}. This can add cross-region latency."
    )
    if strict:
        raise RuntimeError(message)
    logger.warning(message)


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


def _clamp_remote_frame_ms(value: int) -> int:
    return max(20, min(40, value))


def _decode_audio_bytes_to_pcm16(
    audio_bytes: bytes,
    *,
    sample_rate_hz: int,
) -> bytes:
    if not audio_bytes:
        return b""
    ffmpeg_bin = (os.getenv("TASMEE_FFMPEG_BIN") or "ffmpeg").strip() or "ffmpeg"
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
        raise RuntimeError(f"ffmpeg decode failed (code={completed.returncode}): {stderr[:240]}")
    return completed.stdout or b""


def _coerce_tokens(raw_tokens: object) -> list[str]:
    tokens: list[str] = []
    if not isinstance(raw_tokens, list):
        return tokens
    for item in raw_tokens:
        if isinstance(item, str) and item.strip():
            tokens.append(item.strip())
    return tokens


def _longest_common_prefix_tokens(left: list[str], right: list[str]) -> list[str]:
    if not left or not right:
        return []
    limit = min(len(left), len(right))
    for index in range(limit):
        if left[index] != right[index]:
            return left[:index]
    return left[:limit]


class HeuristicTasmeeRecognizer(BaseTasmeeRecognizer):
    """
    Lightweight recognizer adapter used by the tasmee service.

    This recognizer keeps the existing monotonic word-index behavior for
    heuristic mode but treats missing metering as unknown/non-progress.
    """

    def __init__(
        self,
        speech_level_db_threshold: float = -48.0,
    ):
        self._speech_level_db_threshold = speech_level_db_threshold

    def analyze_chunk(self, payload: ChunkRecognitionInput) -> ChunkRecognitionResult:
        level_db = self._resolve_level_db(payload)

        has_speech = (
            payload.has_speech
            if payload.has_speech is not None
            else level_db >= self._speech_level_db_threshold
        )
        confidence = self._estimate_confidence(level_db, has_speech)

        confirmed_word_indexes: list[int] = []
        start_anchor_word_index: int | None = None
        start_anchor_confidence: float | None = None

        if has_speech:
            confirmed_word_indexes = [max(0, payload.next_word_index)]
            if not payload.anchor_set:
                start_anchor_word_index = confirmed_word_indexes[0]
                start_anchor_confidence = confidence

        return ChunkRecognitionResult(
            has_speech=has_speech,
            confidence=confidence,
            level_db=level_db,
            confirmed_word_indexes=confirmed_word_indexes,
            start_anchor_word_index=start_anchor_word_index,
            start_anchor_confidence=start_anchor_confidence,
            transcript=None,
            recognized_tokens=[],
        )

    def _resolve_level_db(self, payload: ChunkRecognitionInput) -> float:
        if payload.level_db is not None:
            return float(payload.level_db)
        if payload.has_speech is True:
            # No meter provided, but client-side VAD reported speech.
            return -35.0
        # Missing meter is treated as unknown/non-progress instead of trying to
        # infer from compressed bytes.
        return -120.0

    @staticmethod
    def _estimate_confidence(level_db: float, has_speech: bool) -> float:
        if not has_speech:
            return 0.0

        normalized = max(0.0, min(1.0, (level_db + 55.0) / 25.0))
        return 0.75 + normalized * 0.24


class GoogleSttTasmeeRecognizer(BaseTasmeeRecognizer):
    """
    Google Speech-to-Text recognizer for tasmee alignment mode.

    It returns normalized recognized tokens; alignment is handled in
    tasmee_main against the current page lexicon.
    """

    def __init__(
        self,
        recognizer_resource: str | None = None,
        language_codes: list[str] | None = None,
        model: str | None = None,
        speech_level_db_threshold: float = -48.0,
    ):
        self._speech_level_db_threshold = speech_level_db_threshold
        self._recognizer_resource = (
            recognizer_resource
            or os.getenv("TASMEE_GOOGLE_RECOGNIZER", "").strip()
        )
        languages_raw = os.getenv("TASMEE_GOOGLE_LANGUAGE_CODES", "ar")
        env_codes = [code.strip() for code in languages_raw.split(",") if code.strip()]
        self._language_codes = language_codes or env_codes or ["ar"]
        self._model = model or os.getenv("TASMEE_GOOGLE_MODEL", "chirp_2").strip() or "chirp_2"

        self._client = None
        self._cloud_speech = None

        try:
            from google.cloud import speech_v2
            from google.cloud.speech_v2.types import cloud_speech

            self._client = speech_v2.SpeechClient()
            self._cloud_speech = cloud_speech
        except Exception as error:  # pragma: no cover - dependency/env dependent
            logger.warning("google stt recognizer unavailable: %s", error)

        if not self._recognizer_resource:
            logger.warning("TASMEE_GOOGLE_RECOGNIZER is not set; google recognizer disabled")

    def analyze_chunk(self, payload: ChunkRecognitionInput) -> ChunkRecognitionResult:
        level_db = self._resolve_level_db(payload)
        has_speech = (
            payload.has_speech
            if payload.has_speech is not None
            else level_db >= self._speech_level_db_threshold
        )

        if not has_speech:
            return ChunkRecognitionResult(
                has_speech=False,
                confidence=0.0,
                level_db=level_db,
                confirmed_word_indexes=[],
                transcript=None,
                recognized_tokens=[],
            )

        transcript, transcript_confidence = self._transcribe(payload.audio_bytes)
        tokens = tokenize_arabic_text(transcript or "")
        confidence = (
            transcript_confidence
            if transcript_confidence is not None and transcript_confidence > 0
            else HeuristicTasmeeRecognizer._estimate_confidence(level_db, has_speech)
        )

        return ChunkRecognitionResult(
            has_speech=has_speech,
            confidence=confidence,
            level_db=level_db,
            confirmed_word_indexes=[],
            transcript=transcript,
            recognized_tokens=tokens,
        )

    def _resolve_level_db(self, payload: ChunkRecognitionInput) -> float:
        if payload.level_db is not None:
            return float(payload.level_db)
        if payload.has_speech is True:
            return -35.0
        return -120.0

    def _transcribe(self, audio_bytes: bytes) -> tuple[str | None, float | None]:
        if not audio_bytes or not self._client or not self._cloud_speech or not self._recognizer_resource:
            return None, None

        try:  # pragma: no cover - depends on cloud credentials/runtime
            cloud_speech = self._cloud_speech
            request = cloud_speech.RecognizeRequest(
                recognizer=self._recognizer_resource,
                config=cloud_speech.RecognitionConfig(
                    auto_decoding_config=cloud_speech.AutoDetectDecodingConfig(),
                    language_codes=self._language_codes,
                    model=self._model,
                ),
                content=audio_bytes,
            )
            response = self._client.recognize(request=request)

            best_transcript: str | None = None
            best_confidence: float | None = None

            for result in response.results:
                alternatives = list(result.alternatives)
                if not alternatives:
                    continue
                alternative = alternatives[0]
                transcript = (alternative.transcript or "").strip()
                if transcript and not best_transcript:
                    best_transcript = transcript
                confidence = float(getattr(alternative, "confidence", 0.0) or 0.0)
                if confidence > 0 and (best_confidence is None or confidence > best_confidence):
                    best_confidence = confidence

            return best_transcript, best_confidence
        except Exception as error:
            logger.warning("google stt recognize call failed: %s", error)
            return None, None


class RemoteHttpTasmeeRecognizer(BaseTasmeeRecognizer):
    """
    Remote speech-to-text recognizer for tasmee alignment mode.

    This recognizer sends each audio chunk to a remote HTTP endpoint and expects
    a JSON response containing either `tokens` or `transcript`.
    """

    def __init__(
        self,
        url: str | None = None,
        bearer_token: str | None = None,
        language_codes: list[str] | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
        speech_level_db_threshold: float = -48.0,
        client: httpx.Client | None = None,
    ):
        self._speech_level_db_threshold = speech_level_db_threshold
        self._url = (url or os.getenv("TASMEE_REMOTE_STT_URL", "")).strip()
        if not self._url:
            raise RuntimeError("TASMEE_REMOTE_STT_URL is not set; remote recognizer disabled")
        _validate_remote_stt_region(self._url)

        self._bearer_token = (bearer_token or os.getenv("TASMEE_REMOTE_STT_BEARER_TOKEN", "")).strip()

        languages_raw = os.getenv("TASMEE_REMOTE_LANGUAGE_CODES", "ar")
        env_codes = [code.strip() for code in languages_raw.split(",") if code.strip()]
        self._language_codes = language_codes or env_codes or ["ar"]

        self._model = (model or os.getenv("TASMEE_REMOTE_MODEL", "")).strip() or None

        resolved_timeout = timeout_seconds
        if resolved_timeout is None:
            timeout_raw = (os.getenv("TASMEE_REMOTE_TIMEOUT_SECONDS") or "").strip()
            if timeout_raw:
                try:
                    resolved_timeout = float(timeout_raw)
                except ValueError:
                    logger.warning(
                        "invalid TASMEE_REMOTE_TIMEOUT_SECONDS=%s, using default=2.0",
                        timeout_raw,
                    )
                    resolved_timeout = 2.0
            else:
                resolved_timeout = 2.0

        self._timeout = max(0.1, float(resolved_timeout))
        self._client = client or httpx.Client(timeout=httpx.Timeout(self._timeout))

    def analyze_chunk(self, payload: ChunkRecognitionInput) -> ChunkRecognitionResult:
        level_db = self._resolve_level_db(payload)
        has_speech = (
            payload.has_speech
            if payload.has_speech is not None
            else level_db >= self._speech_level_db_threshold
        )

        if not has_speech:
            return ChunkRecognitionResult(
                has_speech=False,
                confidence=0.0,
                level_db=level_db,
                confirmed_word_indexes=[],
                transcript=None,
                recognized_tokens=[],
            )

        transcript, tokens, transcript_confidence = self._transcribe(
            audio_bytes=payload.audio_bytes,
            mime_type=payload.mime_type,
            duration_ms=payload.duration_ms,
        )

        confidence = (
            transcript_confidence
            if transcript_confidence is not None and transcript_confidence > 0
            else HeuristicTasmeeRecognizer._estimate_confidence(level_db, has_speech)
        )

        normalized_tokens = tokens
        if not normalized_tokens and transcript:
            normalized_tokens = tokenize_arabic_text(transcript)
        elif normalized_tokens:
            normalized_tokens = tokenize_arabic_text(" ".join(normalized_tokens))

        return ChunkRecognitionResult(
            has_speech=True,
            confidence=confidence,
            level_db=level_db,
            confirmed_word_indexes=[],
            transcript=transcript,
            recognized_tokens=normalized_tokens,
        )

    def _resolve_level_db(self, payload: ChunkRecognitionInput) -> float:
        if payload.level_db is not None:
            return float(payload.level_db)
        if payload.has_speech is True:
            return -35.0
        return -120.0

    def _transcribe(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        duration_ms: int,
    ) -> tuple[str | None, list[str], float | None]:
        if not audio_bytes:
            return None, [], None

        headers: dict[str, str] = {
            "Accept": "application/json",
            "Content-Type": mime_type or "application/octet-stream",
            "X-Tasmee-Language-Codes": ",".join(self._language_codes),
            "X-Tasmee-Duration-Ms": str(int(duration_ms)),
        }
        if self._bearer_token:
            headers["Authorization"] = f"Bearer {self._bearer_token}"
        if self._model:
            headers["X-Tasmee-Model"] = self._model

        try:
            response = self._client.post(
                self._url,
                content=audio_bytes,
                headers=headers,
            )
        except Exception as error:
            logger.warning("remote stt request failed: %s", error)
            return None, [], None

        if response.status_code != 200:
            logger.warning(
                "remote stt non-200 response: status=%s body=%s",
                response.status_code,
                (response.text or "")[:400],
            )
            return None, [], None

        try:
            payload = response.json()
        except Exception as error:
            logger.warning("remote stt invalid json response: %s", error)
            return None, [], None

        transcript = payload.get("transcript")
        transcript_value = transcript.strip() if isinstance(transcript, str) else None

        confidence = payload.get("confidence")
        confidence_value = float(confidence) if isinstance(confidence, (int, float)) else None

        tokens: list[str] = []
        raw_tokens = payload.get("tokens")
        if isinstance(raw_tokens, list):
            for item in raw_tokens:
                if isinstance(item, str) and item.strip():
                    tokens.append(item.strip())

        return transcript_value, tokens, confidence_value


class RemoteWsTasmeeRecognizer(BaseTasmeeRecognizer):
    """
    Remote speech-to-text recognizer over WebSocket.

    Streaming protocol (v2):
      - Client sends `start` metadata.
      - Client sends 20-40 ms binary PCM frames.
      - Client sends `audio_end` to flush final hypothesis.
      - Server emits `partial`, `final`, `vad_state`, and `latency_meta`.

    Falls back to legacy protocol (v1) if streaming fails.
    """

    def __init__(
        self,
        ws_url: str | None = None,
        bearer_token: str | None = None,
        language_codes: list[str] | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
        protocol_version: int | None = None,
        speech_level_db_threshold: float = -48.0,
    ):
        self._speech_level_db_threshold = speech_level_db_threshold
        self._ws_url = (ws_url or os.getenv("TASMEE_REMOTE_STT_WS_URL", "")).strip()
        if not self._ws_url:
            raise RuntimeError("TASMEE_REMOTE_STT_WS_URL is not set; remote_ws recognizer disabled")
        _validate_remote_stt_region(self._ws_url)

        self._bearer_token = (bearer_token or os.getenv("TASMEE_REMOTE_STT_BEARER_TOKEN", "")).strip()

        languages_raw = os.getenv("TASMEE_REMOTE_LANGUAGE_CODES", "ar")
        env_codes = [code.strip() for code in languages_raw.split(",") if code.strip()]
        self._language_codes = language_codes or env_codes or ["ar"]

        self._model = (model or os.getenv("TASMEE_REMOTE_MODEL", "")).strip() or None

        resolved_timeout = timeout_seconds
        if resolved_timeout is None:
            timeout_raw = (os.getenv("TASMEE_REMOTE_TIMEOUT_SECONDS") or "").strip()
            if timeout_raw:
                try:
                    resolved_timeout = float(timeout_raw)
                except ValueError:
                    logger.warning(
                        "invalid TASMEE_REMOTE_TIMEOUT_SECONDS=%s, using default=2.0",
                        timeout_raw,
                    )
                    resolved_timeout = 2.0
            else:
                resolved_timeout = 2.0
        self._timeout = max(0.1, float(resolved_timeout))

        resolved_protocol = protocol_version
        if resolved_protocol is None:
            raw_protocol = (os.getenv("TASMEE_REMOTE_STT_PROTOCOL_VERSION") or "").strip()
            if raw_protocol:
                try:
                    resolved_protocol = int(raw_protocol)
                except ValueError:
                    resolved_protocol = 2
            else:
                resolved_protocol = 2
        self._protocol_version = max(1, int(resolved_protocol))
        self._frame_ms = _clamp_remote_frame_ms(_int_env("TASMEE_REMOTE_STT_FRAME_MS", 30))
        self._sample_rate_hz = max(8000, _int_env("TASMEE_REMOTE_STT_SAMPLE_RATE_HZ", 16000))
        self._stream_realtime = _bool_env("TASMEE_REMOTE_STT_STREAM_REALTIME", False)
        self._final_wait_seconds = max(
            0.05,
            _float_env("TASMEE_REMOTE_STT_FINAL_WAIT_SECONDS", self._timeout),
        )
        self._return_partial_on_timeout = _bool_env(
            "TASMEE_REMOTE_STT_RETURN_PARTIAL_ON_TIMEOUT",
            True,
        )

    def analyze_chunk(self, payload: ChunkRecognitionInput) -> ChunkRecognitionResult:
        level_db = self._resolve_level_db(payload)
        has_speech = (
            payload.has_speech
            if payload.has_speech is not None
            else level_db >= self._speech_level_db_threshold
        )

        if not has_speech:
            return ChunkRecognitionResult(
                has_speech=False,
                confidence=0.0,
                level_db=level_db,
                confirmed_word_indexes=[],
                transcript=None,
                recognized_tokens=[],
                stt_latency_meta=None,
                token_source="none",
            )

        (
            transcript,
            tokens,
            transcript_confidence,
            latency_meta,
            token_source,
            partial_stability,
        ) = asyncio.run(
            self._transcribe_ws(
                audio_bytes=payload.audio_bytes,
                mime_type=payload.mime_type,
                duration_ms=payload.duration_ms,
            )
        )

        confidence = (
            transcript_confidence
            if transcript_confidence is not None and transcript_confidence > 0
            else HeuristicTasmeeRecognizer._estimate_confidence(level_db, has_speech)
        )

        return ChunkRecognitionResult(
            has_speech=True,
            confidence=confidence,
            level_db=level_db,
            confirmed_word_indexes=[],
            transcript=transcript,
            recognized_tokens=tokens,
            stt_latency_meta=latency_meta or None,
            token_source=token_source,
            partial_stability=partial_stability,
        )

    def _resolve_level_db(self, payload: ChunkRecognitionInput) -> float:
        if payload.level_db is not None:
            return float(payload.level_db)
        if payload.has_speech is True:
            return -35.0
        return -120.0

    async def _transcribe_ws(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        duration_ms: int,
    ) -> tuple[str | None, list[str], float | None, dict[str, float], str, float | None]:
        if self._protocol_version <= 1:
            return await self._transcribe_ws_legacy(
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                duration_ms=duration_ms,
            )
        try:
            return await self._transcribe_ws_streaming(
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                duration_ms=duration_ms,
            )
        except Exception as error:
            logger.warning("remote_ws streaming failed; falling back to legacy protocol: %s", error)
            return await self._transcribe_ws_legacy(
                audio_bytes=audio_bytes,
                mime_type=mime_type,
                duration_ms=duration_ms,
            )

    async def _transcribe_ws_legacy(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        duration_ms: int,
    ) -> tuple[str | None, list[str], float | None, dict[str, float], str, float | None]:
        if not audio_bytes:
            return None, [], None, {}, "none", None

        try:
            import websockets  # type: ignore
        except Exception as error:
            logger.warning("websockets dependency missing for remote_ws: %s", error)
            return None, [], None, {}, "none", None

        extra_headers: list[tuple[str, str]] = [
            ("Accept", "application/json"),
            ("X-Tasmee-Protocol", str(self._protocol_version)),
            ("X-Tasmee-Language-Codes", ",".join(self._language_codes)),
            ("X-Tasmee-Duration-Ms", str(int(duration_ms))),
        ]
        if self._bearer_token:
            extra_headers.append(("Authorization", f"Bearer {self._bearer_token}"))
        if self._model:
            extra_headers.append(("X-Tasmee-Model", self._model))

        request = {
            "type": "stt.request",
            "protocol_version": self._protocol_version,
            "mime_type": mime_type or "application/octet-stream",
            "duration_ms": int(duration_ms),
            "language_codes": list(self._language_codes),
            "model": self._model,
        }

        try:
            connect = websockets.connect  # type: ignore[attr-defined]
            try:
                websocket_ctx = connect(
                    self._ws_url,
                    extra_headers=extra_headers,
                    open_timeout=self._timeout,
                    ping_interval=None,
                    ping_timeout=None,
                )
            except TypeError:
                websocket_ctx = connect(
                    self._ws_url,
                    additional_headers=extra_headers,
                    open_timeout=self._timeout,
                    ping_interval=None,
                    ping_timeout=None,
                )

            async with websocket_ctx as websocket:
                await websocket.send(json.dumps(request, ensure_ascii=False))
                await websocket.send(audio_bytes)
                response_text = await asyncio.wait_for(websocket.recv(), timeout=self._timeout)
        except Exception as error:
            logger.warning("remote_ws stt request failed: %s", error)
            return None, [], None, {}, "none", None

        if not isinstance(response_text, str):
            logger.warning("remote_ws stt invalid response type: %s", type(response_text))
            return None, [], None, {}, "none", None

        try:
            payload = json.loads(response_text)
        except Exception as error:
            logger.warning("remote_ws stt invalid json response: %s", error)
            return None, [], None, {}, "none", None

        transcript_value, tokens, confidence_value = self._extract_transcript_payload(payload)
        normalized_tokens = self._normalize_tokens(tokens, transcript_value)
        latency_meta = self._extract_latency_meta(payload)
        token_source = "final" if normalized_tokens or transcript_value else "none"
        return transcript_value, normalized_tokens, confidence_value, latency_meta, token_source, None

    def _extract_transcript_payload(
        self,
        payload: dict[str, object],
    ) -> tuple[str | None, list[str], float | None]:
        transcript = payload.get("transcript")
        transcript_value = transcript.strip() if isinstance(transcript, str) else None
        confidence = payload.get("confidence")
        confidence_value = float(confidence) if isinstance(confidence, (int, float)) else None
        return transcript_value, _coerce_tokens(payload.get("tokens")), confidence_value

    def _extract_latency_meta(self, payload: dict[str, object]) -> dict[str, float]:
        metrics: dict[str, float] = {}
        for key, value in payload.items():
            if not key.endswith("_ms"):
                continue
            if isinstance(value, (int, float)):
                metrics[key] = float(value)
        return metrics

    def _normalize_tokens(
        self,
        tokens: list[str],
        transcript: str | None,
    ) -> list[str]:
        normalized_tokens = list(tokens)
        if not normalized_tokens and transcript:
            normalized_tokens = tokenize_arabic_text(transcript)
        elif normalized_tokens:
            normalized_tokens = tokenize_arabic_text(" ".join(normalized_tokens))
        return normalized_tokens

    def _iter_pcm_frames(self, pcm_bytes: bytes) -> list[bytes]:
        if not pcm_bytes:
            return []
        frame_size = max(2, int(self._sample_rate_hz * (self._frame_ms / 1000.0)) * 2)
        return [
            pcm_bytes[index : index + frame_size]
            for index in range(0, len(pcm_bytes), frame_size)
            if pcm_bytes[index : index + frame_size]
        ]

    async def _transcribe_ws_streaming(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        duration_ms: int,
    ) -> tuple[str | None, list[str], float | None, dict[str, float], str, float | None]:
        if not audio_bytes:
            return None, [], None, {}, "none", None

        try:
            import websockets  # type: ignore
        except Exception as error:
            logger.warning("websockets dependency missing for remote_ws: %s", error)
            return None, [], None, {}, "none", None

        normalized_mime = (mime_type or "").strip().lower()
        if "pcm" in normalized_mime or "s16le" in normalized_mime:
            pcm_bytes = audio_bytes
        else:
            pcm_bytes = _decode_audio_bytes_to_pcm16(
                audio_bytes,
                sample_rate_hz=self._sample_rate_hz,
            )
        frames = self._iter_pcm_frames(pcm_bytes)
        if not frames:
            return None, [], None, {}, "none", None

        extra_headers: list[tuple[str, str]] = [
            ("Accept", "application/json"),
            ("X-Tasmee-Protocol", str(self._protocol_version)),
            ("X-Tasmee-Language-Codes", ",".join(self._language_codes)),
            ("X-Tasmee-Duration-Ms", str(int(duration_ms))),
        ]
        if self._bearer_token:
            extra_headers.append(("Authorization", f"Bearer {self._bearer_token}"))
        if self._model:
            extra_headers.append(("X-Tasmee-Model", self._model))

        request = {
            "type": "start",
            "protocol_version": self._protocol_version,
            "mime_type": f"audio/pcm;encoding=s16le;rate={self._sample_rate_hz}",
            "sample_rate_hz": self._sample_rate_hz,
            "frame_ms": self._frame_ms,
            "duration_ms": int(duration_ms),
            "language_codes": list(self._language_codes),
            "model": self._model,
        }

        transcript_final: str | None = None
        tokens_final: list[str] = []
        confidence_final: float | None = None
        transcript_partial: str | None = None
        tokens_partial: list[str] = []
        confidence_partial: float | None = None
        stable_partial_tokens: list[str] = []
        partial_updates = 0
        latency_meta: dict[str, float] = {}
        stream_started = time.perf_counter()

        try:
            connect = websockets.connect  # type: ignore[attr-defined]
            try:
                websocket_ctx = connect(
                    self._ws_url,
                    extra_headers=extra_headers,
                    open_timeout=self._timeout,
                    ping_interval=None,
                    ping_timeout=None,
                )
            except TypeError:
                websocket_ctx = connect(
                    self._ws_url,
                    additional_headers=extra_headers,
                    open_timeout=self._timeout,
                    ping_interval=None,
                    ping_timeout=None,
                )

            async with websocket_ctx as websocket:
                final_event = asyncio.Event()
                receiver_error: str | None = None

                async def _receiver() -> None:
                    nonlocal transcript_final, tokens_final, confidence_final
                    nonlocal transcript_partial, tokens_partial, confidence_partial
                    nonlocal stable_partial_tokens, partial_updates
                    nonlocal receiver_error
                    while True:
                        raw = await websocket.recv()
                        if not isinstance(raw, str):
                            continue
                        try:
                            payload = json.loads(raw)
                        except Exception:
                            continue
                        if not isinstance(payload, dict):
                            continue

                        event_type = str(payload.get("type") or "").strip().lower()
                        if event_type in {"partial", "final"}:
                            transcript_value, tokens_value, confidence_value = self._extract_transcript_payload(
                                payload
                            )
                            normalized_tokens = self._normalize_tokens(tokens_value, transcript_value)
                            if event_type == "partial":
                                transcript_partial = transcript_value
                                tokens_partial = normalized_tokens
                                confidence_partial = confidence_value
                                partial_updates += 1
                                if partial_updates == 1:
                                    stable_partial_tokens = list(normalized_tokens)
                                else:
                                    stable_partial_tokens = _longest_common_prefix_tokens(
                                        stable_partial_tokens,
                                        normalized_tokens,
                                    )
                            else:
                                transcript_final = transcript_value
                                tokens_final = normalized_tokens
                                confidence_final = confidence_value
                                final_event.set()
                                return
                        elif event_type == "latency_meta":
                            latency_meta.update(self._extract_latency_meta(payload))
                        elif event_type == "error":
                            receiver_error = str(payload.get("error") or "remote stt error")
                            final_event.set()
                            return

                receiver_task = asyncio.create_task(_receiver())
                final_timed_out = False
                try:
                    await websocket.send(json.dumps(request, ensure_ascii=False))
                    for frame in frames:
                        await websocket.send(frame)
                        if self._stream_realtime:
                            await asyncio.sleep(self._frame_ms / 1000.0)
                    await websocket.send(json.dumps({"type": "audio_end"}, ensure_ascii=False))

                    try:
                        await asyncio.wait_for(
                            final_event.wait(),
                            timeout=self._final_wait_seconds,
                        )
                    except asyncio.TimeoutError:
                        final_timed_out = True
                        has_partial = bool(tokens_partial or (transcript_partial or "").strip())
                        if not self._return_partial_on_timeout or not has_partial:
                            raise
                finally:
                    receiver_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await receiver_task

                if receiver_error:
                    raise RuntimeError(receiver_error)
                if final_timed_out:
                    latency_meta["final_timeout_ms"] = round(self._final_wait_seconds * 1000.0, 2)
        except Exception as error:
            logger.warning("remote_ws streaming request failed: %s", error)
            raise

        elapsed_ms = (time.perf_counter() - stream_started) * 1000.0
        latency_meta.setdefault("client_stream_elapsed_ms", round(elapsed_ms, 2))

        if transcript_final or tokens_final:
            return transcript_final, tokens_final, confidence_final, latency_meta, "final", None

        if stable_partial_tokens:
            partial_stability = (
                len(stable_partial_tokens) / max(1, len(tokens_partial))
                if tokens_partial
                else 0.0
            )
            return (
                transcript_partial,
                stable_partial_tokens,
                confidence_partial,
                latency_meta,
                "partial",
                round(partial_stability, 4),
            )

        if transcript_partial or tokens_partial:
            partial_stability = 1.0 if partial_updates <= 1 else 0.0
            return (
                transcript_partial,
                tokens_partial,
                confidence_partial,
                latency_meta,
                "partial",
                partial_stability,
            )
        return None, [], None, latency_meta, "none", None


class OpenAISttTasmeeRecognizer(BaseTasmeeRecognizer):
    """
    OpenAI speech-to-text recognizer for tasmee alignment mode.

    Uses the OpenAI `/v1/audio/transcriptions` endpoint and returns a normalized
    token list. Alignment is handled in tasmee_main against the current page
    lexicon.
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        language: str | None = None,
        prompt: str | None = None,
        timeout_seconds: float | None = None,
        speech_level_db_threshold: float = -48.0,
        client: httpx.Client | None = None,
    ):
        self._speech_level_db_threshold = speech_level_db_threshold
        self._api_key = (
            (api_key or os.getenv("TASMEE_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY") or "")
            .strip()
        )
        if not self._api_key:
            raise RuntimeError("OPENAI_API_KEY is not set; openai recognizer disabled")

        self._base_url = (
            (base_url or os.getenv("TASMEE_OPENAI_BASE_URL") or "https://api.openai.com/v1")
            .strip()
            .rstrip("/")
        )
        self._model = (model or os.getenv("TASMEE_OPENAI_MODEL") or "whisper-1").strip() or "whisper-1"
        self._language = (language or os.getenv("TASMEE_OPENAI_LANGUAGE") or "").strip() or None
        self._prompt = (prompt or os.getenv("TASMEE_OPENAI_PROMPT") or "").strip() or None

        resolved_timeout = timeout_seconds
        if resolved_timeout is None:
            timeout_raw = (os.getenv("TASMEE_OPENAI_TIMEOUT_SECONDS") or "").strip()
            if timeout_raw:
                try:
                    resolved_timeout = float(timeout_raw)
                except ValueError:
                    logger.warning(
                        "invalid TASMEE_OPENAI_TIMEOUT_SECONDS=%s, using default=15.0",
                        timeout_raw,
                    )
                    resolved_timeout = 15.0
            else:
                resolved_timeout = 15.0

        self._timeout = max(0.1, float(resolved_timeout))
        self._client = client or httpx.Client(timeout=httpx.Timeout(self._timeout))

    def analyze_chunk(self, payload: ChunkRecognitionInput) -> ChunkRecognitionResult:
        level_db = self._resolve_level_db(payload)
        has_speech = (
            payload.has_speech
            if payload.has_speech is not None
            else level_db >= self._speech_level_db_threshold
        )

        if not has_speech:
            return ChunkRecognitionResult(
                has_speech=False,
                confidence=0.0,
                level_db=level_db,
                confirmed_word_indexes=[],
                transcript=None,
                recognized_tokens=[],
            )

        transcript = self._transcribe(
            audio_bytes=payload.audio_bytes,
            mime_type=payload.mime_type,
            duration_ms=payload.duration_ms,
        )
        tokens = tokenize_arabic_text(transcript or "")
        confidence = HeuristicTasmeeRecognizer._estimate_confidence(level_db, has_speech)

        return ChunkRecognitionResult(
            has_speech=True,
            confidence=confidence,
            level_db=level_db,
            confirmed_word_indexes=[],
            transcript=transcript,
            recognized_tokens=tokens,
        )

    def _resolve_level_db(self, payload: ChunkRecognitionInput) -> float:
        if payload.level_db is not None:
            return float(payload.level_db)
        if payload.has_speech is True:
            return -35.0
        return -120.0

    @staticmethod
    def _filename_for_mime(mime_type: str | None) -> str:
        normalized = (mime_type or "").strip().lower()
        if normalized.endswith("webm") or "webm" in normalized:
            return "audio.webm"
        if normalized.endswith("wav") or "wav" in normalized:
            return "audio.wav"
        if normalized.endswith("mpeg") or "mpeg" in normalized or "mp3" in normalized:
            return "audio.mp3"
        return "audio.mp4"

    def _transcribe(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        duration_ms: int,
    ) -> str | None:
        if not audio_bytes:
            return None

        url = f"{self._base_url}/audio/transcriptions"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
        }
        data: dict[str, str] = {
            "model": self._model,
            "response_format": "json",
        }
        if self._language:
            data["language"] = self._language
        if self._prompt:
            data["prompt"] = self._prompt

        files = {
            "file": (
                self._filename_for_mime(mime_type),
                audio_bytes,
                mime_type or "application/octet-stream",
            ),
        }

        try:
            response = self._client.post(url, headers=headers, data=data, files=files)
        except Exception as error:
            logger.warning("openai stt request failed: %s", error)
            return None

        if response.status_code != 200:
            logger.warning(
                "openai stt non-200 response: status=%s body=%s",
                response.status_code,
                (response.text or "")[:400],
            )
            return None

        try:
            payload = response.json()
        except Exception as error:
            logger.warning("openai stt invalid json response: %s", error)
            return None

        transcript = payload.get("text") or payload.get("transcript")
        transcript_value = transcript.strip() if isinstance(transcript, str) else None
        return transcript_value or None


class TasmeeRecognizerAdapter(HeuristicTasmeeRecognizer):
    pass


def create_tasmee_recognizer(mode: str | None = None) -> BaseTasmeeRecognizer:
    normalized = (mode or os.getenv("TASMEE_RECOGNIZER_MODE", "heuristic")).strip().lower()
    if normalized == "google":
        return GoogleSttTasmeeRecognizer()
    if normalized == "remote":
        return RemoteHttpTasmeeRecognizer()
    if normalized == "remote_ws":
        return RemoteWsTasmeeRecognizer()
    if normalized == "openai":
        return OpenAISttTasmeeRecognizer()
    return TasmeeRecognizerAdapter()
