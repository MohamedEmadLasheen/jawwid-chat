# PD-29 P0-4, Juz' Amma batch 2 (99–106): lines held for teacher review

The third set of lessons rebuilt on the engine, after Al-Buruj and batch 1 (`pd029-p04-batch1-review.md`). The method and rules are the same.

- Each lesson's prose was copied **as text** from the old lesson (jawwid-lessons @ c231532, never built or run), byte-for-byte or as exact pieces joined.
- The Quran appears only as positions in the verified Tanzil text.
- Each file is **pending**: the lesson shows nothing from it until a Teachers department reviewer approves it, and a flagged line is never shown.

## Numbering

| Surah | Ayat | Finding |
|---|---|---|
| 99 Az-Zalzalah | 8 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 100 Al-'Adiyat | 11 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 101 Al-Qari'ah | 11 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 102 At-Takathur | 8 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 103 Al-'Asr | 3 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 104 Al-Humazah | 9 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 105 Al-Fil | 5 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 106 Quraysh | 4 | Matches the verified text: each old entry is exactly one real ayah, all present |

None of the eight has Al-Buruj's split-and-stop numbering.

**Al-Qari'ah's old audio was wrong, but its text numbering was not.** The audio pointed at global ayah ids 5765–5775, which are Abasa 80:7–17; 101:1–11 are 6158–6168. The audio is dropped in every rebuilt lesson.

**Matching aids**, used for alignment only and never stored:

- 104: adraka and al-af'idah (Uthmani spellings of the long a and the hamza seat)
- 102: alhakum and latus'alunna (alif maqsura + dagger alif; a standalone hamza)
- 101: adraka (alif maqsura + dagger alif)
- 106: ilafihim (the old full ya where Uthmani has a small ya)
- 100: the old cards drop the prefix the verse word carries (wa-, fa-, la-)
- 99: wa- on akhrajat

**Checker change.** Al-Qari'ah's first ayah is the single word «القارعة», which is also the surah's name. The typed-Quran check ("a whole shorter ayah in prose") therefore refused every line that named the surah. The rule now skips **one-word** ayat: a single word in prose cannot be told from the surah's name. Runs of four words and whole ayat of two or three words are still refused. A selftest case covers it.

**The old Tajweed was wrong in places**, which is one more reason it is dropped:

- At-Takathur: «سوف تعلمون» and «عين اليقين» called idgham; a qaf with a fatha called qalqalah.
- Al-Qari'ah: «القارعة» given as both natural madd and madd lazim; «من ثقلت» called idgham where it is ikhfa'.

## 99 Az-Zalzalah: 7 held

