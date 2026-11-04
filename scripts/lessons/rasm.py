#!/usr/bin/env python3
"""The rasm skeleton: the ONE fold for telling whether a string carries Quran text.

Tanzil's Uthmani text and a lesson's standard spelling differ mostly in alef and
hamza forms and small marks, so both sides are folded to the letter skeleton
before comparing. Used by every typed-Quran refusal:
  * scripts/lessons/check-lesson-content.py (Quran typed into lesson prose);
  * scripts/lessons/lesson-audio-texts.py (PD-48: Quran is never voiced by TTS).
It is NOT the verbatim fold that positions rely on (check-lesson-content.fold).

    python3 -I scripts/lessons/rasm.py selftest     the shared fixtures, against the verified Quran

Standard library only. Loaded by path (importlib), never from sys.path.
"""
import importlib.util
import os
import sys
import unicodedata

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))

# The rasm skeleton both sides are folded to (review of #254): Tanzil's Uthmani text and a
# lesson's standard spelling differ mostly in alef forms -- the dagger alef, maddah and wasla
# (\u0671\u0644\u0631\u064e\u0651\u062d\u0652\u0645\u064e\u0640\u0670\u0646\u0650 against \u0627\u0644\u0631\u064e\u0651\u062d\u0652\u0645\u064e\u0646\u0650), in waw-for-alef (\u0671\u0644\u0635\u064e\u0651\u0644\u064e\u0648\u0670\u0629\u064e against \u0627\u0644\u0635\u064e\u0651\u0644\u064e\u0627\u0629\u064e), and in
# small marks. Written as code points, so no Arabic is typed into this rule.
_MARKS = {c for c in range(0x64B, 0x660)} | {0x670, 0x640} | set(range(0x6D6, 0x6EE))
# Alef in every form, and hamza in every form: the editions seat hamza differently
# (Uthmani wa-<hamza><alef>tu against standard wa-<alef madda>tu, yastahzi'una on the line or on a ya).
_ALEFS = {0x627, 0x623, 0x625, 0x622, 0x671, 0x621, 0x624, 0x626}
_UNIFY = {0x649: 0x64A, 0x629: 0x647}
_WAW_DAGGER = chr(0x648) + chr(0x670)  # Uthmani waw standing for an alef


def rasm(text):
    """A text's letter skeleton: no marks, no alef or hamza of any form, \u0649 as \u064a, \u0629 as \u0647."""
    t = unicodedata.normalize("NFC", text).replace(_WAW_DAGGER, "")
    out = []
    for c in t:
        o = ord(c)
        if o in _MARKS or o in _ALEFS:
            continue
        o = _UNIFY.get(o, o)
        out.append(chr(o) if 0x621 <= o <= 0x64A else " ")
    return " ".join("".join(out).split())


def words(text):
    """rasm() as words, with the vocative joined: Tanzil writes يَٰٓأَيُّهَا / يَٰبُنَىَّ / يَٰقَوْمِ as ONE word
    where standard spelling splits يَا off, and rasm() leaves that يَا as a lone ي. Joining a lone ي to the
    next word gives both spellings one skeleton (يبني, ييه, يقوم). For run-matching only."""
    out = []
    for t in rasm(text).split():
        if out and out[-1] == chr(0x64A):
            out[-1] += t
        else:
            out.append(t)
    return out


PREFIXES = set(chr(c) for c in (0x648, 0x641, 0x628, 0x644))  # و ف ب ل


def edge_forms(word):
    """A run's edge word with and without one prefix letter (و ف ب ل), so «وَرَبِّ زِدْنِي عِلْمًا» meets
    «وَقُل رَّبِّ زِدْنِى عِلْمًا». Only on words of 3+ letters, so a short word never loses its root."""
    return {word, word[1:]} if len(word) >= 3 and word[0] in PREFIXES else {word}


def _u(*cps):
    return ''.join(chr(c) for c in cps)


