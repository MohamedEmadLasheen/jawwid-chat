# PD-29 P0-4, batch 5 (Al-Fatihah): lines held for teacher review

The last old Quran lesson rebuilt on the engine, after Al-Buruj and Juz' Amma batches 1–4 (`pd029-p04-batch1-review.md` to `-batch4-`). The method and rules are the same.

- The lesson's prose was copied **as text** from the old lesson (jawwid-lessons @ c231532, quran/surah-1, never built or run), byte-for-byte or as exact pieces joined.
- The Quran appears only as positions in the verified Tanzil text.
- The file is **pending**: the lesson shows nothing from it until a Teachers department reviewer approves it, and a flagged line is never shown.

With this batch, every Quran lesson of the old site (38: Al-Fatihah and 78–114) has a reviewed file.

## Numbering

| Surah | Ayat | Finding |
|---|---|---|
| 1 Al-Fatihah | 7 | Matches the verified text: each old entry is exactly one real ayah, all present |

**The Basmala.** The verified text (Tanzil, Hafs count) has the Basmala as ayah 1 of 7, and so does the old lesson (`id: 1`, with its own tafsir line). Nothing shifts: ayah 7 is the whole of «صراط الذين أنعمت عليهم … ولا الضالين», as in the dataset.

That the Basmala is an ayah of Al-Fatihah is the Kufan count, which Hafs follows. Other schools count it differently, but the lesson follows the dataset, and nothing is held for this.

**No matching aids were needed.** The old text and the verified text align directly once folded.

**What is new in this file**, because the old lesson had no fixed quiz: its "choose the word" and "what does it mean" games drew questions at random.

- q1–q3 (complete the ayah) and q4–q7 (word meanings) are fixed questions of those same two kinds.
- They use the old prompts verbatim («أكمل الآية:», «ما معنى:»), the old card meanings as options, and words of this surah as distractors.
- They are not held, as in batch 3, where Al-Balad's two meaning-game questions were carried the same way. A teacher may still want to look at them.
- The complete-the-ayah words are the last words of ayat 2–7.

**Word meanings.** Each one is the old card's meaning and its explanation joined with ": ". Three old meanings only repeat the word (Allah, al-rahman, al-rahim), so the explanation is the meaning a child actually reads.

**G-20.** One lesson line holds a protected staff name **inside the ordinary word** «يهدينا». Only those characters are written as JSON `\u` escapes, and the decoded text is asserted unchanged.

**The old lesson has no Tajweed**, so none is dropped.

## 1 Al-Fatihah: 4 held

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, 1 | نبدأ باسم الله الرحمن الرحيم، فالله هو المعبود بحق، … | EDITED (2026-10-29): the line typed the whole Basmala in prose spelling. The typed-Quran check now matches on the rasm skeleton, so it catches standard spelling. Shortened to «نبدأ باسم الله، …», since the ayah itself is shown from the verified text. Teacher to confirm the wording. |
| Word meaning, 5:2 | نطيع ونحب: نصلي ونصوم ونفعل كل ما يحبه الله | Gives na'budu as "we obey and love". Worship ('ibadah) is wider than obedience and love: it is everything Allah loves, done for Him alone (the explanation lists prayer, fasting and supplication). Teacher to confirm the wording. |
| Lesson | عند الصعوبات: اطلب من الله المساعدة 'إياك نستعين' | TYPED: the line quotes "iyyaka nasta'in", two words of ayah 5, typed by hand. Teacher to rephrase it (e.g. without the quote), or keep the quote as a position. |
| Reflection | ما هي النعم التي تشكر الله عليها؟ | CUT: the old question began "when you say 'al-hamdu lillahi rabbi al-'alamin'," which types the whole of ayah 2; only the question after it is kept. Teacher to restore the link to ayah 2 in prose (e.g. "when you praise Allah"). |

<details><summary>Extraction note</summary>

Extracted as text from the old lesson (data/fatihaData.ts and pages/SurahFatiha.tsx; the game components only for their two prompts), then reviewed against the verified dataset. A line with "review" set is held (not shown) until a teacher resolves it. Numbering: the Basmala is ayah 1 in both the old lesson and the verified text (7 ayat), so nothing shifts. Each word meaning is the old card's meaning and its explanation joined with ": " (three old meanings only repeat the word: Allah, al-rahman, al-rahim); the cards' examples are not carried. The old lesson has no fixed quiz: its "choose the word" and "what does it mean" games draw questions at random. q1-q3 and q4-q7 are fixed questions of those two kinds, with the old prompts verbatim ("akmil al-ayah:", "ma ma'na:"), the old card meanings as options and words of this surah as distractors; the complete-the-ayah words are the last words of ayat 2-7. Each lesson is a "what we learn" or "how we apply it" title and description joined with ": ". The reflection ideas are the old answer chips, emoji removed. Dropped: the audio URLs (everyayah, al-Husari) and the reciter line, the typed text of the surah, the cards' examples, the ayah-ordering, fix-the-error and matching games, the encouragement lines, the "what we will learn today" list, the info chips (Makki, 7 ayat, first surah) and the closing du'a. The old lesson has no Tajweed.

</details>

