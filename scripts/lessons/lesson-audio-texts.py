#!/usr/bin/env python3
"""PD-48: the lesson text the API serves voice-over for (design §7.3).

The API cannot read apps/lessons at runtime (its image holds apps/api only), so
the text of every reading string a clip may be made for is a GENERATED file in
apps/api: apps/api/src/lesson-audio/texts/<lesson>.json, one entry per string
whose text is itself approved:

  {"id": "ba-001", "kind": "word", "text": "...", "sha256": "<SHA-256 of the exact UTF-8>"}

  - words: only those whose spelling is not held ANYWHERE in the lesson (the
    engine's rule: a spelling flagged in any entry is held everywhere);
  - notes: only those with no review flag;
  - names: every unit's name (a unit's name is its letter's sound).

A clip is served only while its text_sha256 equals this map's, so a text
change in the lesson switches its clip off once this file is regenerated --
and the `check` below fails CI until it is. The text is NEVER normalized here:
the lesson file stores NFC (PD-29's checker refuses anything else) and what is
hashed is exactly what the child sees. Arabic is written as \\u escapes (json
ensure_ascii), so the file never trips G-20.

  python3 -I scripts/lessons/lesson-audio-texts.py write     regenerate
  python3 -I scripts/lessons/lesson-audio-texts.py check     fail if stale (CI); also refuses browser speech in apps/lessons
  python3 -I scripts/lessons/lesson-audio-texts.py selftest  each refusal can fail
"""
import hashlib
import importlib.util
import json
import pathlib
import re
import sys
import tempfile
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[2]
LESSONS = [
    # (lesson key, source file in apps/lessons, generated file in apps/api)
    ("arabic-001", "apps/lessons/src/arabic/lesson-001.json", "apps/api/src/lesson-audio/texts/arabic-001.json"),
]
STRING_ID = re.compile(r"^[a-z][a-z0-9_]*(-[0-9]{3}|\.(name|note))$")
# The browser's own voice must never become a silent fallback (design section 7.5). Any spelling
# of it, anywhere in apps/lessons (review of #254): speechSynthesis, SpeechSynthesisUtterance,
# window['speech' + 'Synthesis'] all carry "synthesis"; webkitSpeech* is the prefixed family.
BROWSER_SPEECH = re.compile(r"synthesi[sz]|webkitspeech", re.I)
SKIP_DIRS = {"node_modules", "dist", "public", ".vite"}

sys.dont_write_bytecode = True  # loading a sibling script must leave no __pycache__ in the tree


