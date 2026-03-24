# Tasmee STT Baseline Dashboard

- Generated at: `2026-02-19T20:07:06.169825+00:00`
- Tasmee URL: `http://127.0.0.1:8080`
- Corpus: `api\benchmarks\tasmee_corpus.baseline.json`

## Summary

| Metric | Value |
|---|---:|
| Samples | 5 |
| Success | 5 |
| Failure Rate | 0.00% |
| Audio Minutes | 1.92 |
| Run Time (s) | 28.81 |
| Client->Partial p50 (ms) | 2.3 |
| Client->Partial p95 (ms) | 3.3 |
| Client->Final p50 (ms) | 3374.3 |
| Client->Final p95 (ms) | 5957.2 |
| Cost / Audio Minute (USD) | 0.0 |

## Cohorts

| Cohort (condition|device|style) | Samples | Failure Rate | Partial p50 | Partial p95 | Final p50 | Final p95 |
|---|---:|---:|---:|---:|---:|---:|
| noisy|device_mic|murattal_hafs | 1 | 0.00% | 2.3 | 2.3 | 5844.6 | 5844.6 |
| noisy|external_mic|mujawwad | 1 | 0.00% | 2.1 | 2.1 | 5957.2 | 5957.2 |
| quiet|device_mic|murattal_hafs | 1 | 0.00% | 3.3 | 3.3 | 254.7 | 254.7 |
| quiet|device_mic|murattal_hafs_slow | 1 | 0.00% | 2.6 | 2.6 | 3374.3 | 3374.3 |
| quiet|external_mic|mujawwad | 1 | 0.00% | 2.2 | 2.2 | 3153.8 | 3153.8 |

## Sample Outcomes

| Sample | Success | Partial (ms) | Final (ms) | Failure Reason |
|---|---:|---:|---:|---|
| quiet_device_mic_murattal_short | yes | 3.3 | 254.7 |  |
| quiet_device_mic_murattal_medium | yes | 2.6 | 3374.3 |  |
| noisy_device_mic_murattal | yes | 2.3 | 5844.6 |  |
| quiet_external_mic_mujawwad | yes | 2.2 | 3153.8 |  |
| noisy_external_mic_mujawwad | yes | 2.1 | 5957.2 |  |
