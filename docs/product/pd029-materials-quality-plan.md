# PD-29 amendment: materials quality and the child's experience: audit and plan

Status: **DECIDED** (2026-10-27; the owner's answers are in "Owner decisions" below). Claimed as
`docs/product/pd-registry/PD-29-amendment-materials-quality.md`. Item #1 ships on its own
as #166. Written 2026-10-27 from the owner's 19-item request, relayed by the department head.

## Owner decisions (2026-10-27)

All six questions in §E are answered, and every answer took the recommendation. The owner's words are quoted.

| # | Question | Decision |
|---|---|---|
| 1 | Path for the lessons | "New clean engine in Chat (Recommended)": path (c), `apps/lessons`, content brought over as text only. |
| P0-0 | Hide the wrong-audio lessons now | "Yes, hide them now (Recommended)": retire surahs 101, 113 and 89 in Admin Web → Materials until they are rebuilt. |
| 2 | Quran text, Tajweed source, sign-off | The one shared, verified source: Tanzil Uthmani (Hafs), pinned and checked at every load. Tajweed is shown only once approved. The reviewers are the Teachers department: "Teachers department (Recommended)". Built in #176; the contract is `docs/product/quran-dataset-contract.md`. |
| 3 | Reciter and hosting | "Mishary Alafasy (Recommended)": per-ayah files, self-hosted, with SHA-256. **Audio stays OFF** until the owner explicitly confirms the right to self-host them. The ingest path and the per-ayah table exist (#176). |
| 4 | Memorization stars (#15) | "Recommended set": stars are earned in the engine and kept per child. No teacher map. |
| 5 | Difficulty levels (#6) | "Recommended set": three levels, set by the child's teacher. |
| 6 | Rewards and competitions (#8, #9) | "Recommended set": points and levels are visible only to the family and the teacher. Competition is opt-in, within one teacher's group, with no public leaderboard. |

## 0. How this was audited (safety)

- The lesson content lives in `MohamedEmadLasheen/jawwid-lessons`. Its history was infected
  seven times; `muneeb787` still had write access on 2026-10-24.
- Nothing from it was installed, built, run, opened in an editor or cloned again for this
  audit; a fresh clone was refused by this session's permission policy.
- The audit reads, as plain text only, the source tree of **c231532** (2026-03-17). The 2026-10-24
  security review saved that tree, and it is the commit the live site jawwid-lessons.vercel.app was
  built from:
  - live bundle `index-CJezfO79.js`, sha256 `0e56d3dd…`;
  - every later production deploy failed or was blocked;
  - HEAD `62e7f8b` has an identical `src/`.
- Scripts were run with `python3 -I` from a separate folder.
- **Paths below are relative to that tree** (`src/lessons/...`).
- Second School's diverged copy (`second-school-lessons`) is out of scope. Its checkout has been
  removed from this Mac, and its cleanup is PR MohamedEmadLasheen/second-school-lessons#5.

## A. Where each item lives

"Chat" = this repo (API, Admin Web, Flutter app, PD-28 teacher web). "Lessons" = the content
site that Chat frames (`MATERIALS_SITE_BASE_URL` + `/lessons/<category>/<slug>`).

| # | Item | Lives in | Evidence |
|---|---|---|---|
| 1 | Full-screen lesson | **Chat** (done, #166) | Admin Web previewed in a 420 px side sheet beside the side navigation (`apps/admin-web/src/features/materials/MaterialsPage.tsx` PreviewDialog, `Dialog variant="sheet"`). The Flutter app and teacher web already push a full-screen route on the root navigator (`lib/features/materials/presentation/material_player.dart:29`). Islamic lessons feel different because 13 of them carry their own Fullscreen API button (`src/lessons/islamic/lesson-1/pages/Index.tsx:48`); Quran and Arabic lessons have none. |
| 2 | Wrong surah plays; Tajweed classifications | **Lessons** (data) | §B1, §B5 |
| 3 | Repetition videos instead of built-in audio | **Both** | Chat already stores video items (PD-29 kinds `video` + link/file) and a per-surah recitation override (`chat.recitation_source`, per-surah URL or upload). The lessons hard-code their own audio URLs per surah, so a teacher's video can't replace them there. |
| 4 | Alif vs Hamza | **Lessons** (Arabic content) | §B4 |
| 5 | Content for children who can't read | **Lessons** (new content); Chat hosts it | content creation, P2 |
| 6 | Difficulty levels per child | **Both** | Chat has an age band per child and per item (PD-29), but no level. Lessons carry no level metadata (`materials-inventory-vercel.md` §3). |
| 7 | Detailed progress; teacher–student interaction | **Chat**, with an event from the lessons | PD-15 lesson reports, Practice, "Opened this week" (#132). Lessons keep scores only in React state and send nothing to the host (inventory §6), so Chat can't know what a child completed. |
| 8 | Rewards, points, levels | **Chat** (ledger) + **Lessons** (where points are earned) | same as #7 |
| 9 | More interactive content | **Lessons** (new content) | P2 |
| 10 | Parent section | **Chat** | The child's Materials page (Library, Opened this week). The memorization map was retired on 2026-10-26 (#132), with its data kept. |
| 11 | Progress inside activities; full tashkeel | **Lessons** (+ a Chat resume point) | §B4 |
| 12 | Verse–audio sync | **Lessons** (playback code + audio data) | §B1 |
| 13 | Tajweed colours, madd marks, signs in a digital Mushaf; accurate text | **Shared dataset** (§C), rendered by the lessons | §B5 |
| 14 | Section divisions for every surah | **Lessons** (templates) | §B2 |
| 15 | Memorization stars for every surah | **Lessons** (earned) + **Chat** (kept per child) | §B2; owner question 4 |
| 16 | Games: missing verses, answers that change | **Lessons** (game code) | §B2 |
| 17 | Surah ordering and linking | **Lessons**; Chat verified correct | §B3 |
| 18 | Rebuild Al-Buruj | **Lessons** | §B2 |
| 19 | More engaging games | **Lessons** (design + assets) | P2 |

## B. Root causes (static analysis)

**The systemic cause behind almost everything.** The 38 Quran lessons are 38 separately
generated apps in about 12 template variants:
- Each keeps its own ayah text, ayah ids, audio URLs, Tajweed table and games, usually in 2–3
  copies of the verse list inside one lesson.
- No lesson reads a shared source.
- No lesson persists anything: zero uses of localStorage, sessionStorage or IndexedDB.
- No lesson sends anything to Chat.

So every defect below is either a **data error in one copy** or a **code pattern repeated
across templates**. Fixing them one example at a time can't converge; this is why §D
recommends one engine over one dataset.

Full tables and the read-only scripts that produced them are kept with the department head's session notes, in `audit/` (outside this repo: they quote the lessons' code). Each file below starts with `src/lessons/quran/surah-N/`
unless it says otherwise.

### B1. #2 "a surah plays another" and #12 "a verse plays the previous one"

| Pattern | Where (verified) | Effect | Systemic? |
|---|---|---|---|
| **P1 wrong global ayah ids** | **101** `lib/quranData.ts:45-105`: ids 5765–5775 = **Abasa 80:7–17** for all 11 ayat (Al-Qāriʿah is 6158–6168). `:38` "full surah" uses the *ayah* endpoint `…/audio/128/ar.alafasy/101.mp3` = **Al-Baqarah 2:94**. **113** `lib/surahData.ts:15-39`: ids 5677–5681 = **An-Nabaʾ 78:5–9**. | The owner's "Al-Qāriʿah opens Abasa" exactly. | Data error, 2 lessons. Ids were typed by hand instead of computed. |
| **P1b a split ayah** | **89** `components/LessonData.ts:38-46`: 89:23 (وَجِيءَ يَوْمَئِذٍ بِجَهَنَّمَ ۚ يَوْمَئِذٍ يَتَذَكَّرُ …) is split into ids 23 and 24 (31 entries for 30 ayat). `getVerseAudioUrl(id)` (`:181`) then plays the **next** ayah for ids 24–30; id 31 requests 089031, which doesn't exist. | Verse–audio offset from ayah 24 on. | Data error, 1 lesson. |
| **P2 "repeat" replays a stale audio object** | 102 `components/VerseByVerse.tsx:44-49`: `goToVerse` pauses but keeps `audioRef`, and `repeatVerse` replays it. The same pattern is in 85 `LearnAyahSection.tsx:38-44`, 86 `AyahByAyah.tsx:121-129`, 89 `AudioPlayer.tsx:17-48`, 107 `VerseByVerse.tsx:141-150`. | Move to the next verse, press repeat, **hear the previous verse**: the #12 symptom. | Systemic, 5 lessons. |
| **P3 delayed replays not cancelled** | 82, 83, 94, 108, 113, 114 (e.g. 108 `IntroSection.tsx:431-435`): a `setTimeout` replays after the selection has changed. | The previous verse starts again. | Systemic, 6. |
| P4 changing the selection doesn't stop audio | 18 lessons | Two verses audible | Systemic |
| P5 players overlap | 103, 108, 111, 114, plus 2 games | Same | Systemic |
| P6 basmala offset in the highlight | 92 `components/IntroSection.tsx:3-25, 115-123` | The highlight trails the recitation by one ayah | One-off |
| P7 estimated timings on a whole-surah mp3 | 10 lessons (79, 80, 84, 85, 86, 88, 89, 95, 113, 114) | The highlight drifts. No timing table comes from the actual file or reciter. | Systemic |
| P8 no audio cleanup on unmount | 17 lessons | Audio keeps playing after another surah is opened, which also *sounds* like "the wrong surah plays" | Systemic |

**Surah 91 (the owner's 91:6 example)** has no static cause.
- Id 6049 is 91:6 (`components/VerseByVerse.tsx:47-49`).
- Selection is 0-based over 0-based data, and audio stops on every change.
- The listening view handles the basmala correctly (`components/LessonIntro.tsx:28-32`).
- Inferred runtime causes, either of:
  - the CDN file `cdn.islamic.network/…/6049.mp3` begins with the tail of 91:5 (check it against everyayah `091006.mp3` by ear);
  - or the report came from a P2/P3/P8 lesson.
- **Checked and fine:** the top-level routes map 1:1 (`src/App.tsx`). Surah 106's table of
  Fātiḥah ids (`lib/lessonData.ts:41-46`) is dead code; its player uses the correct `…Alt` table.
  Every surah-level mp3 is the lesson's own except 101. No builder has a 0/1-based off-by-one.

### B2. #14 sections, #15 stars, #16 games, #18 Al-Buruj

- **#16, answers that change, is systemic (15 lessons).**
  - **Options are shuffled during render.** e.g. 85 `components/MeaningsSection.tsx:136-145`
    rebuilds `questions` with `Math.random()` on every render, so every tap reshuffles the options.
    Same in 82 `MemorizationGames.tsx:163`, 109 `LessonsAndQuiz.tsx:277`, and 10 more.
  - **Answers are stored by position, not identity.** In 96 and 102, the green/red marks then land
    on the wrong verse.
  - **101 reshuffles with no input:** 2 s after a tap (`components/WordMeanings.tsx:54`).
  - **Games restart after every answer.** 100 defines its game components inside its parent
    (`MeaningsSection.tsx:51-218`, `MemoryGames.tsx:57-308`), so each answer remounts the game at
    question 1. 97 does the same on completion.
- **#16, missing verses.**
  - About 22 lessons build games from `verses.slice(0, 4–6)`. In 85, ayat 6–16 and 19 never appear
    in any game. In 78, ayah 40 can never be drawn (`GamesSection.tsx:19`).
  - Identical ayat (84: 2 and 5; 109: 3 and 5) become identical buttons. 84 checks ids, so a correct
    order can fail.
- **#14 section divisions.**
  - There is no shared header; there are about 8 variants. 112 has none (`pages/Index.tsx:19-40`).
  - Navigation that doesn't work: 103's dots can't be clicked, and 83 and 95 show a progress bar only.
  - Navigation that is hidden: 9 hide it on the welcome screen, 94 and 105 lock later tabs, and 97,
    100 and 109 put it behind a toggle.
  - 5 show numbers only.
- **#15 stars.**
  - 17 of 38 lessons have no lesson-wide star counter. Only 8 award stars for memorizing ayat.
  - Stars can be farmed: 82, 84 and 102 re-add them on revisit (`pages/Index.tsx:31`/`:25`/`:27`),
    and 79 adds one per page turn.
  - Nothing is kept after a reload.
  - Al-Buruj (85) draws 3 stars for a 2-question intro quiz.
- **#18 Al-Buruj (85).**
  - The data is right: 22 ayat, and per-ayah audio for surah 085.
  - It has more than 20 defects, the patterns above included:
    - P2 repeat-before-listen leaves "listen" stuck disabled (`LearnAyahSection.tsx:38-44`);
    - the render shuffle;
    - ayat 6–16 and 19 are missing from the games;
    - the stars live only inside the games section;
    - the final quiz's per-category scores are computed wrongly (`QuizSection.tsx:228-237`).
  - A rebuild checklist is in `audit/finding-games-order.md`.

### B3. #17 ordering and linking

- **Chat is correct.**
  - All 38 Quran rows of `docs/product/pd029-seed` link surah N to `/lessons/quran/surah-N`.
  - The library orders Fātiḥah first, then 114 → 78 (#132).
  - One naming nuance: surah 83 is titled "المطففون" in the lessons and the seed; the common name
    is "المطففين".
- **Lessons:** 37 of 38 verse lists match the verified ayah counts. 89 doesn't (the split above,
  which also shifts every later ayah number). 92's highlight runs one ayah behind.
- **No lesson links to the next or previous surah.** Fātiḥah's "السورة التالية" button is
  permanently disabled (`pages/SurahFatiha.tsx:511-515`).
- So the owner's "surahs in the wrong position or swapped" is, as far as static reading shows, the
  **audio** of 101 and 113 (another surah's verses) plus 89's shifted numbering. The surah list
  itself is in order. Owner question 1 covers anything seen elsewhere.

### B4. #4 Alif and Hamza; #11 tashkeel and in-activity progress (Arabic lessons)

Paths are relative to `src/lessons/arabic/`.

- **#4 is in one data file, but it reaches every activity of lesson 1.**
  - All 15 "start" examples of the letter **ا** begin with **أ** (`lesson-1/lib/lessonData.ts:27-31`:
    أَسَد، أَرْنَب، أَنَانَاس، أُمّ …). They are the same words as lesson 1's "hamza on alif" entry
    (`:646-649`).
  - The game code folds أ/إ/آ/ٱ into ا (`components/GamesSection.tsx:146-150`):
    - the ا game accepts أ;
    - the إ game accepts a plain ا in 6 of its 9 words;
    - the ء game can't be won, because its first word رَأْس has no tappable target.
  - The quiz filters compare exact characters (`lessonData.ts:784/852/906/920/946`), so they
    contradict the game, and correct answers such as مَبْدَأ and رَئِيس can be scored wrong.
  - Hamza is taught only as "extra letters" 29–33 (`:619-723`). The ء entry says hamza never begins
    a word (`:619`), and that statement is the conceptual root of the mix-up.
  - Smaller: lesson 3 writes "أِ" for إِ (`lesson-3/lib/arabicData.ts:28`).
- **#11 full tashkeel.**

  | Lesson | Strict | Lenient |
  |---|---|---|
  | 1 | 10.9% | 99.8% |
  | 2 | 5.9% | 100% |
  | 3 | 17.4% | 99.5% |
  | 4 | 100% | 100% |
  | 5 | 65.1% | 100% |
  | 6 | 32.8% | 32.8% |
  | 7 | 0.3% | 97.4% |
  | 8 | 87.2% | 91.2% |
  | 9 | 20% | 20% |
  | 10 | 47.1% | 97.1% |

  - The figures are the share of reading strings that are fully vowelled. The strict rule counts
    every letter; the lenient rule excuses the final letter and the lam of ال.
  - The worst gaps are inside words: lesson 9's shaddah words (أمَّ, `components/ExamplesSection.tsx:10-72`),
    lesson 6's أبْ, and lesson 10's اللهَ with no shadda. Lesson 3 has a wrong vowel in يِنَاير
    (`lib/arabicData.ts:1175`). Instructions are mostly unvowelled.
  - The owner wants FULL tashkeel, so the strict rule is the target.
- **#11 progress inside activities.**
  - None. No activity marks a finished sentence or remembers where to continue; it is React state
    only. Lessons 5 (67 sentences) and 10 show an "n / total" counter.
  - Lesson 9's ✓-cards (`ExamplesSection.tsx:166-199`) are the only pattern to build on.
  - Writing practice traces only ب/ت/ث; every other letter falls back to the ب stroke
    (`lesson-1/components/WritingPractice.tsx:12-47`).

### B5. Tajweed (#2) and the Mushaf (#13)

**Inventory** (`audit/tajweed-inventory.tsv`) for the teacher's review. It contains no rulings.
- **Size:** 379 rule instances in 37 lessons (260 rule rows, 109 quiz or game items, 10
  definition-only questions). Surah 1 has none.
- **Rows with a textual flag: 81.**
  - **a:** the example isn't in the lesson's own ayah text: 7.
  - **c:** a noon-sakinah/tanween rule with no visible noon sakinah or tanween: 11.
  - **d:** a madd rule with no madd letter: 3.
  - **e:** the same example under two rules: 47, of which 27 name different families. Examples:
    عَابِدٌ مَّا as both إظهار and إدغام in 109; السماء as both مد طبيعي and مد متصل in 82, 84 and 85.
  - **f:** an inline label contradicts its heading: 9.
  - **g:** the highlight is missing from its example: 10.
- **The owner's two reports, located:**
  - **إدغام بغنة on an ikhfa letter:** مَن ثَقُلَتْ (ن → ث) in 101 `lib/quranData.ts:156`, also
    quizzed at `components/TajweedSection.tsx:63`/`:108`. The same textual pattern is a
    **candidate** in 84 `data/surahData.ts:102`, 97 `lib/lessonData.ts:86`,
    103 `lib/surahData.ts:62`, 105 `lib/lessonData.ts:85`/`:199` and
    114 `data/surahData.ts:82`. It also appears under a plain "إدغام" label in 90, 91, 100 and 113.
  - **مد لازم vs مد طبيعي:** 101 labels the same word القارعة (ayah 1) **both** مد طبيعي
    (`lib/quranData.ts:132`) and مد لازم (`:140`), and the final quiz marks it مد طبيعي
    (`components/FinalQuiz.tsx:94`). There is one more candidate in 99 `lib/surahData.ts:114`.
- **#13 Mushaf.**
  - No lesson renders a Mushaf view, Tajweed colours or madd marks (U+0653 count: 0).
  - Waqf signs appear only 22 times, in 8 lessons.
  - The text is simple imlaʾi script with ordinary diacritics, not Uthmani. 112 mixes in 35 alef
    wasla characters.
  - The Quran font is Amiri (sometimes Noto Naskh), loaded from Google Fonts. There is no
    KFGQPC/Uthmanic font.
  - The basmala is ayah 1 only in Al-Fātiḥah: correct.
- **So:** #13 can't be "fixed" in the current text; it needs the §C dataset (Uthmani text + reviewed
  Tajweed annotations + a Quran font). And because the classifications were hand-written, every
  label must be re-derived from that dataset, not patched one example at a time.

## C. One verified Quran foundation, shared by Materials and the whiteboard (PD-39)

**Root cause behind #2, #12, #13 and #17: there is no Quran data in the system.**
- Each of the 38 surah lessons was generated separately and hard-codes:
  - its own ayah text, ayah numbering and audio ids;
  - its own Tajweed labels.
- Nothing checks any of it against a source.
- PD-39 found the same gap in Chat: there is no ayah text anywhere, only surah metadata in
  `apps/api/src/materials/quran-surahs.ts` and `chat.quran_surah`.

Proposal: **one Chat-owned, versioned, pinned dataset** that both the lessons and the whiteboard read.

| Layer | Source (proposed) | Pinning and checks |
|---|---|---|
| Text | **Tanzil Uthmani (Hafs)**: a Unicode encoding of the Madinah Mushaf. CC BY 3.0: verbatim only, and the credit "tanzil.net" with a link is required. | Store the exact file and its SHA-256 in the repo. On import, check the totals: 6,236 ayat, each surah's count against `quran_surah`, and 114 surahs in canonical order. Load it into `chat.quran_ayah(surah, ayah, text_uthmani)` (PD-39's table, one table shared by both features). |
| Ordering | Canonical Hafs numbering 1–114 and ayah 1..n, from the same file | Lessons, games and quizzes take their ayah order from the dataset, never from a literal list. |
| Audio | **Per-ayah files** for one reciter (Mishary Alafasy 128 kbps, the lessons' current voice), addressed `SSSAAA`, **self-hosted** on the lessons origin. Each file carries a SHA-256 in a manifest. | A per-ayah file *is* its sync point, so playing a surah means playing its ayat in order: there is no timing table to drift. Word-level highlighting, if wanted later, would use verse/word segment timings for the **same reciter and the same file**. Quran.com API v4 chapter audio with `segments` or QUL (Tarteel) segment data are candidates (licence still to confirm). |
| Tajweed | A **published, reviewed annotation**, never hand classification and never a model's judgement. Candidates to evaluate: QUL's Tajweed-annotated text (it has a review and correction tool; licence not yet confirmed), or the King Fahd Complex's colour-coded Tajweed Mushaf data where its terms allow. | Before anything is shown, a **qualified Quran teacher of the academy signs off** each surah's rule list on a review sheet, as PD-39 proposes for the text. The dataset records who signed and when. A rule the reviewer rejects is not shown. |
| Fonts | Amiri Quran (OFL 1.1), as PD-39 proposes; KFGQPC Uthmanic Hafs if its terms allow embedding | bundled, never from Google Fonts |

The schema, the API and who builds what are agreed with PD-39 in `docs/product/quran-dataset-contract.md` (added by #176, which builds P0-2): PD-29 P0-2 builds it, and PD-39 consumes it.

Corrections to Tajweed (#2, #13) come **only** from that reviewed dataset and the teacher's
sign-off. This plan lists candidates for review (§B5); it does not rule on any of them.

## D. A safe way to change the lessons

The lessons can't be fixed in place on today's site. The live build is a frozen March build,
and every deploy from the repo is blocked; that block is what keeps the repo's malware away from
children. So an ordinary fix means deploying from the repo the security review said not to
trust. The options:

**(a) Clean the repo and keep it.**
- Steps: remove `muneeb787`'s access, protect `main`, delete `.vscode/` and the residue, and
  build only in CI or a disposable cloud sandbox, never on this Mac.
- Downsides:
  - It keeps 83 lessons as copy-pasted TSX with ~12 template variants. Every systemic fix (audio
    ids, shuffles, stars, sections) becomes ~38 hand edits.
  - The supply chain stays a risk: the history is infected, and the payload was re-added within
    one second of a cleanup.
- Cost: low at first, high for every fix after.

**(b) Move the content into Chat and rebuild the player in Flutter.**
- The cleanest supply chain, but it rewrites all 83 lessons' UI in Flutter.
- Admin Web previews would still need a web build.
- Cost: highest; months.

**(c) Recommended: a clean, Chat-owned lessons engine, with the content brought over as data.**
- **Where:** a new `apps/lessons` (Vite + React) in this repo.
- **How it's built:** only by CI, from a pinned lockfile.
- **Where it's served:** its own origin, the Chat-controlled snapshot origin that PD-29's B1
  already requires. `MATERIALS_SITE_BASE_URL` points there, and the paths stay
  `/lessons/<category>/<slug>`, so Chat needs no migration and no re-import.
- **One Quran-lesson engine** (intro, listen, verse by verse, Tajweed, meanings, games, quiz,
  stars):
  - reads the §C dataset;
  - reads one reviewed JSON file per surah: tafsir lines, word meanings, game configuration and
    lessons learned.
  - Every systemic bug in §B is then fixed once.
- **Content:** extracted from c231532 as **text only**, statically with `python3 -I`, never by
  copying code or config. Then reviewed.
- **Arabic lessons:** the same approach, with data per lesson.
- **Islamic studies:** the 35 lessons can stay on the frozen, verified snapshot until they're
  ported, because none of the P0 bugs is in them.
- **Rollout:** build Al-Buruj (#18) first as the engine's proof, then port the other 37 surahs.
- **Cost (estimate):** engine and dataset about 3–4 weeks of engineering. Then about half a day
  of extraction and fixing per surah, plus the teacher's review time.
- **Security:** no code from the infected repo ever runs. Completion events (P1) reach Chat
  without a JavaScript bridge (§E, P1-1).

**Do now, whichever option:** retire the lessons that play the wrong surah (§B1) in Admin Web →
Materials. A retired item leaves the child's library at once, with no deploy. Re-publish each one
when it's rebuilt.

## E. Phasing, PRs and owner questions

**P0: accuracy and functional bugs** (#1, #2, #4, #12, #14–#18). Each PR lands with its own tests;
the lessons are built only by CI.

| PR | Repo / where | What | Fixes |
|---|---|---|---|
| P0-0 | Admin Web (no code) | Retire surahs **101, 113, 89** in Materials until rebuilt (§D "do now"). | stops the wrong audio today |
| P0-1 | Chat **#166** (open) | Full-window lesson preview with a back button and full screen | #1 |
| P0-2 | Chat, API + migration (**#176**, owner-approved 2026-10-27) | **Quran dataset**: `chat.quran_ayah` (Tanzil Uthmani, SHA-256 pinned, count checks) shared with PD-39, an ayah audio manifest (`SSSAAA` + SHA-256), and the Tajweed annotation table with reviewer and date. The text is served read-only to the lessons engine as a static JSON snapshot built by CI. | foundation for #2, #12, #13, #17 |
| P0-3 | Chat `apps/lessons` | **Engine skeleton** on its own origin (CSP, no third-party hosts, fonts and audio self-hosted). Fixes the systemic patterns once:<br>• ayat, order and audio from the dataset (P1, P1b, P6);<br>• one audio controller that stops on change and unmount and never replays a stale object (P2–P5, P8);<br>• ayah-by-ayah playback, no timing tables (P7);<br>• options shuffled once per question, kept in state and answered by id (#16);<br>• games draw from every ayah;<br>• one section header in every lesson (#14);<br>• one star model with no farming (#15). | #2, #12, #14, #15, #16, #17 |
| P0-4 | `apps/lessons` content | **Al-Buruj (85) rebuilt** on the engine as the reference (#18, PR #192), then the other 37 surahs in batches of about 8, each one extracted as text from c231532 and reviewed.<br>• **Batch 1 (Juz' Amma 107–114):** rebuilt, every numbering matches the verified text, 43 lines held (`pd029-p04-batch1-review.md`).<br>• **Batch 2 (Juz' Amma 99–106):** rebuilt, every numbering matches (Al-Qari'ah's error was its audio only), 53 lines held (`pd029-p04-batch2-review.md`).<br>• **Batch 3 (Juz' Amma 89–98):** rebuilt; nine numberings match, and Al-Fajr splits ayah 23 (merged and renumbered, not stopped); 97 lines held (`pd029-p04-batch3-review.md`).<br>• **Batch 4 (Juz' Amma 78–84, 86–88):** rebuilt; nine numberings match, and **An-Nazi'at is split-and-stop** (ayah 40 split, ayah 46 never taught: merged, renumbered, missing); 81 lines held (`pd029-p04-batch4-review.md`). **Juz' Amma (78–114) is complete.**<br>• **Batch 5 (Al-Fatihah):** rebuilt; the Basmala is ayah 1 of 7 in the old lesson and the verified text alike, so the numbering matches; 3 lines held (`pd029-p04-batch5-review.md`). **Every old Quran lesson (1, 78–114) is rebuilt.**<br>• **All 114 surahs (owner, 2026-10-28: "make it the whole Quran"):** surahs 2–77 are text-and-recitation lessons -- the verified text with Listen, Verses and Order, no content file, nothing authored; the review gate is unchanged. A surah over 50 ayat shows 20 ayat a page, and its ordering game plays the page shown. 76 Materials rows added to the seed (no migration).<br>• **Check every old surah for the split-and-stop numbering pattern** found in Al-Buruj: the old lesson split real ayat 9–11 into 9 entries and so stopped at real ayah 16, and ayat 17–22 were never taught. Map each old entry to the verified ayat; merge the split pieces and flag missing ayat, as in 85.<br>• Content reaches children only after the Teachers department approves the file (`review.status`); until then the lesson shows the verified Quran only. | #18 → all |
| P0-5 | `apps/lessons` content | **Arabic lesson 1 Alif/Hamza** rewritten as data: real bare-ا words, a hamza unit, and one comparison rule (no folding) used by games and quizzes alike; full tashkeel on the strict rule for lessons 1–10. Design `pd029-p05-arabic-letters-design.md`, approved 2026-10-28: pausal sukun as the one final mark, enforced by the checker.<br>• **Engine (PR-1, #234) and lesson 1 (PR-2):** 32 units (ة its own unit after ت; one hamza unit with five seats after the 28 letters), 1,521 words, every changed word held (1,416, almost all the added final sukun); 4 words left out and listed; review doc `pd029-p05-lesson1-review.md`.<br>• **P0-5b (later PR):** writing practice (real strokes for every letter) and the memory, speed, bubble and catch games, left out of lesson 1 by the owner's decision of 2026-10-28. | #4, #11 tashkeel |
| P0-6 | Chat config | Point `MATERIALS_SITE_BASE_URL` at the new origin (no migration, same paths); re-publish the retired surahs | — |

**P1: progress, parents, rewards** (#7, #8, #10, #11 progress).

| PR | What |
|---|---|
| P1-1 | **Completion events without a JS bridge.** `open()` already mints a short-lived token. The engine posts `{section, item, stars, completed}` to a narrow `POST /materials/sessions/:token/events`, which records only what that token was issued for, so the engine never holds a child's identity or credentials. Append-only, like `chat.material_open`. |
| P1-2 | **Resume inside activities**: the last section, ayah or sentence per child and item, from those events (#11). Finished sentences are marked. |
| P1-3 | **Parent section** on the child's Materials page: achievements, completed activities, stars per surah (the "memorization stars" of #15) and Opened this week. Same readers as the library (#10). |
| P1-4 | **Teacher view**: a per-child report built from the same events, plus the existing lesson reports. Teacher comments and "understanding checks" ride the existing chat and lesson report, not a new messaging system (#7). |
| P1-5 | **Points and levels** (#8): a ledger fed by the events. Levels by thresholds, visible to the child's family and teacher only (owner question 6). |

**P2: new content and engagement** (#3, #5, #6, #9, #19). This is mostly content, design and
asset work, not code.

- **#3 repetition videos:** a per-surah `video` override that a teacher attaches. Chat already
  stores videos; the engine plays the override instead of the built-in audio when one is set.
- **#6 difficulty levels:** a child's level, set by the teacher on the Student Profile; a level
  per item; a library filter beside the age band.
- **#5 content for non-readers and #9 more interactive content:** illustrated stories, picture
  activities, audio-led games and quizzes, authored as engine content. Needs an illustrator and
  narration.
- **#19 more engaging games:** motion, sound, positive feedback and rewards in the engine's game
  kit. Design first, then one shared implementation.

**Owner questions** (each with a recommendation). All six are **DECIDED** as recommended; see "Owner decisions" at the top.

1. **Which path for the lessons?** *Recommend (c), the Chat-owned engine with content brought
   over as data.* Also: is there anything wrong in surah **order** that you saw outside the audio
   of 101, 113 and 89?
2. **Which Quran text and Tajweed source, and who signs off?** *Recommend Tanzil Uthmani (Hafs,
   CC BY 3.0, verbatim, credited) plus a published Tajweed annotation once its licence is
   confirmed. The academy's head Quran teacher signs a review sheet per surah before release
   (shared with PD-39).*
3. **Which reciter and audio hosting?** *Recommend Mishary Alafasy per-ayah files (the current
   voice), self-hosted with SHA-256, once you confirm the right to self-host them. Repetition
   videos (#3) come from teachers or an approved channel, attached per surah.*
4. **"Memorization stars for every surah" (#15): stars earned in the lesson, or a teacher's
   record?** The teacher-marked map was retired on 2026-10-26. *Recommend stars earned in the
   engine and kept per child (P1-3), not a revived map.*
5. **Difficulty levels (#6): how many, and who sets them?** *Recommend three levels (beginner,
   intermediate, advanced), set by the child's teacher.*
6. **Rewards and competitions (#8, #9): public or private?** *Recommend personal points and levels
   visible only to the family and teacher. Any competition is opt-in, within one teacher's group,
   with no public leaderboard of children.*
