# Kids v2: learning materials rebuilt for children from age 3 (design)

**State:** DESIGN ONLY, for the department head and the owner to approve. No lesson content and no engine code is written until they do.
**Date:** 2026-10-30. **Base:** `main` @ `ea8939dc`.
**Why:** on 2026-10-30 the owner rejected the current learning materials as badly formatted, disorganised and worse than the old version. Their instruction: rebuild everything from scratch, specifically for children, with simple, enjoyable games from age 3, visually appealing, well organised and age-appropriate. Do not reuse or follow the old materials' structure. Use AyaKids (https://ayakids.com/ar) as inspiration for the experience and quality.
**The clickable mock:** `docs/owner/kids-v2-mock/index.html`. It is git-excluded: one self-contained file, phone-sized, Arabic RTL, works offline. How to open it and what it shows: §7.
**Builds on, without copying:**
- PD-49: the children's Quran plan, its respect rules (§C.4), its age bands and its 3–5 pre-reader flow;
- PD-51: Arabic and English later (§4.9);
- PD-48: the voice-over pipeline;
- the `apps/lessons` engine on `main`: what stays underneath (§8).

---

## 0. Summary

1. **One app for the child, three worlds.** The child picks their profile and lands on a home with three big picture doors:
   - **روضة القرآن** (the Quran garden): listen, recite and memorise;
   - **قرية الحروف** (the letter village): from letters to reading;
   - **واحة الحكايات** (the story oasis): the Prophets' stories, the Prophet ﷺ, manners, belief and worship.

   Each world is a winding **map** of units and lessons. A lesson is 3 to 6 short activities, then a **reward moment** (stars and a sticker). Grown-ups have their own corner behind a reading gate.
2. **The age band changes everything the child sees**, not only the difficulty:
   - **3–5** (pre-readers): no text to read, spoken instructions, 64pt+ targets, two choices, no timers, nothing ever "wrong";
   - **6–8** (early readers): short vowelled text plus voice, three choices;
   - **9–12** (readers): text first, recall, review lists, an optional challenge.
3. **Twelve game mechanics** (§5), each with exactly one right answer and each signed once by a teacher and the scholar. The Quran respect rules are built into the mechanics themselves, not added later.
4. **Better than AyaKids where it matters to Jawwid:**
   - a verified Quran text;
   - teacher and scholar review that the parent can see;
   - a real path for 3-year-olds;
   - an Islamic Studies world AyaKids does not have;
   - the parent ↔ teacher link that Jawwid already has, so the teacher's note sits next to what the child played.
5. **Everything that keeps the content safe stays, invisible to the child** (§8). The old lesson structure and every piece of extracted content is thrown away.
6. **The owner decides** the illustration style: a companion animal with a face, or a faceless lantern and silhouettes. The mock shows both, on every screen, with one switch (§4.4). There are twelve other questions, each with a recommendation (§10).

---

## 1. Study: what makes AyaKids work

Read on 2026-10-30 in the built-in browser at phone size (375 px), public pages only:
- `/ar`, `/ar/arabic-learning` and its letters, vocabulary, reading, curriculum and games pages;
- `/ar/games`, `/ar/athkar`.

Nothing was downloaded or run, and no account was created. Clicking any letter or lesson leads to a login wall (`/ar/login`), so nothing inside a game was seen. The first pass (2026-10-28, PD-49 §C.1) is in the department head's notes, `pd49-ayakids-review.md`. This section adds the Arabic-learning side and the experience overall. **Inspiration only: no asset, character, name or text of theirs is used anywhere in this design.**

