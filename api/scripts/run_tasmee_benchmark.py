from __future__ import annotations

import argparse
import asyncio
import base64
import contextlib
import io
import json
import math
import os
import statistics
import time
import wave
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
import websockets

DEFAULT_CORPUS_PATH = Path(__file__).resolve().parents[1] / "benchmarks" / "tasmee_corpus.baseline.json"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parents[1] / "benchmarks" / "reports"
DEFAULT_BASE_URL = "http://127.0.0.1:8080"

MIME_BY_SUFFIX = {
    ".wav": "audio/wav",
    ".mp4": "audio/mp4",
    ".m4a": "audio/mp4",
    ".webm": "audio/webm",
    ".mp3": "audio/mpeg",
}


def _float_env(name: str, default: float = 0.0) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


@dataclass
class BenchmarkSample:
    sample_id: str
    audio_path: Path
    page_number: int
    surah_id: int
    condition: str
    device_profile: str
    recitation_style: str
    mime_type: str | None
    chunk_ms: int
    level_db: float
    has_speech: bool
    inter_chunk_delay_ms: int
    final_wait_ms: int
    duration_ms: int | None


@dataclass
class AudioChunk:
    audio_bytes: bytes
    duration_ms: int


@dataclass
class SampleResult:
    sample_id: str
    condition: str
    device_profile: str
    recitation_style: str
    page_number: int
    surah_id: int
    chunk_count: int
    audio_ms: int
    accepted_chunks: int
    success: bool
    first_partial_ms: float | None
    client_to_final_ms: float | None
    failure_reason: str | None
    error_message: str | None


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _parse_corpus(corpus_path: Path) -> tuple[list[BenchmarkSample], dict[str, Any]]:
    payload = _load_json(corpus_path)
    defaults = payload.get("defaults") if isinstance(payload, dict) else {}
    defaults = defaults if isinstance(defaults, dict) else {}
    samples_raw = payload.get("samples") if isinstance(payload, dict) else []
    if not isinstance(samples_raw, list) or not samples_raw:
        raise ValueError("Corpus must contain a non-empty 'samples' array")

    default_chunk_ms = int(defaults.get("chunk_ms", 800))
    default_level_db = float(defaults.get("level_db", -30.0))
    default_has_speech = bool(defaults.get("has_speech", True))
    default_inter_chunk_delay_ms = int(defaults.get("inter_chunk_delay_ms", 120))
    default_final_wait_ms = int(defaults.get("final_wait_ms", 1500))

    samples: list[BenchmarkSample] = []
    for index, raw in enumerate(samples_raw):
        if not isinstance(raw, dict):
            raise ValueError(f"Invalid sample at index={index}")

        sample_id = str(raw.get("id") or f"sample_{index + 1}")
        raw_path = raw.get("path")
        if not isinstance(raw_path, str) or not raw_path.strip():
            raise ValueError(f"Sample '{sample_id}' is missing a valid path")
        audio_path = (corpus_path.parent / raw_path).resolve()
        if not audio_path.exists():
            raise ValueError(f"Sample '{sample_id}' file not found: {audio_path}")

        page_number = int(raw.get("page_number", 1))
        surah_id = int(raw.get("surah_id", 1))
        condition = str(raw.get("condition") or "unspecified").strip() or "unspecified"
        device_profile = str(raw.get("device_profile") or "unspecified").strip() or "unspecified"
        recitation_style = str(raw.get("recitation_style") or "unspecified").strip() or "unspecified"
        mime_type = raw.get("mime_type")
        mime_resolved = str(mime_type).strip() if isinstance(mime_type, str) and mime_type.strip() else None

        chunk_ms = int(raw.get("chunk_ms", default_chunk_ms))
        level_db = float(raw.get("level_db", default_level_db))
        has_speech = bool(raw.get("has_speech", default_has_speech))
        inter_chunk_delay_ms = int(raw.get("inter_chunk_delay_ms", default_inter_chunk_delay_ms))
        final_wait_ms = int(raw.get("final_wait_ms", default_final_wait_ms))
        duration_value = raw.get("duration_ms")
        duration_ms = int(duration_value) if isinstance(duration_value, int) else None

        samples.append(
            BenchmarkSample(
                sample_id=sample_id,
                audio_path=audio_path,
                page_number=page_number,
                surah_id=surah_id,
                condition=condition,
                device_profile=device_profile,
                recitation_style=recitation_style,
                mime_type=mime_resolved,
                chunk_ms=max(40, chunk_ms),
                level_db=level_db,
                has_speech=has_speech,
                inter_chunk_delay_ms=max(0, inter_chunk_delay_ms),
                final_wait_ms=max(0, final_wait_ms),
                duration_ms=duration_ms,
            )
        )

    metadata = {
        "schema_version": payload.get("schema_version") if isinstance(payload, dict) else None,
        "name": payload.get("name") if isinstance(payload, dict) else None,
        "description": payload.get("description") if isinstance(payload, dict) else None,
    }
    return samples, metadata


