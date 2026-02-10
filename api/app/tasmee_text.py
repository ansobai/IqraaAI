from __future__ import annotations

import re

# Arabic diacritics and Quranic marks.
_TASHKEEL_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]")
_ALEF_RE = re.compile(r"[\u0622\u0623\u0625\u0671]")
_HAMZA_SEAT_RE = re.compile(r"[\u0624\u0626]")
_TATWEEL_RE = re.compile(r"\u0640")
_NON_ARABIC_LETTER_RE = re.compile(r"[^\u0621-\u063A\u0641-\u064A\s]")
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_arabic_text(text: str) -> str:
    if not text:
        return ""

    normalized = text
    normalized = _TASHKEEL_RE.sub("", normalized)
    normalized = _TATWEEL_RE.sub("", normalized)
    normalized = _ALEF_RE.sub("\u0627", normalized)
    normalized = _HAMZA_SEAT_RE.sub("\u0621", normalized)
    normalized = normalized.replace("\u0649", "\u064a")
    normalized = normalized.replace("\u0629", "\u0647")
    normalized = _NON_ARABIC_LETTER_RE.sub(" ", normalized)
    normalized = _WHITESPACE_RE.sub(" ", normalized).strip()
    return normalized


def tokenize_arabic_text(text: str) -> list[str]:
    normalized = normalize_arabic_text(text)
    if not normalized:
        return []
    return [token for token in normalized.split(" ") if token]
