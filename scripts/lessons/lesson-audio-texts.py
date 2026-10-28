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
# The browser's own voice must never become a silent fallback (design §7.5).
BROWSER_SPEECH = re.compile(r"speechSynthesis|SpeechSynthesisUtterance")


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
    for p in sorted((root / "apps/lessons/src").rglob("*")):
        if p.suffix in (".ts", ".tsx", ".js", ".jsx", ".html") and p.is_file():
            if BROWSER_SPEECH.search(p.read_text(encoding="utf-8", errors="replace")):
                hits.append(str(p.relative_to(root)))
    return hits


def check(root=ROOT, write=False):
    failures = []
    for key, src, dst in LESSONS:
        want = render(key, src, (root / src).read_bytes())
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
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        (root / "apps/lessons/src/arabic").mkdir(parents=True)
        (root / "apps/lessons/src/arabic/lesson-001.json").write_text(json.dumps(lesson), encoding="utf-8")
        assert check(root), "a missing map passed"
        assert check(root, write=True) == []
        assert check(root) == [], "a fresh map failed"
        (root / "apps/lessons/src/arabic/lesson-001.json").write_text(json.dumps(lesson).replace('"z"', '"zz"'), encoding="utf-8")
        assert any("stale" in f for f in check(root)), "a changed text did not make the map stale"
        check(root, write=True)
        (root / "apps/lessons/src/x.ts").write_text("window.speechSynthesis.speak(u)", encoding="utf-8")
        assert any("speech synthesis" in f for f in check(root)), "browser speech was not refused"
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