def _lesson_content():
    """PD-29's checker (scripts/lessons/check-lesson-content.py): the verified Quran."""
    spec = importlib.util.spec_from_file_location("lesson_content", str(ROOT / "scripts/lessons/check-lesson-content.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --- The rasm skeleton ------------------------------------------------------------------
def shared_rasm():
    """rasm() from scripts/lessons/rasm.py: the ONE fold of every typed-Quran refusal, shared with
    PD-29's check of lesson prose, loaded by path (never from sys.path)."""
    spec = importlib.util.spec_from_file_location("lesson_rasm", str(ROOT / "scripts/lessons/rasm.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.rasm


def quran_index():
    """Every 4-word run of the verified Quran, and every whole shorter ayah of 2+ words, as rasm
    skeletons (rasm, shared with PD-29), over all 114 surahs of the pinned dataset. Returns (grams, the
    run lengths present, the fold), so the lengths are computed once."""
    mod = _lesson_content()
    skeleton = shared_rasm()
    grams = set()
    for verses in mod.verified_surahs().values():
        for v in verses:
            ws = skeleton(v).split()
            if len(ws) < 2:
                continue
            k = min(mod.RUN, len(ws))
            grams.update(tuple(ws[i:i + k]) for i in range(len(ws) - k + 1))
    return grams, frozenset(len(g) for g in grams), skeleton


def typed_quran(text, index):
    """Whether a string carries Quran: Quran recitation is never TTS, so such a string is never voiced."""
    grams, sizes, fold = index
    ws = fold(text).split()
    return any(tuple(ws[i:i + k]) in grams for k in sizes for i in range(len(ws) - k + 1))


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def strings_of(lesson):
    """The approved reading strings of an Arabic letters lesson, in file order."""
    flagged = {w["text"] for u in lesson["units"] for w in u["words"] if w.get("review")}
    out = []
    for u in lesson["units"]:
        out.append({"id": u["id"] + ".name", "kind": "name", "text": u["name"]})
        note = u.get("note")
        if note and not note.get("review"):
            out.append({"id": u["id"] + ".note", "kind": "note", "text": note["text"]})
        for w in u["words"]:
            if w["text"] not in flagged:
                out.append({"id": w["id"], "kind": "word", "text": w["text"]})
    seen = set()
    for s in out:
        if not STRING_ID.match(s["id"]) or s["id"] in seen:
            raise ValueError("bad or duplicate string id: %r" % s["id"])
        if unicodedata.normalize("NFC", s["text"]) != s["text"]:
            raise ValueError("%s is not NFC" % s["id"])
        seen.add(s["id"])
        s["sha256"] = sha(s["text"])
    return out


def render(key, source_rel, source_bytes):
    lesson = json.loads(source_bytes.decode("utf-8"))
    doc = {
        "lesson": key,
        "source": source_rel,
        "sourceSha256": hashlib.sha256(source_bytes).hexdigest(),
        "lessonApproved": lesson["review"]["status"] == "approved",
        "strings": strings_of(lesson),
    }
    return json.dumps(doc, ensure_ascii=True, indent=1) + "\n"


def browser_speech(root):
    hits = []
    for p in sorted((root / "apps/lessons").rglob("*")):
        if not p.is_file() or SKIP_DIRS & set(p.relative_to(root / "apps/lessons").parts) or p.stat().st_size > 2_000_000:
            continue
        if BROWSER_SPEECH.search(p.read_text(encoding="utf-8", errors="replace")):
            hits.append(str(p.relative_to(root)))
    return hits


def check(root=ROOT, write=False, index=None):
    failures = []
    index = index if index is not None else quran_index()
    for key, src, dst in LESSONS:
        want = render(key, src, (root / src).read_bytes())
        quran = [s["id"] for s in json.loads(want)["strings"] if typed_quran(s["text"], index)]
        if quran:
            failures.append("%s: %s carry Quran text; Quran is never voiced (PD-48)" % (dst, ", ".join(quran[:5])))
            continue
        target = root / dst
        if write:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(want, encoding="utf-8")
            continue
        have = target.read_text(encoding="utf-8") if target.exists() else None
        if have != want:
            failures.append("%s is stale: run python3 -I scripts/lessons/lesson-audio-texts.py write" % dst)
    for hit in browser_speech(root):
        failures.append("%s uses the browser's speech synthesis: lesson audio comes only from approved clips (PD-48)" % hit)
    return failures


def selftest():
    w = lambda i, t, r=None: {"id": i, "text": t, "was": None, "review": r}
    lesson = {
        "review": {"status": "pending"},
        "units": [
            {"id": "ba", "name": "b\u064e\u0627\u0621\u0652", "note": {"text": "n", "review": "AUTHORED"},
             "words": [w("ba-001", "x"), w("ba-002", "y", "ADDED TASHKEEL")]},
            {"id": "ta", "name": "t", "note": {"text": "ok", "review": None}, "words": [w("ta-001", "y"), w("ta-002", "z")]},
        ],
    }
    got = [s["id"] for s in strings_of(lesson)]
    assert got == ["ba.name", "ba-001", "ta.name", "ta.note", "ta-002"], got  # y is held everywhere; a held note is out
    assert strings_of(lesson)[0]["sha256"] == sha("b\u064e\u0627\u0621\u0652")
    bad = json.loads(json.dumps(lesson))
    bad["units"][1]["words"][1]["text"] = "\u0628\u0651\u064e"  # shadda before fatha: not NFC
    try:
        strings_of(bad)
        raise AssertionError("a non-NFC text was accepted")
    except ValueError:
        pass
    dup = json.loads(json.dumps(lesson))
    dup["units"][1]["words"][1]["id"] = "ba-001"
    try:
        strings_of(dup)
        raise AssertionError("a duplicate id was accepted")
    except ValueError:
        pass
    # A synthetic Quran index: the run "a b c d" is "Quran" here.
    IDX = ({("a", "b", "c", "d"), ("e", "f")}, frozenset({4, 2}), lambda t: t)
    assert typed_quran("x a b c d y", IDX) and typed_quran("e f", IDX) and not typed_quran("a b c", IDX) and not typed_quran("e", IDX)
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        (root / "apps/lessons/src/arabic").mkdir(parents=True)
        (root / "apps/lessons/src/arabic/lesson-001.json").write_text(json.dumps(lesson), encoding="utf-8")
        assert check(root, index=IDX), "a missing map passed"
        assert check(root, write=True, index=IDX) == []
        assert check(root, index=IDX) == [], "a fresh map failed"
        (root / "apps/lessons/src/arabic/lesson-001.json").write_text(json.dumps(lesson).replace('"z"', '"zz"'), encoding="utf-8")
        assert any("stale" in f for f in check(root, index=IDX)), "a changed text did not make the map stale"
        check(root, write=True, index=IDX)
        for sneaky in ("window.speechSynthesis.speak(u)", "window['speech' + 'Synthesis']", "new webkitSpeechRecognition()"):
            (root / "apps/lessons/src/x.ts").write_text(sneaky, encoding="utf-8")
            assert any("speech synthesis" in f for f in check(root, index=IDX)), "browser speech was not refused: %s" % sneaky
        (root / "apps/lessons/README.md").write_text("speechSynthesis", encoding="utf-8")
        (root / "apps/lessons/src/x.ts").write_text("ok", encoding="utf-8")
        assert any("README.md" in f for f in check(root, index=IDX)), "only src was scanned"
        (root / "apps/lessons/README.md").write_text("ok", encoding="utf-8")
        assert check(root, index=IDX) == []
        quranic = json.loads(json.dumps(lesson))
        quranic["units"][1]["note"]["text"] = "x a b c d"
        (root / "apps/lessons/src/arabic/lesson-001.json").write_text(json.dumps(quranic), encoding="utf-8")
        assert any("carry Quran text" in f for f in check(root, index=IDX)), "typed Quran was not refused"
    # The real Quran, typed in STANDARD spelling (review of #254): the Basmala, Al-Ikhlas, and a
    # two-word ayah (Al-Ikhlas 2) inside a note -- each must be refused. Code points, not typed Arabic.
    real = quran_index()
    u = lambda *cps: "".join(chr(c) for c in cps)
    basmala = " ".join([u(0x628, 0x650, 0x633, 0x652, 0x645, 0x650), u(0x627, 0x644, 0x644, 0x651, 0x64E, 0x647, 0x650),
                        u(0x627, 0x644, 0x631, 0x651, 0x64E, 0x62D, 0x652, 0x645, 0x64E, 0x646, 0x650),
                        u(0x627, 0x644, 0x631, 0x651, 0x64E, 0x62D, 0x650, 0x64A, 0x645, 0x650)])
    allah = u(0x627, 0x644, 0x644, 0x651, 0x64E, 0x647, 0x64F)
    ikhlas_1 = " ".join([u(0x642, 0x64F, 0x644, 0x652), u(0x647, 0x64F, 0x648, 0x64E), allah, u(0x623, 0x64E, 0x62D, 0x64E, 0x62F, 0x64C)])
    samad = u(0x627, 0x644, 0x635, 0x651, 0x64E, 0x645, 0x64E, 0x62F, 0x64F)
    note = " ".join([u(0x642, 0x64E, 0x627, 0x644, 0x64E), u(0x62A, 0x64E, 0x639, 0x64E, 0x627, 0x644, 0x64E, 0x649) + ":", allah, samad])
    salah = " ".join([u(0x648, 0x64E, 0x623, 0x64E, 0x642, 0x650, 0x64A, 0x645, 0x64F, 0x648, 0x627), u(0x627, 0x644, 0x635, 0x651, 0x64E, 0x644, 0x64E, 0x627, 0x629, 0x64E),
                      u(0x648, 0x64E, 0x622, 0x62A, 0x64F, 0x648, 0x627), u(0x627, 0x644, 0x632, 0x651, 0x64E, 0x643, 0x64E, 0x627, 0x629, 0x64E)])
    for name, t in (("the standard Basmala", basmala), ("Al-Ikhlas 1 in standard spelling", ikhlas_1),
                    ("a two-word ayah inside a note", note)):
        assert typed_quran(t, real), "%s was not recognised as Quran" % name
    assert typed_quran(salah, real), "aqimu al-salah wa-atu al-zakah in standard spelling was not recognised as Quran"
    # And ordinary lesson words are not: a word alone, and two words that are no ayah.
    for t in (u(0x628, 0x64E, 0x627, 0x628, 0x652), u(0x643, 0x650, 0x62A, 0x64E, 0x627, 0x628, 0x652) + " " + u(0x628, 0x64E, 0x627, 0x628, 0x652)):
        assert not typed_quran(t, real), "an ordinary lesson string was taken for Quran"
    print("lesson-audio-texts selftest: ok")


def main(argv):
    mode = argv[1] if len(argv) > 1 else "check"
    if mode == "selftest":
        selftest()
        return 0
    if mode not in ("check", "write"):
        print(__doc__)
        return 2
    failures = check(write=(mode == "write"))
    for f in failures:
        print("lesson-audio-texts: " + f)
    if not failures:
        print("lesson-audio-texts: %s" % ("written" if mode == "write" else "every map is current; no browser speech"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
