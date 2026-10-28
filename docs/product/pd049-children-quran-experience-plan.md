# PD-49: an age-adaptive children's Quran experience for all 114 surahs (plan)

**State:** **Plan, docs only.** No product code is written; code waits for the department head's approval and the owner's answers (§H).
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
   - **Knowledge content** is word meanings, tafsir, lessons, asbab, stories and quiz questions. It is written **for children, derived from a named source, with a citation on every item**. A child sees it only after review: Teachers department for all of it, plus a qualified scholar for tafsir, asbab, lessons and stories. Content games unlock **surah by surah** as review finishes.
2. **Three axes of adaptation** (§B), so a 4-year-old on Al-Kawthar and a 10-year-old on Al-Mulk never get the same session:
   - **age band** (3–5, 6–8, 9–12) decides which mechanics are allowed and how they look (pre-reader or reader);
   - **surah length tier** (L1–L5) decides chunking, the number of rounds, and the order/recall game shapes;
   - **the child's level and progress** decide the difficulty inside a game, and what comes back for review.
3. **24 activity types** (§C), each tagged by band, tier, skill and data source. A session generator assembles a varied playlist from them. A child never plays the same mechanic twice in a row, and it rotates across days.
4. **Accuracy first** (§A, §F):
   - per-item review states in the database, bound to the SHA-256 of the exact text, as PD-48 does for clips;
   - an export of approvals into the repo, checked by CI;
   - **held text is never shipped in the bundle**;
   - no asbab without an authenticated report: where there is none, the section does not exist;
   - Quran never typed (the existing checker).
