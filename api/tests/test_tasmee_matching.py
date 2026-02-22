import pytest

from api.app.tasmee_matching import (
    best_reference_prefix_match,
    build_verse_spans,
    find_best_verse_span_match,
    merge_recited_tokens,
)


def test_merge_recited_tokens_dedupes_overlap():
    merged = merge_recited_tokens(
        ["a", "b", "c"],
        ["b", "c", "d"],
        max_overlap=3,
        max_tokens=64,
    )
    assert merged == ["a", "b", "c", "d"]


def test_find_best_verse_span_match_selects_correct_verse_at_90pct():
    verse_1 = [f"w{i}" for i in range(10)]
    verse_2 = [f"a{i}" for i in range(10)]
    page_words = verse_1 + verse_2
    spans = build_verse_spans(len(page_words), [0, len(verse_1)])

    spoken = list(verse_2)
    spoken[5] = "oops"

    start, end, match = find_best_verse_span_match(page_words, spans, spoken, slack=2)
    assert start == len(verse_1)
    assert end == len(page_words)
    assert match.matched_reference_words == 10
    assert match.score == pytest.approx(0.9)


def test_find_best_verse_span_match_does_not_reach_threshold_with_many_errors():
    verse_1 = [f"w{i}" for i in range(10)]
    verse_2 = [f"a{i}" for i in range(10)]
    page_words = verse_1 + verse_2
    spans = build_verse_spans(len(page_words), [0, len(verse_1)])

    spoken = list(verse_2)
    spoken[2] = "oops"
    spoken[7] = "oops2"

    start, end, match = find_best_verse_span_match(page_words, spans, spoken, slack=2)
    assert start == len(verse_1)
    assert end == len(page_words)
    assert match.score == pytest.approx(0.8)


def test_best_reference_prefix_match_handles_large_deletion_drift():
    reference = [f"w{i}" for i in range(20)]
    spoken = [reference[i] for i in [0, 1, 2, 4, 5, 7, 8, 10]]

    match = best_reference_prefix_match(reference, spoken, slack=2)
    assert match.matched_reference_words >= 11
    assert match.score > 0.70


def test_best_reference_prefix_match_handles_large_insertion_drift():
    reference = [f"w{i}" for i in range(20)]
    spoken = [
        "x0",
        reference[0],
        reference[1],
        reference[2],
        "x1",
        reference[3],
        reference[4],
        reference[5],
        reference[6],
        "x2",
        reference[7],
        reference[8],
        reference[9],
        "x3",
    ]

    match = best_reference_prefix_match(reference, spoken, slack=2)
    assert match.matched_reference_words <= 11
    assert match.score > 0.70