def _choose_mime(sample: BenchmarkSample) -> str:
    if sample.mime_type:
        return sample.mime_type
    suffix = sample.audio_path.suffix.lower()
    return MIME_BY_SUFFIX.get(suffix, "application/octet-stream")


def _decode_wav_chunks(audio_path: Path, chunk_ms: int) -> list[AudioChunk]:
    chunks: list[AudioChunk] = []
    with wave.open(str(audio_path), "rb") as wav_file:
        frame_rate = wav_file.getframerate()
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        params = wav_file.getparams()
        frame_size = channels * sample_width
        if frame_rate <= 0 or frame_size <= 0:
            raise ValueError(f"Invalid WAV metadata for {audio_path}")

        frames_per_chunk = max(1, int(frame_rate * (chunk_ms / 1000.0)))
        while True:
            frames = wav_file.readframes(frames_per_chunk)
            if not frames:
                break
            frame_count = max(1, len(frames) // frame_size)
            duration_ms = max(1, int(round((frame_count / frame_rate) * 1000)))

            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as chunk_wav:
                chunk_wav.setnchannels(params.nchannels)
                chunk_wav.setsampwidth(params.sampwidth)
                chunk_wav.setframerate(params.framerate)
                chunk_wav.writeframes(frames)
            chunks.append(AudioChunk(audio_bytes=buffer.getvalue(), duration_ms=duration_ms))

    if not chunks:
        raise ValueError(f"No WAV chunks generated for {audio_path}")
    return chunks


def _single_chunk(sample: BenchmarkSample) -> list[AudioChunk]:
    audio_bytes = sample.audio_path.read_bytes()
    if not audio_bytes:
        raise ValueError(f"Empty audio file: {sample.audio_path}")

    if sample.duration_ms is None:
        raise ValueError(
            f"Sample '{sample.sample_id}' is non-WAV and must set duration_ms in corpus"
        )
    return [AudioChunk(audio_bytes=audio_bytes, duration_ms=max(1, sample.duration_ms))]


def _load_audio_chunks(sample: BenchmarkSample) -> tuple[list[AudioChunk], int]:
    if sample.audio_path.suffix.lower() == ".wav":
        chunks = _decode_wav_chunks(sample.audio_path, sample.chunk_ms)
    else:
        chunks = _single_chunk(sample)
    total_duration_ms = sum(chunk.duration_ms for chunk in chunks)
    return chunks, total_duration_ms


def _format_ms(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.1f}"


def _percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(0, min(len(ordered) - 1, int(math.ceil((pct / 100.0) * len(ordered))) - 1))
    return float(ordered[rank])


def _calc_latency_stats(values: list[float]) -> dict[str, Any]:
    if not values:
        return {"count": 0, "avg": None, "p50": None, "p95": None}
    return {
        "count": len(values),
        "avg": float(statistics.fmean(values)),
        "p50": _percentile(values, 50.0),
        "p95": _percentile(values, 95.0),
    }


def _with_query(url: str, params: dict[str, str]) -> str:
    parsed = urlparse(url)
    existing = dict(parse_qsl(parsed.query, keep_blank_values=True))
    existing.update(params)
    query = urlencode(existing)
    return urlunparse(parsed._replace(query=query))


async def _ws_connect(url: str):
    try:
        return await websockets.connect(url, ping_interval=None, ping_timeout=None, open_timeout=20)
    except TypeError:
        # Compatibility for websocket clients with slightly different signatures.
        return await websockets.connect(url)


async def _run_one_sample(
    sample: BenchmarkSample,
    client: httpx.AsyncClient,
    base_url: str,
    bearer_token: str | None,
) -> SampleResult:
    headers: dict[str, str] = {}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    chunks, audio_ms = _load_audio_chunks(sample)
    first_chunk_sent_at: float | None = None
    first_delta_at: float | None = None
    last_delta_at: float | None = None
    accepted_chunks = 0
    failure_reason: str | None = None
    error_message: str | None = None
    session_id: str | None = None
    ws = None
    listener_task: asyncio.Task[None] | None = None

    try:
        create_response = await client.post(
            f"{base_url}/v1/tasmee/sessions",
            json={"page_number": sample.page_number, "surah_id": sample.surah_id},
            headers=headers,
            timeout=20.0,
        )
        if create_response.status_code != 200:
            return SampleResult(
                sample_id=sample.sample_id,
                condition=sample.condition,
                device_profile=sample.device_profile,
                recitation_style=sample.recitation_style,
                page_number=sample.page_number,
                surah_id=sample.surah_id,
                chunk_count=len(chunks),
                audio_ms=audio_ms,
                accepted_chunks=0,
                success=False,
                first_partial_ms=None,
                client_to_final_ms=None,
                failure_reason="session_create_failed",
                error_message=f"http_{create_response.status_code}",
            )

        session_payload = create_response.json()
        session_id = str(session_payload.get("session_id") or "")
        if not session_id:
            raise RuntimeError("Session creation response missing session_id")

        ws_url = str(session_payload.get("ws_url") or f"{base_url}/v1/tasmee/ws")
        ws_token = session_payload.get("ws_token")
        fallback_url = str(
            session_payload.get("fallback_url") or f"{base_url}/v1/tasmee/sessions/{session_id}/chunks"
        )

        ws_full_url = _with_query(
            ws_url,
            {
                "session_id": session_id,
                **({"token": str(ws_token)} if ws_token else {}),
            },
        )
        ws = await _ws_connect(ws_full_url)

        # Initial status event.
        await asyncio.wait_for(ws.recv(), timeout=10.0)

        async def _listen() -> None:
            nonlocal first_delta_at, last_delta_at
            while True:
                raw = await ws.recv()
                now = time.perf_counter()
                if isinstance(raw, bytes):
                    continue
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict) and payload.get("type") == "feedback.delta":
                    if first_delta_at is None:
                        first_delta_at = now
                    last_delta_at = now

        listener_task = asyncio.create_task(_listen())

        mime_type = _choose_mime(sample)
        for seq, chunk in enumerate(chunks, start=1):
            if first_chunk_sent_at is None:
                first_chunk_sent_at = time.perf_counter()

            payload = {
                "seq": seq,
                "audio_base64": base64.b64encode(chunk.audio_bytes).decode("ascii"),
                "mime_type": mime_type,
                "duration_ms": int(chunk.duration_ms),
                "level_db": sample.level_db,
                "has_speech": sample.has_speech,
            }
            chunk_response = await client.post(
                fallback_url,
                json=payload,
                headers=headers,
                timeout=20.0,
            )
            if chunk_response.status_code != 200:
                failure_reason = "chunk_upload_failed"
                error_message = f"seq={seq} http_{chunk_response.status_code}"
                break
            response_payload = chunk_response.json()
            if bool(response_payload.get("accepted")):
                accepted_chunks += 1

            if sample.inter_chunk_delay_ms > 0:
                await asyncio.sleep(sample.inter_chunk_delay_ms / 1000.0)

        await asyncio.sleep(sample.final_wait_ms / 1000.0)
    except Exception as exc:
        if failure_reason is None:
            failure_reason = "runtime_error"
        if error_message is None:
            error_message = str(exc)
    finally:
        if session_id:
            with contextlib.suppress(Exception):
                await client.post(
                    f"{base_url}/v1/tasmee/sessions/{session_id}/stop",
                    headers=headers,
                    timeout=10.0,
                )
        if listener_task is not None:
            listener_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, RuntimeError):
                await listener_task
        if ws is not None:
            with contextlib.suppress(Exception):
                await ws.close()

    first_partial_ms = None
    client_to_final_ms = None
    if first_chunk_sent_at is not None and first_delta_at is not None:
        first_partial_ms = max(0.0, (first_delta_at - first_chunk_sent_at) * 1000.0)
    if first_chunk_sent_at is not None and last_delta_at is not None:
        client_to_final_ms = max(0.0, (last_delta_at - first_chunk_sent_at) * 1000.0)

    if failure_reason is None and first_partial_ms is None:
        failure_reason = "no_partial"
    if failure_reason is None and client_to_final_ms is None:
        failure_reason = "no_final"

    success = failure_reason is None
    return SampleResult(
        sample_id=sample.sample_id,
        condition=sample.condition,
        device_profile=sample.device_profile,
        recitation_style=sample.recitation_style,
        page_number=sample.page_number,
        surah_id=sample.surah_id,
        chunk_count=len(chunks),
        audio_ms=audio_ms,
        accepted_chunks=accepted_chunks,
        success=success,
        first_partial_ms=first_partial_ms,
        client_to_final_ms=client_to_final_ms,
        failure_reason=failure_reason,
        error_message=error_message,
    )