### 1.1 Structure
- **Tracks, not worlds.** The tracks are Arabic, Quran memorisation, Tajweed (23 stations), "Tafsir for children" (Juz' Amma), Athkar, and "fun" games (XO, balloons, spot the difference). Each track is a vertical list of cards.
- **Arabic** is the deepest track:
  - 28 letters, "5 sections per letter";
  - harakat tabs: fatha, kasra, damma, positions;
  - vocabulary in 10 categories, about 125 words;
  - a "reading curriculum" of 14 sections, 77 levels and 1,992 interactive lessons, which says it follows the Noor al-Bayan method (fatha → kasra → damma → review → madd → sukun → tanween → shadda → connected reading);
  - finger-writing;
  - printable worksheets;
  - games grouped by single letter (four games per letter), several letters (for look-alikes such as ب ت ث), word building, word reading and general games.
- **Quran:** 24 memorisation games, each its own page, plus a juz' map from juz' 30 down to juz' 1.
- **Levels** live inside games (beginner, intermediate, hafiz), mostly as timer lengths.

### 1.2 Visual language
- A purple-violet gradient header with a wave edge.
- White rounded cards with soft shadows.
- **Emoji as the icon set** (🔤 📝 🍎 🐾 🏆). There are almost no bespoke illustrations on public pages; the athkar cards use a large emoji on a pastel panel.
- **Typography:** Noto Sans Arabic everywhere, bold and large, with big single letters on white tiles (the strongest visual on the site). Vocabulary titles are fully vowelled.
- **Motion and sound:** not visible on public pages. The athkar are voiced by a child.
- A floating WhatsApp button and social links on every page, including next to child content.

### 1.3 Game types (from the public descriptions)
- **Letters:** word sorting, "positions train" (initial, medial, final), "haraka catcher", word basket, complete the missing letter, choose the word, match the letter, first letter, letter families, finger tracing.
- **Reading:** "read the words aloud while you build a burger".
- **Quran:** recall and order games (next ayah, ladder, progressive erase, first letters, chain, train, matching, sorting, wheel, flip cards), several of them timed.

### 1.4 Age bands
- The FAQ says **4 to 12**. "Simple games for the youngest (letters), advanced content for the older ones (Quran memorisation and Arabic)".
- There are no visible bands in the interface: the same pages serve every age, and the adult chooses.

### 1.5 Rewards and progress
- Stars, badges, "virtual gifts" and printable certificates.
- Progress reports "for teachers and parents".
- Stars need a login.

### 1.6 The parent's role
- The product is built **for the teacher**: unlimited children per teacher account, a classroom whiteboard, worksheets, "open in class".
- The parent mostly signs up and watches reports.
- Child logins are a username and password issued by the teacher.

### 1.7 What makes it work (to match)
1. **Breadth and consistency.** Every track looks the same, so the product feels big and finished.
2. **Big single letters** and fully vowelled words: instantly readable at arm's length.
3. **Many short mechanics over the same data:** variety without writing new content for each game.
4. **A known pedagogy** (Noor al-Bayan) gives the reading track a credible order.
5. **Tactile tasks** (tracing, sorting) next to recall.

### 1.8 Where Jawwid does better (this design)

| AyaKids | Jawwid Kids v2 |
|---|---|
| A website of card lists; the child navigates like an adult | **Worlds and maps**: a child finds their place by picture, colour and companion, not by reading |
| Floor of 4; the youngest games still assume reading | **A real 3–5 path**: spoken instructions, two big choices, a grown-up mode, no reading needed |
| Timers in many games | **No timers and no failure for 3–5**; for 9–12, timers are opt-in "challenge" only |
| No source or reviewer named for the Quran text or the children's tafsir | **The verified Tanzil text**, hash-checked before display, in the Mushaf font only. Every story and every Quran game is reviewed by the Teachers department and a scholar, and **the parent can see that it was** |
| Quran, Arabic and athkar only | **An Islamic Studies world**: the Prophets, the Prophet ﷺ, manners, belief and worship, written from cited sources |
| The parent watches a report | **The teacher's note sits next to what the child played**, with a button that opens the existing chat with that teacher. "Memorised" is the teacher's mark, never the game's |
| Emoji icons, a generic look | **Our own illustration system**, one consistent style, with the faces question answered by the owner |
| WhatsApp and social links next to child content; Google Tag Manager on the public pages | **No external links, no ads, no third-party trackers** in the child area; no voice recording |
| Words and verses as game objects in places (burger building, catching, a train) | **Quran respect rules built into the mechanics** (§5.1): ayat are only tapped, heard and placed whole, never caught, eaten, popped or stepped on |

---

## 2. The experience architecture

```
Who is playing? (profiles; each child has an age → band)
   └─ Home: three world doors · companion · sticker book · grown-ups' corner (gate)
        └─ World map: units (4–8 lessons + a review) on a winding path
             └─ Lesson: 3–6 activities, progress beads, the companion's spoken prompts
                  └─ Reward moment: stars + a sticker → back to the map (the next stop pulses)
```

- **The path suggests and never locks.** There are no padlocks for children. The next stop pulses and the companion sits beside it. A grown-up or the teacher can open any stop.
- **One task per screen.** Each screen has one large target area, the companion's prompt at the bottom, and "home" at the top start corner (right, in RTL).
- **World meta-progress** (shown in the mock):
  - in the Quran garden, each surah is a seed that sprouts while it is practised and becomes a fruit tree when the teacher marks it;
  - the lesson background grows the same plant as the child works.
  The other worlds use their own metaphor: a house in the letter village lights up per letter; a palm tree grows in the oasis per story.
- **The same skeleton for every band.** The band changes the content of each layer, not the navigation, so a family with a 4-year-old and a 9-year-old learns one app.

---

## 3. Curriculum map

### 3.1 Size targets

| | 3–5 (pre-readers) | 6–8 (early readers) | 9–12 (readers) |
|---|---|---|---|
| Minutes per lesson | **5–7** | **10–12** | **15–20** |
| Activities per lesson | **3–4** (plus a reward) | **4–5** | **5–6** |
| Rounds per game | 2–3 | 4–5 | 6–8 (up to 10 for long surahs) |
| Choices per question | 2 (3 for letters) | 3 | 4 |
| Lessons per unit | 4–6, then a review | 5–8, then a review | 6–10, then a review and an assessment |
| Default daily limit (parent can change) | 15 min | 20 min | 30 min |
| Text the child must read | none | short vowelled lines, always voiced | normal, vowelled where new |

### 3.2 Quran: روضة القرآن (listen, recite, memorise short surahs)
The order follows PD-49 §B.2 and the pilot surahs (1, 112, 105, 111). Lessons are generated from the verified text, so a surah needs no authored content to be played. Meanings, lessons and stories unlock surah by surah after review.

| Band | Units → lessons | Activities in a lesson | Progression |
|---|---|---|---|
| **3–5** | **U1 أوّل السور:** Al-Fatihah (3 lessons of 2–3 ayat), An-Nas, Al-Falaq, Al-Ikhlas (2 lessons). **U2:** Al-Masad, An-Nasr, Al-Kawthar, Al-Asr. **U3:** Al-Kafirun, Al-Ma'un, Quraysh, Al-Fil. One lesson = **1–3 ayat**. | Listen & Glow → Echo → Which Did You Hear (2 rounds) → reward. | Same mechanics, a longer segment, then the whole surah. Review lesson = Which Did You Hear across the unit. "Memorised" = the teacher's mark only. |
| **6–8** | All L1 surahs, then L2 (93–104), grouped 3–4 surahs per unit. One lesson = a segment of up to 5 ayat. | Listen → Echo → Light the Lanterns (order) → What Comes Next → approved word meanings or "what it teaches us" (only once reviewed). | 3 options → closer distractors; whole ayat → half ayat at verified word boundaries (level 3). |
| **9–12** | Juz' Amma L3 surahs (78–92) in 5–10-ayah segments, then Juz' Tabarak by the family's or teacher's choice. | Recall with first letters → What Comes Next (4 options, adjacent ayat) → Light the Lanterns (whole surah) → comprehension from approved tafsir → today's spaced review. | Cues fade: text → first letters → none. Spaced review 1 → 3 → 7 → 14 → 30 days (PD-49 §B.4). |

### 3.3 Arabic: قرية الحروف (letters to reading)
This is a fresh syllabus. It does not follow the old lessons.

| Band | Units → lessons | Activities in a lesson | Progression |
|---|---|---|---|
| **3–5** | **7 units built from the 16 shape groups:** U1 ا · ب ت ث; U2 ن ي ى · ج ح خ; U3 د ذ · ر ز · و; U4 س ش · ص ض; U5 ط ظ · ع غ; U6 ف ق · ك ل لا; U7 م · ه ة · ء and its seats (أ إ ؤ ئ). ن ي follow ب ت ث because بـ تـ ثـ نـ يـ share one tooth at the start and in the middle of a word. ى goes with ن ي (it is ي's shape without the dots), and لا goes with ك ل (it is a lam form). **One letter per lesson**, and every unit ends with a "look-alikes" review. | Meet the Letter → Letter Hunt (3 rounds) → First Sound (2 rounds, only once its approved clip exists) → Trace & Dot → reward. | Letter Hunt distractors start far in shape and end in the same group (ب among ت ث). Tracing: isolated form only. |
| **6–8** | **U0, the sound contrasts:** review lessons for س/ص, ت/ط, د/ض, ذ/ز/ظ, ه/ح, ك/ق, ء/ع, ث/س and خ/غ, built on minimal pairs (سَيْف / صَيْف). They need audio, so they wait for teacher-recorded clips (§10 Q2). They are placed where both letters are known. **U1–U3:** fatha, kasra, damma (syllables). **U4:** letter positions (initial, medial, final). **U5:** sukun. **U6:** madd (ا و ي). **U7:** tanween. **U8:** shadda. **U9:** al-shamsiyyah and al-qamariyyah. **U10:** reading words, then two-word phrases, then short sentences. | Sound Mixer → Letter Hunt in words → Pairs (picture ↔ word) → read and pick the picture → Trace a word. | Syllable → word → phrase → sentence. Every word is a common Arabic word, picture-checked by teachers, never a Quran word. |
| ↳ rules for every band | **Non-joining letters** (ا د ذ ر ز و, and أ إ ؤ ء) always come with a "the word breaks here" cue. **The dot facts** (how many dots, above or below) are a code table in the engine, not authored content. | | |
| **9–12** | Fluent reading with short illustrated stories and comprehension; vocabulary themes; the simple grammar of the nominal and verbal sentence, masculine and feminine, singular, dual and plural; spelling; writing a sentence. | Read the story → What Comes Next in the story → Sound Mixer (spelling into slots) → Pairs (word ↔ meaning) → a comprehension question. | From a 3-sentence story to a page; dictation from single words to sentences. |

### 3.4 Islamic Studies: واحة الحكايات (the Prophets, the Prophet ﷺ, manners, belief and worship)
Every line is our own wording, written from a cited source (Quran first, then authentic seerah and accepted references), and is shown only after the Teachers department and the scholar approve it.
- **Hadith:** no hadith text until IslamHouse grants permission (PD-29 hadith decision). Units that need it are marked HELD.
- **No madhhab names.** Where practice differs, the lesson teaches the agreed core and says "your teacher will show you".

| Band | Units → lessons | Activities | Notes |
|---|---|---|---|
| **3–5** | **الله خلق كلّ شيء** (things Allah made: sky, sea, animals, fruit). **آدابي** (salam, thank you, sharing, gentleness with animals, cleanliness). **يومي** (saying بسم الله and الحمد لله; the phrases only, no hadith text). **نحبّ النبيّ ﷺ** (his name; his kindness, from reviewed sources). **بيت الله** (the mosque). | A 2–3-page picture story with a narrator → Kind Choice (pictures) → Pairs (3 pairs) → reward. | No people are drawn. Scenes and objects show the manner, e.g. two cups and a table for sharing. |
| **6–8** | **قصص الأنبياء ١:** Adam, Nuh, Ibrahim, Yunus (from the Quran). **قصص الأنبياء ٢:** Yusuf, Musa, Isa. **السيرة ١:** birth, the trustworthy one, the first revelation, the hijrah (authentic seerah only). **أركان:** the five pillars of Islam and the six of iman, by name with one simple line each. **الوضوء والصلاة:** steps in the agreed form. **آدابي ٢.** | Story pages (4–6) → Story Sequence → Pairs → Kind Choice / "what do we learn?" | Prophets, companions, angels and the unseen are never drawn. The narrator never voices a prophet; Quran quotes come from the dataset (the mock shows Hud 41). |
| **9–12** | Deeper stories of the Prophets with their lessons; a seerah timeline (Makkah, Madinah); belief: the six pillars explained, selected names of Allah from the Quran with their meanings; worship: salah, fasting, the idea of zakat, the hajj journey as a map; character and community. **Hadith units: HELD.** | Story → Story Sequence (5–6 cards) → comprehension questions → Kind Choice scenarios → unit assessment. | Each assessment item cites its source in the reviewer's view. |

---

## 4. The kids' design system

### 4.1 Colour (tokens as built in the mock)

| Token | Hex | Use |
|---|---|---|
| `--cream` | `#FFF8EC` | page background (warm, never pure white) |
| `--ink` / `--ink2` | `#2A2550` / `#615C84` | text; secondary text (ink on cream is about 13:1) |
| `--q` / `--qd` / `--ql` | `#14A38B` / `#0A6B5A` / `#DDF6EF` | **Quran garden**: fill, text/edge, tint |
| `--a` / `--ad` / `--al` | `#FF7A45` / `#B5431B` / `#FFE8DC` | **Letter village** |
| `--s` / `--sd` / `--sl` | `#3B82F6` / `#1D4FB0` / `#E3EDFF` | **Story oasis** |
| `--gold` / `--goldd` | `#FFC531` / `#8A5C00` | rewards, "now", stars |
| `--ok` | `#15A34A` | right answer badge (always with a ✓ shape) |

**Rules:**
- **Each world owns one hue**, so a pre-reader navigates by colour plus picture.
- White text sits only on the **dark** shade of a world (`--qd`, `--ad`, `--sd`, all ≥ 5:1). The bright fill carries icons, not small text.
- **Never colour alone:** right and wrong use a shape and an icon too (the ✓ badge, a gentle shake). Pre-reader answer tiles differ by shape **and** colour (a green circle and an orange triangle).
- The palette is deliberately not AyaKids' purple.

### 4.2 Type (Arabic first, RTL by default)
- **Quran text: Amiri Quran only** (`apps/lessons/src/fonts/AmiriQuran.ttf`), behind the QuranFontGate: no verse is drawn until that face has loaded, and never in a fallback. It is used for nothing else.
  - Sizes: 44px for 3–5, 36–38 for 6–8, 30–34 for 9–12, plus the existing 4-step size control.
- **Everything else: Baloo Bhaijaan 2** (SIL OFL 1.1, Arabic + Latin, weights 400–800). It is rounded, chunky and friendly, its harakat are clear, and it reads well at 170px for a single letter. The build vendors it like Amiri, with no CDN.
  - The mock embeds it from the Google Fonts release.
  - **The Teachers department must check its letterforms** before it teaches letters (hamza seats, ى/ي, the dots of ق/ف). The alternative is a school naskh for the letter world only (§10 Q3).
- **Scale:**
  - a hero letter of 170px;
  - letter bubbles of 62px;
  - titles 26–30px;
  - story text 21px with full harakat for 6–8;
  - prompts 19px;
  - grown-up notes 14px.
- Digits are Arabic-Indic (٠١٢…) everywhere in Arabic.
- `dir="rtl"`: progress runs right to left, "home" is top-right, and "next" points left.

### 4.3 Touch and layout
- **Targets:** ≥ **64pt** for 3–5 (the mock uses 72–132pt: answer tiles of 104–150pt, the main ▶ of 132pt), ≥ 52pt for 6–8 and ≥ 44pt for 9–12, with ≥ 12pt between targets.
- **One task per screen.** The companion and its prompt sit at the bottom start, the task in the middle, and "home" and the progress beads on top.
- **Tracing:** a 40pt-wide road, a green start dot with an arrow, and ink that follows the finger in the writing direction (right to left). It accepts small fingers and imprecise strokes; ordered coverage of 90% or more is enough.

### 4.4 Illustration: two options (THE OWNER'S DECISION)
Both are fully drawn in the mock. **"أ · بوجه" / "ب · بلا وجوه"** in the top bar switches every screen. Faces are a separate layer in the art, so the choice can be changed later without redrawing.

| | **Option A: a companion animal with a face** | **Option B: faceless** |
|---|---|---|
| What the child sees | A small orange cat companion with eyes and a smile. It bobs, cheers and points. Profile avatars are animals (cat, bird, lamb). Story animals have dot eyes. | A glowing lantern (فانوس) is the companion; its light pulses when it "speaks". Avatars are objects (star, moon, palm). Animals are silhouettes without eyes. |
| What it implies | The strongest emotional hook for 3–5: a face is what toddlers look at first, and a character carries spoken prompts naturally. It gives a brand mascot and stickers of it. It **needs the scholar's written opinion** (PD-49 Q6 adopted "no human faces; animals allowed, scholar to confirm"). Every pose and expression is reviewed like text. More animation work. | The most widely accepted position across our families; no scholar risk. Cheaper to draw and animate. Warmth must come from colour, motion, light and voice, so the voice-over (§4.6) carries more weight. Less "character" for marketing. |
| Pictures in letter games | Objects first. The closed letter-lessons design proposed objects only (no animals, people or faces) for letter games; under A, animals may appear with the scholar's OK. | Objects, and animal silhouettes. |
| Never, in either option | No depiction of Allah, prophets, companions, angels or the unseen (Paradise, Hell). **No human faces at all.** No people in the stories: the scenes, objects, animals and nature tell them. Every picture is reviewed like text. |

**Illustration style (both options):**
- flat shapes with soft rounded corners;
- one light source, a thin darker underside (the 6–7px "shelf" shadow on cards and buttons);
- a warm, saturated but not neon palette, no outlines on fills, 2–4 colours per object;
- objects drawn big and centred, so each reads at 72px;
- no text inside pictures, so English (PD-51) needs no new art.

A professional illustrator turns the mock's placeholder SVGs into the library (§9). Budget about 300 pictures for v1 across the three worlds.

### 4.5 Motion
- **Purposeful and short:** 200–450 ms for feedback (pop, rise, a gentle shake for "try again"), and 1.5–2.6 s ambient loops (the companion's bob, the pulse of the current stop).
- **"Now playing"** is shown as a glow around the ayah card's frame plus small wave bars. **The Quran text itself never moves, bounces, scales or changes.**
- Sparkles for right answers; stars pop in one by one; the new sticker flies into the album.
- Nothing flashes more than 3 times per second. `prefers-reduced-motion` turns every loop off, and the mock honours it.

### 4.6 Sound
1. **The companion's voice:** every instruction for 3–5 is a short recorded clip (6–20 per lesson type, reused). Text appears in the bubble for the grown-up. These clips are not Quran, so they go through PD-48 (an approved clip per id); a human voice is recommended (§10 Q2).
2. **Recitation:** only the approved, licensed reciter, and **never a computer voice**. Until the rights are confirmed in writing, families get "اقرأ مع طفلك" (the grown-up reads and the child taps); staff test with the recitation (PD-49 Q5).
3. **Effects:** short, non-musical, no instruments (PD-49 Q7): a soft tap, a sparkle, a page swish.
   - Nothing plays over a recitation: effects and the companion's voice wait for it to finish.
   - One mute control sits in the grown-ups' corner.

### 4.7 Rewards and progress
- **Stars per lesson:** for 3–5 always **three** when the lesson is finished. A mistake never costs a star; there is a retry, then a hint, then the answer shown and praised. 6–8 also earns stars on completion; 9–12 sees a score and a "to review" list.
- **A sticker per lesson**, themed by world, collected in **ألبومي**. Empty places are faint silhouettes that invite without shaming.
- **World meta-progress:** the garden grows, the village lights up, the oasis gets palms. At the end of a unit, children 6+ get a certificate through PD-41's existing system.
- **Never:**
  - leaderboards or comparisons between children;
  - a streak that "breaks" (we show "days you practised" without loss);
  - coins, shops or purchases;
  - a loot-box-style random reward.

### 4.8 Accessibility
- RTL by default, labels on every control, and the ayah card's accessible name is its number and text (as in the engine today).
- Never colour alone; ≥ 4.5:1 for text; targets as in §4.3.
- No time limits anywhere for 3–8. For 9–12, a timer appears only in an opt-in challenge.
- The prompt's text is always visible (deaf and hard-of-hearing grown-ups can relay it). The text size control is kept.
- Reduced motion is honoured, and a mute control exists.
- **Audio-off is a real mode,** not a broken one (§4.6).

### 4.9 English later (PD-51)
- Every child-facing string is a keyed clip plus short text, so English is a second record per id.
- The layout mirrors with `dir`, and pictures carry the meaning (no text baked into art).
- **The Quran stays Arabic in Amiri Quran in both modes**, with English as a separate reviewed record bound to the Arabic hash (PD-51 §5.2).

---

## 5. The game catalogue (12 mechanics)

### 5.1 Rules every game obeys (the respect rules)
1. **No Quran words or ayat as game objects.** A verse is never:
   - popped, caught, shot, eaten, thrown, stacked as a block, used as an obstacle, stepped or climbed on, or assembled into food;
   - shown upside down, cut into letters or animated.

   Ayat may be **heard, tapped, and placed whole into frames in order**. Letters and ordinary Arabic words (never words taken from a verse) may be played with.
2. **No altered Quran.**
   - A wrong option is never inserted into an ayah.
   - Distractors are other **real** ayat, shown whole as themselves.
   - Splitting happens only at a verified word boundary (9–12).
   - Nothing on screen ever reads as Quran without being Quran.
3. **The Quran comes only from the verified dataset** (pinned Tanzil, hash-checked; the engine refuses anything else). It is drawn only in Amiri Quran behind the font gate.
4. **Never a computer voice for the Quran.**
5. **For 3–5: no timers, no failure, no lost stars, no "wrong" buzzer.** A miss gets a gentle shake and "استمع مرة أخرى", then the right tile glows, then the answer is shown and praised.
6. **No depiction** of Allah, prophets, companions, angels or the unseen; **no human faces**.
7. **Distractors never attribute a wrong act or a bad trait to a prophet**, even as a wrong option. Questions ask about the child's own behaviour (the mock's question is "what do *we* say when we ride?").
8. **No madhhab names** for children; teach the agreed core.
9. **No hadith text** until IslamHouse's written permission. Quranic duas from the dataset are allowed now.
10. No music with instruments, no ads, no external links, no data beyond progress, **no recording of the child's voice**.
11. **Rounds are generated by a rule** from teacher-approved words and pictures, never written one by one, and **CI proves that every generated round has exactly one right answer** (e.g. the in-word letter occurs once; no other picture also starts with the sound).
12. **No Quran text and no Name of Allah inside any game object** (letters, words, cards or pictures).
13. **Each Quran mechanic (1–5) is signed once** by a teacher and the scholar, with the hash of its code (PD-49's existing `codeSha256` mechanism). Changing the code means signing again. Letter and story mechanics are reviewed by the Teachers department; their content (and, for stories, the scholar) is reviewed item by item.
14. **For 3–5, after two tries the answer is shown and praised.**

### 5.2 The twelve

| # | Mechanic (Arabic name) | Bands | Teaches | How it works | The single right answer | Mechanic-specific respect | Needs recitation |
|---|---|---|---|---|---|---|---|
| 1 | **Listen & Glow** (اسمع والمس) | 3–5 (6–8 intro) | Attentive listening; familiarity with one ayah | One whole ayah card. Its frame glows during the recitation; a tap replays it. | None asked: it completes once the ayah has been heard. | Text still and whole; only the frame animates. | Yes (else the grown-up reads) |
| 2 | **Echo** (ردّد معي) | 3–8 | Reciting by imitation | The recitation plays, then "your turn"; the grown-up taps ✓ when the child has repeated it. | None machine-judged: the grown-up confirms. | No recording, no scoring of the voice. | Yes |
| 3 | **Which Did You Hear?** (أيّها سمعت؟) | 3–8 | Telling ayat apart by ear | The big speaker plays one ayah. 2 tiles (3–5: shape + colour, each with its own small speaker) or 3 tiles (6–8: text). | The tile whose ayah was played. | Tiles are tapped, never moved; the distractor is another real ayah. | Yes |
| 4 | **Light the Lanterns** (أضئ الفوانيس) | 6–12 | The order of the ayat | Whole ayat hang in unlit lantern frames; the child taps the ayah that comes next, and its lantern lights in its place. | Mushaf order from the verified text. | Ayat placed whole, never stepped on (no stairs, stones or trains). | No |
| 5 | **What Comes Next?** (ما الآية التالية؟) | 6–12 | Recall and continuity | Shows (and plays, if available) ayah *n*; choose ayah *n+1* among 3–4 real ayat. For 9–12 the cue fades to first letters. | Ayah *n+1*. | Options are real ayat from the dataset, shown whole. | Optional |
| 6 | **Letter Hunt** (أين الحرف؟) | 3–8 | Recognising a letter's shape; later where it sits in a word | **3–5:** match to sample, the target among look-alike bubbles. **3–5** also gets the letter in a word, with the model letter shown beside the word, and "where is it?" with the letter highlighted. **6+:** 3–4 look-alikes in the same form, then the letter inside a word, then "which position?" (three boxes, right to left: start, middle, end) with no highlight. | The one target per round. In-word rounds use only words where the letter occurs **once**. | Letters and common words only, never verse words. | No (a clip says the letter) |
| 7 | **First Sound** (بأيّ صوت تبدأ؟) | 3–6 | Phonemic awareness | Hear "بَ"; pick the picture whose word starts with it (2 pictures for 3–4, 3 for 5–6). The word is written only after the choice. **Absent from a lesson until its approved clip exists.** | The one picture, checked by teachers (unambiguous in fusha). | Ordinary words and pictures only. | No (an approved clip) |
| 8 | **Trace & Dot** (اكتب بإصبعك) | 3–8 | Letter formation and direction | Follow the road from the green dot, right to left; the ink follows the finger. Then place the dot(s). | Ordered coverage ≥ 90%; the one correct dot position. | Not used for Quran text, ever. | No |
| 9 | **Sound Mixer / Build the Word** (ركّب الكلمة) | 3–9 | Blending: letter + haraka → syllable → word | **3–5:** complete the word against a visible model (one missing letter, 2 tiles). **6+:** hear a syllable or word and build it from letter and haraka tiles; later, pick the words that contain the letter. | The one syllable or word asked. | Common words only. | No |
| 10 | **Story Sequence** (رتّب الحكاية) | 5–12 | Comprehension and memory of a story | Tap the picture cards in the order they happened (3 / 4 / 5–6 cards by band); each fills the next slot. | The sourced order. | Scenes only: no prophets or people drawn; the order matches the cited source. | No |
| 11 | **Pairs** (الأزواج) | 4–12 | Memory; vocabulary (picture ↔ word) | Classic memory pairs: 3 pairs for 4–5, 6 for 6–8, 8 for 9–12. No mistake counter, no clock. | Each card has exactly one partner. | No Quran words and no names of Allah as cards. | No |
| 12 | **Kind Choice** (ماذا نفعل؟) | 4–12 | Manners, worship basics and lessons of the story, applied | A scenario (picture plus voice); choose what we do or say. 3–5 choose among pictures. | One option, sourced and reviewed. | Distractors are never about a prophet's conduct and never mock; fiqh in the agreed form, no madhhab names. | No |

**Presentation activities** (not games, but part of lessons): **Meet the Letter** (a big letter, its sound, three pictures that start with it) and **Story Pages** (illustrated pages, vowelled text, a narrator, a citation in the reviewer's view).

**What exists already:** 1–3 are PD-49's `ListenGlow`, `Echo` and `WhichHeard` on `main` (in `apps/lessons/src/play/games`). They keep their logic and signatures. The new visual layer changes their shared code, so they will be signed again (§8).

---

## 6. Per-band flow, as shown in the mock
- **Quran, age 4** (Al-Ikhlas 1–2):
  1. start with the grown-up (one ▶, a dashed note for the adult);
  2. Listen & Glow ×2;
  3. Echo, with the grown-up's ✓;
  4. Which Did You Hear ×2 (circle and triangle tiles; two misses make the right tile glow);
  5. reward.

  The sprout in the background grows with each step.
- **Arabic, age 5** (ب):
  1. Meet the Letter (tap ب; tap duck, door and house: بطّة، باب، بيت);
  2. Letter Hunt ×3 (far → near: م ع → ن ج → ت ث);
  3. First Sound ×2;
  4. Trace ب, then place its dot;
  5. reward.
- **Islamic story, age 7** (the ark of Nuh عليه السلام):
  1. six story pages, each with a citation (العنكبوت ١٤ · هود ٣٧–٤٤ · القمر ١١–١٢ · الشعراء ١١٩), one of which quotes **Hud 41 from the dataset** in Amiri Quran;
  2. Story Sequence (4 cards);
  3. Pairs ("of every kind a pair");
  4. Kind Choice ("what do we say when we ride?");
  5. reward.

  **The story's wording is a SAMPLE, not reviewed**, written only to show the format.

---

## 7. The mock
- **Path:** `docs/owner/kids-v2-mock/index.html` (git-excluded, 367 KB, one file, works offline).
- **To open on the iPhone:** AirDrop it, or serve it, then open it in Safari. Quick Look in Files does not run its scripts.
- **The dark top bar is for reviewers only:**
  - **أ · بوجه / ب · بلا وجوه** switches the illustration option on every screen;
  - the screen menu jumps to any of the 12 screens;
  - **ملاحظات** shows design notes in place.
- **Screens:** who is playing, home, three world maps, the three lessons end to end, the reward, the sticker album, the grown-ups' gate (tap the number written as a word) and the grown-ups' corner (per child: the week, what was learned, the teacher's note and chat button, settings, "how we ensure accuracy").
- **The Quran text** is read at build time from `data/quran/tanzil-uthmani-1.1.txt`. The build checks its SHA-256 against the manifest `tanzil-uthmani-1.1.json` and refuses on a mismatch. The Basmala is split off ayah 1 by exact prefix. The text is drawn in the embedded `AmiriQuran.ttf` behind a font check: no verse appears unless that face loaded.
- **Deep links for screenshots:** `#s=lesson:arabic&i=3&m=B&static=1` (`m` picks the option, `static=1` freezes animations, `notes=1` shows the notes).
- **The build script and screenshot script** are in this session's scratchpad. The screenshots are in the department head's notes folder, `kids-v2-mock-screens/`.
- **Known limits:**
  - no audio (recitation and clips are represented by a glow, wave bars and the bubble);
  - placeholder art;
  - sample, unreviewed story wording;
  - progress is not saved.

---

## 8. What stays underneath, and what is thrown away

### 8.1 Kept: invisible safety infrastructure (unchanged unless stated)
- **The verified Quran dataset:** `data/quran/` (Tanzil Uthmani 1.1, pinned three times), the CI snapshot build that verifies it, and `apps/lessons/src/quran/dataset.ts`, which fails closed on any mismatch.
- **QuranFontGate and AmiriQuran.ttf** (`apps/lessons/src/quran/font.tsx`): no verse without the Mushaf face.
- **The rasm and content checkers** (`check-quran-content.py`, `rasm.ts`): the Quran is never typed.
- **The review gates** (the review system of #258/#265):
  - the Teachers department for everything;
  - a scholar for stories, tafsir, lessons, pictures and game mechanics;
  - two different people;
  - held text never ships in the bundle.
- **Signed approvals for Quran content:**
  - `approvals-ledger.json`, the keys and `play.json` signatures;
  - `mechanics.json`, with each mechanic's `codeSha256` over its own file and the shared play code. **The new visual layer changes the shared files, so mechanics 1–3 are signed again; that is expected and cheap.**
- **The recitation gate** (`quran.audio.enabled_for`, staff_test until the rights are in writing), the audio controller and its verified manifest.
- **PD-48 voice-over:** a clip binds to (lesson, id, SHA-256 of its exact text), needs two teachers' approval, and switches off by itself when the text changes. For 3–5 this is the main channel.
- **Design-neutral engine parts** (PD-29 hand-over, `pd029-handover-to-kids-v2.md` in the head's notes): the route table (an unknown lesson is "not found", never a guess); the seeded shuffle computed once into state (options never move under the child's finger); answers checked by id, never by position; stars earned once per section; one audio controller per lesson with the sha256-checked recitation list; CI-only production builds; the strict CSP; opening from Chat by path.
- **Content rules (owner, 2026-10-29):** one child-friendly wudu and salah method, signed off by the Teachers department and a scholar; every fiqh or worship step is held until then.
- **The PD-49 adaptation model** (band × length tier × teacher-set level) and its progress plan (§B.5); PD-41 certificates; the DIRECT parent ↔ teacher conversation; PD-51's bilingual record model.
- **Content rules:** hadith held until IslamHouse; no madhhab names; public-domain sources only for knowledge content (PD-49 §A).

### 8.2 Thrown away
- **The old lesson structure:**
  - the surah lesson page and its sections (Listen / Verses / Order / Benefits: `lesson/SurahLesson.tsx`, `Benefits.tsx`, `Verses.tsx`);
  - the Arabic lesson page (`arabic/ArabicLesson.tsx`, `FindLetter.tsx`, `PickWords.tsx`);
  - the reading lesson page (`reading/`);
  - the flat Library list of lessons as the child's way in;
  - the current `styles.css` look.
- **All extracted content:**
  - the 38 extracted `content/surah-NNN.json` knowledge files;
  - the Arabic lessons `arabic/lesson-001…010.json` and their word lists;
  - the reading lessons.

  None of it is reused, not even as a draft. Knowledge content is written fresh from the pinned public-domain sources (PD-49 §A) and reviewed.
- **How:** the old routes are hidden from families as soon as the owner agrees (§10 Q9). The files are deleted in one cleanup PR once v2 reaches families, so nobody can confuse them with the new ones.

---

## 9. Build plan (small PRs, after approval)

Each PR is behind the flag `lessons.kids_v2` (staff only) until the owner signs off on the pilot. Content batches are separate PRs, gated by review.

| PR | What | Size / notes |
|---|---|---|
| **0** | This design doc (docs only). Claim a PD number if the department head wants one. | now |
| **1** | Design tokens + Baloo Bhaijaan 2 vendored with its OFL; the base kids stylesheet; no visible change. | small |
| **2** | The shell: profiles → home → world map → lesson player → reward → sticker album, with the chosen illustration option, on dummy lessons. | medium; Playwright screenshots at 390 px |
| **3a / 3b** | The per-child progress store (stars, stickers, lesson completion; API + migration; **ask the head for a slot**), then the engine wiring. | small each |
| **4** | Quran world for 3–5: mechanics 1–3 moved into the new player (**re-signed**), Al-Fatihah + the pilot surahs, and the audio-off "read with your child" mode. | medium |
| **5** | Letter village for 3–5: Meet, Letter Hunt, First Sound, Trace & Dot; then **content batch:** unit 1 (أ ب ت ث) with pictures, words and clips → review. | medium + content |
| **6** | Story oasis for 6–8: Story Pages, Story Sequence, Pairs, Kind Choice; then **content batch:** the Nuh story written from sources → scholar review. | medium + content |
| **7** | The grown-ups' corner, **in the Flutter app** (native, using the existing auth and the DIRECT chat), reading the progress store; the teacher's note. | medium |
| **8** | Rewards meta-progress (garden, village, oasis) + the PD-41 certificate hook. | small |
| **9** | 6–12 mechanics: Light the Lanterns, What Comes Next, Sound Mixer; Arabic units 6–8. | medium |
| **10** | Remove the old lesson UI and content (§8.2). | small |
| **(parallel)** | Illustrator brief from this mock (about 300 pictures, every one reviewed); voice recording of the clip script (PD-48 ids). | not code |

Machine rule: each PR builds only `apps/lessons` (CI builds the engine); at most 3 builder sessions at once.

---

## 10. Open questions for the owner (each with a recommendation)

1. **Illustration: a companion with a face (A) or faceless (B)?** *Recommend **A**, a simple animal companion, never human, never a sacred figure, **only after the scholar's written OK**. It is the strongest hook for 3–5 and something AyaKids does not have. If the scholar declines, B is fully designed and the switch is cheap, because faces are a separate layer.*
2. **The companion's voice: a recorded human voice, or PD-48 TTS?** *Recommend a **human voice** for the short instruction clips (about 80 per band, recorded once, teacher-approved): children respond to warmth, and the clips barely change. Keep TTS for long narration only if budget requires. **Letter sounds and the sound-contrast minimal pairs should be teacher recordings**, because a computer voice is weak on single letter sounds. The Quran is never TTS.*
3. **The child-facing font:** *Recommend **Baloo Bhaijaan 2** for the child's screens (everything except the Quran), after the Teachers department checks its letterforms, with a school naskh for the letter world only if they find a problem. IBM Plex Sans Arabic (the brand font, PR #316) stays for grown-up screens.*
4. **3–4-year-olds always with a grown-up?** *Recommend yes: the first screen of every 3–5 Quran lesson says so, and Echo needs the grown-up's ✓ by design.*
5. **Sound effects:** *Recommend short non-musical effects (tap, sparkle, page swish), never over recitation, with one mute control.*
6. **Stars for 6–12: completion or accuracy?** *Recommend completion for 3–8 and a score plus a review list for 9–12, never a lost star.*
7. **Daily time limits:** *Recommend 15 / 20 / 30 minutes by band as the default; the parent can change them.*
8. **Where does the grown-ups' corner live?** *Recommend the **Flutter app**: it already has the parent's login, the children and the chat with the teacher. The engine stays the child's space.*
9. **The old materials:** *Recommend hiding them from families now (already rejected) and deleting them when v2 ships (§8.2).*
10. **Manners lessons before hadith permission:** *Recommend teaching the phrases (بسم الله، الحمد لله، السلام عليكم) as manners now, without quoting or citing any hadith text, and adding the duas when IslamHouse permits. The scholar confirms.*
11. **An illustrator:** *Recommend hiring one now, briefed with this mock's style (§4.4), for about 300 pictures for v1, each reviewed like text. Without art the product cannot reach AyaKids' polish.*
12. **World names:** روضة القرآن · قرية الحروف · واحة الحكايات. *Recommend keeping them: short, visual and ours. The owner may rename them.*
13. **The first pilot slice:** *Recommend Quran 3–5 (Al-Fatihah, 112) + letter unit 1 (أ ب ت ث) + one story (Nuh) for 6–8. These are exactly the three mock lessons, so the owner judges the real thing against what they approved.*
