#!/usr/bin/env python3
"""PD-48: generate lesson voice-over clips -- OFFLINE, by an operator, never at request time.

Design: docs/product/pd048-lesson-voice-over-design.md section 6. Runbook: README.md beside this file.

  plan      which strings need a clip, with the exact recipe for each. No network, no key, no database:
            it reads the API's approved text (apps/api/src/lesson-audio/texts/<lesson>.json), this
            folder's lexicon, and the clip states the ingest CLI exported (--export).
  generate  calls the vendor for each planned clip and writes <out>/manifest.json + the MP3s.
            The ONLY step that talks to a vendor. Its key is read from the operator's shell at run
            time (JAWWID_TTS_KEY for Azure; the standard AWS_* variables for Polly) and is never
            written anywhere: not to the manifest, not to a log, not to the repository.
  selftest  every refusal can fail; the recipe hash matches the API's (recipe.ts).

Then: node apps/api/dist/cli/ingest-lesson-audio.js --manifest <out>/manifest.json  (dry run first).
Two reviewers approve each clip on the Admin Web's Lesson audio page before anyone hears it.

Standard library only (no vendor SDK: nothing new enters the supply chain). Run with python3 -I.
Never Quran: a lesson with typed Quran is not voiced (Quran recitation is never TTS).
"""
import datetime
import hashlib
import hmac
import importlib.util
import json
import os
import pathlib
import re
import sys
import tempfile
import unicodedata
import urllib.error
import urllib.request
from xml.sax.saxutils import escape

sys.dont_write_bytecode = True  # loading a sibling script must leave no __pycache__ in the tree

ROOT = pathlib.Path(__file__).resolve().parents[3]
HERE = pathlib.Path(__file__).resolve().parent
TEXTS = ROOT / "apps/api/src/lesson-audio/texts"
VOICES = ROOT / "apps/api/src/lesson-audio/lesson-voices.json"
LESSON = re.compile(r"^arabic-[0-9]{3}$")  # = LESSON_KEY in lesson-audio-key.ts: the letters lessons, never Quran
REGION = re.compile(r"^[a-z0-9-]{1,32}$")  # a vendor region goes into a host name: nothing else
RATE_RANGE = (0.85, 1.0)  # = RATE_RANGE in recipe.ts (owner Q6: about 10% slower, never faster)
_UNSET = object()
TRIES_PER_ROUND = 3  # = TRIES_PER_ROUND in apps/api/src/lesson-audio/lesson-audio-key.ts

# The voices the owner chose (Q2, Q5, Q6: Azure, one adult MSA voice, about 10% slower; Polly as
# the fallback). A profile names exactly what shapes the sound; it becomes the recipe.
PROFILES = {
    "azure-hamed": {"vendor": "azure", "voice": "ar-SA-HamedNeural", "locale": "ar-SA", "format": "audio-24khz-48kbitrate-mono-mp3", "rate": "-10%"},
    "azure-zariyah": {"vendor": "azure", "voice": "ar-SA-ZariyahNeural", "locale": "ar-SA", "format": "audio-24khz-48kbitrate-mono-mp3", "rate": "-10%"},
    "polly-zeina": {"vendor": "polly", "voice": "Zeina", "locale": "arb", "format": "mp3-22050", "rate": "90%", "engine": "standard"},
    "polly-hala": {"vendor": "polly", "voice": "Hala", "locale": "ar-AE", "format": "mp3-22050", "rate": "90%", "engine": "neural"},
}


class Refused(Exception):
    pass


