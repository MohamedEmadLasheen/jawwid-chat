# PD-29 P0-5c: Arabic lesson 5 (reading sentences), lines held for teacher review

This file is generated from `apps/lessons/src/arabic/lesson-005.json` and the rebuild's report. Do not edit it by hand.

- The lesson was rewritten as data from the old lesson (jawwid-lessons @ c231532, `arabic/lesson-5/data/sentences.ts`), as a **reading lesson** (pd029-p05-reading-lessons-design.md). The old lesson was read as text only, from a quarantined copy, and never built or run.
- The file is **pending**: the lesson page shows nothing of it until the Teachers department approves it.
- CI refuses any sentence that carries 3 or more consecutive Quran words. None here does.

## Summary

| | |
|---|---|
| Sentences | 62 |
| Held | 62 |
| Kept with a final tanween fath (held) | 11 |
| Old duplicates removed (the old test sentences repeat the lesson) | 5 |
| Dropped | 0 |
| Quiz questions ("which word is missing") | 8 |

**Why sentences are held:**

- 34: ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word
- 17: ADDED TASHKEEL: the pausal sukun on the last word
- 11: FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause)
- 6: ADDED TASHKEEL: sukun on the qamari lam

## Decisions for the teachers

**Two bulk decisions first.**
1. **Only the last word of each sentence takes the pausal sukun** (أَكَلَ الْوَلَدُ الْبَابْ). Case endings stay inside the sentence. This one answer clears or changes them all at once.
2. **A final tanween fath (ـًا) is kept as written** (11 sentences, e.g. أَكَلَ الْوَلَدُ تُفَّاحًا). In pause it is read as a long alif. Confirm that it is shown this way.
3. **The qamari lam takes its sukun** (الوَلَدُ → الْوَلَدُ). The old lesson left it bare.
4. **Each sentence** must be suitable for a child and correct. The names used (مُحَمَّدٌ، أَحْمَدُ) are the old lesson's.

## The quiz

Each question blanks the sentence's VERB; the wrong options are nouns from other sentences, which can never fill a verb's place, so only one option fits.

| Id | Sentence | Options | Right answer |
|---|---|---|---|
| sentences-q1 | … الْوَلَدُ تُفَّاحًا | أَكَلَ، الطِّفْلُ، الْمُعَلِّمُ | أَكَلَ |
| sentences-q2 | … الطِّفْلُ حَلِيبًا | الْمُعَلِّمُ، الْعُصْفُورُ، شَرِبَ | شَرِبَ |
| sentences-q4 | … الْوَلَدُ بِالْكُرَةْ | الْحَمْدُ، الطِّفْلُ، لَعِبَ | لَعِبَ |
| sentences-q5 | … أَحْمَدُ إِلَى الْمَسْجِدْ | الْعُصْفُورُ، الْحَمْدُ، ذَهَبَ | ذَهَبَ |
| sentences-q6 | … الطِّفْلُ صُورَةْ | الْعُصْفُورُ، رَسَمَ، الْحَمْدُ | رَسَمَ |
| sentences-q7 | … الْوَلَدُ إِلَى السَّمَاءْ | نَظَرَ، الْحَمْدُ، الْعُصْفُورُ | نَظَرَ |
| sentences-q9 | … الْوَلَدُ الْبَابْ | الْحَمْدُ، الطِّفْلُ، فَتَحَ | فَتَحَ |
| sentences-q10 | … الطِّفْلُ يَدَيْهْ | الْوَلَدُ، غَسَلَ، الْمُعَلِّمُ | غَسَلَ |

## Old repeats removed

The old lesson's test sentences repeated these lesson sentences word for word; each is kept once.

- فَتَحَ الوَلَدُ البَابَ
- كَتَبَ الطِّفْلُ دَرْسَهُ
- قَرَأَ مُحَمَّدٌ كِتَابًا
- طَارَ العُصْفُورُ فِي السَّمَاءِ
- سَلَّمَ الوَلَدُ عَلَى جَدِّهِ

## Every sentence

