# PD-29: one lesson per letter group (the letters track), design

Status: **DESIGN, docs only. Waiting for the department head's GO.** No code is written.

- **The ask.** The owner asked on 2026-10-30 for each Arabic letter to have its own lesson, with letters that look alike taught together. Then each lesson has room for enough explanation, games and interactive activities.
- **What it builds on:**
  - `pd029-p05-arabic-letters-design.md`, the letters lesson as data (APPROVED 2026-10-28);
  - `pd029-p05-lesson1-review.md`, its generated review doc;
  - `pd048-lesson-voice-over-design.md`, voice-over;
  - `pd049-children-quran-experience-plan.md` §B.3 and §C.4, the 3–5 rules;
  - draft PR #280, Arabic lesson 2 (letters that look or sound alike).
- **What it changes about #280.** #280 is put on hold, and its content moves into the review lessons (§7).

## 1. Summary

- **Lesson 1 is split, not rebuilt.**
  - Its 32 units, 1,521 words and 64 quiz questions move **verbatim** into 16 part files, one per letter group.
  - Every unit id, word id, quiz id, text, `was` and `review` stays as it is.
  - The voice-over key stays `arabic-001`. So a voice-over clip's binding (lesson key, string id, text hash) cannot change (§3).
- **No lesson is renumbered.**
  - `/lessons/arabic/lesson-1` becomes the **letters track**: a hub page and 16 parts at `/lessons/arabic/lesson-1/letter-N`.
  - `/lessons/arabic/lesson-2`, already «مراجعة الحروف» in the library, becomes the **sound-contrast review track**, at `/lessons/arabic/lesson-2/review-N`.
  - Lessons 3–10 keep their numbers and routes.
- **Each part teaches its letters**:
  - name and sound;
  - the four positional forms;
  - what tells the group's letters apart (dots: how many, above or below);
  - whether the letter joins the next one;
  - example words at each position, from the existing word bank.
- **Each part has games for two age bands:**
  - 3–5, pre-readers: no reading, no timers, no failure, one right answer;
  - 6+, readers.
  - The games are generated from cleared words by rules the checker proves for every possible round.
  - They are approved once by the Teachers department. They are not Quran mechanics, so the PD-49 teacher-and-scholar signing does not apply. No Quran text is ever a game object.
- **The approval gate is per part.** Teachers can release ا on its own, without waiting for all 1,521 words.

## 2. The grouping

I used the department head's grouping and found no teaching reason to change it. It leaves two of lesson 1's 32 units unplaced, ى and لا, so I placed them, and say why:

| Part | Letters | Lesson 1 units moved in | Words (held today) |
|---|---|---|---|
| 1 | ا | `alif` | 34 (21) |
| 2 | ب ت ث | `ba` `ta` `tha` | 127 (125) |
| 3 | ن ي ى | `nun` `ya` `alif_maqsura` | 133 (73) |
| 4 | ج ح خ | `jim` `hha` `kha` | 134 (132) |
| 5 | د ذ | `dal` `dhal` | 84 (83) |
| 6 | ر ز | `ra` `zay` | 88 (87) |
| 7 | و | `waw` | 45 (44) |
| 8 | س ش | `sin` `shin` | 89 (89) |
| 9 | ص ض | `sad` `dad` | 89 (87) |
| 10 | ط ظ | `tta` `zza` | 86 (85) |
| 11 | ع غ | `ain` `ghain` | 82 (82) |
| 12 | ف ق | `fa` `qaf` | 86 (85) |
| 13 | ك ل لا | `kaf` `lam` `lam_alif` | 131 (113) |
| 14 | م | `mim` | 45 (44) |
| 15 | ه ة | `ha` `ta_marbuta` | 62 (62) |
| 16 | ء and its seats (ء أ إ ؤ ئ) | `hamza` | 206 (204) |
| | | **32 units** | **1,521 (1,416)** |

