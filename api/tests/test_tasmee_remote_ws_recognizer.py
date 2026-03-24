import asyncio
import json
import sys

from api.app.tasmee_engine import ChunkRecognitionInput, RemoteWsTasmeeRecognizer
from api.app.tasmee_text import tokenize_arabic_text


class _FakeWebSocket:
    def __init__(self, *, mode: str):
        self.mode = mode
        self.sent: list[object] = []
        self._recv_queue: asyncio.Queue[str] = asyncio.Queue()
        self._seen_binary = False

    async def send(self, payload):
        self.sent.append(payload)
        if self.mode == "streaming":
            if isinstance(payload, bytes) and not self._seen_binary:
                self._seen_binary = True
                await self._recv_queue.put(
                    json.dumps(
                        {
                            "type": "partial",
                            "transcript": "الحمد",
                            "tokens": ["الحمد"],
                            "confidence": 0.5,
                        },
                        ensure_ascii=False,
                    )
                )
            elif isinstance(payload, str):
                message = json.loads(payload)
                if message.get("type") == "start":
                    await self._recv_queue.put(
                        json.dumps(
                            {"type": "vad_state", "state": "speech"},
                            ensure_ascii=False,
                        )
                    )
                elif message.get("type") == "audio_end":
                    await self._recv_queue.put(
                        json.dumps(
                            {
                                "type": "latency_meta",
                                "first_partial_latency_ms": 220,
                                "final_latency_ms": 410,
                            },
                            ensure_ascii=False,
                        )
                    )
                    await self._recv_queue.put(
                        json.dumps(
                            {
                                "type": "final",
                                "transcript": "الحمد لله",
                                "tokens": ["الحمد", "لله"],
                                "confidence": 0.91,
                            },
                            ensure_ascii=False,
                        )
                    )
        elif self.mode == "partial_timeout":
            if isinstance(payload, bytes) and not self._seen_binary:
                self._seen_binary = True
                await self._recv_queue.put(
                    json.dumps(
                        {
                            "type": "partial",
                            "transcript": "Ø§Ù„Ø­Ù…Ø¯ Ù„Ù„Ù‡",
                            "tokens": ["Ø§Ù„Ø­Ù…Ø¯", "Ù„Ù„Ù‡"],
                            "confidence": 0.72,
                        },
                        ensure_ascii=False,
                    )
                )
            elif isinstance(payload, str):
                message = json.loads(payload)
                if message.get("type") == "start":
                    await self._recv_queue.put(
                        json.dumps(
                            {"type": "vad_state", "state": "speech"},
                            ensure_ascii=False,
                        )
                    )
        else:
            if isinstance(payload, str):
                message = json.loads(payload)
                if message.get("type") == "stt.request":
                    await self._recv_queue.put(
                        json.dumps(
                            {
                                "transcript": "الحمد لله",
                                "tokens": ["الحمد", "لله"],
                                "confidence": 0.88,
                            },
                            ensure_ascii=False,
                        )
                    )

    async def recv(self):
        return await self._recv_queue.get()


class _FakeWsContext:
    def __init__(self, websocket: _FakeWebSocket):
        self.websocket = websocket

    async def __aenter__(self):
        return self.websocket

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeWebsocketsModule:
    def __init__(self, *, fail_first_connect: bool):
        self.fail_first_connect = fail_first_connect
        self.calls = 0
        self.stream_ws: _FakeWebSocket | None = None
        self.legacy_ws: _FakeWebSocket | None = None

    def connect(self, *args, **kwargs):
        self.calls += 1
        if self.fail_first_connect and self.calls == 1:
            raise RuntimeError("streaming unavailable")
        ws_url = str(args[0]) if args else ""
        if self.calls == 1 and not self.fail_first_connect and "timeout" in ws_url:
            self.stream_ws = _FakeWebSocket(mode="partial_timeout")
            return _FakeWsContext(self.stream_ws)
        if self.calls == 1 and not self.fail_first_connect:
            self.stream_ws = _FakeWebSocket(mode="streaming")
            return _FakeWsContext(self.stream_ws)
        self.legacy_ws = _FakeWebSocket(mode="legacy")
        return _FakeWsContext(self.legacy_ws)


