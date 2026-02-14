from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field

import httpx

from .tasmee_text import tokenize_arabic_text

logger = logging.getLogger(__name__)


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


class BaseTasmeeRecognizer:
    def analyze_chunk(self, payload: ChunkRecognitionInput) -> ChunkRecognitionResult:
        raise NotImplementedError


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

    This is a "prepare for streaming" implementation: it uses a WebSocket
    transport but does not keep per-session connections yet. The backend runs
    analyze_chunk in a worker thread, so it's safe for this implementation to
    block while awaiting the WS response.

    Protocol (v1):
      - Client sends a JSON text frame with metadata.
      - Client sends a binary frame containing raw audio bytes.
      - Server replies with a JSON text frame containing `tokens` or `transcript`
        and optional `confidence`.
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
                    resolved_protocol = 1
            else:
                resolved_protocol = 1
        self._protocol_version = max(1, int(resolved_protocol))

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

        transcript, tokens, transcript_confidence = asyncio.run(
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

    async def _transcribe_ws(
        self,
        *,
        audio_bytes: bytes,
        mime_type: str,
        duration_ms: int,
    ) -> tuple[str | None, list[str], float | None]:
        if not audio_bytes:
            return None, [], None

        try:
            import websockets  # type: ignore
        except Exception as error:
            logger.warning("websockets dependency missing for remote_ws: %s", error)
            return None, [], None

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
                )
            except TypeError:
                websocket_ctx = connect(
                    self._ws_url,
                    additional_headers=extra_headers,
                    open_timeout=self._timeout,
                )

            async with websocket_ctx as websocket:
                await websocket.send(json.dumps(request, ensure_ascii=False))
                await websocket.send(audio_bytes)
                response_text = await asyncio.wait_for(websocket.recv(), timeout=self._timeout)
        except Exception as error:
            logger.warning("remote_ws stt request failed: %s", error)
            return None, [], None

        if not isinstance(response_text, str):
            logger.warning("remote_ws stt invalid response type: %s", type(response_text))
            return None, [], None

        try:
            payload = json.loads(response_text)
        except Exception as error:
            logger.warning("remote_ws stt invalid json response: %s", error)
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
