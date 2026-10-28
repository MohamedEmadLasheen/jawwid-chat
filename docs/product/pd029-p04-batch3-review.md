# PD-29 P0-4, Juz' Amma batch 3 (89–98): lines held for teacher review

The fourth set of lessons rebuilt on the engine, after Al-Buruj, batch 1 (`pd029-p04-batch1-review.md`) and batch 2 (`pd029-p04-batch2-review.md`). The method and rules are the same.

- Each lesson's prose was copied **as text** from the old lesson (jawwid-lessons @ c231532, never built or run), byte-for-byte or as exact pieces joined.
- The Quran appears only as positions in the verified Tanzil text.
- Each file is **pending**: the lesson shows nothing from it until a Teachers department reviewer approves it, and a flagged line is never shown.

97 lines are held across the ten surahs. Juz' Amma still has ten surahs to do after this batch: 78–84 and 86–88.

## Numbering

| Surah | Ayat | Finding |
|---|---|---|
| 98 Al-Bayyinah | 8 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 97 Al-Qadr | 5 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 96 Al-'Alaq | 19 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 95 At-Tin | 8 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 94 Ash-Sharh | 8 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 93 Ad-Duha | 11 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 92 Al-Layl | 21 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 91 Ash-Shams | 15 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 90 Al-Balad | 20 | Matches the verified text: each old entry is exactly one real ayah, all present |
| 89 Al-Fajr | 30 | **Real ayah 23 is SPLIT across old entries 23–24**: 31 entries for 30 ayat, so every entry after it was one ayah too high |

**Al-Fajr is split, but not stopped.** Al-Buruj split ayat and then stopped early. Al-Fajr splits one ayah and still reaches the end:

- old 1–22 → real 1–22;
- old 23 + 24 → real 23, with the two tafsir lines joined and held MERGED;
- old 25–31 → real 24–30, with the tafsir held RENUMBERED. The text of those lines is unchanged; a teacher should confirm each one now sits on the right ayah.

The quiz's "last ayah" question pointed at old entries 31, 29 and 1. These are now real 30, 28 and 1, so its answer is unchanged; it is held RENUMBERED. The old per-ayah audio played the wrong ayah from entry 24 on; it is dropped anyway. The old file's own code comment blames ayah 30/31 for the extra entry, which is wrong.

**Matching aids**, used for alignment only and never stored:

- 98: yatlu, al-salah and al-zakah (Uthmani waw spellings); wa- on al-mushrikin
- 97: adraka (alif maqsura + dagger alif); wa- on al-ruh
- 96: the prefix the verse word carries (bi-, la-, wa-) on al-qalam, al-nasiyah, yatgha and usjud
- 95: wa- on al-tin and al-zaytun; bi- on al-din and ahkam
- 93: al-layl with two lams (Uthmani writes one), needed to align; dagger alif in al-duha and saja
- 92, 91: alif maqsura + dagger alif; al-layl with two lams; dropped prefixes (bi-, wa-)
- 90: adraka and al-mash'amah
- 89: al-layl with two lams; ibtalahu with a plain alif; wa-ji'a without the Uthmani extra alif; the vocative ya written apart in ya-laytani and ya-ayyatuha
- 94: none

**G-20.** Two lines hold a protected staff name **inside an ordinary word**: «ووالدينا» (91, a lesson) and «يهدينا» (98, a lesson). Only those characters are written as JSON `\u` escapes, and the decoded text is asserted unchanged.

**Two more lines held at review**, beyond what extraction flagged:

- At-Tin's tafsir 1 and one did-you-know line call the fig and the olive both "blessed fruits". The Quran calls only the olive tree blessed (24:35).
- Al-Qadr q2 has the right option «الملائكة والروح», two words of ayah 4 typed by hand. It is under the checker's limit, but it is typed Quran.

**Lines dropped because they quoted the Quran:**

- 94: three lines that quote «مع العسر يسرًا» mid-sentence. Cutting before the quote leaves no sentence.
- 97: the quiz question that types part of ayah 3, one did-you-know line that types ayah 3 whole, and one reflection idea.
- 98: the Anas/Ubayy hadith and the other-name line, both of which type ayah 1.

Teachers may want 94's lines back, reworded.

**The old Tajweed was wrong in places**, which is one more reason it is dropped:

- 96: al-akramu called madd lazim; inna ila called izhar.
- 95: «أجر غير» called idgham; it is izhar. Its example «من أحسن» is not in this surah.
- 92: «من بخل» called ikhfa'; it is iqlab.
- 91: «من زكاها» and «من دساها» called idgham; they are ikhfa'. «انبعث» called izhar; it is iqlab. «والشمس» called madd lazim.

**Left unflagged, for a teacher to glance at:**

- 92's Makki line: the majority view, with a minority Madani view tied to the Abu al-Dahdah report.
- 92's and 93's smile-is-charity hadith (al-Tirmidhi). 93's copy is held as off-topic.
- 91: "the sun is over a million times the Earth", which is true by volume.

**Read beyond the components.** Al-Fajr's reflection question and model answer exist only in the old `pages/Index.tsx`, which was read as text and is in provenance.

## 98 Al-Bayyinah: 22 held

