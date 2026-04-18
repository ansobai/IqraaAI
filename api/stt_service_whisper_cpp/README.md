# Whisper.cpp STT Service

This service is additive and keeps the Tasmee remote recognizer contract unchanged:

- `GET /healthz` -> `{"ok": true}`
- `POST /score` accepts raw audio bytes and returns JSON:
  - `{"transcript": "...", "confidence": 0.0}`
  - optionally `tokens` when enabled and available
- Optional bearer token auth via `STT_AUTH_TOKEN`

## Env Vars

- `STT_WCPP_MODEL_PATH` (required): path to pre-converted whisper.cpp model file.
- `STT_WCPP_BIN` (optional, default `whisper-cli`): whisper.cpp executable path/name.
- `STT_WCPP_LANGUAGE` (optional, default `ar`): language code for transcription.
- `STT_WCPP_TASK` (optional, default `transcribe`): `transcribe` or `translate`.
- `STT_WCPP_THREADS` (optional): thread count.
- `STT_WCPP_TIMEOUT_SECONDS` (optional, default `120`): subprocess timeout in seconds.
- `STT_WCPP_RETURN_TOKENS` (optional bool, default `false`): include tokens when available.
- `STT_WCPP_EXTRA_ARGS` (optional): extra `whisper-cli` args string.
- `STT_AUTH_TOKEN` (optional): shared bearer token expected by `/score`.

## Local Run (No Docker)

From repository root:

```bash
python -m pip install -r api/stt_service_whisper_cpp/requirements.txt
export STT_WCPP_MODEL_PATH=/absolute/path/to/ggml-model.bin
uvicorn api.stt_service_whisper_cpp.app:app --host 0.0.0.0 --port 8010
```

## Docker Run (CPU)

Build:

```bash
docker build -f api/stt_service_whisper_cpp/Dockerfile -t iqraa-stt-whisper-cpp .
```

Run:

```bash
docker run --rm \
  -p 8010:8010 \
  -e PORT=8010 \
  -e STT_WCPP_MODEL_PATH=/models/ggml-model.bin \
  -e STT_WCPP_LANGUAGE=ar \
  -e STT_WCPP_TASK=transcribe \
  -e STT_AUTH_TOKEN=your-token-if-needed \
  -v /absolute/path/to/models:/models:ro \
  iqraa-stt-whisper-cpp
```

## Manual Model Conversion (Required)

`tarteel-ai/whisper-base-ar-quran` is a Hugging Face Whisper checkpoint; it must be converted to a whisper.cpp-compatible `ggml` file first.

The Dockerfile currently pins `whisper.cpp` to `v1.7.6`, where the conversion flow is:

1. Clone repos and create a working directory:

```bash
git clone --depth 1 --branch v1.7.6 https://github.com/ggerganov/whisper.cpp.git
git clone --depth 1 https://github.com/openai/whisper.git
mkdir -p ./model-convert/hf-whisper-base-ar-quran ./model-convert/out
```

2. Download the Hugging Face model files locally:

```bash
hf download tarteel-ai/whisper-base-ar-quran --local-dir ./model-convert/hf-whisper-base-ar-quran
```

3. Install conversion dependencies:

```bash
python -m pip install --upgrade torch transformers numpy
```

4. Convert HF model to whisper.cpp `ggml`:

```bash
python ./whisper.cpp/models/convert-h5-to-ggml.py \
  ./model-convert/hf-whisper-base-ar-quran \
  ./whisper \
  ./model-convert/out
```

5. Use the output file path (usually `./model-convert/out/ggml-model.bin`) as `STT_WCPP_MODEL_PATH`.

Notes:

- Conversion is manual and external to service startup. This repository does not auto-convert HF checkpoints.
- If you change `whisper.cpp` version, re-validate conversion scripts and output format for compatibility.

## Tasmee Integration (Unchanged Contract)

Point Tasmee to this service:

```env
TASMEE_RECOGNIZER_MODE=remote
TASMEE_REMOTE_STT_URL=http://<host>:8010/score
```

Bearer token mapping:

- If this service uses `STT_AUTH_TOKEN=<shared-secret>`, set:
  - `TASMEE_REMOTE_STT_BEARER_TOKEN=<shared-secret>`
- If using Azure ML endpoint auth key instead, keep `STT_AUTH_TOKEN` unset and set:
  - `TASMEE_REMOTE_STT_BEARER_TOKEN=<azureml-endpoint-key>`
