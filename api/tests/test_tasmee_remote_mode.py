import base64
from typing import Callable

from fastapi.testclient import TestClient

from api.app.tasmee_engine import BaseTasmeeRecognizer, ChunkRecognitionInput, ChunkRecognitionResult
from api.app.tasmee_main import create_app
from api.app.tasmee_matching import build_verse_spans
from api.app.tasmee_page_lexicon import load_page_lexicon


class ScriptedTokenRecognizer(BaseTasmeeRecognizer):
    def __init__(self, seed_to_tokens: dict[int, list[str]]):
        self._seed_to_tokens = seed_to_tokens

    def analyze_chunk(self, payload: ChunkRecognitionInput) -> ChunkRecognitionResult:
        seed = payload.audio_bytes[0] if payload.audio_bytes else 0
        tokens = self._seed_to_tokens.get(seed, [])
        return ChunkRecognitionResult(
            has_speech=True,
            confidence=1.0,
            level_db=float(payload.level_db or -34.0),
            confirmed_word_indexes=[],
            transcript=None,
            recognized_tokens=tokens,
        )


def _chunk_payload(
    *,
    seq: int,
    seed: int,
    level_db: float = -34.0,
    has_speech: bool = True,
) -> dict:
    audio = bytes([seed] * 512)
    return {
        "seq": seq,
        "audio_base64": base64.b64encode(audio).decode("ascii"),
        "mime_type": "audio/mp4",
        "duration_ms": 300,
        "level_db": level_db,
        "has_speech": has_speech,
    }


def _receive_json_until(websocket, predicate: Callable[[dict], bool], max_messages: int = 24):
    for _ in range(max_messages):
        payload = websocket.receive_json()
        if predicate(payload):
            return payload
    raise AssertionError("Expected websocket event was not received")


def _pick_unique_verse_prefix(
    page_words: list[str],
    verse_spans: list[tuple[int, int]],
    *,
    prefix_len: int = 5,
    min_words: int = 9,
) -> tuple[int, int, list[str], list[str]]:
    candidates: dict[tuple[str, ...], list[tuple[int, int]]] = {}
    for start, end in verse_spans:
        verse = page_words[start:end]
        if len(verse) < min_words or len(verse) < prefix_len:
            continue
        prefix = tuple(verse[:prefix_len])
        candidates.setdefault(prefix, []).append((start, end))

    for prefix, spans in candidates.items():
        if len(spans) == 1:
            start, end = spans[0]
            verse_words = page_words[start:end]
            return start, end, list(prefix), verse_words

    for start, end in verse_spans:
        verse_words = page_words[start:end]
        if len(verse_words) >= min_words and len(verse_words) >= prefix_len:
            return start, end, verse_words[:prefix_len], verse_words

    raise AssertionError("No suitable verse span found on selected page")


def _find_mid_page_anchor_candidate(
    *,
    min_tail_words: int = 90,
    min_verse_words: int = 6,
    max_verse_words: int = 40,
    prefix_len: int = 5,
) -> tuple[int, list[str], int, int]:
    for page_number in range(1, 605):
        lexicon = load_page_lexicon(page_number)
        if not lexicon.words:
            continue

        verse_spans = build_verse_spans(len(lexicon.words), lexicon.verse_start_word_indexes)
        if len(verse_spans) < 2:
            continue

        for start, end in verse_spans:
            verse_words = lexicon.words[start:end]
            if start <= 0:
                continue
            if len(lexicon.words) - start < min_tail_words:
                continue
            if len(verse_words) < min_verse_words or len(verse_words) > max_verse_words:
                continue
            if len(verse_words) < prefix_len:
                continue

            prefix = tuple(verse_words[:prefix_len])
            matching_prefixes = 0
            for other_start, other_end in verse_spans:
                other_words = lexicon.words[other_start:other_end]
                if len(other_words) >= prefix_len and tuple(other_words[:prefix_len]) == prefix:
                    matching_prefixes += 1
                    if matching_prefixes > 1:
                        break

            if matching_prefixes == 1:
                return page_number, lexicon.words, start, end

    raise AssertionError("No suitable mid-page anchor candidate found")


