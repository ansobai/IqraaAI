# Tasmee Phase 0 Baseline

This folder defines the SLO baseline benchmark for Tasmee STT latency.

## Metrics

The benchmark records these core metrics:

- `client_to_partial_ms`: wall-clock time from first chunk sent to first `feedback.delta`.
- `client_to_final_ms`: wall-clock time from first chunk sent to last `feedback.delta` after upload finishes.
- `failure_rate`: failed samples / total samples.
- `cost_per_audio_min_usd`: estimated run cost divided by processed audio minutes.

It reports p50/p95 for both latency metrics.

## Corpus

`tasmee_corpus.baseline.json` includes labeled cohorts for:

- quiet and noisy conditions
- device mic profiles (`device_mic`, `external_mic`)
- recitation styles (`murattal_hafs`, `murattal_hafs_slow`, `mujawwad`)

Each sample can set:

- `path`, `page_number`, `surah_id`
- `condition`, `device_profile`, `recitation_style`
- optional overrides: `chunk_ms`, `level_db`, `has_speech`, `inter_chunk_delay_ms`, `final_wait_ms`, `duration_ms`

## Run

From repo root:

```bash
python api/scripts/run_tasmee_benchmark.py \
  --tasmee-base-url http://127.0.0.1:8080 \
  --corpus api/benchmarks/tasmee_corpus.baseline.json \
  --stt-hourly-usd 1.20 \
  --tasmee-hourly-usd 0.35
```

Artifacts are written to `api/benchmarks/reports/`:

- `tasmee_baseline_<timestamp>.json`
- `tasmee_baseline_<timestamp>.md`
- `tasmee_baseline_latest.json`
- `tasmee_baseline_latest.md`

## Phase 7 Guardrails

Evaluate rollout guardrails against a benchmark report:

```bash
python api/scripts/evaluate_tasmee_guardrails.py \
  --report api/benchmarks/reports/tasmee_baseline_latest.json \
  --baseline api/benchmarks/reports/tasmee_baseline_YYYYMMDDTHHMMSSZ.json \
  --max-p95-first-partial-ms 1000 \
  --max-failure-rate 0.03 \
  --max-cost-per-audio-min-usd 0.20
```

The script exits non-zero when any guardrail fails (used by canary rollback automation).
