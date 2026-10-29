# PD-49: an age-adaptive children's Quran experience for all 114 surahs (plan)

**State:** **Plan, docs only. DECIDED 2026-10-29.** The owner approved all 14 recommendations in §H, chose **public-domain sources only** (§A), confirmed a scholar reviewer, and fixed the pilot as 1, 112, 105 and 111. The decisions were relayed by the department head. No product code is written yet; the pilot build follows the department head's GO.
**Claim:** `docs/product/pd-registry/PD-49.md`. **Migration slot:** none for this plan. PR-2 and PR-3 (§G) will each ask the department head for one.
**Base:** `main` @ `02812e33`. Paths are relative to the repository root.
**Builds on:**
- PD-29 P0-3/P0-4: the `apps/lessons` engine, the pinned Tanzil text, the 38 extracted surah files, and all 114 surahs as Listen / Verses / Order (#247). Plan: `docs/product/pd029-materials-quality-plan.md`.
- The dataset contract: `docs/product/quran-dataset-contract.md`.
- PD-48: the id and clip-binding scheme for voice-over. Design: `docs/product/pd048-lesson-voice-over-design.md`.
**Not changed by this plan:**
- the Quran text and its pinning;
- the recitation gate (`quran.audio.enabled_for`, staff_test until the KFGQPC licence is recorded and a lawyer signs off);
- the rule that Quran recitation is never TTS.

The owner's request (2026-10-28) is quoted in full in the PR description. In short: all 114 surahs, with games and design that change with **surah length and the child's age** (from 3 years old). Also: verified word meanings, simplified tafsir, lessons learned, authentic asbab al-nuzul only, an assessment per surah, verse repetition, full-surah listening, verse-by-verse and whole-surah views, and above all **many varied games**. And: "Accuracy and authenticity must always come before the number of features or games."

Two follow-ups from the owner during planning:
- "The most important thing is to vary the games according to the length of the surah and the child's age." §B and §C are built around that.
- "Explore https://ayakids.com/ar and create something even better." The competitive analysis is §C.1. It was read from public pages only, with no account. The working notes are in the department head's notes folder, `pd49-ayakids-review.md`.

---

## 0. Summary

1. **Two kinds of content, two speeds.**
   - **Verified-text activities** are generated only from positions in the pinned Tanzil text: which ayah, which word, what order. Nothing in them is authored, so they need no per-surah review. They reach **all 114 surahs at once**, adapted to age and length, in the first engine PR. A scholar approves each **game mechanic** once (§C.4), not each surah.
   - **Knowledge content** is word meanings, tafsir, lessons, asbab, stories and quiz questions. It is written **for children, in our own words, derived from a named public-domain source** (al-Sa'di for tafsir, Ibn al-Ha'im for word meanings, the hadith collections and al-Wahidi for asbab reports; §A), **with a citation on every item**. A child sees it only after review: Teachers department for all of it, plus a qualified scholar for tafsir, asbab, lessons and stories. Content games unlock **surah by surah** as review finishes.
2. **Three axes of adaptation** (§B), so a 4-year-old on Al-Kawthar and a 10-year-old on Al-Mulk never get the same session:
   - **age band** (3–5, 6–8, 9–12) decides which mechanics are allowed and how they look (pre-reader or reader);
   - **surah length tier** (L1–L5) decides chunking, the number of rounds, and the order/recall game shapes;
   - **the child's level and progress** decide the difficulty inside a game, and what comes back for review.
3. **24 activity types** (§C), each tagged by band, tier, skill and data source. A session generator assembles a varied playlist from them. A child never plays the same mechanic twice in a row, and it rotates across days.
4. **Accuracy first** (§A, §F):
   - per-item review states in the database, bound to the SHA-256 of the exact text, as PD-48 does for clips;
   - an export of approvals into the repo, checked by CI;
   - **held text is never shipped in the bundle**;
   - no asbab without an authenticated report: where there is none, or the references disagree, the section does not exist;
   - Quran never typed (the existing checker).
5. **It works with audio off.** Every audio activity drops out of the playlist when the gate gives no recitation. There is no placeholder button (PD-48's rule). The 3–5 band is honestly weaker without audio. §D says what it gets meanwhile; the owner adopted §H Q5.
6. **Review and authoring are the bottleneck, not code** (§G.4). About 2,000 items for Juz' Amma plus Al-Fatihah: ~38 teacher hours and ~25 scholar hours. About 21,000 items for the whole Quran: ~600 reviewer hours. The phasing follows that.

---

## A. Sources (accuracy before features)

**Owner decision, 2026-10-29: "Only public-domain sources."** No permission letters are sent.
- Every source PD-49 derives from, and every source an item cites as its basis, is a work whose author's text is in the public domain.
- A **modern work may appear only as a reference** for an authenticity judgement: its title, volume/page and verdict, which are facts and citations. Its text is never used.
- Every child-facing line is **our own wording**, with a citation per item.

**How this was researched.**
- Web reading only, 2026-10-28. Nothing was downloaded, signed up for or run.
- The full notes, with a URL on every claim, are in the department head's notes folder:
  - `pd49-tafsir-sources-research.md`
  - `pd49-word-meanings-sources-research.md`
  - `pd49-asbab-sources-research.md`
- Copyright conclusions are an engineer's reading, not legal advice. **Optional:** counsel may confirm the public-domain status per market (§A.7). This is a note, not a blocker.

### A.0 What "public domain" means here

**Public-domain status depends on the jurisdiction.**
- Saudi Arabia, Egypt and Qatar protect a work for the author's life + 50 years.
- The EU protects it for life + 70, to the end of the calendar year.
- So a work can be free in one market and protected in another for a few more years.

**The author's text is not the same as the edition.** A modern critical edition (tahqiq) can carry the editor's own rights in its apparatus: footnotes, takhrij and gradings, introductions, added headings, indexes. Whether the editor's choice of readings in the main text is protected is unsettled.

**So every source is pinned to an edition that is itself free of modern apparatus**, recorded in `apps/lessons/src/content/sources.json`:
- the author and their death date;
- the edition: printer, place, year, and the volume/page scheme;
- why that edition is free: e.g. an early print with no modern editor, or a print whose editor died long enough ago;
- the markets where the work is still protected, if any.

If no such print can be identified for a work, the work is **not** a primary source. It may still be a cross-check, read by the reviewer from any copy, because the item cites the author's own words and position, never an editor's.

**Nothing from a source is shipped to children verbatim**, so the bundle carries our text only. The source is what the reviewer checks against.

### A.1 Simplified tafsir

| Role | Work | Status | Notes |
|---|---|---|---|
| **Primary** | **Taysir al-Karim al-Rahman fi Tafsir Kalam al-Mannan**, 'Abd al-Rahman al-Sa'di | The author died 22 Jumada al-Akhira 1376 AH = **24 January 1957** (often misdated 1956). **Public domain under life + 50 (Saudi Arabia, Egypt, Qatar) since about 2007.** **EU (life + 70): protected until 31 December 2027**, free from 1 January 2028. **US: possibly protected until about 2051–2053** (URAA, 95 years from the 1955–58 first printing; for counsel). Our own cited wording is unaffected; only verbatim text would be. | Clear, concise, lesson-oriented, and it largely avoids isra'iliyyat, which makes it the closest classical fit for children. **Edition:** NOT the al-Luwayhiq critical edition (Ula al-Nuha 2000 / al-Rushd 2008), whose apparatus is the editor's. Pin an early print with no modern editor's apparatus (§A.6, step 1). |
| **Cross-check 1** | **Ma'alim al-Tanzil**, al-Baghawi (d. 516 AH) | Public domain everywhere (author's text) | A concise, Sunni, narration-based tafsir widely regarded as sound in method (the scholar confirms). It is used to confirm the meaning of each ayah. |
| **Cross-check 2** | **Tafsir al-Quran al-'Azim**, Ibn Kathir (d. 774 AH), the full original | Public domain everywhere (author's text). Its modern abridgements (al-Misbah al-Munir, al-'Adawi's Sahih, etc.) are in copyright and **not used**. | Used for narrations and for checking that a meaning is the established one. It includes weak reports, so **nothing is taken from a narration in it without the asbab/hadith rule** (§A.3). |
| Reference only | Tafsir al-Jalalayn (al-Mahalli d. 864, al-Suyuti d. 911) | Public domain | Very short glosses, useful for word sense. **Caution:** it reinterprets some divine attributes (ta'wil). The scholar never accepts a line about Allah's attributes from it. |

**The EU caveat, applied.**
- Children see only our own wording, so no al-Sa'di text reaches any market.
- Until 1 January 2028, **no verbatim quotation of al-Sa'di appears anywhere in the product**, not even for reviewers inside the app. Reviewers read their own copy.
- The citation (work, volume/page) is a fact and is shown everywhere.
- If counsel advises (§A.7), EU-market accounts can be checked again in 2028. Nothing in the design depends on it.

### A.2 Word meanings (gharib)

| Role | Work | Status | Notes |
|---|---|---|---|
| ~~Primary~~ cross-check (see the decision below the table) | **al-Tibyan fi Tafsir Gharib al-Quran**, Ibn al-Ha'im (d. 815 AH) | Public domain (author's text) | Ordered by surah and ayah, so it maps to our positions. Glosses are short and accurate, but terse and in adult register (§A.5). **Edition:** to be pinned (§A.6, step 1); a modern edition may be read only for the author's words, never its notes. |
| Cross-check | **Tafsir Gharib al-Quran**, Ibn Qutaybah (d. 276 AH) | Public domain (author's text). The al-Sayyid Ahmad Saqr edition (1978) and others carry editors' apparatus. | The earliest standard gharib work. Ordered by surah. |
| **Primary** (decided 2026-10-29) | **Nuzhat al-Qulub (Gharib al-Quran)**, al-Sijistani (d. 330 AH) | Public domain; **a Bulaq print of 1295 AH (in a margin)** is reported, which itself has no modern apparatus | Alphabetical, so a reviewer's look-up, not a map |
| Reference | **al-Mufradat fi Gharib al-Quran**, al-Raghib al-Isfahani (d. 502 AH) | Public domain | Ordered by root, deep. For the scholar's look-up on hard words. |
| Reference | al-Sa'di and al-Baghawi (§A.1) | Public domain (§A.1) | They often explain the key word within the ayah's tafsir |

**Edition research (2026-10-29): *al-Tibyan* has no public-domain printing.** Only the modern critical editions of 1992 and 2003 exist. By §A.0 it therefore cannot be the primary. **DECIDED 2026-10-29 (department head, Option A of `docs/product/pd049-edition-pinning-brief.md`):** the primary is **al-Sijistani's *Nuzhat al-Qulub*, Bulaq 1295** (the text *al-Tibyan* is built on), with al-Sa'di's tafsir of the ayah where al-Sijistani has no entry. Ibn al-Ha'im becomes a cross-check. The table above is superseded on this point.

**Not used** (in copyright, so excluded by the owner's decision):
- KFGQPC's al-Muyassar fi Gharib al-Quran;
- al-Khudayri's al-Siraj;
- Makhluf's Kalimat al-Quran (protected to about 2040).
The Quranic Arabic Corpus is GPL and non-commercial, with no meanings. Quran Foundation and QUL have no Arabic meanings and grant nothing.

**Word positions.**
- Tanzil writes waqf marks (and ۞, ۩) as separate tokens.
- The engine numbers only tokens that contain a letter (`wordsOf`, `content/lesson-content.ts`), so a mark is never a word.
- The classical glossaries often explain **phrases**, so a meaning item is a **span**, `{ayah, word, to?}` (§F.1), and the checker verifies it.

### A.3 Asbab al-nuzul (reasons for revelation)

Three different things are needed for one asbab item, and each comes from a different place:

| What | Where it comes from | Status | How it is used |
|---|---|---|---|
| **The report** (what happened) | **The hadith collection itself**, e.g. Sahih al-Bukhari, Sahih Muslim or the Sunan; and the classical asbab works that collect them: **al-Wahidi, *Asbab Nuzul al-Quran*** (d. 468 AH) and **al-Suyuti, *Lubab al-Nuqul*** (d. 911 AH) | Public domain (authors' text). Modern editions' takhrij and gradings are the editors' and are not used. | Our child retelling is written from the report in the collection, cited by collection and number or volume/page. al-Wahidi and al-Suyuti point to the reports. **They never authenticate**: they include weak and unsourced reports. |
| **The authenticity judgement** (is the chain sound?) | Classical judgements where they exist (e.g. a report in al-Bukhari or Muslim; Ibn Hajar, *Fath al-Bari*, public domain). Modern judgements **by reference only**: al-Muzaini, *al-Muharrar fi Asbab Nuzul al-Quran*; al-Wadi'i, *al-Sahih al-Musnad min Asbab al-Nuzul*. | Classical: public domain. Modern: in copyright, so cited as a fact (title, volume/page, verdict) and **never quoted** | The item records each verdict and its reference |
| **Whether it is really the reason** (not just a related story) | The same two modern works, by reference. al-Muharrar rules on this explicitly for each report. | As above | Recorded as a fact on the item |

**The display rule (unchanged in strictness).** An asbab item is shown only when **all** of these hold:
1. al-Muharrar's verdict, cited by reference, is that the report **is** the reason for the verse;
2. the chain is graded **sahih or hasan**: by being in al-Bukhari or Muslim, by al-Muzaini, or, where he is silent, by al-Wadi'i;
3. **neither** reference grades it weak or rejects it as the reason. A conflict means it is not shown (§H Q14: the owner adopted "show nothing");
4. the scholar reviewer signs it, after checking the report in the collection and the verdicts against the printed books (§F.2).

Otherwise **there is no asbab section for that ayah: no placeholder, no "unknown", no weaker report.** The item stores:
- our retelling;
- the report's citation (collection + number, or volume/page in the pinned print);
- the verdicts' references (work, volume/page, verdict);
- the reviewer and the date.
**No text from a modern book is ever stored.**

**Juz' Amma and Al-Fatihah, as research leads only.** The scholar confirms every row against the printed books; this table is not a ruling.

| Lead | Surahs |
|---|---|
| Strong candidates: both references agree; the hadith is in al-Bukhari or Muslim | Al-Duha 1–3 (93); Al-'Alaq 6–19 (96); **Al-Masad (111, in the pilot)** |
| Likely | Al-Mutaffifin 1 (83) |
| **Disputed: show nothing** (rule 3) | An-Nazi'at (79): al-Wadi'i includes it, al-Muzaini rejects it · 'Abasa (80): the chain's grade is contested · Al-Kawthar (108): mursal per al-Wadi'i · **Al-Ikhlas (112, in the pilot)**: very weak per al-Muzaini, though others grade it hasan · Al-Kafirun (109): weak routes |
| Show nothing | **Al-Fatihah and Al-Fil (in the pilot)**; Al-Qadr (97); Al-Falaq and An-Nas (113–114: the sihr hadith is sahih, but the claim that it caused the revelation rests on weak reports); every other surah of the juz' |

### A.4 Hadith look-ups for reviewers

- **Dorar.net:** a live look-up by the reviewer only. Its terms forbid storage; nothing from it is stored.
- **HadeethEnc:** its published policy allows commercial use, unmodified and credited. It is not needed while every child-facing line is our own wording.
- The hadith texts themselves (al-Bukhari, Muslim, the Sunan) are classical and public domain. Only modern editions' numbering schemes and notes are editorial, so a citation names the numbering it uses (e.g. "al-Bukhari, Fu'ad 'Abd al-Baqi numbering").

### A.5 Where public-domain sources are weaker for children, and how the plan handles it

| Weakness | Effect | How authoring and review handle it |
|---|---|---|
| **Adult, classical register.** Terse glosses, rare vocabulary, long sentences (Ibn al-Ha'im, Ibn Qutaybah, al-Baghawi). Al-Sa'di is clearer, but written for adults. | The author has to do much more than shorten | **An authoring guide per band** (PR-5): vocabulary limits, at most one idea per sentence, sentence-length limits, concrete examples from a child's day, full tashkeel for readers. **A "meaning ladder" per item, recorded in its file:** the source's words → plain modern Arabic → the band's wording. The reviewer checks each step against the step before, so simplification never drifts from the source. |
| **Several opinions without a stated preference** (common in Ibn Kathir and al-Baghawi) | A child should get one clear meaning | The item follows **al-Sa'di's** stated meaning (the primary). If al-Sa'di gives several, the scholar chooses, and the choice and reason are recorded on the item. A child never sees "some scholars said…" below 9–12. |
| **Weak narrations and isra'iliyyat** (Ibn Kathir, al-Baghawi, al-Wahidi, al-Suyuti) | Risk of teaching an unauthenticated story | No narration enters a tafsir, story or lesson item unless it passes the asbab/hadith rule (§A.3, rules 2–4). Stories (activity 17) retell **only** the Quranic text's own account plus authenticated reports. |
| **Aqeedah differences in some classical works** (e.g. al-Jalalayn's ta'wil of attributes) | A wrong statement about Allah | Al-Jalalayn is reference only. Every tafsir item touching Allah's names and attributes is flagged `aqeedah` and needs the scholar, **even when a sampling rule would apply** (word items). |
| **Root-ordered or alphabetical glossaries** (al-Raghib, al-Sijistani) | Not keyed to an ayah; the sense must be chosen | Used only as cross-checks. The primary (Ibn al-Ha'im) is ordered by ayah, and the reviewer confirms the sense fits **this** ayah. |
| **No lessons or values written for children** | "Lessons learned" (feature 3) must be derived | Lessons are derived from al-Sa'di, who regularly draws out benefits (fawa'id), plus the ayah's plain meaning. Each lesson cites the ayah and al-Sa'di's place. The scholar reviews every one. |
| **Editions with modern apparatus** | The pinned print may be hard to find | §A.0's pin rule. The citation is to the author's words (surah:ayah, and volume/page in the pinned print). The reviewer may use any copy to read it. |
| **Coverage gaps** (al-Wahidi covers 81 surahs; gharib works skip "obvious" words) | Some ayat have no gloss or report | A missing gloss is written from al-Sa'di's tafsir of the ayah and cited to it. A missing report means no asbab section, by rule. |

**The cost:** authoring takes longer than it would from a modern children's-level source. The estimate in §G.4 rises from 3–5 to **about 5–8 minutes per tafsir item**. The pilot measures it.

### A.6 Steps before the pilot is written

1. **Pin the editions** (an engineer plus the scholar), for al-Sa'di, the word-meaning primary, al-Baghawi, Ibn Kathir, al-Wahidi and the hadith collections. The candidates, and a form the scholar can tick, are in `docs/product/pd049-edition-pinning-brief.md`. Record each in `sources.json` (§A.0) in a reviewed commit. A work with no pinned edition can be a cross-check but not the primary.
2. **Write the authoring guide** for the three bands, with three worked examples per kind, approved by the Teachers department and the scholar.
3. **Approve the respect rules and the mechanics** (§C.4) with the scholar.
4. Then write the pilot (§G.2).

### A.7 Optional: counsel

Not a blocker (owner, 2026-10-29). If counsel is consulted, the useful questions are:
- (a) the public-domain status of al-Sa'di in each market Jawwid sells to, given the EU end-2027 term;
- (b) whether citing a modern work's verdict by reference (title, page, verdict) needs anything.
The design already assumes the conservative answers: no verbatim al-Sa'di before 2028, and no modern text, only facts.

---

## B. Age bands, surah length and progression

### B.1 The three axes

| Axis | Values | What it decides | Where it comes from |
|---|---|---|---|
| **Age band** | **3–5** (pre-reader), **6–8** (early reader), **9–12** (reader) | Eligible mechanics, input style (tap a picture / tap a word / build / recall), target size, session length, whether timers or text-only prompts are allowed, explanation depth | Derived from the age Sales recorded (`chat.learner_enrollment.stated_age` + the years since `stated_age_on`). A parent or the teacher can move the child **one band** up or down (§H Q4). |
| **Length tier** | **L1** 1–8 ayat (18 surahs) · **L2** 9–20 (19) · **L3** 21–50 (30) · **L4** 51–120 (36) · **L5** >120 (11) | Segment size, number of rounds, whether whole-surah ordering is possible, and which recall shapes fit (next ayah, chain, theme sort, Journey map) | Computed from the verified text. The counts are from `data/quran/tanzil-uthmani-1.1.txt`: L1 = 1, 94, 95, 97–99, 102, 103, 105–114. |
| **Level and progress** | Level 1–3 per skill (set by the teacher, PD-29 owner decision Q5). Per-ayah and per-word mastery from the child's own results. | Difficulty knobs inside a game (§B.3). What is due for review. Which surah or segment is next. | Teacher's setting. The progress store (§B.5). |

**The band shapes the mechanics; the tier shapes the chunking.** Neither locks a surah.
- A 10-year-old on Al-Kawthar (L1) gets 9–12 mechanics on a one-segment surah: ayah numbers, first letters, tafsir comprehension and, if approved, its context.
- A 4-year-old on Al-Mulk (L3, a parent's choice) gets 3–5 mechanics on 2-ayah segments, five minutes at a time.

### B.2 Default paths (a suggestion order, not a gate)

| Band | Starts with | Then | Shown as |
|---|---|---|---|
| 3–5 | L1: Al-Fatihah, then 114 → 105 and 103, 108, 112 (short ayat first) | L2 surahs with short ayat (e.g. 93, 100, 101, 104) in 1–2-ayah segments | A path of large picture tiles. One surah "in focus" at a time. |
| 6–8 | All L1, then L2 | Juz' Amma L3 (78–92) in 3–5-ayah segments | A map of the juz'. |
| 9–12 | Juz' Amma | L3 to L5 by the family's or teacher's choice, in 5–10-ayah segments | The full index, with progress per surah and per segment |

**Segments.**
- L1–L2 are one segment, except for 3–5, who get 1–3 ayat at a time.
- From L3 on, a segment follows approved thematic boundaries where the source gives them; otherwise it is a fixed size (3–5: 2, 6–8: 4, 9–12: 8).
- Display paging (`lesson/pages.ts`, 20 ayat a page) stays as it is: pages are for reading, segments are for playing.
- Candidate for thematic boundaries: Tanzil's metadata (ruku', page, hizb), pinned like the text **after its licence is checked** (it is a separate file from the text).

### B.3 What changes inside a game (difficulty knobs)

| Knob | 3–5 | 6–8 | 9–12 |
|---|---|---|---|
| Options per question | 2 | 3 | 4 |
| Distractors | Far apart: another surah's ayah, a very different picture | The same surah, not adjacent | Adjacent ayat, similar words (level 3) |
| Unit | A whole ayah or a picture | Ayah, half-ayah (split at a verified word boundary) | Word, first letters, ayah number |
| Cues | Audio + picture + highlight | Text + audio (if available) | Text only. Then first letters. Then nothing (recall). |
| Rounds per game | 3 | 5 | 8 (L4–L5: up to 10) |
| Mistakes | Never "wrong": a gentle retry, then the answer is shown and praised. No lost stars. | Retry once, then the answer is shown | Score kept. A review list at the end. |
| Timers | Never | Never | Opt-in "challenge" only, level 3 |
| Session | ~5–7 min, 3 activities | ~10–12 min, 4–5 activities | ~15–20 min, 5–6 activities |
| Reading load | No instructions to read: icons, demonstrations, a grown-up reads | Short vowelled instructions | Normal |
| Touch targets | ≥ 64 px | ≥ 52 px | ≥ 44 px |

**The level (1–3) moves the knobs inside the band.**
- The teacher sets the level (PD-29 Q5). The engine never changes it.
- Within it, the engine can soften or stiffen **one step** of each knob, from the child's last two sessions on that skill:
  - ≥ 80% correct: one step harder;
  - < 50% correct: one step easier.
- The engine **suggests** a level change to the teacher in the teacher's report (P1-4). It does not make one.

### B.4 Spaced review

- Each ayah (memorisation skills) and each approved word (meaning skills) has a mastery value. It rises with correct recall and falls with errors and time.
- "Today's review" (activity 23) draws first from items that are due, across surahs.
- Intervals grow on success: 1 → 3 → 7 → 14 → 30 days. They reset to 1 on a miss.
- Nothing here marks a surah "memorised". That stays the teacher's mark in the lesson report (`chat.memorization_mark`), because the engine never hears the child recite. The engine reports "practised" and "understood" (§E).

### B.5 Per-child progress: what exists and what must be built

| Exists today | Notes |
|---|---|
| `chat.memorization_mark` | Teacher-marked status per (learner, surah). Append-only. The map UI was retired (#132); the data is kept. PD-49 reads it as the teacher's verdict and never writes it. |
| `chat.material_open` | Opens only. No results. |
| `StarLedger` (`apps/lessons/src/lesson/stars.ts`) | **In memory only.** Lost on reload. |
| P1-1 to P1-5 (completion events, resume, parent section, teacher view, points) | **Planned in PD-29, not built.** |
| Age | `stated_age` + `stated_age_on` on the enrolment, recorded by Sales (PD-16). There is no date of birth, and PD-49 does not add one. |
| Age groups in Materials | `4-6 / 7-9 / 10-12 / 13-17` (`apps/api/src/materials/vocab.ts`). This differs from PD-49's bands (§H Q3). |

**To build** (PR-2, with a migration slot from the head). It is P1-1, extended:

1. **Events, through the opener, never from the engine to the API.** This keeps the contract's rule "The lessons engine never calls the API".
   - The engine posts `{ type: 'jawwid:lesson-progress', events: [...] }` to its parent. It is accepted only by the build-time parent origins, as `jawwid:quran-audio` is now.
   - The signed-in opener (Admin Web, the Flutter WebView, the teacher web) forwards it to `POST /materials/progress`. The API ties it to the learner the opener is entitled to.
   - The engine never holds a child's id, name or token.
2. **`chat.lesson_progress_event`**: append-only. It holds:
   - organization and learner;
   - surah, segment, activity type, band and level;
   - the item scope (ayah range, word ids, quiz ids);
   - `correct` / `total`, completed, duration (seconds, coarse);
   - a client event id (idempotent);
   - `at`.
   **No free text, no audio, no device identifiers, no IP stored with it.**
3. **`chat.learner_quran_progress`**: a derived projection that can be rebuilt from the events. It holds:
   - per (learner, surah, ayah): mastery and next-due;
   - per (learner, surah, skill): last results;
   - per (learner, surah): stars, "practised", "understood".
4. **`chat.learner_lesson_band`**: an override of the band. Append-only history: who moved it, when and why.
5. **The profile the engine receives:** `{ type: 'jawwid:lesson-profile', band, levels, due: [{surah, ayah}] }`. Data only, without identity. Any extra field refuses it, as the audio list does.
6. **Offline tolerance.**
   - The engine and the text snapshot are static.
   - Progress events queue in the engine's own storage, wrapped in try/catch, and are sent when the opener is reachable. Their event ids make a resend harmless.
   - A lost queue loses stars, never correctness.
   - Audio is **not** offline. Signed URLs are `no-store` by contract.

**Privacy (children's data minimisation).**
- Collect only what adapts the lessons and informs the family and teacher: results per item.
- No analytics SDK, no third-party host (the existing CSP), no ads, no tracking pixels.
- No voice recording in v1. (AyaKids' "record yourself" is a child's voice, so it is personal data. If it is ever built, it stays on the device and is never uploaded.)
- Visible only to the family, the child's teacher, their supervisors and the Teachers department, as for lesson reports. Points and levels stay private (PD-29 Q6).
- Retention: raw events 13 months, then only the projection is kept. Both are deleted with the learner under the existing deletion process. The family can see everything in the parent section (P1-3).
- **External links:** none in the child's view. Tanzil's CC BY credit stays visible. Its link moves behind a parent gate ("About this lesson"), so the credit is kept and the child never leaves the app.

---

## C. The game and activity catalogue

### C.1 Competitive analysis: AyaKids (the owner's benchmark)

**How it was read.**
- `ayakids.com/ar`, on 2026-10-28, in a browser, **public pages only**.
- No account was opened, no login or trial, no data entered, no app installed, and no game started: every game needs a login before it starts.
- **Behind the login or paywall, not seen:** the games while playing, the illustrated tafsir pages, the parent and teacher reports, the student profile.
- Everything below is either what their public pages say about themselves (marked *they state*) or what was observed in the browser (marked *observed*).
- PD-49 copies none of their text, art, audio, character names or assets. Their mechanics are described in our own words, and PD-49's activities are designed afresh.

**What they offer**

| Area | Findings |
|---|---|
| **Positioning and age** | An Arabic-language and Quran-memorisation platform for children. *They state* ages 4–12, with simple letter games for the youngest and memorisation for older children. Their own description puts the Quran games in the older group. There is no age setting in the public flow. |
| **Games** | *Observed:* 24 Quran games on the games index, almost all for **memorisation and order**. The mechanics, in our words:<br>• a dice board where squares ask for an ayah's number, which of two ayat comes first, or a recitation from first letters; traps and shields; a review list at the end;<br>• a quiz in a teacher's voice: next ayah, previous ayah, continue the recitation;<br>• climbing a ladder, one rung per ayah recited;<br>• words disappearing step by step, or reduced to first letters;<br>• five stages per ayah, from hearing to reciting alone, with the reciter's voice fading at the cut point and a paid hint;<br>• re-placing cut lines of a Mushaf page;<br>• the end of one ayah joined to the start of the next, against the clock;<br>• spotting intruder words that came from a similar ayah;<br>• a locked-door maze, a code lock, gift boxes, word catching, a bridge, food assembly, train wagons, start↔end matching, flip and stacked cards of surah names, a timed memory game, complete the ayah, guess the surah from its audio.<br>Also non-Quran "break" games (noughts and crosses, balloons, spot the difference). |
| **Progression** | *Observed:* three levels inside some games (beginner, intermediate, "hafiz": shorter timers, more traps, weaker cues), **chosen by the adult**. A juz' map from juz' 30 down to juz' 1, in three stages, shows started/not started per juz'. *They state:* a Tajweed track of 23 stations on the matn Tuhfat al-Atfal, each tagged beginner/intermediate/advanced. |
| **Verses, meanings, tafsir, stories** | *Observed:* the tafsir page is "Juz' Amma for children": hear the ayah, see its meaning, simple words, a lesson to live by; illustrated; **subscribers only**. Only Juz' Amma is listed. **No source, author or reviewer is named on the public page.** There are no public word-meaning, asbab or story sections. The teacher whiteboard *they state* inserts ayat in Uthmani script and opens a colour-coded Mushaf. |
| **Audio and repetition** | *They state:* word-by-word highlight following the reciter, a fading voice at the cut point, six reciters (whiteboard), and a repetition counter (whiteboard). The source and licence of the recitations are not stated on the pages read. |
| **Rewards and motivation** | *Observed / they state:* stars, badges and "virtual gifts"; gems and shields in the board game; downloadable certificates in several designs. On the public certificate samples, one celebration certificate carries a verse about death and trial, and one mixes an English word into the Arabic: a sign that verse choice is not reviewed. |
| **Parent and teacher features** | *They state:*<br>• teachers add unlimited children; each child logs in with a username and password from the teacher;<br>• progress reports for parents and teachers;<br>• a live whiteboard a student opens from a link with no account;<br>• lesson video recording;<br>• sharing to WhatsApp;<br>• support by WhatsApp and e-mail.<br>The design centres on **a teacher running a session** (several game pages open with "how to use it in class"). |
| **Visual style** | *Observed:* a purple-to-violet gradient, white rounded cards, emoji as icons, Noto Sans Arabic, a light/dark toggle, RTL (`dir="rtl"`, `lang="ar"`), and a floating WhatsApp button on public pages. |
| **Business** | *Observed:* a 7-day free trial, then EGP 85 a month or EGP 650 a year (≈ $1.7 / $13.3), plus academy plans. |
| **Privacy and tracking** | *Observed:*<br>• the public home page loads **Google Tag Manager and Google Analytics** after scrolling;<br>• the privacy policy lists "usage and analysis information" and **marketing and advertising cookies**, while the site says it has no ads and the policy says data is not shared with third parties;<br>• the policy has no section on children's data.<br>Whether the child area loads the same tags was not checked: it is behind the login. |

**What they do well** (to match):
1. Many short mechanics over the **same** data, so there is variety without hand-authoring each surah.
2. **Real recall** (first letters, fading words, a fading voice), not only multiple choice.
3. Difficulty levels inside a game.
4. A review list at the end of a game.
5. Board-game framing that makes review feel like play.
6. A clear juz' map of progress.

**Where they are weak:**
1. **Understanding.** Nearly everything is memorisation. Meanings and tafsir cover Juz' Amma only, behind a paywall, with no visible source.
2. **Sourcing and review.** No source, author or reviewer is named publicly, and certificate verse choice looks unreviewed.
3. **Adaptivity.** The adult picks a level per game; nothing adapts to age, surah length or the child's record.
4. **The youngest.** Their floor is 4, and the Quran games assume reading. Timers are common.
5. **Respect for the text.** Several mechanics treat verse words as objects to catch, stack or assemble into food.
6. **Privacy.** Google Analytics on public pages, and marketing cookies named in the policy of a children's product.
7. **Independence.** Built for a teacher in the session. A child alone gets less guidance.

**Theirs → ours, better because…**

| Theirs | PD-49 | Better because |
|---|---|---|
| ~24 games, almost all memorisation | 24 activity types across **six skills**: 10 for understanding, values and context (§C.2) | The owner's goal is understanding as well as memorisation |
| The adult picks a level per game | **Automatic adaptation**: band × length tier × the child's record, inside the teacher's level (§B) | The right challenge without setup, and it changes as the child improves |
| Quran games assume reading; ages 4+ | A **3–5 pre-reader mode**: pictures, audio, one big tap, no text instructions, no timers, no failure (§B.3) | Reaches 3-year-olds, as the owner asked |
| The same game whatever the surah's length | **Length tiers** decide segments, rounds and which shapes appear: no 40-ayah ordering game, but chain, theme and journey for long surahs (§B.1, §C.3) | Long surahs stay playable, and short surahs aren't padded |
| Tafsir for Juz' Amma only, no visible source | Meanings, tafsir, lessons, stories and **authenticated asbab only**, for all 114 as review allows, **every item cited and reviewed** (§A, §F) | Accuracy before features, as the owner put it |
| Words caught, stacked or assembled into food | **Respect rules**: no altered ayah is ever shown, no verse used as an object, each mechanic approved by a scholar (§C.4) | Reverence, and no child sees a wrong "ayah" |
| A fading voice and word highlight | Ayah-level fade and highlight in v1; word level when timing data for **our licensed recitation** exists (§D) | Never shipped with timings that drift, the PD-29 §B1 bug class |
| Stars, gems, certificates | Stars that can't be farmed; points visible to the family and teacher only; no public leaderboard (PD-29 Q6). Certificates via PD-41 with verse choice reviewed. | Motivation without comparison between children |
| Teacher-led sessions | A child alone **and** a teacher's report (P1-4). The teacher's recitation check stays the only "memorised" mark (§E). | Fits Jawwid's model: teachers already meet the children |
| Analytics tags on the site; marketing cookies in the policy | **No analytics SDK, no third-party hosts** (CSP), progress events only, 13-month retention (§B.5) | Children's data minimised by design |
| Floating WhatsApp and social links | **No external links in the child's view.** Credits sit behind a parent gate (§B.5). | A child can't leave the lesson by accident |
| Break games unrelated to the Quran | Skins and rewards **inside** the learning activities (§C.2) | Engagement that is still learning |

### C.2 The catalogue (24 types)

The **Data** column says what each type needs:
- **V**: verified text only, so it works for all 114 surahs at once;
- **M**: approved word meanings;
- **T**: approved tafsir;
- **L**: approved lessons;
- **A**: approved asbab;
- **S**: approved story panels;
- **Q**: the approved quiz bank;
- **P**: approved illustrations.
- 🔊 means it needs recitation and drops out when audio is off.

| # | Activity (ar / en) | Skill | Data | 3–5 | 6–8 | 9–12 | Tiers |
|---|---|---|---|---|---|---|---|
| 1 | اسمع والمس · Listen & Glow 🔊 | listening | V | The ayah card glows as it plays; tap to play again; a bead per listen | — (warm-up only) | — | L1–L2 |
| 2 | ردّد معي · Echo 🔊 | recitation | V | One ayah, a pause for the child to repeat, 3× | 1–2 ayat, 5× | A range, N× (§D) | all |
| 3 | أيّ آية سمعت؟ · Which did you hear? 🔊 | recognition | V | 2 big cards, a shape and colour per card (not colour alone) | 3 text cards | 4 cards, adjacent ayat | L1–L3 |
| 4 | عُدّ الآيات · Count the ayat | structure | V | Tap each ayah as it lights; count together | How many ayat? (3 options) | — | L1 |
| 5 | صورة ومعنى · Picture & meaning | meaning | M+P | Hear the word (voice-over, PD-48), tap 1 of 2 pictures | 3 pictures, word shown | — | L1–L2 |
| 6 | طابق الكلمة بمعناها · Match word ↔ meaning | meaning | M | — | Flip-card pairs, 3 pairs | 5 pairs; level 3: similar meanings | all |
| 7 | ركّب الآية · Build the ayah | order (word) | V | — | ≤ 6 words, the first word placed | Full ayah; level 3: the next ayah too | L1–L3 (L4–L5: short ayat only) |
| 8 | أكمل الآية · Complete the ayah | recall | V | — | Pick the missing word (3) | Missing 2 words; level 3: type-free first-letter pick | all |
| 9 | رتّب الآيات · Order the ayat | order (ayah) | V | 2 cards: which comes first? | The whole surah (L1–L2) or segment | Segment; level 3: two segments | all |
| 10 | بداية ونهاية · Start ↔ end | recall | V | — | Match 3 halves | 5 halves, similar endings | L1–L3 |
| 11 | ما الآية التالية؟ · What comes next? | order/recall | V | — | Choose the next (3) | Choose the next and the previous (4); chain mode across segments | L2–L5 |
| 12 | المحو التدريجي · Fading ayah | recall | V | — | Words fade in 3 steps; recite aloud; tap to reveal (self-check) | 5 steps, then first letters only | all |
| 13 | رقم الآية · Ayah number | structure | V | — | — | What number is this ayah? Which comes first? | L2–L5 |
| 14 | رحلة السورة · Surah journey (meta-game) | all | V+ | A path of 3 stops with big stickers | A map: each stop is a mini-game for a segment | A board with shortcuts for streaks and a "review list" at the end | L3–L5 (L1–L2 as a short path) |
| 15 | مراجعة اليوم · Today's review | spaced recall | V(+M) | 2 due ayat, as listen and echo | 5 due items, mixed mechanics | 8–10, across surahs | all |
| 16 | أحسنتَ أم لا؟ · Good deed sort | values | L+P | Drag a picture to 😊 or 😟 (also labelled with text and shape) | 4 cards with text | — | surahs with behaviour lessons |
| 17 | حكاية السورة · The surah's story | comprehension | S+P | 3 panels read aloud; tap the next panel | 4–5 panels; put them in order | Panels + "what does this teach?" | narrative surahs (e.g. 105, 106, 111, 80, 85) |
| 18 | ما الدرس؟ · Which lesson? | values | L | — | Choose the lesson the surah teaches (3) | Which ayah teaches this lesson? | all |
| 19 | صح أم خطأ · True or not? | comprehension | Q(T) | — | Statements from the approved bank, 2 buttons with icon and word | + "why?" choice | all |
| 20 | فهمتُ الآية · Understand the ayah | comprehension | T+Q | — | Read or hear the simplified tafsir, then one question | Two questions; level 3 compares two ayat | all |
| 21 | لماذا نزلت؟ · Why was it revealed? | context | A | — | — (not for this band, §A) | The approved account, then 1–2 questions | **only** surahs with an authenticated report |
| 22 | موضوعات السورة · Theme sort | comprehension | T (themes) | — | — | Drag ayat or segments to approved theme headings | L3–L5 |
| 23 | كلمات متشابهة · Similar ayat | precision | V + reviewed pairs | — | — | Two real ayat side by side; find where they differ (both verified, nothing altered) | L4–L5, after a scholar-reviewed list of pairs exists |
| 24 | تأمّل · Think about it | reflection | L | Ask your grown-up (a picture prompt) | A question with idea cards | A question plus ideas; answered aloud, never typed or stored | all |

Count by skill: listening and recitation 2; recognition and structure 4; order and recall 7; meaning 2; comprehension and values 7; context 1; meta 1. That is at least 15 distinct types per band in 6–8 and 9–12, and 11 that a 3–5 child can use. Activities 1–4, 7–15 (V) are live for all 114 surahs from PR-1.

**Deviation, as built in the first game PR (#261): 3–5 distractors come from the same surah, not another one.**
- They are drawn far ones first: the ayat furthest from the target, never one with the same text.
- **Why:** a pre-reader matches what was heard against what is shown. A far ayah of the surah being learnt is already easy to tell apart, and every card the child touches is still an ayah of that surah.
- Another surah's ayah would also need a second verified surah loaded for each game.
- **Revisit** when levels exist: "another surah" may be the easiest level 1.
- The teacher and the scholar see this choice in the mechanic's record when they sign it.

**As built (PR-A: games 7, 9, 10, 11, the verified-text order and recall games).**
- **Build the ayah (7).** The tiles are one ayah's own words, each with the pause mark after it, so the tiles joined ARE the verse.
  - A tile out of turn is refused where it sits. The line only ever holds the ayah's words in their order, and the rest shows as blanks. Once built, the whole verified ayah is shown.
  - Only ayat of 3–6 words (6–8, first word placed) or 3–10 (9–12) are built. Longer ayat are not cut, so L4–L5 build their short ayat only.
- **Order the ayat (9).**
  - 3–5: two neighbouring ayat, "which comes first?". With recitation, each card can be heard.
  - 6–8 and 9–12: up to 5 (6–8) or 6 (9–12) ayat of the segment, cut as evenly as possible (7 by 6 is 4 and 3), never more than the band's size. The child touches the one that comes next, and a card out of turn is refused.
  - A card shows no number until it is in place. Two ayat with the same words are never asked to be told apart.
- **Start ↔ end (10).** Real ayat of at least four words, cut in the middle at a word boundary. The pairs are drawn from the seed. For 9–12, the pairs sharing the commonest rhyme (the ayah's last letter) come first, so the ends cannot be told apart by their sound.
  - A half is marked "…" where it was cut, and named "the start/end of an ayah" for a screen reader. A wrong end is refused, so no joined text is ever shown.
  - A match becomes the whole verified ayah. Pairs come from the segment first, then the nearest ayat (similar endings for 9–12).
- **What comes next? (11).** The prompt is shown whole, with its number; the choices are whole ayat, unnumbered until answered.
  - Wrong choices: 6–8 never a neighbour of the prompt or the answer; 9–12 the nearest ayat. 9–12 is also asked "what comes before?" every other question.
  - **One answer only.** A refrain (an ayah whose words recur, e.g. 55:13…, 77:15…, 54, 26) is never the prompt, and no wrong choice is itself next to an ayah with the prompt's words, in either direction.
- **Mistakes follow §B.3.** 3–5 gets two tries, then the answer is shown and praised; 6–8 and 9–12 get one. **9–12 ends a game with a review list**: the whole ayat it missed, never the wrong choices. The child moves on when ready.
- **A game that cannot be played on a segment is not offered** (`FITS` in `PlayLesson.tsx`), rather than shown and skipped. Examples: no ayah short enough to build, or fewer than two long enough to cut.
- **The grown-up's controls are folded behind "⚙ للكبار"**: the child sees the game, not the settings.
- **Deviation: the grown-up moves the age band one step up or down** (§B.1, §H Q4) from the page's starting band, and the sitting restarts for it. The page has no profile yet (§B.5 item 5), so it starts at 3–5; the opener's profile will set the starting band once it exists.

**Game "skins"** (garden, sea, stars, desert caravan) change only the decoration and the reward animation, never the mechanic. They rotate per surah, so two surahs feel different even with the same mechanic. Skins carry no text and no Quran.

### C.3 The session generator (how variety is guaranteed)

For one child on one surah (or segment), the engine builds a playlist. It is deterministic from `(surah, segment, band, levels, date)`, so it can be tested and reproduced:

1. **Stages in order:** learn (listen, view, tafsir) → understand (meaning, story, lesson) → practise (order, recall) → check (a mini-quiz, or the assessment at the end of the surah).
2. **Eligible activities:** those allowed for the band, fit for the tier, whose data exists and is approved for this surah, and whose audio need is met.
3. **Variety rules:**
   - never the same mechanic twice in a row;
   - prefer the mechanics this child played least recently on this surah;
   - at least one "understand" activity whenever approved content exists;
   - the skin rotates.
4. **Length:** by band (§B.3). A child can always replay, skip forward or stop.

**As built (#261):**
- **The seed** is FNV-1a over `(surah, segment, band, levels, date)`. `levels` is `''` until the teacher's per-skill levels exist. Each game's seed derives from the sitting's seed.
- **Variety:** the previous segment's last mechanic does not open the next one. "Least recently played" waits for the progress store (§B.5).
- **Recitation:**
  - a sitting waits up to 2 s for the recitation list, then is built and frozen for its segment;
  - a list that arrives later is used from the next segment on;
  - a segment gets the mechanics that need recitation only when every one of its ayat has a file.
- **The grown-up's controls:** replay, skip and stop are always there.
- **Counting** counts the segment, like every game, not the whole surah again in each segment.
- **Only mechanics with a game in the engine are offered**, so a signed mechanic with no game never shows praise.

### C.4 Rules every game obeys

- **Respect for the Quran text** (one scholar sign-off per mechanic, recorded in the review system):
  - a verse or word is never popped, shot, eaten, stepped on, thrown away, shown upside down or used as an obstacle;
  - a wrong option is never inserted into an ayah: it is refused where it sits;
  - **no altered ayah is ever displayed**. Distractors are other real, verified ayat or words, shown as themselves. Games may hide units, reorder whole units, or split at a verified word boundary; they never produce a sequence that reads as Quran but is not.
- **Accessibility:**
  - RTL;
  - right and wrong are never shown by colour alone (icon + word + shape);
  - targets ≥ 44 px (larger for younger bands, §B.3);
  - `prefers-reduced-motion` honoured;
  - every control labelled for screen readers;
  - font size control, with Quran text in the bundled Amiri Quran.
- **The PD-29 engine rules still apply:** options shuffled once per question and answered by id, every ayah drawable, no star farming, one audio controller.
- **No ads, no external links, no data beyond progress** (§B.5).
- **No music with instruments** in the default (§H Q7): voice and simple sound effects, plus a mute control.
- **As built (#261):**
  - there are no sound effects; the only sound is the recitation. So the mute control is "no recitation", which restarts the sitting with the mechanics that work without it.
  - The verse size control has four steps.
  - A verse card's accessible name is what it shows: the ayah number, then the verse. Progress beads are read as text.
  - **Signing a mechanic signs its code:** the record carries `code` (its file in `play/games/`) and `codeSha256`. That is the SHA-256 of that file plus the shared play code:
    - `common.tsx`, the card;
    - `adapt.ts`, the band's knobs such as tries before the answer is shown;
    - `session.ts`, `PlayLesson.tsx` and `PlayRoute.tsx`, which gives the page its band and recitation;
    - `mechanics.ts` and `signed.ts`, the registry and what may sign it;
    - `games/shuffle.ts`, which places the answer;
    - `audio/audio-controller.ts` and `audio/audio-manifest.ts`, the recitation and its verified list;
    - `quran/dataset.ts`, the loader of the verified text;
    - `play/play.css`, the games' stylesheet (how a verse, a tile or a blank is shown), and `styles.css`, the engine's base styles, whose buttons, notes and page the games also use. A lesson style change therefore re-opens every mechanic's review.

    `route.ts` only maps a path to a surah number, and `App.tsx` only renders `PlayRoute`, so neither is covered. Which games may be played (the registry, `play.json`, the keys) is fixed at build time in `signed.ts`: no page passes them to `PlayLesson`.

    Each file is hashed with its path, and CRLF is read as LF. `check-quran-content.py` refuses a hash that does not match. Changing any of these changes the record, so every mechanic must be signed again.
  - **Progress, v1:** stopping, or turning the recitation off or on, restarts the current game; the recitation toggle restarts the whole sitting. Nothing done so far is kept. That is accepted for v1, and it is safe: no star or progress is recorded yet (§B.5).

---

## D. Verse repetition, full-surah listening, verse-by-verse and whole-surah views

All of this runs on the existing `AudioController`: one controller, stop on any change, `playThrough`, and `repeat` that never replays a stale object. With audio off, every play control is **absent**, never disabled with a placeholder.

| Feature | Design |
|---|---|
| **6. Repeat a verse** | Loop count 1, 3, 5, 7, 10 or "until I stop", shown as beads (a count, not a colour). An optional "my turn" pause after each play, as long as the ayah (echo mode). A range loop (ayat a–b × N) for 9–12. Any navigation stops the loop (the controller's `select()`). |
| **Speed** | **Not in v1.** Browsers can change `playbackRate` with pitch kept, but slowing a recitation needs (a) the KFGQPC licence terms, once recorded, not to forbid it, and (b) the scholar's approval (§H Q11). Until both, there is no control. |
| **7. Full surah** | "Listen to the whole surah": ayah by ayah (`playThrough`), with the current ayah highlighted and kept in view. Long surahs continue across display pages. Pause and resume at the ayah. The Basmala is drawn from the dataset's `basmala` field and is not counted as an ayah, except in Al-Fatihah. |
| **8. Views** | **Verse by verse:** one large ayah card. Listen, repeat, the band's tafsir (if approved), tap a word for its approved meaning, then Next. **Whole surah:** flowing text with ayah markers, paged for long surahs (existing `pages.ts`), with "listen to all" and tap-an-ayah-to-open-its-card. A toggle switches between the two and keeps the position. |
| **Word highlight** | Ayah level only in v1. Word-level highlight and a fade at a word cut point need timing segments for the **same** recitation file. That means a separate source and licence, stored keyed to the file's SHA-256 (contract, "Audio"). It is a later item. |
| **With audio off** | Verse-by-verse and whole-surah reading, tafsir, meanings and every V/M/T/L/Q activity stay. The 🔊 activities leave the playlist. For 3–5, a "with a grown-up" mode replaces audio prompts with a short instruction for the adult ("read this ayah to your child, then tap ✓"). |
| **Voice-over for explanations** | Pre-readers need explanations, meanings and instructions **heard**. These are lesson strings, so they can use PD-48's TTS pipeline: every clip approved by two teachers, bound to the text hash, under its own gate (`lesson_audio.enabled_for`). **The Quran itself is never voiced by TTS.** The PD-48 plan script refuses typed Quran, and PD-49's tafsir text carries Quran only as positions (§F.2). Until clips are approved, the explanation shows as text for the grown-up to read. |

---

## E. Surah assessments

The assessment comes at the end of the surah, or of each segment for L3–L5. It draws only from:
- positions in the verified text (V);
- **approved** word meanings, for meaning questions, with distractors drawn from other approved meanings of the same surah;
- the **approved** quiz bank: authored items reviewed like every other item, with categories `hifz | meanings | tafsir | lessons | asbab`.

| Band | Form | Questions | Pass |
|---|---|---|---|
| 3–5 | "Show me!": a celebration, not a test. Audio and pictures. | 3–5: which ayah did you hear, picture meaning, good-deed sort | **No pass or fail.** Recorded as "practised". The parent sees what went well. |
| 6–8 | Short quiz, retry allowed | 6–10: next ayah, complete the ayah, word ↔ meaning, which lesson, one tafsir question | ≥ 70% and at least one correct in each category present → "understood" |
| 9–12 | Quiz with a review list | 10–15: the above plus ordering, ayah number, true-or-not, theme, and asbab where approved | ≥ 80%, with each category ≥ 50% → "understood" |

**Feeding progress:**
- A pass marks the surah or segment "understood" and adds a star (once, not farmable).
- Wrong answers put those ayat and words into today's review (§B.4).
- A fail is never a dead end: "let's practise these" leads to a short playlist of the weak items, and the retake draws different questions.
- **"Memorised" is never set by the engine.** The teacher's recitation check in the lesson report sets it (`chat.memorization_mark`). The teacher sees the engine's "understood" beside it.

---

## F. Data model and review workflow at 114-surah scale

### F.1 One file per surah, schema v2

- `apps/lessons/src/content/surah-NNN.json` stays, one file per surah, with `"schema": 2`.
- The resolver keeps reading v1 files until the 38 are migrated.
- Everything in it is **prose plus positions**, as now. The checker `scripts/lessons/check-lesson-content.py` keeps refusing typed Quran (4+ consecutive verse words).

```jsonc
{
  "schema": 2, "surah": 112, "datasetId": "tanzil-uthmani-1.1",
  "lessonKey": "quran-112",                       // PD-48 lesson_key form ^[a-z]+-[0-9]{3}$
  "retiredIds": [],
  "segments": [{ "id": "seg-001", "from": 1, "to": 4, "theme": "theme-001" }],
  "items": [
    { "id": "intro-001",    "kind": "intro",   "bands": ["3-5"], "text": "…", "source": null },
    { "id": "tafsir-001",   "kind": "tafsir",  "ayah": 1, "bands": ["6-8","9-12"], "text": "… {{w:1:4}} …",
      "source": { "work": "saadi", "ref": "112:1", "page": "vol./p. in the pinned print" }, "crossCheck": { "work": "baghawi", "ref": "112:1" },
      "ladder": ["<the source's sense, our words>", "<plain modern Arabic>"] },          // §A.5: each step checked against the one before
      // {{w:a:n}} is a POSITION: the engine draws the word from the verified text
    { "id": "tafsir_x-001", "kind": "tafsir_extra", "ayah": 1, "bands": ["9-12"], "text": "…", "source": { "work": "saadi", "ref": "112:1" } },
    { "id": "word-001",     "kind": "word",    "ayah": 1, "word": 4, "to": 4, "text": "…", "source": { "work": "ibn-haim-tibyan", "ref": "112:1" }, "picture": null },
      // a span: words 4..to of the ayah, counted as wordsOf() counts them (mark-only tokens are not words)
    { "id": "lesson-001",   "kind": "lesson",  "bands": ["3-5","6-8","9-12"], "text": "…", "behaviour": "good", "source": { "work": "saadi", "ref": "112" } },
    { "id": "asbab-001",    "kind": "asbab",   "ayah": [1,4], "bands": ["9-12"], "text": "…",
      "source": { "work": "bukhari", "ref": "<numbering scheme + number>" }, "pointer": { "work": "wahidi", "ref": "vol./p." },
      "verdicts": [ { "work": "muzaini-muharrar", "ref": "vol./p.", "verdict": "is the reason; chain sahih" },     // facts by reference, never text
                    { "work": "wadii-sahih-musnad", "ref": "p.", "verdict": "…" } ] },
    { "id": "story-001",    "kind": "story",   "order": 1, "text": "…", "picture": "pic-005", "source": { … } },
    { "id": "theme-001",    "kind": "theme",   "text": "…", "source": { … } },
    { "id": "quiz-001",     "kind": "quiz",    "category": "tafsir", "bands": ["6-8","9-12"], "question": "…",
      "options": [{ "text": "…" }, { "ayah": 2 }], "answer": 0, "source": { … } }
  ]
}
```

- **Ids follow the PD-29 / PD-48 contract unchanged:**
  - `<unit>-NNN`, where the unit is a hyphen-free slug for the item kind (`tafsir`, `tafsir_x`, `word`, `lesson`, `asbab`, `story`, `theme`, `quiz`, `intro`);
  - assigned once, never renumbered; a removed id goes to `retiredIds`;
  - text stored in NFC;
  - so `(lessonKey, id, sha256(text))` is exactly PD-48's clip binding, and voice-over can bind later with no change.
  - Three digits allow 999 per kind per surah. Al-Baqarah has 286 ayat and should gloss well under 999 words. If a kind ever needs more, that is a PD-48 regex change, made deliberately.
- **Ayah numbers are fields, never part of an id**, so moving an item never breaks a binding.
- **Sources** live in one registry, `apps/lessons/src/content/sources.json`. It records:
  - the work id, full title, author and death date;
  - the **pinned public-domain edition** (printer, place, year, page scheme) and why it is free;
  - the markets where the work is still protected (al-Sa'di: EU until the end of 2027);
  - its role: `primary`, `cross-check`, `pointer` (al-Wahidi, al-Suyuti) or `verdict-reference` (al-Muharrar, al-Sahih al-Musnad: facts only).
  - The checker refuses an item whose `source` is not a public-domain work with a pinned edition. It also refuses a `verdict-reference` work in `source`, and any text field in a `verdicts` entry beyond the work, the reference and a short verdict from a fixed vocabulary.
- **Pictures** live in `apps/lessons/public/pictures/`, each with its SHA-256 in a manifest. They are reviewed as items (`kind: picture`, the same states), because an image can be wrong too.

### F.2 Review states, recorded in the database, bound to the text

The PD-29 file-level `review.status` and line-level `review` flag were right for extraction, but they are not an audit trail: anyone with commit rights can type "approved". PD-49 moves approvals into the database, with the patterns PD-48 and the Tajweed review already use.

```
draft ─(source check)─▶ checked ─(teacher)─▶ teacher_ok ─(scholar, where required)─▶ approved ──withdraw──▶ withdrawn
   │                         │                    │                                       │
   └──────────── reject (with reason) ────────────┴───────────▶ rejected (final for this text)   └─ stale: the text hash changed (derived, never stored)
```

| Kind | Source check (author + a second person compare the item with the cited place) | Teachers dept (Arabic, age fit, accuracy) | Scholar |
|---|---|---|---|
| word | yes | yes | sampled (1 in 10), plus any the teacher flags |
| tafsir, tafsir_extra, theme | yes | yes | **every item** |
| lesson, reflection | yes | yes | **every item** (they state values and rulings) |
| story | yes | yes | **every item** |
| asbab | yes: the report in the collection, and each verdict as printed in the referenced books (§A.3) | yes | **every item, with the chain and grade checked** |
| quiz | its answer must cite an approved item | yes | when its category is tafsir or asbab |
| picture | n/a | yes | **every picture** (image policy, §H Q6) |
| game mechanic | n/a | yes | **once per mechanic** (§C.4) |

**Tables** (PR-3; a slot from the head):
- `chat.lesson_content_review`: append-only, `(lesson_key, item_id, text_sha256, step, action, staff_id, reason, at)`. Its trigger checks the actor holds the step's key, and that the same person does not sign two steps of the same item.
- `chat.lesson_mechanic_review`: the same idea for game mechanics.

**PD-40 keys** (in a new `lesson_content` page; the frozen seed is never edited, so they come in a LATER block):
- `lesson_content.view`;
- `lesson_content.check`;
- `lesson_content.review_teacher`;
- `lesson_content.review_scholar`.
The scholar key is a deliberate grant to named people, never a bundle default.

**The Scholar reviewer role and its account** (owner, 2026-10-29: "We have someone").
- **Template role** (PD-40 `role-templates.ts`, in the LATER block): `scholar_reviewer`, "المراجع الشرعي", tier `specialist`.
  - Keys: `lesson_content.view` and `lesson_content.review_scholar` only.
  - **No family, child, chat or finance keys.** Under strict scope the account sees no family data at all; it reviews content, not children.
- **Who grants it:** only the super admin. `lesson_content.review_scholar` is **not delegable** and is in **no legacy bundle**: not `manager:teachers`, not any supervisor. The Teachers manager cannot create a scholar.
- **Teacher vs scholar are separate steps.** The teacher step needs `lesson_content.review_teacher` (in `manager:teachers`, delegable to qualified teachers). The scholar step needs `lesson_content.review_scholar`. The review trigger refuses the same person signing two steps of one item, even if someone held both keys.
- **Account setup** (the super admin, in Admin Web, using the existing flow; nothing in the repo):
  1. Staff accounts → create: name, e-mail, tier `specialist`, department (recommended: the Teachers department, so content reports reach its manager), template role `scholar_reviewer`, and a reason. The existing `POST /staff-accounts` shows a one-time sign-in code. The super admin passes it to the scholar privately, never through a repo, a ticket or this chat.
  2. The scholar signs in and opens `/lesson-content`. The queue defaults to "needs my step: scholar".
  3. The PD-29 Tajweed reviewer function (`chat.can_review_tajweed`) is **not** extended to the scholar. Tajweed stays with the Teachers department.
- **The scholar's name is never in the repository**, a fixture or a doc. The audit trail holds only the staff id, and the review screens resolve names at runtime from `chat.staff`. (G-20 already blocks real staff names outside `docs/`. PD-49 adds nothing that would need one.)
- **Absence:** if the scholar's account is suspended or they leave, `review_scholar` stops with it (`is_active`, `left_at`). Their past approvals stand, because each is an approval of exact text. Items waiting for the scholar step simply wait.

### F.3 From the database to the child

- **Approvals export, SIGNED** (department head, 2026-10-29). The API answers `GET /lesson-content/approvals/:scope` with `{payload, keyId, signature}`:
  - `payload` is `{v: 1, datasetId, lessonKey, approvals: [{id, approvalSha256, steps, signers: [{step, staffId, at}]}]}`;
  - it is signed with Ed25519 over its canonical JSON, with `LESSON_APPROVALS_SIGNING_KEY`, which lives only in the API's environment and is an owner action (`docs/infrastructure/secrets.md`);
  - unset key: the API exports nothing (503).
  `scripts/lessons/export-approvals.py` writes it to `apps/lessons/src/content/approvals/surah-NNN.json` (or `play.json`), and it goes in by an ordinary reviewed PR.
- **CI is the trust anchor.**
  - `scripts/lessons/verify-approvals.mjs` (Node's crypto, in the `lessons-supply-chain` gate) verifies every approvals file under a public key of `apps/lessons/src/content/approvals-keys.json`. Keys have ids; a rotated key is retired, never removed, so old approvals stay verifiable.
  - A hand-edited, unsigned or unknown-key file fails the build. `check-quran-content.py` fails when an approval's hash does not match the item's current text, or its steps are not exactly the steps signed by different people.
  - The engine refuses an unsigned or unknown-key file structurally. It does not re-run Ed25519 in the browser, because older WebViews lack it (department head, 2026-10-29: option B, consistent with the Quran snapshot).
  - The production lessons bundle is built **only** by the `ci.yml` `lessons` job, which runs the verifier before it builds. The `lessons-supply-chain` gate fails if that step goes, or if another workflow builds the bundle.
  - **No replay, no staging, no slipped key** (review of #265):
    - the payload carries a signed `env` and `issuedAt`;
    - CI accepts only `env: "production"` under a production key;
    - against the PR's base branch, a changed approvals file must be strictly newer than the copy it replaces, so an old export re-committed by a revert or a stale branch fails;
    - a retired key signs no changed file, and a revoked key verifies nothing;
    - a PR may not change `approvals-keys.json` and any approvals file together (plus a CODEOWNERS entry on the key file).
  - **No replay through deletion, and no PR checks itself** (second review of #265):
    - `approvals-ledger.json` keeps each signed lesson's high-water `issuedAt`. It only grows, and every signed file must match its entry. A changed file must be newer than its entry, and a brand-new one must be recent (7 days). A rename counts as a delete plus an add.
    - A file that is signed on the base branch is never deleted or unsigned. **A removed lesson is retired:** a newer signed export with zero approvals. Its file and ledger entry stay, and the content check accepts an approvals file with no content file only when it approves nothing.
    - A PR that changes approvals (or the ledger) may not change the code that checks them: the verifier, the content check, the guards, the CI workflows, CODEOWNERS, or the engine's readers.
    - CODEOWNERS covers all of these, and any future engine approvals loader joins `PROTECTED` and CODEOWNERS. The owner turns on "Require review from Code Owners" before the first key is added.
    - Times compare as instants, so a timestamp with or without milliseconds is the same time. An `issuedAt` more than 5 minutes in the future is refused.
    - The key registry is validated field by field, and the golden vector's test key can never be listed in it. The golden vectors include an Arabic value.
  - **The first signed `play.json`** comes in a PR of its own: the export and its ledger entry, with no change to any protected file. The PR that widens the code the signature covers (SHARED_CODE: the audio, the loader, the route, `signed.ts`) lands before it.
  - **The loader rule:** any engine loader reads exactly the set `verify-approvals.mjs` checks, `apps/lessons/src/content/approvals/*.json`, and nothing else.
  - **Future option:** verify the signature at runtime in the engine too (WebCrypto Ed25519), once the WebViews families use support it widely: Safari/iOS 17+, Chrome 137+, Firefox 129+.
- **The build ships approved text only.** The snapshot step drops every item without a complete approval for its current hash. **Held, draft and rejected text never reaches the browser bundle.** Today held lines ship and are hidden at runtime; PD-49 closes that.
- **The engine checks again.** At load, an item is shown only if its `sha256(text)` equals the approval's `textSha256`, the same second check PD-48 does for clips.

### F.4 Bulk tooling for reviewers (Admin Web)

One page, `/lesson-content`, under `lesson_content.view`:

- **Queue:** "needs my step" by default; filters by surah, kind, band and state; progress bars per surah ("Al-Ikhlas: 22/26 approved").
- **Review panel, side by side:**
  - the verified ayah, from the API's `/quran/ayahs`;
  - the cited source place: the reference (work, surah:ayah, volume/page in the pinned print). Where the team has transcribed the passage from the **pinned public-domain print**, the passage itself is shown too, stored in the review system, never in the child's bundle. Al-Sa'di's passage is shown only from 2028 for EU-market reasons (§A.1). Modern verdict references show the reference and verdict only;
  - the child text, with `{{w:a:n}}` rendered as the real word;
  - the band;
  - the item's history.
- **Approve, or reject with a category** (`wrong_meaning`, `not_in_source`, `aqeedah`, `weak_report`, `too_hard_for_band`, `language`, `other`) and a reason.
  - Keyboard shortcuts (A / R / next).
  - **No bulk approve.** Each approval is one decision on one item, as in PD-48.
  - The reviewer can **approve a whole ayah's items in one screen**, but each with its own click.
- **Author view:** shows rejected items with reasons. A changed text goes back to `draft` (stale).
- **Reports:** per-surah status, the "no authentic sabab" list (§A), and the scholar's queue size, for planning.

**Authoring** happens in the repo, as JSON edited through PRs by the content team. A small local script, run with `python3 -I`, lints a draft against the checker before it is pushed. A web authoring tool is not in this plan; reconsider after Juz' Amma.

---

## G. Phased rollout

### G.1 PRs

| PR | Content | Needs |
|---|---|---|
| **PR-0** (this) | Plan and the PD-49 claim | Head's approval; owner's answers (§H) |
| **PR-1** engine, verified-text games | Band/tier/level resolver; session generator; schema v2 reader (v1 still read); verse-by-verse / whole-surah toggle; repeat loop and full-surah play; activities **1–4, 7–15** (V only); respect rules as tests; `jawwid:lesson-profile` accepted (defaults when absent: the band from a local picker for staff testing, level 1). **Live for all 114 surahs.** | PD-29 engine on main |
| **PR-2** progress (API + migration) | `jawwid:lesson-progress` via the openers; `POST /materials/progress`; events, projection and band override tables; profile endpoint for the openers; the parent and teacher views read the projection (P1-3/P1-4 minimal) | Migration slot from the head |
| **PR-3** review system (API + migration + Admin Web) | Review tables, PD-40 keys (LATER block), `/lesson-content` queue, approvals export, `lesson-content-approvals` guard, approved-only bundling | Slot; PD-40 seed block |
| **PR-4** content activities and assessments | Activities 5, 6, 16–22, 24; the assessment (§E); quiz generation from approved meanings | PR-1, PR-3 |
| **PR-5** pilot content | 4 surahs end to end (§G.2) | Editions pinned and the authoring guide approved (§A.6); the scholar's account set up (§F.2) |
| later | Activity 23 (similar ayat), after a reviewed list of pairs; word-level timing, if a source is found; voice-over binding via PD-48 | — |

### G.2 Phase 1: the pilot (4 surahs, end to end)

**The pilot (owner, 2026-10-29): Al-Fatihah (1), Al-Ikhlas (112), Al-Fil (105), Al-Masad (111).** Together they exercise every path:
- **Al-Fatihah:** recited in every prayer, and the Basmala-as-ayah-1 case.
- **Al-Ikhlas:** short, about aqeedah. It tests the scholar's tafsir review on the most sensitive topic.
- **Al-Fil:** a narrative. It tests stories, illustrations and the image policy.
- **Al-Masad:** the strongest asbab candidate in Juz' Amma (§A.3). It tests the "show" path of asbab end to end. The grade comes from the books and the scholar, not from this plan.
- With Al-Ikhlas (disputed asbab, so none shown) and Al-Fatihah and Al-Fil (none), the pilot also tests the "show nothing" paths.

**Steps:**
1. Pin the editions and write the authoring guide (§A.6). Then write the items from the public-domain sources (§A).
2. Source check.
3. Teacher review.
4. Scholar review.
5. Approvals export.
6. Try it with staff (staff_test audio) in each band.
7. Five families try it in each band, with the teacher's report.
8. Measure.

**Measures:**
- rejection rate per kind, which tunes the authoring guide;
- reviewer minutes per item, which re-estimates §G.4;
- session completion per band;
- the share of children who replay a game unprompted.

### G.3 Phase 2: Juz' Amma; Phase 3: the longer surahs

- **Phase 2:** the remaining 34 of Juz' Amma (78–114), in batches of about 8, short surahs first.
  - **The 38 extracted files are not approved content.** Their text came from the old lessons and **cites no source**.
  - Each line is checked against the primary source. A line that matches gets the citation; a line that does not is rewritten from the source.
  - Every line then goes through the normal review.
- **Phase 3:** L2–L5 by demand. Commonly learned surahs first (e.g. 67, 36, 18, 55, 56, 32, 76), Al-Baqarah last.
- **Throughout:** the verified-text activities (PR-1) are already live for every surah, so a child is never without activities while the content catches up.

### G.4 Content and review volume

Estimates are per surah with `n` ayat and `w` words (Tanzil tokens). The extracted Juz' Amma files average ~47 items per surah (1,768 in 38: 571 tafsir, 466 words, 351 quiz, 181 lessons, 199 facts), which calibrates the figures below.

| Kind | Items per surah | Juz' Amma + Al-Fatihah (38 surahs, 571 ayat, 2,485 words) | The other 76 surahs (5,665 ayat, 75,396 words) |
|---|---|---|---|
| tafsir (one child text per ayah) | n | 571 | 5,665 |
| tafsir_extra (9–12, about 1 in 4 ayat) | 0.25 n | 143 | 1,416 |
| word meanings | Juz' Amma ≈ 0.19 w (measured); longer surahs ≈ 0.12 w (assumed: gharib only) | 472 | ≈ 9,050 |
| intro, big idea (3–5), themes | 3 + n/20 | ≈ 140 | ≈ 510 |
| lessons + reflection | 3 + n/15, max 12 | ≈ 150 | ≈ 600 |
| quiz bank | 6 + n/5 | ≈ 340 | ≈ 1,590 |
| story panels | 6 per narrative surah | ≈ 60 | ≈ 240 |
| asbab | only where authenticated | ≈ 10–20 | ≈ 200–300 (most in Medinan surahs; the actual number depends on the source) |
| **Total** | | **≈ 1,900–2,000** | **≈ 19,000** |

**Reviewer time.** Assumptions, to be re-measured in the pilot:
- word, quiz or intro: 45 s with the teacher;
- tafsir: 90 s with the teacher plus 90 s with the scholar;
- lesson: 1 minute each with the teacher and the scholar;
- story panel: 2 minutes each with the teacher and the scholar;
- asbab: 10 minutes with the scholar (the chain and the grade).

| Scope | Teachers dept | Scholar | Notes |
|---|---|---|---|
| Pilot (4 surahs: 21 ayat, 102 words; ≈ 130 items) | ≈ 2.5 h | ≈ 2 h | plus pictures and mechanics (once): ≈ 3 h scholar |
| Juz' Amma + Al-Fatihah | ≈ 38 h | ≈ 25 h | about 6 weeks at 10 h a week for the scholar |
| The other 76 surahs | ≈ 330 h | ≈ 245 h | about 6 months at 10 h a week for the scholar, so it is planned surah by surah, by demand |

**The authors' time is larger than the reviewers'.** Writing a child-level tafsir item from a classical source, with its meaning ladder and citation, takes about 5–8 minutes (§A.5). Juz' Amma alone is about 150–250 author hours. Who writes is §H Q9.

---

## H. Owner decisions (2026-10-29)

The owner answered on 2026-10-29, relayed by the department head:
1. **"Approve all":** every recommendation below is adopted as written, except where the next three answers replace it.
2. **Sources: "Only public-domain sources."** This replaces Q1. No permission letters are sent, and counsel is optional (§A.7).
3. **Scholar: "We have someone."** This replaces Q2's open part. The role and the account setup are in §F.2. No name goes in the repository.
4. **Pilot: 1, 112, 105, 111.** This settles Q12.

The original questions follow, each marked with its decision.

1. **Sources and licences.** **DECIDED 2026-10-29: public-domain sources only** (§A):
   - tafsir from al-Sa'di's base text, in a pinned print with no modern apparatus, cross-checked with al-Baghawi and Ibn Kathir;
   - word meanings from Ibn al-Ha'im's al-Tibyan, cross-checked with Ibn Qutaybah and al-Sijistani;
   - asbab reports from the hadith collections, with al-Wahidi and al-Suyuti as pointers; modern authenticity verdicts by reference only;
   - every child-facing line is our own wording, cited per item.
   The earlier recommendation (modern sources with permission letters) is withdrawn.

2. **Who is the scholar reviewer?** **DECIDED 2026-10-29:** the owner has a qualified scholar. They get the Scholar reviewer role (§F.2), and their name is never in the repo. *Adopted as written: a named, qualified scholar (a sharia degree with a specialism in tafsir or hadith, or an ijazah in tafsir), under a written contract. They sign tafsir, asbab, lessons, stories, pictures and game mechanics, and are granted `lesson_content.review_scholar` personally. The Teachers department does the teacher step. The two steps must be **different people**. A teacher never stands in for the scholar on tafsir or asbab.*
3. **Age bands.** **ADOPTED 2026-10-29.** PD-49 uses 3–5, 6–8 and 9–12, as the brief asks. Materials uses 4–6 / 7–9 / 10–12 / 13–17. *Recommend keeping PD-49's bands inside the lessons engine only, so the library filter is unchanged, and listing an alignment of the Materials bands as a separate small item if you want one scale everywhere.*
4. **Who picks the band?** **ADOPTED 2026-10-29.** *Recommend: automatic from the age Sales recorded; the parent or the teacher may move it one band up or down (a record of who and why is kept); the teacher sets the level within the band (your earlier decision, PD-29 Q5).*
5. **The 3–5 band while recitation is off.** **ADOPTED 2026-10-29.** Pre-readers learn mostly by listening, and recitation stays staff_test until the KFGQPC licence and lawyer sign-off. *Recommend: build 3–5 now, run it with staff on staff_test audio, and offer families the "with a grown-up" mode (a parent reads, the child taps) until recitation reaches families. Explanations can be voiced earlier through PD-48's approved TTS, because they are not Quran.*
6. **Illustration policy.** **ADOPTED 2026-10-29.** *Recommend (the scholar to confirm):*
   - *never depict Allah, prophets, companions, angels or the unseen (Paradise, Hell);*
   - *no human faces;*
   - *animals, nature and objects named in the surah are allowed;*
   - *every picture is reviewed like text.*
   *This needs an illustrator: budget about 5 pictures per short surah, about 120 for Juz' Amma.*
7. **Sound.** **ADOPTED 2026-10-29.** *Recommend: no musical instruments; voice and short non-musical effects; a mute control; nothing playing over a recitation.*
8. **Respect rules for game mechanics** (§C.4). **ADOPTED 2026-10-29.** *Recommend approving these rules now. The scholar signs each mechanic once before it ships. Mechanics that treat verse words as objects (catching, popping, stacking, assembling into food) are not used.*
9. **Who writes the children's text, and may software help?** **ADOPTED 2026-10-29.** *Recommend: a small authoring team (Teachers department or a contracted Arabic children's writer) writes from the pinned public-domain source (§A). Software may only help simplify the wording of a cited source excerpt; it is never a source of facts, asbab, gradings or rulings. Every such item says so in its record, and gets the full human review.*
10. **The 38 extracted files.** **ADOPTED 2026-10-29.** *Recommend treating them as drafts: every line is checked against al-Sa'di (or, for word meanings, Ibn al-Ha'im), cited if it matches, rewritten from the source if not. None is approved as it stands.*
11. **Recitation speed control.** **ADOPTED 2026-10-29.** *Recommend none in v1. Revisit when the KFGQPC licence is recorded and the scholar has given an opinion on slowed playback.*
12. **The pilot surahs.** **DECIDED 2026-10-29: 1, 112, 105 and 111** (§G.2).
13. **Languages.** **ADOPTED 2026-10-29.** *Recommend Arabic only for v1 (Jawwid is Arabic-first). Translations of the children's text are a later item, each translation reviewed as its own text.*
14. **Disputed asbab.** **ADOPTED 2026-10-29.** For example, Al-Ikhlas: weak per al-Muzaini, while others grade it hasan. *Recommend showing nothing when the two primary works conflict, even if a scholar leans one way. The owner asked for no unverified reports, and silence is never wrong. Any exception is the owner's decision on the scholar's written opinion, recorded on the item.*
