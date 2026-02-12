from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

VerseSpan = tuple[int, int]


@dataclass(frozen=True)
class PrefixMatch:
    score: float
    matched_reference_words: int


def build_verse_spans(total_words: int, verse_start_word_indexes: Sequence[int]) -> list[VerseSpan]:
    if total_words <= 0:
        return []

    starts = sorted(
        set(index for index in verse_start_word_indexes if 0 <= int(index) < total_words)
    )

    if not starts:
        starts = [0]
    elif 0 not in starts:
        starts.insert(0, 0)

    spans: list[VerseSpan] = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else total_words
        if start < end:
            spans.append((start, end))
    return spans


def merge_recited_tokens(
    buffer_tokens: list[str],
    incoming_tokens: Sequence[str],
    *,
    max_overlap: int = 8,
    max_tokens: int = 64,
) -> list[str]:
    if not incoming_tokens:
        return buffer_tokens

    incoming = list(incoming_tokens)
    if not buffer_tokens:
        merged = incoming
    else:
        overlap_limit = min(max_overlap, len(buffer_tokens), len(incoming))
        overlap = 0
        for k in range(overlap_limit, 0, -1):
            if buffer_tokens[-k:] == incoming[:k]:
                overlap = k
                break
        merged = buffer_tokens + incoming[overlap:]

    if max_tokens > 0 and len(merged) > max_tokens:
        merged = merged[-max_tokens:]
    return merged


def token_levenshtein_distance(left: Sequence[str], right: Sequence[str]) -> int:
    return _token_levenshtein_final_row(left, right)[-1]


def _token_levenshtein_final_row(left: Sequence[str], right: Sequence[str]) -> list[int]:
    if not left:
        return list(range(len(right) + 1))
    if not right:
        return [len(left)]

    previous_row = list(range(len(right) + 1))
    for i, left_token in enumerate(left, start=1):
        current_row = [i]
        for j, right_token in enumerate(right, start=1):
            insert_cost = current_row[j - 1] + 1
            delete_cost = previous_row[j] + 1
            substitute_cost = previous_row[j - 1] + (0 if left_token == right_token else 1)
            current_row.append(min(insert_cost, delete_cost, substitute_cost))
        previous_row = current_row

    return previous_row


def match_score(left: Sequence[str], right: Sequence[str]) -> float:
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0

    dist = token_levenshtein_distance(left, right)
    denom = max(len(left), len(right))
    if denom <= 0:
        return 0.0
    return max(0.0, 1.0 - (dist / denom))


def best_reference_prefix_match(
    reference_words: Sequence[str],
    spoken_words: Sequence[str],
    *,
    slack: int = 2,
) -> PrefixMatch:
    if not reference_words or not spoken_words:
        return PrefixMatch(score=0.0, matched_reference_words=0)

    _ = slack  # Signature compatibility with previous caller contract.
    spoken_len = len(spoken_words)
    final_row = _token_levenshtein_final_row(spoken_words, reference_words)

    best_score = 0.0
    best_k = 0
    for k in range(1, len(reference_words) + 1):
        dist = final_row[k]
        denom = max(spoken_len, k)
        if denom <= 0:
            continue
        score = max(0.0, 1.0 - (dist / denom))
        if score > best_score or (score == best_score and k > best_k):
            best_score = score
            best_k = k

    return PrefixMatch(score=best_score, matched_reference_words=best_k)


def find_best_verse_span_match(
    page_words: Sequence[str],
    verse_spans: Sequence[VerseSpan],
    spoken_words: Sequence[str],
    *,
    slack: int = 2,
) -> tuple[int | None, int | None, PrefixMatch]:
    if not page_words or not spoken_words:
        return None, None, PrefixMatch(score=0.0, matched_reference_words=0)

    spans = list(verse_spans) if verse_spans else [(0, len(page_words))]

    best_start: int | None = None
    best_end: int | None = None
    best = PrefixMatch(score=0.0, matched_reference_words=0)

    for start, end in spans:
        if start < 0 or end <= start or start >= len(page_words):
            continue
        reference = page_words[start:end]
        candidate = best_reference_prefix_match(reference, spoken_words, slack=slack)
        if candidate.score > best.score or (
            candidate.score == best.score
            and candidate.matched_reference_words > best.matched_reference_words
        ):
            best_start = start
            best_end = min(end, len(page_words))
            best = candidate

    return best_start, best_end, best
