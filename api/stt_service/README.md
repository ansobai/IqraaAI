# Quran STT Service (Azure ML custom container)

This folder contains a simple HTTP speech-to-text service intended to be deployed as an **Azure ML managed online endpoint** using a **custom container**.

It exposes:

- `GET /healthz` → `{"ok": true}`
- `POST /score` → accepts **raw audio bytes** (`Content-Type: audio/mp4` etc) and returns JSON:
  - `{"transcript": "...", "confidence": 0.0}`
  - If `STT_AUTH_TOKEN` is set, requires `Authorization: Bearer <token>`.

The Tasmee backend can consume it via `TASMEE_RECOGNIZER_MODE=remote` and `TASMEE_REMOTE_STT_URL=<endpoint-url>`.

## Local run

```bash
python -m pip install -r api/stt_service/requirements.txt
python -m uvicorn api.stt_service.app:app --reload --port 8010
```

## Docker build/run (CPU)

```bash
docker build -f api/stt_service/Dockerfile -t iqraaai-quran-stt:local .
docker run --rm -p 8010:8010 -e PORT=8010 iqraaai-quran-stt:local
```

## Docker build/run (GPU)

```bash
docker build -f api/stt_service/Dockerfile.gpu -t iqraaai-quran-stt:gpu .
docker run --rm --gpus all -p 8010:8010 -e PORT=8010 iqraaai-quran-stt:gpu
```