| Where | Old text | Why it is held |
|---|---|---|
| Intro | سورة البينة نزلت في المدينة المنورة، وعدد آياتها 8 آيات. تتحدث عن أهمية الإيمان بالله وعبادته وحده، وأن القرآن الكريم هو الدليل الواضح من الله. | Whether Al-Bayyinah is Madani or Makki is disputed: the Madinah mushaf heads it Madani (the view of the majority, and its address to the People of the Book fits Madinah), but others (a report from Ibn Abbas, and Yahya ibn Sallam) hold it is Makki. Teacher to decide whether to keep this. Also: it says the clear proof (al-bayyinah) is the Quran; ayah 2 names it "a Messenger from Allah reciting purified pages", and common tafsir takes al-bayyinah to be the Prophet (with the Quran he recites). Teacher to choose the wording. |
| Tafsir, ayah 1 | الذين لم يؤمنوا بالله | CUT: the old line went on "min ahl al-kitab wa-al-mushrikin" (four words of ayah 1 typed) and then "were waiting for a clear proof from Allah to come to them"; the Quran never goes in prose, so the text stops before the quote and is now only "those who did not believe in Allah". Also doubtful: common tafsir (al-Tabari, Ibn Kathir) is that the disbelievers among the People of the Book and the polytheists were not going to leave their disbelief until the clear proof (the Messenger, ayah 2) came to them; "they were waiting for it" is a minority reading. Teacher to write the line. |
| Tafsir, ayah 6 | الذين رفضوا الإيمان بالله سيُعاقَبون يوم القيامة لأنهم اختاروا الطريق الخطأ | Softens the ayah: it says only that those who refused to believe "will be punished on the Day of Resurrection because they chose the wrong path". The ayah names the disbelievers among the People of the Book and the polytheists, says they abide in the fire of Jahannam forever, and calls them the worst of creation. Teacher to decide whether the softening is acceptable for children. |
| Word meaning, 1:1 | لم يكونوا | PHRASE: the old card is the 2-word phrase at 1:1-2; the engine shows one word, so it points at the first word (1:1) and the meaning covers the whole phrase. Teacher to confirm it reads right. |
| Word meaning, 1:6 | اليهود والنصارى | PHRASE: the old card is the 2-word phrase at 1:6-7; the engine shows one word, so it points at the first word (1:6) and the meaning covers the whole phrase. Teacher to confirm it reads right. |
| Word meaning, 5:4 | ليطيعوا الله | Gives li-ya'budu as "to obey Allah". The word means "to worship" (common tafsir: to worship Allah alone); obedience is part of worship but narrower. Teacher to choose the wording. |
| Word meaning, 5:11 | الصلوات الخمس | Gives al-salah as "the five daily prayers". The ayah is about what the People of the Book were commanded; common tafsir reads it as establishing prayer, not specifically the five prayers of this ummah. Teacher to choose the wording. |
| Word meaning, 5:15 | الدين الصحيح المستقيم | PHRASE: the old card is the 2-word phrase at 5:15-16; the engine shows one word, so it points at the first word (5:15) and the meaning covers the whole phrase. Teacher to confirm it reads right. |
| Word meaning, 6:9 | النار يوم القيامة | PHRASE: the old card is the 2-word phrase at 6:9-10; the engine shows one word, so it points at the first word (6:9) and the meaning covers the whole phrase. Teacher to confirm it reads right. |
| Word meaning, 6:15 | أسوأ المخلوقات | PHRASE: the old card is the 2-word phrase at 6:15-16; the engine shows one word, so it points at the first word (6:15) and the meaning covers the whole phrase. Teacher to confirm it reads right. |
| Word meaning, 7:8 | أفضل المخلوقات | PHRASE: the old card is the 2-word phrase at 7:8-9; the engine shows one word, so it points at the first word (7:8) and the meaning covers the whole phrase. Teacher to confirm it reads right. |
| Word meaning, 8:4 | حدائق جميلة في الجنة | PHRASE: the old card is the 2-word phrase at 8:4-5; the engine shows one word, so it points at the first word (8:4) and the meaning covers the whole phrase. Teacher to confirm it reads right. Also: the meaning "beautiful gardens in Paradise" leaves out 'adn; common tafsir: gardens of permanent residence (everlasting abode). |
| Word meaning, 8:13 | الله سعيد بهم | PHRASE: the old card is the 3-word phrase at 8:13-15; the engine shows one word, so it points at the first word (8:13) and the meaning covers the whole phrase. Teacher to confirm it reads right. Also: "Allah is happy with them" -- common tafsir: Allah is pleased with them (rida); teacher to choose the wording. |
| Word meaning, 8:20 | خاف من الله وأطاعه | PHRASE: the old card is the 2-word phrase at 8:20-21; the engine shows one word, so it points at the first word (8:20) and the meaning covers the whole phrase. Teacher to confirm it reads right. |
| Quiz q3 | أكمل | CHANGED: the old distractors (kabirah, jamilah, qadimah) were hand-typed, not of this surah; they are replaced by qayyimah (3:3), al-bayyinah (1:12) and abadan (8:12), words of this surah. |
| Quiz q4 | أكمل | CHANGED: the old distractors ('azimah, kathirah, jadidah) were hand-typed, not of this surah; they are replaced by mutahharah (2:6), suhufan (2:5) and al-bayyinah (1:12), words of this surah. |
| Quiz q7 | ما معنى | PHRASE: the old question asks about the 2-word phrase at 7:8-9; the engine shows one word, so it points at the first word (7:8) and the options mean the whole phrase. Teacher to confirm it reads right. |
| Quiz q8 | ما معنى | PHRASE: the old question asks about the 2-word phrase at 8:4-5; the engine shows one word, so it points at the first word (8:4) and the options mean the whole phrase. Teacher to confirm it reads right. Also: the meaning "beautiful gardens in Paradise" leaves out 'adn; common tafsir: gardens of permanent residence (everlasting abode). |
| Lesson | مساعدة الفقراء: نعطي من مالنا وألعابنا للفقراء والمحتاجين. الزكاة تجعلنا أفضل! | Ties giving "from our money and our toys" to zakah (ayah 5). Zakah is the obligatory alms on wealth; giving toys to the poor is voluntary charity (sadaqah). Teacher to check the wording. |
| Did you know | قراءة القرآن كل يوم تجعلنا أقرب إلى الله | A good line, but not a fact about this surah. Teacher to keep or drop. |
| Did you know | من يحفظ القرآن يلبس تاجاً يوم القيامة | Hadith claim to verify: "whoever memorises the Quran wears a crown on the Day of Resurrection". The report of the crown of honour for the companion of the Quran is in al-Tirmidhi (2915, graded hasan); the better-known "crown" report (Abu Dawud 1453, Sahl ibn Mu'adh) gives the crown to the PARENTS of the one who reads and acts on the Quran, and is graded weak. Teacher to check the wording and source. |
| Did you know | سورة البينة نزلت في المدينة المنورة | Whether Al-Bayyinah is Madani or Makki is disputed: the Madinah mushaf heads it Madani (the view of the majority, and its address to the People of the Book fits Madinah), but others (a report from Ibn Abbas, and Yahya ibn Sallam) hold it is Makki. Teacher to decide whether to keep this. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson (which has no lib/ data file; its content lives in components/SurahData.ts and the components), then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the six Tajweed rules, the Tajweed quiz and find-the-madd games, and the two Tajweed questions of the final quiz (Tajweed comes only from the reviewed dataset); the audio URLs and the reciter line; the intro hadith of Anas (Ubayy ibn Ka'b), which has no field here and quotes the opening of ayah 1 typed, and its simple retelling (no field); the did-you-know line giving the surah's other name "lam yakun", the first two words of ayah 1 typed; and every hand-typed Quran string (replaced by positions). Cut: tafsir of ayah 1 stops before its quote of four words of ayah 1. The complete-the-ayah words are the answers of the old missing-word game; its hand-typed distractors (al-salah, a word of ayah 5; and al-jannah, qadimah, kabirah, kha'ifin, farihin, al-dunya, al-nas, not of this surah) are gone, as the game draws its options from these words. The old complete-the-ayah game's answers were multi-word endings and are not carried. Nine word cards are phrases of two or three words; each points at its first word and is held. The old quiz categories were mapped (hifz, ma'ani, and "fahm" to lessons); its difficulty levels are not carried. Each lesson learned is its old title and description joined with ": ". The reflection question is the old two reflection prompts joined with a space; the old page had no reflection ideas. Emoji were stripped from the ends of lines. Matching-only aids, never stored: yatlu (2:4, Uthmani silent alif), al-salah and al-zakah (5:11, 5:13, waw + dagger alif), and wa- on al-mushrikin (1:8, the old card drops it). Not carried (no field or no such game in the engine): the "Madani" surah type and meaning, the intro quiz (name, ayah count), the ayah-ordering, start-end memory and build-the-ayah games, the word-meaning games, the encouragement lines, and the reflection's feedback lines.

</details>

## 97 Al-Qadr: 9 held

| Where | Old text | Why it is held |
|---|---|---|
| Intro | سورة القدر تتحدث عن ليلة القدر، وهي ليلة عظيمة ومباركة نزل فيها القرآن الكريم | CUT: the old intro ended "... wa-hiya khayrun min alfi shahr" (and it is better than a thousand months), four words of ayah 3 typed. The Quran never goes in prose, so the text stops before it (and its comma). Teacher to finish the sentence. |
| Word meaning, 3:5 | ألف شهر تساوي أكثر من 83 سنة | PHRASE: the old card is the 2-word phrase at 3:5-6; the engine shows one word, so it points at the first word (3:5) and the meaning covers the whole phrase. Teacher to confirm it reads right. |
| Word meaning, 4:3 | جبريل عليه السلام، وهو أعظم الملائكة | Adds that Jibril "is the greatest of the angels". That al-ruh here is Jibril is the view of most mufassirun; which angel is greatest is a matter scholars differ on. Teacher to keep or drop the second half. |
| Word meaning, 5:4 | وقت طلوع الفجر وبداية النهار | PHRASE: the old card is the 2-word phrase at 5:4-5; the engine shows one word, so it points at the first word (5:4) and the meaning covers the whole phrase. Teacher to confirm it reads right. |
| Quiz q2 | من ينزل في ليلة القدر؟ | TYPED: the right option "al-mala'ikah wa-al-ruh" is two words of ayah 4 typed by hand. Teacher to rephrase it in prose, or the option to become a position. |
| Quiz q3 | أكمل الآية | CHANGED: the old options were two-word endings: the answer "laylat al-qadr" (1:4-5) and three hand-typed distractors not of this surah (laylat al-'id, yawm al-jumu'ah, shahr ramadan). It now asks for the next word, laylah (1:4); the distractors shahr (3:6), al-fajr (5:5) and amr (4:9) are words of this surah. |
| Quiz q4 | أكمل الآية | CHANGED: the old options were two-word endings: the answer "matla' al-fajr" (5:4-5) and three hand-typed distractors not of this surah (ghurub al-shams, nisf al-layl, waqt al-zuhr). It now asks for the next word, matla' (5:4); the distractors alf (3:5), laylah (1:4) and amr (4:9) are words of this surah. |
| Quiz q8 | أكمل | CHANGED: the old distractors (al-shams, al-nujum, al-riyah) were hand-typed, not of this surah; they are replaced by al-fajr (5:5), al-qadr (1:5) and shahr (3:6), words of this surah. The old prompt's dangling "wa-" moves into the answer word, wa-al-ruh (4:3). |
| Lesson | يجب أن نحرص على قيام ليلة القدر والدعاء فيها. | A good lesson, but not one the surah itself teaches: it praises the night; standing in prayer and making du'a in it come from the hadith (e.g. "whoever stands in prayer on Laylat al-Qadr out of faith and hope of reward", al-Bukhari and Muslim). Teacher to keep or drop. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson (content in lib/lessonData.ts and the components; lib/audioUtils.ts holds only audio code), then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the four Tajweed rules (Tajweed comes only from the reviewed dataset; the old quiz had no Tajweed question), the audio URLs and the reciter line, the typed basmala and whole-surah text on the intro card, the did-you-know line "hal ta'lam anna laylat al-qadri khayrun min alfi shahr ..." (it quotes ayah 3 whole; cut before the quote nothing is left), the quiz question "laylat al-qadri khayrun min kam shahr?" (four words of ayah 3 typed; same reason), the reflection idea "li-annaha khayrun min alfi shahr" (four words of ayah 3; same reason), and every hand-typed Quran string (replaced by positions). Cut: the intro stops before its quote of four words of ayah 3. The complete-the-ayah words are the answers of the old missing-word game; its hand-typed distractors not of this surah (katabnahu, qara'nahu, al-nujum, al-tuyur, aqallu, aktharu) are gone, as the game draws its options from these words. The old complete-the-ayah game's answers were two-word endings and are not carried. The old quiz had no categories (they were assigned here) and difficulty levels (not carried); two of its three complete-the-ayah questions had two-word answers and now ask for the next word only. Two word cards (alf shahr, matla' al-fajr) are two-word phrases; each points at its first word and is held. Emoji were stripped from the ends of the true/false options and the start of the reflection ideas. Matching-only aids, never stored: adraka (2:2, alif maqsura + dagger alif), wa- on al-ruh (4:3). Not carried (no field or no such game in the engine): the "Makki" surah type (disputed: the Madinah mushaf heads Al-Qadr Makki, but some, e.g. al-Waqidi, held it Madani), the intro quiz (name, ayah count), the ayah-ordering, start-end matching and build-the-ayah games, the three word-meaning games (they repeat the word list with shorter meanings), and the motivational lines. Head review: q2 held (typed option).

</details>

## 96 Al-'Alaq: 6 held

| Where | Old text | Why it is held |
|---|---|---|
| Intro | سورة العلق هي أول سورة نزلت من القرآن الكريم على النبي محمد ﷺ. فيها أمر الله سبحانه وتعالى بـالقراءة والتعلم | Says Al-'Alaq is "the first surah revealed". Common view (the hadith of A'ishah, al-Bukhari): its first five ayat were the first Quran revealed, in the cave of Hira; the rest of the surah (ayat 6-19, on the one who forbade the Prophet's prayer) came later. Teacher to confirm the wording. |
| Tafsir, ayah 16 | مقدمة رأسه كاذبة مليئة بالأخطاء | Renders "khati'ah" as "full of mistakes". Common tafsir: sinning, i.e. doing wrong knowingly (khati' is the one who sins deliberately, unlike mukhti', the one who errs); the forelock stands for its owner (Abu Jahl), lying in his words and sinful in his deeds. Teacher to choose the wording. |
| Quiz q1 | ما أول كلمة في سورة العلق؟ | CHANGED: two of the old options were hand-typed words not of this surah ("qul", and "bismi" as in the basmala); they are now khalaqa (2:1) and bi-ismi (1:2), words of this surah. Teacher to confirm. |
| Quiz q2 | أكمل | CHANGED: the old distractors "turab" and "ma'" are not words of this surah; they are replaced by la-yatgha (6:4) and bi-l-qalam (4:3), the distractors the old complete-the-ayah game used for this ayah. |
| Quiz q3 | أكمل | CHANGED: the old distractors "bi-l-'ilm" and "bi-l-kitab" are not words of this surah; they are replaced by al-ruj'a (8:4) and nadiyah (17:2), the distractors the old complete-the-ayah game used for this ayah. |
| Did you know | هل تعلم أن سورة العلق نزلت في غار حراء؟ | Only the first five ayat were revealed in the cave of Hira (the hadith of A'ishah, al-Bukhari); the rest of the surah came later, in Makkah. Teacher to confirm the wording. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson (which has no data file; its content lives in the components), then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. The old lesson covers all 19 ayat. Dropped: the five Tajweed rules, the Tajweed game and quiz, and the two Tajweed questions of the final quiz (Tajweed comes only from the reviewed dataset; the old Tajweed was also wrong in places: al-akramu called madd lazim "because of the hamza", inna ila called izhar), the audio URLs and the reciter line, the typed basmala, and every hand-typed Quran string (replaced by positions). The tafsir lines are the ListenSection TAFSEER array. The complete-the-ayah words are the answers of the old "complete the ayah" game (the last word of each answer phrase) and the "missing word" game. In the final quiz, the hand-typed options not of this surah were replaced by words of this surah (q1, q2, q3, each flagged CHANGED), and the two meaning questions were cut before the quoted word, which is now a position. The old quiz categories were mapped (hifz, ma'ani, and "fahm" to lessons; the ayah-count question was "fahm" and stays under lessons). The intro is the intro card's "important fact" line and its last line, their highlight markup and the label removed, joined with ". ". The reflection question's ideas are its first three answer choices; the fourth ("all the answers are right") and the closing line are not carried. Emoji were stripped from the ends of lines. Not carried (no field or no such game in the engine): the intro quiz and facts (name, ayah count), the ayah-ordering and build-the-ayah games, the two word-meaning games, and the quiz's difficulty levels.

</details>

## 95 At-Tin: 11 held

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, ayah 1 | يُقسِم الله بالتين والزيتون، وهما من الثمار المباركة | DOUBTFUL: calls the fig and the olive both "blessed fruits"; the Quran calls only the olive tree blessed (24:35). Teacher to confirm or reword. |
| Tafsir, ayah 5 | لكن من لا يطيع الله ينزل إلى أسفل الدرجات | Gives "thumma radadnahu asfala safilin" as "whoever does not obey Allah goes down to the lowest of the ranks". Common tafsir has two readings: returned to the lowest of the low in the Fire, for the one who disbelieves (Mujahid, al-Hasan), or returned to the weakness of extreme old age (Ibn Abbas, Ikrimah; preferred by al-Tabari). The old line names neither. Teacher to choose the wording. |
| Word meaning, 3:2 | مكة المكرمة، البلد الآمن | PHRASE: the old entry is the two words "al-balad al-amin" (3:2-3); the engine shows one word, so this points at al-balad (3:2) and the meaning covers both. Teacher to confirm it reads right. |
| Word meaning, 4:5 | أجمل وأحسن صورة خلقها الله | PHRASE: the old entry is the two words "ahsani taqwim" (4:5-6); the engine shows one word, so this points at ahsan (4:5) and the meaning covers both. Teacher to confirm it reads right. |
| Word meaning, 8:3 | أعدل من يحكم بين الناس، وهو الله | PHRASE: the old entry is the two words "ahkam al-hakimin" (8:3-4; the verse word is bi-ahkam); the engine shows one word, so this points at bi-ahkam (8:3) and the meaning covers both. Teacher to confirm it reads right. |
| Quiz q1 | ما أول آية في سورة التين؟ | CHANGED: two of the old options were hand-typed and not ayat of this surah (wa-l-'asr, from Al-'Asr, and the basmala); they are now ayat 3 and 8 of this surah. Teacher to confirm. |
| Quiz q3 | ما معنى | PHRASE: the old entry is the two words "al-balad al-amin" (3:2-3); the engine shows one word, so this points at al-balad (3:2) and the meaning covers both. Teacher to confirm it reads right. |
| Quiz q4 | ما معنى | PHRASE: the old entry is the two words "ahsani taqwim" (4:5-6); the engine shows one word, so this points at ahsan (4:5) and the meaning covers both. Teacher to confirm it reads right. |
| Quiz q5 | أكمل | CHANGED: the old answer "ahsani taqwim" (4:5-6) and its distractors "asfala safilin" (5:3-4), "ahkam al-hakimin" (8:3-4, typed without the bi- of the verse word) and "ghayru mamnun" (6:8-9) were two-word phrases; it now asks only for the next word: ahsan (4:5), with asfal (5:3), bi-ahkam (8:3) and ghayr (6:8). |
| Quiz q6 | ما آخر آية في سورة التين؟ | CHANGED: one old option was only the end of ayah 6 ("fa-lahum ajrun ghayru mamnun", its last four words); it now shows the whole of ayah 6. The old quiz filed this question under ma'ani; it is categorised hifz here. |
| Did you know | هل تعلم أن التين والزيتون من الثمار المباركة التي ذكرها الله في القرآن؟ | DOUBTFUL: calls the fig and the olive both "blessed fruits"; the Quran calls only the olive tree blessed (24:35). Teacher to confirm or reword. The line also says Allah mentioned them as blessed in the Quran. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson (which has no data file; its content lives in the components), then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the four Tajweed rules and the Tajweed quiz question (Tajweed comes only from the reviewed dataset; the old Tajweed was also wrong: "ajrun ghayru" called idgham with ghunnah where tanwin before ghayn is izhar, and an example "min ahsani" that is not in this surah, which reads "fi ahsani"), the audio URLs and the reciter line, the typed basmala, and every hand-typed Quran string (replaced by positions). The tafsir lines are the LearnVersesSection tafseer. The complete-the-ayah words are the answers of the old "complete the ayah" and "missing word" games. In the final quiz, the two meaning questions were cut before the quoted phrase, which is now a position on its first word (flagged PHRASE); the first-ayah, complete-the-ayah and last-ayah questions are flagged CHANGED. The old quiz categories were mapped (hifz, ma'ani); the last-ayah question was filed under ma'ani and is categorised hifz here. The intro is the intro card's three "what do we learn" lines with their highlight markup removed, joined with a space. Emoji were stripped from the ends of lines. The old reflection had no ideas (only a "think about it and talk with your family" hint, not carried). Not carried (no field or no such game in the engine): the intro quiz and facts (name, ayah count, "Makki"), the welcome age line, the ayah-ordering game, the word-meaning game, and the quiz's difficulty levels. Head review: tafsir 1 and did-you-know 3 held (fig "blessed").

</details>

## 94 Ash-Sharh: 4 held

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, ayah 1 | الله يسأل النبي ﷺ: ألم نوسع قلبك ونملأه بالنور والإيمان؟ | Presents the ayah as Allah asking the Prophet a question. Common tafsir: the question is one of affirmation (istifham taqriri), "We have indeed expanded your chest" (with guidance, faith and wisdom); a child may read it as a real question. It also gives sadr ("chest") as "heart". Teacher to choose the wording. |
| Word meaning, 1:4 | قلبك | Gives sadr as "heart"; the word means chest (common tafsir: the breast, expanded with guidance and faith, where the heart is). Teacher to confirm the wording. |
| Quiz q3 | أكمل | CHANGED: the old distractors "sabran" and "shukran" were hand-typed, not words of this surah; they are replaced by wizraka (2:3) and dhikraka (4:3), words of this surah. The answer yusra (5:4) is unchanged. |
| Quiz q6 | ما الآية التي تأتي بعد | CHANGED: the old question typed the whole of ayah 4 ("wa-rafa'na laka dhikrak") into its text; it now shows ayah 4's last word (dhikraka) after "ma al-ayah allati ta'ti ba'd". Teacher to confirm it reads well. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the four Tajweed rules and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the audio URLs, the reciter line and the typed basmala, and every hand-typed Quran string (replaced by positions). Also dropped, because each quotes "ma'a al-'usri yusran" (5:2-4) as typed Quran mid-sentence and cutting before the quote leaves no sentence: the first did-you-know line (that Allah promised it, twice in the surah), the first reflection idea ("we remember that ..."), and the reflection's feedback line. Ayat 5 and 6 are the same words but for the fa-; the word cards for al-'usr and yusra point at ayah 5, and the complete-the-ayah word al-'usr is the one at 5:3. The complete-the-ayah words are the answers of the old completion and missing-word games; their hand-typed distractors that are not words of this surah ('usran, sabran, shukran, naftah, narfa', minka, al-sabr, al-shukr, fa-sbir) are gone, as the game draws its options from these words. The quiz question "which ayah comes after ..." typed ayah 4 into its text; it now shows ayah 4's last word. The old quiz categories were mapped (hifz, ma'ani); its question on the lesson of the surah was filed under ma'ani and is categorised "lessons" here. Emoji were stripped from the ends of lines. Not carried (no field or no such game in the engine): the "Makki" surah type, the ayah-ordering and build-the-ayah games, the three word-meaning games (same words and meanings as the list), the intro quiz (surah name, ayah count) and the motivational messages.

</details>

## 93 Ad-Duha: 5 held

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, ayah 3 | الله لم يتركك يا محمد ولم يبتعد عنك، الله يحبك دائمًا | Gives "wa-ma qala" as "nor moved away from you". Common tafsir: qala is to hate (ma qala = nor has He hated you, ma abghadaka), and wadda'aka is to leave, forsake (revealed when the revelation paused and it was said his Lord had left him). "Allah loves you always" is the line's own conclusion. Teacher to choose the wording. |
| Quiz q1 | ما هي أول آية في سورة الضحى؟ | CHANGED: two old options were not ayat of this surah: "bismillah" (the opening of the basmala) and "wa-al-'asr" (Al-'Asr 103:1), both typed. They are replaced by ayat 3 and 6 of Ad-Duha. |
| Quiz q3 | ما الآية التي بعد | CHANGED: the old question typed the whole of ayah 2 ("wa-al-layli idha saja") into its text; it now shows ayah 2's last word (saja) after "ma al-ayah allati ba'd". Two old options were only the openings of ayat 4 and 6 (three words each); they are now those whole ayat. Teacher to confirm it reads well. |
| Quiz q5 | ما معنى | PHRASE: the old question asks about the two words "fa-la taqhar" (9:3-4); the engine shows one word, so it points at taqhar (9:4) and the options carry the negation ("do not wrong or hurt"). Teacher to confirm it reads right. |
| Did you know | هل تعلم أن الابتسامة في وجه أخيك صدقة؟ | A hadith (at-Tirmidhi: "your smiling in the face of your brother is charity for you", graded hasan/sahih). True, but not something this surah teaches. Teacher to keep or drop. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. The old lesson had no data file: the ayat and tafsir came from components/LearnAyahSection.tsx, the word meanings from MeaningsSection.tsx, the rest from the other components. Dropped: the four Tajweed rules and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the audio URLs, the reciter line and the typed basmala, and every hand-typed Quran string (replaced by positions). The complete-the-ayah words are the answers of the old completion game; its distractors hada and aghna were typed without the fa- the verse words carry, so they are not words of this surah as typed, and they are gone, as the game draws its options from these words. The quiz question "which ayah is after ..." typed ayah 2 into its text; it now shows ayah 2's last word. The old quiz categories were mapped (hifz, ma'ani, and "fahm" to lessons). Emoji were stripped from the ends of the tafsir lines, the word meanings and the reflection ideas. Each lesson learned is its old title and description joined with ": ". The intro is the two paragraphs of the old "why was this surah revealed?" card joined with a space, its <strong> markup removed and its line breaks read as single spaces (as the page rendered them). Not carried (no field or no such game in the engine): the "Makki" surah type and the surah number, the ayah-ordering, memory (ayah to its number) and listen-and-choose games, the word-meaning game (same words and meanings as the list), the intro quiz (surah name, ayah count), the reflection's prompt and closing lines, and the quiz's difficulty levels.

</details>

## 92 Al-Layl: 2 held

| Where | Old text | Why it is held |
|---|---|---|
| Word meaning, 6:2 | الجنة والمكافأة الجميلة | The old card was "al-husna" alone; the verse word at 6:2 is "bi-l-husna" (with bi-, "in"), so the meaning covers only part of the word shown. The word also stands at 9:2 (wa-kadhdhaba bi-l-husna); the card points at 6:2. Common tafsir gives al-husna as "la ilaha illa Allah" (Ibn Abbas), Paradise or the reward (Mujahid, Qatada), or the replacement Allah promises the giver (Ikrimah); the card takes the second. Teacher to confirm the card. |
| Lesson | أن الله يرى أعمالنا كلها، الخير والشر | A true teaching, but not what the surah says: ayah 4 says people's strivings differ ("inna sa'yakum la-shatta"), and ayat 5-11 give each its outcome; it does not speak of Allah seeing deeds. Teacher to keep, reword or drop. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson (which has no data file; its content lives in the components), then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the four Tajweed rules, the Tajweed quiz game and the two Tajweed questions of the final quiz (Tajweed comes only from the reviewed dataset; the old rules also called "man bakhila" ikhfa' where it is iqlab), the audio URLs and the reciter line, the typed basmala at the head of the listening list (not an ayah of this surah), and every hand-typed Quran string (replaced by positions). The complete-the-ayah words are the answers of the old completion and missing-word games; the games' distractors were all words of this surah, and the game draws its own. The final quiz's "fahm" questions are categorised lessons (the surah's lesson) and hifz (the number of ayat, as in surah 108). The intro is the old "about the surah" card: its lead line, the two kinds of people and its closing line, joined with a space, "، " and ". ". Emoji were stripped from the ends of lines. Not carried (no field or no such game in the engine): the name and ayah-count cards, the intro quiz, the ayah-ordering and start-end memory games, the two word-meaning games (same words and meanings as the list), the reflection's feedback lines, and the final quiz's score lines.

</details>

## 91 Ash-Shams: 6 held

| Where | Old text | Why it is held |
|---|---|---|
| Word meaning, 11:3 | تجاوزها الحد في الكفر | The old card was "taghwaha" alone; the verse word at 11:3 is "bi-taghwaha" (with bi-, "because of / in"), so the meaning covers only part of the word shown. Common tafsir: their transgression, their exceeding the bounds (Ibn Abbas: by their transgression they denied); "in disbelief" is the lesson's gloss. Teacher to confirm the card. |
| Quiz q3 | ما الآية التي تأتي بعد | CHANGED: the old question typed the whole of ayah 1 into its text; it now shows ayah 1's last word (wa-duhaha) after "ma al-ayah allati ta'ti ba'd". Teacher to confirm it reads well. |
| Quiz q9 | ما آخر آية في سورة الشمس؟ | CHANGED: the old first (wrong) option was "fa-kadhdhabuhu fa-'aqaruha", the first two words of ayah 14 typed as text; it now shows the whole of ayah 14. |
| Lesson | الصدق والطاعة: الله يحب الصادقين المطيعين. يجب أن نكون صادقين ونطيع الله ووالدينا! | A good lesson, but not one this surah teaches: the surah does not speak of truthfulness or of obeying parents. Teacher to keep or drop. |
| Lesson | الابتعاد عن الشر: قوم ثمود كذّبوا نبيهم فعاقبهم الله. يجب أن نبتعد عن الكذب والأذى! | Reads Thamud's "kadhdhabat" (they denied, called their prophet a liar) as a lesson against lying. In the surah the sin is rejecting the messenger and hamstringing the she-camel (ayat 11-14), not telling lies. Teacher to check the wording. |
| Did you know | هل تعلم أن الله خلق الشمس والقمر بنظام دقيق لا يتغير أبدًا؟ | Says the sun and moon run on an order "that never changes at all". The Quran says the sun will be folded up and the moon eclipsed on the Last Day (81:1, 75:8-9), so "never" is wrong as stated; "an exact order" is fine. Teacher to reword or drop. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson (which has no data file; its content lives in the components), then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the four Tajweed rules and the Tajweed quiz question (Tajweed comes only from the reviewed dataset; the old rules were also wrong: "man zakkaha" and "man dassaha" called idgham where they are ikhfa', "inba'atha" given as izhar where its nun is iqlab, and "wa-l-shamsi" given as madd lazim), the audio ids and the reciter line, the typed basmala at the head of the listening list (not an ayah of this surah), and every hand-typed Quran string (replaced by positions). The quiz question "which ayah follows ..." typed ayah 1 into its text; it now shows ayah 1's last word. The "last ayah" question's first option was two typed words of ayah 14; it now shows ayah 14. The complete-the-ayah words are the answers of the old completion and missing-word games; their distractors were all words of this surah, and the game draws its own. The old quiz categories were mapped (memorization to hifz, meaning to meanings), and its two last questions (Thamud's fate, the surah's main lesson), filed under "meaning", are categorised lessons. Each lesson learned is its old title and description joined with ": ". The intro is the old paragraph with its line breaks collapsed to spaces, as rendered. Emoji were stripped from the ends of lines and of the reflection ideas. Not carried (no field or no such game in the engine): the name, ayah-count and "Makkah" cards, the intro quiz, the ayah-ordering and start-end memory games, the three word-meaning games (same words and meanings as the list), the reflection's instruction and feedback lines, and the quiz's difficulty levels and score lines.

</details>

## 90 Al-Balad: 8 held

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, ayah 2 | وأنت يا محمد تعيش في هذا البلد المبارك ﷺ | Gives one reading of "wa-anta hillun": you live in this land. Many tafsir (e.g. Ibn Kathir) prefer "it is made lawful for you" (to fight in it, at the conquest of Makkah). Teacher to choose the wording. |
| Tafsir, ayah 4 | الله خلق الإنسان ليعمل ويجتهد في الحياة | Renders "in kabad" (created in toil and hardship) as a purpose, "to work and strive"; the lesson's own word meaning gives "toil and hardship". Teacher to check the wording. |
| Tafsir, ayah 5 | هل يظن الإنسان أن لا أحد يحاسبه؟ الله يرى كل شيء | "yaqdira 'alayh" is "has power over him"; the line says "holds him to account" and adds "Allah sees everything", which is ayah 7's point. Teacher to check the wording. |
| Word meaning, 18:3 | أصحاب الجنة والسعادة | PHRASE: the meaning is of the phrase "ashab al-maymanah" (people of the right side); the engine shows it on the one word al-maymanah (18:3). Teacher to confirm it reads right. |
| Word meaning, 19:6 | أصحاب الشمال (أهل النار) | PHRASE: the meaning is of the phrase "ashab al-mash'amah" (people of the left side); the engine shows it on the one word al-mash'amah (19:6). Teacher to confirm it reads right. |
| Quiz q3 | ما آخر آية في سورة البلد؟ | CHANGED: the old third option was the last two words of ayah 17 (wa-tawasaw bil-marhamah), typed; it is now the whole of ayah 17. The answer (ayah 20) is unchanged. |
| Quiz q9 | من هم | CUT: the old question quoted the two words "ashab al-maymanah"; it now shows only al-maymanah (18:3) after "man hum". Teacher to confirm it reads right. |
| Quiz q11 | ما معنى | PHRASE: the meaning is of the phrase "ashab al-maymanah" (people of the right side); the engine shows it on the one word al-maymanah (18:3). Teacher to confirm it reads right. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson, then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Dropped: the four Tajweed rules and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the audio keys and URLs, the reciter line and typed basmala of the listening page, and every hand-typed Quran string (replaced by positions). The old quiz had difficulty levels and the categories hifz, meanings, tajweed and "fahm" (understanding); "fahm" became lessons, except the "ashab al-maymanah" question, which now points at a word and is meanings. The two word-meaning game questions not already in the final quiz (al-balad, al-maymanah) are carried into the quiz (q10, q11); the other three repeat final-quiz questions. The complete-the-ayah words are the answers of the complete-the-ayah and missing-word games, de-duplicated (mu'sadah is in both). The intro is the old three "about the surah" paragraphs joined with a space, the two highlighted phrases unwrapped from their spans. Emoji were stripped from the ends of lines. Not carried (no field or no such game in the engine): the welcome card, the intro quiz (surah name, ayah count), the ayah-ordering game, the word-card icons, the results and encouragement lines. Matching aids, for alignment only and never stored: the old text writes adraka (12:2) with a plain alif where the Uthmani text has ya and a dagger alif, and al-mash'amah (19:6) with the hamza on an alif seat; the quiz option shafatayn was typed without the wa- that the verse word carries, so it points at the whole verse word (9:2); likewise the word meaning al-marhamah was typed without the bi- of bil-marhamah (17:9).

</details>

## 89 Al-Fajr: 24 held

| Where | Old text | Why it is held |
|---|---|---|
| Intro | سورة الفجر تذكرنا بعظمة خلق الله، وتحدثنا عن بعض الأمم السابقة التي لم تطيع الله، وتعلمنا أن الله يحب العدل والرحمة ومساعدة المحتاجين. | Grammar: "lam tuti'" is written "lam tuti'u" (lam needs the jussive). Teacher to correct. |
| Tafsir, ayah 3 | ويقسم بالعدد الزوجي والعدد الفردي | A generic reading of al-shaf' wa-l-watr (even and odd numbers). Many tafsir give other views, e.g. the Day of Sacrifice and the Day of Arafah, or creation in pairs and Allah the One. Teacher to choose. |
| Tafsir, ayah 7 | إرم هي مدينة قوم عاد التي كانت فيها أعمدة كبيرة وقوية | Says Iram is the city of 'Ad. Tafsir differ: many say Iram is the tribe (or its ancestor) and "dhat al-'imad" is their tall pillars or tents, or their great stature. Teacher to choose the wording. |
| Tafsir, ayah 8 | لم يكن هناك مدينة مثلها في القوة والجمال | Follows the line on ayah 7 that Iram is a city; on the tribe reading, no people like them were created in the land. Teacher to choose with ayah 7. |
| Tafsir, ayah 10 | وفرعون الذي كان عنده جيش كبير وقوي | One reading of "dhi al-awtad" (his armies, which held his rule firm). Others: the stakes he tortured people with, or his great buildings. Teacher to choose. |
| Tafsir, ayah 23 | ويُؤتى بجهنم في ذلك اليوم في ذلك اليوم يتذكر الإنسان أعماله، لكن الوقت قد فات | MERGED: the old lesson split this ayah into two (its 23 and 24); these are its two lines joined. They repeat "fi dhalika al-yawm" at the join. Teacher to smooth the wording. |
| Tafsir, ayah 24 | يتمنى لو أنه عمل أعمالاً صالحة أكثر في حياته | RENUMBERED: this is the old lesson's entry 25, which it showed as ayah 25; it is real ayah 24 (the old lesson split ayah 23, so every later entry was one too high). The line is unchanged. Teacher to confirm. |
| Tafsir, ayah 25 | لا أحد يعذب مثل عذاب الله في ذلك اليوم | RENUMBERED: this is the old lesson's entry 26, which it showed as ayah 26; it is real ayah 25 (the old lesson split ayah 23, so every later entry was one too high). The line is unchanged. Teacher to confirm. |
| Tafsir, ayah 26 | ولا أحد يقيد مثل قيد الله | RENUMBERED: this is the old lesson's entry 27, which it showed as ayah 27; it is real ayah 26 (the old lesson split ayah 23, so every later entry was one too high). The line is unchanged. Teacher to confirm. |
| Tafsir, ayah 27 | يا أيتها النفس الهادئة المؤمنة التي تحب الله | RENUMBERED: this is the old lesson's entry 28, which it showed as ayah 28; it is real ayah 27 (the old lesson split ayah 23, so every later entry was one too high). The line is unchanged. Teacher to confirm. |
| Tafsir, ayah 28 | ارجعي إلى الله وأنتِ سعيدة والله راضٍ عنكِ | RENUMBERED: this is the old lesson's entry 29, which it showed as ayah 29; it is real ayah 28 (the old lesson split ayah 23, so every later entry was one too high). The line is unchanged. Teacher to confirm. |
| Tafsir, ayah 29 | ادخلي مع عباد الله الصالحين | RENUMBERED: this is the old lesson's entry 30, which it showed as ayah 30; it is real ayah 29 (the old lesson split ayah 23, so every later entry was one too high). The line is unchanged. Teacher to confirm. |
| Tafsir, ayah 30 | وادخلي الجنة! وهذه أعظم مكافأة من الله | RENUMBERED: this is the old lesson's entry 31, which it showed as ayah 31; it is real ayah 30 (the old lesson split ayah 23, so every later entry was one too high). The line is unchanged. Teacher to confirm. |
| Word meaning, 1:1 | وقت طلوع الشمس في الصباح الباكر | Says al-fajr is "the time of sunrise". Al-fajr is dawn, the first light, before sunrise (the lesson's own tafsir line says it starts the day). Teacher to correct. |
| Word meaning, 2:1 | الليالي العشر الأولى من شهر ذي الحجة | PHRASE: the meaning is of the phrase "layalin 'ashr"; the engine shows it on the one word wa-layalin (2:1). Teacher to confirm it reads right. The meaning names the first ten nights of Dhu al-Hijjah, the view of most tafsir; some say the last ten of Ramadan. |
| Word meaning, 3:1 | العدد الزوجي مثل 2 و 4 و 6 | A generic reading of al-shaf' wa-l-watr (even and odd numbers). Many tafsir give other views, e.g. the Day of Sacrifice and the Day of Arafah, or creation in pairs and Allah the One. Teacher to choose. |
| Word meaning, 3:2 | العدد الفردي مثل 1 و 3 و 5 | A generic reading of al-shaf' wa-l-watr (even and odd numbers). Many tafsir give other views, e.g. the Day of Sacrifice and the Day of Arafah, or creation in pairs and Allah the One. Teacher to choose. |
| Word meaning, 7:1 | مدينة قوم عاد الكبيرة | Says Iram is the city of 'Ad. Tafsir differ: many say Iram is the tribe (or its ancestor) and "dhat al-'imad" is their tall pillars or tents, or their great stature. Teacher to choose the wording. |
| Word meaning, 10:3 | الجيش القوي الكبير | One reading of "dhi al-awtad" (his armies, which held his rule firm). Others: the stakes he tortured people with, or his great buildings. Teacher to choose. |
| Word meaning, 14:3 | الله يرى ويراقب كل شيء | PHRASE: the meaning is of the phrase "inna rabbaka la-bil-mirsad"; the engine shows it on the one word la-bil-mirsad (14:3). Teacher to confirm it reads right. Al-mirsad itself is the lookout, the place of watching. |
| Quiz q3 | ما الآية التي تأتي بعد | CHANGED: the old question typed ayah 1 (wa-l-fajr) into its text; it now shows that word (1:1) after "ma al-ayah allati ta'ti ba'd". Teacher to confirm it reads well. |
| Quiz q8 | ما آخر آية في سورة الفجر؟ | RENUMBERED: the old options were its entries 31, 29 and 1; through the numbering map they are real ayat 30, 28 and 1 (the old lesson split ayah 23). The answer is still the last ayah (now 30, which the old lesson numbered 31); the second option is ayah 28, which it numbered 29. Teacher to confirm. |
| Quiz q9 | أكمل الآية | CHANGED: the old distractors (al-karimah, al-salihah) were hand-typed, not words of this surah; they are now radiyah (28:4) and mardiyyah (28:5). The prompt shows two words: the old text's "ya ayyatuha" is one word in the Uthmani text. |
| Did you know | هل تعلم أن الفجر هو أول وقت في اليوم وهو وقت مبارك؟ | Says al-fajr is the first time of the day. The fasting day begins at dawn, but the Islamic day (the date) begins at sunset (maghrib). Teacher to check the wording. |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson (which has no data file; its content lives in components/LessonData.ts and the components, and its reflection prompt in pages/Index.tsx), then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. NUMBERING: the old lesson had 31 entries for the surah's 30 ayat; it split real ayah 23 into two entries (its 23 and 24), so its entries 25-31 are real ayat 24-30 (its own code comment wrongly blamed ayah 30). The tafsir for ayah 23 is its two lines joined (MERGED); the tafsir for ayat 24-30 and the "last ayah" quiz question are renumbered through the map and held (RENUMBERED). Word meanings, complete-the-ayah words and the completion question are matched by text, not by the old numbers. Dropped: the four Tajweed rules and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the full-surah and per-ayah audio URLs (the per-ayah audio used the old numbers, so from entry 24 on it played the wrong ayah), and every hand-typed Quran string (replaced by positions). The old quiz had difficulty levels, not categories; the categories were assigned by question type. The complete-the-ayah words are the answers of the complete-the-ayah and missing-word games (de-duplicated: ashr is in both); the two whole-ayah answers (ayat 2 and 4) became their last word. The reflection idea is the old model answer shown after a child submits. Emoji were stripped from the ends of lines. Not carried (no field or no such game in the engine): the motivational messages, the intro facts and intro quiz, the ayah-ordering, memory, build-the-ayah, match and meaning-choice games, and the games' hand-typed distractors. Matching aids, for alignment only and never stored: the old text writes wa-l-layl (4:1) with two lams, ibtalahu (15:5, 16:4) with a plain alif, and wa-ji'a (23:1) without the Uthmani extra alif, and splits off the vocative ya of ya-laytani (24:2) and ya-ayyatuha (27:1), which the Uthmani text joins to the next word; the word meanings al-fajr, al-shaf', al-watr, thamud (wa-), 'ad (bi-) and al-mirsad (la-bi-) were typed without the particles the verse words carry, so they point at the whole verse words, and the phrase layalin 'ashr points at wa-layalin (2:1).

</details>