- **ى goes with ن ي (part 3).** On the page, ى is ي's shape without its two dots: that is exactly what part 3 teaches. A child reading مُوسِيقَى needs to know that the dotless ي is not ي. ى is read as an alif, but a bare ا (part 1) comes first in the track, so its sound is already known. This is a teacher's call (Q2); moving it later is free (§3.4).
- **لا goes with ك ل (part 13).** لا is a lam joined to an alif, and it is drawn as one shape. It belongs where ل is taught, after ا (part 1).
- **The order stays the head's.** ن ي follow ب ت ث directly, so part 3 can show that بـ تـ ثـ نـ يـ share one "tooth" at the start and in the middle of a word, and differ only by their dots. Hamza comes last because its seats (أ إ ؤ ئ) are written on ا, و and ي, which by then are known.
- **Every part has enough words.** Each letter has at least 9 words at each position where it can occur, counting only words where the letter occurs once, which is what the games in §5 can use. The thinnest cells have 9: ع, ن and د in the middle, and ي at the start. (These counts come from the file on main; the gate still decides what is shown.)

## 3. Data reuse: the split

### 3.1 Files

- `apps/lessons/src/arabic/lesson-001.json` is replaced by `lesson-001-part-01.json` … `lesson-001-part-16.json`, in the same folder.
  - They sit at top level, not in a subfolder, on purpose. The checker's stray-file rule only lists the folder's own `.json` files. A subfolder would be skipped silently, so a misnamed part would skip every check.
  - The rule's pattern widens to `lesson-NNN(-part-NN)?.json`.
  - A lesson that has parts may not also have a main file. The checker refuses `lesson-001.json` next to its parts.
- Each part file has the shape lesson 1 has today, plus two fields:

```json
{
  "lesson": 1,
  "part": 2,
  "review": { "status": "pending", "by": null, "note": "" },
  "provenance": { "splitFrom": "apps/lessons/src/arabic/lesson-001.json", "splitAt": "<main sha read from git when PR-1 is cut>", "source": "…lesson 1's own provenance, unchanged…" },
  "finalMark": "sukun",
  "retiredIds": [],
  "units": [ "…ba, ta, tha exactly as in lesson-001.json…" ],
  "quiz": [ "…ba-q1, ba-q2, ta-q1, … exactly as in lesson-001.json…" ]
}
```

### 3.2 What carries over, and how it is proved

- **Unchanged, byte for byte:**
  - each unit object (`id`, `letters`, `name`, `forms`, `note`, `words`);
  - each word (`id`, `text`, `was`, `review`, `finalMarkException`);
  - each quiz item (`id`, `kind`, `unit`, `options`, `answer`, `review`).
- **Units and quiz items go to exactly one part.** Each unit moves to the part in §2's table. A quiz item goes to its `unit`'s part.
- **Review state:**
  - `review.status` was `pending` for the file, so every part starts `pending`.
  - Every word-level hold travels with its word. So all 1,416 holds stay held, and the 105 clean words stay clean.
  - Pending teacher decisions stay open. One is the bulk ta-marbuta question in `pd029-p05-lesson1-review.md`; its 256 words now sit in several parts, and one answer still clears them all.
- **`retiredIds`.** Lesson 1's list is empty today. From now on a retired id goes into the `retiredIds` of its own unit's part. The checker checks the whole track: no part may use an id retired in any other part.
- **The split is proved lossless in CI, once.**
  - PR-1 carries a test with the SHA-256 of lesson 1's canonical units and quiz at `splitAt`.
  - The test rebuilds the same canonical form from the 16 parts, in lesson 1's original unit order, and compares the two hashes.
  - A word dropped, added, edited or moved between units fails it.
  - When content is first added on purpose (PR-3b), the test is retired in that same PR, with a note.

### 3.3 Ids and voice-over (PD-48)

