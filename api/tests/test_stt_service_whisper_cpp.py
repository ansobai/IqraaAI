from fastapi.testclient import TestClient

from api.stt_service_whisper_cpp import app as whisper_cpp_app


class _FakeTranscriber:
    def __init__(self, *, result: dict | None = None, error: Exception | None = None):
        self._result = result or {}
        self._error = error

    def transcribe_file(self, file_path: str) -> dict:
        assert file_path
        if self._error is not None:
            raise self._error
        return self._result


def test_healthz_success():
    with TestClient(whisper_cpp_app.app) as client:
        response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_score_rejects_empty_body(monkeypatch):
    monkeypatch.setattr(
        whisper_cpp_app,
        "_get_transcriber",
        lambda: _FakeTranscriber(result={"transcript": "ignored", "confidence": 1.0}),
    )
    with TestClient(whisper_cpp_app.app) as client:
        response = client.post("/score", content=b"", headers={"content-type": "audio/mp4"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Missing request body audio bytes"


def test_score_requires_auth_when_token_is_set(monkeypatch):
    monkeypatch.setenv("STT_AUTH_TOKEN", "secret")
    monkeypatch.setattr(
        whisper_cpp_app,
        "_get_transcriber",
        lambda: _FakeTranscriber(result={"transcript": "ok", "confidence": 0.0}),
    )

    with TestClient(whisper_cpp_app.app) as client:
        missing = client.post("/score", content=b"\x01", headers={"content-type": "audio/mp4"})
        invalid = client.post(
            "/score",
            content=b"\x01",
            headers={"content-type": "audio/mp4", "authorization": "Bearer wrong"},
        )
        valid = client.post(
            "/score",
            content=b"\x01",
            headers={"content-type": "audio/mp4", "authorization": "Bearer secret"},
        )

    assert missing.status_code == 401
    assert invalid.status_code == 401
    assert valid.status_code == 200
    assert valid.json() == {"transcript": "ok", "confidence": 0.0}


def test_score_happy_path_includes_optional_tokens(monkeypatch):
    monkeypatch.setattr(
        whisper_cpp_app,
        "_get_transcriber",
        lambda: _FakeTranscriber(
            result={
                "transcript": "ٱلْحَمْدُ لِلَّهِ",
                "confidence": 0.73,
                "tokens": ["ٱلْحَمْدُ", "لِلَّهِ"],
            }
        ),
    )

    with TestClient(whisper_cpp_app.app) as client:
        response = client.post(
            "/score", content=b"\x10\x20", headers={"content-type": "audio/mp4"}
        )

    assert response.status_code == 200
    assert response.json() == {
        "transcript": "ٱلْحَمْدُ لِلَّهِ",
        "confidence": 0.73,
        "tokens": ["ٱلْحَمْدُ", "لِلَّهِ"],
    }


def test_score_backend_failure_returns_500(monkeypatch):
    monkeypatch.setattr(
        whisper_cpp_app,
        "_get_transcriber",
        lambda: _FakeTranscriber(error=RuntimeError("backend unavailable")),
    )

    with TestClient(whisper_cpp_app.app) as client:
        response = client.post("/score", content=b"\x01", headers={"content-type": "audio/mp4"})

    assert response.status_code == 500
    assert response.json()["detail"] == "STT failed: backend unavailable"
