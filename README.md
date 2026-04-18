# IqraaAI

IqraaAI helps users practice Qur'an recitation with real-time feedback. The mobile app captures recitation audio, the backend scores progress word-by-word, and the client receives guided correction signals during the session.

## Stack

- Frontend: Expo / React Native
- Backend API: FastAPI
- Tasmee service: FastAPI WebSocket + chunk scoring
- STT options:
  - `api/stt_service` (transformers/faster-whisper path)
  - `api/stt_service_whisper_cpp` (CPU whisper.cpp path)
- Database: Postgres

## Quick Start

1. Install app dependencies:

```bash
npm install
```

2. Start Expo:

```bash
npx expo start
```

3. Configure backend env:

```bash
copy api\.env.example api\.env
```

4. Run backend API:

```bash
python -m pip install -r api/requirements.txt
python -m uvicorn api.app.main:app --reload --port 8000
```

5. Run STT service (pick one):

```bash
python -m pip install -r api/stt_service/requirements.txt
python -m uvicorn api.stt_service.app:app --reload --port 8010
```

or

```bash
python -m pip install -r api/stt_service_whisper_cpp/requirements.txt
python -m uvicorn api.stt_service_whisper_cpp.app:app --host 127.0.0.1 --port 8010
```

## Current Whisper.cpp Remote Path

In `api/.env`:

- `TASMEE_RECOGNIZER_MODE=remote`
- `TASMEE_REMOTE_STT_URL=http://127.0.0.1:8010/score`
- `STT_WCPP_MODEL_PATH=<absolute path to converted ggml model>`
- `STT_WCPP_BIN=<absolute path to whisper-cli.exe>`

## Docs

- Tasmee STT (transformers): `api/stt_service/README.md`
- Tasmee STT (whisper.cpp): `api/stt_service_whisper_cpp/README.md`
- Azure ML templates (transformers): `api/azureml/quran_stt/README.md`
- Azure ML templates (whisper.cpp): `api/azureml/quran_stt_whisper_cpp/README.md`
- DB schema: `db/schema.sql`