- **Ids are track-wide unique.** A word's id prefix is its unit's id, and each unit lives in exactly one part. So `<unit>-NNN`, `<unit>.name` and `<unit>.note` stay unique across the whole track. The checker also refuses two parts that share a unit id.
- **The voice-over key stays `arabic-001`** for every part, because the parts are lesson 1. A clip binds to (`lesson_key`, `string_id`, `text_sha256`), and its storage key is `lesson-audio/arabic-001/<id>/<sha256>.mp3`. None of the three changes, so a clip generated or approved before the split stays valid after it. There is nothing to migrate, re-key or re-approve.
- **The engine already handles a track-wide list.** `GET /lesson-audio/arabic-001` returns the clips of the whole track. A part page keeps only the ids it shows. `acceptVoiceMessage` already drops an entry whose id is not in its own text map, so this needs no change. The list stays under `MAX_CLIPS` (3,000): about 1,600 strings today, plus the new strings of §4.
- **The API's text map.** `scripts/lessons/lesson-audio-texts.py` writes `arabic-001.json` from the 16 parts instead of the one file.
  - The set of entries `(id, text, sha256)` is unchanged; PR-1's test proves that.
  - Only the order may change.
  - The `lesson-audio-texts` guard keeps the map and the parts in step, as it does now.
- **The openers map the new paths to the same key.**
  - Admin Web `lessonLetters` (`apps/admin-web/src/features/materials/lessonAudio.ts`) and Flutter `lessonLettersOf` (`lib/features/materials/data/lesson_audio.dart`) accept `/lessons/arabic/lesson-1/letter-N`, with N from 1 to 16, and return `arabic-001`.
  - For the review track, they accept `/lessons/arabic/lesson-2/review-N` and return `arabic-002`.
  - Everything else stays refused.
- **New strings follow the same scheme.** They are:
  - a unit's sound, `<unit>.sound`;
  - a part's own texts, under a reserved part id `part_NN`, such as `part_02.difference` and `part_05.joining`.

  Two regexes must accept them, and the PD-48 generator must emit them:
  - `voice.ts` `ID`, which becomes `^[a-z][a-z0-9_]*(-[0-9]{3}|\.(name|note|sound|difference|joining))$`;
  - the API's id check.

  Unit ids may not start with `part_`.

### 3.4 Moving a unit later

A unit can move from one part to another, for example if teachers want ى with ا. The unit moves whole, with its ids and holds, and its quiz items go with it. No binding names a part, so nothing else changes. Only the generated review doc and the hub show the new place.

### 3.5 Routes, numbering and the library

| Path | What it is |
|---|---|
| `/lessons/arabic/lesson-1` | **The letters hub.** One large card per part, in order, showing the part's letters, from each unit's first form. There is no new text to review. A part that is not approved shows «قيد المراجعة» and does not open. The library's existing row «الحروف» still opens something useful, so it needs no edit. |
| `/lessons/arabic/lesson-1/letter-N` (1–16) | One part. |
| `/lessons/arabic/lesson-2` | **The review hub**, once PR-6 lands, in the same way. Until then it answers "not found", as today. |
| `/lessons/arabic/lesson-2/review-N` | One sound-contrast review part (§7). |
| `/lessons/arabic/lesson-3` … `-10` | Unchanged. |

- **Routing.** `route.ts` gains `{ kind: 'arabic-part', lesson: 1 | 2, part: n }`. It is strict, as today: `letter-02` and `letter-17` are "not found".
- **The library.** The manifest (`docs/product/pd029-seed/jawwid-lessons-manifest.csv`) gains one row per part, right after its hub's row. Their titles are the letters, for example «الحروف: ب ت ث». That way a teacher can assign one letter as a material.
  - Re-importing by `ref` adds the new rows and leaves the old ones as they are.
  - The rows are `draft` until a manager publishes them.
  - The README's import block still applies.

### 3.6 One resolution for the whole track