def _pcm_payload(duration_ms: int = 120, sample_rate_hz: int = 16000) -> bytes:
    samples = int(sample_rate_hz * (duration_ms / 1000.0))
    # Tiny synthetic mono PCM16 tone.
    return (b"\x10\x00" * max(1, samples))


def test_remote_ws_streaming_protocol_parses_partial_final_and_latency(monkeypatch):
    fake_websockets = _FakeWebsocketsModule(fail_first_connect=False)
    monkeypatch.setitem(sys.modules, "websockets", fake_websockets)

    recognizer = RemoteWsTasmeeRecognizer(
        ws_url="wss://stt.example/ws",
        timeout_seconds=1.0,
        protocol_version=2,
    )
    result = recognizer.analyze_chunk(
        ChunkRecognitionInput(
            audio_bytes=_pcm_payload(duration_ms=120),
            mime_type="audio/pcm;encoding=s16le;rate=16000",
            level_db=-30.0,
            has_speech=True,
            duration_ms=120,
            next_word_index=0,
            anchor_set=False,
        )
    )

    assert result.transcript == "الحمد لله"
    assert result.recognized_tokens == tokenize_arabic_text("الحمد لله")
    assert result.confidence == 0.91
    assert result.stt_latency_meta is not None
    assert result.stt_latency_meta.get("first_partial_latency_ms") == 220.0
    assert result.stt_latency_meta.get("final_latency_ms") == 410.0
    assert result.token_source == "final"
    assert result.partial_stability is None

    assert fake_websockets.stream_ws is not None
    sent = fake_websockets.stream_ws.sent
    assert isinstance(sent[0], str)
    start_payload = json.loads(sent[0])
    assert start_payload["type"] == "start"
    assert start_payload["protocol_version"] == 2
    assert any(isinstance(item, bytes) for item in sent)
    assert any(isinstance(item, str) and json.loads(item).get("type") == "audio_end" for item in sent)


def test_remote_ws_streaming_falls_back_to_legacy_protocol(monkeypatch):
    fake_websockets = _FakeWebsocketsModule(fail_first_connect=True)
    monkeypatch.setitem(sys.modules, "websockets", fake_websockets)

    recognizer = RemoteWsTasmeeRecognizer(
        ws_url="wss://stt.example/ws",
        timeout_seconds=1.0,
        protocol_version=2,
    )
    result = recognizer.analyze_chunk(
        ChunkRecognitionInput(
            audio_bytes=_pcm_payload(duration_ms=60),
            mime_type="audio/pcm;encoding=s16le;rate=16000",
            level_db=-30.0,
            has_speech=True,
            duration_ms=60,
            next_word_index=0,
            anchor_set=False,
        )
    )

    assert fake_websockets.calls >= 2
    assert result.transcript == "الحمد لله"
    assert result.recognized_tokens == tokenize_arabic_text("الحمد لله")
    assert result.confidence == 0.88


def test_remote_ws_streaming_returns_partial_when_final_times_out(monkeypatch):
    fake_websockets = _FakeWebsocketsModule(fail_first_connect=False)
    monkeypatch.setitem(sys.modules, "websockets", fake_websockets)

    recognizer = RemoteWsTasmeeRecognizer(
        ws_url="wss://stt.example/ws-timeout",
        timeout_seconds=0.05,
        protocol_version=2,
    )
    result = recognizer.analyze_chunk(
        ChunkRecognitionInput(
            audio_bytes=_pcm_payload(duration_ms=90),
            mime_type="audio/pcm;encoding=s16le;rate=16000",
            level_db=-30.0,
            has_speech=True,
            duration_ms=90,
            next_word_index=0,
            anchor_set=False,
        )
    )

    assert result.token_source == "partial"
    assert result.transcript == "Ø§Ù„Ø­Ù…Ø¯ Ù„Ù„Ù‡"
    assert result.recognized_tokens == tokenize_arabic_text("Ø§Ù„Ø­Ù…Ø¯ Ù„Ù„Ù‡")
    assert result.confidence == 0.72
    assert result.stt_latency_meta is not None
    assert "final_timeout_ms" in result.stt_latency_meta
