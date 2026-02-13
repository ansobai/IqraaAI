import base64
import json
from typing import Callable

import pytest
from fastapi.testclient import TestClient

import api.app.tasmee_main as tasmee_main
from api.app.tasmee_main import create_app
from api.app.tasmee_engine import ChunkRecognitionResult, BaseTasmeeRecognizer
from api.app.tasmee_page_lexicon import load_page_lexicon


@pytest.fixture(autouse=True)
def _disable_tasmee_auth(monkeypatch):
    monkeypatch.setenv("TASMEE_REQUIRE_AUTH", "false")


def _chunk_payload(
    seq: int,
    level_db: float | None = -34.0,
    seed: int = 12,
    has_speech: bool | None = None,
):
    audio = bytes([seed] * 512)
    payload = {
        "seq": seq,
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "mime_type": "audio/mp4",
        "duration_ms": 1000,
    }
    if level_db is not None:
        payload["level_db"] = level_db
    if has_speech is not None:
        payload["has_speech"] = has_speech
    return payload


def _receive_json_until(
    websocket,
    predicate: Callable[[dict], bool],
    max_messages: int = 12,
):
    for _ in range(max_messages):
        message = websocket.receive()
        if message.get("type") == "websocket.close":
            return message
        if message.get("type") not in {"websocket.receive", "websocket.send"}:
            continue
        payload_text = message.get("text")
        if payload_text is None:
            payload_bytes = message.get("bytes")
            if payload_bytes is None:
                continue
            payload_text = payload_bytes.decode("utf-8")
        payload = json.loads(payload_text)
        if predicate(payload):
            return payload
    raise AssertionError("Expected websocket event was not received")


def test_healthz():
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_ws_chunk_upload_emits_status_and_delta():
    app = create_app()
    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": 3, "surah_id": 3})
        session_id = created.json()["session_id"]

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            websocket.receive_json()
            websocket.send_json(
                {
                    "type": "chunk.upload",
                    **_chunk_payload(seq=1, level_db=-34.0, has_speech=True),
                }
            )
            _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "session.status"
                and payload.get("seq_ack") == 1,
            )
            delta_event = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "feedback.delta"
                and payload.get("seq_ack") == 1,
            )
            assert delta_event["confirmed_word_indexes"] == [0]


def test_silent_chunk_emits_silent_status_and_no_delta():
    app = create_app()
    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": 1, "surah_id": 1})
        session_id = created.json()["session_id"]

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            initial = websocket.receive_json()
            assert initial["type"] == "session.status"
            assert initial["state"] == "listening"

            uploaded = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=1, level_db=-82.0),
            )
            assert uploaded.status_code == 200
            assert uploaded.json()["accepted"] is False

            event = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "session.status"
                and payload.get("seq_ack") == 1,
            )
            assert event["state"] == "silent"


def test_low_confidence_speech_chunk_does_not_emit_delta():
    app = create_app()
    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": 2, "surah_id": 2})
        session_id = created.json()["session_id"]

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            websocket.receive_json()
            uploaded = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=1, level_db=-46.0, has_speech=True),
            )
            body = uploaded.json()
            assert uploaded.status_code == 200
            assert body["accepted"] is False
            assert body["seq_ack"] == 1

            status_event = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "session.status"
                and payload.get("seq_ack") == 1,
            )
            assert status_event["state"] == "silent"


def test_high_confidence_speech_chunk_emits_delta():
    app = create_app()
    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": 3, "surah_id": 3})
        session_id = created.json()["session_id"]

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            websocket.receive_json()
            uploaded = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=1, level_db=-34.0, has_speech=True),
            )
            body = uploaded.json()
            assert uploaded.status_code == 200
            assert body["accepted"] is True

            _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "session.status"
                and payload.get("state") == "reciting"
                and payload.get("seq_ack") == 1,
            )
            delta_event = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "feedback.delta"
                and payload.get("seq_ack") == 1,
            )
            assert delta_event["confirmed_word_indexes"] == [0]
            assert delta_event["confidence"] >= 0.85


def test_client_has_speech_false_blocks_when_level_is_missing():
    app = create_app()
    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": 5, "surah_id": 5})
        session_id = created.json()["session_id"]

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            websocket.receive_json()
            uploaded = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=1, level_db=None, has_speech=False),
            )
            body = uploaded.json()
            assert uploaded.status_code == 200
            assert body["accepted"] is False
            assert body["seq_ack"] == 1

            status_event = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "session.status"
                and payload.get("seq_ack") == 1,
            )
            assert status_event["state"] == "silent"


def test_client_has_speech_true_with_missing_level_blocks_progress():
    app = create_app()
    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": 6, "surah_id": 6})
        session_id = created.json()["session_id"]

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            websocket.receive_json()
            uploaded = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=1, level_db=None, has_speech=True),
            )
            body = uploaded.json()
            assert uploaded.status_code == 200
            assert body["accepted"] is False
            assert body["seq_ack"] == 1

            status_event = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "session.status"
                and payload.get("seq_ack") == 1,
            )
            assert status_event["state"] == "processing"