- **Quiz options cross parts.** A lesson 1 quiz question already takes its wrong options from other units. `alif-q1` offers مُوسِيقَى, from the ى unit, against دُنْيَا. Pick-the-words does the same.
- **So the engine resolves the track, not one part.** A new `resolveTrack(parts)` runs today's `resolveArabicLesson` checks over all 16 parts at once.
  - The vocabulary and the held spellings are track-wide. "A spelling held anywhere is held everywhere" stays true.
  - Any malformed part refuses the whole track: it fails closed.
  - The result is per part, each with its own `approved`.
- **What a page may show.** A part page shows only words that are cleared, and only when **its own part** is approved.
  - A borrowed wrong option must also be cleared at word level.
  - A borrowed word is part of what that part's approval covers. The generated review doc lists every word a part borrows, under that part.
- **The CI checker** (`check-arabic-lesson.py`) gets the same track mode, and the shared fixture keeps the browser and CI in agreement.

## 4. What each part teaches

Per part, in this order. **New text is authored, vowelled and held** until a teacher clears it, like the notes of lesson 1. Nothing here is generated prose.

1. **Meet the letter** (اِسْمُ الْحَرْفِ وَصَوْتُهُ), one card per letter of the group:
   - **The glyph**, big.
   - **Its name.** This is the existing `name` (بَاءْ), with `<unit>.name` voice-over when a clip is approved.
   - **Its sound.** This is a new `sound` per unit: the letter with a fatha (بَ). The id is `<unit>.sound`, and it is held.
     - ا, ى and ة get no sound. ا and ى are read as the madd, which Arabic lesson 7 teaches; ة's pause rule is explained in part 15's own note. The card then shows no sound row: it is absent, never empty.
     - لا's sound is «لَا».
     - Hamza's is «أَ».
   - **Audio.** It comes only from PD-48's teacher-approved voice-over (TTS, approved by two reviewers), or from a teacher recording that enters through the same clip gate (Q3). It is **never** Quran recitation: it uses a different message type, key prefix and route from `jawwid:quran-audio`.
     - A string with no approved clip has no play button. There is no placeholder and no browser voice.
2. **The four forms** (أَشْكَالُ الْحَرْفِ). Four boxes in RTL order: alone, at the start, in the middle, at the end. Each box has a small position icon, so it needs no reading.
   - The forms are lesson 1's `forms`, unchanged.
   - **Letters that do not join the next letter**: ا د ذ ر ز و, and among the hamza seats أ إ ؤ ء.
     - They have two forms. The start and middle boxes show the joined-from-the-right form with a "does not join forward" marker, never a made-up shape.
     - The part's `part_NN.joining` note explains it: "this letter never joins the letter after it, so the word breaks after it", with an example word whose break is highlighted.
     - Parts 1, 5, 6, 7 and 16 carry this note. Part 1 introduces the idea, because ا is the first letter that does not join.
   - ة and ى have only end forms. Their card says so, and its example tabs show only "at the end".
3. **What tells them apart** (مَا الْفَرْقُ؟), in multi-letter parts. The letters are shown side by side in the same positional form, with their dots marked.
   - The dots are marked by a dot icon with an above or below arrow and a count, so the difference is never shown by colour alone.
   - The facts (how many dots, above or below, which letters share a skeleton in which form) are a **code table** in `letters.ts`, with a Python twin and fixture cases. They are not content: they are fixed facts about the letters, proved in both languages, as the letter rule is today.
   - The one sentence that says it in words is a held note, `part_NN.difference`, such as «الْبَاءُ نُقْطَةٌ تَحْتَ، وَالتَّاءُ نُقْطَتَانِ فَوْقَ». #280's look-alike "difference" lines are its first drafts (§7).
   - In a one-letter part (ا, و, م), this section compares the letter with its nearest look-alike from another part:
     - ا with ل at the start of a word, and with ـا/ـل at the end;
     - و with ر and with ؤ;
     - م with no near look-alike, so the section is left out.
