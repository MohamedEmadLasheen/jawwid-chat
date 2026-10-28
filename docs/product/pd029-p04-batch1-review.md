# PD-29 P0-4, Juz' Amma batch 1 (107–114): lines held for teacher review

The second set of lessons rebuilt on the engine, after Al-Buruj (`pd029-p04-buruj-review.md`). Each file is `apps/lessons/src/content/surah-NNN.json`. Each was extracted **as text** from the old lesson (jawwid-lessons @ c231532, read only, never built or run). The prose was copied byte-for-byte, or rebuilt from exact pieces with only markup or end-of-line emoji removed, as each file's `review.note` says. The Quran appears only as positions in the verified Tanzil text.

**How review works.** It is the same as Al-Buruj.

- Until a Teachers department reviewer approves a file (`review.status` = `approved`, with `review.by`), the lesson shows nothing from it, only the verified Quran.
- Even then, a line whose `review` is set is held back.
- The CI check (`scripts/lessons/check-lesson-content.py`) refuses an approved file that still has a flagged line.

## Numbering

Every old ayah list was aligned word by word against the verified text (`ayah_map`). The check catches the pattern found in Al-Buruj (ayat split into several entries, then a stop before the end), merges and gaps.

| Surah | Ayat | Finding |
|---|---|---|
| 107 Al-Ma'un | 7 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 108 Al-Kawthar | 3 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 109 Al-Kafirun | 6 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 110 An-Nasr | 3 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 111 Al-Masad | 5 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 112 Al-Ikhlas | 4 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 113 Al-Falaq | 5 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 114 An-Nas | 6 | Matches the verified text: each old entry is exactly one real ayah, all present |

So none of the eight has Al-Buruj's split-and-stop numbering. Two needed a matching aid, used for alignment only and never stored:

- **Al-Kafirun:** the old text writes «يا أيها» as two words; the Uthmani text has one token.
- **Al-Ma'un:** the old text spells «أرأيت» where the Uthmani text has «أرءيت».

## What was dropped, in every surah

- **The Tajweed rules, games and quiz questions.** Tajweed comes only from the reviewed dataset. The old Tajweed was also wrong in places; for example, in Al-Kafirun the same phrase was given as both izhar and idgham.
- **The audio URLs.**
- **Every hand-typed Quran string,** now positions in the verified text.
- **Quiz options and game distractors that were typed Quran not of the surah.** These were replaced with words of the surah (flagged `CHANGED`), or the question was dropped.
- **Not carried over yet:** the ordering, build-the-ayah, memory and meaning-matching games, and the intro quizzes. The engine has no such games.

## 107 Al-Ma'un: 4 held

| Where | Old text | Why it is held |
|---|---|---|
| Quiz q4 | ما الآية التي تأتي بعد | CHANGED: the old question typed the whole of ayah 4 into its text; it now shows ayah 4's last word (li-l-musallin) after "ma al-ayah allati ta'ti ba'd". Teacher to confirm it reads well. |
| Quiz q7 | أكمل الآية | CHANGED: the old distractor al-musallin is not a word of this surah; it is now li-l-musallin (4:2). The distractor al-yatimi (typed with kasra) shows as the surah's al-yatima (2:4). |
| Lesson | يجب أن نكون لطفاء مع الأطفال الذين ليس لهم أب أو أم، ونساعدهم ونلعب معهم. | Says the orphan has "no father or mother". The yatim of this surah is a child whose father has died, as the lesson's own word meaning and did-you-know line say. Teacher to align the wording. |
| Did you know | سورة الماعون نزلت في مكة المكرمة | Makki is disputed: many scholars count it Madani, or its first three ayat Makki and the rest Madani. Teacher to confirm. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the five Tajweed rules, the Tajweed game and the two Tajweed quiz questions (Tajweed comes only from the reviewed dataset), the audio URLs, and every hand-typed Quran string (replaced by positions). The complete-the-ayah words are the answers of the old "complete the ayah" and "missing word" games; the missing-word answer 'an salatihim (5:3-4) is left out because it is two words, and the games' hand-typed distractors (several not words of this surah) are gone: the game draws its options from this surah's words. Four word meanings were typed without the particle the verse word carries; they point at the whole verse word (1:4, 4:1, 4:2, 7:1). The old quiz had no categories; they were assigned here. Not carried: the intro quiz and facts (name, ayah count, Makki), the "why it was revealed" line, the ordering, build-the-ayah and start-end matching games, the three word-meaning games, the lessons' titles, the "how we apply these lessons" list and the second reflection prompt. Emoji were stripped from the ends of lines.

