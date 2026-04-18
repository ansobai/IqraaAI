from __future__ import annotations

import json
import os
import shlex
import subprocess
import tempfile
from functools import lru_cache
from typing import Any, Protocol

from fastapi import FastAPI, HTTPException, Request


def _filename_suffix_for_mime(mime_type: str | None) -> str:
    normalized = (mime_type or "").strip().lower()
    if "webm" in normalized:
        return ".webm"
    if "wav" in normalized:
        return ".wav"
    if "mpeg" in normalized or "mp3" in normalized:
        return ".mp3"
    if "mp4" in normalized or "m4a" in normalized or "aac" in normalized:
        return ".mp4"
    return ".bin"


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


class Transcriber(Protocol):
    def transcribe_file(self, file_path: str) -> dict[str, Any]:
        ...


def _bool_env(name: str, default: bool = False) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int | None = None) -> int | None:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc


def _float_env(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a number") from exc


def _extra_args_env(name: str) -> list[str]:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return []
    return shlex.split(raw, posix=(os.name != "nt"))


class WhisperCppTranscriber:
    def __init__(self) -> None:
        self.bin_path = (os.getenv("STT_WCPP_BIN") or "whisper-cli").strip() or "whisper-cli"
        self.model_path = (os.getenv("STT_WCPP_MODEL_PATH") or "").strip()
        self.language = (os.getenv("STT_WCPP_LANGUAGE") or "ar").strip() or "ar"
        self.task = (os.getenv("STT_WCPP_TASK") or "transcribe").strip().lower() or "transcribe"
        self.threads = _int_env("STT_WCPP_THREADS")
        self.timeout_seconds = _float_env("STT_WCPP_TIMEOUT_SECONDS", 120.0)
        self.return_tokens = _bool_env("STT_WCPP_RETURN_TOKENS", False)
        self.extra_args = _extra_args_env("STT_WCPP_EXTRA_ARGS")

        if not self.model_path:
            raise RuntimeError("STT_WCPP_MODEL_PATH is required")
        if not os.path.isfile(self.model_path):
            raise RuntimeError(f"STT_WCPP_MODEL_PATH does not exist: {self.model_path}")
        if self.threads is not None and self.threads <= 0:
            raise RuntimeError("STT_WCPP_THREADS must be > 0")
        if self.timeout_seconds <= 0:
            raise RuntimeError("STT_WCPP_TIMEOUT_SECONDS must be > 0")
        if self.task not in {"transcribe", "translate"}:
            raise RuntimeError("STT_WCPP_TASK must be either 'transcribe' or 'translate'")

    def _build_command(self, audio_path: str, output_base: str) -> list[str]:
        cmd: list[str] = [
            self.bin_path,
            "-m",
            self.model_path,
            "-f",
            audio_path,
            "-l",
            self.language,
            "-of",
            output_base,
            "-np",
        ]
        if self.task == "translate":
            cmd.append("-tr")
        if self.threads is not None:
            cmd.extend(["-t", str(self.threads)])
        cmd.append("-ojf" if self.return_tokens else "-oj")
        if self.extra_args:
            cmd.extend(self.extra_args)
        return cmd

    @staticmethod
    def _parse_whisper_json(result_path: str, include_tokens: bool) -> dict[str, Any]:
        if not os.path.isfile(result_path):
            raise RuntimeError(f"whisper.cpp did not produce JSON output: {result_path}")

        try:
            with open(result_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Invalid whisper.cpp JSON output: {exc}") from exc

        transcription = payload.get("transcription")
        transcript_parts: list[str] = []
        tokens: list[str] = []
        token_probs: list[float] = []

        if isinstance(transcription, list):
            for segment in transcription:
                if not isinstance(segment, dict):
                    continue
                text = segment.get("text")
                if isinstance(text, str):
                    transcript_parts.append(text)
                if include_tokens:
                    raw_tokens = segment.get("tokens")
                    if isinstance(raw_tokens, list):
                        for token in raw_tokens:
                            if not isinstance(token, dict):
                                continue
                            token_text = token.get("text")
                            if isinstance(token_text, str):
                                tokens.append(token_text)
                            token_prob = token.get("p")
                            if isinstance(token_prob, (int, float)):
                                token_probs.append(float(token_prob))

        transcript = "".join(transcript_parts).strip()
        confidence = (sum(token_probs) / len(token_probs)) if token_probs else 0.0

        response: dict[str, Any] = {
            "transcript": transcript,
            "confidence": confidence,
        }
        if include_tokens and tokens:
            response["tokens"] = tokens
        return response

    def transcribe_file(self, file_path: str) -> dict[str, Any]:
        with tempfile.TemporaryDirectory(prefix="wcpp-out-") as out_dir:
            output_base = os.path.join(out_dir, "result")
            json_path = f"{output_base}.json"
            cmd = self._build_command(file_path, output_base)

            try:
                completed = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout_seconds,
                    check=False,
                )
            except FileNotFoundError as exc:
                raise RuntimeError(f"whisper.cpp binary not found: {self.bin_path}") from exc
            except subprocess.TimeoutExpired as exc:
                raise RuntimeError(
                    f"whisper.cpp timed out after {self.timeout_seconds:.1f}s"
                ) from exc

            if completed.returncode != 0:
                stderr_tail = (completed.stderr or "").strip()[-800:]
                stdout_tail = (completed.stdout or "").strip()[-400:]
                message_parts = [f"whisper.cpp exited with code {completed.returncode}"]
                if stderr_tail:
                    message_parts.append(f"stderr: {stderr_tail}")
                if stdout_tail:
                    message_parts.append(f"stdout: {stdout_tail}")
                raise RuntimeError(" | ".join(message_parts))

            return self._parse_whisper_json(
                result_path=json_path,
                include_tokens=self.return_tokens,
            )


@lru_cache(maxsize=1)
def _get_transcriber() -> Transcriber:
    return WhisperCppTranscriber()


app = FastAPI(title="IqraaAI Whisper.cpp STT")


@app.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/score")
async def score(request: Request) -> dict[str, Any]:
    _require_auth(request)
    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Missing request body audio bytes")

    mime_type = request.headers.get("content-type") or "application/octet-stream"
    suffix = _filename_suffix_for_mime(mime_type)
    transcriber = _get_transcriber()

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(audio_bytes)
            tmp.flush()
            tmp_path = tmp.name

        result = transcriber.transcribe_file(tmp_path)
        transcript = str((result or {}).get("transcript") or "").strip()
        confidence = float((result or {}).get("confidence") or 0.0)

        response: dict[str, Any] = {
            "transcript": transcript,
            "confidence": confidence,
        }
        if isinstance(result, dict) and "tokens" in result:
            response["tokens"] = result["tokens"]
        return response
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"STT failed: {exc}") from exc
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