# The shared fixtures (review of #254 and #260), as code points, so no Arabic is typed into this
# rule: each STANDARD spelling must fold to the same skeleton as the verified Uthmani text.
_ALLAH = _u(0x627, 0x644, 0x644, 0x651, 0x64E, 0x647, 0x64F)
BASMALA = ' '.join([_u(0x628, 0x650, 0x633, 0x652, 0x645, 0x650), _u(0x627, 0x644, 0x644, 0x651, 0x64E, 0x647, 0x650),
                    _u(0x627, 0x644, 0x631, 0x651, 0x64E, 0x62D, 0x652, 0x645, 0x64E, 0x646, 0x650),
                    _u(0x627, 0x644, 0x631, 0x651, 0x64E, 0x62D, 0x650, 0x64A, 0x645, 0x650)])
IKHLAS_1 = ' '.join([_u(0x642, 0x64F, 0x644, 0x652), _u(0x647, 0x64F, 0x648, 0x64E), _ALLAH, _u(0x623, 0x64E, 0x62D, 0x64E, 0x62F, 0x64C)])
IKHLAS_2 = ' '.join([_ALLAH, _u(0x627, 0x644, 0x635, 0x651, 0x64E, 0x645, 0x64E, 0x62F, 0x64F)])
SALAH = _u(0x627, 0x644, 0x635, 0x651, 0x64E, 0x644, 0x64E, 0x627, 0x629, 0x64E)
BAQARAH_43 = ' '.join([_u(0x648, 0x64E, 0x623, 0x64E, 0x642, 0x650, 0x64A, 0x645, 0x64F, 0x648, 0x627), SALAH,
                       _u(0x648, 0x64E, 0x622, 0x62A, 0x64F, 0x648, 0x627), _u(0x627, 0x644, 0x632, 0x651, 0x64E, 0x643, 0x64E, 0x627, 0x629, 0x64E)])
# (standard spelling, surah, ayah, first word, word count) -- word n = n-th space token, as the engine counts.
FIXTURES = [
    ('the standard Basmala', BASMALA, 1, 1, 1, 4),
    ('Al-Ikhlas 1', IKHLAS_1, 112, 1, 1, 4),
    ('Al-Ikhlas 2 (a two-word ayah)', IKHLAS_2, 112, 2, 1, 2),
    ('al-Baqarah 43, its first four words', BAQARAH_43, 2, 43, 1, 4),
    ('al-salah alone (waw + dagger alef)', SALAH, 2, 43, 2, 1),
]
# Ordinary lesson words, which must NOT meet a verse: bab alone, and kitab bab.
NOT_QURAN = [_u(0x628, 0x64E, 0x627, 0x628, 0x652), _u(0x643, 0x650, 0x62A, 0x64E, 0x627, 0x628, 0x652) + ' ' + _u(0x628, 0x64E, 0x627, 0x628, 0x652)]


def selftest(surahs=None):
    """surahs: {n: [verse texts]} from the verified snapshot (built here if not given)."""
    if surahs is None:
        spec = importlib.util.spec_from_file_location('lesson_content', os.path.join(HERE, 'check-lesson-content.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        surahs = mod.verified_surahs()
    failed = []
    for name, standard, s, a, w, n in FIXTURES:
        verse = surahs[s][a - 1].split(' ')
        if rasm(standard) != rasm(' '.join(verse[w - 1:w - 1 + n])):
            failed.append(f'{name}: {rasm(standard)!r} does not meet the verified {rasm(" ".join(verse[w - 1:w - 1 + n]))!r}')
    words = {x for v in surahs.values() for t in v for x in [rasm(t)]}
    for t in NOT_QURAN:
        if rasm(t) in words:
            failed.append(f'{t!r} met a whole verse')
    for f in failed:
        print(f'rasm selftest: FAIL {f}')
    if not failed:
        print(f'rasm selftest: {len(FIXTURES)} standard spellings meet the verified Uthmani text, {len(NOT_QURAN)} ordinary strings do not')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(selftest() if sys.argv[1:] == ['selftest'] else 2)
