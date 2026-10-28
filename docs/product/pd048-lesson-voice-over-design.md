# PD-48: voice-over for the Arabic lessons (design)

**State:** **Design, docs only.** No product code is written. The owner answered Q1–Q6 on 2026-10-28 and Q7 on 2026-10-29 (§17), relayed by the department head. Every question is decided. Code follows the department head's approval.
**Claim:** `docs/product/pd-registry/PD-48.md`. **Migration slot:** `20261029230000`, assigned by the department head for PR-2 (§11). It is claimed in `docs/product/migration-slots/20261029230000.md`.
**Base:** `main` @ `90b9d2d7`. Paths are relative to the repository root. `mig/` is `supabase/migrations/`.
**Depends on:** PD-29 P0-5 (Arabic lesson 1). The design is `docs/product/pd029-p05-arabic-letters-design.md` (PR #232); the engine and checker are PR-1 (#234, in progress). §4 is the one change PD-48 asks of that data shape.
**Not touched, by rule:** Quran recitation in every form: `chat.quran_ayah_audio`, `quran.audio.*` in `chat.config`, `apps/api/src/quran/audio-*.ts` and the engine's `jawwid:quran-audio` message. Quran audio is never TTS (§13). The `islamic/` lessons are out of scope.

The owner's request, verbatim:

> Can we add a voice-over feature for pronouncing letters, words, and sentences, provided that the pronunciation is 100% accurate? Since this is an educational app for children, we do not want any pronunciation errors, even minor ones.

The owner's decision (2026-10-28): the audio comes from a **computer voice (TTS)**, and a teacher approves **every** clip. A clip plays only after a qualified teacher has approved that exact clip. If the clip's text later changes, the clip switches off by itself until it is re-approved. The owner chose this over human recordings knowing that TTS often gets tashkeel, hamza, shadda and isolated letter sounds wrong.

---

## 1. Summary

No TTS vendor can promise 100% accurate Arabic. So the promise is not made by the vendor; it is made by the gate:

> **A child hears a clip only if qualified teachers listened to exactly those bytes, for exactly that text, and approved them. Anything else is silence: no play button.**

What that means in practice:

1. **Generated offline, once.** An operator runs a script on their own machine (§6). It sends each reading string to the vendor and saves the audio. Nothing is synthesized when a child opens a lesson. No browser voice (`speechSynthesis`) is ever used.
2. **Bound to its text.** Each clip is bound to the lesson, the string's stable id, the SHA-256 of the exact text and the SHA-256 of the voice settings (§5). If the text changes by one mark, the hash no longer matches and the clip stops playing everywhere at once. Nobody has to remember to switch it off.
3. **Approved per clip, by two reviewers.** Teachers department reviewers listen to each clip next to its vowelled text, then approve or reject it (§7, §9). The owner decided on **two different reviewers per clip** (Q1). One rejection is final for that clip.
4. **Fixed or left silent.** A rejected clip is regenerated with a pronunciation fix (lexicon entry, phoneme or a respelled input). If three tries fail, a reviewer marks the string "no audio". From then on it has no play button. It never falls back to another voice, an unapproved clip or the browser's voice.
5. **Fail-closed release, like Quran audio.** `lesson_audio.enabled_for` = `none | staff_test | all`. Unset means nobody hears anything. `all` also needs the vendor's licence confirmation **recorded in code** (§7.6).
6. **Checked twice before playback.** The server serves only approved clips whose text hash equals the text the API was built with. The lesson engine checks the text hash again against its own text, then plays a file only after its bytes hash to the approved SHA-256. That second check reuses the Quran audio pattern.

**Recommended vendor:** Azure AI Speech (an `ar-SA` neural voice) as primary, Amazon Polly as fallback. The reasons, the conditions and the sources are in §2.6.

## 2. Vendor research

Web reading only, 2026-10-28. Nothing was signed up for, no account was opened, no key was used and no vendor code was run. The full notes, with a source URL on every claim, are in the department head's notes folder: `pd48-tts-vendor-research.md`. What follows is the summary. Three licence claims were re-checked at the source for this doc: Polly's "cache and replay", Google §20(d) and the ElevenLabs under-18 rule.

**No published benchmark of commercial Arabic TTS on fully vowelled text was found.** So no vendor's accuracy can be taken on trust. That is why the pilot (§15) measures it, and why the gate (§7) never depends on it.

### 2.1 Voices

| | Arabic voices | MSA labelled? | Child voice? |
|---|---|---|---|
| **Azure AI Speech** | 32 neural voices in 16 country locales, two per locale (e.g. `ar-SA-HamedNeural`, `ar-SA-ZariyahNeural`, `ar-EG-SalmaNeural`). No Arabic HD voice. | No: labelled by country only | No |
| **Google Cloud TTS** | `ar-XA`: 30 Chirp 3 HD, 4 WaveNet, 4 Standard | **Yes**: `ar-XA` is defined as Modern Standard Arabic | No |
| **Amazon Polly** | `arb` Zeina (Standard engine, MSA); `ar-AE` Hala and Zayd (neural, Gulf Arabic + MSA) | Zeina only | No |
| **ElevenLabs** | Arabic on v2, Flash 2.5, v3 and v4; library voices | No | No |

**No vendor has an Arabic child voice** (Q5). The one child-oriented Arabic voice found is research: QCRI's NatiQ "Amina", built for children's storybooks (arXiv 2206.07373). It has no public API or licence, so at most it is worth one inquiry.

### 2.2 Fully vowelled text (tashkeel, pausal sukun, shadda, hamza)

- **Polly** is the only vendor that documents it: Zeina follows vocalized input, and only diacritizes when the marks are missing (AWS ML blog, 2019).
- **Azure** has its own diacritic-prediction model for ar-SA and ar-EG. It was updated in December 2024; Microsoft reports far fewer word errors, a figure seen only in a search summary. **Whether that model ever overrides marks we supply is not documented.**
- **Google** and **ElevenLabs** document nothing on Arabic diacritics.
- Pausal sukun, shadda and the hamza seats are not addressed specifically by any vendor.

Consequence for the design: a voice may "correct" a mark it was given. Only a human listening to the bytes catches that. The two-reviewer gate is not optional.

### 2.3 Isolated letters and syllables (بَ بِ بُ بْ)

No vendor documents it, and no evaluation was found. It stays the weakest point. The likely fix is an IPA `<phoneme>` per syllable (e.g. `ph="ba"`), or the letter name for a name. Lesson 1 has no syllable strings (§3), so this is a risk for later lessons, not a blocker now.

### 2.4 Fixing a wrong word (SSML)

| | `<phoneme>` for Arabic | Custom lexicon (PLS) | `<sub alias>`, `<break>`, rate |
|---|---|---|---|
| **Azure** | **Yes**, IPA, with a published ar-SA/ar-EG phone table (has ʔ; **no gemination symbol**, so how shadda is written is undocumented) | **Yes** (≤100 KB, one locale per file) | Yes, full SSML on non-HD voices |
| **Google** | Classic voices: **no** (Arabic not in the list). Chirp 3 HD: custom pronunciations in IPA/X-SAMPA, **Preview**, Arabic not excluded | No; a per-request dictionary only | Chirp 3 HD: Preview SSML, `speaking_rate`, pause markup |
| **Polly** | **Yes**, IPA/X-SAMPA, with an `arb` phone table | **Yes** (applies to Hala/Zayd: unverified) | Yes |
| **ElevenLabs** | Only through v3/v4 pronunciation dictionaries; no Arabic example | Dictionaries | Limited; its own docs warn that very short prompts are unstable (possibly outdated) |

### 2.5 Licence for storing and redistributing the audio in a paid children's app

- **Polly: clearest.**
  - The pricing page says you "can cache and replay Amazon Polly's generated speech at no additional cost" (re-checked).
  - AWS Service Terms §50.2: the output is your content.
  - §50.3: AWS may use what Polly processes to improve the service **unless the account opts out** (an AWS Organizations AI opt-out policy). Our input is lesson text, not personal data, but set the opt-out anyway.
- **Azure: probably fine, but the primary document was not read.**
  - The Microsoft Product Terms page could not be retrieved.
  - A 2023 answer from a Microsoft employee on Microsoft Q&A says commercial use of the output is fine on a **paid** resource (not free tier or free credits).
  - The Microsoft AI Code of Conduct (v4.0) **requires disclosing that the voice is synthetic**, prebuilt voices included (verified in §2.8, Q7). It does not ban children's or education apps.
  - Real-time synthesis stores neither the text nor the audio.
  - **The owner (or counsel) must read the Product Terms clause before the licence is recorded in `voice-sources.ts`** (§7.6).
- **Google: blocked pending legal review.**
  - Service Specific Terms §20(d) (re-checked): the customer will not use a *Generative AI Service* in an app "directed towards or is likely to be accessed by individuals under the age of 18".
  - The services summary lists Text-to-Speech under Pre-Trained APIs, but it also counts "any generative AI features" of a service as generative AI. Whether Chirp 3 HD falls under §20(d) is ambiguous.
- **ElevenLabs: not usable as is.**
  - Its Use Policy (re-checked): apps "directed at individuals under 18 are prohibited" unless ElevenLabs approves them **in writing**.
  - Its Terms §4(d) give ElevenLabs a perpetual licence to the output.

### 2.6 Price and recommendation

| | Per 1M characters | Free tier | One lesson (~25k chars) | Ten lessons with retries (~100k) |
|---|---|---|---|---|
| Azure neural | $15 (HD $22) | 0.5M/month (but use a paid resource) | ~$0.38 | ~$1.50 |
| Google Chirp 3 HD | $30 (WaveNet $4) | 1M/month | ~$0.75 | ~$3.00 |
| Polly neural | $16 (Zeina Standard $4) | 1M neural/month for 12 months | ~$0.40 | ~$1.60 |
| ElevenLabs | about $80 (Flash about $40) | 10k, non-commercial | ~$2 | ~$8 |

Azure and Google bill SSML markup as characters. The worst case (every clip wrapped, four passes) is about 1M characters per lesson: still about $15 on Azure. **Price does not decide this.**

**Recommendation:**
- **Primary: Azure AI Speech, an `ar-SA` voice (Hamed or Zariyah), on a paid S0 resource.**
  - It is the only vendor with Arabic `<phoneme>`, a custom lexicon, `<sub>`, `<break>` and rate control all documented together. So every rejection can become a permanent fix in `lexicon/azure.json`, instead of a gamble on the auto-diacritizer.
  - It retains nothing on real-time calls.
  - Conditions: the owner reads the Product Terms clause, and the synthetic voice is disclosed in a form the terms accept (§2.8, Q7).
- **Fallback: Amazon Polly.**
  - The clearest licence for stored, replayed audio.
  - The only vendor that documents honouring vowelled input (Zeina), with an Arabic phone table and lexicons.
  - Weaknesses: Zeina is an older non-neural voice, and Hala/Zayd sound Gulf.
- **Google Chirp 3 HD:** a pilot benchmark only (it has the only MSA-labelled voices), until a lawyer confirms §20(d) does not apply.
- **ElevenLabs:** not recommended.

**Before committing**, the pilot (§15 step 3) runs a ~60-item probe through the primary and the fallback: every hamza seat, shadda, pausal sukun, all 34 names, the بَ بِ بُ بْ series and three short sentences. A teacher scores each clip. The pilot's rejection rate decides between them. The design is vendor-neutral (the recipe records the vendor), so switching later costs regeneration and review, not code.

### 2.7 Not verified from documentation

1. The Microsoft Product Terms wording on output ownership, storage and redistribution.
2. Whether any voice other than Polly's Zeina always keeps supplied diacritics.
3. How to write shadda in an IPA override for Azure or Polly.
4. How any vendor handles isolated letters and syllables.
5. Whether Polly lexicons apply to Hala/Zayd.
6. Whether Google's §20(d) covers Text-to-Speech.
7. Whether Google's Chirp custom pronunciations work for Arabic.
8. Whether Azure's ar-SA voices are designed as MSA.
9. NatiQ, ReadSpeaker and Acapela licence terms and prices.

**Sources** (each is cited per claim in the notes file):
- Azure:
  - [language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)
  - [phonetic sets](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-ssml-phonetic-sets)
  - [pronunciation SSML](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-pronunciation)
  - [data privacy](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/text-to-speech/data-privacy-security)
  - [AI Code of Conduct](https://learn.microsoft.com/en-us/legal/ai-code-of-conduct)
  - [commercial use answer](https://learn.microsoft.com/en-us/answers/questions/1192398/can-i-use-azure-text-to-speech-for-commercial-usag)
  - [pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/speech-services/)
  - [Arabic update blog](https://techcommunity.microsoft.com/blog/azure-ai-services-blog/-/4360306)
- Google:
  - [voices](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types)
  - [phonemes](https://docs.cloud.google.com/text-to-speech/docs/phonemes)
  - [Chirp 3 HD](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd)
  - [Service Specific Terms](https://cloud.google.com/terms/service-terms)
  - [services summary](https://cloud.google.com/terms/services)
  - [pricing](https://cloud.google.com/text-to-speech/pricing)
- Polly:
  - [voices](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html)
  - [Arabic launch](https://aws.amazon.com/blogs/machine-learning/amazon-polly-adds-arabic-language-support)
  - [Arabic phone table](https://docs.aws.amazon.com/polly/latest/dg/ph-table-arabic.html)
  - [lexicons](https://docs.aws.amazon.com/polly/latest/dg/managing-lexicons.html)
  - [Service Terms §50](https://aws.amazon.com/service-terms/)
  - [pricing](https://aws.amazon.com/polly/pricing/)
- ElevenLabs:
  - [Use Policy](https://elevenlabs.io/use-policy)
  - [Terms](https://elevenlabs.io/terms-of-use)
  - [pricing](https://elevenlabs.io/pricing/api)
  - [prompting](https://elevenlabs.io/docs/best-practices/prompting)
- Research:
  - [NatiQ (arXiv 2206.07373)](https://arxiv.org/abs/2206.07373)
  - [diacritics in Arabic TTS (arXiv 2603.01622)](https://arxiv.org/html/2603.01622v1)
  - [ArVoice (arXiv 2505.20506)](https://arxiv.org/abs/2505.20506)

### 2.8 Disclosing that the voice is synthetic: what Azure and Polly require

Verified at the source on **2026-10-28**, for Q7. The owner's instruction was: don't show a disclosure unless it is mandatory, never bypass the provider's terms, and present compliant alternatives if it is mandatory. Every quote below was read on that date.

**Azure AI Speech: disclosure is a MUST, prebuilt voices included. How and where to disclose is a SHOULD.**

| Source | Exact words | MUST or SHOULD |
|---|---|---|
| [Code of Conduct for Microsoft AI Services](https://learn.microsoft.com/en-us/legal/ai-code-of-conduct), v4.0 (2026-05-01), opening | "defines the requirements that all customers of Microsoft AI Services (as defined in the Product Terms) must adhere to in good faith". It "unifies and replaces the previous codes for … Azure Speech in Foundry Tools text to speech" and "applies in addition to the Microsoft Product Terms". | Binding on every Azure AI customer |
| Same, Responsible AI requirement 3 | Customers "must ensure that all of their applications built with Microsoft AI Services … Disclose when the output … [is] generated by AI, including the synthetic nature of generated voices … such that users are not likely to be deceived or duped … into believing they are interacting with a real person, that any generated content is authentic …" | **MUST.** It covers all Microsoft AI Services, not just custom voice. The aim is stated: users must not be deceived. |
| Same, "Azure Speech and voice services" section | Its extra duties (opt-out, recording scripts, consent terms) apply to "personalized or AI-generated voice features" built from **External Users' own voices** (voice model training data). | Custom/personal voice only. **Not our case.** It neither adds to nor removes requirement 3. |
| [Text to speech Transparency Note](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/text-to-speech/transparency-note) (2026-03-31), "Disclose when the voice is synthetic" | "Microsoft requires its customers to disclose the synthetic nature of text to speech voices to its users." | **MUST**, restated for TTS. Not limited to custom voice. |
| Same, next bullet | "If your use case is intended for minors or children, you'll need to ensure that your disclosure is clear and transparent so that parents or legal guardians can understand the role of synthetic media and make an informed decision on behalf of minors or children about whether to use the experience." | For a children's app, the disclosure must reach **parents or guardians** clearly. |
| [Disclosure design guidelines](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/text-to-speech/concepts-disclosure-guidelines) (2025-11-21) | "This guide helps you determine which disclosure patterns are best fit". "If the context makes it clear that a synthetic voice is 'speaking,' disclosure may be minimal, momentary, or even unnecessary." | **SHOULD**, design guidance. It shapes the *form* of the disclosure. It cannot waive requirement 3. |
| Microsoft Product Terms (Azure, AI Services section) | **Not read.** The page answers 403 to automated readers (2026-10-28). The Code itself says it applies "in addition to" the Product Terms. | Must be read by a person (the owner or counsel) before the licence is recorded (§7.6) |

**So with Azure, "no disclosure anywhere" is not compliant.** The terms do not prescribe the form. Microsoft's own guidance for children's use cases points the disclosure at **parents and guardians**.

**Amazon Polly: no disclosure requirement found.**

| Source | Exact words | MUST or SHOULD |
|---|---|---|
| [AWS Service Terms](https://aws.amazon.com/service-terms/) (last updated 2026-10-22), §50.1 / §50.2 | Polly is named among the "AI Services". "The output that you generate using AI Services is Your Content." | Ownership: ours |
| Same, §50.4 | "You are responsible for providing legally adequate privacy notices to End Users" (and obtaining necessary consents). Its under-13 COPPA mechanics name **Amazon Lex**, not Polly. | **MUST**, but about *privacy notices for data*, not about labelling synthetic speech. Our Polly input is lesson text with no personal data. |
| Same, §1.23 | Use of AI/ML services is subject to the AWS Responsible AI Policy. | Binding |
| [AWS Responsible AI Policy](https://aws.amazon.com/ai/responsible-ai/policy/) (last updated 2025-01-13) | It prohibits use "for intentional disinformation or deception" and "to depict a person's voice or likeness without their consent or other appropriate rights". **It has no requirement to disclose or label AI-generated content.** | MUST NOT deceive. **No disclosure duty.** |
| [Polly pricing](https://aws.amazon.com/polly/pricing/) / FAQ | "you can cache and replay Amazon Polly's generated speech at no additional cost". Nothing on disclosure. | none |

**So with Polly, no vendor rule requires a disclosure**, as of these dates. A future terms change would be caught when the licence record in `voice-sources.ts` is reviewed.

**Not covered here:** the law where Jawwid's families live. For example, if EU users are served, the EU AI Act's transparency rules for synthetic audio. That is counsel's question, not the vendor's, and it applies to whichever vendor is chosen.

**Compliant alternatives** (Q7; never skirting a MUST), ranked:

1. **Azure, with the disclosure aimed at parents only, and nothing in the child's lesson screen.**
   - Where: one clear sentence in the parent-facing terms and privacy notice, at enrolment (the parent accepts it), and under "About lesson audio" in the parent's settings.
   - Example: "Lesson pronunciation audio is computer-generated and checked by our teachers before use".
   - Why it is compliant: it matches the Transparency Note's own pattern for minors, which is a disclosure parents or guardians can understand. It also serves requirement 3's stated aim. No child is led to think a real person is speaking, because there is no persona or named speaker, and every clip is teacher-approved.
   - Remaining risk: requirement 3 says "users", and children are users. **Recommended safeguard: ask Microsoft in writing (an Azure support or licensing question) to confirm a parent-facing disclosure satisfies requirement 3 for this use, before step 7 of the rollout.** No account is needed to ask a licensing question by e-mail; opening one is the owner's call.
2. **Amazon Polly instead of Azure: no disclosure required by AWS.**
   - Trade-offs: Zeina is an older non-neural MSA voice, and Hala and Zayd sound Gulf. The pilot's probe (§15 step 3) decides whether the quality is good enough.
   - Lexicons and `<phoneme>` exist for Arabic, so the fix loop still works.
3. **Azure, with a minimal in-app mention instead of a per-clip label.** For example, a small "ⓘ" in the lesson's audio settings, or one line on the lesson's start screen. This is compliant beyond doubt, and the least intrusive form inside the app.
4. **Teacher-recorded audio for every clip, so no synthetic voice is used.** The owner declined this for now, so it is listed last.

**What is never an option:** Azure with no disclosure anywhere.

## 3. What gets a voice in lesson 1

| String | Count (approx.) | Id | Notes |
|---|---|---|---|
| Unit name: the letter's name, e.g. بَاءْ, هَمْزَةْ | 34 | `<unit id>.name`, e.g. `ba.name` | Fully vowelled words. TTS is usually good at these. |
| Example words, e.g. أَسَدْ, كِتَابْ | ~1,580 | the word's id, e.g. `ba-001` | Pausal sukun on the last letter. The bulk of the work. |
| Unit notes (authored sentences), e.g. the alif note | a few | `<unit id>.note`, e.g. `alif.note` | Short sentences, fully vowelled. |
| Quiz | 0 new | none | A quiz option is a word of the lesson. It reuses that word's clip if its text is identical. |
| UI text ("which word contains …") | 0 | none | Not voiced in v1. |

About **1,620 strings, so ~2,000 clips with retries**.

**Isolated letter sounds and syllables (بَ بِ بُ بْ) are not in lesson 1's data.** The approved P0-5 design teaches forms, words and positions, not syllable drills. The research (§2.4) says this is TTS's weakest point. When a later lesson adds syllables, they go through this same gate. They will most likely need a phoneme or respelling fix per syllable, and some may end up with no audio. That is acceptable. A wrong clip is not.

**The letter forms (ـبـ, بـ) are never voiced.** A form is a shape, not a sound. The unit's name is the letter's sound in lesson 1.

**Audio work on a string starts only after its text is cleared.** A word still held by the content review (`review` set, or `was` not null) is not generated. Its text may still change, which would waste a review.

## 4. Stable string ids (the PD-29 contract, used as is)

Every reading string needs an id that does not change when words are reordered. **The id contract is owned by PD-29.** It is implemented in P0-5 PR-1 (#234 @ `57adc426`) and recorded in its design (#232 @ `81b147c1`). The PD-29 session confirmed it as final on 2026-10-28; the `ba-w1` / `alif-note` slugs relayed earlier are superseded. PD-48 uses it **as is and does not redefine it**:

- **A word's id** is `<unit id>-NNN` (e.g. `ba-001`), matching `^[a-z][a-z0-9_]*-[0-9]{3}$`.
  - Its prefix is its own unit's id, and it is unique in the lesson.
  - The extractor assigns it once. It is never renumbered when words are reordered or removed.
- **A removed word's id** goes into the lesson's `retiredIds` and is never used again.
- **Unit ids** are hyphen-free slugs (`ba`, `lam_alif`). A unit's name and note have derived ids: `<unit id>.name` and `<unit id>.note`.
- **The text is stored in NFC.** Both the checker and the browser resolver refuse a word or note that is not. Nobody normalizes at read or hash time.
- **Held text has no clip.** A spelling flagged anywhere is held everywhere it appears, and quiz questions that show a held word are held too. A clip is generated or approved only for text that is itself approved.
- `resolveArabicLesson` already carries `id` on `ResolvedUnit.words[]`, and a resolved note is `{ id: "<unit>.note", text }`. The name's id is not output: the engine derives it as `${unit.id}.name`. No `nameId` field is needed. So the engine can put a play button on each string.
- **لا is one unit.** A lam followed by an alif is always rendered as one piece. Word clips are unaffected; a future letter-level clip treats لا as one sound, never as ل then ا.

**The binding key for a clip is (lesson, id, SHA-256 of the exact text).** A changed text invalidates its clip.

**Safety does not depend on ids.** Every clip is also bound to the hash of its exact text (§5). If an id ever pointed at different text, the hash would differ and the string would have no audio. Stable ids only spare teachers from reviewing a word again when nothing about it changed.

## 5. The binding: what exactly a teacher approves

A clip row binds four things. All are computed by code, and none is typed by a person:

| Field | What it is | Who computes it |
|---|---|---|
| `lesson_key` + `string_id` | e.g. `arabic-001`, `ba-001` | read from the lesson file |
| `text_sha256` | SHA-256 of the string's **exact UTF-8**, the code points as stored and shown | a generated column in the database, `encode(sha256(convert_to(text, 'UTF8')), 'hex')` |
| `render_sha256` | SHA-256 of the canonical JSON **render recipe** (below) | the ingest CLI; the server recomputes it |
| `audio_sha256` | SHA-256 of the stored audio bytes | the server's ingest, **from the stored object**, never from the operator's manifest |

**"Normalized" means the exact text, with no further transformation.** Per the PD-29 contract (§4), the lesson file's string is already NFC with its marks. The hash is taken over exactly those UTF-8 bytes. PD-48 applies no normalization of its own: no NFC pass, no stripping, no folding. So what is hashed is exactly what the child sees. The P0-5 checker already limits a string to Arabic letters, the marks U+064B–U+0652 and U+0670, and (for sentences) single spaces. Two spellings that look the same but differ in code points get different hashes. That only costs a re-review; it never plays wrong audio. The recipe names the rule `exact-v1`, so any future change is explicit.

**The render recipe** is canonical JSON (keys sorted, no whitespace) and holds everything that shapes the sound:

```json
{ "v": 1, "norm": "exact-v1", "vendor": "azure", "voice": "ar-SA-HamedNeural", "locale": "ar-SA",
  "format": "audio-24khz-48kbitrate-mono-mp3", "rate": "-10%", "input": "<speak …>…</speak>",
  "lexicon": "sha256-of-the-entries-applied", "take": 1 }
```

- `input` is what was **sent**: usually the text itself wrapped in SSML. After a fix it may contain a `<phoneme>`, a `<sub alias>` or a respelling. The teacher judges the **audio against the displayed text**, not the input.
- `take` lets a non-deterministic vendor try again with otherwise identical settings.
- Any change to voice, rate, input, lexicon or take gives a new `render_sha256`, so it is a new clip that needs its own approval.

**The object key is derived, never supplied:**

```
lesson-audio/<lesson_key>/<string_id>/<audio_sha256>.mp3     e.g. lesson-audio/arabic-001/ba-001/3f9c….mp3
```

It is a generated column, with the same formula in TypeScript (as `quran/audio-key.ts` does for Quran audio). A key is content-addressed: the same bytes get the same key, and an object is never replaced in place. The API never accepts an object key from any client (§10).

## 6. The pipeline (operator-run, offline)

Four steps. Only step 2 talks to the vendor, and only step 3 writes the database.

```
lesson-001.json ──(1) plan──▶ worklist ──(2) generate──▶ clips/ + manifest ──(3) ingest──▶ storage + pending rows
                                   ▲                                                         │
                                   └──────── (5) fix: lexicon / phoneme / respell ◀──(4) review (Admin Web)
```

1. **Plan** (`scripts/lessons/tts/plan.py`, stdlib only, run with `python3 -I`). It reads the lesson file and the API's text map (§7.3). It lists every cleared string that has **no** clip that is pending or approved for its current text hash, and is not marked "no audio". It needs no network and no credentials. It reads the current clip states from an export the ingest CLI prints, so it never needs database access either.
2. **Generate** (`scripts/lessons/tts/generate.py`, stdlib `urllib` only: no vendor SDK, so nothing new enters the supply chain). For each worklist entry it builds the SSML from the text and `scripts/lessons/tts/lexicon/<vendor>.json`, calls the vendor's REST endpoint and saves `<string_id>.mp3`. It writes `manifest.json`: string id, text, recipe, and the operator's own hash of the file.
   - **The vendor key lives only in the operator's shell environment** (`JAWWID_TTS_KEY`). It is never in the repository, `.env` files, the API, CI or chat. The secret-scan guard already covers the repo.
   - It runs on the operator's machine. It is never part of the API, the worker, CI or a request.
   - The audio is stored as the vendor returns it (mono MP3). There is no post-processing in v1: no new tools such as ffmpeg (the owner's rule), and no step that changes the bytes after generation.
3. **Ingest** (`apps/api/src/cli/ingest-lesson-audio.ts`, modelled on `ingest-quran-audio.ts`). Dry run by default; `--write` uploads. For each file it:
   - checks that the string id is in the API's text map **and** that `sha256(text)` equals the map's hash. A clip for stale text is refused at ingest.
   - recomputes `render_sha256` from the recipe;
   - uploads to the derived key, then **reads the stored object back and hashes it**. That hash, not the manifest's, becomes `audio_sha256`. A mismatch with the manifest refuses the file.
   - inserts a `pending` clip row. It runs under the owner DB role, because the clip table has no insert grant for request roles.
4. **Review** in Admin Web (§9): approve, or reject with a reason.
5. **Fix.** The operator reads the rejection reasons (an export from the queue), then:
   - adds a lexicon entry, a `<phoneme>` or a respelled input for that string, in `lexicon/<vendor>.json`, in a reviewed commit;
   - or changes the take, rate or voice;
   - and goes back to step 1. Every fix changes `render_sha256`, so the result is a new clip that needs new approvals.

**When TTS cannot get a string right.** After **three rejected clips** for the same text, the queue stops offering regeneration and shows "needs a decision". A reviewer then either:
- allows one more round (written reason), or
- marks the string **no audio** (`chat.lesson_audio_string_decision`, written reason).

A "no audio" string has no play button in the lesson. Nothing replaces it: no other voice, no older clip, no browser speech. The decision is bound to the text hash. If a teacher later changes the word, the decision no longer applies and the new text can be tried. The no-audio list is a report in the queue (Q3, owner 2026-10-28: such words stay silent for lesson 1; no teacher recordings).

## 7. The approval gate (fail-closed)

It reuses three patterns that already exist:
- the lessons content gate `resolveContent` / `resolveArabicLesson`: nothing unapproved is shown, and anything malformed refuses the whole file;
- the Quran audio gate `audio-gate.ts`: an audience switch, testers, and a licence in code;
- the Tajweed review: `pending → approved | rejected`, once, append-only, by a qualified reviewer.

### 7.1 A clip's state

The state is derived from append-only review rows; nothing is ever edited.

```
pending ──approve (1 of 2)──▶ pending (1/2) ──approve by a DIFFERENT reviewer──▶ approved ──withdraw──▶ withdrawn
   │                              │                                                │
   └──────reject──────────────────┴──────reject──▶ rejected   (final)              └── stale (text hash changed: derived, not stored)
```

- **Approve** names the clip id **and echoes the hashes the reviewer's browser checked**: the text hash and the hash of the audio bytes it actually played (WebCrypto in Admin Web). The database function refuses an approval whose hashes differ from the clip's. So an approval is a record of these exact bytes for this exact text, not of "the clip for ba-001".
- **Two different reviewers** (the owner's decision, Q1). `APPROVALS_REQUIRED = 2` is a constant **in code**, not a config row, so a database write cannot lower it. The same reviewer cannot approve twice (a unique index).
- **One rejection is final** for that clip, even after an approval. The fix is a new clip.
- **Withdraw**: any reviewer can pull an approved clip, with a reason. It stops playing on the next request. A withdrawal is final; the fix is a new clip.
- **Stale** is never stored. A clip whose `text_sha256` differs from the current text map simply does not match the serving query. Change the word, and its audio is off everywhere, with no job to run.
- **Superseded**: if a string gets a second approved clip (e.g. a better voice), the newest one with full approvals is served. The older one stays in the history.

### 7.2 The audit trail per clip

`chat.lesson_audio_review` is append-only (insert only, enforced by trigger). Each row holds:
- the clip id and the action (`approve | reject | withdraw`);
- the reviewer's staff id, taken from the signed-in actor and never from the request body;
- the time (`now()`);
- `text_sha256`, `render_sha256` and `audio_sha256`, copied **and checked equal** to the clip's by the trigger;
- the reason: required for reject and withdraw. It has a category (`vowel`, `final_sukun`, `shadda`, `hamza`, `letter_sound`, `stress`, `noise`, `wrong_word`, `other`) and free text.

Each action also writes `chat.audit_log` (`lesson_audio.approved | rejected | withdrawn | no_audio`), as other PD-40-era actions do. The queue's history panel shows, per clip: who approved or rejected it, when, and which hashes.

### 7.3 Where "the current text" comes from

The API cannot read `apps/lessons` at runtime: its image context is `apps/api` only. So:
- `apps/api/src/lesson-audio/texts/arabic-001.json` is a **generated** map: `[{ id, text, sha256 }]` for every cleared string of the lesson. `scripts/lessons/lesson-audio-texts.py` writes it from `apps/lessons/src/arabic/lesson-001.json`.
- A new CI guard, `lesson-audio-texts` in `scripts/qa/guards.sh`, fails when the map is not exactly what the script would write. So a text change in the lesson cannot merge without the map changing in the same PR. Once that deploys, the old clip is stale.
- G-20 note: protected staff names can occur inside ordinary Arabic words. The generated map uses the same `\u` JSON escape as the lesson files; the decoded text is identical.

### 7.4 Serving to a learner

`GET /lesson-audio/:lessonKey` (e.g. `arabic-001`). It is `@SelfService`, like `GET /quran/ayahs`: any signed-in account, and the gate decides. It returns entries `{ id, audio: { key, url, sha256, textSha256 } }`, only for strings that:
1. are in the API's text map, and
2. have a clip whose `text_sha256` equals the map's, with two distinct approvals, no rejection and no withdrawal (the newest such clip), and
3. pass the release gate (§7.6) for **this** account.

The URL is a short-lived signed GET (`private, no-store`), signed per request after these checks. **The signing call is the access decision.** Clip ids and keys come only from the server's own query; no request field names a key or a clip. A string with no entry has no audio.

### 7.5 The lesson engine (second check)

The engine reuses the Quran audio pattern. It adds a second message type and leaves `jawwid:quran-audio` untouched:

```
postMessage({ type: 'jawwid:lesson-audio', lesson: 'arabic-001', clips: [{ id, audio: { key, url, sha256, textSha256 } }] })
```

- It is accepted only from the build-time parent origins, and only with exactly these fields. A malformed list is refused whole.
- Each entry's `id` must be a string id of this lesson, and its `key` must be exactly `lesson-audio/arabic-001/<id>/<sha256>.mp3`, on an allowed media origin.
- **`textSha256` must equal the engine's own SHA-256 of that string's text.** On a mismatch (an API and a lessons build out of step), that one clip is dropped.
- A file plays only after its bytes hash to `sha256` (`verifiedAudio`). If the hash fails, the button disappears.
- **A play button exists only for a string with a verified clip.** No button means no audio. There is never a placeholder, a greyed-out button or a fallback.
- A new check in the `lessons-supply-chain` guard fails on any `speechSynthesis` or `SpeechSynthesisUtterance` in `apps/lessons`. The browser's own voice can never become a silent fallback.

The openers (Admin Web `features/materials/lessonAudio.ts`, Flutter `activity_view_{web,mobile}`) gain the second fetch and post. They keep the same two conditions as today: the server's `audioEligible` and the build-time lessons origin.

### 7.6 The release gate

The same shape as `quran.audio`, with **separate** keys so the two can never be switched together:

```
chat.config lesson_audio.enabled_for    none | staff_test | all       (unset or anything else = none)
chat.config lesson_audio.test_staff_ids ["<staff id>", …]
```

- `none`: nobody, the owner included.
- `staff_test`: the super admin and the named testers. Reviewers always hear clips in the queue, whatever the gate; that is a different route and key (§9).
- `all`: every signed-in account, **only for clips whose vendor and voice appear in `apps/api/src/lesson-audio/voice-sources.ts` with a recorded licence confirmation** (who confirmed it, when, which terms document and version). Without that record, `all` still means testers only. No database write can open audio to children before the owner records the licence in a reviewed commit.
- Removing a voice from `voice-sources.ts` switches off every clip of that voice at the next deploy.

## 8. Permissions (PD-40)

Two new catalogue keys. They are in a new `lesson_audio` page, so they never collide with the scheduled-lessons keys `lessons.*`:

| Key | Label (en / ar) | Risk | Delegable | What it opens |
|---|---|---|---|---|
| `lesson_audio.view` | Listen to lesson voice-over clips / الاستماع إلى تسجيلات نطق الدروس | none | yes (read-only) | the review page, playback, history, the no-audio report |
| `lesson_audio.review` | Approve or reject lesson voice-over clips / اعتماد تسجيلات نطق الدروس أو رفضها | none | yes, with a verified rule | approve, reject, withdraw, mark no audio |

**Bundles** (legacy-bundles.ts):
- `manager:teachers` gets `view` and `review`. The Teachers manager owns teaching quality and must hold a key to delegate it.
- `supervisor:teachers` gets `view` only. Listening is harmless; **approving is a deliberate grant**, because "qualified" is a judgement about a person, not a job title.
- The super admin holds every key, as always.
- No other bundle gets either key.

**Template role** (PD-40 `role-templates.ts`): `pronunciation_reviewer`, "مراجع النطق", tier `specialist`, keys `lesson_audio.view` + `lesson_audio.review`. The super admin or the Teachers manager grants it to the teachers they judge qualified.

**Layer 2 (the service rule)** is `decideLessonAudioReview`, DB-free and spec-verified, so `review` can be delegable. The reviewer must:
- be an active staff member (`is_active`, `left_at is null`);
- hold `lesson_audio.review` (`chat.staff_has_permission`);
- not have approved this clip already.

The database function `chat.review_lesson_audio_clip` re-checks all three, with the staff id passed by the API from the authenticated actor.

The keys enter `chat.permission` and the template through a **LATER generated seed block**. The frozen PD-40 seed is never edited.

## 9. The review UI (Admin Web, minimal)

One page, `/lesson-audio`, in the page registry under `lesson_audio.view`.

- **Filters:** lesson (only `arabic-001` at first), unit, and state (`needs my review` (default) | pending | approved | rejected | needs a decision | no audio).
- **One row per string:**
  - the vowelled text, **large** (the lessons' Arabic font, at least 40 px), so every mark is visible;
  - the string id;
  - the clip's play button;
  - approval count `0/2 · 1/2`, the attempt number, and earlier rejection reasons.
- **Approve** is enabled only after this reviewer's browser has played the clip **to the end** and its bytes hashed to the clip's `audio_sha256`. The two hashes go with the request (§7.1). Playing to the end is a nudge, not a security control: the security control is the two-reviewer rule.
- **Reject** opens a short form: a category (§7.2) and free text, both required.
- **Bulk-play by unit:** plays the unit's clips in order. It highlights each row as it plays and pauses between clips, so the reviewer can stop and reject. **There is no bulk approve.** Every approval is one click on one clip that was heard. That is the owner's "every clip".
- **History panel per clip:** who did what, when, and which hashes.
- **Report:** the no-audio strings and the "needs a decision" strings, exportable for the operator.

Routes, each with `@Requires`, so the `pd040-routes` guard and the route table cover them:

| Route | Key |
|---|---|
| `GET /lesson-audio/review/:lessonKey?unit=&state=` returns rows with short-lived signed URLs for the clips listed | `lesson_audio.view` |
| `POST /lesson-audio/clips/:clipId/approve` `{ textSha256, audioSha256 }` | `lesson_audio.review` |
| `POST /lesson-audio/clips/:clipId/reject` `{ category, reason }` | `lesson_audio.review` |
| `POST /lesson-audio/clips/:clipId/withdraw` `{ category, reason }` | `lesson_audio.review` |
| `POST /lesson-audio/strings/:lessonKey/:stringId/decision` `{ decision: 'no_audio' \| 'one_more_round', reason }` | `lesson_audio.review` |
| `GET /lesson-audio/:lessonKey` (the learner's audio, §7.4) | `@SelfService` + the release gate |

Admin Web needs `media-src` for the storage origin, if the Materials work has not already added it. That is checked in PR-3.

## 10. Security notes

- **Never trust a client-supplied object key.** No route accepts a key, and only the derived formula produces one. The review route signs URLs only for clip ids from its own query, filtered by lesson and unit. The approve route takes a clip id from the path, and the function loads the clip's hashes itself. See the attachments rule (`apps/api/src/communication/attachments/object-key.ts`, PR #22): the signing call is the access decision.
- **The bucket stays private.** Audio is reached only through signed GETs: short TTL, `Cache-Control: private, no-store`.
- **Request roles get no write grants on the clip tables.** Clips are inserted only by the ingest CLI (owner role). Reviews are written only through the `security definer` function, which checks the permission and the hashes.
- **Vendor credentials** exist only in the operator's shell during generation. The API never calls a TTS vendor and holds no vendor key.
- **Lesson text is not personal data.** No child's data is ever sent to the vendor: the input is the lesson's own words.
- **Separation from Quran audio:** a different storage prefix (`lesson-audio/` vs `quran/audio/`), different tables, different config keys, a different engine message and a different gate module. A lesson-audio key can never be valid for a Quran message, and a Quran key can never be valid for a lesson message. Each message checks its own key formula.

## 11. Data model and migration

**One migration** (PR-2). **The slot is requested from the department head**; none is claimed. It also needs a LATER seed block from the PD-40 owner session for the two keys and the template role.

```sql
create table chat.lesson_audio_clip (
  id              uuid primary key default gen_random_uuid(),
  lesson_key      text not null check (lesson_key ~ '^[a-z]+-[0-9]{3}$'),
  string_id       text not null check (string_id ~ '^[a-z][a-z0-9_]*(-[0-9]{3}|\.(name|note))$'),   -- PD-29's ids (§4); no '/' can appear
  text            text not null check (length(text) between 1 and 400),
  text_sha256     text generated always as (encode(sha256(convert_to(text, 'UTF8')), 'hex')) stored,
  render          jsonb not null,            -- the canonical recipe (§5)
  render_sha256   text not null check (render_sha256 ~ '^[0-9a-f]{64}$'),
  vendor          text not null,             -- copied from render; checked equal by trigger
  voice           text not null,
  audio_sha256    text not null check (audio_sha256 ~ '^[0-9a-f]{64}$'),   -- hashed from the STORED object
  byte_size       integer not null check (byte_size between 1 and 5000000),
  duration_ms     integer check (duration_ms is null or duration_ms between 1 and 60000),
  object_key      text generated always as ('lesson-audio/' || lesson_key || '/' || string_id || '/' || audio_sha256 || '.mp3') stored,
  attempt         smallint not null check (attempt >= 1),
  created_at      timestamptz not null default now(),
  unique (lesson_key, string_id, text_sha256, render_sha256)  -- a regeneration must change something
);

create table chat.lesson_audio_review (          -- append-only
  id            bigint generated always as identity primary key,
  clip_id       uuid not null references chat.lesson_audio_clip (id),
  action        text not null check (action in ('approve', 'reject', 'withdraw')),
  staff_id      uuid not null references chat.staff (id),
  text_sha256   text not null,  render_sha256 text not null,  audio_sha256 text not null,   -- = the clip's (trigger)
  category      text check (category in ('vowel','final_sukun','shadda','hamza','letter_sound','stress','noise','wrong_word','other')),
  reason        text check (reason is null or length(reason) between 1 and 500),
  at            timestamptz not null default now(),
  check ((action = 'approve') = (category is null and reason is null))
);
create unique index lesson_audio_one_approval_each on chat.lesson_audio_review (clip_id, staff_id) where action = 'approve';

create table chat.lesson_audio_string_decision (  -- append-only; bound to the text it was made for
  id           bigint generated always as identity primary key,
  lesson_key   text not null,  string_id text not null,  text_sha256 text not null,
  decision     text not null check (decision in ('no_audio', 'one_more_round')),
  staff_id     uuid not null references chat.staff (id),
  reason       text not null check (length(reason) between 1 and 500),
  at           timestamptz not null default now()
);
```

- **Triggers:**
  - the clip table: insert only, and only under the ingest setting (the Quran audio pattern: the setting routes writes, and the grants are the boundary);
  - review and decision: insert only;
  - the review trigger copies-and-checks the hashes, refuses any action on a rejected or withdrawn clip, and refuses an approve by a staff member who does not hold the key.
- **Functions** (`security definer`, `search_path = chat, pg_temp`, executable by `chat_app`): `chat.review_lesson_audio_clip(p_staff, p_clip, p_action, p_text_sha256, p_audio_sha256, p_category, p_reason)` and `chat.decide_lesson_audio_string(…)`.
- **Grants:** no request-role access to the three tables. Reads for the review page go through a `security definer` read function or the API's owner-role store, as the Quran store does. Decided in PR-2, following whichever pattern `prisma-quran.store.ts` uses.
- **No change to `chat.quran_*`.**

## 12. Out of scope

- **Quran recitation, in every form.** Quran audio is licensed human recitation under its own legal process (`quran.audio`, `chat.quran_ayah_audio`). **It is never TTS.** The generation script voices only `arabic-NNN` letters lessons and refuses any other lesson key. Only those lessons have a text map in the API, so lesson voice-over cannot reach Quran text.
- The `islamic/` lessons and Arabic lessons 2–10. Each follows as its own item, on the same pipeline.
- Syllable drills (بَ بِ بُ بْ): not in lesson 1 (§3).
- Voicing UI text and quiz questions.
- Runtime or on-device TTS, in any form.
- Teacher-recorded clips for "no audio" strings (Q3: declined for lesson 1).

## 13. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| TTS drops or changes a final sukun, shadda or hamza | wrong sound taught to a child | two-reviewer approval of the exact bytes; one rejection is final; no clip without approval |
| Reviewer fatigue over ~2,000 clips | an error approved | two independent reviewers; sessions of one unit at a time; play-to-end before approve; no bulk approve; withdraw anytime |
| Isolated letters and syllables mispronounced | none in lesson 1 (§3) | later lessons: phoneme/respelling fixes, else no audio |
| A text change leaves old audio playing | wrong word heard | the text hash is checked at three points (ingest, server map, engine); no state to forget |
| Vendor changes a voice or model | regenerated clips sound different | stored bytes are what was approved; a regeneration is a new clip; the recipe records the voice and model |
| Vendor terms forbid storing or redistributing audio, or change later | legal exposure | licence recorded in code before `all`, after the owner reads the terms; a voice removed from `voice-sources.ts` switches off all its clips (§7.6, §2.5) |
| A vendor's auto-diacritizer "corrects" a mark we supplied | a wrong vowel that sounds natural | undocumented for Azure (§2.2), so reviewers listen against the displayed text, never the input; the fix is a `<phoneme>` |
| A client-supplied key reads another object | data leak | no route takes a key; the derived formula; signing after the server's own query |
| Quran audio confused with lesson audio | TTS Quran | separate prefix, tables, gate and message; the typed-Quran refusal (§12) |
| "No audio" strings feel broken to a child | UX gap | no button at all (not a disabled one); the report lists them (Q3: they stay silent) |
| A big lesson change invalidates many clips | review backlog | ids are stable; only changed strings go stale |

## 14. Cost

- **Vendor:** about 1,620 strings × ~8 characters is ~13,000 characters. With SSML markup counted (if the vendor bills it) and three tries, it is under ~100,000 characters per lesson. That is **cents to a few dollars per lesson** at published neural prices (§2.6), and likely within a free tier.
- **Storage:** ~2,000 clips × ~15 KB is ~30 MB per lesson, with rejected clips kept for the audit trail. Negligible.
- **The real cost is teacher time.** ~1,620 strings × 2 reviewers × ~6 s (listen, maybe replay, click) is **~5–6 hours of reviewer time per lesson**, plus rejected rounds. The design keeps it at one click per heard clip, and no faster than that.

## 15. Rollout and PR breakdown

| PR | Contents | Needs |
|---|---|---|
| **PR-0** (this) | design, PD-48 claim | head's approval; owner's answers (§17) |
| **PR-1** lessons + data | `lesson-audio-texts.py` and the generated map; the `lesson-audio-texts` guard; the `speechSynthesis` ban; the engine's `jawwid:lesson-audio` message and play buttons (no audio yet: nothing serves it) | P0-5 PR-1 merged |
| **PR-2** API | migration (slot from the head); tables, triggers, functions; catalogue keys and template (LATER block, with the PD-40 session); `voice-sources.ts` (empty: no licence yet); gate; review + learner routes; ingest CLI | slot; PD-40 seed block |
| **PR-3** Admin Web | `/lesson-audio` review page; openers post `jawwid:lesson-audio` (Admin Web + Flutter) | PR-2 |
| **PR-4** generation scripts | `plan.py`, `generate.py`, the lexicon format, the operator runbook | vendor chosen (Q2) |

**Rollout** (each step is a separate go):
1. Merge PR-1…PR-4. `lesson_audio.enabled_for` stays unset, so nobody hears anything.
2. The owner opens a vendor account and gives the operator a key. **This session never does that.**
3. **Probe, then pilot on systest.**
   - First the ~60-item vendor probe (§2.6), through the primary and the fallback, scored by a teacher. It picks the vendor and voice.
   - Then the operator generates the 34 unit names and one unit's words. Reviewers approve or reject them. Set `staff_test` and listen in the real lesson.
4. Measure the rejection rate by category. Tune the lexicon and voice.
5. Generate the rest of lesson 1. Two reviewers finish it.
6. The owner records the licence confirmation in `voice-sources.ts` (a reviewed commit). It records Microsoft's written confirmation for R-48a (§17 Q7). The parent notice must also be live, in the owner-approved wording: in the parent terms and privacy notice, at enrolment, and under Settings → About lesson audio.
7. Set `all` on production. Families hear only approved clips.

## 16. Tests

- **Database** (on a private integration DB, per the Jawwid rule):
  - `text_sha256` and `object_key` are generated (tampering refused);
  - inserts are refused outside the ingest setting;
  - review and decision tables are append-only;
  - an approve with wrong hashes is refused;
  - an approve without the key is refused;
  - the same reviewer cannot approve twice;
  - any action on a rejected or withdrawn clip is refused;
  - request roles have no grants.
- **Serving** (spec):
  - a clip with 1 approval is not served; 2 distinct approvals are served;
  - reject after approve means not served; withdraw means not served;
  - a text-map change means not served (stale);
  - a voice missing from `voice-sources.ts` is not served under `all`;
  - the gate: `none` nobody, `staff_test` testers only, `all` without a licence still testers only; unreadable config is `none`;
  - URLs are signed only after the checks, and no request field reaches the signer.
- **Ingest:**
  - a stale text is refused;
  - a manifest hash ≠ the stored-object hash is refused;
  - `render_sha256` is recomputed;
  - dry run writes nothing;
  - the same (text, recipe) twice is refused.
- **PD-40:**
  - the route table regenerated; the `pd040-routes` guard green;
  - the legacy-bundle spec: `review` held only by `manager:teachers` and the super admin; `view` also by `supervisor:teachers`;
  - the template seeded;
  - `decideLessonAudioReview` verified both ways.
- **Engine** (vitest, `--maxWorkers=2 --minWorkers=1`):
  - the message shape is exact;
  - a wrong origin, a wrong key formula or an extra field refuses the list;
  - a `textSha256` mismatch drops that clip;
  - a bytes-hash failure removes the button;
  - no clip means no button;
  - a `jawwid:quran-audio` key is refused as a lesson clip, and the reverse.
- **Guards:**
  - `lesson-audio-texts` fails on a stale map;
  - `lessons-supply-chain` fails on `speechSynthesis`;
  - `secret-scan` covers `scripts/lessons/tts/`.
- **Admin Web:**
  - approve is disabled until played to the end and the hash matches;
  - reject requires a category and a reason;
  - there is no bulk-approve control;
  - bulk-play goes in order.

## 17. The owner's answers (2026-10-28) and the one open question

The department head relayed the answers, from the owner's replies to these questions on 2026-10-28.

1. **Reviewers per clip: TWO different teachers** (re-confirmed by the owner on 2026-10-29). The owner's first click said "One teacher". Their written answer then said "Keep the other defaults: two teacher approvals for every audio clip". The head applied the explicit, stricter answer and told the owner they can correct it. `APPROVALS_REQUIRED = 2` (§7.1).
2. **Vendor: Microsoft Azure, with Amazon Polly as the fallback.** No account is created yet. Before the licence is recorded in `voice-sources.ts`, the owner or counsel reads the Azure Product Terms clause on generated output (§2.5, §2.8).
3. **Words the computer voice cannot get right: "No audio for that word".** Silent, with no play button and no teacher recordings, for lesson 1 (§6).
4. **Approvers:** teachers granted "Pronunciation reviewer", plus the Teachers Manager (§8).
5. **Voice:** one adult MSA voice for the whole lesson (§2.1).
6. **Speed:** about 10% slower than normal, one rate for the lesson, recorded in the recipe (§5).
7. **Disclosure that the voice is computer-generated: DECIDED 2026-10-29, "Azure, parent-only notice".** The owner's words, verbatim:

   > We do not want to display a disclosure to users stating that the voice is computer-generated. Please verify Microsoft Azure's exact requirements and whether this disclosure is mandatory for our intended use in Jawwid Academy. Do not bypass or violate the provider's terms. If disclosure is mandatory, present compliant alternatives before proceeding.

   **Finding (§2.8):**
   - For Azure, disclosure is **mandatory**, prebuilt voices included. The Code of Conduct, Responsible AI requirement 3, says so, and the Transparency Note says "Microsoft requires its customers to disclose the synthetic nature of text to speech voices to its users". The form is not prescribed. For children's use cases, Microsoft's guidance aims the disclosure at parents and guardians.
   - For Amazon Polly, **no disclosure requirement** was found in the AWS Service Terms §50 or the AWS Responsible AI Policy.

   **Compliant alternatives, ranked** (details in §2.8):
   1. Azure, with a parent-facing disclosure only: terms, privacy notice, enrolment and parent settings, with nothing in the child's lesson. Microsoft is asked in writing to confirm this is enough.
   2. Amazon Polly as the primary vendor, with no disclosure required. The cost is voice quality, which the pilot probe measures.
   3. Azure, with one minimal in-app mention (an info icon or the lesson's start screen).
   4. Teacher-recorded audio (declined for now).

   **The owner's decision (2026-10-29): option 1, "Azure, parent-only notice".**
   - **Nothing on the child's lesson screen.**
   - One sentence for parents, in three places: the parent terms and privacy notice, at enrolment (the parent accepts it), and under parent **Settings → About lesson audio**.
   - **Release gate R-48a (written confirmation).** Before `lesson_audio.enabled_for` is set to `all` on production, Microsoft must confirm **in writing** that a parent-facing notice satisfies Code of Conduct Responsible AI requirement 3 for this use. The confirmation is recorded with the licence in `voice-sources.ts` (§7.6). **If Microsoft will not confirm, the vendor switches to Amazon Polly** (§2.8 option 2). The Azure clips are then switched off by removing the voice from `voice-sources.ts`, then regenerated with Polly and reviewed again.
   - **Owner to approve: the notice wording** (Arabic and English) before it is published. The proposed English is: "Lesson pronunciation audio is computer-generated and checked by our teachers before use." Its Arabic, wording for the owner to approve: «صوت نطق الدروس مولَّد حاسوبيًا، ويراجعه معلمونا قبل استخدامه.» Both are drafts until the owner approves them.
   - The parent-notice surfaces are a separate small item (parent terms, enrolment, settings), tracked in the rollout (§15 step 6). Without them, R-48a is not met.

   **Owner approval of the wording (2026-10-29, relayed by the department head).**
   - The three texts are approved **as written**, English and Arabic, exactly as quoted below.
   - Provider name: not named. The texts say "our speech provider", so they stay true under the Polly fallback (R-48a).
   - The data sentence (only lesson text is sent to the provider) is kept.
   - Families already enrolled see the notice **once, at their next sign-in**, as an acknowledge-once notice stored per parent. There is no re-enrolment.
   - Built in a separate PR. R-48a still gates `all`.

   **1. The parent terms and privacy notice (one paragraph)**

   English:

   > **Lesson pronunciation audio.** Some lessons play the pronunciation of letters, words and sentences. This audio is generated by a computer voice. Before any child hears a recording, two of our teachers listen to it and approve it. A word the computer voice cannot say correctly has no audio. The Quran is never read by a computer voice. The text of our lessons is sent to our speech provider to produce the audio. No information about you or your child is sent.

   Arabic:

   > **صوت النطق في الدروس.** تُشغِّل بعض الدروس نطق الحروف والكلمات والجمل، وهذا الصوت مولَّد بصوت حاسوبي. وقبل أن يسمع أيُّ طفل تسجيلًا، يستمع إليه اثنان من معلمينا ويعتمدانه. والكلمة التي لا يُحسن الصوت الحاسوبي نطقها لا يكون لها صوت. ولا يُقرأ القرآن الكريم بصوت حاسوبي أبدًا. ويُرسَل نصُّ دروسنا إلى مزوّد خدمة النطق لإنتاج الصوت، ولا تُرسَل أيُّ معلومات عنك أو عن طفلك.

   **2. At enrolment: one line the parent accepts**

   English:

   > I understand that lesson pronunciation audio is computer-generated and checked by the academy's teachers before use.

   Arabic:

   > أُدرك أن صوت النطق في الدروس مولَّد حاسوبيًا، وأن معلمي الأكاديمية يراجعونه قبل استخدامه.

   **3. Parent Settings → About lesson audio**

   English:

   > **About lesson audio**
   > Pronunciation in the lessons is spoken by a computer voice. Every recording is checked and approved by two of our teachers before your child hears it. If the computer voice cannot say a word correctly, that word has no audio. Quran recitation is never computer-generated.

   Arabic:

   > **عن صوت الدروس**
   > النطق في الدروس بصوت حاسوبي، وكلُّ تسجيل يراجعه ويعتمده اثنان من معلمينا قبل أن يسمعه طفلك. وإذا لم يُحسن الصوت الحاسوبي نطق كلمة، فلا يكون لها صوت. ولا تُتلى آيات القرآن الكريم بصوت حاسوبي أبدًا.


## 18. The code PR as built (2026-10-29)

The department head said go on 2026-10-29. One draft PR carries what §15 split into PR-1 to PR-4. It is on migration slot `20261029230000`. No vendor account, key or API call was made.

**Database** (`mig/20261029230000_chat_pd048_lesson_audio.sql`):
- The three append-only tables of §11.
- `chat.lesson_audio_clip_state`: a clip's state is derived from its reviews, never stored.
- `chat.review_lesson_audio_clip` and `chat.decide_lesson_audio_string`, which take the authenticated actor through `chat.trusted_staff_actor`.
- `chat.lesson_audio_approvals_required() = 2` and `chat.lesson_audio_tries_per_round() = 3`. A unit spec holds them equal to the API's constants.
- A reject or withdraw needs both a category and a reason. The same reviewer approving twice is refused in words, with the unique index as the backstop.
- Request roles have no grants.
- The rate-limit row `abuse.throttle.lesson_audio_read_actor`. The release gate is deliberately not inserted: unset means none.

**PD-40:**
- `lesson_audio.view` and `lesson_audio.review`, both delegable and verified by `legacyLessonAudioKeys` in the legacy-bundles spec. They are added through the `pd048` LATER block.
- The `pronunciation_reviewer` template. `chat.seed_access_role_templates` is redefined (20261029220000's function with the list grown by one) and run for every organization that exists.

**API** (`apps/api/src/lesson-audio/`):
- Modules:
  - `lesson-audio-key.ts`: the derived key.
  - `recipe.ts`: the canonical recipe and its hash. Python's `tts.py` computes the same hash, pinned by a shared constant.
  - `lesson-texts.ts`: loads the generated `texts/arabic-001.json` and fails closed if any entry does not hash to its text.
  - `voice-sources.ts`: four voices (Azure Hamed/Zariyah, Polly Zeina/Hala), none licensed. `familyLicence` also requires R-48a's vendor confirmation for Azure.
  - `lesson-audio-gate.ts`: the release gate, separate from Quran audio's.
  - The store, the service and the controller.
- Routes (all in the PD-40 route table):
  - `GET /lesson-audio/access`;
  - `GET /lesson-audio/review/:lesson`;
  - `GET /lesson-audio/review/:lesson/units/:unit`;
  - `POST /lesson-audio/clips/:id/approve|reject|withdraw`;
  - `POST /lesson-audio/strings/:lesson/:id/decision`;
  - `GET /lesson-audio/:lesson` (self-service, rate limited).

**Ingest:** `apps/api/src/cli/ingest-lesson-audio.ts`.
- Dry run by default.
- `--write` uploads to a temporary key, hashes what storage holds, copies it to the content-addressed key, hashes again, and inserts through `chat.ingesting_lesson_audio`.
- `--export` prints states and hashes for the plan.

**Text map and guard:**
- `scripts/lessons/lesson-audio-texts.py` writes the API's text map from the lesson file. It includes only approved strings: words whose spelling is held nowhere, notes not held, and every unit name. Arabic is written as `\u` escapes.
- The `lessons-supply-chain` gate runs it. It fails while the map is stale and on any `speechSynthesis` in `apps/lessons`. It also runs the `tts.py` selftest.

**Operator script:** `scripts/lessons/tts/tts.py`, standard library only.
- `plan` needs no network or key.
- `generate` is the only vendor call: Azure REST, or Polly signed with SigV4. Its key is read from the operator's shell at run time and never written.
- The runbook is `scripts/lessons/tts/README.md`. The lexicons, `lexicon/azure.json` and `lexicon/polly.json`, start empty.

**Engine** (`apps/lessons/src/arabic/voice.ts`):
- The `jawwid:lesson-audio` message, checked as §7.5 says.
- `verifiedAudioFor` is factored out of the Quran player, with its behaviour unchanged.
- The letters section shows a play button only for a string with a verified clip.

**Admin Web:**
- `/lesson-audio` (§9).
- The materials opener posts `jawwid:lesson-audio` to a lessons-site letters page.
- A Pronunciation reviewer specialist lands on the page.

**Verified:**
- API unit tests: 1,911 pass, plus 26 for PD-48.
- Integration tests on a private database with a private Redis: PD-48 7/7, plus the PD-40 access-roles and staff-accounts specs. The latter now counts templates from `role-templates.ts`.
- Lessons: 174 vitest tests and the typecheck pass.
- Admin Web: 848 vitest tests and the typecheck pass.
- Guards: `pd-registry`, `g20`, `secret-scan` and `lessons-supply-chain` pass.

**Not in this PR (follow-ups):**
- The Flutter openers (`activity_view_{web,mobile}`) posting `jawwid:lesson-audio`.
- The parent notice surfaces of Q7: the parent terms and privacy notice, the enrolment line, and Settings → About lesson audio. Its wording waits for the owner.
- Generating any clip. That needs an account the owner opens, the pilot probe (§15 step 3), and R-48a before `all`.

### 18.1 The department head's review of #254 (2026-10-29), fixed

- **P1, "no audio" is final.** The approve guard refuses a clip whose text has "no audio". `decide no_audio` is refused while a clip of that text is pending or approved (withdraw it first). The learner list skips a "no audio" string whatever clip exists, and the review page ranks "no audio" first. An integration test plays the reviewer's exact scenario.
- **P2, the round of three tries.** `guard_lesson_audio_clip` refuses a clip of a text whose failures reached the round, until a reviewer decides "one more round". Ingest, review and decision all take one lock per (organization, lesson, string), `chat.lock_lesson_audio_string`.
- **P2, never Quran.** The lesson key is `^arabic-[0-9]{3}$` in SQL (`chat.is_lesson_audio_key`), in the API and in `tts.py`. `lesson-audio-texts.py` and `tts.py plan` refuse any string carrying Quran text. They use a whole-Quran index of every 4-word run, and every whole shorter ayah, of the pinned dataset. After the re-review, both sides are folded to one rasm skeleton, `rasm()` in `scripts/lessons/rasm.py` (PR #260), shared with PD-29's typed-Quran refusal and loaded by path. It removes marks and tatweel, every alef and hamza form, and the Uthmani waw-for-alef, and maps ى to ي and ة to ه. Until #260 is on main, a byte-identical copy is used; the selftest proves the two equal on every verse, and a follow-up PR drops the copy. Fixtures, against the real dataset: the standard Basmala, Al-Ikhlas 1, a two-word ayah inside a note, and the opening of 2:43 (al-salah, al-zakah).
- **P2, one voice.** `apps/api/src/lesson-audio/lesson-voices.json` pins the ONE voice per lesson. While it is null (before the pilot picks), no learner hears the lesson. Once it is set, other voices are neither served nor ingested nor planned. The recipe's rate must be 0.85 to 1.0 of normal.
- **P2, the organization.**
  - Clips and decisions carry `organization_id`.
  - A reviewer reviews only clips of their own organization, and decides only for it.
  - A learner is served only their organization's clips.
  - The ingest CLI takes `--organization`.
- **Nits:**
  - no preselected reject category;
  - the review page hashes the text it shows and refuses to approve when that hash is not the clip's;
  - the "listen to the end first" hint is visible text the buttons point to with `aria-describedby`;
  - vendor regions must match `^[a-z0-9-]{1,32}$`;
  - an empty voice list clears a stale one, and the opener posts it;
  - the browser-speech ban covers every file of `apps/lessons` and any spelling of "synthesis";
  - re-seeding templates audits a skipped role once only.