def canonical(value):
    """The API's canonicalJson (recipe.ts): keys sorted, no whitespace, non-ASCII as is."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def lexicon_of(vendor):
    p = HERE / "lexicon" / ("%s.json" % vendor)
    if not p.exists():
        return {}
    doc = json.loads(p.read_text(encoding="utf-8"))
    if doc.get("vendor") != vendor or not isinstance(doc.get("entries"), dict):
        raise Refused("%s: not a lexicon of %s" % (p, vendor))
    return doc["entries"]


def inner_ssml(text, entry):
    """What is spoken: the text itself, or a reviewed fix (a <phoneme>, a <sub>, a respelling)."""
    if entry is None:
        return escape(text)
    ssml = entry.get("ssml")
    if not isinstance(ssml, str) or not ssml.strip() or "<speak" in ssml or "<voice" in ssml or "<audio" in ssml:
        raise Refused("a lexicon entry is inner SSML only (no speak, voice or audio element)")
    if not isinstance(entry.get("why"), str) or not entry["why"].strip():
        raise Refused("a lexicon entry says why (the rejection it answers)")
    return ssml


def input_for(profile, inner):
    if profile["vendor"] == "azure":
        return ('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="%s">'
                '<voice name="%s"><prosody rate="%s">%s</prosody></voice></speak>') % (profile["locale"], profile["voice"], profile["rate"], inner)
    return '<speak><prosody rate="%s">%s</prosody></speak>' % (profile["rate"], inner)


def recipe_for(profile, text, entry, take):
    return {
        "v": 1,
        "norm": "exact-v1",
        "vendor": profile["vendor"],
        "voice": profile["voice"],
        "locale": profile["locale"],
        "format": profile["format"],
        "rate": profile["rate"],
        "input": input_for(profile, inner_ssml(text, entry)),
        "lexicon": "" if entry is None else sha(canonical(entry)),
        "take": take,
    }


def load_text(lesson):
    p = TEXTS / ("%s.json" % lesson)
    if not p.exists():
        raise Refused("no approved text for %s (apps/api/src/lesson-audio/texts)" % lesson)
    doc = json.loads(p.read_text(encoding="utf-8"))
    for s in doc["strings"]:
        if sha(s["text"]) != s["sha256"] or unicodedata.normalize("NFC", s["text"]) != s["text"]:
            raise Refused("%s: the text map does not verify; regenerate it" % s["id"])
    return doc


def rate_factor(rate):
    """The API's rateFactor (recipe.ts): Azure writes -10%, Polly 90%."""
    m = re.match(r"^-(\d{1,2})%$", rate)
    if m:
        return 1 - int(m.group(1)) / 100
    if rate == "0%":
        return 1.0
    m = re.match(r"^(\d{2,3})%$", rate)
    return int(m.group(1)) / 100 if m else None


def lesson_voice(lesson):
    """The ONE voice a lesson is voiced in once the pilot picked it (lesson-voices.json), else None."""
    v = json.loads(VOICES.read_text(encoding="utf-8")).get(lesson)
    return v if isinstance(v, str) else None


