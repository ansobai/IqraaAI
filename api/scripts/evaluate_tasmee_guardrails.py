from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _load_report(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _float_or_none(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _extract_metrics(report: dict[str, Any]) -> dict[str, float | None]:
    summary = report.get("summary")
    if not isinstance(summary, dict):
        raise ValueError("Report is missing summary")

    partial = summary.get("client_to_partial_ms")
    partial = partial if isinstance(partial, dict) else {}
    cost = summary.get("cost")
    cost = cost if isinstance(cost, dict) else {}

    failure_rate = _float_or_none(summary.get("failure_rate"))
    if failure_rate is None:
        failure_rate = 1.0

    return {
        "p95_first_partial_ms": _float_or_none(partial.get("p95")),
        "failure_rate": failure_rate,
        "cost_per_audio_min_usd": _float_or_none(cost.get("cost_per_audio_min_usd")),
    }


def _ratio(current: float | None, baseline: float | None) -> float | None:
    if current is None or baseline is None:
        return None
    if baseline <= 0:
        return float("inf") if current > 0 else 1.0
    return current / baseline


def _evaluate(
    *,
    current: dict[str, float | None],
    baseline: dict[str, float | None] | None,
    max_p95_ms: float,
    max_failure_rate: float,
    max_cost_per_audio_min: float | None,
    max_p95_regression_ratio: float,
    max_failure_regression_abs: float,
    max_cost_regression_ratio: float,
) -> tuple[bool, list[dict[str, Any]]]:
    checks: list[dict[str, Any]] = []

    p95 = current.get("p95_first_partial_ms")
    if p95 is None:
        checks.append(
            {
                "name": "p95_first_partial_present",
                "pass": False,
                "current": p95,
                "reason": "missing p95 first partial metric",
            }
        )
    else:
        checks.append(
            {
                "name": "p95_first_partial_threshold",
                "pass": p95 <= max_p95_ms,
                "current": p95,
                "threshold": max_p95_ms,
            }
        )

    failure_rate = current.get("failure_rate")
    checks.append(
        {
            "name": "failure_rate_threshold",
            "pass": (failure_rate is not None and failure_rate <= max_failure_rate),
            "current": failure_rate,
            "threshold": max_failure_rate,
        }
    )

    if max_cost_per_audio_min is not None:
        cost = current.get("cost_per_audio_min_usd")
        checks.append(
            {
                "name": "cost_per_audio_min_threshold",
                "pass": (cost is not None and cost <= max_cost_per_audio_min),
                "current": cost,
                "threshold": max_cost_per_audio_min,
            }
        )

    if baseline is not None:
        p95_ratio = _ratio(
            current.get("p95_first_partial_ms"),
            baseline.get("p95_first_partial_ms"),
        )
        checks.append(
            {
                "name": "p95_regression_ratio",
                "pass": (p95_ratio is not None and p95_ratio <= max_p95_regression_ratio),
                "current": p95_ratio,
                "threshold": max_p95_regression_ratio,
            }
        )

        current_failure = current.get("failure_rate")
        baseline_failure = baseline.get("failure_rate")
        failure_delta: float | None = None
        if current_failure is not None and baseline_failure is not None:
            failure_delta = current_failure - baseline_failure
        checks.append(
            {
                "name": "failure_rate_regression_abs",
                "pass": (failure_delta is not None and failure_delta <= max_failure_regression_abs),
                "current": failure_delta,
                "threshold": max_failure_regression_abs,
            }
        )

        cost_ratio = _ratio(
            current.get("cost_per_audio_min_usd"),
            baseline.get("cost_per_audio_min_usd"),
        )
        checks.append(
            {
                "name": "cost_regression_ratio",
                "pass": (cost_ratio is not None and cost_ratio <= max_cost_regression_ratio),
                "current": cost_ratio,
                "threshold": max_cost_regression_ratio,
            }
        )

    passed = all(bool(item.get("pass")) for item in checks)
    return passed, checks


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate Tasmee canary guardrail metrics.")
    parser.add_argument("--report", required=True, help="Path to current benchmark json report.")
    parser.add_argument("--baseline", default=None, help="Optional baseline benchmark json report.")
    parser.add_argument("--max-p95-first-partial-ms", type=float, default=1000.0)
    parser.add_argument("--max-failure-rate", type=float, default=0.03)
    parser.add_argument("--max-cost-per-audio-min-usd", type=float, default=None)
    parser.add_argument("--max-p95-regression-ratio", type=float, default=1.25)
    parser.add_argument("--max-failure-rate-regression-abs", type=float, default=0.02)
    parser.add_argument("--max-cost-regression-ratio", type=float, default=1.25)
    parser.add_argument("--output", default=None, help="Optional output path for evaluation json.")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    report_path = Path(args.report).resolve()
    baseline_path = Path(args.baseline).resolve() if args.baseline else None

    current_report = _load_report(report_path)
    current_metrics = _extract_metrics(current_report)

    baseline_metrics = None
    if baseline_path is not None:
        baseline_metrics = _extract_metrics(_load_report(baseline_path))

    passed, checks = _evaluate(
        current=current_metrics,
        baseline=baseline_metrics,
        max_p95_ms=float(args.max_p95_first_partial_ms),
        max_failure_rate=float(args.max_failure_rate),
        max_cost_per_audio_min=(
            float(args.max_cost_per_audio_min_usd)
            if args.max_cost_per_audio_min_usd is not None
            else None
        ),
        max_p95_regression_ratio=float(args.max_p95_regression_ratio),
        max_failure_regression_abs=float(args.max_failure_rate_regression_abs),
        max_cost_regression_ratio=float(args.max_cost_regression_ratio),
    )

    result = {
        "ok": passed,
        "report": str(report_path),
        "baseline": str(baseline_path) if baseline_path else None,
        "current_metrics": current_metrics,
        "baseline_metrics": baseline_metrics,
        "checks": checks,
    }
    output = json.dumps(result, ensure_ascii=False, indent=2)
    print(output)

    if args.output:
        Path(args.output).resolve().write_text(output + "\n", encoding="utf-8")

    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
