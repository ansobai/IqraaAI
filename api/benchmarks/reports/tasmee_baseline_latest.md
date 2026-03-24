# Tasmee STT Baseline Dashboard

- Generated at: `2026-02-19T20:08:29.165448+00:00`
- Tasmee URL: `http://127.0.0.1:8080`
- Corpus: `api\benchmarks\tasmee_corpus.baseline.json`

## Summary

| Metric | Value |
|---|---:|
| Samples | 5 |
| Success | 5 |
| Failure Rate | 0.00% |
| Audio Minutes | 1.92 |
| Run Time (s) | 28.52 |
| Client->Partial p50 (ms) | 2.9 |
| Client->Partial p95 (ms) | 3.4 |
| Client->Final p50 (ms) | 3173.8 |
| Client->Final p95 (ms) | 5975.7 |
| Cost / Audio Minute (USD) | 0.0 |

## Cohorts

| Cohort (condition|device|style) | Samples | Failure Rate | Partial p50 | Partial p95 | Final p50 | Final p95 |
|---|---:|---:|---:|---:|---:|---:|
| noisy|device_mic|murattal_hafs | 1 | 0.00% | 3.4 | 3.4 | 5914.6 | 5914.6 |
| noisy|external_mic|mujawwad | 1 | 0.00% | 2.9 | 2.9 | 5975.7 | 5975.7 |
| quiet|device_mic|murattal_hafs | 1 | 0.00% | 2.7 | 2.7 | 268.2 | 268.2 |
| quiet|device_mic|murattal_hafs_slow | 1 | 0.00% | 2.6 | 2.6 | 3070.3 | 3070.3 |
| quiet|external_mic|mujawwad | 1 | 0.00% | 2.9 | 2.9 | 3173.8 | 3173.8 |

## Sample Outcomes

| Sample | Success | Partial (ms) | Final (ms) | Failure Reason |
|---|---:|---:|---:|---|
| quiet_device_mic_murattal_short | yes | 2.7 | 268.2 |  |
| quiet_device_mic_murattal_medium | yes | 2.6 | 3070.3 |  |
| noisy_device_mic_murattal | yes | 3.4 | 5914.6 |  |
| quiet_external_mic_mujawwad | yes | 2.9 | 3173.8 |  |
| noisy_external_mic_mujawwad | yes | 2.9 | 5975.7 |  |