4. **Examples** (أَمْثِلَةٌ): lesson 1's existing examples section, unchanged.
   - Tabs: at the start, in the middle, at the end.
   - The letter is picked out by the one rule.
   - Each word has its own play button when it has an approved clip.
   - Hamza's tabs are by seat, as `pd029-p05-arabic-letters-design.md` §3 says.
5. **Games** (§5).
6. **Quiz**, 6+ only: lesson 1's existing two questions per unit, unchanged. For 3–5 there is no quiz. PD-49 §E's rule for pre-readers is a celebration, not a test.

Stars use the existing `StarLedger`, with a section list per part. It holds only the sections this part offers this child, which depend on band and audio. So a child is never short a star because a section was absent.

## 5. Games and interactive activities

### 5.1 Rules for every letter game

- **Rounds are generated, not stored, from the part's cleared words and the letter tables.**
  - The checker enumerates **every** round each game could build from the file and proves it has exactly one right answer.
  - It is the same proof as the quiz's, made exhaustive. PD-49's verified-text activities use the same idea.
  - Option order comes from `shuffle.ts`. That file is read, not changed: it is in PD-49's signed `SHARED_CODE`, and changing it would unsign every Quran mechanic.
- **Each game's rules are approved once** by the Teachers department. `apps/lessons/src/arabic/letter-games.json` holds, per game:
  - its id, bands, `needsAudio` and rules text;
  - a `review` status, gated like a lesson file: a game that is not approved never appears.

  It is **not** `play/mechanics.json`. There is no scope `play`, no scholar and no signed export: **the Quran signing does not apply to letter games**, because they show no Quran text. The letter games live in `src/arabic/games/` and may not import `play/`, `quran/` or `content/quran-content`. A guard enforces it.
- **No Quran text is ever a game object.** Game objects come only from the letters word bank. That bank:
  - is checked to hold no Quranic orthography (`isWord` already allows only the base letters and the marks U+064B–U+0652 and U+0670);
  - is refused by a new checker rule for any word containing the Name of Allah (the letters ا ل ل ه in sequence, after any prefix). Today's bank has none; the rule keeps it that way.
- **Bands.** The page takes the child's band from the opener, as PD-49 will (`stated_age`).
  - Until that is wired, a grown-up switch on the part page picks it: «مَعَ الْكَبِيرِ» (3–5) or «أَقْرَأُ» (6+). The default is 3–5, the gentler band.
  - PD-49's 6–8 and 9–12 are one band, "6+", for letters.
- **The knobs** live in `src/arabic/games/knobs.ts`, not in `adapt.ts`, which is signed shared code:

| | 3–5 (pre-readers) | 6+ (readers) |
|---|---|---|
| Options | 2 | 3–4 |
| Rounds per game | 3 | 5 |
| Distractors | far: the letter differs a lot, such as dots below vs above | near: the same shape, a different dot count |
| A wrong tap | never "wrong": a gentle retry, then after two tries the answer glows and is praised; no star is lost | one retry, then the answer is shown |
| Instructions | none to read: a model, an icon, a demonstration, or a clip when approved | short vowelled text (`ui-text.ts`) |
| Timers | never | never |
| Targets | ≥ 64 px | ≥ 52 px |
| Sound | only approved voice-over clips; no music, no sound effects | the same |

- **Accessibility, as PD-49 §C.4:**
  - RTL;
  - right and wrong shown by icon, word and shape, never colour alone;
  - `prefers-reduced-motion` honoured;
  - every control labelled.

### 5.2 The games