def _group_key(result: SampleResult) -> str:
    return f"{result.condition}|{result.device_profile}|{result.recitation_style}"


def _build_report(
    *,
    results: list[SampleResult],
    run_started_at: datetime,
    run_finished_at: datetime,
    corpus_path: Path,
    corpus_meta: dict[str, Any],
    base_url: str,
    stt_hourly_usd: float,
    tasmee_hourly_usd: float,
    run_label: str | None,
) -> dict[str, Any]:
    try:
        corpus_path_for_report = str(corpus_path.relative_to(Path.cwd()))
    except ValueError:
        corpus_path_for_report = str(corpus_path)

    partial_values = [r.first_partial_ms for r in results if r.success and r.first_partial_ms is not None]
    final_values = [r.client_to_final_ms for r in results if r.success and r.client_to_final_ms is not None]
    failures = [r for r in results if not r.success]

    run_seconds = max(0.001, (run_finished_at - run_started_at).total_seconds())
    audio_minutes = sum(r.audio_ms for r in results) / 60000.0
    hourly_usd = max(0.0, stt_hourly_usd) + max(0.0, tasmee_hourly_usd)
    estimated_total_usd = hourly_usd * (run_seconds / 3600.0)
    cost_per_audio_min = estimated_total_usd / audio_minutes if audio_minutes > 0 else None

    groups: dict[str, list[SampleResult]] = {}
    for result in results:
        groups.setdefault(_group_key(result), []).append(result)

    by_cohort: list[dict[str, Any]] = []
    for key, cohort_results in sorted(groups.items()):
        cohort_partial = [
            item.first_partial_ms
            for item in cohort_results
            if item.success and item.first_partial_ms is not None
        ]
        cohort_final = [
            item.client_to_final_ms
            for item in cohort_results
            if item.success and item.client_to_final_ms is not None
        ]
        cohort_failures = [item for item in cohort_results if not item.success]
        by_cohort.append(
            {
                "cohort": key,
                "sample_count": len(cohort_results),
                "failure_rate": (len(cohort_failures) / len(cohort_results)) if cohort_results else 0.0,
                "client_to_partial_ms": _calc_latency_stats([v for v in cohort_partial if v is not None]),
                "client_to_final_ms": _calc_latency_stats([v for v in cohort_final if v is not None]),
            }
        )

    return {
        "run_label": run_label,
        "generated_at": run_finished_at.isoformat(),
        "run_started_at": run_started_at.isoformat(),
        "run_finished_at": run_finished_at.isoformat(),
        "tasmee_base_url": base_url,
        "corpus": {
            "path": corpus_path_for_report,
            "name": corpus_meta.get("name"),
            "description": corpus_meta.get("description"),
            "schema_version": corpus_meta.get("schema_version"),
        },
        "summary": {
            "sample_count": len(results),
            "success_count": len(results) - len(failures),
            "failure_count": len(failures),
            "failure_rate": (len(failures) / len(results)) if results else 0.0,
            "audio_minutes": audio_minutes,
            "run_seconds": run_seconds,
            "client_to_partial_ms": _calc_latency_stats([v for v in partial_values if v is not None]),
            "client_to_final_ms": _calc_latency_stats([v for v in final_values if v is not None]),
            "cost": {
                "stt_hourly_usd": stt_hourly_usd,
                "tasmee_hourly_usd": tasmee_hourly_usd,
                "total_hourly_usd": hourly_usd,
                "estimated_run_usd": estimated_total_usd,
                "cost_per_audio_min_usd": cost_per_audio_min,
            },
        },
        "cohorts": by_cohort,
        "samples": [
            {
                "sample_id": result.sample_id,
                "condition": result.condition,
                "device_profile": result.device_profile,
                "recitation_style": result.recitation_style,
                "page_number": result.page_number,
                "surah_id": result.surah_id,
                "audio_ms": result.audio_ms,
                "chunk_count": result.chunk_count,
                "accepted_chunks": result.accepted_chunks,
                "success": result.success,
                "first_partial_ms": result.first_partial_ms,
                "client_to_final_ms": result.client_to_final_ms,
                "failure_reason": result.failure_reason,
                "error_message": result.error_message,
            }
            for result in results
        ],
    }


