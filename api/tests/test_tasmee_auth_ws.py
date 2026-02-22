import base64

from fastapi.testclient import TestClient

import api.app.tasmee_main as tasmee_main
from api.app.tasmee_main import create_app


def _chunk_payload(seq: int = 1) -> dict:
    audio = bytes([17] * 512)
    return {
        "seq": seq,
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "mime_type": "audio/mp4",
        "duration_ms": 300,
        "has_speech": True,
        "level_db": -30.0,
    }


def test_auth_required_rejects_missing_bearer(monkeypatch):
    monkeypatch.setenv("TASMEE_REQUIRE_AUTH", "true")
    monkeypatch.setenv("CLERK_ISSUER", "https://example.test")
    monkeypatch.setattr(tasmee_main, "_verify_clerk_token", lambda token, settings: "user_1")

    app = create_app()
    with TestClient(app) as client:
        response = client.post("/v1/tasmee/sessions", json={"page_number": 1, "surah_id": 1})
    assert response.status_code == 401


def test_auth_required_returns_ws_token_and_accepts_ws_connect(monkeypatch):
    monkeypatch.setenv("TASMEE_REQUIRE_AUTH", "true")
    monkeypatch.setenv("CLERK_ISSUER", "https://example.test")
    monkeypatch.setattr(tasmee_main, "_verify_clerk_token", lambda token, settings: "user_1")

    app = create_app()
    with TestClient(app) as client:
        created = client.post(
            "/v1/tasmee/sessions",
            json={"page_number": 1, "surah_id": 1},
            headers={"Authorization": "Bearer token-a"},
        )
        assert created.status_code == 200
        created_body = created.json()
        assert created_body.get("ws_token")

        session_id = created_body["session_id"]
        with client.websocket_connect(
            f"/v1/tasmee/ws?session_id={session_id}&token={created_body['ws_token']}"
        ) as websocket:
            initial = websocket.receive_json()
            assert initial["type"] == "session.status"


def test_ws_connect_without_token_fails_when_auth_required(monkeypatch):
    monkeypatch.setenv("TASMEE_REQUIRE_AUTH", "true")
    monkeypatch.setenv("CLERK_ISSUER", "https://example.test")
    monkeypatch.setattr(tasmee_main, "_verify_clerk_token", lambda token, settings: "user_1")

    app = create_app()
    with TestClient(app) as client:
        created = client.post(
            "/v1/tasmee/sessions",
            json={"page_number": 1, "surah_id": 1},
            headers={"Authorization": "Bearer token-a"},
        )
        session_id = created.json()["session_id"]
        try:
            with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
                websocket.receive_json()
            assert False, "websocket connect should fail without ws token"
        except Exception:
            pass


def test_chunks_forbidden_for_wrong_user(monkeypatch):
    monkeypatch.setenv("TASMEE_REQUIRE_AUTH", "true")
    monkeypatch.setenv("CLERK_ISSUER", "https://example.test")

    def _fake_verify(token: str, settings):
        if token == "token-owner":
            return "owner"
        return "attacker"

    monkeypatch.setattr(tasmee_main, "_verify_clerk_token", _fake_verify)
    app = create_app()
    with TestClient(app) as client:
        created = client.post(
            "/v1/tasmee/sessions",
            json={"page_number": 1, "surah_id": 1},
            headers={"Authorization": "Bearer token-owner"},
        )
        session_id = created.json()["session_id"]

        upload = client.post(
            f"/v1/tasmee/sessions/{session_id}/chunks",
            json=_chunk_payload(),
            headers={"Authorization": "Bearer token-attacker"},
        )
        assert upload.status_code == 403
