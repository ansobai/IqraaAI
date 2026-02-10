from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .tasmee_text import normalize_arabic_text


@dataclass(frozen=True)
class PageLexicon:
    page_number: int
    words: list[str]
    verse_start_word_indexes: list[int]


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _candidate_page_paths(page_number: int) -> list[Path]:
    filename = f"page-{page_number:03d}.txt"
    root = _repo_root()
    return [
        root / "assets" / "data" / "mushaf-lines" / "pages" / filename,
        root / "api" / "assets" / "data" / "mushaf-lines" / "pages" / filename,
    ]


@lru_cache(maxsize=700)
def load_page_lexicon(page_number: int) -> PageLexicon:
    if page_number < 1 or page_number > 604:
        return PageLexicon(
            page_number=page_number,
            words=[],
            verse_start_word_indexes=[],
        )

    page_path = next((p for p in _candidate_page_paths(page_number) if p.exists()), None)
    if page_path is None:
        return PageLexicon(
            page_number=page_number,
            words=[],
            verse_start_word_indexes=[],
        )

    payload = json.loads(page_path.read_text(encoding="utf-8"))
    lines = payload.get("lines") or []

    words: list[str] = []
    verse_starts: list[int] = []
    expect_verse_start = True

    for line in sorted(lines, key=lambda item: int(item.get("lineNumber", 0))):
        for token in line.get("words") or []:
            char_type = str(token.get("charType") or "")
            text = str(token.get("text") or "")

            if char_type == "word":
                normalized = normalize_arabic_text(text)
                if not normalized:
                    continue

                word_index = len(words)
                if expect_verse_start:
                    verse_starts.append(word_index)
                    expect_verse_start = False

                words.append(normalized)
                continue

            if char_type == "end":
                expect_verse_start = True

    if words and 0 not in verse_starts:
        verse_starts.insert(0, 0)

    deduped_starts = sorted(set(index for index in verse_starts if 0 <= index < len(words)))
    return PageLexicon(
        page_number=page_number,
        words=words,
        verse_start_word_indexes=deduped_starts,
    )