def _build_markdown(report: dict[str, Any]) -> str:
    summary = report["summary"]
    partial = summary["client_to_partial_ms"]
    final = summary["client_to_final_ms"]
    cost = summary["cost"]

    lines: list[str] = [
        "# Tasmee STT Baseline Dashboard",
        "",
        f"- Generated at: `{report['generated_at']}`",
        f"- Tasmee URL: `{report['tasmee_base_url']}`",
        f"- Corpus: `{report['corpus']['path']}`",
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| Samples | {summary['sample_count']} |",
        f"| Success | {summary['success_count']} |",
        f"| Failure Rate | {summary['failure_rate'] * 100:.2f}% |",
        f"| Audio Minutes | {summary['audio_minutes']:.2f} |",
        f"| Run Time (s) | {summary['run_seconds']:.2f} |",
        f"| Client->Partial p50 (ms) | {_format_ms(partial['p50'])} |",
        f"| Client->Partial p95 (ms) | {_format_ms(partial['p95'])} |",
        f"| Client->Final p50 (ms) | {_format_ms(final['p50'])} |",
        f"| Client->Final p95 (ms) | {_format_ms(final['p95'])} |",
        f"| Cost / Audio Minute (USD) | {_format_ms(cost['cost_per_audio_min_usd'])} |",
        "",
        "## Cohorts",
        "",
        "| Cohort (condition|device|style) | Samples | Failure Rate | Partial p50 | Partial p95 | Final p50 | Final p95 |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]

    for cohort in report["cohorts"]:
        partial_stats = cohort["client_to_partial_ms"]
        final_stats = cohort["client_to_final_ms"]
        lines.append(
            "| "
            + f"{cohort['cohort']} | {cohort['sample_count']} | {cohort['failure_rate'] * 100:.2f}%"
            + f" | {_format_ms(partial_stats['p50'])} | {_format_ms(partial_stats['p95'])}"
            + f" | {_format_ms(final_stats['p50'])} | {_format_ms(final_stats['p95'])} |"
        )

    lines.extend(
        [
            "",
            "## Sample Outcomes",
            "",
            "| Sample | Success | Partial (ms) | Final (ms) | Failure Reason |",
            "|---|---:|---:|---:|---|",
        ]
    )
    for sample in report["samples"]:
        lines.append(
            "| "
            + f"{sample['sample_id']} | {'yes' if sample['success'] else 'no'}"
            + f" | {_format_ms(sample['first_partial_ms'])}"
            + f" | {_format_ms(sample['client_to_final_ms'])}"
            + f" | {sample['failure_reason'] or ''} |"
        )

    return "\n".join(lines) + "\n"


async def _run_all(
    *,
    samples: list[BenchmarkSample],
    base_url: str,
    bearer_token: str | None,
    concurrency: int,
) -> list[SampleResult]:
    semaphore = asyncio.Semaphore(max(1, concurrency))
    timeout = httpx.Timeout(30.0, connect=20.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async def _guarded(sample: BenchmarkSample) -> SampleResult:
            async with semaphore:
                return await _run_one_sample(
                    sample=sample,
                    client=client,
                    base_url=base_url,
                    bearer_token=bearer_token,
                )

        tasks = [asyncio.create_task(_guarded(sample)) for sample in samples]
        return list(await asyncio.gather(*tasks))


def _parse_args() -> argparse.Namespace:
    env_base_url = (os.getenv("TASMEE_BENCH_BASE_URL") or DEFAULT_BASE_URL).strip() or DEFAULT_BASE_URL
    env_stt_hourly = _float_env("TASMEE_BENCH_STT_HOURLY_USD", 0.0)
    env_tasmee_hourly = _float_env("TASMEE_BENCH_TASMEE_HOURLY_USD", 0.0)
    parser = argparse.ArgumentParser(description="Run Tasmee STT latency baseline benchmark.")
    parser.add_argument(
        "--tasmee-base-url",
        default=env_base_url,
        help=f"Tasmee service base URL (default: {env_base_url})",
    )
    parser.add_argument(
        "--corpus",
        default=str(DEFAULT_CORPUS_PATH),
        help="Path to corpus json manifest.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Directory to write report artifacts.",
    )
    parser.add_argument(
        "--bearer-token",
        default=(os.getenv("TASMEE_BENCH_BEARER_TOKEN") or "").strip() or None,
        help="Optional bearer token for auth-required tasmee endpoints.",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=1,
        help="Number of concurrent corpus samples to run.",
    )
    parser.add_argument(
        "--stt-hourly-usd",
        type=float,
        default=env_stt_hourly,
        help="Hourly infrastructure cost for STT endpoint in USD.",
    )
    parser.add_argument(
        "--tasmee-hourly-usd",
        type=float,
        default=env_tasmee_hourly,
        help="Hourly infrastructure cost for Tasmee service in USD.",
    )
    parser.add_argument(
        "--run-label",
        default=None,
        help="Optional label stored in the output report.",
    )
    return parser.parse_args()


async def _main_async(args: argparse.Namespace) -> int:
    corpus_path = Path(args.corpus).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    samples, corpus_meta = _parse_corpus(corpus_path)
    run_started_at = datetime.now(timezone.utc)
    results = await _run_all(
        samples=samples,
        base_url=args.tasmee_base_url.rstrip("/"),
        bearer_token=args.bearer_token,
        concurrency=max(1, int(args.concurrency)),
    )
    run_finished_at = datetime.now(timezone.utc)

    report = _build_report(
        results=results,
        run_started_at=run_started_at,
        run_finished_at=run_finished_at,
        corpus_path=corpus_path,
        corpus_meta=corpus_meta,
        base_url=args.tasmee_base_url.rstrip("/"),
        stt_hourly_usd=float(args.stt_hourly_usd),
        tasmee_hourly_usd=float(args.tasmee_hourly_usd),
        run_label=args.run_label,
    )

    timestamp = run_finished_at.strftime("%Y%m%dT%H%M%SZ")
    json_path = output_dir / f"tasmee_baseline_{timestamp}.json"
    md_path = output_dir / f"tasmee_baseline_{timestamp}.md"
    latest_json = output_dir / "tasmee_baseline_latest.json"
    latest_md = output_dir / "tasmee_baseline_latest.md"

    json_text = json.dumps(report, ensure_ascii=False, indent=2)
    md_text = _build_markdown(report)

    json_path.write_text(json_text, encoding="utf-8")
    md_path.write_text(md_text, encoding="utf-8")
    latest_json.write_text(json_text, encoding="utf-8")
    latest_md.write_text(md_text, encoding="utf-8")

    print(f"[tasmee-benchmark] wrote: {json_path}")
    print(f"[tasmee-benchmark] wrote: {md_path}")
    print(f"[tasmee-benchmark] latest: {latest_json}")
    print(f"[tasmee-benchmark] latest: {latest_md}")
    return 0


def main() -> int:
    args = _parse_args()
    return asyncio.run(_main_async(args))


if __name__ == "__main__":
    raise SystemExit(main())
