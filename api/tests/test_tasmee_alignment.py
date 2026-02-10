from api.app.tasmee_alignment import align_recitation


def test_align_recitation_locks_to_verse_start_only():
    page_words = ["w0", "w1", "w2", "w3", "w4", "w5", "w6", "w7"]
    verse_starts = [0, 4]

    # Mid-verse tokens should not lock anchor.
    mid_verse = align_recitation(
        page_words=page_words,
        verse_start_word_indexes=verse_starts,
        spoken_words=["w2", "w3", "w4"],
        next_word_index=0,
        awaiting_anchor=True,
        min_anchor_words=3,
    )
    assert mid_verse.start_anchor_word_index is None
    assert mid_verse.confirmed_word_indexes == []

    # True verse-start sequence should anchor and confirm contiguous words.
    anchored = align_recitation(
        page_words=page_words,
        verse_start_word_indexes=verse_starts,
        spoken_words=["w4", "w5", "w6"],
        next_word_index=0,
        awaiting_anchor=True,
        min_anchor_words=3,
    )
    assert anchored.start_anchor_word_index == 4
    assert anchored.confirmed_word_indexes == [4, 5, 6]


def test_align_recitation_tracking_is_monotonic_and_contiguous():
    page_words = ["w0", "w1", "w2", "w3", "w4"]

    matched = align_recitation(
        page_words=page_words,
        verse_start_word_indexes=[0],
        spoken_words=["w2", "w3"],
        next_word_index=2,
        awaiting_anchor=False,
        min_anchor_words=3,
    )
    assert matched.start_anchor_word_index is None
    assert matched.confirmed_word_indexes == [2, 3]

    mismatch = align_recitation(
        page_words=page_words,
        verse_start_word_indexes=[0],
        spoken_words=["w1", "w2"],
        next_word_index=2,
        awaiting_anchor=False,
        min_anchor_words=3,
    )
    assert mismatch.confirmed_word_indexes == []
