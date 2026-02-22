import httpx

from api.app.tasmee_engine import ChunkRecognitionInput, RemoteHttpTasmeeRecognizer
from api.app.tasmee_text import tokenize_arabic_text


def test_remote_recognizer_posts_audio_bytes_and_parses_tokens():
    url = "https://stt.example.test/v1/recognize"
    audio_bytes = b"\x01\x02\x03\x04"
    mime_type = "audio/mp4"
    duration_ms = 321

    expected_tokens = tokenize_arabic_text("ٱلْحَمْدُ لِلَّهِ")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert str(request.url) == url
        assert request.headers.get("accept") == "application/json"
        assert request.headers.get("content-type") == mime_type
        assert request.headers.get("authorization") == "Bearer secret"
        assert request.headers.get("x-tasmee-language-codes") == "ar,en"
        assert request.headers.get("x-tasmee-model") == "my-model"
        assert request.headers.get("x-tasmee-duration-ms") == str(duration_ms)
        assert request.content == audio_bytes

        return httpx.Response(
            200,
            json={
                "tokens": ["ٱلْحَمْدُ", "لِلَّهِ"],
                "confidence": 0.42,
                "transcript": "ignored by tokens path",
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    recognizer = RemoteHttpTasmeeRecognizer(
        url=url,
        bearer_token="secret",
        language_codes=["ar", "en"],
        model="my-model",
        timeout_seconds=1.0,
        client=client,
    )

    result = recognizer.analyze_chunk(
        ChunkRecognitionInput(
            audio_bytes=audio_bytes,
            mime_type=mime_type,
            level_db=-34.0,
            has_speech=True,
            duration_ms=duration_ms,
            next_word_index=0,
            anchor_set=False,
        )
    )

    assert result.has_speech is True
    assert result.confidence == 0.42
    assert result.recognized_tokens == expected_tokens


def test_remote_recognizer_tokenizes_transcript_when_tokens_missing():
    url = "https://stt.example.test/v1/recognize"
    audio_bytes = b"\x99" * 32

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        return httpx.Response(
            200,
            json={
                "transcript": "ٱلْحَمْدُ لِلَّهِ",
            },
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    recognizer = RemoteHttpTasmeeRecognizer(
        url=url,
        timeout_seconds=1.0,
        client=client,
    )

    result = recognizer.analyze_chunk(
        ChunkRecognitionInput(
            audio_bytes=audio_bytes,
            mime_type="audio/mp4",
            level_db=-34.0,
            has_speech=True,
            duration_ms=250,
            next_word_index=0,
            anchor_set=False,
        )
    )

    assert result.recognized_tokens == tokenize_arabic_text("ٱلْحَمْدُ لِلَّهِ")