def test_remote_mode_emits_delta_after_anchor_and_tracks_word_by_word():
    page_number = 1
    lexicon = load_page_lexicon(page_number)
    assert lexicon.words, "Test expects mushaf page words to be available"
    verse_spans = build_verse_spans(len(lexicon.words), lexicon.verse_start_word_indexes)
    assert verse_spans, "Test expects verse spans on the mushaf page"

    verse_start, verse_end, _, verse_words = _pick_unique_verse_prefix(
        lexicon.words,
        verse_spans,
        prefix_len=5,
        min_words=9,
    )
    assert verse_end > verse_start

    first_tokens = verse_words[:5]
    second_tokens = verse_words[:7]

    recognizer = ScriptedTokenRecognizer(
        {
            1: first_tokens,
            2: second_tokens,
        }
    )
    app = create_app(
        recognizer_mode_override="remote",
        recognizer_override=recognizer,
    )

    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": page_number, "surah_id": 1})
        assert created.status_code == 200
        session_id = created.json()["session_id"]

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            websocket.receive_json()

            uploaded = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=1, seed=1),
            )
            assert uploaded.status_code == 200
            assert uploaded.json()["accepted"] is True

            delta_1 = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "feedback.delta" and payload.get("seq_ack") == 1,
            )
            assert delta_1["start_anchor_word_index"] == verse_start
            assert delta_1["confidence"] >= 0.9
            assert delta_1["confirmed_word_indexes"] == list(range(verse_start, verse_start + 5))

            uploaded_2 = client.post(
                f"/v1/tasmee/sessions/{session_id}/chunks",
                json=_chunk_payload(seq=2, seed=2),
            )
            assert uploaded_2.status_code == 200
            assert uploaded_2.json()["accepted"] is True

            delta_2 = _receive_json_until(
                websocket,
                lambda payload: payload.get("type") == "feedback.delta" and payload.get("seq_ack") == 2,
            )
            assert "start_anchor_word_index" not in delta_2
            assert delta_2["confidence"] >= 0.9
            assert delta_2["confirmed_word_indexes"] == list(range(verse_start + 5, verse_start + 7))


def test_remote_mode_continues_tracking_to_page_tail_and_past_word_64():
    page_number, page_words, verse_start, verse_end = _find_mid_page_anchor_candidate(
        min_tail_words=90,
        min_verse_words=6,
        max_verse_words=40,
    )
    anchored_tail = page_words[verse_start:]
    target_words = min(90, len(anchored_tail))
    assert target_words >= 70

    chunk_size = 5
    seed_to_tokens: dict[int, list[str]] = {}
    seq = 1
    for offset in range(0, target_words, chunk_size):
        seed_to_tokens[seq] = anchored_tail[offset : min(offset + chunk_size, target_words)]
        seq += 1
    total_chunks = seq - 1

    recognizer = ScriptedTokenRecognizer(seed_to_tokens)
    app = create_app(
        recognizer_mode_override="remote",
        recognizer_override=recognizer,
    )

    with TestClient(app) as client:
        created = client.post("/v1/tasmee/sessions", json={"page_number": page_number, "surah_id": 1})
        assert created.status_code == 200
        session_id = created.json()["session_id"]

        max_confirmed_index = -1
        crossed_anchor_verse_end = False
        start_anchor_index_from_delta: int | None = None

        with client.websocket_connect(f"/v1/tasmee/ws?session_id={session_id}") as websocket:
            websocket.receive_json()

            for current_seq in range(1, total_chunks + 1):
                uploaded = client.post(
                    f"/v1/tasmee/sessions/{session_id}/chunks",
                    json=_chunk_payload(seq=current_seq, seed=current_seq),
                )
                assert uploaded.status_code == 200
                assert uploaded.json()["accepted"] is True

                delta = _receive_json_until(
                    websocket,
                    lambda payload: payload.get("type") == "feedback.delta"
                    and payload.get("seq_ack") == current_seq,
                    max_messages=48,
                )
                confirmed_word_indexes = delta.get("confirmed_word_indexes") or []
                assert confirmed_word_indexes

                start_anchor_value = delta.get("start_anchor_word_index")
                if start_anchor_value is not None:
                    start_anchor_index_from_delta = int(start_anchor_value)

                max_confirmed_index = max(max_confirmed_index, max(confirmed_word_indexes))
                if max_confirmed_index >= verse_end:
                    crossed_anchor_verse_end = True

        assert start_anchor_index_from_delta == verse_start
        assert crossed_anchor_verse_end is True
        assert max_confirmed_index > 64

        expected_last_index = verse_start + target_words - 1
        assert max_confirmed_index >= expected_last_index - 2

