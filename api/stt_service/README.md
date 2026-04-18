# Quran STT Service (Azure ML Custom Container)

This service is the remote STT backend used by Tasmee (`TASMEE_RECOGNIZER_MODE=remote`).

## Endpoints

- `GET /healthz` -> liveness (includes model preload status)
- `GET /readyz` -> readiness (returns 503 if preload is enabled and model is not ready)
- `GET /metrics` -> runtime load snapshot for autoscaling/guardrails
- `POST /score` -> raw audio bytes in, transcript JSON out
- `WS /ws` -> bidirectional streaming mode (v2) + legacy one-shot mode (v1 compatibility)

## Phase 2 Streaming Protocol (v2)

WebSocket event flow:

1. Client sends `start` JSON.
2. Client streams binary PCM16LE audio frames (`20-40ms` each).
3. Client sends `audio_end` JSON.
4. Server emits:
   - `vad_state`
   - `partial`
   - `final`
   - `latency_meta`

`partial` and `final` now include `decoder_pass` so clients can distinguish fast vs final pass outputs.

`start` example:

```json
{
  "type": "start",
  "protocol_version": 2,
  "sample_rate_hz": 16000,
  "frame_ms": 30,
  "language_codes": ["ar"]
}
```

Legacy mode is still supported:

- send `{ "type": "stt.request", ... }`
- send one binary audio frame
- receive one final JSON response

## Phase 3 Runtime

The runtime now uses `faster-whisper` (`CTranslate2`) for low-latency decoding.

Key knobs:

- `STT_MODEL_ID` (must be a CTranslate2/faster-whisper compatible model)
- `STT_USE_CUDA=true|false`
- `STT_COMPUTE_TYPE=float16|int8|int8_float16|...`
- `STT_BEAM_SIZE=1` (low-latency default)
- `STT_VAD_FILTER=true|false`
- `STT_STREAM_PARTIAL_INTERVAL_MS`
- `STT_STREAM_ROLLING_CONTEXT_MS`

## Phase 4 Two-Pass Accuracy

The service supports a fast partial pass plus a Quran-tuned final pass:

- Fast pass (partials): `STT_MODEL_ID` (+ `STT_COMPUTE_TYPE`)
- Final pass (rescoring/correction): `STT_FINAL_MODEL_ID` (+ `STT_FINAL_COMPUTE_TYPE`)

Optional final-pass quality knobs:

- `STT_FINAL_BEAM_SIZE` (default: `max(2, STT_BEAM_SIZE)`)
- `STT_FINAL_BEST_OF` (default: `max(2, STT_BEST_OF)`)
- `STT_FINAL_VAD_FILTER`
- `STT_FINAL_VAD_MIN_SILENCE_MS`
- `STT_FINAL_PROMPT` (Quran-domain prompt/bias text)

If `STT_FINAL_MODEL_ID` is not set, final decoding uses the same model as partial decoding.

## Phase 6 Scale + Reliability

The runtime now exposes load and degradation signals, plus hard fail-safes:

- Active stream backpressure:
  - `STT_STREAM_MAX_ACTIVE_STREAMS`
  - `STT_STREAM_SLOT_WAIT_SECONDS`
- Decode queue control:
  - `STT_STREAM_DECODE_MAX_CONCURRENCY`
  - `STT_STREAM_DECODE_QUEUE_TIMEOUT_SECONDS`
- Hard decode timeouts:
  - `STT_STREAM_PARTIAL_DECODE_TIMEOUT_SECONDS`
  - `STT_STREAM_FINAL_DECODE_TIMEOUT_SECONDS`
- Graceful degradation:
  - `STT_STREAM_SKIP_PARTIAL_UNDER_BACKPRESSURE=true`
  - if final decode stalls, service emits `final` from best partial (`decoder_pass=fallback_partial`)
- Metrics signals:
  - `/healthz` and `/metrics` include `active_streams`, `queued_decodes`, `active_decodes`, rejected/backpressure/timeout counters
  - optional GPU utilization/memory/temperature via `nvidia-smi`:
    - `STT_GPU_METRICS_ENABLED=true`
    - `STT_GPU_METRICS_CACHE_TTL_SECONDS=2`

## Warm Endpoint Controls (Phase 1)

- `STT_PRELOAD_MODEL=true` preloads the ASR model during startup.
- `STT_FAIL_ON_PRELOAD_ERROR=true` fails startup if preload fails.

Use these together with deployment min instances (`instance_count >= 1`) to avoid cold starts in normal traffic.

## Auth

If `STT_AUTH_TOKEN` is set, clients must send `Authorization: Bearer <token>`.

If you prefer a CPU `whisper.cpp` backend instead of transformers, use the parallel service in `api/stt_service_whisper_cpp` (same `/score` contract) and its deployment templates under `api/azureml/quran_stt_whisper_cpp`.

## Local run

```bash
python -m pip install -r api/stt_service/requirements.txt
python -m uvicorn api.stt_service.app:app --reload --port 8010
```

## Docker Build and Run (CPU)

```bash
docker build -f api/stt_service/Dockerfile -t iqraaai-quran-stt:local .
docker run --rm -p 8010:8010 -e PORT=8010 -e STT_PRELOAD_MODEL=true iqraaai-quran-stt:local
```

## Docker Build and Run (GPU)

```bash
docker build -f api/stt_service/Dockerfile.gpu -t iqraaai-quran-stt:gpu .
docker run --rm --gpus all -p 8010:8010 -e PORT=8010 -e STT_PRELOAD_MODEL=true iqraaai-quran-stt:gpu
```