| Id | Sentence | Was | Held because |
|---|---|---|---|
| sentences-001 | أَكَلَ الْوَلَدُ تُفَّاحًا | أَكَلَ الوَلَدُ تُفَّاحًا | ADDED TASHKEEL: sukun on the qamari lam; FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause) |
| sentences-002 | شَرِبَ الطِّفْلُ حَلِيبًا | — | FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause) |
| sentences-003 | قَرَأَ مُحَمَّدٌ كِتَابًا | — | FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause) |
| sentences-004 | لَعِبَ الْوَلَدُ بِالْكُرَةْ | لَعِبَ الوَلَدُ بِالكُرَةِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-005 | ذَهَبَ أَحْمَدُ إِلَى الْمَسْجِدْ | ذَهَبَ أَحْمَدُ إِلَى المَسْجِدِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-006 | رَسَمَ الطِّفْلُ صُورَةْ | رَسَمَ الطِّفْلُ صُورَةً | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-007 | نَظَرَ الْوَلَدُ إِلَى السَّمَاءْ | نَظَرَ الوَلَدُ إِلَى السَّمَاءِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-008 | كَتَبَ الطِّفْلُ دَرْسَهْ | كَتَبَ الطِّفْلُ دَرْسَهُ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-009 | فَتَحَ الْوَلَدُ الْبَابْ | فَتَحَ الوَلَدُ البَابَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-010 | غَسَلَ الطِّفْلُ يَدَيْهْ | غَسَلَ الطِّفْلُ يَدَيْهِ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-011 | نَامَ الطِّفْلُ مُبَكِّرًا | — | FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause) |
| sentences-012 | جَلَسَ الْوَلَدُ عَلَى الْكُرْسِيّْ | جَلَسَ الوَلَدُ عَلَى الكُرْسِيِّ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-013 | أَحَبَّ الطِّفْلُ أُمَّهْ | أَحَبَّ الطِّفْلُ أُمَّهُ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-014 | سَمِعَ الْوَلَدُ الْأَذَانْ | سَمِعَ الوَلَدُ الأَذَانَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-015 | لَبِسَ الطِّفْلُ ثَوْبَهْ | لَبِسَ الطِّفْلُ ثَوْبَهُ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-016 | زَرَعَ الْوَلَدُ شَجَرَةْ | زَرَعَ الوَلَدُ شَجَرَةً | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-017 | حَفِظَ مُحَمَّدٌ سُورَةْ | حَفِظَ مُحَمَّدٌ سُورَةً | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-018 | صَلَّى الْوَلَدُ الْفَجْرْ | صَلَّى الوَلَدُ الفَجْرَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-019 | رَكَضَ الطِّفْلُ فِي الْحَدِيقَةْ | رَكَضَ الطِّفْلُ فِي الحَدِيقَةِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-020 | سَبَحَ الْوَلَدُ فِي الْبَحْرْ | سَبَحَ الوَلَدُ فِي البَحْرِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-021 | طَبَخَتْ أُمِّي طَعَامًا | — | FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause) |
| sentences-022 | قَطَفَ الْوَلَدُ وَرْدَةْ | قَطَفَ الوَلَدُ وَرْدَةً | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-023 | حَمَلَ الطِّفْلُ حَقِيبَتَهْ | حَمَلَ الطِّفْلُ حَقِيبَتَهُ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-024 | وَضَعَ الْوَلَدُ الْكِتَابْ | وَضَعَ الوَلَدُ الكِتَابَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-025 | مَشَى الطِّفْلُ إِلَى الْبَيْتْ | مَشَى الطِّفْلُ إِلَى البَيْتِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-026 | ضَحِكَ الْوَلَدُ كَثِيرًا | ضَحِكَ الوَلَدُ كَثِيرًا | ADDED TASHKEEL: sukun on the qamari lam; FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause) |
| sentences-027 | بَكَى الطِّفْلُ قَلِيلًا | — | FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause) |
| sentences-028 | نَظَّفَ الْوَلَدُ غُرْفَتَهْ | نَظَّفَ الوَلَدُ غُرْفَتَهُ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-029 | سَاعَدَ الطِّفْلُ أَبَاهْ | سَاعَدَ الطِّفْلُ أَبَاهُ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-030 | أَطْعَمَ الْوَلَدُ الْقِطَّةْ | أَطْعَمَ الوَلَدُ القِطَّةَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-031 | شَاهَدَ الطِّفْلُ الْقَمَرْ | شَاهَدَ الطِّفْلُ القَمَرَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-032 | قَفَزَ الْوَلَدُ عَالِيًا | قَفَزَ الوَلَدُ عَالِيًا | ADDED TASHKEEL: sukun on the qamari lam; FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause) |
| sentences-033 | دَخَلَ الطِّفْلُ الْفَصْلْ | دَخَلَ الطِّفْلُ الفَصْلَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-034 | خَرَجَ الْوَلَدُ مِنَ الْبَيْتْ | خَرَجَ الوَلَدُ مِنَ البَيْتِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-035 | عَلَّمَ الْمُعَلِّمُ الْأَطْفَالْ | عَلَّمَ المُعَلِّمُ الأَطْفَالَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-036 | سَقَى الْوَلَدُ الزَّهْرَةْ | سَقَى الوَلَدُ الزَّهْرَةَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-037 | طَارَ الْعُصْفُورُ فِي السَّمَاءْ | طَارَ العُصْفُورُ فِي السَّمَاءِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-038 | أَكَلَ الطِّفْلُ مَوْزَةْ | أَكَلَ الطِّفْلُ مَوْزَةً | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-039 | شَرِبَ الْوَلَدُ عَصِيرًا | شَرِبَ الوَلَدُ عَصِيرًا | ADDED TASHKEEL: sukun on the qamari lam; FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause) |
| sentences-040 | رَتَّبَ الطِّفْلُ أَلْعَابَهْ | رَتَّبَ الطِّفْلُ أَلْعَابَهُ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-041 | صَنَعَ الْوَلَدُ طَائِرَةْ | صَنَعَ الوَلَدُ طَائِرَةً | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-042 | قَالَ الطِّفْلُ الْحَمْدُ لِلَّهْ | قَالَ الطِّفْلُ الحَمْدُ لِلَّهِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-043 | سَلَّمَ الْوَلَدُ عَلَى جَدِّهْ | سَلَّمَ الوَلَدُ عَلَى جَدِّهِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-044 | فَرِحَ الطِّفْلُ بِالْهَدِيَّةْ | فَرِحَ الطِّفْلُ بِالهَدِيَّةِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-045 | لَوَّنَ الْوَلَدُ الرَّسْمَةْ | لَوَّنَ الوَلَدُ الرَّسْمَةَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-046 | أَغْلَقَ الطِّفْلُ النَّافِذَةْ | أَغْلَقَ الطِّفْلُ النَّافِذَةَ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-047 | وَجَدَ الْوَلَدُ كَنْزًا | وَجَدَ الوَلَدُ كَنْزًا | ADDED TASHKEEL: sukun on the qamari lam; FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause) |
| sentences-048 | تَعَلَّمَ الطِّفْلُ الْحُرُوفْ | تَعَلَّمَ الطِّفْلُ الحُرُوفَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-049 | بَنَى الْوَلَدُ بُرْجًا | بَنَى الوَلَدُ بُرْجًا | ADDED TASHKEEL: sukun on the qamari lam; FINAL MARK EXCEPTION: the tanween fath of the last word (read as a long alif in pause) |
| sentences-050 | عَدَّ الطِّفْلُ النُّجُومْ | عَدَّ الطِّفْلُ النُّجُومَ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-051 | رَكِبَ الْوَلَدُ الدَّرَّاجَةْ | رَكِبَ الوَلَدُ الدَّرَّاجَةَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-052 | أَحْضَرَ الطِّفْلُ الْمَاءْ | أَحْضَرَ الطِّفْلُ المَاءَ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-053 | جَاءَ الْوَلَدْ | جَاءَ الوَلَدُ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-054 | نَامَ الطِّفْلْ | نَامَ الطِّفْلُ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-055 | أَكَلَ مُحَمَّدْ | أَكَلَ مُحَمَّدٌ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-056 | شَرِبَ أَحْمَدْ | شَرِبَ أَحْمَدُ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-057 | لَعِبَ الطِّفْلْ | لَعِبَ الطِّفْلُ | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-058 | رَسَمَ الْوَلَدُ صُورَةْ | رَسَمَ الوَلَدُ صُورَةً | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-059 | حَفِظَ الطِّفْلُ سُورَةْ | حَفِظَ الطِّفْلُ سُورَةً | ADDED TASHKEEL: the pausal sukun on the last word |
| sentences-060 | ذَهَبَ الْوَلَدُ إِلَى الْمَدْرَسَةْ | ذَهَبَ الوَلَدُ إِلَى المَدْرَسَةِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-061 | جَلَسَ الطِّفْلُ عَلَى الْكُرْسِيّْ | جَلَسَ الطِّفْلُ عَلَى الكُرْسِيِّ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
| sentences-062 | مَشَى مُحَمَّدٌ إِلَى الْبَيْتْ | مَشَى مُحَمَّدٌ إِلَى البَيْتِ | ADDED TASHKEEL: sukun on the qamari lam, the pausal sukun on the last word |