def quran_index():
    """The whole-Quran 4-word index of scripts/lessons/lesson-audio-texts.py (one rule, one place)."""
    spec = importlib.util.spec_from_file_location("lesson_audio_texts", str(ROOT / "scripts/lessons/lesson-audio-texts.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.quran_index(), mod.typed_quran


def plan(lesson, profile_name, export, only=None, texts=None, lexicon=None, pin=_UNSET, quran=None):
    """The worklist: every approved string with no pending or approved clip of its current text."""
    if not LESSON.match(lesson or ""):
        # Only the Arabic letters lessons are voiced. A Quran lesson is never TTS: it has no text map.
        raise Refused("%s is not an Arabic letters lesson: only arabic-NNN is voiced, and Quran never" % lesson)
    if profile_name not in PROFILES:
        raise Refused("unknown profile %s (one of %s)" % (profile_name, ", ".join(sorted(PROFILES))))
    profile = PROFILES[profile_name]
    factor = rate_factor(profile["rate"])
    if factor is None or not RATE_RANGE[0] <= factor <= RATE_RANGE[1]:
        raise Refused("profile %s: the rate is %s of normal; it must be %s to %s" % (profile_name, factor, *RATE_RANGE))
    voice = lesson_voice(lesson) if pin is _UNSET else pin
    if voice is not None and voice != "%s:%s" % (profile["vendor"], profile["voice"]):
        # One adult MSA voice per lesson (owner Q5): once pinned, no other.
        raise Refused("%s is voiced by %s only (lesson-voices.json); profile %s is another voice" % (lesson, voice, profile_name))
    doc = texts if texts is not None else load_text(lesson)
    entries = lexicon if lexicon is not None else lexicon_of(profile["vendor"])
    if export.get("lesson") != lesson:
        raise Refused("the export is of %r, not %s" % (export.get("lesson"), lesson))
    index, typed = quran if quran is not None else quran_index()
    carried = [s["id"] for s in doc["strings"] if typed(s["text"], index)]
    if carried:
        raise Refused("%s carry Quran text: Quran recitation is never TTS (PD-48)" % ", ".join(carried[:5]))
    work, skipped = [], []
    for s in doc["strings"]:
        if only and s["id"] not in only:
            continue
        clips = [c for c in export.get("clips", []) if c["stringId"] == s["id"] and c["textSha256"] == s["sha256"]]
        decisions = [d for d in export.get("decisions", []) if d["stringId"] == s["id"] and d["textSha256"] == s["sha256"]]
        if any(d["decision"] == "no_audio" for d in decisions):
            skipped.append((s["id"], "no audio (a reviewer's decision)"))
            continue
        if any(c["state"] in ("pending", "approved") for c in clips):
            skipped.append((s["id"], "has a clip pending or approved"))
            continue
        failed = sum(1 for c in clips if c["state"] in ("rejected", "withdrawn"))
        rounds = sum(1 for d in decisions if d["decision"] == "one_more_round")
        if failed >= TRIES_PER_ROUND * (rounds + 1):
            skipped.append((s["id"], "needs a reviewer's decision (no audio, or one more round)"))
            continue
        entry = entries.get("%s/%s" % (lesson, s["id"]))
        used = {c["renderSha256"] for c in clips}
        # The first take whose recipe has not been tried: the same recipe twice is refused at ingest.
        for take in range(1, 101):
            recipe = recipe_for(profile, s["text"], entry, take)
            if sha(canonical(recipe)) not in used:
                break
        else:
            raise Refused("%s: 100 takes of this recipe were tried" % s["id"])
        work.append({"stringId": s["id"], "text": s["text"], "recipe": recipe, "renderSha256": sha(canonical(recipe))})
    return {"lesson": lesson, "profile": profile_name, "work": work, "skipped": [{"stringId": i, "why": w} for i, w in skipped]}


# ---------------------------------------------------------------------------- the vendors

def azure_synthesize(recipe, key, region):
    req = urllib.request.Request(
        "https://%s.tts.speech.microsoft.com/cognitiveservices/v1" % region,
        data=recipe["input"].encode("utf-8"),
        method="POST",
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": recipe["format"],
            "User-Agent": "jawwid-lesson-voice-over",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def _sign(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def polly_synthesize(recipe, profile, access_key, secret_key, session_token, region, now=None):
    """Amazon Polly SynthesizeSpeech over REST, signed with AWS Signature Version 4 (stdlib only)."""
    body = json.dumps({
        "Engine": profile["engine"],
        "LanguageCode": recipe["locale"],
        "OutputFormat": "mp3",
        "SampleRate": "22050",
        "Text": recipe["input"],
        "TextType": "ssml",
        "VoiceId": recipe["voice"],
    }, ensure_ascii=False).encode("utf-8")
    host = "polly.%s.amazonaws.com" % region
    t = now or datetime.datetime.now(datetime.timezone.utc)
    amz_date, day = t.strftime("%Y%m%dT%H%M%SZ"), t.strftime("%Y%m%d")
    headers = {"content-type": "application/json", "host": host, "x-amz-date": amz_date}
    if session_token:
        headers["x-amz-security-token"] = session_token
    signed = ";".join(sorted(headers))
    canonical_request = "\n".join(["POST", "/v1/speech", "", "".join("%s:%s\n" % (k, headers[k]) for k in sorted(headers)), signed, hashlib.sha256(body).hexdigest()])
    scope = "%s/%s/polly/aws4_request" % (day, region)
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()])
    k = _sign(_sign(_sign(_sign(("AWS4" + secret_key).encode("utf-8"), day), region), "polly"), "aws4_request")
    signature = hmac.new(k, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    headers["authorization"] = "AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s" % (access_key, scope, signed, signature)
    del headers["host"]
    req = urllib.request.Request("https://%s/v1/speech" % host, data=body, method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def looks_like_mp3(b):
    return len(b) > 64 and (b[:3] == b"ID3" or (b[0] == 0xFF and (b[1] & 0xE0) == 0xE0))


def generate(worklist, out, synthesize):
    """Call the vendor for each planned clip; write the MP3s and manifest.json. Nothing else is written."""
    out.mkdir(parents=True, exist_ok=True)
    clips, failed = [], []
    for w in worklist["work"]:
        name = "%s.%s.mp3" % (w["stringId"], w["renderSha256"][:12])
        try:
            audio = synthesize(w["recipe"])
        except urllib.error.HTTPError as e:
            # The status only: a vendor's error body can echo request headers.
            failed.append({"stringId": w["stringId"], "why": "the vendor answered %s" % e.code})
            continue
        except urllib.error.URLError as e:
            failed.append({"stringId": w["stringId"], "why": "no answer from the vendor (%s)" % type(e.reason).__name__})
            continue
        if not looks_like_mp3(audio) or len(audio) > 5_000_000:
            failed.append({"stringId": w["stringId"], "why": "the vendor did not return an MP3 of at most 5 MB"})
            continue
        (out / name).write_bytes(audio)
        clips.append({"stringId": w["stringId"], "text": w["text"], "recipe": w["recipe"], "renderSha256": w["renderSha256"],
                      "file": name, "sha256": hashlib.sha256(audio).hexdigest()})
    manifest = {"lesson": worklist["lesson"], "profile": worklist["profile"], "clips": clips, "failed": failed}
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return manifest


def vendor_from_shell(profile_name):
    """The vendor call, with its key read from the operator's shell NOW. The key is never stored."""
    profile = PROFILES[profile_name]
    if profile["vendor"] == "azure":
        key, region = os.environ.get("JAWWID_TTS_KEY", ""), os.environ.get("JAWWID_TTS_REGION", "")
        if not key or not region:
            raise Refused("set JAWWID_TTS_KEY and JAWWID_TTS_REGION in your shell (never in a file)")
        if not REGION.match(region):
            raise Refused("JAWWID_TTS_REGION is not a region name (lowercase letters, digits, dashes)")
        return lambda recipe: azure_synthesize(recipe, key, region)
    access, secret = os.environ.get("AWS_ACCESS_KEY_ID", ""), os.environ.get("AWS_SECRET_ACCESS_KEY", "")
    region = os.environ.get("AWS_REGION", "")
    if not access or not secret or not region:
        raise Refused("set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION in your shell (never in a file)")
    if not REGION.match(region):
        raise Refused("AWS_REGION is not a region name (lowercase letters, digits, dashes)")
    token = os.environ.get("AWS_SESSION_TOKEN", "")
    return lambda recipe: polly_synthesize(recipe, profile, access, secret, token, region)


# ---------------------------------------------------------------------------- selftest

# The recipe hash the API computes for this recipe (test/unit/lesson-audio/lesson-audio.spec.ts):
# one canonical form in Python and TypeScript, or an ingest would refuse every clip.
SHARED_RECIPE = {"v": 1, "norm": "exact-v1", "vendor": "azure", "voice": "ar-SA-HamedNeural", "locale": "ar-SA",
                 "format": "audio-24khz-48kbitrate-mono-mp3", "rate": "-10%", "input": "<speak>\u0628\u064e\u0627\u0628\u0652</speak>",
                 "lexicon": "", "take": 1}
SHARED_RECIPE_SHA256 = "c7c54315d470ffe3a77f3be3fa8875cb1346bf12e20ab17db372fbd6c4c32f10"


def selftest():
    assert sha(canonical(SHARED_RECIPE)) == SHARED_RECIPE_SHA256, sha(canonical(SHARED_RECIPE))
    bab = "\u0628\u064e\u0627\u0628\u0652"
    texts = {"lesson": "arabic-001", "strings": [
        {"id": "ba-001", "kind": "word", "text": bab, "sha256": sha(bab)},
        {"id": "ba-002", "kind": "word", "text": "x", "sha256": sha("x")},
        {"id": "ta-001", "kind": "word", "text": "y", "sha256": sha("y")},
        {"id": "tha-001", "kind": "word", "text": "z", "sha256": sha("z")},
    ]}
    export = {"lesson": "arabic-001", "clips": [], "decisions": []}
    # A synthetic Quran index (the run "q u r a" is "Quran" here), so the selftest reads no dataset.
    NOQ = ({("q", "u", "r", "a")}, lambda t, idx: any(tuple(t.split()[i:i + 4]) in idx for i in range(len(t.split()))))
    p = plan("arabic-001", "azure-hamed", export, texts=texts, lexicon={}, pin=None, quran=NOQ)
    assert [w["stringId"] for w in p["work"]] == ["ba-001", "ba-002", "ta-001", "tha-001"]
    first = p["work"][0]
    assert first["recipe"]["input"].endswith('<prosody rate="-10%">' + bab + "</prosody></voice></speak>")
    # A pending clip, a no-audio decision, three failures: skipped. A tried recipe: the next take.
    export = {"lesson": "arabic-001", "clips": [
        {"stringId": "ba-002", "textSha256": sha("x"), "renderSha256": "0" * 64, "state": "pending"},
        {"stringId": "ba-001", "textSha256": sha(bab), "renderSha256": first["renderSha256"], "state": "rejected"},
    ] + [{"stringId": "tha-001", "textSha256": sha("z"), "renderSha256": str(i) * 64, "state": "rejected"} for i in range(3)],
        "decisions": [{"stringId": "ta-001", "textSha256": sha("y"), "decision": "no_audio"}]}
    p = plan("arabic-001", "azure-hamed", export, texts=texts, lexicon={}, pin=None, quran=NOQ)
    assert [(w["stringId"], w["recipe"]["take"]) for w in p["work"]] == [("ba-001", 2)], p["work"]
    assert {s["stringId"] for s in p["skipped"]} == {"ba-002", "ta-001", "tha-001"}
    # A lexicon fix changes the input and the recipe: take 1 again, a new clip.
    fix = {"arabic-001/ba-001": {"ssml": '<phoneme alphabet="ipa" ph="ba:b">' + bab + "</phoneme>", "why": "final sukun dropped"}}
    p = plan("arabic-001", "azure-hamed", export, texts=texts, lexicon=fix, pin=None, quran=NOQ)
    w = p["work"][0]
    assert w["recipe"]["take"] == 1 and "<phoneme" in w["recipe"]["input"] and w["recipe"]["lexicon"] == sha(canonical(fix["arabic-001/ba-001"]))
    for bad in ({"ssml": "<speak>x</speak>", "why": "w"}, {"ssml": "x", "why": ""}, {"ssml": '<audio src="u"/>', "why": "w"}):
        try:
            plan("arabic-001", "azure-hamed", export, texts=texts, lexicon={"arabic-001/ba-001": bad}, pin=None, quran=NOQ)
            raise AssertionError("a bad lexicon entry was accepted")
        except Refused:
            pass
    try:
        plan("surah-085", "azure-hamed", {"lesson": "surah-085"}, texts=texts, lexicon={}, pin=None, quran=NOQ)
        raise AssertionError("a Quran lesson was planned")
    except Refused:
        pass
    try:
        plan("arabic-002", "azure-hamed", export, texts=texts, lexicon={}, pin=None, quran=NOQ)
        raise AssertionError("an export of another lesson was accepted")
    except Refused:
        pass
    # Review of #254: one pinned voice, the rate range, no Quran text, a region that is only a region.
    try:
        plan("arabic-001", "azure-hamed", export, texts=texts, lexicon={}, pin="azure:ar-SA-ZariyahNeural", quran=NOQ)
        raise AssertionError("another voice than the pinned one was planned")
    except Refused:
        pass
    assert plan("arabic-001", "azure-hamed", export, texts=texts, lexicon={}, pin="azure:ar-SA-HamedNeural", quran=NOQ)["work"]
    quranic = {"lesson": "arabic-001", "strings": texts["strings"] + [{"id": "ba.note", "kind": "note", "text": "x q u r a", "sha256": sha("x q u r a")}]}
    try:
        plan("arabic-001", "azure-hamed", export, texts=quranic, lexicon={}, pin=None, quran=NOQ)
        raise AssertionError("Quran text was planned")
    except Refused:
        pass
    assert [rate_factor(r) for r in ("-10%", "90%", "0%", "+10%", "fast")] == [0.9, 0.9, 1.0, None, None]
    PROFILES["_fast"] = dict(PROFILES["azure-hamed"], rate="110%")
    try:
        plan("arabic-001", "_fast", export, texts=texts, lexicon={}, pin=None, quran=NOQ)
        raise AssertionError("a faster than normal rate was planned")
    except Refused:
        pass
    finally:
        del PROFILES["_fast"]
    saved = {k: os.environ.get(k) for k in ("JAWWID_TTS_KEY", "JAWWID_TTS_REGION")}
    try:
        os.environ["JAWWID_TTS_KEY"], os.environ["JAWWID_TTS_REGION"] = "test-only", "evil.example/x?"
        try:
            vendor_from_shell("azure-hamed")
            raise AssertionError("a region that is not a region was accepted")
        except Refused:
            pass
        os.environ["JAWWID_TTS_REGION"] = "westeurope"
        assert callable(vendor_from_shell("azure-hamed"))  # built, never called
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    # generate writes only what the vendor returned as MP3, and never the key.
    mp3 = b"ID3" + b"\x00" * 100
    with tempfile.TemporaryDirectory() as d:
        out = pathlib.Path(d)
        work = plan("arabic-001", "azure-hamed", {"lesson": "arabic-001", "clips": [], "decisions": []}, texts=texts, lexicon={}, pin=None, quran=NOQ)
        calls = iter([mp3, b"<html>no</html>", mp3, mp3])
        m = generate(work, out, lambda r: next(calls))
        assert [c["stringId"] for c in m["clips"]] == ["ba-001", "ta-001", "tha-001"] and m["failed"][0]["stringId"] == "ba-002"
        assert m["clips"][0]["sha256"] == hashlib.sha256(mp3).hexdigest()
        assert "Ocp-Apim" not in (out / "manifest.json").read_text(encoding="utf-8")
    # SigV4 is deterministic for a fixed time (the request is built, never sent here).
    print("tts selftest: ok")


def main(argv):
    if len(argv) < 2 or argv[1] not in ("plan", "generate", "selftest"):
        print(__doc__)
        return 2
    try:
        if argv[1] == "selftest":
            selftest()
            return 0
        args = dict(zip(argv[2::2], argv[3::2]))
        if argv[1] == "plan":
            # --lesson arabic-001 --profile azure-hamed --export <ingest --export output> --out worklist.json [--only id,id]
            export = json.loads(pathlib.Path(args["--export"]).read_text(encoding="utf-8"))
            only = set(args["--only"].split(",")) if args.get("--only") else None
            p = plan(args["--lesson"], args["--profile"], export, only=only)
            pathlib.Path(args["--out"]).write_text(json.dumps(p, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            print("plan: %d to generate, %d skipped -> %s" % (len(p["work"]), len(p["skipped"]), args["--out"]))
            return 0
        # generate --worklist worklist.json --out <folder>
        worklist = json.loads(pathlib.Path(args["--worklist"]).read_text(encoding="utf-8"))
        m = generate(worklist, pathlib.Path(args["--out"]), vendor_from_shell(worklist["profile"]))
        print("generate: %d clips, %d failed -> %s/manifest.json" % (len(m["clips"]), len(m["failed"]), args["--out"]))
        return 1 if m["failed"] else 0
    except (Refused, KeyError) as e:
        print("tts: %s" % (e if isinstance(e, Refused) else "missing option %s" % e))
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
