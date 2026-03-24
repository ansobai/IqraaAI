# Azure ML Online Endpoint (Quran STT, Phase 1)

This template deploys `api/stt_service` as an Azure ML managed online endpoint for Tasmee.

Phase 1 goals implemented here:

- GPU-backed deployment defaults
- warm endpoint behavior (`instance_count >= 1`, model preload)
- same-region guidance for Tasmee and STT
- Phase 6 runtime load controls (backpressure + hard timeout knobs)
- Phase 7 canary rollout guardrails with rollback automation

## Prerequisites

- Azure CLI with ML extension:
  - `az extension add -n ml`
- Azure ML workspace
- ACR image for `api/stt_service`

## Region Alignment (No Cross-Region Hop)

Tasmee service and Azure ML workspace must run in the same Azure region.

1. Pick a region (example: `eastus`).
2. Ensure your ML workspace location matches that region.
3. Deploy Tasmee compute in that same region.
4. Point Tasmee to the STT endpoint URL from that workspace:
  - `TASMEE_REMOTE_STT_URL=<scoring_uri>`

## 1) Build and Push STT Image (GPU Dockerfile)

```bash
ACR_NAME="<your-acr-name>"
az acr build \
  -r "$ACR_NAME" \
  -t iqraaai-quran-stt:latest \
  -f api/stt_service/Dockerfile.gpu \
  .
```

## 2) Create Endpoint and Deployment

Update:

- `api/azureml/quran_stt/endpoint.yml`
- `api/azureml/quran_stt/deployment.yml`
- `api/azureml/quran_stt/deployment.canary.yml` (for staged rollout)

Required:

- `environment.image`: your ACR image
- `STT_MODEL_ID`: a faster-whisper/CTranslate2 compatible model id
- choose a GPU `instance_type` available in your region
- keep `instance_count: 1` or higher

```bash
RG="<resource-group>"
WS="<ml-workspace>"

az ml online-endpoint create -g "$RG" -w "$WS" -f api/azureml/quran_stt/endpoint.yml
az ml online-deployment create -g "$RG" -w "$WS" -f api/azureml/quran_stt/deployment.yml --all-traffic
```

PowerShell helper (validates workspace region before deploy):

```powershell
./api/azureml/quran_stt/deploy_same_region.ps1 `
  -ResourceGroup <resource-group> `
  -Workspace <ml-workspace> `
  -Region <azure-region>
```

## 3) Get URL and Credentials

```bash
ENDPOINT_NAME="iqraaai-quran-stt"
az ml online-endpoint show -g "$RG" -w "$WS" -n "$ENDPOINT_NAME" --query scoring_uri -o tsv
az ml online-endpoint get-credentials -g "$RG" -w "$WS" -n "$ENDPOINT_NAME"
```

Use:

- scoring URI -> `TASMEE_REMOTE_STT_URL`
- primary key -> `TASMEE_REMOTE_STT_BEARER_TOKEN`

## Runtime Warmth Controls

`deployment.yml` already enables:

- `STT_PRELOAD_MODEL=true`
- `STT_FAIL_ON_PRELOAD_ERROR=true`
- readiness probe on `/readyz`

This prevents normal traffic from paying model-load cold start latency.

## Phase 6 Signals and Load-Shedding

`deployment.yml` now sets runtime guardrail env vars:

- stream concurrency caps
- decode queue timeout
- hard partial/final decode timeouts
- partial skipping under load
- optional GPU metrics cache

The STT container exposes these signals in:

- `GET /healthz`
- `GET /metrics`

Use these values for autoscaling signals and alerting (active streams, decode queue depth, timeouts, fallback counts, GPU utilization).

## Phase 7 Canary Rollout (10% -> 50% -> 100%)

1. Create the canary deployment:

```bash
az ml online-deployment create -g "$RG" -w "$WS" -f api/azureml/quran_stt/deployment.canary.yml
```

2. Run staged rollout with automatic rollback on guardrail failure:

```powershell
./api/azureml/quran_stt/canary_rollout.ps1 `
  -ResourceGroup <resource-group> `
  -Workspace <ml-workspace> `
  -EndpointName iqraaai-quran-stt `
  -TasmeeBaseUrl <tasmee-base-url> `
  -StableDeployment blue `
  -CanaryDeployment green `
  -MaxP95FirstPartialMs 1000 `
  -MaxFailureRate 0.03 `
  -MaxCostPerAudioMinUsd 0.20
```

The script:

- shifts traffic `10% -> 50% -> 100%`
- runs benchmark after each stage
- checks guardrails via `api/scripts/evaluate_tasmee_guardrails.py`
- rolls back immediately to stable deployment on any failure