def test_out_of_order_sequence_is_rejected_without_progress_regression():
    app = create_app()
    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": 4, "surah_id": 4})
        session_id = created.json()["session_id"]

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            websocket.receive_json()

            first = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=1, level_db=-34.0, has_speech=True),
            )
            assert first.status_code == 200
            assert first.json()["accepted"] is True
            first_delta = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "feedback.delta"
                and payload.get("seq_ack") == 1,
            )
            assert first_delta["confirmed_word_indexes"] == [0]

            out_of_order = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=0, level_db=-34.0, has_speech=True),
            )
            assert out_of_order.status_code == 200
            assert out_of_order.json() == {
                "session_id": session_id,
                "seq_ack": 1,
                "accepted": False,
            }

            third = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=2, level_db=-34.0, has_speech=True),
            )
            assert third.status_code == 200
            assert third.json()["accepted"] is True
            second_delta = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "feedback.delta"
                and payload.get("seq_ack") == 2,
            )
            assert second_delta["confirmed_word_indexes"] == [1]


class _FixedTokenRecognizer(BaseTasmeeRecognizer):
    def __init__(self, tokens: list[str], confidence: float = 1.0):
        self._tokens = tokens
        self._confidence = confidence

    def analyze_chunk(self, payload):  # type: ignore[override]
        return ChunkRecognitionResult(
            has_speech=True,
            confidence=self._confidence,
            level_db=float(payload.level_db) if payload.level_db is not None else -120.0,
            confirmed_word_indexes=[],
            transcript="",
            recognized_tokens=list(self._tokens),
        )


def test_alignment_mode_allows_progress_without_meter_when_stt_outputs_tokens(monkeypatch):
    lexicon = load_page_lexicon(1)
    tokens = [word for word in lexicon.words[:3] if word.strip()]
    assert len(tokens) >= 3

    monkeypatch.setenv("TASMEE_SPEECH_GATE_MODE", "auto")
    app = create_app(
        recognizer_override=_FixedTokenRecognizer(tokens),
        recognizer_mode_override="remote",
    )

    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": 1, "surah_id": 1})
        session_id = created.json()["session_id"]

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            websocket.receive_json()
            uploaded = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=1, level_db=None, has_speech=False),
            )
            body = uploaded.json()
            assert uploaded.status_code == 200
            assert body["accepted"] is True

            delta_event = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "feedback.delta"
                and payload.get("seq_ack") == 1,
            )
            assert (delta_event.get("confirmed_word_indexes") or [])[:3] == [0, 1, 2]


def test_alignment_mode_strict_meter_blocks_without_level_db(monkeypatch):
    lexicon = load_page_lexicon(1)
    tokens = [word for word in lexicon.words[:3] if word.strip()]
    assert len(tokens) >= 3

    monkeypatch.setenv("TASMEE_SPEECH_GATE_MODE", "strict_meter")
    app = create_app(
        recognizer_override=_FixedTokenRecognizer(tokens),
        recognizer_mode_override="remote",
    )

    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": 1, "surah_id": 1})
        session_id = created.json()["session_id"]

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            websocket.receive_json()
            uploaded = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=1, level_db=None, has_speech=False),
            )
            body = uploaded.json()
            assert uploaded.status_code == 200
            assert body["accepted"] is False

            status_event = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "session.status"
                and payload.get("seq_ack") == 1,
            )
            assert status_event["state"] in {"silent", "processing"}


def test_session_auto_pauses_after_silence_and_resume_unpauses():
    previous_pause_after = tasmee_main.PAUSE_AFTER_SILENCE_SECONDS
    tasmee_main.PAUSE_AFTER_SILENCE_SECONDS = 0.0
    try:
        app = create_app()
        with TestClient(app) as client:
            created = client.post("/v1/tasmee/sessions", json={"page_number": 7, "surah_id": 7})
            session_id = created.json()["session_id"]

            with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
                websocket.receive_json()

                first = client.post(
                    f"/v1/tasmee/sessions/{session_id}/chunks",
                    json=_chunk_payload(seq=1, level_db=-34.0, has_speech=True),
                )
                assert first.status_code == 200
                assert first.json()["accepted"] is True
                _receive_json_until(
                    websocket,
                    lambda payload: payload.get("type") == "feedback.delta"
                    and payload.get("seq_ack") == 1,
                )

                second = client.post(
                    f"/v1/tasmee/sessions/{session_id}/chunks",
                    json=_chunk_payload(seq=2, level_db=-90.0, has_speech=False),
                )
                assert second.status_code == 200
                assert second.json()["accepted"] is False

                paused_event = _receive_json_until(
                    websocket,
                    lambda payload: payload.get("type") == "session.status"
                    and payload.get("state") == "paused"
                    and payload.get("seq_ack") == 2,
                )
                assert paused_event["pause_reason"] == "silence_timeout"

                resumed = client.post(f"/v1/tasmee/sessions/{session_id}/resume")
                assert resumed.status_code == 200
                assert resumed.json() == {"session_id": session_id, "status": "resumed"}

                listening_event = _receive_json_until(
                    websocket,
                    lambda payload: payload.get("type") == "session.status"
                    and payload.get("state") == "listening",
                )
                assert listening_event["has_speech"] is False
    finally:
        tasmee_main.PAUSE_AFTER_SILENCE_SECONDS = previous_pause_after


def test_create_session_and_ws_closes_after_stop():
    app = create_app()
    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": 1, "surah_id": 1})
        assert created.status_code == 200

        body = created.json()
        session_id = body["session_id"]
        assert isinstance(session_id, str)
        assert "/v1/tasmee/ws" in body["ws_url"]

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            websocket.receive_json()
            stopped = client.post(f"/v1/tasmee/sessions/{session_id}/stop")
            assert stopped.status_code == 200

            for _ in range(6):
                message = websocket.receive()
                if message["type"] == "websocket.close":
                    assert message.get("code") == 1000
                    break
            else:
                raise AssertionError("Expected websocket to close after stop")
