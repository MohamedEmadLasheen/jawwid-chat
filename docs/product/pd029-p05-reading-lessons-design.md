# PD-29 P0-5c: the reading lessons (Arabic lessons 4, 5 and 10)

Status: **DESIGN, for the department head's review.** This is a docs-only PR; no code is built until it is approved. The answers below are recommendations by the PD-29 session. The head asked for this design to answer its own questions, so the head can override any of them.

## 1. Why a new lesson kind

Lessons 1–3 and 6–9 are **letter lessons**. Each unit is a letter, optionally with a mark (P0-5). A word belongs to a unit because the one letter rule proves it does.

Lessons 4, 5 and 10 hold **reading material** instead: text a child reads aloud, built up in size.

| Lesson | Old data (jawwid-lessons @ c231532, read as text only) | Size |
|---|---|---|
| 4: reading with the harakat | `lesson-4/lib/lessonData.ts`: 4 stages: all fatha (بَتَ … كَتَبَ), all kasra, all damma, mixed (فَهِمَ، كُتِبَ) | about 224 items |
| 5: reading sentences | `lesson-5/data/sentences.ts`: short sentences (أَكَلَ الوَلَدُ تُفَّاحًا), each with its words split for a put-in-order game | about 60 sentences (including the test ones) |
| 10: reading passages | `lesson-10/data/passages.ts`: 11 passages, each with a title, difficulty, keywords, sentences and the full text | 11 |

The letter rule does not apply to this material. The engine can still prove other things, and this design is about those proofs.

## 2. The reading lesson file

`apps/lessons/src/arabic/lesson-NNN.json` keeps the same envelope as the letter lessons:
- `lesson`, `review`, `provenance`, `retiredIds`;
- the same NFC rule, ids and review rules;
- the same voice-over binding (PD-48), where a clip binds to (lesson, id, sha256 of the exact text).

The units are **stages**:

```
{ "kind": "reading",
  "stages": [ { "id": "fatha", "name": "<vowelled name>", "items": [ <item> ... ] } ],
  "quiz": [ ... ] }
```

An item is one of:
- `{ "id": "fatha-001", "kind": "syllables", "text": "بَتَ", "was": null, "review": ... }`: a decoding drill, not a word (lesson 4);
- `{ "id": "fatha-021", "kind": "word", "text": "كَتَبَ", ... }`: a real word (lesson 4, stage 4);
- `{ "id": "s-001", "kind": "sentence", "text": "أَكَلَ الْوَلَدُ تُفَّاحًا", ... }`: one sentence (lessons 5 and 10);
- `{ "id": "p-001", "kind": "passage", "title": "<vowelled>", "sentences": ["s-…", …] }`: a passage is an ordered list of sentence ids (lesson 10). Its text is never stored twice, and its `title` is held like any text.

What the checker (Python) and the browser (TypeScript) prove, both failing closed:
- **Full tashkeel.** Every letter is vowelled, by the same strict rule as the letter lessons.
- **The stage's vowel (lesson 4).** In a fatha stage, every letter of a syllable drill carries a fatha; kasra and damma likewise. The rule is shared, with fixtures, like `letters.fixture.json`.
- **Every sentence word is one written word,** and a sentence splits into words on single spaces only.
- **The order game's answer is the sentence itself,** never a stored order. The old lesson 5 stored `words` beside `full`, and the two could disagree.
- **No typed Quran.** Every sentence and passage goes through the shared `rasm.py` check against the whole verified Quran, as PD-48 does for voice-over.

## 3. The three questions, answered (recommendations)

1. **Syllable drills that are not words (lesson 4).** **Keep them**, with their own item kind `syllables` and the label «مَقَاطِعُ» (syllables). They are held for teachers like everything else.
   - Decoding nonsense syllables is a standard step for early readers, and it is exactly what the old lesson 4 taught.
   - The checker still proves that each drill uses only its stage's vowel.
   - Stage 4's real verbs are `word` items.
   - A drill is never offered as a word, and never mixed into a word quiz.
2. **Pause inside sentences.** **Case endings stay inside a sentence. Only the LAST word of each sentence takes the pausal sukun,** as unit names already do (أَلِفٌ مَقْصُورَةْ).
   - A child reads a sentence through, and pauses at its end. The pause is at the end of the sentence, not the end of the passage.
   - The rebuild adds that last sukun and holds the sentence (ADDED TASHKEEL), as the letter lessons do.
   - A final tanween fath (ـًا) in pause is read as a long alif. It is shown as written, and the sentence is held with a note.
3. **The game.** Use **put the words in order**, the same game the Quran engine already has (P0-3's order game), with the order coming from the sentence itself.
   - Lesson 4 gets **read and tap**: the child taps the drill, its voice-over plays once approved (PD-48), and nothing is scored.
   - Lesson 10 gets **order the sentences** of a passage, plus "which sentence did you hear" when voice-over exists.
   - The old lessons' other games stay out, deferred with the rest to P0-5b.

## 4. Quiz

- **Lesson 4:** "which one is all fatha / kasra / damma", proved by the stage's vowel rule, with wrong options drawn from the other stages.
- **Lesson 5:** "put the words in order" questions, plus "which word is missing" (the sentence with one word blanked, and options from other sentences' words). Exactly one option completes the sentence verbatim.
- **Lesson 10:** per passage, "put the sentences in order".

Exactly one right answer is proved for every question, as in the letter lessons.

## 5. Review and holds

- **Every changed item is held.** That covers the added pausal sukun and any other added mark.
- **Every passage title, and the old "difficulty" labels,** are carried as held text.
- **Names in sentences (سَامِرٌ، أَحْمَدُ، مُحَمَّدٌ)** are fine for children's reading. G-20 still applies outside `docs/`, as everywhere (escape only the code points it trips on).
- **The review doc of each lesson is generated,** as for the letter lessons:
  - one bulk line for "the last word of each sentence takes the pausal sukun";
  - one for "syllable drills are kept as drills" (lesson 4);
  - a per-item table.

## 6. PRs

1. **Engine:** the reading kind, items and stages, the vowel-stage rule with fixtures, sentence splitting, the order game wired to the sentence, and the rasm check. A stand-in file is used for tests.
2. **Lesson 5** content (smallest, and it proves the order game).
3. **Lesson 4** content.
4. **Lesson 10** content.

Each is cut from current main, and nothing is shown until the Teachers department approves the file.
