# Azure ML Online Endpoint (Custom Container) — Quran STT

This is a template for deploying `api/stt_service` to **Azure ML managed online endpoints**.

The container serves:

- `POST /score` (raw audio bytes → JSON transcript)

Tasmee consumes it using:

- `TASMEE_RECOGNIZER_MODE=remote`
- `TASMEE_REMOTE_STT_URL=<AML scoring URL>`
- `TASMEE_REMOTE_STT_BEARER_TOKEN=<AML key>`

## Prereqs

- Azure CLI + ML extension:
  - `az extension add -n ml`
- An Azure ML workspace
- An Azure Container Registry (ACR) to push the image

## 1) Build + push the STT image to ACR

```bash
ACR_NAME="<your-acr-name>"
ACR_LOGIN_SERVER="$(az acr show -n "$ACR_NAME" --query loginServer -o tsv)"

az acr build \
  -r "$ACR_NAME" \
  -t iqraaai-quran-stt:latest \
  -f api/stt_service/Dockerfile \
  .
```

## 2) Create the endpoint + deployment

Edit `api/azureml/quran_stt/endpoint.yml` + `api/azureml/quran_stt/deployment.yml` (names, instance type).

```bash
RG="<resource-group>"
WS="<ml-workspace>"

az ml online-endpoint create -g "$RG" -w "$WS" -f api/azureml/quran_stt/endpoint.yml
az ml online-deployment create -g "$RG" -w "$WS" -f api/azureml/quran_stt/deployment.yml --all-traffic
```

## 3) Get endpoint URL + key

```bash
ENDPOINT_NAME="$(yq -r .name api/azureml/quran_stt/endpoint.yml 2>/dev/null || echo iqraaai-quran-stt)"

az ml online-endpoint show -g "$RG" -w "$WS" -n "$ENDPOINT_NAME" --query scoring_uri -o tsv
az ml online-endpoint get-credentials -g "$RG" -w "$WS" -n "$ENDPOINT_NAME"
```

Use:
- scoring URI → `TASMEE_REMOTE_STT_URL`
- primary key → `TASMEE_REMOTE_STT_BEARER_TOKEN`

