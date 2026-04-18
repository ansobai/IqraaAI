# Azure ML Online Endpoint (Custom Container) — Quran STT (whisper.cpp CPU)

This template deploys `api/stt_service_whisper_cpp` as an Azure ML managed online endpoint.

Service contract is unchanged for Tasmee:

- `POST /score` accepts raw audio bytes.
- Returns JSON with `transcript`, `confidence`, and optional `tokens`.

## Prereqs

- Azure CLI + ML extension (`az extension add -n ml`)
- Azure ML workspace
- Azure Container Registry (ACR)
- A pre-converted whisper.cpp model file available at runtime

## 1) Convert `tarteel-ai/whisper-base-ar-quran` manually

For the pinned `whisper.cpp` version used in this repo (`v1.7.6`), use:

```bash
git clone --depth 1 --branch v1.7.6 https://github.com/ggerganov/whisper.cpp.git
git clone --depth 1 https://github.com/openai/whisper.git
mkdir -p ./model-convert/hf-whisper-base-ar-quran ./model-convert/out

hf download tarteel-ai/whisper-base-ar-quran --local-dir ./model-convert/hf-whisper-base-ar-quran
python -m pip install --upgrade torch transformers numpy

python ./whisper.cpp/models/convert-h5-to-ggml.py \
  ./model-convert/hf-whisper-base-ar-quran \
  ./whisper \
  ./model-convert/out
```

Expected output file: `./model-convert/out/ggml-model.bin`

This conversion is manual by design. Startup does not auto-convert Hugging Face checkpoints.

## 2) Build + push whisper.cpp image to ACR

```bash
ACR_NAME="<your-acr-name>"

az acr build \
  -r "$ACR_NAME" \
  -t iqraaai-quran-stt-whisper-cpp:latest \
  -f api/stt_service_whisper_cpp/Dockerfile \
  .
```

## 3) Create endpoint + deployment

Edit:

- `api/azureml/quran_stt_whisper_cpp/endpoint.yml`
- `api/azureml/quran_stt_whisper_cpp/deployment.yml`

Set:

- image to your ACR image
- `STT_WCPP_MODEL_PATH` to the runtime path where `ggml-model.bin` exists

```bash
RG="<resource-group>"
WS="<ml-workspace>"

az ml online-endpoint create -g "$RG" -w "$WS" -f api/azureml/quran_stt_whisper_cpp/endpoint.yml
az ml online-deployment create -g "$RG" -w "$WS" -f api/azureml/quran_stt_whisper_cpp/deployment.yml --all-traffic
```

## 4) Wire Tasmee backend to this endpoint

```env
TASMEE_RECOGNIZER_MODE=remote
TASMEE_REMOTE_STT_URL=<aml-scoring-url>/score
```

Token mapping options:

- Azure ML endpoint auth key:
  - `TASMEE_REMOTE_STT_BEARER_TOKEN=<aml-endpoint-key>`
  - Keep `STT_AUTH_TOKEN` unset in container.
- Service-level shared token (non-AML direct access pattern):
  - `STT_AUTH_TOKEN=<shared-secret>`
  - `TASMEE_REMOTE_STT_BEARER_TOKEN=<shared-secret>`
