# PD-29 P0-5: Arabic lesson 1 (the letters) on the engine, design

Status: **design for review**. No code is written yet. It covers plan row P0-5 and findings #4 (alif vs hamza) and #11 (full tashkeel) of `pd029-materials-quality-plan.md` §B4. The evidence is the static audit `finding-arabic.md` (head's notes folder, `audit/`). The old lesson is jawwid-lessons @ c231532, `src/lessons/arabic/lesson-1`. It was read as text only and is never built or run.

## 1. What the old lesson is, and why this is not an extraction

Lesson 1 is the whole alphabet. It has 34 units: the 28 letters, then ء أ إ ؤ ئ ى and لا. Each unit has its four forms and three lists of 15–25 example words (start, middle, end). The quiz, the 8 games and the memory pairs are all generated from those lists.

P0-4 could copy the Quran lessons' prose as it was. Lesson 1's data cannot be copied as it is:

- **The alif lists are wrong (#4).** All 15 "ا at the start" words begin with **أ**, and they are the same 15 words as the أ unit. A bare ا never begins a word.
- **The hamza is taught backwards.** The ء unit says hamza "never comes at the start of a word". The أ/إ/ؤ/ئ seats appear as five extra "letters" after the alphabet.
- **Words are filed under the wrong position or the wrong letter.** Examples:
  - The إ "end" list is 15 words that *start* with إ.
  - The ؤ "end" list has «سُوء» and «ضَوْء», whose hamza sits on the line, not on a waw.
  - «فِإِنَّ» should be «فَإِنَّ».
- **Some are not words, or are non-standard:** «ظُهُوء», «نُبُوء», «دُرُوء»; «سَمَا» for سَمَاء; «مُوسِيقَا» for مُوسِيقَى.
- **The games and the quiz compare letters in two different ways.** The games fold أ/إ/آ/ٱ into ا; the quiz compares exact characters. So one word "has the letter" in one game and not in another. The ء game cannot be won, and correct quiz answers can be scored wrong.
- **Only 10.9% of the reading strings pass full tashkeel (#11).** Nearly every miss is the final letter (أَسَد, not أَسَدْ / أَسَدٌ).

So P0-5 is a **rewrite as data**. The old words are the starting list. A checker proves every claim that can be proved mechanically, and the Teachers department signs off everything else, as with the Quran lessons.

## 2. The new lesson type

- **Route.** `/lessons/arabic/lesson-1`, the path Chat's materials already store (`pd029-seed/jawwid-lessons-manifest.csv`). `route.ts` gains `{ kind: 'arabic', lesson: n }`. Lessons other than 1 answer "not found" until they are built.
- **Content.** One data file, `apps/lessons/src/arabic/lesson-001.json`, checked in CI by `scripts/lessons/check-arabic-lesson.py` (in the lessons-supply-chain gate) and again in the browser.
  - It is **pending** until the Teachers department approves it. Until then the page shows only "هذا الدرس قيد المراجعة". This is the same fail-closed gate as `resolveContent`: nothing from an unapproved file is shown, and a flagged word or note is never shown.
- **Sections.** Per unit:
  1. the forms (isolated, initial, medial, final);
  2. examples, split into start, middle and end;
  3. find-the-letter, where the child taps the letter in a word;
  4. pick the words that contain the letter.

  Then a final quiz. Stars use the existing `StarLedger`, with its own section list, earned once per section. The per-visit option order comes from `shuffle.ts`.
- **Not carried in P0-5:**
  - writing practice: the old tracing has strokes for only ب/ت/ث, and every other letter used ب's;
  - the memory, speed, bubble and catch games;
  - sound effects.

  Each can be its own later item.

### The data shape

```json
{
  "lesson": 1,
  "review": { "status": "pending", "by": null, "note": "" },
  "provenance": { "source": "jawwid-lessons @ c231532 arabic/lesson-1 (read as text)", "sha256": { "lib/lessonData.ts": "…" } },
  "finalMark": "sukun",
  "units": [
    { "id": "ba", "letters": ["ب"], "name": "بَاءٌ",
      "note": null,
      "words": [ { "text": "بَابْ", "was": "بَاب", "review": "ADDED TASHKEEL: final sukun" } ] },
    { "id": "alif", "letters": ["ا"], "name": "أَلِفٌ",
      "note": { "text": "…", "review": "AUTHORED: teacher to write or approve" },
      "words": [ … ] },
    { "id": "hamza", "letters": ["ء", "أ", "إ", "ؤ", "ئ"], "name": "هَمْزَةٌ", "note": { … }, "words": [ … ] }
  ]
}
```

**Nothing derivable is stored.** A word carries no "start / middle / end" label and no letter tag. The engine and the checker compute both from the word's own letters, using the rule in §4. A word filed under the wrong position cannot exist; a word filed under a unit whose letter it doesn't contain is refused.

## 3. Alif and hamza (#4)

- **The ا unit** teaches ا where it really occurs: in the middle (كِتَابٌ) and at the end (عَصَا). Its "start" tab is replaced by a note that a bare alif never begins a word, and that a word which seems to begin with alif begins with a hamza written on it (أَسَدٌ, إِبْرَةٌ). The note is new text, held for a teacher (AUTHORED).
  - Hamzat al-wasl (ٱ) is out of scope for lesson 1.
- **One Hamza unit**, after the 28 letters, replaces the five separate "extra letters" ء/أ/إ/ؤ/ئ. It teaches one letter, hamza, which is written five ways:
  - on the line (ء);
  - on an alif (أ above, إ below; these are the only ways a word can start with hamza);
  - on a waw (ؤ);
  - on a ya (ئ).
  - Its tabs are by **seat**. The old ا-start words move here, under أ. The old "hamza never starts a word" comment is gone.
- **ى and لا** stay as units. ى is the alif maqsura, at the end only. لا is a two-letter unit: ل followed by ا, matched as a pair, never as one tappable character.
- The seat rules (when hamza sits on which letter) are *not* taught in lesson 1. The unit only shows the five shapes. That is a teacher's call (§6).

## 4. One comparison rule, with no folding

One module, `apps/lessons/src/arabic/letters.ts`, used by every game, the quiz and the examples tabs:

- `lettersOf(word)`: the base letters, after removing **only** the marks U+064B–U+0652 and U+0670 (harakat, tanween, sukun, shadda, dagger alif).
  - No letter is ever replaced: أ, إ, آ, ٱ, ا and ء are six different letters, and ى is not ي.
- `has(word, unit)`: one of the unit's letters occurs in `lettersOf(word)`.
  - For the Hamza unit that is any of its five listed code points. That is the unit's declared letter set, not a fold.
  - For لا, it means the pair ل,ا.
- `positions(word, unit)`: whether a unit letter occurs at the start, in the middle or at the end. This is decided by the letter's place in the word (first, inside, last), not by its glyph form.
- **One fixture, two languages.** `letters.fixture.json` holds the cases: أَسَد has no ا; كِتَاب has ا in the middle; رَأْس has hamza (seat أ) in the middle; سُؤَال has hamza on waw; جُزْء ends in hamza; بِئْر has hamza on ya; لا in لَاعِبٌ.
  - The TypeScript tests and the Python checker both run that fixture, so the browser and CI cannot disagree.

**Quiz and games are proved, not hoped.** For every question the engine can build, the checker proves with the same rule that exactly one option is right. The quiz is fixed in the data ("which word contains …", "where is … in …") rather than drawn at random, so it can be checked. The old quiz's random distractor pools are what scored correct answers wrong.

## 5. Full tashkeel (#11): what is added is listed and held

- **The rule** is the audit's STRICT rule (`tashkeel_coverage.py`), ported into the checker. Every base letter carries a mark, including the final letter and the qamari lam of ال. The only exceptions are: a bare ا, ى, ٱ or آ; a madd و after a damma or a madd ي after a kasra; and the lam of ال before a shadda. The checker refuses a word that fails it.
- **The final mark is one convention for the whole lesson** (`finalMark`). It is a teacher decision (§6):
  - **(a) pausal sukun (أَسَدْ)**, how a child reads the word aloud on its own. **Recommended.**
  - (b) the citation form with tanween (أَسَدٌ).
- **Every mark the rebuild adds is visible.** For each word the extractor keeps the old spelling in `was` and the new one in `text`. A word whose marks changed carries `review: "ADDED TASHKEEL: …"`, which says exactly what was added (final mark, qamari-lam sukun, an internal mark).
  - Like a held Quran line, it is **not shown** until a teacher clears it.
  - The review doc lists every such word, old → new, per unit, generated from the file.
- **Expected size.** About 1,450 of lesson 1's ~1,620 reading strings lack only the final mark, so most words will be held at first. The teacher's review is then mostly one decision (the convention) plus a scan of the list. The doc groups the list by kind of change so it can be cleared in bulk.
  - Bulk clearing is a deliberate act in the file (`review: null`, per word, in a reviewed commit). It is never automatic.
- **No mark is invented in the middle of a word** without a flag. Where the old word is missing an internal mark (e.g. تَلَألُؤ), the extractor adds nothing and holds the word as `INTERNAL MARK MISSING`.

## 6. What the Teachers department signs off

1. **The final-mark convention:** (a) pausal sukun or (b) tanween.
2. **The word list per unit.** The words must be real, suitable for children, spelled correctly, and correctly vowelled. The checker has already proved that each word contains its unit's letter in the positions shown. It cannot prove that a word exists. The suspected non-words and non-standard spellings above arrive already held.
3. **Every added mark**, listed old → new.
4. **The authored text:** the alif note, the hamza unit's introduction, and the seat names.
5. **The hamza unit:** that it replaces the five extra letters, and that seat rules wait for a later lesson.

Until all of that is approved, the lesson page shows nothing but "under review".

## 7. Delivery

- **PR-1, engine:**
  - the route;
  - the lesson type and sections, with no content;
  - `letters.ts` and the shared fixture;
  - `check-arabic-lesson.py`: schema, unit letters, positions computed, quiz single-answer proof, strict tashkeel, held flags, the approval gate, and a selftest.

  All of it is tested on a stand-in file of non-lesson words.
- **PR-2, content:**
  - `lesson-001.json`, extracted from the old `lessonData.ts` as text and rewritten as above;
  - `pd029-p05-lesson1-review.md`, generated from the file: per unit, the words, the added marks, the held lines and what was dropped.
- **Out of scope:** lessons 2–10. The strict rule and `letters.ts` are built so each of them can follow as its own item. The plan's "full tashkeel for lessons 1–10" lands one lesson at a time.

## 8. Open questions for the owner

- Is the pausal sukun the right final mark for single words? This is the only decision that changes most of the file.
- May the rebuild drop the games listed in §2 for now (writing practice, memory, speed, bubble, catch), or must one of them come back in P0-5?
