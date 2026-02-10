from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

from .tasmee_text import tokenize_arabic_text

logger = logging.getLogger(__name__)


@dataclass
class ChunkRecognitionInput:
    audio_bytes: bytes
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


class TasmeeRecognizerAdapter(HeuristicTasmeeRecognizer):
    pass


def create_tasmee_recognizer(mode: str | None = None) -> BaseTasmeeRecognizer:
    normalized = (mode or os.getenv("TASMEE_RECOGNIZER_MODE", "heuristic")).strip().lower()
    if normalized == "google":
        return GoogleSttTasmeeRecognizer()
    return TasmeeRecognizerAdapter()
