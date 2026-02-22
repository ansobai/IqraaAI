from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AlignmentResult:
    confirmed_word_indexes: list[int]
    start_anchor_word_index: int | None = None


def _contiguous_prefix_match(reference_words: list[str], spoken_words: list[str]) -> int:
    matched = 0
    limit = min(len(reference_words), len(spoken_words))
    while matched < limit:
        if reference_words[matched] != spoken_words[matched]:
            break
        matched += 1
    return matched


def _find_anchor(
    page_words: list[str],
    verse_start_word_indexes: list[int],
    spoken_words: list[str],
    min_anchor_words: int,
) -> tuple[int | None, int]:
    if not spoken_words or len(spoken_words) < min_anchor_words:
        return None, 0

    for anchor_index in verse_start_word_indexes:
        if anchor_index < 0 or anchor_index >= len(page_words):
            continue
        matched = _contiguous_prefix_match(page_words[anchor_index:], spoken_words)
        if matched >= min_anchor_words:
            return anchor_index, matched

    return None, 0


def align_recitation(
    page_words: list[str],
    verse_start_word_indexes: list[int],
    spoken_words: list[str],
    next_word_index: int,
    awaiting_anchor: bool,
    min_anchor_words: int = 3,
) -> AlignmentResult:
    if not page_words or not spoken_words:
        return AlignmentResult(confirmed_word_indexes=[])

    if awaiting_anchor:
        anchor_index, matched = _find_anchor(
            page_words=page_words,
            verse_start_word_indexes=verse_start_word_indexes,
            spoken_words=spoken_words,
            min_anchor_words=min_anchor_words,
        )
        if anchor_index is None or matched <= 0:
            return AlignmentResult(confirmed_word_indexes=[])

        confirmed_end = min(len(page_words), anchor_index + matched)
        confirmed = list(range(anchor_index, confirmed_end))
        return AlignmentResult(
            confirmed_word_indexes=confirmed,
            start_anchor_word_index=anchor_index,
        )

    if next_word_index < 0 or next_word_index >= len(page_words):
        return AlignmentResult(confirmed_word_indexes=[])

    matched = _contiguous_prefix_match(page_words[next_word_index:], spoken_words)
    if matched <= 0:
        return AlignmentResult(confirmed_word_indexes=[])

    confirmed_end = min(len(page_words), next_word_index + matched)
    confirmed = list(range(next_word_index, confirmed_end))
    return AlignmentResult(confirmed_word_indexes=confirmed)