| Where | Old text | Why it is held |
|---|---|---|
| Word meaning, 3:3 | ماذا يحدث لها؟ | PHRASE: the old entry is the two words "ma laha" (3:3-4); the engine shows one word, so this points at ma (3:3) and the meaning covers both. Teacher to confirm it reads right. |
| Quiz q5 | ما الآية التي تلي | CHANGED: the old question typed the whole of ayah 1 into its text; it now shows ayah 1's last word (zilzalaha) after "ma al-ayah allati tali". Teacher to confirm it reads well. |
| Quiz q6 | ما معنى | PHRASE: the old question asks about the two words "tuhaddithu akhbaraha" (4:2-3); the engine shows one word, so it points at tuhaddithu (4:2) and the options mean both. Teacher to confirm it reads right. |
| Quiz q8 | أكمل الآية | CHANGED: the old answer "liyuraw a'malahum" (6:5-6) and the distractor "awha laha" (5:3-4) were two-word phrases; it now asks only for the next word, liyuraw (6:5), and that distractor is awha (5:3). The other two (zilzalaha 1:4, akhbaraha 4:3) are unchanged. |
| Lesson | الصلاة والعبادة: الصلاة من أعظم الأعمال الخيرة التي نقدمها | True, and prayer is a good deed (ayah 7), but the surah does not speak of prayer or worship. Teacher to keep or drop. |
| Did you know | هل تعلم أن كلمة 'ذرة' تعني شيئًا صغيرًا جدًا لا يُرى بالعين؟ | Says a dharra is "too small to be seen by the eye". Common tafsir: the smallest ant, or a speck of dust seen in a sunbeam; "atom" is a modern reading. The lesson's own word meaning ("something very, very small") is safe. Teacher to confirm the wording. |
| Did you know | هل تعلم أن سورة الزلزلة سورة مدنية؟ | Whether Az-Zalzalah is Madani or Makki is disputed: the Madinah mushaf heads it Madani (reported from Ibn Abbas and Qatada), but others (Ibn Mas'ud, Jabir, Ata) hold it is Makki, and its theme (the Hour and the reckoning) is that of the Makki surahs. Teacher to decide whether to keep this. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the six Tajweed rules, the two Tajweed games and the two Tajweed quiz questions (Tajweed comes only from the reviewed dataset), the audio URLs and the reciter line, and every hand-typed Quran string (replaced by positions). Also dropped: the intro card's hadith (of Abu Hurayra on "akhbaraha"), which has no field here and quotes ayah 4 in full. The complete-the-ayah words are the answers of the old completion and missing-word games; their hand-typed distractors that are not words of this surah (jabal, ard, najm and akhraja; and qala and akhrajat, typed without the wa- the verse words carry) are gone, as the game draws its options from these words. The quiz question "which ayah follows ..." typed ayah 1 into its text; it now shows ayah 1's last word. The old quiz categories were mapped (hifz, ma'ani, and "fahm" to lessons). Emoji were stripped from the ends of the tafsir lines and the lesson titles, and from the start of the reflection questions. Each lesson learned is its old title and description joined with ": ". The reflection question is the old two reflection questions joined with a space; its ideas are the second question's answer line, then the lessons' five "how do we apply it" lines. Not carried (no field or no such game in the engine): the "Madani" surah type, the ayah-ordering, memory (start-end matching) and build-the-ayah games, the word-meaning games, the intro quiz, the reflection's hint and closing lines, and the quiz's difficulty levels.

</details>

## 100 Al-'Adiyat: 4 held

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, ayah 10 | الله يعلم كل ما في قلوب الناس من خير وشر | Gives "wa-hussila ma fi al-sudur" as "Allah knows all that is in people's hearts". Common tafsir: what was hidden in the breasts is brought out and made plain (Ibn Abbas: brought out and exposed), on the Day of Resurrection. Allah's knowledge is ayah 11. Teacher to choose the wording. |
| Word meaning, 10:4 | القلوب | Gives sudur as "hearts"; the word means chests (common tafsir: the breasts, where the hearts are). Teacher to confirm the wording. |
| Quiz q8 | ما معنى | PHRASE: the old question asks about the typed phrase "bu'thira ma fi al-qubur" (9:4-7, four words of the ayah); the engine shows one word, so it points at bu'thira (9:4) and the options mean the whole phrase. Teacher to confirm it reads right. |
| Lesson | عمل الخير دائماً: يجب أن نعمل الخير ونساعد الناس لأن الله يحب من يفعل الخير | A good lesson, but not one this surah teaches: the surah blames man's ingratitude and his love of "al-khayr", which in ayah 8 is wealth (common tafsir), not doing good. Teacher to keep or drop. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the four Tajweed rules and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the audio URLs and the reciter line, and every hand-typed Quran string (replaced by positions). The quiz question on the meaning of "bu'thira ma fi al-qubur" typed four words of ayah 9 into its text; it now points at bu'thira (9:4). The completion game's answers are the complete-the-ayah words; its distractors were all words of this surah, and the game draws its own. The old quiz's last question (the lesson of the surah) was filed under "ma'ani"; it is categorised "lessons" here. Each lesson learned is its old title and description joined with ": ". Emoji were stripped from the ends of the did-you-know lines. Not carried (no field or no such game in the engine): the "Makki" surah type, the ayah-ordering, choose-the-ayah and build-the-ayah games, the four word-meaning games, the intro quiz, the "simple examples" list under the lessons, the reflection's feedback lines, and the extra did-you-know line about horses (a repeat of the third).

</details>

## 101 Al-Qari'ah: 7 held