| # | Game | 3–5 | 6+ | Exactly one right answer, proved by | Reuses |
|---|---|---|---|---|---|
| G1 | **Find the letter among look-alikes** (أَيْنَ الْحَرْفُ؟) | **Match-to-sample**: the target letter shown big, and two cards (it, and one far look-alike); tap the same one. No reading and no audio needed. | 3–4 cards in the same positional form and the same skeleton (بـ تـ ثـ نـ يـ); the prompt is the model, or the name with its clip | Options are distinct letters; exactly one is the unit's letter (or one of the hamza seats in part 16); each distractor's skeleton class is in the table for that form | `shuffle.ts`, the `choice` buttons; new `LookAlike.tsx` |
| G2 | **Find the letter in a word** (اُنْقُرْ عَلَى الْحَرْفِ) | the model letter beside the word; tap the piece that matches | as today | Only words where the letter occurs **once**. `clusters()` marks exactly one target piece (لا and lam-alif stay one piece) | `FindLetter.tsx`, given a band |
| G3 | **Where is it in the word?** (أَيْنَ مَكَانُهُ؟) | the letter is highlighted in the word, and three position boxes mirror the word right-to-left; tap the box where the coloured piece is | not highlighted: find it, then tap start, middle or end (text labels) | Only words where `positions()` gives exactly one place and the letter occurs once (today's quiz rule). For ا all three boxes are offered, and "start" is simply never right | `positions()`, the quiz's position item; new `WhereInWord.tsx` |
| G4 | **Listen and choose** (اِسْمَعْ وَاخْتَرْ) | hear the letter's name or sound; two glyph cards | 3–4 glyph cards from the part's group and its near look-alikes | Options are distinct letters; exactly one is the letter whose clip played | `useVoice` (the PD-48 clips); new `ListenChoose.tsx` |
| G5 | **Build the word** (رَكِّبِ الْكَلِمَةَ) | **Complete the word**: the whole model word on top, one piece blank where the letter is, and two pieces (the right one, and the same marks on a look-alike); tap the one that matches | the pieces of a 2–5-piece word, out of order; tap them in order. The model is shown, or played when a clip exists | The answer is the word's own `clusters()` sequence. Identical pieces can be swapped and give the same string. The checker proves every 3–5 swap gives a different string and that the look-alike exists in that form | a sibling of `games/OrderAyat.tsx` with its tap-to-place interaction (OrderAyat itself takes ayat); new `BuildWord.tsx` |
| G6 | **Pick the words** (اِخْتَرِ الْكَلِمَاتِ) | not offered: a set answer is reading | as today | The one right answer is the set the one rule picks out | `PickWords.tsx` |
| G7 | **Tracing and writing** (اُكْتُبِ الْحَرْفَ) | **later phase** (§5.4) | later phase | n/a | none |

- **Listen and choose while audio is off.** "Off" means this account has no approved clip for that letter's name or sound, or voice-over is not released to it. Then that letter is not used for G4 rounds. If no letter of the part has a clip, **G4 is absent**: it is not shown, not disabled, and there is no placeholder (PD-48 and PD-49's rule). The part's stars then simply do not count it.
  - For 3–5, PD-49 adopted a "with a grown-up" mode for audio-off. The letters equivalent would show the grown-up a small vowelled line, «قُلْ لِطِفْلِكَ: بَاءْ», and the child taps a glyph. A pre-reader cannot read the line, so it does not give the answer away. I recommend it, but it is new text and a new mode: Q4.
  - TTS is weakest on lone letter sounds (PD-48 §3). So expect some letters to stay silent until a teacher recording exists (Q3).
- **One optional extra for 6+: "where does the word break?"** (أَيْنَ يَنْقَطِعُ؟).
  - It uses only words with exactly one break after a letter that does not join, and the child taps the gap.
  - The break is computed from the joining table, so it is provable.
  - It is offered in parts 1, 5, 6, 7 and 16. It is cheap, so it is listed for PR-4. The head can cut it.
- **Not carried, as before:** the old speed, bubble and catch games. They depend on timers and on failure, which the 3–5 rules forbid. The old memory pairs could come back later as "match the form" (alone ↔ at the start). It is not in this plan.

### 5.3 Approval of the games

The Teachers department signs off:
- `letter-games.json` once: each game's rules, bands and knobs;
- per part, the part as shown.

