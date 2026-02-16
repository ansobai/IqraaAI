from __future__ import annotations

import os
import tempfile
from functools import lru_cache

import torch
from fastapi import FastAPI, HTTPException, Request
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

DEFAULT_MODEL_ID = "tarteel-ai/whisper-base-ar-quran"


def _bool_env(name: str, default: bool = False) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


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


@lru_cache(maxsize=1)
def _asr_pipeline():
    model_id = (os.getenv("STT_MODEL_ID") or DEFAULT_MODEL_ID).strip() or DEFAULT_MODEL_ID
    language = (os.getenv("STT_LANGUAGE") or "ar").strip() or "ar"
    task = (os.getenv("STT_TASK") or "transcribe").strip() or "transcribe"
    force_cpu = _bool_env("STT_FORCE_CPU", False)

    use_cuda = torch.cuda.is_available() and not force_cpu
    device = "cuda:0" if use_cuda else "cpu"
    dtype = torch.float16 if use_cuda else torch.float32

    processor = AutoProcessor.from_pretrained(model_id)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        model_id,
        torch_dtype=dtype,
        low_cpu_mem_usage=True,
    ).to(device)

    pipe = pipeline(
        task="automatic-speech-recognition",
        model=model,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        device=0 if use_cuda else -1,
    )

    generate_kwargs: dict[str, str] = {
        "task": task,
        "language": language,
    }
    return pipe, generate_kwargs


app = FastAPI(title="IqraaAI Quran STT")


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.post("/score")
async def score(request: Request):
    _require_auth(request)
    audio_bytes = await request.body()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Missing request body audio bytes")

    mime_type = request.headers.get("content-type") or "application/octet-stream"
    suffix = _filename_suffix_for_mime(mime_type)

    pipe, generate_kwargs = _asr_pipeline()

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(audio_bytes)
            tmp.flush()
            tmp_path = tmp.name

        result = pipe(tmp_path, generate_kwargs=generate_kwargs)
        transcript = (result.get("text") if isinstance(result, dict) else "") or ""
        transcript = transcript.strip()

        return {
            "transcript": transcript,
            "confidence": 0.0,
        }
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
