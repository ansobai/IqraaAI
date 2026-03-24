from __future__ import annotations

import argparse
import asyncio
import base64
import io
import json
import math
import os
import statistics
import time
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
import websockets


@dataclass
class AudioChunk:
    audio_bytes: bytes
    duration_ms: int


def _percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(0, min(len(ordered) - 1, int(math.ceil((pct / 100.0) * len(ordered))) - 1))
    return float(ordered[rank])


def _stats(values: list[float]) -> dict[str, float | int | None]:
    if not values:
        return {"count": 0, "avg": None, "p50": None, "p95": None}
    return {
        "count": len(values),
        "avg": float(statistics.fmean(values)),
        "p50": _percentile(values, 50.0),
        "p95": _percentile(values, 95.0),
    }


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


def _single_chunk(audio_path: Path, duration_ms: int | None) -> list[AudioChunk]:
    audio_bytes = audio_path.read_bytes()
    if not audio_bytes:
        raise ValueError(f"Empty audio file: {audio_path}")
    if duration_ms is None:
        raise ValueError("Non-WAV input requires --duration-ms")
    return [AudioChunk(audio_bytes=audio_bytes, duration_ms=max(1, duration_ms))]


def _load_chunks(audio_path: Path, chunk_ms: int, duration_ms: int | None) -> list[AudioChunk]:
    if audio_path.suffix.lower() == ".wav":
        return _decode_wav_chunks(audio_path, chunk_ms)
    return _single_chunk(audio_path, duration_ms)


def _with_query(url: str, params: dict[str, str]) -> str:
    parsed = urlparse(url)
    existing = dict(parse_qsl(parsed.query, keep_blank_values=True))
    existing.update(params)
    return urlunparse(parsed._replace(query=urlencode(existing)))


async def _ws_connect(url: str):
    try:
        return await websockets.connect(url, ping_interval=None, ping_timeout=None, open_timeout=20)
    except TypeError:
        return await websockets.connect(url)


def _bool_arg(value: str) -> bool:
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "y"}:
        return True
    if normalized in {"0", "false", "no", "n"}:
        return False
    raise argparse.ArgumentTypeError("Expected true/false")


