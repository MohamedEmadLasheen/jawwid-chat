# PD-48 · Generating lesson voice-over (operator runbook)

Design: `docs/product/pd048-lesson-voice-over-design.md`. Clips are generated **offline, by an operator, on the operator's machine**. Nothing is synthesized when a child opens a lesson, and the API never calls a vendor or holds a vendor key.

A generated clip is only a **pending** clip. Nobody hears it until two Teachers-department reviewers approve it on the Admin Web **Lesson audio** page. Families hear nothing until the release gate is `all` and the voice's licence, including release gate R-48a for Azure, is recorded in `apps/api/src/lesson-audio/voice-sources.ts`.

**Never Quran.** Only `arabic-NNN` letters lessons are voiced (`tts.py` refuses anything else). Quran recitation is licensed human audio under its own process.

## The loop

```
texts/arabic-001.json --(1) export--> states.json --(2) plan--> worklist.json --(3) generate--> out/ --(4) ingest--> pending clips
                                                                                                                         |
            lexicon/<vendor>.json  <--(6) fix--  rejection reasons  <--(5) two reviewers, Admin Web Lesson audio page ----+
```

1. **Export** the lesson's clip states. This step is read-only; it prints hashes and states, with no text and no URLs:

   ```bash
   node apps/api/dist/cli/ingest-lesson-audio.js --export arabic-001 --organization <org uuid> --target <host:port/db> > states.json
   ```

2. **Plan**. No network, no key, no database:

   ```bash
   python3 -I scripts/lessons/tts/tts.py plan --lesson arabic-001 --profile azure-hamed --export states.json --out worklist.json
   ```

   - Profiles: `azure-hamed`, `azure-zariyah`; fallback `polly-zeina`, `polly-hala`.
   - The plan lists only approved strings that have no pending or approved clip of their current text.
   - It refuses a lesson that is not `arabic-NNN`, any string that carries Quran text (the whole-Quran 4-word index), a profile whose rate is outside 0.85 to 1.0 of normal, and once `apps/api/src/lesson-audio/lesson-voices.json` pins the lesson's ONE voice, any other profile.
   - It skips strings with no audio, and strings that wait for a reviewer's decision (after 3 failed clips).
   - `--only ba-001,ba.name` limits the plan, e.g. for the pilot.

3. **Generate**. This is the only step that talks to the vendor. Put the key in **your shell, for this run only**:

   ```bash
   read -rs JAWWID_TTS_KEY && export JAWWID_TTS_KEY JAWWID_TTS_REGION=<region>
   python3 -I scripts/lessons/tts/tts.py generate --worklist worklist.json --out out/
   unset JAWWID_TTS_KEY
   ```

   - For Polly, use the standard `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_REGION` instead.
   - Never write a key to a file, a `.env`, the repository or a chat.
   - The manifest holds recipes and hashes, never a key.

4. **Ingest**. Dry run first; then `--write`:

   ```bash
   node apps/api/dist/cli/ingest-lesson-audio.js --manifest out/manifest.json
   ```

   ```bash
   node apps/api/dist/cli/ingest-lesson-audio.js --manifest out/manifest.json --write --organization <org uuid> --target <host:port/db>
   ```

   The ingest refuses a clip in any of these cases:
   - its text is not the lesson's approved text as the API was built;
   - its recipe does not hash;
   - its voice is not in `voice-sources.ts`;
   - its file changed;
   - its (text, recipe) pair was ingested before.

   It hashes what storage holds; that hash is what reviewers approve.

5. **Review** happens on the Admin Web, Lesson audio page.
   - Two different people approve each clip, after listening to it to the end.
   - One rejection is final for that clip.
   - Each rejection names a category: vowel, final sukun, shadda, hamza, letter sound, stress, noise, wrong word or other.

6. **Fix and go again.** For a rejected string, add a **reviewed** entry to `lexicon/<vendor>.json`, then plan again: a new recipe is a new clip.

   ```json
   { "vendor": "azure", "entries": {
       "arabic-001/ba-001": { "ssml": "<phoneme alphabet=\"ipa\" ph=\"ba:b\">…</phoneme>", "why": "final sukun dropped (rejection of 2026-11-02)" } } }
   ```

   - An entry is inner SSML only: no `<speak>`, `<voice>` or `<audio>` element.
   - It always says why.
   - After 3 failed clips of a text, a reviewer decides: **no audio** (the word stays silent, with no play button: the owner's rule for lesson 1) or **one more round**.

## What never happens

- No clip plays without two approvals of exactly its bytes for exactly its text.
- No browser speech (`speechSynthesis`) is used. The lessons gate fails on it.
- No clip is replaced in place. A key is the hash of the bytes.
- No vendor key reaches the API, CI, the repository or the lesson.