The generated review doc lists, per part and per game, every word that can appear in a round. So "the part as shown" is a finite list, not a promise.

### 5.4 Tracing and writing (later phase, P0-5b)

- **Not built in this plan.** The old tracing had strokes for ب ت ث only, and every other letter used ب's. It is not reused.
- **When built**, each form gets our own stroke data: SVG paths with stroke order, drawn in-house and held for a teacher.
- **3–5:** trace freely along a wide guide. Every attempt is praised, and nothing is scored.
- **6+:** stroke-order arrows, with a gentle retry when a stroke starts in the wrong place.
- **Nothing is stored**: no handwriting, no image, no score. A part records only "practised".

## 6. Images

- **None in PR-1 to PR-6, beyond our own interface icons** in inline SVG: the position boxes, the dot and arrow markers, the ear for listen, the hand for tap, and the "does not join" marker. None of them has a face or a figure.
- **Later, optionally, two kinds of picture:**
  1. **Letter skeleton and dot drawings**, our own SVG per skeleton family, so the dots can be marked separately from the shape. A font glyph cannot colour its own dots.
  2. **Word pictures for the 3–5 band, of faceless objects only**: door, book, moon, tree, cup.

  The rules for both:
  - **No animals, no people, no faces, no figures**, even where the word is an animal (أَسَدْ gets no picture).
  - Drawn in-house as hand-written SVG. No stock, no external source, no AI-generated images.
  - Each picture is bound to its word id and its own SHA-256, and is held for a teacher with that word.

## 7. The sound-contrast review lessons, and #280

**#280 is on hold** from today. It is not merged, built on or rebased. It closes, unmerged, when PR-6 opens, with a link to this design. No id of #280 ever reached main, so nothing binds to its ids. Its content moves as follows:

| #280 content | Where it goes |
|---|---|
| 12 look-alike pairs: 432 words | Into the **letter parts**, as new words of the letter's own unit. They take the next free `<unit>-NNN`, are de-duplicated by text against lesson 1's words, and are held as usual (pausal sukun added, and so on). Pairs that cross parts (ب/ن, ت/ي, ث/ش) feed the near look-alikes of G1 and the "what tells them apart" section. |
| 12 look-alike "difference" lines | The first drafts of each part's `part_NN.difference`, vowelled and held (#280 left them unvowelled). |
| 7 sound-alike pairs: 84 words and 7 "tip" lines | Into the **review parts** below, keeping #280's unit ids where the pair survives (`dad_vs_dal`). The tips become held notes. |
| The dropped word حِصَان (listed under س) | Stays dropped. |

**The review parts** (`lesson-002-part-NN.json`, at `/lessons/arabic/lesson-2/review-N`), as the head proposed:

| Review | Contrast | From #280 |
|---|---|---|
| 1 | س / ص | none; from the letter units |
| 2 | ت / ط | none |
| 3 | د / ض | ض/د |
| 4 | ذ / ز / ظ | ز/ذ, ظ/ذ |
| 5 | ه / ح | ه/ح |
| 6 | ك / ق | ق/ك |
| 7 | ء / ع | none |

- **Two candidates I recommend adding (Q5):** **8 ث / س** and **9 خ / غ**.
  - #280 already has their words and tips.
  - ث pronounced as س or ت is the most common dialect merger among Arabic-speaking children, and the head's list has no ث.
  - The default build is the head's seven.
- **Each review part:**
  - one unit per letter, with ids in #280's form `<letter>_vs_<other>`;
  - for the triad, `dhal_vs_zay_zza`;
  - **minimal pairs**: real words that differ only in the contrast letter (سَيْفْ / صَيْفْ). They are a new, held list, `review_NN_pair-NNN`. The checker proves each pair has the same marks and differs at exactly one letter, and that those two letters are the part's contrast.