async def _run(args: argparse.Namespace) -> int:
    base_url = args.tasmee_base_url.rstrip("/")
    audio_path = Path(args.audio).resolve()
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    chunks = _load_chunks(audio_path, args.chunk_ms, args.duration_ms)

    headers: dict[str, str] = {}
    if args.bearer_token:
        headers["Authorization"] = f"Bearer {args.bearer_token}"

    timeout = httpx.Timeout(30.0, connect=20.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        create_response = await client.post(
            f"{base_url}/v1/tasmee/sessions",
            json={"page_number": args.page_number, "surah_id": args.surah_id},
            headers=headers,
        )
        if create_response.status_code != 200:
            error_text = create_response.text.strip()
            print(
                json.dumps(
                    {
                        "ok": False,
                        "stage": "create_session",
                        "http_status": create_response.status_code,
                        "error": error_text or None,
                        "hint": "Set --bearer-token if TASMEE_REQUIRE_AUTH=true on the deployment.",
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return 2

        session_payload = create_response.json()
        session_id = str(session_payload.get("session_id") or "")
        if not session_id:
            print(json.dumps({"ok": False, "stage": "create_session", "error": "missing_session_id"}))
            return 2

        ws_url = str(session_payload.get("ws_url") or f"{base_url}/v1/tasmee/ws")
        ws_token = session_payload.get("ws_token")
        ws_full_url = _with_query(
            ws_url,
            {
                "session_id": session_id,
                **({"token": str(ws_token)} if ws_token else {}),
            },
        )

        ws = await _ws_connect(ws_full_url)
        await asyncio.wait_for(ws.recv(), timeout=10.0)

        first_send_at: float | None = None
        first_status_at: float | None = None
        first_delta_at: float | None = None
        last_delta_at: float | None = None
        sent_at_by_seq: dict[int, float] = {}
        status_first_at_by_seq: dict[int, float] = {}
        delta_first_at_by_seq: dict[int, float] = {}
        event_count = 0

        async def _listen_events() -> None:
            nonlocal first_status_at, first_delta_at, last_delta_at, event_count
            while True:
                raw = await ws.recv()
                recv_at = time.perf_counter()
                if isinstance(raw, bytes):
                    continue
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(payload, dict):
                    continue
                event_count += 1

                event_type = str(payload.get("type") or "")
                seq_ack_raw = payload.get("seq_ack")
                try:
                    seq_ack = int(seq_ack_raw) if seq_ack_raw is not None else None
                except (TypeError, ValueError):
                    seq_ack = None

                if event_type == "session.status" and seq_ack and seq_ack > 0:
                    status_first_at_by_seq.setdefault(seq_ack, recv_at)
                    if first_status_at is None:
                        first_status_at = recv_at
                if event_type == "feedback.delta" and seq_ack and seq_ack > 0:
                    delta_first_at_by_seq.setdefault(seq_ack, recv_at)
                    if first_delta_at is None:
                        first_delta_at = recv_at
                    last_delta_at = recv_at

        listener_task = asyncio.create_task(_listen_events())
        try:
            accumulated_ms = 0
            for seq, chunk in enumerate(chunks, start=1):
                now = time.perf_counter()
                if first_send_at is None:
                    first_send_at = now
                sent_at_by_seq[seq] = now

                payload = {
                    "type": "chunk.upload",
                    "seq": seq,
                    "audio_base64": base64.b64encode(chunk.audio_bytes).decode("ascii"),
                    "mime_type": args.mime_type,
                    "duration_ms": int(chunk.duration_ms),
                    "level_db": float(args.level_db),
                    "has_speech": bool(args.has_speech),
                    "client_chunk_started_at_ms": accumulated_ms,
                    "client_chunk_ended_at_ms": accumulated_ms + int(chunk.duration_ms),
                }
                await ws.send(json.dumps(payload, ensure_ascii=False))
                accumulated_ms += int(chunk.duration_ms)
                if args.inter_chunk_delay_ms > 0:
                    await asyncio.sleep(args.inter_chunk_delay_ms / 1000.0)

            if args.final_wait_ms > 0:
                await asyncio.sleep(args.final_wait_ms / 1000.0)
        finally:
            listener_task.cancel()
            try:
                await listener_task
            except asyncio.CancelledError:
                pass
            try:
                await client.post(
                    f"{base_url}/v1/tasmee/sessions/{session_id}/stop",
                    headers=headers,
                )
            except Exception:
                pass
            await ws.close()

    sent_seqs = sorted(sent_at_by_seq.keys())
    status_acked_seqs = sorted(status_first_at_by_seq.keys())
    delta_acked_seqs = sorted(delta_first_at_by_seq.keys())
    acked_any = sorted(set(status_acked_seqs) | set(delta_acked_seqs))
    missing_any = sorted(set(sent_seqs) - set(acked_any))

    per_chunk_any_latency_ms: list[float] = []
    for seq in sent_seqs:
        send_at = sent_at_by_seq[seq]
        ack_times = [
            ts
            for ts in (
                status_first_at_by_seq.get(seq),
                delta_first_at_by_seq.get(seq),
            )
            if ts is not None
        ]
        if ack_times:
            per_chunk_any_latency_ms.append((min(ack_times) - send_at) * 1000.0)

    result = {
        "ok": len(missing_any) == 0 and first_send_at is not None,
        "tasmee_base_url": base_url,
        "audio_path": str(audio_path),
        "chunks_sent": len(sent_seqs),
        "events_received": event_count,
        "acked_seq_status_count": len(status_acked_seqs),
        "acked_seq_delta_count": len(delta_acked_seqs),
        "acked_seq_union_count": len(acked_any),
        "missing_seq_ack": missing_any,
        "latency_ms": {
            "first_send_to_first_status": (
                (first_status_at - first_send_at) * 1000.0
                if first_send_at is not None and first_status_at is not None
                else None
            ),
            "first_send_to_first_delta": (
                (first_delta_at - first_send_at) * 1000.0
                if first_send_at is not None and first_delta_at is not None
                else None
            ),
            "first_send_to_last_delta": (
                (last_delta_at - first_send_at) * 1000.0
                if first_send_at is not None and last_delta_at is not None
                else None
            ),
            "per_chunk_first_ack_any": _stats(per_chunk_any_latency_ms),
        },
    }

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 3


def _parse_args() -> argparse.Namespace:
    default_base = (
        (os.getenv("TASMEE_BENCH_BASE_URL") or "").strip()
        or (os.getenv("EXPO_PUBLIC_TASMEE_API_URL") or "").strip()
        or "http://127.0.0.1:8080"
    )
    parser = argparse.ArgumentParser(
        description="Measure Tasmee websocket chunk round-trip latency with real audio chunks."
    )
    parser.add_argument("--tasmee-base-url", default=default_base)
    parser.add_argument("--audio", default="sample_2s.wav")
    parser.add_argument("--mime-type", default="audio/wav")
    parser.add_argument("--duration-ms", type=int, default=None)
    parser.add_argument("--page-number", type=int, default=1)
    parser.add_argument("--surah-id", type=int, default=1)
    parser.add_argument("--chunk-ms", type=int, default=300)
    parser.add_argument("--level-db", type=float, default=-30.0)
    parser.add_argument("--has-speech", type=_bool_arg, default=True)
    parser.add_argument("--inter-chunk-delay-ms", type=int, default=100)
    parser.add_argument("--final-wait-ms", type=int, default=2000)
    parser.add_argument(
        "--bearer-token",
        default=(os.getenv("TASMEE_BENCH_BEARER_TOKEN") or "").strip() or None,
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