</details>

## 108 Al-Kawthar: 5 held

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, ayah 3 | الذي يكرهك يا محمد هو الخاسر وليس أنت! | Renders al-abtar as "the loser". Common tafsir: the one cut off from all good, whose remembrance is cut off (the lesson's own word meaning says "cut off, with no good in him"). Teacher to choose the wording. |
| Quiz q6 | ما الآية الثانية في سورة الكوثر؟ | CHANGED: the old fourth option was the basmala, hand-typed and not an ayah of this surah; it is dropped, leaving the surah's three ayat as the options. |
| Lesson | النبي ﷺ كان يساعد الجميع ويحب الخير للناس | A good lesson, but not one this surah teaches. Teacher to keep or drop. |
| Lesson | الذي يكره الآخرين هو الخاسر! يجب أن نحب الجميع | Generalises "whoever hates the Prophet is the one cut off" (ayah 3) to anyone who hates others, and adds "we must love everyone". Teacher to check the wording. |
| Lesson | الله يحب الأطفال الذين يطيعون والديهم ويحترمونهم | A good lesson, but not one this surah teaches. Teacher to keep or drop. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson (which has no data file; its content lives in the components), then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the five Tajweed rules, the Tajweed game and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the audio URLs, the quiz question on the meaning of the whole of ayah 2 (its text was the ayah typed into the question, and there is no ayah-meaning question shape), and every hand-typed Quran string (replaced by positions). Not carried: the intro quiz and facts (name, ayah count, Makki), the reason for revelation paragraph, the order, start-end matching, build-the-ayah and listen games, the three word-meaning games, the lessons' titles and "how to apply" lines, and the second reflection prompt. The old lesson had no did-you-know lines and no reflection ideas. Emoji were stripped from the ends of lines.

</details>

## 109 Al-Kafirun: 10 held

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, ayah 3 | وأنتم لن تعبدوا الله الذي أعبده | Says "you will never worship Allah". Common tafsir reads this as said to particular Quraysh leaders who died in disbelief, or as "you are not worshippers of what I worship"; as written a child may take it to mean that no non-Muslim can ever believe. Teacher to confirm the wording. |
| Tafsir, ayah 5 | وأنتم لن تعبدوا الله الذي أعبده وحده | Says "you will never worship Allah". Common tafsir reads this as said to particular Quraysh leaders who died in disbelief, or as "you are not worshippers of what I worship"; as written a child may take it to mean that no non-Muslim can ever believe. Teacher to confirm the wording. |
| Word meaning, 2:2 | لن أعبد أبداً | PHRASE: the old entry is "la a'budu" (2:1-2); this points at a'budu (2:2) and the meaning carries the negation; the engine shows one word. Teacher to confirm it reads right. |
| Word meaning, 2:4 | الأصنام التي تعبدونها | PHRASE: the old entry is "ma ta'budun" (2:3-4); this points at ta'budun (2:4); the engine shows one word. Teacher to confirm it reads right. |
| Word meaning, 3:5 | الله الذي أعبده | PHRASE: the old entry is "ma a'budu" (3:4-5, repeated as 5:4-5); this points at a'budu (3:5); the engine shows one word. Teacher to confirm it reads right. |
| Word meaning, 4:5 | الذي عبدتموه من أصنام | PHRASE: the old entry is "ma 'abadtum" (4:4-5); this points at 'abadtum (4:5); the engine shows one word. Teacher to confirm it reads right. |
| Quiz q8 | أكمل الآية | CHANGED: the old options were two-word phrases (ma 'abadtum / ma ta'budun / ma a'budu). The prompt now shows four words, up to "ma", and the options are the second words ('abadtum / ta'budun / a'budu). Teacher to confirm. |
| Lesson | احترام الآخرين: نحترم الجميع حتى لو كانوا مختلفين عنا | Presents the surah as teaching respect for people who differ. Common tafsir reads "lakum dinukum wa liya din" as a disavowal of their worship (bara'a), not approval of it. Good manners are right, but teacher to decide whether this lesson belongs to this surah and how to word it. |
| Lesson | الصدق والأمانة: نقول الحق دائماً كما فعل النبي ﷺ | Truthfulness is not a theme of this surah. Teacher to decide whether to keep it here. |
| Did you know | كان النبي ﷺ يقرأ سورة الكافرون قبل النوم | The known hadith (Nawfal al-Ashja'i, in Abu Dawud and al-Tirmidhi) is the Prophet telling a companion to recite it before sleeping, not a report that he himself did. Teacher to reword. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the five Tajweed rules, the Tajweed quiz question and the two Tajweed games (Tajweed comes only from the reviewed dataset), the audio URLs, and every hand-typed Quran string (replaced by positions). Also dropped: the quiz question "which ayah comes after la a'budu ma ta'budun?", because its question is typed Quran and two of its three options (ayat 3 and 5) are the same text. The complete-the-ayah words are the answers of the old "missing word" game; its hand-typed distractors (none of them words of this surah) are gone, as the game draws its options from these words. The old quiz had no categories; they were assigned here. Each lesson learned is its old title and description joined; the lessons' "how do we apply it" lines are the reflection's ideas, under the old two reflection questions joined. Not carried (no field or no such game in the engine): the "Makki" type, the revelation story and the hadith of the intro card, the ayah-ordering, next-ayah, memory, build-the-ayah and meaning games, and the intro quiz.

</details>

## 110 An-Nasr: 2 held

| Where | Old text | Why it is held |
|---|---|---|
| Intro | سورة النصر نزلت بعد فتح مكة، وهي تبشّر بنصر الله للإسلام ودخول الناس فيه، وتأمر بالتسبيح والاستغفار. | Says the surah was revealed after the conquest of Mecca. Scholars differ: some say before the conquest (as a promise of it), and a well-known report (Ibn Umar) places it at Mina in the Farewell Hajj. Teacher to choose the wording. |
| Did you know | هل تعلم أن سورة النصر نزلت في المدينة المنورة؟ | "Madani" means revealed after the Hijra, not necessarily in Medina; the report of Ibn Umar places its revelation at Mina during the Farewell Hajj, so "in Medina" may be wrong. Teacher to reword. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the four Tajweed rules and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the audio URLs, the two wrong options of the reflection question (only its right answer is kept, as the idea), and every hand-typed Quran string (replaced by positions). The "choose the meaning" game is carried into the quiz (q8-q10); its afwajan question repeated q3 and is skipped. Each lesson learned is its old title, description and example joined. Not carried over: the ayah-ordering, build-the-ayah and word-to-meaning matching games and the intro quiz (surah name, ayah count); the engine has no such games yet.

</details>

## 111 Al-Masad: 9 held

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, ayah 2 | لم ينفعه ماله الكثير ولا أعماله في شيء | Reads "ma kasab" as "his deeds". Many tafsir (Ibn Abbas, Mujahid) say "ma kasab" is his children; others his earnings and standing. Teacher to choose. |
| Word meaning, 1:3 | عم النبي ﷺ واسمه عبد العزى | PHRASE: the old entry is the two words "abi lahab" (1:3-4); the engine shows one word, so this points at abi (1:3) and the meaning covers both. Teacher to confirm it reads right. |
| Word meaning, 2:2 | لم ينفعه | PHRASE: the old entry is the two words "ma aghna" (2:1-2); the engine shows one word, so this points at aghna (2:2) and the meaning covers both. Teacher to confirm it reads right. The negation is in the meaning. |
| Word meaning, 2:6 | عمله وما جمعه | Gives "his work and what he gathered". Many tafsir (Ibn Abbas, Mujahid) say "ma kasab" is his children; others his earnings and standing. Teacher to choose. |
| Word meaning, 3:3 | ذات اشتعال شديد | PHRASE: the old entry is the two words "dhata lahab" (3:3-4); the engine shows one word, so this points at dhata (3:3) and the meaning covers both. Teacher to confirm it reads right. |
| Word meaning, 4:2 | التي كانت تحمل الأشواك | PHRASE: the old entry is the two words "hammalat al-hatab" (4:2-3); the engine shows one word, so this points at hammalah (4:2) and the meaning covers both. Teacher to confirm it reads right. |
| Quiz q3 | ما أول كلمة في سورة المسد؟ | CHANGED: the old distractors "bismi" and "qul" were hand-typed Quran not in this surah; they are now the first words of ayat 4 and 2. The answer (tabbat, 1:1) is unchanged. |
| Quiz q8 | ما معنى | PHRASE: the old question asks about "hammalat al-hatab" (4:2-3); the engine shows one word, so it points at hammalah (4:2). Teacher to confirm it reads right. |
| Quiz q10 | أكمل الآية | CHANGED: the old question asked for the two-word ending "dhata lahab" against made-up endings (dhata hatab, dhata adhab, dhata nur: not Quran). It now shows three words and asks for lahab (3:4); the distractors al-hatab (4:3), masad (5:5) and habl (5:3) are words of this surah. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the five Tajweed rules, the Tajweed quiz question and the five Tajweed games (Tajweed comes only from the reviewed dataset), the audio URLs and the reciter line, the reason-for-revelation paragraph (it quotes another surah's ayah, 26:214, as typed Quran), and every hand-typed Quran string (replaced by positions). The complete-the-ayah words are the answers of the old "complete the ayah" and "missing word" games; the two-word answers (dhata lahab, min masad) became their last word. The old quiz had difficulty levels (easy, medium, hard), not categories; the categories were assigned by question type. Lessons learned keep each card's sentence; its short title is not carried. The reflection is the old prompt's question, with the "how we apply these lessons" tips as its ideas (its second line, "how can we apply it", is not carried). Emoji were stripped from the ends of lines. Not carried over (the engine has no such games yet): the order, build-the-ayah and memory games, the word-to-meaning matching games and the meaning multiple-choice games (same words and meanings as the list and quiz), and the intro quiz (surah name, ayah count).

</details>

## 112 Al-Ikhlas: 5 held

| Where | Old text | Why it is held |
|---|---|---|
| Word meaning, 3:2 | ليس له ولد | PHRASE: the old entry is "lam yalid" (3:1-2); the engine shows one word, so this points at yalid (3:2) and the meaning carries the negation. Teacher to confirm it reads right. |
| Word meaning, 3:4 | ليس له أب أو أم | PHRASE: the old entry is typed "lam yulad" but the ayah reads "wa-lam yulad" (3:3-4); the engine shows one word, so this points at yulad (3:4) and the meaning carries the negation. Teacher to confirm. |
| Quiz q8 | سورة الإخلاص تعدل كم من القرآن في الأجر؟ | The hadith (al-Bukhari) says it equals a third of the Quran; "in reward" is one explanation (others: in meaning, tawhid being a third of its themes). Teacher to confirm the wording. |
| Did you know | هل تعلم أن سورة الإخلاص تعدل ثلث القرآن في الأجر؟ | The hadith (al-Bukhari) says it equals a third of the Quran; "in reward" is one explanation (others: in meaning, tawhid being a third of its themes). Teacher to confirm the wording. |
| Did you know | هل تعلم أن النبي ﷺ كان يحب قراءة سورة الإخلاص؟ | The well-known hadith is about a Companion who loved this surah (al-Bukhari); that the Prophet recited it often (in witr, before sleep) is established. Teacher to confirm the wording. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. The old lesson had no data file: the ayat, tafsir and word meanings came from lib/audioUtils.ts, the rest from the components. Dropped: the three Tajweed rules and the two Tajweed quiz questions (Tajweed comes only from the reviewed dataset), the audio URLs and the reciter line, and every hand-typed Quran string (replaced by positions). The complete-the-ayah words are the answers of the old "complete the ayah" and "missing word" games; 4:5 (ahadun) is left out because it looks the same as 1:4 and would show as a wrong option beside it. Not carried over (the engine has no such games yet): the order, listen-and-pick, memory and build-the-ayah games, the two meaning games (same words and meanings as the list and quiz), and the intro quiz (surah name, ayah count). The intro line is the old card's text with its highlight markup removed; emoji were stripped from the ends of lines.

</details>

## 113 Al-Falaq: 4 held

| Where | Old text | Why it is held |
|---|---|---|
| Quiz q6 | ما هي الآية الأولى في سورة الفلق؟ | CHANGED: the fourth old option was "qul a'udhu bi-rabbi an-nas", which is An-Nas 114:1, typed, not an ayah of this surah. It is replaced by ayah 4 of Al-Falaq. |
| Quiz q8 | أكمل | CHANGED: the old distractors (an-nas, al-alamin, as-sama') were hand-typed, not of this surah; these three (khalaq, al-uqad, ghasiq) are words of this surah. |
| Quiz q9 | أكمل | CHANGED: the old distractor "nazala" was hand-typed, not of this surah; it is replaced by al-uqad, a word of this surah. |
| Did you know | هل تعلم أن سورة الفلق نزلت في مكة المكرمة؟ | Whether Al-Falaq is Makki or Madani is disputed: the Madinah mushaf heads it Makki, but many scholars hold it is Madani (the report of Labid's sorcery against the Prophet is set in Madinah). Teacher to decide whether to keep this. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the three Tajweed rules (Tajweed comes only from the reviewed dataset; the old quiz had no Tajweed question), the audio URLs, the typed basmala, and every hand-typed Quran string (replaced by positions). The completion game's hand-typed distractors not of this surah (an-nas, al-alamin) are gone: the game draws its options from this surah's words. The old quiz had no categories; they were assigned here. Not carried (no field or no such game in the engine): the "Makki" surah type, the ayah-ordering and start-to-end matching games, the word-meaning games, the intro quiz, and the reflection's lead-in line.

</details>

## 114 An-Nas: 4 held

| Where | Old text | Why it is held |
|---|---|---|
| Intro | سورة الناس هي آخر سورة في القرآن الكريم، وهي من المعوذتين. تعلمنا أن نستعيذ بالله ونطلب حمايته | CUT: the old intro ended "... and His protection min sharr al-waswas al-khannas", which is ayah 4 typed in full. The Quran never goes in prose, so the text stops before it. Teacher to finish the sentence. |
| Word meaning, 1:3 | خالق ومدبر | The old card was "rabb" alone; the verse word at 1:3 is "bi-rabbi" (with the preposition bi-), so the meaning covers only part of the word shown. Teacher to confirm the card. |
| Word meaning, 5:4 | قلوب | Gives sudur as "hearts"; the word means chests (common tafsir: the chests, where the hearts are). Teacher to confirm the wording. |
| Quiz q8 | أكمل | CHANGED: the old options were two-word phrases (the answer "sudur al-nas"), and its three distractors (qulub, uqul, aydi al-nas) were hand-typed, not of this surah. It now asks only for the next word, sudur; the two distractors are words of this surah. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the four Tajweed rules and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the audio URLs, the typed basmala, and every hand-typed Quran string (replaced by positions). The completion and missing-word games' hand-typed distractors not of this surah (al-falaq, al-alamin, khaliq, qulub, uqul, wal-mala'ika, wash-shayatin, yanam, yal'ab) are gone: the game draws its options from this surah's words. The old quiz had no categories; they were assigned here. Not carried (the engine has no such game): the ayah-ordering and build-the-ayah games, the word-meaning match/choose/drag games, the intro quiz, and the reflection's closing note.

</details>


43 lines held across the eight surahs. Nothing in these files is shown until the Teachers department signs each one off; the unflagged lines need that review too.
