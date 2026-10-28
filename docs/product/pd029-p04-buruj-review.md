# PD-29 P0-4: Al-Buruj (85), lines held for teacher review

The reference lesson for the engine. Content file: `apps/lessons/src/content/surah-085.json`. It was extracted as text from the old lesson (jawwid-lessons @ c231532, read only, never built or run) and reviewed against the verified Tanzil text.

**How review works.** Until a Teachers department reviewer approves the file (`review.status` = `approved`), the lesson shows **nothing** from it, only the verified Quran (department head, 2026-10-28). Even then, a line whose `review` is set is **held back**: the engine does not show it. A teacher from the Teachers department resolves each line by correcting it, or writing it where it is missing, and clears its `review`. Then they set `review.status` to `approved` with their name in `review.by`. The CI check (`scripts/lessons/check-lesson-content.py`) refuses an approved file that still has a flagged line.

## What the review found in the old lesson

- **The ayah numbering was wrong from ayah 9 onwards.** The old lesson had 22 entries, but it split real ayah 9 into 2, ayah 10 into 4 and ayah 11 into 3, and then **stopped at real ayah 16**. Ayat 17 to 22 were never taught. The tafsir lines for 9, 10 and 11 are the old pieces joined, and are held as MERGED.
- **The quiz's "last ayah" answer was wrong.** The old answer is ayah 16; the surah ends at ayah 22. This is corrected and held for a teacher.
- **Dropped:** the four Tajweed rules and the Tajweed quiz question (Tajweed comes only from the reviewed dataset), the audio URLs (recitation stays off), and every hand-typed Quran string. Quran text is now positions into the verified text.
- **Not carried over yet:** the start-to-end matching game, the word-to-meaning matching game and the intro quiz (surah name, ayah count). The engine has no such games yet.

## Held lines

| Where | Old text | Why it is held |
|---|---|---|
| Tafsir, ayah 1 | يُقسم الله بالسماء الجميلة التي فيها النجوم الكبيرة | Says al-buruj are "the big stars". Common tafsir gives the great stars, or the mansions of the sun and moon. Teacher to choose the wording. |
| Tafsir, ayah 3 | ويُقسم بمن يشهد ومن يُشهد عليه يوم القيامة | A generic reading of shahid/mashhud. Many tafsir name Friday and the Day of Arafah. Teacher to choose. |
| Tafsir, ayah 9 | الله الذي يملك كل شيء في السماوات والأرض والله يرى كل شيء ويعلم كل شيء | MERGED: the old lesson split this ayah into two (its 9 and 10); these are its two lines joined. |
| Tafsir, ayah 10 | الذين آذوا المؤمنين والمؤمنات ولم يرجعوا عن أفعالهم السيئة ولم يتوبوا إلى الله سيعاقبهم الله بنار جهنم ولهم عذاب شديد بالنار | MERGED: the old lesson split this ayah into four (its 11-14); these are its four lines joined. |
| Tafsir, ayah 11 | أما الذين آمنوا بالله وعملوا أعمالًا طيبة لهم جنات جميلة تجري فيها الأنهار وهذا هو الفوز العظيم من الله | MERGED: the old lesson split this ayah into three (its 15-17); these are its three lines joined. |
| Tafsir, ayah 15 | صاحب العرش العظيم الكريم | In Hafs, al-majid (with damma) describes Allah, not the Throne; this line reads it as the Throne's. Teacher to correct. |
| Tafsir, ayah 17 | _(none)_ | MISSING: the old lesson never reached ayat 17-22, so there is no line. A teacher writes it. |
| Tafsir, ayah 18 | _(none)_ | MISSING: the old lesson never reached ayat 17-22, so there is no line. A teacher writes it. |
| Tafsir, ayah 19 | _(none)_ | MISSING: the old lesson never reached ayat 17-22, so there is no line. A teacher writes it. |
| Tafsir, ayah 20 | _(none)_ | MISSING: the old lesson never reached ayat 17-22, so there is no line. A teacher writes it. |
| Tafsir, ayah 21 | _(none)_ | MISSING: the old lesson never reached ayat 17-22, so there is no line. A teacher writes it. |
| Tafsir, ayah 22 | _(none)_ | MISSING: the old lesson never reached ayat 17-22, so there is no line. A teacher writes it. |
| Word meaning, 1:3 | النجوم الكبيرة في السماء | Says al-buruj are "the big stars". Common tafsir gives the great stars, or the mansions of the sun and moon. Teacher to choose the wording. |
| Word meaning, 9:10 | يرى كل شيء | Meaning given as "sees everything"; shahid is the Witness who knows and sees all. Teacher to confirm. |
| Quiz q2 | ما آخر آية في سورة البروج؟ | CORRECTED: the old answer was "fa''alun lima yurid", which is ayah 16. The surah ends at ayah 22. |
| Quiz q4 | أكمل | CHANGED: the old distractors (al-azim, al-mubin) were hand-typed; these two are words of this surah. |
| Quiz q5 | ما معنى كلمة | Says al-buruj are "the big stars". Common tafsir gives the great stars, or the mansions of the sun and moon. Teacher to choose the wording. |
| Did you know | هل تعلم أن البروج هي النجوم الكبيرة في السماء؟ | Says al-buruj are "the big stars". Common tafsir gives the great stars, or the mansions of the sun and moon. Teacher to choose the wording. |

18 lines held in all. Nothing in the file is shown until the Teachers department signs it off; the unflagged lines need that review too.
