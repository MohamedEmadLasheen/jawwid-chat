# PD-51: Quran, Arabic Language and Islamic Studies materials in Arabic and English (plan)

**State:** **Plan, docs only.** Waiting for the department head's review and the owner's answers (§9). No product code, no translation and no dataset is downloaded until the owner chooses (§2.3).
**Claim:** `docs/product/pd-registry/PD-51.md`. **Migration slot:** none for this plan. Each PR in §8 that needs one asks the department head first.
**Base:** `main` @ `8997364f`. Paths are relative to the repository root.

The owner's request (2026-10-29), verbatim:

> "We want the Quran, Arabic Language, and Islamic Studies materials to be available in both Arabic and English, ensuring that both languages are accurate, correct, and linguistically sound."

**Builds on, and does not change:**
- PD-29: the `apps/lessons` engine, the pinned Tanzil Uthmani text (`docs/product/quran-dataset-contract.md`), the Arabic letter lessons and the reading-lesson design (`docs/product/pd029-p05-reading-lessons-design.md`, #286), the hadith decision (HadeethEnc + written OK) and the wudu/salah method rule (`docs/product/pd029-materials-quality-plan.md`, "Owner decisions (2026-10-29)").
- PD-48: voice-over, with clips bound to (lesson, id, sha256 of the exact text), two reviewers, fail-closed, and never Quran (`docs/product/pd048-lesson-voice-over-design.md`).
- PD-49: "Only public-domain sources"; the per-item review in `chat.lesson_content_review` (#258); the signed approvals export (#265); and the scholar reviewer role (`docs/product/pd049-children-quran-experience-plan.md` §A, §F).

**What this plan supersedes once the owner adopts it:** PD-49 §H Q13 ("Arabic only for v1. Translations of the children's text are a later item, each translation reviewed as its own text."). The second sentence becomes this plan. The first stays true until PR-1 (§8) lands.

---

## 0. Summary

1. **The Arabic Quran is never translated, replaced, transliterated or hidden.** In English mode it is still shown, from the same verified text and in the same font. English adds a **translation of the meanings** beside it. That translation is labelled as such, attributed, pinned like the Tanzil text, and comes from a source we may use. The recommendation is **Pickthall (1930)**, the only candidate that is public domain in every market today (§2).
2. **English is a layer, not a second copy.** In Arabic lessons the subject stays Arabic. English adds the instructions, the explanations and the meanings of words. In Quran and Islamic Studies content, every English item is a translation of an **already approved Arabic item**, and it is bound to that item's hash. If the Arabic changes, the English goes stale by itself (§5.2).
3. **Fail-closed per language.** An English version that is not approved is not shown. Nothing is machine-translated at runtime, ever. A learner in English mode sees the approved Arabic item without English, and no placeholder (§5.4).
4. **The review system is extended, not duplicated.** It is the same `chat.lesson_content_review` table and the same signed export, with a `lang` column and a `translation` step signed by a qualified bilingual reviewer. The scholar signs English religious meaning, as they sign the Arabic (§5).
5. **The engine has no English today, and no way to know the reader's language** (§1). PR-1 adds both, with no content change.
6. **Review is the bottleneck again** (§7). For Juz' Amma plus Al-Fatihah, the English layer is about 2,000 PD-49 items, 571 verses of translation, and about 4,000 word glosses for the Arabic lessons. That is about 150–220 bilingual-reviewer hours and about 20–30 scholar hours on top of PD-49's Arabic estimate.
7. **Fourteen owner questions** (§9), each with a recommendation.

---

## 1. Audit: what exists today

Two read-only passes on 2026-10-29 covered `main` and the open lesson branches: #306, #307, #312 (PD-49 games), and #280, #283, #284, #292 (Arabic lessons). Nothing was run.

### 1.1 The host apps are bilingual

| Surface | Mechanism | Materials coverage | Evidence |
|---|---|---|---|
| **Admin Web** | Home-grown. The locale is kept in `localStorage` `jawwid.locale`, `ar` by default. `dir` is `rtl` for Arabic and `ltr` for English, set on `<html>`. `Intl` tags are `ar-EG` and `en-GB`. | Materials: 119 en/ar pairs. PD-48 Lesson audio: 44 pairs. | `apps/admin-web/src/core/i18n/I18nProvider.tsx:22-24,33,51,54-55`; `apps/admin-web/src/core/i18n/messages.ts:10,142`; `apps/admin-web/src/features/materials/copy.ts:12,135-163,199`; `apps/admin-web/src/features/lesson-audio/LessonAudioPage.tsx:25` |
| **Flutter** | `l10n.yaml`, `lib/l10n/app_en.arb` (the template) and `app_ar.arb`, with 1,336 keys each. | 32 `materials*` keys. Titles fall back from one language to the other (`lib/shared/models/materials.dart:63`). | `lib/app/app.dart:30-43`; `lib/features/materials/presentation/child_materials_screen.dart:107,235` |
| **PD-49 review screens** | **Not built.** The API endpoints exist (`apps/api/src/lesson-content/lesson-content.controller.ts:21-52`), but no Admin Web page calls `/lesson-content/*`. | n/a | PD-49 §F.4 / PR-3, still to come |

### 1.2 The lessons engine is Arabic only, with no i18n mechanism

- **No string tables, locale files, `Intl` or `lang` parameter.** The page is fixed as `<html lang="ar" dir="rtl">` (`apps/lessons/index.html:2`), with the Arabic title at `:11`.
- **Digits are hard-coded `toLocaleString('ar-EG')`** in seven places: `apps/lessons/src/lesson/SurahLesson.tsx:28`, `lesson/Verses.tsx:3`, `games/Quiz.tsx:5`, `play/games/common.tsx:25`, `games/OrderAyat.tsx:52`, `games/CompleteAyah.tsx:58`, `reading/ReadingLesson.tsx:63`.
- **The Arabic-only constant maps** (none is keyed by language): `arabic/ui-text.ts:10-29`, `lesson/SectionHeader.tsx:5-11`, `arabic/ArabicLesson.tsx:15`, `reading/ReadingLesson.tsx:11-12`, `content/quran-content.ts:63-64` (HIFZ_QUESTIONS).
- **No component sets `lang` or `dir`.** No element marks Quran text as Arabic inside the page. `styles.css` already uses logical properties (`margin-inline-start`, `padding-inline`), so most of the layout flips correctly once `dir` changes.

**Learner-facing strings: 100% Arabic, 0 English, 0 bilingual.**

| Area | Files | Strings (approx.) |
|---|---|---|
| Shell | `App.tsx:28,29,36`; `index.html:11` | 4 |
| Quran lesson player | `lesson/SurahLesson.tsx` (incl. `:156` «محتوى الدرس قيد المراجعة…», `:164`, `:191`), `SectionHeader.tsx`, `Benefits.tsx`, `Verses.tsx` | ~35 |
| Older in-lesson games | `games/CompleteAyah.tsx`, `OrderAyat.tsx`, `Quiz.tsx` | ~23 |
| Arabic letter lessons | `arabic/ui-text.ts` (fully vowelled: «أَحْسَنْتَ!», «تَحَقَّقْ»…), `ArabicLesson.tsx` (incl. `:69`), `FindLetter.tsx`, `PickWords.tsx` | ~26 |
| Reading lessons | `reading/ReadingLesson.tsx` (incl. `:82`, `:119`), `reading/reading.ts:168,186` (generated questions) | ~19 |
| PD-49 games (main) | `play/PlayLesson.tsx` (incl. `:147` «الألعاب قيد المراجعة…المعلم والمراجع الشرعي», grown-up controls `:201-224`), `ListenGlow`, `Echo`, `WhichHeard`, `CountAyat` (Arabic dual/plural at `:13`), `common.tsx` (`Praise` at `:100`) | ~44 |
| **Open branches** | #312 (a superset of #306/#307): «⚙ للكبار», the age picker, and seven new games with 7–13 strings each. #280: pair labels. | ~+75 |

**Confirmed: the PD-49 game engine has no English UI**, on `main` and on #306, #307 and #312. English inside the engine is staff metadata only: `review.note`, `provenance`, and `about`/`respect` in `play/mechanics.json`. `SurahInfo.nameEn` exists (`apps/lessons/src/quran/dataset.ts:21`) but no UI renders it.

### 1.3 The reader's language never reaches the engine

| Step | Today | Evidence |
|---|---|---|
| **Who has a language** | Only a **family** does: `family.language`, `check (language in ('ar','en'))`, default `'ar'`. Enrolment always writes `'ar'`, and **no endpoint updates it**. Staff and teachers are hard-coded `'ar'`. | `apps/api/prisma/schema.prisma:76`; `supabase/migrations/20260905090300_chat_family_domain.sql:30`; `apps/api/src/new-students/enrolment.service.ts:253`; `apps/api/src/platform/identity.service.ts:236,258,279` |
| **Where it is used** | `/me` returns `locale`. Cards, certificates and notifications pick their language from it. | `apps/api/src/platform/auth/auth.dto.ts:17,95`; `apps/api/src/scheduled-calls/scheduled-call.service.ts:110`; `apps/api/src/certificates/certificate.service.ts:1189,1373` |
| **The Flutter UI language** | Device locale, or a device-only override that is "never sent to the server". `AuthUser.locale` is parsed but drives nothing. | `lib/features/settings/application/locale_preference.dart:9-15,72`; `lib/core/data/http/http_auth_repository.dart:274` |
| **The launch URL** | `${siteBase}${item.sitePath}`, with no language. | `apps/api/src/materials/materials-reader.service.ts:278` |
| **The openers** | Admin Web: `<iframe src={opened.url}>` unchanged (`apps/admin-web/src/features/materials/MaterialsPage.tsx:529-537`). Flutter: `material_player.dart:135,140` → `activity_view.dart:23`, unchanged. | as cited |
| **The engine** | Routes are path-only (`apps/lessons/src/route.ts:12-24`). No query or hash is read. postMessage carries audio only: `jawwid:quran-audio`, `jawwid:lesson-ready`, `jawwid:lesson-audio` (`apps/lessons/src/audio/audio-manifest.ts:25,27`; `apps/lessons/src/arabic/voice.ts:14,25`). | as cited |

### 1.4 Content and review data have no language

- **Lesson content** is bundled JSON with a single `text` per item. There is no `lang` field and no variant:
  - `apps/lessons/src/content/surah-NNN.json`;
  - `apps/lessons/src/arabic/lesson-NNN.json`;
  - `apps/lessons/src/play/mechanics.json`.
- **English cannot simply be added to an item:**
  - Schema 2 refuses unknown fields (`apps/lessons/src/content/quran-content.ts:289,300`).
  - `play/mechanics.ts:48` requires an exact key set (`nameAr` and no `nameEn`).
  - The approval hash covers the **whole item**: `approvalSha256 = sha256(canonical{datasetId, item, lessonKey})` (`quran-content.ts:150-152`; `apps/api/src/lesson-content/review-subjects.ts:52`). So adding English to an item would invalidate its Arabic signatures. This is why §5.2 puts English in sibling records.
- **`chat.lesson_content_review`** (`supabase/migrations/20261029235000_chat_pd049_lesson_content_review.sql:47-66`):
  - `scope` is `quran-NNN | play`;
  - `step` is `check | teacher | scholar`;
  - the category list already includes `'language'`;
  - **there is no language column.**
- **PD-48 clips** (`supabase/migrations/20261029230000_chat_pd048_lesson_audio.sql`): `lesson_key` is limited to `^arabic-[0-9]{3}$` (`:65`). There is no language column, and the voice is implicitly Arabic.
- **Materials catalogue:** `material_item` has `title_ar`/`title_en` but **one `description`** (`supabase/migrations/20261022180000_chat_pd029_materials.sql:245-247`). `quran_surah` has `name_ar`/`name_en` (`:54-55`). Surah English names are transliterations, e.g. "Al-Ikhlas" (`apps/api/src/materials/quran-surahs.ts:18-131`). There is no English meaning of the name.

### 1.5 Fonts

- The engine asks for `'Amiri Quran', 'Amiri', serif` (`apps/lessons/src/styles.css:25,27,40,50,88`), but **bundles no font file and has no `@font-face`**. Its CSP is `font-src 'self'` (`apps/lessons/index.html:8`). So Amiri Quran renders only where the device happens to have it installed. This is a gap against the dataset contract ("`apps/lessons` self-hosts it", `docs/product/quran-dataset-contract.md` §Fonts), whatever language is shown. PR-1 closes it.
- The UI font is `system-ui, 'Segoe UI', Tahoma, sans-serif` (`styles.css:11`).
- Flutter gets `assets/fonts/AmiriQuran.ttf` (OFL) in #295 (PD-39 PR-3, open).

---

## 2. The Quran

### 2.1 Rules (binding)

1. **The Arabic text is the Quran, and nothing else is.** It is always the pinned Tanzil Uthmani text, in Amiri Quran, in both modes. It is never replaced by a translation, never shown as transliteration, and never dropped in English mode.
2. **English is a "translation of the meanings"**, never "the Quran in English". Every English block carries:
   - the label "Translation of the meanings" (Arabic: «ترجمة معاني»);
   - the attribution: translator, title, year;
   - the reader-facing sentence: "A translation of the meanings cannot replace the Arabic Quran." The owner approves the final wording; it is the same idea as Tanzil's own disclaimer.
3. **Placed beside, never inside.** The Arabic verse comes first. The English is a separate block below it in LTR, smaller, marked `lang="en"`. It is never interleaved word by word, and never used as an answer, option or tile in a game. **Games stay Arabic Quran only**; English appears there only as instructions and praise.
4. **Verbatim and pinned, as the Tanzil text is.** The translation file is vendored once, with `fileSha256`, a per-verse SHA-256, the attribution and the source scan. It is pinned in code and in a manifest, guarded in CI, and append-only in the database. A verse's English is shown only if its hash matches the pin.
5. **Aligned by Hafs numbering.** The loader proves exactly 6,236 verses, and each surah's count equals `quran_surah.ayah_count`. A surah whose printed numbering differs gets a reviewed alignment map, or no English at all.
6. **Never voiced in v1.** The translation of the meanings is not read by TTS (§9 Q12). Recitation stays human and licensed (PD-48 §12).
7. **Gated like recitation.** `quran.translation.enabled_for` = `none | staff_test | all`. Each surah's English is shown to families only after the scholar's sign-off for that surah (§5.3).

### 2.2 Candidates under "public domain only"

**Copyright conclusions are an engineer's reading, not legal advice. Counsel is optional**, as in PD-49 §A.7. Dates come from the cited pages, plus general reference where marked.

| | **Pickthall**, *The Meaning of the Glorious Koran* | **Yusuf Ali**, *The Holy Qur'an: Text, Translation and Commentary* |
|---|---|---|
| **First publication** | 1930, Alfred A. Knopf, New York and London ([Wikipedia](https://en.wikipedia.org/wiki/The_Meaning_of_the_Glorious_Koran); [Wikisource index of the 1930 print](https://en.wikisource.org/wiki/Index:The_Meaning_of_the_Glorious_Koran_(1930).pdf)) | 1934–1937 in 30 parts, Shaik Muhammad Ashraf, Lahore; 3rd edition 1938 ([Wikipedia](https://en.wikipedia.org/wiki/The_Holy_Qur%27an:_Text,_Translation_and_Commentary)) |
| **Translator's death** | 1936 (general reference: 19 May 1936) | 1953 ([Wikipedia](https://en.wikipedia.org/wiki/The_Holy_Qur%27an:_Text,_Translation_and_Commentary): 1872–1953) |
| **Life + 50** (Saudi Arabia, Egypt, Qatar) | Free since 1987 | Free since 2004 |
| **Life + 70** (EU, UK) | Free since 2007 | Free since 1 January 2024 |
| **United States** | **Free since 1 January 2026** (a 1930 publication; 95-year term) | **Probably protected until about 2030–2033.** Its US copyright was restored under the URAA (1996), and the term runs 95 years from each part's publication. sacred-texts.com reads it as protected until 2033 ([sacred-texts](https://sacred-texts.com/isl/quran/index.htm)). |
| **Revised editions (NOT usable)** | Modern re-editions, e.g. IDCI "New Modern English Edition" (2011) and the Fahmy edition (2022) ([Wikipedia](https://en.wikipedia.org/wiki/The_Meaning_of_the_Glorious_Koran)) | KFGQPC revision (1985); Amana/IIIT "New Revised" (1989 onward), with changes to the translation and the commentary ([Wikipedia](https://en.wikipedia.org/wiki/The_Holy_Qur%27an:_Text,_Translation_and_Commentary)). **Most digital "Yusuf Ali" copies are of unclear edition.** |
| **Style** | Literal, close to the Arabic's structure. Keeps "Allah". Little interpolation in the verse text. **Archaic English** (thee, thou, ye, -eth) and long sentences. | Freer and more explanatory. Adds words in parentheses, with poetic diction. More of the translator's interpretation is in the verse text. Archaic too. **About 6,000 footnotes**, whose content drew criticism (Wikipedia, above). We would never use them. |
| **Readability for children** | Poor below 9. Workable for 9–12 with a parent, and for parents and staff. | Poor below 9. Similar for 9–12; the parentheses help some readers and confuse others. |
| **Clean digital text with verse alignment** | **Not ready-made from a source we may use.** The 1930 scan is on Wikimedia Commons. Wikisource's transcription is incomplete, and its pages are "To be proofread" (index above). Tanzil's digital copy is offered **"for non-commercial purposes only"** ([tanzil.net/trans](https://tanzil.net/trans/)), so it is **not** used, not even as an import. | Same problem, plus the edition question: a copy must be proved to be the 1934–38 text, not a later revision. |
| **Verdict** | **Recommended** | Not usable for US accounts before about 2033, and edition provenance is hard to prove |

**Not public domain, so excluded by the owner's rule unless the owner makes an exception (§9 Q2):**

| Work | Why |
|---|---|
| **Saheeh International** (Dar Abul-Qasim, Jeddah, 1997) | In copyright. Distributed free, but no reuse licence was found ([Wikipedia](https://en.wikipedia.org/wiki/Sahih_International); [IslamHouse page](https://islamhouse.com/en/books/78592/)). |
| **QuranEnc.com** English translations (Saheeh, "Rowwad Translation Center", Waleed Bleyhesh and others) | In copyright, but published under the **same IslamHouse-family policy as HadeethEnc**: unaltered, credited to QuranEnc.com with the version number, notes reported back, kept up to date, no unsuitable ads. It has a per-surah JSON API keyed by translation ([english_rwwad](https://quranenc.com/en/browse/english_rwwad), [english_saheeh](https://quranenc.com/en/browse/english_saheeh)). Modern, verse-aligned and scholar-reviewed. |
| Hilali & Khan; Arberry (1955; died 1969, so protected under life + 70 until 2039); Ahmed Ali; Itani; and every other modern translation | In copyright |

### 2.3 Recommendation, and what happens next

- **Recommend Pickthall (1930)** as the English translation of the meanings (§9 Q1). It is public domain in every main market today, including the US since 2026. It is the more literal of the two, it keeps "Allah", and it puts the least of the translator's own interpretation into the verse text.
- **Its weakness is register.** Its English is archaic, so it is shown to the 9–12 band, parents and staff. Ages 3–8 get the meaning through PD-49's child tafsir in English (§2.5), written in our own reviewed words, not through a verse translation (§9 Q3).
- **The text is never modernised.** It is shown verbatim, with the attribution. Where the scholar finds a rendering misleading, we never edit Pickthall. Instead (§9 Q4):
  - **recommended:** a short note, clearly labelled as Jawwid's own and reviewed like any item, shown under that verse;
  - or that verse's English is withheld, fail-closed.
- **Getting a clean text (after the owner chooses, not before):**
  1. Pin one scan of the 1930 print: its URL, SHA-256 and page count. Its edition is recorded the PD-49 §A.0 way: printer, place, year, and why it is free.
  2. Transcribe it twice, independently: OCR plus a human pass, and a second human keying. A second public-domain print may serve as the second witness. Wikisource pages count only if they are validated transcriptions of a public-domain print.
  3. Diff the two by verse. A human resolves every difference against the scan.
  4. Prove the alignment (§2.1 rule 5).
  5. Vendor the file with its pins (§2.1 rule 4) in a reviewed PR.
- **Nothing is downloaded for this plan.** The sources are listed in §10.

### 2.4 Surah names and transliteration

- **Surah names:** the existing transliterated `nameEn` stays as it is, e.g. "Al-Ikhlas" (`apps/api/src/materials/quran-surahs.ts`). We add an **English meaning of the name**, e.g. "Al-Ikhlas (Sincerity)", written by us: 114 short items, reviewed by the bilingual reviewer and the scholar. Neither Tanzil's metadata nor any other list is copied.
- **One transliteration scheme**, the one `quran-surahs.ts` already follows, written down in the glossary (§5.5):
  - plain ASCII with no diacritics, readable by children;
  - `Al-` with a hyphen, and sun letters assimilated (`An-Nas`, `At-Tawbah`);
  - an apostrophe for hamza and 'ayn where it helps (`Al-Ma'idah`);
  - final ta marbuta as `-ah`.
- **No transliteration of Quran verses**, in any mode or band (§9 Q11). It teaches reading the Quran from Latin letters, and it cannot carry Tajweed. A child who cannot read Arabic yet listens (when recitation is on) and learns the letters in the Arabic lessons.

### 2.5 The PD-49 child content in English

- Every knowledge item (intro, tafsir, word, lesson, story, theme, quiz, asbab) gets an optional English sibling (§5.2). It is a **translation of the approved Arabic item**, written by a human bilingual author in the band's register. It is never derived from Pickthall or any other source directly; its source is our approved Arabic, which already carries the citation.
- `{{w:a:n}}` word placeholders stay positions. In English the engine renders the **Arabic word** from the verified text, inline with `dir="rtl"`. It never renders a transliteration or an English stand-in for a Quran word.
- An English word-meaning item glosses the Arabic span. Its English is ours; it is not Pickthall's wording.
- The asbab, aqeedah and display rules of PD-49 §A.3 and §A.5 apply unchanged: an English item exists only for an Arabic item that is shown.

---

## 3. Arabic Language lessons

- **The content stays Arabic; that is the subject.** Letters, words, syllable drills, sentences and passages are never translated in place, and never transliterated as a substitute.
- **English adds three things**, each its own reviewed record (§5.2):
  1. **Instructions and UI**: «اِخْتَرْ كُلَّ كَلِمَةٍ فِيهَا حَرْفُ…» → "Choose every word that has the letter «ب»". These are UI strings (§6).
  2. **Explanations**: unit notes (`<unit>.note`), the letter's name and sound in English ("ba: sounds like the b in 'book'"), and the stage explanations of the reading lessons (fatha, kasra, damma).
  3. **Meanings**: a gloss for each word (tap to see, never over the Arabic), and a meaning for each sentence and passage title in lessons 5 and 10.
- **Glossary of grammar terms (EN/AR)**, part of §5.5. Examples: حَرْف letter · حَرَكَة vowel mark (haraka) · فَتْحَة fatha · كَسْرَة kasra · ضَمَّة damma · سُكُون sukun · شَدَّة shadda · تَنْوِين tanween · مَدّ madd · هَمْزَة hamza · أَلِف alif · مَقَاطِع syllables · جُمْلَة sentence. Each term has **one** English form, and the checker enforces it (§5.5).
- **Gloss rules:**
  - one sense per word: the sense the lesson uses, as a child would meet it;
  - verbs as in "he wrote" (كَتَبَ), not the dictionary infinitive;
  - proper names are marked "(a name)" and not translated;
  - a syllable drill (`syllables`, reading design §3 Q1) has **no** gloss, because it is not a word.
- **Every English gloss is reviewed by a bilingual Arabic teacher** (§5.3). Machine translation may draft glosses and instructions, recorded as `drafted: "machine"`. **Nothing machine-drafted ships without that review** (§9 Q10).
- **The 3-word Quran refusal applies to English too**, in its own form. An English item may not contain Arabic script at all, so Quran can reach an English text only through a position placeholder.
- **G-20.** English glosses of names in reading sentences (e.g. a child's name in lesson 5) can trip the staff-name guard, which matches Latin spellings. The guard runs on the English files like any other. A tripped gloss uses "(a name)" instead of a transliteration.

---

## 4. Islamic Studies

The 35 `islamic/` lessons are not built yet; they follow the 114-surah work (PD-29 owner decision 2026-10-29). **They are built bilingual from their first PR**, rather than translated later, with Arabic as the source of truth.

- **Hadith in English.** HadeethEnc publishes English translations under the same IslamHouse policy.
  - The English matn is shown **unchanged**, with HadeethEnc's own grade and takhrij, attributed "Translation: HadeethEnc.com", and pinned as its own snapshot (`hadeethenc-en-<date>`), as the Arabic import plan describes.
  - **The written-OK gate covers both languages.** The draft letter to IslamHouse (department head's notes, `islamhouse-written-confirmation-letter.md`) mentions only the Arabic hadith. **Recommend adding one line** before it is sent: "and HadeethEnc's English translations, under the same conditions". If it has already gone, send a short follow-up (§9 Q2).
  - Until the reply: no English (or Arabic) hadith is loaded. A hadith line stays held, as today.
  - Jawwid's own simplified explanation is labelled in English with the policy's wording, already approved in both languages (PD-29: "This simplified explanation was prepared using material published on HadeethEnc.com. It was prepared independently by Jawwid.").
- **Fiqh (wudu, salah).** The owner's rule applies to both languages: one simple, consistent method, with **no school names and no differences of opinion shown to children**.
  - The English is a translation of the **approved Arabic method steps**. It never adds a step, a condition or an alternative.
  - The method sign-off gate (Teachers department plus a qualified scholar) is per language. The English steps need the bilingual reviewer and the scholar before publication.
- **Terminology:** a transliterated term with an English gloss on first use in each lesson, then the term alone. For example: "wudu (ablution)", "salah (prayer)", "du'a (supplication)", "sunnah", "zakah", "Ka'bah". The forms are fixed by the glossary (§5.5).
- **Fixed forms for names of Allah and the Prophet ﷺ** (the scholar confirms, §9 Q14):
  - always "Allah", never "God", in our own English (Pickthall also says "Allah");
  - "the Prophet Muhammad ﷺ", with "(peace and blessings be upon him)" spelled out on first use per lesson, and the same as the screen-reader text of ﷺ;
  - other prophets "(peace be upon him)";
  - our wording is "Quran", never "Koran"; Pickthall's own title and text stay verbatim.
- **Quran inside Islamic lessons:** by position only, as in Arabic (the whole-Quran 4-word index). In English mode the cited verses also show Pickthall's translation, labelled (§2.1).

---

## 5. Accuracy and the review workflow

### 5.1 Principles

- **Arabic first.** For Quran and Islamic content, an English item can be reviewed only after its Arabic item is approved, and it binds that approval (§5.2).
- **Per item, per language, per text hash.** These are the same patterns as PD-48 and PD-49.
- **Fail-closed.** An English item that is draft, rejected, withdrawn or stale is not in the bundle, and is not shown.
- **No runtime machine translation, ever.** A guard fails the build on any translation API, `Intl`-based translation shim or browser translation hook in `apps/lessons`. That is the same idea as PD-48's `speechSynthesis` guard. The engine page also sets `translate="no"`, so a browser's own "translate this page" never rewrites the Quran or the lessons.
- **People are named in the database, never in the repo** (G-20, PD-49 §F.2).

### 5.2 The English record and its hash

English goes in **sibling files**, so it never changes an Arabic item's hash:
- `apps/lessons/src/content/surah-NNN.en.json`
- `apps/lessons/src/arabic/lesson-NNN.en.json`
- `apps/lessons/src/play/mechanics.en.json`: mechanic names and instructions
- later, `islamic/lesson-NNN.en.json`

```jsonc
{ "schema": 1, "lang": "en", "lessonKey": "quran-112", "datasetId": "tanzil-uthmani-1.1",
  "items": [
    { "id": "tafsir-001",                 // the SAME id as the Arabic item
      "of": "<approvalSha256 of the Arabic item it translates>",
      "text": "Say: Allah is One {{w:1:4}} …",   // positions render the Arabic word
      "drafted": "human" }                  // or "machine" (§9 Q10); recorded, never shown
  ] }
```

- **The English approval hash** = `sha256(canonical{datasetId, lessonKey, lang: "en", item})`. Because `of` is inside the item, an edit to the Arabic item makes its English stale automatically. Nobody has to remember to pull it.
- **The checker refuses:**
  - an English item whose `id` has no Arabic item;
  - an `of` that is not the Arabic item's current approval hash;
  - Arabic script anywhere in the English text (Quran arrives only through positions);
  - a `{{w}}` placeholder that is not a valid span;
  - a term spelled against the glossary (§5.5).
- **The engine shows an English item only if:** its Arabic item is shown, its own signed approval matches its hash, and `of` equals the Arabic item's hash. That is the same second check PD-49 §F.3 does.

### 5.3 Review steps per language

| Kind (PD-49 `requiredSteps`, `quran-content.ts:69-78`) | Arabic (unchanged) | English |
|---|---|---|
| word | check, teacher (+ scholar if `aqeedah`) | **translation** (+ scholar if `aqeedah`) |
| quiz (category tafsir, asbab, lessons, or aqeedah) | check, teacher, scholar | **translation**, scholar |
| other quiz | check, teacher | **translation** |
| tafsir, tafsir_extra, theme, lesson, story, asbab, intro | check, teacher, scholar | **translation**, scholar |
| game mechanic (names, instructions) | teacher, scholar | **translation** |
| Arabic-lesson gloss, note, instruction | Teachers dept (file review today) | **translation** |
| Islamic lesson item; fiqh step | per PD-29 (teacher, method sign-off) | **translation**, scholar |
| Pickthall, per surah | n/a | **scholar** sign-off of the surah's translation as shown, plus any Jawwid notes (§2.3) |
| Glossary entry | n/a | **translation**, scholar (religious terms) |

- **The `translation` step** is signed by a **qualified English-Arabic reviewer** holding a new PD-40 key, `lesson_content.review_translation`. They check:
  - fidelity to the approved Arabic: meaning, nothing added, nothing dropped;
  - correct, natural English in the band's register;
  - the glossary.
- **Reviewers per subject** (§9 Q7):
  - Quran and Islamic Studies: a bilingual reviewer with Islamic-studies training;
  - Arabic Language: a bilingual Arabic teacher.
  - The same "one person, one step" trigger applies, and the **author never reviews their own translation**.
- **The scholar's English step** checks the **religious meaning** of the English. If the scholar does not read English well enough to sign it, a **second** bilingual reviewer prepares a written back-translation, and the scholar signs against that. The back-translation is stored with the review row's reason (§9 Q6).
- **Rejection categories** add `translation_meaning`, `translation_omission`, `english_language`, `register` and `glossary` to the existing list (which already has `language`).

### 5.4 What a learner sees in each mode

| | Arabic mode (default) | English mode |
|---|---|---|
| Quran verse | Arabic | Arabic, **always**, plus Pickthall below it if the surah's English is approved and enabled for the account (9–12, parents, staff) |
| Approved child item with approved English | Arabic | Arabic, with the English beneath (§9 Q9) |
| Approved child item, English missing or stale | Arabic | **Arabic only. No placeholder and no "coming soon"** (PD-48's rule) |
| UI strings | Arabic | English. A missing key is a **build failure**, never a runtime fallback (§6) |
| Held or unapproved item | not shown | not shown |

### 5.5 The glossary and consistency checks

- `apps/lessons/src/content/glossary.json`: `{ id, ar, translit, en, firstUse, scope: [quran|arabic|islamic], forbidden: ["God", "Koran", "ablution-alone", …] }`, reviewed as items (scope `glossary`).
- The checker lints every English file:
  - forbidden variants are refused;
  - on first use in a lesson, a glossary term must appear in its `firstUse` form ("wudu (ablution)");
  - the transliteration must match the glossary.
- A **style guide** per band (PR-4) mirrors PD-49's Arabic authoring guide:
  - vocabulary and sentence-length limits;
  - British or American spelling, one throughout (§9 Q12 picks the voice; spelling follows it);
  - no idioms that do not translate;
  - plain present tense for tafsir.

### 5.6 What changes in the review system (#258, #265)

**One migration** (PR-3; slot from the head):
- `chat.lesson_content_review` gains `lang text not null default 'ar' check (lang in ('ar','en'))`, and `lang` joins the unique index and the item index.
- `step` gains `translation`; `chat.lesson_content_step_key` maps it to `lesson_content.review_translation`.
- `scope` widens to `quran-NNN | play | arabic-NNN | islamic-NNN | glossary`. The Arabic lessons and Islamic lessons then move their review into the database, as PD-49 did for surahs.
- Existing rows are Arabic, through the default. No row is edited.

**The signed export** goes to payload `v: 2` with `lang`, written to `approvals/surah-NNN.en.json` and the like. The ledger, the replay rules and "no PR checks itself" (#265) are unchanged. Two cautions:
- The verifier and the engine's readers are protected code, so their change goes in a PR that changes no approvals file.
- The loader rule "reads exactly what `verify-approvals.mjs` checks" still holds.

**The `/lesson-content` queue in Admin Web** (PD-49 PR-3, not built yet) should be built bilingual from the start:
- a language filter;
- the Arabic approved text and its English side by side;
- "needs my step: translation".
Coordinate with whoever builds PD-49 PR-3, so the page is not built twice.

---

## 6. UI: the engine, the games and Materials

- **String tables:** `apps/lessons/src/i18n/{ar,en}.ts`, typed. A test fails unless both have the same keys and the same placeholders.
  - Arabic keeps its full tashkeel and its plural logic (`CountAyat.tsx:13`). English gets its own plural rule (`Intl.PluralRules('en')`).
  - A lint fails on any Arabic or Latin literal in `.tsx` outside the tables. Verified-text rendering and the content files are exempt.
- **The reader's language:**
  - The engine reads `?lang=ar|en` once at boot, from an allowlist; anything else means `ar`.
  - It sets `<html lang dir>` before the first render, and never reads it again.
  - It carries no personal data, so it is safe in a URL.
  - The API appends it in `materials-reader.service.ts:278`, from the **family's language** for a family account (§9 Q8). Staff preview in the Admin Web UI language: the opener may set `lang` to its own locale, from the same allowlist.
- **Mixed direction:**
  - In English mode every Arabic block (verse, letter, word, sentence) is wrapped `lang="ar" dir="rtl"`.
  - Inline Arabic inside English uses `<bdi lang="ar">`, so «ب» never reorders the sentence.
  - In Arabic mode, English (the Pickthall block) is `lang="en" dir="ltr"`.
  - The layout already uses logical properties (§1.2).
- **Digits:** a `formatNumber(lang)` replaces the seven hard-coded `ar-EG` calls. Arabic-Indic digits in Arabic mode, Western digits in English mode. The verse-end marks stay inside the Quran text as Tanzil writes them.
- **Fonts:**
  - **Bundle Amiri Quran in `apps/lessons`** (OFL 1.1, the same file version as #295) with `@font-face` under `font-src 'self'`. This closes the §1.5 gap. It is used for the Quran in **both** modes and for nothing else.
  - The Arabic UI keeps its font.
  - For English, recommend **Andika** (SIL, OFL), which is designed for beginning readers (single-storey a, clear l/I/1); or keep `system-ui`.
- **Hosts:**
  - Admin Web Materials and Flutter Materials are already bilingual (§1.1).
  - Remaining: one `description` column. Add `description_ar`/`description_en`, or rename, in PR-2.
  - The engine's `<title>` and the "open from the app" message (`App.tsx:28-36`) are translated in PR-1.
- **Accessibility:**
  - `aria-label` per language;
  - English screen-reader text for ﷺ (§4);
  - a Quran block's accessible name is "Verse N" or «الآية N». Screen readers are never given a transliteration.
- **Parent-facing text** in the engine (the grown-up controls, the review banners at `SurahLesson.tsx:156` and `PlayLesson.tsx:147`) is in the tables like everything else. The Flutter and Admin Web progress views already follow the device or Admin Web locale.

---

## 7. Voice-over (PD-48) in English

- **What gets an English voice:**
  - English **instructions** (the UI table's learner prompts);
  - English **explanations and glosses** in the Arabic lessons.
- **Never voiced:** Quran recitation (always human and licensed); the translation of the meanings (§2.1 rule 6); hadith matn in either language; and Arabic letters, words or sentences. The Arabic content keeps its own Arabic clips.
- **The same pipeline**, operator-run and offline, bound to (lesson, id, sha256 of the exact text), with two different reviewers, fail-closed. Changes:
  - one migration (PR-8; slot from the head): `lang` on `lesson_audio_clip`, `lesson_audio_review` and `lesson_audio_string_decision`, in the unique key and the derived object key (`lesson-audio/<lesson>/<lang>/<id>/<sha>.mp3`);
  - the `^arabic-[0-9]{3}$` key rule stays: English instructions belong to the same Arabic lessons;
  - the render recipe already records the `locale`; English uses an Azure English neural voice (§9 Q12) under the same vendor terms;
  - **`generate.py` refuses any `en` input that contains Arabic script**, so neither Quran nor Arabic can reach the English voice;
  - an English lexicon (`lexicon/azure-en.json`) fixes transliterated terms ("wudu", "Al-Ikhlas", "fatha");
  - the reviewers for English clips hold `lesson_audio.review` **and** are English-qualified. Recommend a separate key, `lesson_audio.review_en`, so an Arabic-only reviewer cannot approve an English clip.
- **The disclosure notice** already exists in approved English and Arabic (PD-48 §17). No new wording is needed.

---

## 8. Phased PRs

| PR | Content | Needs |
|---|---|---|
| **PR-0** (this) | Plan and the PD-51 claim | Head's review; owner's answers (§9) |
| **PR-1** engine i18n | String tables ar/en for every existing engine string (lessons, games, reading, shell), `?lang`, `dir`/`lang` attributes, `<bdi>`, `formatNumber`, `translate="no"`, the no-MT guard, **Amiri Quran self-hosted**, English font. Openers pass `lang`; the API appends the family language. **No content changes.** | After #306, #307 and #312 merge (they add ~75 strings), to avoid a three-way conflict. The English UI strings get one bilingual review pass (§7 volume). |
| **PR-2** the family's language | An endpoint for a parent or staff member to set `family.language` (Flutter Settings "Lessons language", Admin Web Parent Profile, the enrolment form). `material_item` description per language. | A migration slot only for the description column |
| **PR-3** review per language | The migration of §5.6; the PD-40 keys `lesson_content.review_translation` (and `lesson_audio.review_en` for PR-8) in a LATER seed block; the `translation` step in `requiredSteps` (TS and SQL); export v2; the bilingual `/lesson-content` queue | Slot; PD-40 seed block; coordinate with PD-49 PR-3 |
| **PR-4** glossary and style guide | `glossary.json`, the checker's lints, and the English authoring guide per band | Teachers dept and scholar approve the guide (as PD-49 §A.6 step 2) |
| **PR-5** Pickthall | Pinned scan, double transcription, alignment proof, vendored file and pins, a guard, the API field (`/quran/ayahs` gains `translation`), the engine display, and the `quran.translation.enabled_for` gate | **Owner's Q1.** Then the download. Scholar sign-off per surah before families see it. |
| **PR-6** Arabic lessons in English | `lesson-NNN.en.json` for 1, 3, 6, 7 (on main), then each lesson as it lands: instructions, notes, letter names, glosses, sentence meanings | PR-1, PR-3, PR-4 |
| **PR-7** PD-49 content in English | `surah-NNN.en.json` for the pilot (1, 112, 105, 111), after its Arabic is approved; then Juz' Amma in PD-49's batches | PD-49 PR-5 (Arabic pilot approved) |
| **PR-8** English voice-over | The migration of §7, the English voice, the lexicon, the generation guard | PR-1, PR-3, an English reviewer; the vendor account is already the owner's PD-48 action |
| **PR-9** Islamic Studies, bilingual | With PD-29's Islamic batches (Prophet ﷺ lessons first), Arabic and English together; English hadith after IslamHouse's reply | PD-29 sequencing; Q2 |

**Order:** PR-1 → PR-3 → PR-4 → PR-6 (smallest content, proves the pipeline) → PR-5 (Pickthall, staff_test first) → PR-7 → PR-8 → PR-9. PR-2 can run any time after PR-1.

### 8.1 Review volume

These are estimates, to be re-measured in the first English batch, as PD-49 §G.4 does.

| Work | Items | Author (bilingual) | `translation` review | Scholar |
|---|---|---|---|---|
| Engine UI strings (main + open PRs + new) | ~270 | ~6 h | ~4 h (one pass) | — |
| Surah-name meanings | 114 | ~2 h | ~1.5 h | ~1 h |
| Glossary | ~150 terms | ~5 h | ~2 h | ~2 h (religious terms) |
| **Pickthall, transcription** | 6,236 verses | double keying, then resolving diffs against the scan (assume 5–10% differ: ~300–600 verses at ~1 min) | ~5–10 h | — |
| **Pickthall, scholar reading** | Juz' Amma + Al-Fatihah: 571 verses at ~30 s | — | — | **~5 h** (whole Quran ~52 h, by demand) |
| PD-49 Juz' Amma content in English | ≈ 1,900–2,000 (PD-49 §G.4) at 2–4 min to author | ~65–130 h | ~25–33 h at 45–60 s | ~11–15 h (≈ 900 scholar-kind items at ~45 s) |
| Arabic lessons 1, 3, 6, 7 on main | 2,455 words + 2 notes + 249 quiz items (counted from the JSON) | ~45 h (1 min a gloss) | ~20 h (30 s) | — |
| Arabic lessons 2, 4, 5, 8, 9, 10 | ≈ 1,500 words, ~60 sentences, 11 passages (assumed) | ~30 h | ~13 h | — |
| Islamic Studies, 35 lessons | ≈ 1,400 items (assumed ~40 per lesson) | ~70 h | ~20 h | ~15 h |
| **Juz' Amma scope** (everything except Islamic Studies and the rest of the Quran) | | **~150–220 h** | **~70–90 h** | **~20–25 h** |

**To shorten it** (§9 Q13): word glosses for letter lessons can come **on demand**. Gloss the reading lessons (5, 10) and the words used in quizzes first (~600), and the rest of the ~2,500 later. That cuts the first Arabic-lesson batch to about a quarter.

---

## 9. Owner decisions (numbered, each with a recommendation)

1. **The English translation of the meanings.** *Recommend **Pickthall (1930)**: public domain everywhere today (US since 2026), literal, keeps "Allah". Yusuf Ali is probably protected in the US until about 2033, and its clean original text is hard to prove. Saheeh and the other modern translations are in copyright.*
2. **Ask IslamHouse about English too.** *Recommend adding one line to the HadeethEnc letter (or a follow-up if it has gone): HadeethEnc's English translations, and **QuranEnc's English translations of the meanings**, under the same conditions. It commits to nothing. If the owner later prefers a modern, scholar-reviewed English (e.g. QuranEnc's Rowwad or Saheeh) to Pickthall's archaic one, that would be an exception to "public domain only", on the same footing as the HadeethEnc exception. Pickthall stays the plan unless the owner decides otherwise.*
3. **Who sees the verse translation.** *Recommend the 9–12 band, parents and staff. Ages 3–8 in English mode get our reviewed English child tafsir instead (§2.5).*
4. **Pickthall's archaic or misleading renderings.** *Recommend verbatim always, plus a short, labelled, reviewed Jawwid note under any verse the scholar flags. No "modernised Pickthall": that would be our own derivative and would need all 6,236 verses re-signed.*
5. **The scholar's sign-off of Pickthall.** *Recommend a full reading per surah before that surah's English reaches families (about 5 h for Juz' Amma plus Al-Fatihah), with surahs unlocked by demand. A sampled check is not enough for a text shown beside the Quran.*
6. **Does the scholar read English well enough to sign English meaning?** *A question, not a recommendation: if not, §5.3's back-translation route by a second bilingual reviewer applies, which adds ~30% to the bilingual hours.*
7. **The bilingual reviewers.** *Recommend contracting two qualified English-Arabic reviewers: one with Islamic-studies training (Quran content, Islamic Studies, glossary) and one Arabic teacher (Arabic lessons, UI). Each is granted `lesson_content.review_translation` by the super admin. Authors and reviewers are always different people.*
8. **Whose language decides.** *Recommend the **family's language** (`family.language`, which exists and already drives cards and notifications), set by the parent in Settings or by staff at enrolment. The device's UI locale stays a device preference and does not change lesson content. Staff preview in their Admin Web language.*
9. **What English mode shows.** *Recommend: Arabic is always shown and English is added beneath. An item with no approved English shows in Arabic only, with no placeholder. Never English-only content for the Quran or Islamic texts.*
10. **Machine translation for drafts.** *Recommend allowing it only to draft UI strings, Arabic-lesson instructions and word glosses, recorded as `drafted: "machine"`, with full human review. **Never** for religious meaning (tafsir, lessons, stories, asbab, fiqh steps, Jawwid notes, hadith explanations): those are written by a bilingual human author from the approved Arabic, as PD-49 Q9 requires for the Arabic.*
11. **Transliteration.** *Recommend none for Quran verses, ever. One plain-ASCII scheme for surah names and religious terms (§2.4, §5.5). Add a reviewed English meaning to each surah name.*
12. **English voice and spelling.** *Recommend an Azure **en-GB** neural voice (Admin Web already formats English as `en-GB`), with British spelling throughout; or en-US with American spelling. The translation of the meanings is not voiced in v1.*
13. **Scope of the first content batch.** *Recommend: UI (PR-1) first. Then Arabic lessons 1, 3, 6, 7 with instructions, notes and quiz-word glosses only (other glosses on demand). Then Pickthall for Juz' Amma plus Al-Fatihah on staff_test. Then PD-49's pilot surahs in English once their Arabic is approved.*
14. **Fixed English forms.** *Recommend "Allah" (never "God"), "the Prophet Muhammad ﷺ" with "(peace and blessings be upon him)" on first use, "Quran" (not "Koran") in our wording, and transliterated terms with a gloss on first use ("wudu (ablution)"). The scholar confirms the list.*

---

## 10. Sources and licences (listed only; nothing downloaded)

| Source | Use | Licence or status | URL |
|---|---|---|---|
| Pickthall, *The Meaning of the Glorious Koran* (1930), scan of the Knopf print | Q1 candidate (recommended) | Public domain (§2.2) | https://en.wikisource.org/wiki/Index:The_Meaning_of_the_Glorious_Koran_(1930).pdf |
| Pickthall, background and editions | | | https://en.wikipedia.org/wiki/The_Meaning_of_the_Glorious_Koran · https://quran-archive.org/marmaduke-pickthall |
| Yusuf Ali, *The Holy Qur'an* (1934–38) | Q1 alternative | PD outside the US; US probably to ~2033 | https://en.wikipedia.org/wiki/The_Holy_Qur%27an:_Text,_Translation_and_Commentary · https://sacred-texts.com/isl/quran/index.htm |
| Tanzil translations | **Not used** | "for non-commercial purposes only" | https://tanzil.net/trans/ |
| Saheeh International | Excluded (in copyright) | No reuse licence found | https://en.wikipedia.org/wiki/Sahih_International · https://islamhouse.com/en/books/78592/ |
| QuranEnc.com English translations | Q2 option, needs an exception | IslamHouse-family policy: unaltered, credited, versioned, kept updated | https://quranenc.com/en/browse/english_rwwad · https://quranenc.com/en/browse/english_saheeh |
| HadeethEnc.com English | Islamic Studies hadith | IslamHouse policy; written OK pending (PD-29) | https://hadeethenc.com/api-docs/ |
| Amiri Quran | Quran font, both modes | SIL OFL 1.1 | already pinned for Flutter in #295 |
| Andika | Optional English reading font | SIL OFL 1.1 | https://software.sil.org/andika/ |
| Azure AI Speech, English neural voices | English voice-over | As PD-48 §2.5 / §2.8 | https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts |

The department head's notes folder keeps the working notes. Copyright readings are an engineer's, not legal advice. Counsel is optional (PD-49 §A.7), and the useful question for counsel would be Yusuf Ali's US status, if Q1 ever turns to it.
