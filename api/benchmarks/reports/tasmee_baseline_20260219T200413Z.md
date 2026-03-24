# Tasmee STT Baseline Dashboard

- Generated at: `2026-02-19T20:04:13.293371+00:00`
- Tasmee URL: `http://127.0.0.1:8080`
- Corpus: `C:\Users\anasa\Desktop\IqraaAI\api\benchmarks\tasmee_corpus.baseline.json`

## Summary

| Metric | Value |
|---|---:|
| Samples | 5 |
| Success | 0 |
| Failure Rate | 100.00% |
| Audio Minutes | 1.92 |
| Run Time (s) | 10.58 |
| Client->Partial p50 (ms) | n/a |
| Client->Partial p95 (ms) | n/a |
| Client->Final p50 (ms) | n/a |
| Client->Final p95 (ms) | n/a |
| Cost / Audio Minute (USD) | 0.0 |

## Cohorts

| Cohort (condition|device|style) | Samples | Failure Rate | Partial p50 | Partial p95 | Final p50 | Final p95 |
|---|---:|---:|---:|---:|---:|---:|
| noisy|device_mic|murattal_hafs | 1 | 100.00% | n/a | n/a | n/a | n/a |
| noisy|external_mic|mujawwad | 1 | 100.00% | n/a | n/a | n/a | n/a |
| quiet|device_mic|murattal_hafs | 1 | 100.00% | n/a | n/a | n/a | n/a |
| quiet|device_mic|murattal_hafs_slow | 1 | 100.00% | n/a | n/a | n/a | n/a |
| quiet|external_mic|mujawwad | 1 | 100.00% | n/a | n/a | n/a | n/a |

## Sample Outcomes

| Sample | Success | Partial (ms) | Final (ms) | Failure Reason |
|---|---:|---:|---:|---|
| quiet_device_mic_murattal_short | no | n/a | n/a | runtime_error |
| quiet_device_mic_murattal_medium | no | n/a | n/a | runtime_error |
| noisy_device_mic_murattal | no | n/a | n/a | runtime_error |
| quiet_external_mic_mujawwad | no | n/a | n/a | runtime_error |
| noisy_external_mic_mujawwad | no | n/a | n/a | runtime_error |