5. **It works with audio off.** Every audio activity drops out of the playlist when the gate gives no recitation. There is no placeholder button (PD-48's rule). The 3–5 band is honestly weaker without audio. §D says what it gets meanwhile, and §H Q5 asks the owner.
6. **Review is the bottleneck, not code** (§G.4). About 2,000 items for Juz' Amma plus Al-Fatihah: ~38 teacher hours and ~25 scholar hours. About 21,000 items for the whole Quran: ~600 reviewer hours. The phasing follows that.

---

## A. Sources (accuracy before features)

**How this was researched.**
- Web reading only, 2026-10-28. Nothing was downloaded, signed up for or run.
- The full notes, with a URL on every claim, are in the department head's notes folder:
  - `pd49-tafsir-sources-research.md`
  - `pd49-word-meanings-sources-research.md`
  - `pd49-asbab-sources-research.md`
- Some official pages (KFGQPC, Dorar) answered 404 or 403. Those points rest on search snippets and are marked "unconfirmed".
- **Every licence conclusion here is an engineer's reading, not legal advice. Counsel confirms before anything is recorded as licensed** (§A.8).

### A.0 The finding that shapes everything

**No reliable source for tafsir, word meanings or asbab has a published licence that covers all three uses a paid children's app needs:**
- (a) showing its text verbatim;
- (b) storing it offline;
- (c) deriving simplified children's text from it.
The modern works (al-Mukhtasar, al-Muyassar, al-Siraj, al-Muharrar, al-Sahih al-Musnad, Makhluf) are in copyright and need **written permission**. The classical works are out of copyright, but they are not written for children, and some contain weak reports.

So PD-49 works this way:
1. **Children's text is our own original writing.** It conveys the meaning the cited source gives, in new words for the band. It never reproduces the source's sentences.
   - Each item records the source and the exact place (work, edition, surah:ayah, volume/page).
   - Whether this needs the publisher's permission for a commercial product is §H Q1b, for counsel. **We ask the publishers anyway** (§A.8), because permission also lets reviewers see the source inside the review tool.
2. **No source text is shipped or stored in the product** until its licence is recorded in code (`content/sources.json`, the `audio-sources.ts` pattern).
   - Until then, reviewers open the source by link or in their own copy. The review tool shows the exact reference, not the text.
3. **Accuracy is a review fact, not a licence fact.** Even with every licence, nothing shows until the review steps of §F.2 are complete.

### A.1 Simplified tafsir

| Source | Publisher, method | Licence for a paid app | Format | Role |
|---|---|---|---|---|
| **al-Mukhtasar fi Tafsir al-Quran al-Karim** | Markaz Tafsir lil-Dirasat al-Quraniyyah. Named authors, ten reviewers and a supervisory committee, with a later revision. It states a Salaf / Ahl al-Sunnah method. Written to be short and clear. | In copyright. The Arabic text is on **QuranEnc** (API, versioned), whose terms allow republishing only **unmodified, credited and versioned**, and are silent on commercial use. IslamHouse's content policy allows commercial use and offline storage, and treats a summary as "your own independent work", but it is written for their own translations, not for third-party tafsir rights. **Written permission is needed from Markaz Tafsir.** | QuranEnc API / JSON (`arabic_mokhtasar`), PDF | **Primary.** Children's tafsir is derived from it, cited by QuranEnc version + surah:ayah |
| **al-Tafsir al-Muyassar** | KFGQPC (King Fahd Glorious Quran Printing Complex). A committee under a named supervisor; the contributors are not listed. | A corporate work, protected (to about 2048 by the agent's reading). The Complex's developer site offers data "for app content", but **no licence for the tafsir** was found, and the footer reserves all rights (unconfirmed: page 404). The Complex's published free-use grant covers the **Mushaf only**. **Written permission is needed from KFGQPC.** | KFGQPC data; QuranEnc (`arabic_moyassar`); quran.com resource 16 | **Cross-check** for every tafsir item |
| **Taysir al-Karim al-Rahman (al-Sa'di)** | The author died 1957 (often misdated 1956). Widely taught; Ahl al-Sunnah. | The **base text** is public domain in Saudi Arabia and Egypt (life + 50). In the EU it is protected until the end of 2027. Modern critical editions' apparatus is protected. No data source says which edition it copied. | Many; QuranEnc (`arabic_saadi`), quran.com 91 | **Fallback** if permissions stall; a reviewer's reference for lessons learned (al-Sa'di draws out lessons) |
| **Ibn Kathir** | The original (d. 774 AH) is public domain, long, and includes weak reports. Its abridgements (al-Misbah al-Munir; al-'Adawi's Sahih; others) are in copyright. | Original: free. Abridgements: permission from each publisher. | Many | **A reviewer's reference only**, for narrations. Never derived from directly. |
| **Quran Foundation API** (quran.com) | Serves al-Muyassar, al-Sa'di and Ibn Kathir; **not** the Arabic Mukhtasar | Its developer terms (dated 2026-10-11) allow paid apps, but limit caching to **one week** unless their Content Sync is used. Summaries count as "Derived Materials" that stay under its terms, and everything must be deleted if access ends. | REST API | **Not a base** for authored, permanent children's text |
| **QUL (Tarteel)** | Hosts Muyassar, Sa'di and Mukhtasar | Each licence page says "no copyright information" for the resource. **QUL grants nothing.** | Downloads | Not used |
| Children's tafsir books | Retail Juz' 'Amma books and an article series | All in copyright. No committee-reviewed, openly licensed whole-Quran children's tafsir was found. | Print | Style reference only |

**Recommendation:**
- **Primary: al-Mukhtasar** (Markaz Tafsir), cited by its QuranEnc version.
- **Cross-check: al-Muyassar** (KFGQPC).
- **Fallback: al-Sa'di's base text.**
- The scholar reviewer may consult Ibn Kathir and others, but the item cites the source it was written from.
- If the Mukhtasar and the Muyassar disagree on an ayah's meaning, the item is held for the scholar and the disagreement is written in the item's record.

### A.2 Word meanings (gharib)

| Source | Notes | Licence | Role |
|---|---|---|---|
| **al-Muyassar fi Gharib al-Quran al-Karim** (KFGQPC, 2nd ed. 2021) | Written for memorisation students; Hafs; printed in the Mushaf margin; phrases quoted in Uthmani script | All rights reserved; no licence published (QUL's copy, resource 519: "no copyright information"). The Complex grants free use of its Mushaf, so it has a permissions process. **Written permission needed.** | **Primary**, under licence |
| **al-Siraj fi Bayan Gharib al-Quran** (al-Khudayri; published by Majallat al-Bayan) | Clear, short glosses; widely used | The author is living, so it is in copyright. On QuranEnc (`arabic_seraj`): republishing allowed only unmodified, credited and versioned; silent on commercial use. QUL 250: "no copyright information". | **Cross-check** (reviewers read it). Not shipped unless licensed. |
| **Kalimat al-Quran** (Makhluf) | Classic glossary | The author died 1990; Egyptian life + 50 runs to about 2040. Rights holder not found. | Not used |
| **Classical gharib**: Ibn Qutaybah, al-Raghib, al-Sijistani, Ibn al-Ha'im (*al-Tibyan*) | Authoritative, not written for children | The authors' text is public domain. A modern edition's notes and choices of reading may be protected; use out-of-copyright prints. | **Fallback cross-check** needing no permission |
| Quranic Arabic Corpus (Leeds) | Morphology and grammar only; **no Arabic meanings** | GPL v3; its FAQ says non-commercial; its download terms forbid changes | Not used in the product |
| Quran Foundation / QUL word-by-word | Translations, **no Arabic word meanings** | See A.1 | Not used |

**Word positions.**
- Tanzil writes waqf marks (and ۞, ۩) as separate space-separated tokens.
- quran.com and QUL attach them to the previous word and add an "end" token. For 2:2, Tanzil splits into 9 tokens; quran.com shows 7 words plus the end token.
- The engine already numbers only tokens that contain a letter (`wordsOf` in `content/lesson-content.ts`), so a mark is never a word.
- Glossaries often explain **phrases**. So a meaning item is a **span**, `{ayah, word, to?}` (§F.1). The checker verifies the span.
- Any cross-reference to QUL word ids is checked by a test, never assumed.

**Recommendation:**
- **Primary: KFGQPC's al-Muyassar fi Gharib al-Quran**, under a written licence.
- **Cross-check: al-Siraj.** Fallback cross-check: Ibn al-Ha'im's *al-Tibyan*.
- **Until a licence is recorded,** no source text is shipped. Authors write their own child glosses from these sources, with the citation, and counsel confirms that approach (§H Q1b).

### A.3 Asbab al-nuzul (reasons for revelation)

| Work | Author, publisher | Method | Licence | Role |
|---|---|---|---|---|
| **al-Muharrar fi Asbab Nuzul al-Quran min khilal al-Kutub al-Tis'ah** | Khalid al-Muzaini; Dar Ibn al-Jawzi, 1427 AH, 2 vols (a PhD thesis) | For each report it rules **twice**: is the chain sound, and is it really the reason for the verse? It covers the nine hadith books only. | In copyright; no licence stated. Quranpedia has it per ayah, but its licence covers classical texts only, not contemporary works. | **Primary** |
| **al-Sahih al-Musnad min Asbab al-Nuzul** | Muqbil al-Wadi'i (d. 1422 AH); Maktabat Ibn Taymiyya (4th ed., 1408 AH), later Dar al-Athar | Collects reports he judges authentic. **Inclusion is not always a "sahih" verdict**: e.g. for al-Kawthar he concludes the report is mursal. | Treat as in copyright: the book names one licensed printer. A "free for every Muslim to print" claim was seen only on a 2006 forum post, **not confirmed**. | **Secondary** |
| **al-Isti'ab fi Bayan al-Asbab** | Salim al-Hilali and Muhammad Al Nasr; Dar Ibn al-Jawzi, 3 vols | Grades sound and weak reports alike | In copyright | The scholar's reference for **disputed** reports |
| al-Wahidi, *Asbab al-Nuzul*; al-Suyuti, *Lubab al-Nuqul* | Classical | Mix sound and weak reports. Modern editions add copyrighted gradings. | The classical text is free | **Never the authenticating source** |

**The display rule.** An asbab item is shown only when **all** of these hold:
1. al-Muharrar concludes the report **is** the reason for the verse;
2. the chain is graded **sahih or hasan**, by al-Muzaini or, where he is silent, by al-Wadi'i;
3. **neither** work grades it weak or rejects it as the reason. A conflict means it is not shown;
4. the scholar reviewer signs it, with the grade and the reference recorded on the item (§F.2).

Otherwise **there is no asbab section for that ayah: no placeholder, no "unknown", no weaker report.** The item stores a citation (surah:ayah, collection, volume/page, the verdict, the reviewer and the date) and our child retelling. It **never stores third-party book text**.

**Juz' Amma and Al-Fatihah, as research leads only.** The scholar confirms every row against the printed books; this table is not a ruling.

| Lead | Surahs |
|---|---|
| Strong candidates: both works agree; the hadith is in al-Bukhari or Muslim | Al-Duha 1–3 (93); Al-'Alaq 6–19 (96); Al-Masad (111) |
| Likely | Al-Mutaffifin 1 (83) |
| **Disputed: show nothing** (rule 3). An exception would be an owner decision on the scholar's written opinion (§H Q14). | An-Nazi'at (79): al-Wadi'i includes it, al-Muzaini rejects it · 'Abasa (80): the chain's grade is contested · Al-Kawthar (108): mursal per al-Wadi'i · Al-Ikhlas (112): weak per al-Muzaini, though others grade it hasan · Al-Kafirun (109): weak routes |
| Show nothing | Al-Fatihah; Al-Qadr (97); Al-Falaq and An-Nas (113–114: the sihr hadith is sahih, but the claim that it caused the revelation rests on weak reports); every other surah of the juz' |

**For the pilot (§G.2), this means:**
- Al-Masad tests the "show" path.
- Al-Ikhlas tests the "disputed, show nothing" path.
- Al-Fatihah and Al-Fil test "none".

### A.4 Hadith look-ups for reviewers

- **Dorar.net:** a **live look-up only**. Its API terms forbid bulk storage and limit caching to 24–48 hours. Nothing from it is stored.
- **HadeethEnc:** its published policy allows commercial use and offline storage, unmodified and credited. It is suitable if a lesson ever quotes a hadith verbatim. See the earlier `hadith-dataset-research.md` in the same notes folder.

### A.5 Verification workflow (every item)

1. **Write.** The author writes the child text for its band from the **primary** source and records the citation. The author never writes from memory. Asbab are taken only from al-Muharrar / al-Sahih al-Musnad, with the grade as printed.
2. **Source check.** A second person opens the cited place and confirms the item says what the source says, then opens the **cross-check** source. A disagreement is noted on the item, which goes to the scholar.
3. **Teachers department.** Checks Arabic, full tashkeel where shown to readers, age fit for the band, and consistency with the verified text (positions resolve; no typed Quran, enforced by the checker).
4. **Scholar** (tafsir, lessons, stories, asbab, pictures, mechanics): checks aqeedah and accuracy against the sources. For asbab, also the chain and grade.
5. **Approval export → CI → build** (§F.3). Only approved, hash-matching text reaches a child.
6. **Corrections.** Anyone can flag a shown item. A reviewer **withdraws** it at once, so it stops showing after the next approvals-export build. A fix is a new text: new hash, new review.

### A.6 Licence actions (owner or counsel; this session contacts no one)

1. **Markaz Tafsir** (`info@tafsir.net`): permission for al-Mukhtasar to (a) show to reviewers and in-app where useful, (b) store offline, and (c) derive children's text, plus the exact credit wording.
2. **KFGQPC** (`info@qurancomplex.gov.sa`): the same, for al-Tafsir al-Muyassar and al-Muyassar fi Gharib al-Quran.
3. **IslamHouse / QuranEnc** (`admin@islamhouse.com`): written confirmation of whether their policy covers these Arabic tafsirs in a paid app, and how their "no excessive pricing" condition applies.
4. **Dar Ibn al-Jawzi** (al-Muharrar, al-Isti'ab), and the holder of al-Sahih al-Musnad's rights: permission to cite and retell, with references. No contact address was found; the owner's network may have one.
5. **Counsel:** whether original children's text that conveys a cited source's meaning, with a citation and no reproduced sentences, needs the publisher's permission in Jawwid's markets (§H Q1b).
6. Each answer is recorded in `content/sources.json` with who confirmed, when and the document, in a reviewed commit. A source with no record is never shipped as text.

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
      "source": { "work": "mukhtasar", "version": "<QuranEnc version>", "ref": "112:1" }, "crossCheck": { "work": "muyassar", "ref": "112:1" } },
      // {{w:a:n}} is a POSITION: the engine draws the word from the verified text
    { "id": "tafsir_x-001", "kind": "tafsir_extra", "ayah": 1, "bands": ["9-12"], "text": "…", "source": { "work": "saadi", "ref": "112:1" } },
    { "id": "word-001",     "kind": "word",    "ayah": 1, "word": 4, "to": 4, "text": "…", "source": { "work": "muyassar-gharib", "ref": "112:1" }, "picture": null },
      // a span: words 4..to of the ayah, counted as wordsOf() counts them (mark-only tokens are not words)
    { "id": "lesson-001",   "kind": "lesson",  "bands": ["3-5","6-8","9-12"], "text": "…", "behaviour": "good", "source": { "work": "muyassar", "ref": "112" } },
    { "id": "asbab-001",    "kind": "asbab",   "ayah": [1,4], "bands": ["9-12"], "text": "…",
      "source": { "work": "muzaini-muharrar", "ref": "vol./p.", "verdict": "is the reason; chain sahih", "hadith": "collection + number" },
      "crossCheck": { "work": "wadii-sahih-musnad", "ref": "p.", "verdict": "…" } },
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
- **Sources** live in one registry, `apps/lessons/src/content/sources.json`: work id, full title, author, publisher, edition, and a **licence record** (who confirmed, when, which terms document). It works like `audio-sources.ts`. A work with no licence record can be cited for derived wording only if §H Q1 allows that, and can never be quoted verbatim.
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
| asbab | yes, including the grade as printed in the authenticated source | yes | **every item, with the chain and grade checked** |
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

### F.3 From the database to the child

- **Approvals export.** `scripts/lessons/export-approvals.py` writes `apps/lessons/src/content/approvals/surah-NNN.json` from an export the API prints: `[{ id, textSha256, steps: [...], approvedAt }]`. It goes in by an ordinary reviewed PR.
- **A CI guard, `lesson-content-approvals`**, fails when an approval's hash does not match the item's current text.
- **The build ships approved text only.** The snapshot step drops every item without a complete approval for its current hash. **Held, draft and rejected text never reaches the browser bundle.** Today held lines ship and are hidden at runtime; PD-49 closes that.
- **The engine checks again.** At load, an item is shown only if its `sha256(text)` equals the approval's `textSha256`, the same second check PD-48 does for clips.

### F.4 Bulk tooling for reviewers (Admin Web)

One page, `/lesson-content`, under `lesson_content.view`:

- **Queue:** "needs my step" by default; filters by surah, kind, band and state; progress bars per surah ("Al-Ikhlas: 22/26 approved").
- **Review panel, side by side:**
  - the verified ayah, from the API's `/quran/ayahs`;
  - the cited source place: the source text, if its licence allows storing it, otherwise the exact reference to open;
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
| **PR-5** pilot content | 4 surahs end to end (§G.2) | Sources decided (§H Q1), reviewers named (§H Q2) |
| later | Activity 23 (similar ayat), after a reviewed list of pairs; word-level timing, if a source is found; voice-over binding via PD-48 | — |

### G.2 Phase 1: the pilot (4 surahs, end to end)

**Recommended pilot: Al-Fatihah (1), Al-Ikhlas (112), Al-Fil (105), Al-Masad (111).** Together they exercise every path:
- **Al-Fatihah:** recited in every prayer, and the Basmala-as-ayah-1 case.
- **Al-Ikhlas:** short, about aqeedah. It tests the scholar's tafsir review on the most sensitive topic.
- **Al-Fil:** a narrative. It tests stories, illustrations and the image policy.
- **Al-Masad:** the strongest asbab candidate in Juz' Amma (§A.3). It tests the "show" path of asbab end to end. The grade comes from the books and the scholar, not from this plan.
- With Al-Ikhlas (disputed asbab, so none shown) and Al-Fatihah and Al-Fil (none), the pilot also tests the "show nothing" paths.

The alternative, if the owner prefers to avoid a surah about punishment for the youngest, is Al-Duha (93). Its asbab is also a strong candidate (§A.3), it has 11 ayat, and it brings an L2 surah into the pilot. (Al-Kawthar would not test the asbab path: its report is mursal per al-Wadi'i.)

**Steps:**
1. Write the items from the chosen sources.
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

**The authors' time is larger than the reviewers'.** Writing a child-level tafsir item from the source, with its citation, takes about 3–5 minutes. Juz' Amma alone is about 100–150 author hours. Who writes is §H Q9.

---

## H. Owner questions (each with a recommendation)

1. **Sources and licences (§A).**
   - **a. Which sources?** *Recommend:*
     - tafsir from **al-Mukhtasar** (Markaz Tafsir), cross-checked with **al-Muyassar** (KFGQPC), with al-Sa'di as the fallback;
     - word meanings from **KFGQPC's al-Muyassar fi Gharib al-Quran**, cross-checked with **al-Siraj**;
     - asbab from **al-Muzaini's al-Muharrar**, cross-checked with **al-Wadi'i's al-Sahih al-Musnad**, under the display rule of §A.3.
   - **b. While permissions are pending, may authors write original children's text from these sources, with citations, without the publishers' permission?** *Recommend: ask counsel first. Meanwhile write the pilot's items, but publish none until counsel answers. No source text is shipped until its licence is recorded.*
   - **c. Licence costs.** None of these publishers lists a price; all need a written request (§A.6). *Recommend the owner sends the four requests now. Approval may take weeks, and the pilot's publication waits on (b).*

2. **Who is the scholar reviewer?** *Recommend a named, qualified scholar (a sharia degree with a specialism in tafsir or hadith, or an ijazah in tafsir), under a written contract. They sign tafsir, asbab, lessons, stories, pictures and game mechanics, and are granted `lesson_content.review_scholar` personally. The Teachers department does the teacher step. The two steps must be **different people**. If no external scholar is available yet, the pilot waits: a teacher does not stand in for the scholar on tafsir or asbab.*
3. **Age bands.** PD-49 uses 3–5, 6–8 and 9–12, as the brief asks. Materials uses 4–6 / 7–9 / 10–12 / 13–17. *Recommend keeping PD-49's bands inside the lessons engine only, so the library filter is unchanged, and listing an alignment of the Materials bands as a separate small item if you want one scale everywhere.*
4. **Who picks the band?** *Recommend: automatic from the age Sales recorded; the parent or the teacher may move it one band up or down (a record of who and why is kept); the teacher sets the level within the band (your earlier decision, PD-29 Q5).*
5. **The 3–5 band while recitation is off.** Pre-readers learn mostly by listening, and recitation stays staff_test until the KFGQPC licence and lawyer sign-off. *Recommend: build 3–5 now, run it with staff on staff_test audio, and offer families the "with a grown-up" mode (a parent reads, the child taps) until recitation reaches families. Explanations can be voiced earlier through PD-48's approved TTS, because they are not Quran.*
6. **Illustration policy.** *Recommend (the scholar to confirm):*
   - *never depict Allah, prophets, companions, angels or the unseen (Paradise, Hell);*
   - *no human faces;*
   - *animals, nature and objects named in the surah are allowed;*
   - *every picture is reviewed like text.*
   *This needs an illustrator: budget about 5 pictures per short surah, about 120 for Juz' Amma.*
7. **Sound.** *Recommend: no musical instruments; voice and short non-musical effects; a mute control; nothing playing over a recitation.*
8. **Respect rules for game mechanics** (§C.4). *Recommend approving these rules now. The scholar signs each mechanic once before it ships. Mechanics that treat verse words as objects (catching, popping, stacking, assembling into food) are not used.*
9. **Who writes the children's text, and may software help?** *Recommend: a small authoring team (Teachers department or a contracted Arabic children's writer) writes from the licensed source. Software may only help simplify the wording of a cited source excerpt; it is never a source of facts, asbab, gradings or rulings. Every such item says so in its record, and gets the full human review.*
10. **The 38 extracted files.** *Recommend treating them as drafts: every line is checked against the primary source, cited if it matches, rewritten from the source if not. None is approved as it stands.*
11. **Recitation speed control.** *Recommend none in v1. Revisit when the KFGQPC licence is recorded and the scholar has given an opinion on slowed playback.*
12. **The pilot surahs.** *Recommend 1, 112, 105 and 111 (§G.2), or 93 instead of 111 if you prefer to avoid that surah for the youngest.*
13. **Languages.** *Recommend Arabic only for v1 (Jawwid is Arabic-first). Translations of the children's text are a later item, each translation reviewed as its own text.*
14. **Disputed asbab.** For example, Al-Ikhlas: weak per al-Muzaini, while others grade it hasan. *Recommend showing nothing when the two primary works conflict, even if a scholar leans one way. The owner asked for no unverified reports, and silence is never wrong. Any exception is the owner's decision on the scholar's written opinion, recorded on the item.*