| Where | Old text | Why it is held |
|---|---|---|
| Word meaning, 4:4 | الفراشات الصغيرة | The old card was "al-farash" alone; the verse word at 4:4 is "ka-al-farash" (with ka-, "like"), so the meaning covers only part of the word shown. Teacher to confirm the card. Common tafsir gives al-farash as moths, the small creatures that fly scattered (al-Farra': young locusts); "small butterflies" is a simplification. |
| Word meaning, 5:3 | الصوف الملوّن | The old card was "al-'ihn" alone; the verse word at 5:3 is "ka-al-'ihn" (with ka-, "like"), so the meaning covers only part of the word shown. Teacher to confirm the card. |
| Quiz q4 | ما الآية التي بعد | CHANGED: the old question typed the whole of ayah 1 (al-qari'ah) into its text; it now shows that word (1:1) after "ma al-ayah allati ba'd". The same word also ends ayat 2 and 3, so a child may read it as ayah 2 (whose next ayah is 3, an option here). Teacher to confirm it reads well. |
| Quiz q6 | ما معنى | PHRASE: the old question asks about the two words "al-farash al-mabthuth" (4:4-5); the engine shows one word, so it points at ka-l-farash (4:4), which also carries ka- ("like"). Teacher to confirm it reads right. |
| Quiz q7 | ما معنى | PHRASE: the old question asks about the two words "al-'ihn al-manfush" (5:3-4); the engine shows one word, so it points at ka-l-'ihn (5:3), which also carries ka- ("like"). Teacher to confirm it reads right. |
| Lesson | نصلي ونقرأ القرآن: الصلاة وقراءة القرآن من أحب الأعمال إلى الله! | A good lesson, but not one this surah teaches (unlike the others, it is not tied to the weighing of deeds). Teacher to keep or drop. |
| Lesson | نشكر الله على نعمه: الله أعطانا نعمًا كثيرة، يجب أن نشكره عليها! | A good lesson, but not one this surah teaches (unlike the others, it is not tied to the weighing of deeds). Teacher to keep or drop. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the six Tajweed rules, the Tajweed games and the three Tajweed quiz questions (Tajweed comes only from the reviewed dataset; the old Tajweed was also wrong in places: al-qari'ah was given both as natural madd and as madd lazim of six counts, and "man thaqulat" as idgham with ghunnah, where nun before tha is ikhfa'), the audio URLs (which pointed at the wrong ayat, in Abasa) and the reciter line, the typed basmala, and every hand-typed Quran string (replaced by positions). The complete-the-ayah words are the answers of the old "complete the ayah" (al-mabthuth) and "missing word" (al-manfush) games; those give only two words, so the third is hamiyah (11:2), which both games offered as a distractor typed with al- (al-hamiyah, not a word of this surah). The quiz kept its old categories (hifz, meanings, lessons); its one "information" question (the ayah count) was assigned hifz. Each lesson learned is its old title and description joined; the lessons' "how do we apply it" lines are the reflection's ideas, under the old two reflection questions joined. Emoji were stripped from the ends of lines. Not carried (no field or no such game in the engine): the "Makki" surah type and the intro card's greeting line, the ayah-ordering and memory games, the word-meaning games (generated from the word list), and the intro quiz (surah name, ayah count, Makki).

</details>

## 102 At-Takathur: 4 held

| Where | Old text | Why it is held |
|---|---|---|
| Word meaning, 2:2 | متم ودُفنتم: يعني انتهت حياتكم في الدنيا | PHRASE: the old entry is the two words "zurtumu al-maqabir" (2:2-3); the engine shows one word, so this points at zurtum (2:2) and the meaning ("you died and were buried") covers both. Teacher to confirm it reads right. |
| Lesson | تذكر الله دائمًا: نتذكر الله في كل وقت ونصلي ونقرأ القرآن. قبل النوم، اقرأ سورة التكاثر وادعُ الله. | The example tells the child to recite At-Takathur before sleeping. There is no established sunnah of reciting this surah at bedtime (the known bedtime surahs are others, e.g. Al-Kafirun, Al-Ikhlas and the Mu'awwidhatan), so a child may take it as one. Teacher to confirm or reword the example. |
| Did you know | هل تعلم أن شكر الله يجعل النعم تزيد؟ | CUT: the old line went on "qala Allahu ta'ala: la-in shakartum la-azidannakum", which is Ibrahim 14:7 typed in full, not an ayah of this surah. The Quran never goes in prose, so the line stops before the quote. Teacher to keep it as is or add the ayah as a reference. |
| Did you know | هل تعلم أن سورة التكاثر نزلت في مكة المكرمة؟ | Makki is the majority view, but it is disputed: some scholars hold At-Takathur is Madani (reports link it to two Ansari clans boasting of their numbers, and Ubayy ibn Ka'b's report of when it was revealed is read as Madani). Teacher to decide whether to keep this. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the four Tajweed rules and the two Tajweed quiz questions (Tajweed comes only from the reviewed dataset; the old Tajweed was also wrong in places: "sawfa ta'lamun" and "'ayna al-yaqin" were given as idgham, and the qaf of al-maqabir, which carries a fatha, as qalqalah; one Tajweed option, al-qamar, was typed Quran not of this surah), the audio URLs and the reciter line, the Quran quote at the end of the second did-you-know line (Ibrahim 14:7, typed), and every hand-typed Quran string (replaced by positions). The complete-the-ayah words are the answers of the old "complete the ayah" game. The old quiz had no categories; they were assigned here. The "choose the meaning" game is carried into the quiz (q7-q8), with its screen's prompt "ma ma'na kalimah" as the question; its alhakum and an-na'im questions repeat the final test's (q6, q2) and are skipped. Each word meaning is the old card's meaning and its simple explanation joined with ": "; al-yaqin, which occurs twice, is placed at 5:5 ('ilm al-yaqin). Each lesson learned is its old title, description and example joined. The reflection's ideas are its old examples. Emoji were stripped from the ends of lines. Not carried (no field or no such game in the engine): the "Makki" surah type, the ayah-ordering and choose-the-ayah games, the word-to-meaning matching game, the intro quiz (surah name, ayah count), the reflection's lead-in line, the encouragements and the closing line of the final test.

</details>

## 103 Al-'Asr: 7 held

| Where | Old text | Why it is held |
|---|---|---|
| Quiz q3 | ما أول كلمة في سورة العصر؟ | CHANGED: the old distractors "bism" and "qul" were hand-typed Quran not of this surah; they are now illa (3:1) and amanu (3:3), words of this surah. The answer (wal-'asr, 1:1) and the fourth option (inna, 2:1) are unchanged. |
| Quiz q5 | ما معنى | PHRASE: the old question asks about "tawasaw bi-l-haqq" (3:6-7); the engine shows one word, so it points at tawasaw (3:6) and the right option carries "with the truth" as "bi-l-sidq" (truthfulness), a narrow reading of al-haqq (common tafsir: faith, the Quran, obeying Allah). Teacher to confirm. |
| Quiz q6 | من الذين ليسوا في خسارة حسب السورة؟ | CHANGED: the right option was "alladhina amanu wa-'amilu al-salihat", four words of ayah 3 typed as text. It now shows ayah 3 itself (which also names those who urge one another to truth and patience); the three wrong options are the old prose. Teacher to confirm a whole-ayah option among prose options reads well. |
| Quiz q7 | أكمل الآية | CHANGED: the old question typed ayah 3 up to the gap (now a prompt of its first eight words), and its distractors (bi-l-khayr, bi-l-'ilm, bi-l-hubb) were hand-typed, not of this surah; they are now bi-l-haqq (3:7), al-salihat (3:5) and khusr (2:4). The answer (bi-l-sabr, 3:9) is unchanged. |
| Lesson | الصدق: نقول الحق دائماً ولا نكذب أبداً. | Truthful speech is part of al-haqq, but the surah's "tawasaw bi-l-haqq" is urging one another to the truth (common tafsir: faith, the Quran, obeying Allah), which the lesson on advice (al-nasiha) carries. Teacher to keep or reword. |
| Did you know | قال الإمام الشافعي: لو تدبر الناس هذه السورة لكفتهم! | Ibn Kathir reports al-Shafi'i as saying "law tadabbara al-nasu hadhihi al-surata la-wasi'athum" (it would be enough for them); the "la-kafathum" wording belongs to another report of his words ("had Allah sent down no proof to His creation but this surah, it would have sufficed them"). Teacher to choose the wording. |
| Did you know | سورة العصر مكية نزلت في مكة المكرمة | Makki is the majority view (Ibn Abbas, Ibn al-Zubayr), but Mujahid, Qatada and Muqatil count Al-'Asr Madani. Teacher to confirm or drop. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the five Tajweed rules, the two Tajweed games and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the audio URLs and the reciter line, the typed basmala, and every hand-typed Quran string (replaced by positions). The complete-the-ayah words are the answers of the old "complete the ayah" and "missing word" games; wal-'asr (1:1) is left out because ayah 1 is that one word, so the game would show only a gap, and the games' hand-typed distractors (none of them words of this surah) are gone: the game draws its options from these words. Wa-tawasaw occurs twice in ayah 3 (3:6, 3:8); its meaning card points at the first. The old quiz had difficulty levels (easy, medium, hard), not categories; the categories were assigned by question type. Each lesson learned is its old title and description joined with ": ". The reflection is the old prompt's question, with the "how we apply these lessons" tips as its ideas. Emoji were stripped from the start and end of lines. Not carried (no field or no such game in the engine): the "Makki" type; the intro card's report that the Companions did not part until they had recited this surah (the old line credits it to al-Shafi'i, but it is the report of Abu Madinah al-Darimi in al-Tabarani's al-Awsat and al-Bayhaqi's Shu'ab; a teacher may add it, correctly attributed); the ayah-ordering and build-the-ayah games; the three word-meaning games (same words and meanings as the list); the intro quiz (surah name, ayah count); and the reflection's lead-in line, its second question and its four short answers.

</details>

## 104 Al-Humazah: 10 held

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, ayah 4 | لا! سيُلقى في نار شديدة تسمى الحُطَمة. هذا عقاب من لا يطيع الله. | Ends "this is the punishment of whoever does not obey Allah". The ayah threatens the man of ayat 1-3 (the slanderer who hoards wealth and thinks it makes him immortal); as written a child may take it that every disobedience leads to al-Hutamah. Teacher to reword. |
| Word meaning, 1:3 | الذي يعيب الناس بالإشارة | One view (Mujahid, Ibn Zayd): humazah faults people by gesture (hand, eye), lumazah by the tongue. Others reverse it, or say both are the backbiter and slanderer (Ibn Abbas: humazah lumazah, the one who goes about backbiting and defaming). Teacher to choose the wording. |
| Word meaning, 1:4 | الذي يعيب الناس بالكلام | One view (Mujahid, Ibn Zayd): humazah faults people by gesture (hand, eye), lumazah by the tongue. Others reverse it, or say both are the backbiter and slanderer (Ibn Abbas: humazah lumazah, the one who goes about backbiting and defaming). Teacher to choose the wording. |
| Quiz q4 | ما أول كلمة في سورة الهمزة؟ | CHANGED: the old distractors "qul" and "bismi" were hand-typed Quran not of this surah; they are now the first words of ayat 3 and 4 (yahsabu, kalla). The answer (waylun, 1:1) and the fourth option (alladhi, 2:1) are unchanged. |
| Quiz q10 | أكمل الآية | CHANGED: the old distractors were invented words (umazah, humazah with ha, rumazah), not Quran; they are now mumaddadah (9:3), al-hutamah (4:4) and mu'sadah (8:3), words of this surah. The answer (lumazah, 1:4) is unchanged. |
| Quiz q11 | أكمل | CHANGED: the old distractors (a'tahu, afrahahu, akramahu) were hand-typed, not of this surah; they are now 'addadahu (2:4), adraka (5:2) and jama'a (2:2), words of this surah. The answer (akhladahu, 3:4) is unchanged. |
| Lesson | نشكر الله: نشكر الله على كل النعم ولا نتكبر | Gratitude is not a theme of this surah; the "do not be arrogant" half fits (the man who trusts his wealth). Teacher to keep, reword or drop. |
| Lesson | نطيع الله: نسمع كلام الله ورسوله ونبتعد عما نهانا عنه | A good lesson (obey Allah and His Messenger), but not one this surah teaches. Teacher to keep or drop. |
| Did you know | الهُمَزة هو الذي يعيب الناس بالإشارة واللُّمَزة بالكلام | One view (Mujahid, Ibn Zayd): humazah faults people by gesture (hand, eye), lumazah by the tongue. Others reverse it, or say both are the backbiter and slanderer (Ibn Abbas: humazah lumazah, the one who goes about backbiting and defaming). Teacher to choose the wording. |
| Did you know | من يحفظ القرآن يكون من أهل الله وخاصته | The hadith (Ahmad, Ibn Majah, from Anas) says "ahl al-Quran are the people of Allah and His elect"; the scholars explain ahl al-Quran as those who memorise it AND act by it, not memorising alone. Teacher to confirm the wording. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the five Tajweed rules, the two Tajweed games and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the audio URLs and the reciter line, and every hand-typed Quran string (replaced by positions). The complete-the-ayah words are the answers of the old "complete the ayah" and "missing word" games; the two-word answers (humazatin lumazah, malan wa-'addadah) became their last word, and the games' hand-typed distractors (none of them words of this surah) are gone: the game draws its options from these words. Two old spellings needed a matching-only aid, never stored: adraka (5:2, Uthmani adraka with alif maqsura and dagger alif) and al-af'idah (7:4, Uthmani writes its hamza without the ya seat). One word meaning ('addadahu) was typed without the "wa-" the verse word carries; it points at the whole verse word (2:4). The old quiz had difficulty levels (easy, medium, hard), not categories; the categories were assigned by question type. Each lesson learned is its old title and description joined with ": ". The reflection is the old prompt's question, with the "how we apply these lessons" tips as its ideas. Not carried (no field or no such game in the engine): the "Makki" type, the "why it was revealed" line, the ayah-ordering, start-end memory and choose-the-ayah games, the three word-meaning games (same words and meanings as the list), the intro quiz (surah name, ayah count), the reflection's lead-in line, its three "will you ..." prompts and its closing du'a.

</details>

## 105 Al-Fil: 4 held

| Where | Old text | Why it is held |
|---|---|---|
| Word meaning, 5:2 | ورق شجر يابس مأكول | PHRASE: the old entry is the two words "'asfin ma'kul" (5:2-3, typed without the ka- of ka-'asfin); the engine shows one word, so this points at ka-'asfin (5:2) and the meaning covers both. Teacher to confirm it reads right. |
| Quiz q6 | ما معنى | PHRASE: the old question asks about "'asfin ma'kul" (5:2-3), typed into the question without the ka- of ka-'asfin; the engine shows one word, so it points at ka-'asfin (5:2). Teacher to confirm it reads right. |
| Quiz q7 | ماذا أرسل الله على أصحاب الفيل؟ | CHANGED: the old answer "tayran ababil" was this surah's 3:3-4, typed into an option; it now shows the verse word tayran (3:3). Teacher to confirm one word reads as the answer. |
| Lesson | الله ينصر الحق: الله دائماً ينصر الحق ويهزم الباطل، فلا نخاف أبداً! | Broader than this surah: it shows Allah protecting His House from Abraha's army, not a contest between the people of truth and falsehood (Quraysh had left Makkah and did not fight). "Allah always gives victory to the truth, so we never fear" may read to a child as a promise of victory in every worldly event. Teacher to keep or reword. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the four Tajweed rules and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the audio URLs and the reciter line, and every hand-typed Quran string (replaced by positions). The complete-the-ayah words are the answers of the old "complete the ayah" game; its hand-typed distractors (an-nas, al-falaq, al-kawthar, and made-up rhymes such as tanzil, jamil, majhul) are gone: the game draws its options from this surah's words. The "choose the right word" game's two-word answers end in the same words, so they add none. The old quiz categories were mapped memorization -> hifz and meaning -> meanings, except "what do we learn from Surat al-Fil?" (q8), moved to lessons. Each lesson learned is its old title and description joined with ": ". The reflection is the old question with its right answer and the line shown after it as the ideas (its three wrong options are not carried). Emoji were stripped from the ends of lines. Not carried (no field or no such game in the engine): the intro facts (ayah count, "Makki"), the intro quiz, the ayah-ordering, choose-the-word and build-the-ayah games, and the word-meaning match/choose/drag games (same words and meanings as the list and quiz). Matching aid, for alignment only and never stored: the word meaning 'asfin ma'kul was typed without the ka- the verse word carries, so it points at the whole verse word ka-'asfin (5:2).

</details>

## 106 Quraysh: 10 held

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, ayah 1 | لأن الله جعل قريشاً يعتادون ويألفون شيئاً جميلاً... | The line trails off ("... something beautiful...") and leaves ayah 2 to say what Quraysh were accustomed to. Common tafsir: li-ilaf is "for the accustoming / security of Quraysh", tied either to Al-Fil (Allah repelled the army for the sake of Quraysh's ilaf) or to "let them worship" in ayah 3. Teacher to confirm the line reads as a whole for a child. |
| Word meaning, 3:1 | فليطيعوا ويشكروا | Gives "let them obey and give thanks". The word means "let them worship"; common tafsir: let them single out the Lord of this House in worship (in thanks for the two journeys). The lesson's own tafsir of ayah 3 says "let them thank Allah and worship Him alone". Teacher to align the wording. |
| Word meaning, 3:4 | الكعبة المشرفة | PHRASE: the old entry is the two words "hadha al-bayt" (3:3-4); the engine shows one word, so this points at al-bayt (3:4) and the meaning covers both. Teacher to confirm it reads right. |
| Quiz q5 | ما معنى | PHRASE: the old question asks about "at'amahum min ju'" (4:2-4), typed into the question; the engine shows one word, so it points at at'amahum (4:2) and the options still give the meaning of the phrase. Teacher to confirm it reads right. |
| Quiz q6 | ما المقصود بـ | PHRASE: the old question asks about "hadha al-bayt" (3:3-4), typed into the question; the engine shows one word, so it points at al-bayt (3:4). Teacher to confirm it reads right. |
| Quiz q7 | أكمل الآية | CHANGED: the old distractors "al-nas" and "al-'arab" were hand-typed, not words of this surah; they are now al-bayt (3:4) and ju' (4:4). The answer (quraysh, 1:2) is unchanged. |
| Quiz q8 | أكمل | CHANGED: the old options were three-word phrases: the answer "wa-amanahum min khawf" and two made-up endings ("razaqahum min faqr", "hadahum min dalal"), not of this surah. It now shows four words and asks for the next word, wa-amanahum (4:5, the old prompt's dangling "wa-" moves with it); the distractors fal-ya'budu (3:1) and ilafihim (2:1) are words of this surah. |
| Quiz q11 | أكمل | CHANGED: the old options were two-word phrases; the answer "al-shita'i wa-l-sayf" and two hand-typed distractors ("al-layli wa-l-nahar", "al-barri wa-l-bahr") not of this surah. It now asks for the next word, al-shita' (2:3); the distractors al-bayt (3:4) and khawf (4:7) are words of this surah. |
| Quiz q12 | أكمل | CHANGED: the old options were "hadha" plus a word ("hadha al-masjid", "hadha al-bayt", "hadha al-kitab"); al-masjid and al-kitab are hand-typed, not words of this surah. The prompt now shows three words, up to "hadha", and asks for al-bayt (3:4); the distractors al-sayf (2:4) and quraysh (1:2) are words of this surah. |
| Lesson | مساعدة المحتاجين: كما أطعم الله قريشاً من جوع، علينا أن نساعد من يحتاج الطعام. | Helping the needy is a good lesson, but the surah does not teach it: it reminds Quraysh that Allah fed them and made them safe, so they should worship Him. This lesson draws it by analogy. Teacher to keep or drop. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the five Tajweed rules, the two Tajweed quiz questions and the two Tajweed games (Tajweed comes only from the reviewed dataset), the audio URLs and the reciter line, the typed basmala and whole surah on the intro card, and every hand-typed Quran string (replaced by positions). The old quiz had difficulty levels (easy, medium, hard), not categories; the categories were assigned by question type. The four questions of the "listen and choose" game are carried into the quiz (q9-q12). The complete-the-ayah words are the answers of the four completion questions (two in the final quiz, two in the listen and choose game); the two-word answers became their last word. The old "complete the ayah" game hid a random word, so it has no fixed answers to carry. Each lesson learned is its old title and description joined with ": "; the lessons' "how we apply it" lines are the reflection's ideas, under the old second reflection question (the first and third questions and the "think about it with your parents" line are not carried). Not carried (no field or no such game in the engine): the intro facts (ayah count, "Makki") and the "story of the surah" paragraph, the intro quiz, the ayah-ordering and memory games, the word-to-meaning matching games and the meaning multiple-choice games (same words and meanings as the list and quiz). Matching aids, for alignment only and never stored: the old text writes ilafihim (2:1) with a full ya where the Uthmani text has a small ya; the word meaning al-sayf was typed without the wa- the verse word carries, so it points at the whole verse word (2:4).

</details>


53 lines held across the eight surahs. Nothing in these files is shown until the Teachers department signs each one off.