- **The core game is G4, listen and choose**, between the pair's letters and then between a minimal pair's two words (6+). It is a sound contrast, so **without approved audio a review part offers 6+ only**: G1 for the shapes, plus a minimal-pair reading quiz. The 3–5 band appears only once clips exist.
- **The voice key is `arabic-002`**, under the same PD-48 gate.

## 8. PR split

Each PR is gated on the committed tree:
- lessons `tsc`;
- vitest;
- `check-arabic-lesson` selftest and files;
- guards.

`scripts/qa/guards.sh` is a Code Owners path. A PR that adds a guard waits for the owner's review.

| PR | Contents | Depends on |
|---|---|---|
| **PR-0** (this) | This design. | none |
| **PR-1** Track engine and lossless split | `route.ts` (`arabic-part`, hub); `resolveTrack`; the hub page; a part page built from today's sections; the checker's track mode, part file names and stray rule; `lesson-001.json` → 16 parts **verbatim**, with the one-time lossless test; `lesson-audio-texts.py` reading the parts; the review doc regenerated with one section per part. No new text. | PR-0 GO |
| **PR-2** Openers and library | Admin Web `lessonLetters` and Flutter `lessonLettersOf` (new paths → `arabic-001` / `arabic-002`, with tests); the manifest rows for the 16 parts. | PR-1 |
| **PR-3a** Letter tables and sections | `letters.ts` dots, skeleton and joining tables, plus the Python twin and fixture; the sections "meet the letter", "four forms" and "what tells them apart"; the `.sound`, `.difference` and `.joining` ids in `voice.ts`, the API and the PD-48 generator. | PR-1 |
| **PR-3b** New held content | The `sound` per unit; the `part_NN.difference` and `part_NN.joining` drafts; #280's look-alike words merged into the letter units. All held. The lossless test is retired here. | PR-3a |
| **PR-4** Games | `letter-games.json` and its gate; `knobs.ts` and the band switch; G1, G3 and G5 new; G2, G6 and the quiz given a band; the break game (optional); the exhaustive one-answer proofs; the no-Quran-import and Name-of-Allah rules. | PR-3a |
| **PR-5** Listen and choose | G4, and the 3–5 grown-up mode if Q4 is yes. It stays dark until clips are approved. | PR-4 |
| **PR-6** Review track | `lesson-002-part-NN.json` from #280's sound-alike content and the letter units; the minimal pairs (held); the lesson 2 hub; the openers' `arabic-002`; the manifest rows. #280 is closed when this opens. | PR-4 (PR-5 for its core game) |
| later, **P0-5b** | Tracing and writing (§5.4); the skeleton and dot SVGs and the faceless word pictures (§6). | its own design note |

**Release.** The Teachers department approves part by part:
- they set `review.status` to `approved` in a reviewed commit;
- they clear words one by one, or in bulk, as today.

Part 1 (ا: 34 words, 13 already clean) can reach children before any other part.

**Systest.** The preview recipe in the head's notes (`preview-clear.py`) clears `lesson-{001,…}.json`. After PR-1 it has to clear the part files instead. The systest session should be told when PR-1 merges.

## 9. Questions for the department head

1. **GO on the design**, and on the route shape `/lessons/arabic/lesson-1/letter-N` (lessons 2–10 are not renumbered).
2. **ى in part 3 (with ن ي), and لا in part 13.** This is my placement of the two units the grouping left out (§2); teachers can move either later for free (§3.4).
3. **Teacher recordings for letter names and sounds.** TTS often fails on lone letters (PD-48 §3). Should a teacher recording be allowed into the same two-reviewer clip gate, as a PD-48 amendment? The owner chose TTS on 2026-10-28, so this is the owner's call.
4. **A "with a grown-up" mode for G4 at 3–5 while audio is off** (§5.2). The grown-up reads the letter's name, and the child taps.
5. **Add review parts 8 (ث/س) and 9 (خ/غ)**, whose content #280 already has (§7).
6. **The break game** (6+), in PR-4 or cut.
