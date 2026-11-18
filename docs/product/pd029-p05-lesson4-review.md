# PD-29 P0-5c: Arabic lesson 4 (reading with the harakat), items held for teacher review

This file is generated from `apps/lessons/src/arabic/lesson-004.json` and the rebuild's report. Do not edit it by hand.

- The lesson was rewritten as data from the old lesson (jawwid-lessons @ c231532, `arabic/lesson-4/lib/lessonData.ts`), as a **reading lesson** (pd029-p05-reading-lessons-design.md). The old lesson was read as text only, from a quarantined copy, and never built or run.
- The file is **pending**: the lesson page shows nothing of it until the Teachers department approves it.
- **No mark was added or changed.** Every old item is already fully vowelled, and in the three vowel stages every letter carries its stage's vowel (CI proves it).
- CI refuses any item that carries 3 or more consecutive Quran words. None here does.

## Summary

| Stage | Vowel | Items | Drills (مَقَاطِعُ) | Words |
|---|---|---|---|---|
| الْفَتْحَةْ (`fatha`) | fatha | 56 | 30 | 26 |
| الْكَسْرَةْ (`kasra`) | kasra | 56 | 56 | 0 |
| الضَّمَّةْ (`damma`) | damma | 56 | 56 | 0 |
| حَرَكَاتٌ مُخْتَلِفَةْ (`mixed`) | mixed | 47 | 0 | 47 |

- Held: 2. Left out: 8 (not words as vowelled) and 1 repeat.
- Quiz questions ("which one is all …"): 19.

## Decisions for the teachers

**Bulk decisions first.** Each answer covers every item it names.
1. **The vowel drills are kept as drills** (142 items, e.g. بَتَ، كِتِبِ، بُتُ). Decoding syllables that are not words is a standard early-reading step, and it is what the old lesson taught. They are labelled «مَقَاطِعُ», never offered as words, and never mixed into a word question.
2. **Real verbs of the fatha stage are words** (26 items, e.g. كَتَبَ، دَرَسَ). Every other fatha-stage item, and every kasra- and damma-stage item, is a drill. Confirm the list (the Kind column below).
3. **Some fatha drills look like a real word vowelled another way.** They stay drills; confirm they should be kept:

| Drill | The real word |
|---|---|
| جَمَلَ | جَمَلٌ (a noun) |
| فَرَحَ | فَرِحَ |
| لَبَسَ | لَبِسَ (لَبَسَ, to confuse, is rare) |
| رَمَلَ | رَمْلٌ (a noun) |
| عَلَمَ | عَلِمَ / عَلَمٌ |
| عَمَلَ | عَمِلَ / عَمَلٌ |
| بَحَرَ | بَحْرٌ (a noun) |
| رَكَبَ | رَكِبَ |
| شَرَبَ | شَرِبَ |

4. **Every mixed-stage word** must be a real word, correct and suitable for a child. Two are held for suitability (below).

## Left out

Stage-4 items that are not words as the old lesson vowelled them. They are not corrected by guesswork; a teacher may add the real word.

| Old item | Probably meant |
|---|---|
| كَتِبَ | كَتَبَ |
| بُرِزَ | بَرَزَ |
| بَدُرَ | بَدَرَ |
| نَجِحَ | نَجَحَ |
| عَرِفَ | عَرَفَ |
| رَجُلَ | رَجُلٌ (a noun) |
| نُظِفَ | نُظِّفَ (a shadda) |
| رُتِبَ | رُتِّبَ (a shadda) |

- **دَرَسَ** appeared in both the fatha and the mixed stage; kept once, in fatha.

## Held

| Id | Item | Why |
|---|---|---|
| mixed-020 | ضُرِبَ | CHECK: «was beaten» -- suitable for a young child's reading drill? |
| mixed-022 | قُتِلَ | CHECK: «was killed» -- suitable for a young child's reading drill? |

## The quiz

Each question asks «which one is all fatha / kasra / damma?». The right answer is the old final test's item; the two wrong options are items of the SAME kind (drills with drills, words with words) from the other stages, the same letters where the lesson has them. CI proves exactly one option carries the stage's vowel on every letter. The old test's mixed-stage words cannot be asked this way and are not carried as questions.

| Id | Options | Right answer |
|---|---|---|
| fatha-q1 | بَتَ، بِتِ، بُتُ | بَتَ |
| fatha-q2 | دِرِ، دَرَ، دُرُ | دَرَ |
| fatha-q3 | سِمِ، سُمُ، سَمَ | سَمَ |
| fatha-q4 | نَبَ، نِبِ، نُبُ | نَبَ |
| fatha-q5 | كِتِ، كَتَ، كُتُ | كَتَ |
| fatha-q6 | نُظِرَ، سَمِعَ، نَبَتَ | نَبَتَ |
| fatha-q7 | كَتَبَ، كُتِبَ، نُظِرَ | كَتَبَ |
| fatha-q8 | كِتِبِ، جَمَلَ، نِمِرِ | جَمَلَ |
| fatha-q9 | نُظِرَ، سَمِعَ، سَبَحَ | سَبَحَ |
| fatha-q10 | دَرَسَ، نُظِرَ، سَمِعَ | دَرَسَ |
| kasra-q1 | بِتِ، بَتَ، بُتُ | بِتِ |
| kasra-q2 | دَرَ، دِرِ، دُرُ | دِرِ |
| kasra-q3 | سَمَ، سُمُ، سِمِ | سِمِ |
| kasra-q4 | كِتِبِ، كُتُبُ، جَمَلَ | كِتِبِ |
| kasra-q5 | جَمَلَ، نِمِرِ، فَرَحَ | نِمِرِ |
| damma-q1 | بُتُ، بَتَ، بِتِ | بُتُ |
| damma-q2 | دَرَ، دُرُ، دِرِ | دُرُ |
| damma-q3 | كِتِبِ، جَمَلَ، كُتُبُ | كُتُبُ |
| damma-q4 | نُطُقُ، جَمَلَ، فَرَحَ | نُطُقُ |

## Every item

| Id | Item | Kind | Held because |
|---|---|---|---|
| fatha-001 | بَتَ | مَقَاطِعُ (drill) | — |
| fatha-002 | دَرَ | مَقَاطِعُ (drill) | — |
| fatha-003 | سَمَ | مَقَاطِعُ (drill) | — |
| fatha-004 | نَبَ | مَقَاطِعُ (drill) | — |
| fatha-005 | كَتَ | مَقَاطِعُ (drill) | — |
| fatha-006 | جَمَ | مَقَاطِعُ (drill) | — |
| fatha-007 | سَبَ | مَقَاطِعُ (drill) | — |
| fatha-008 | حَمَ | مَقَاطِعُ (drill) | — |
| fatha-009 | فَرَ | مَقَاطِعُ (drill) | — |
| fatha-010 | لَبَ | مَقَاطِعُ (drill) | — |
| fatha-011 | رَمَ | مَقَاطِعُ (drill) | — |
| fatha-012 | قَدَ | مَقَاطِعُ (drill) | — |
| fatha-013 | هَبَ | مَقَاطِعُ (drill) | — |
| fatha-014 | وَرَ | مَقَاطِعُ (drill) | — |
| fatha-015 | طَبَ | مَقَاطِعُ (drill) | — |
| fatha-016 | ظَهَ | مَقَاطِعُ (drill) | — |
| fatha-017 | عَلَ | مَقَاطِعُ (drill) | — |
| fatha-018 | غَرَ | مَقَاطِعُ (drill) | — |
| fatha-019 | صَبَ | مَقَاطِعُ (drill) | — |
| fatha-020 | ضَرَ | مَقَاطِعُ (drill) | — |
| fatha-021 | نَبَتَ | كَلِمَةٌ (word) | — |
| fatha-022 | كَتَبَ | كَلِمَةٌ (word) | — |
| fatha-023 | جَمَلَ | مَقَاطِعُ (drill) | — |
| fatha-024 | سَبَحَ | كَلِمَةٌ (word) | — |
| fatha-025 | دَرَسَ | كَلِمَةٌ (word) | — |
| fatha-026 | حَمَلَ | كَلِمَةٌ (word) | — |
| fatha-027 | فَرَحَ | مَقَاطِعُ (drill) | — |
| fatha-028 | لَبَسَ | مَقَاطِعُ (drill) | — |
| fatha-029 | رَمَلَ | مَقَاطِعُ (drill) | — |
| fatha-030 | قَدَرَ | كَلِمَةٌ (word) | — |
| fatha-031 | هَبَطَ | كَلِمَةٌ (word) | — |
| fatha-032 | وَرَدَ | كَلِمَةٌ (word) | — |
| fatha-033 | طَبَخَ | كَلِمَةٌ (word) | — |
| fatha-034 | ظَهَرَ | كَلِمَةٌ (word) | — |
| fatha-035 | عَلَمَ | مَقَاطِعُ (drill) | — |
| fatha-036 | غَرَسَ | كَلِمَةٌ (word) | — |
| fatha-037 | صَبَرَ | كَلِمَةٌ (word) | — |
| fatha-038 | ضَرَبَ | كَلِمَةٌ (word) | — |
| fatha-039 | خَرَجَ | كَلِمَةٌ (word) | — |
| fatha-040 | دَخَلَ | كَلِمَةٌ (word) | — |
| fatha-041 | فَتَحَ | كَلِمَةٌ (word) | — |
| fatha-042 | مَسَحَ | كَلِمَةٌ (word) | — |
| fatha-043 | نَشَرَ | كَلِمَةٌ (word) | — |
| fatha-044 | بَدَأَ | كَلِمَةٌ (word) | — |
| fatha-045 | حَفَرَ | كَلِمَةٌ (word) | — |
| fatha-046 | سَكَنَ | كَلِمَةٌ (word) | — |
| fatha-047 | عَمَلَ | مَقَاطِعُ (drill) | — |
| fatha-048 | بَحَرَ | مَقَاطِعُ (drill) | — |
| fatha-049 | جَبَلَ | مَقَاطِعُ (drill) | — |
| fatha-050 | حَصَدَ | كَلِمَةٌ (word) | — |
| fatha-051 | خَبَزَ | كَلِمَةٌ (word) | — |
| fatha-052 | ذَهَبَ | كَلِمَةٌ (word) | — |
| fatha-053 | رَكَبَ | مَقَاطِعُ (drill) | — |
| fatha-054 | زَرَعَ | كَلِمَةٌ (word) | — |
| fatha-055 | شَرَبَ | مَقَاطِعُ (drill) | — |
| fatha-056 | طَلَبَ | كَلِمَةٌ (word) | — |
| kasra-001 | بِتِ | مَقَاطِعُ (drill) | — |
| kasra-002 | دِرِ | مَقَاطِعُ (drill) | — |
| kasra-003 | سِمِ | مَقَاطِعُ (drill) | — |
| kasra-004 | نِبِ | مَقَاطِعُ (drill) | — |
| kasra-005 | كِتِ | مَقَاطِعُ (drill) | — |
| kasra-006 | جِمِ | مَقَاطِعُ (drill) | — |
| kasra-007 | سِبِ | مَقَاطِعُ (drill) | — |
| kasra-008 | حِمِ | مَقَاطِعُ (drill) | — |
| kasra-009 | فِرِ | مَقَاطِعُ (drill) | — |
| kasra-010 | لِبِ | مَقَاطِعُ (drill) | — |
| kasra-011 | رِمِ | مَقَاطِعُ (drill) | — |
| kasra-012 | قِدِ | مَقَاطِعُ (drill) | — |
| kasra-013 | هِبِ | مَقَاطِعُ (drill) | — |
| kasra-014 | وِرِ | مَقَاطِعُ (drill) | — |
| kasra-015 | طِبِ | مَقَاطِعُ (drill) | — |
| kasra-016 | ظِهِ | مَقَاطِعُ (drill) | — |
| kasra-017 | عِلِ | مَقَاطِعُ (drill) | — |
| kasra-018 | غِرِ | مَقَاطِعُ (drill) | — |
| kasra-019 | صِبِ | مَقَاطِعُ (drill) | — |
| kasra-020 | ضِرِ | مَقَاطِعُ (drill) | — |
| kasra-021 | كِتِبِ | مَقَاطِعُ (drill) | — |
| kasra-022 | نِمِرِ | مَقَاطِعُ (drill) | — |
| kasra-023 | حِمِلِ | مَقَاطِعُ (drill) | — |
| kasra-024 | فِرِحِ | مَقَاطِعُ (drill) | — |
| kasra-025 | لِبِسِ | مَقَاطِعُ (drill) | — |
| kasra-026 | رِمِلِ | مَقَاطِعُ (drill) | — |
| kasra-027 | قِدِرِ | مَقَاطِعُ (drill) | — |
| kasra-028 | هِبِطِ | مَقَاطِعُ (drill) | — |
| kasra-029 | وِرِدِ | مَقَاطِعُ (drill) | — |
| kasra-030 | طِبِخِ | مَقَاطِعُ (drill) | — |
| kasra-031 | ظِهِرِ | مَقَاطِعُ (drill) | — |
| kasra-032 | عِلِمِ | مَقَاطِعُ (drill) | — |
| kasra-033 | غِرِسِ | مَقَاطِعُ (drill) | — |
| kasra-034 | صِبِرِ | مَقَاطِعُ (drill) | — |
| kasra-035 | ضِرِبِ | مَقَاطِعُ (drill) | — |
| kasra-036 | خِرِجِ | مَقَاطِعُ (drill) | — |
| kasra-037 | دِخِلِ | مَقَاطِعُ (drill) | — |
| kasra-038 | فِتِحِ | مَقَاطِعُ (drill) | — |
| kasra-039 | مِسِحِ | مَقَاطِعُ (drill) | — |
| kasra-040 | نِشِرِ | مَقَاطِعُ (drill) | — |
| kasra-041 | حِفِرِ | مَقَاطِعُ (drill) | — |
| kasra-042 | سِكِنِ | مَقَاطِعُ (drill) | — |
| kasra-043 | عِمِلِ | مَقَاطِعُ (drill) | — |
| kasra-044 | بِحِرِ | مَقَاطِعُ (drill) | — |
| kasra-045 | جِبِلِ | مَقَاطِعُ (drill) | — |
| kasra-046 | حِصِدِ | مَقَاطِعُ (drill) | — |
| kasra-047 | خِبِزِ | مَقَاطِعُ (drill) | — |
| kasra-048 | ذِهِبِ | مَقَاطِعُ (drill) | — |
| kasra-049 | رِكِبِ | مَقَاطِعُ (drill) | — |
| kasra-050 | زِرِعِ | مَقَاطِعُ (drill) | — |
| kasra-051 | شِرِبِ | مَقَاطِعُ (drill) | — |
| kasra-052 | طِلِبِ | مَقَاطِعُ (drill) | — |
| kasra-053 | فِهِمِ | مَقَاطِعُ (drill) | — |
| kasra-054 | عِرِفِ | مَقَاطِعُ (drill) | — |
| kasra-055 | سِمِعِ | مَقَاطِعُ (drill) | — |
| kasra-056 | نِظِرِ | مَقَاطِعُ (drill) | — |
| damma-001 | بُتُ | مَقَاطِعُ (drill) | — |
| damma-002 | دُرُ | مَقَاطِعُ (drill) | — |
| damma-003 | سُمُ | مَقَاطِعُ (drill) | — |
| damma-004 | نُبُ | مَقَاطِعُ (drill) | — |
| damma-005 | كُتُ | مَقَاطِعُ (drill) | — |
| damma-006 | جُمُ | مَقَاطِعُ (drill) | — |
| damma-007 | سُبُ | مَقَاطِعُ (drill) | — |
| damma-008 | حُمُ | مَقَاطِعُ (drill) | — |
| damma-009 | فُرُ | مَقَاطِعُ (drill) | — |
| damma-010 | لُبُ | مَقَاطِعُ (drill) | — |
| damma-011 | رُمُ | مَقَاطِعُ (drill) | — |
| damma-012 | قُدُ | مَقَاطِعُ (drill) | — |
| damma-013 | هُبُ | مَقَاطِعُ (drill) | — |
| damma-014 | وُرُ | مَقَاطِعُ (drill) | — |
| damma-015 | طُبُ | مَقَاطِعُ (drill) | — |
| damma-016 | ظُهُ | مَقَاطِعُ (drill) | — |
| damma-017 | عُلُ | مَقَاطِعُ (drill) | — |
| damma-018 | غُرُ | مَقَاطِعُ (drill) | — |
| damma-019 | صُبُ | مَقَاطِعُ (drill) | — |
| damma-020 | ضُرُ | مَقَاطِعُ (drill) | — |
| damma-021 | كُتُبُ | مَقَاطِعُ (drill) | — |
| damma-022 | نُطُقُ | مَقَاطِعُ (drill) | — |
| damma-023 | حُمُلُ | مَقَاطِعُ (drill) | — |
| damma-024 | فُرُحُ | مَقَاطِعُ (drill) | — |
| damma-025 | لُبُسُ | مَقَاطِعُ (drill) | — |
| damma-026 | رُمُلُ | مَقَاطِعُ (drill) | — |
| damma-027 | قُدُرُ | مَقَاطِعُ (drill) | — |
| damma-028 | هُبُطُ | مَقَاطِعُ (drill) | — |
| damma-029 | وُرُدُ | مَقَاطِعُ (drill) | — |
| damma-030 | طُبُخُ | مَقَاطِعُ (drill) | — |
| damma-031 | ظُهُرُ | مَقَاطِعُ (drill) | — |
| damma-032 | عُلُمُ | مَقَاطِعُ (drill) | — |
| damma-033 | غُرُسُ | مَقَاطِعُ (drill) | — |
| damma-034 | صُبُرُ | مَقَاطِعُ (drill) | — |
| damma-035 | ضُرُبُ | مَقَاطِعُ (drill) | — |
| damma-036 | خُرُجُ | مَقَاطِعُ (drill) | — |
| damma-037 | دُخُلُ | مَقَاطِعُ (drill) | — |
| damma-038 | فُتُحُ | مَقَاطِعُ (drill) | — |
| damma-039 | مُسُحُ | مَقَاطِعُ (drill) | — |
| damma-040 | نُشُرُ | مَقَاطِعُ (drill) | — |
| damma-041 | حُفُرُ | مَقَاطِعُ (drill) | — |
| damma-042 | سُكُنُ | مَقَاطِعُ (drill) | — |
| damma-043 | عُمُلُ | مَقَاطِعُ (drill) | — |
| damma-044 | بُحُرُ | مَقَاطِعُ (drill) | — |
| damma-045 | جُبُلُ | مَقَاطِعُ (drill) | — |
| damma-046 | حُصُدُ | مَقَاطِعُ (drill) | — |
| damma-047 | خُبُزُ | مَقَاطِعُ (drill) | — |
| damma-048 | ذُهُبُ | مَقَاطِعُ (drill) | — |
| damma-049 | رُكُبُ | مَقَاطِعُ (drill) | — |
| damma-050 | زُرُعُ | مَقَاطِعُ (drill) | — |
| damma-051 | شُرُبُ | مَقَاطِعُ (drill) | — |
| damma-052 | طُلُبُ | مَقَاطِعُ (drill) | — |
| damma-053 | فُهُمُ | مَقَاطِعُ (drill) | — |
| damma-054 | عُرُفُ | مَقَاطِعُ (drill) | — |
| damma-055 | سُمُعُ | مَقَاطِعُ (drill) | — |
| damma-056 | نُظُرُ | مَقَاطِعُ (drill) | — |
| mixed-001 | نُظِرَ | كَلِمَةٌ (word) | — |
| mixed-002 | سَمِعَ | كَلِمَةٌ (word) | — |
| mixed-003 | كُتِبَ | كَلِمَةٌ (word) | — |
| mixed-004 | فَهِمَ | كَلِمَةٌ (word) | — |
| mixed-005 | حَسِبَ | كَلِمَةٌ (word) | — |
| mixed-006 | لَعِبَ | كَلِمَةٌ (word) | — |
| mixed-007 | شَرِبَ | كَلِمَةٌ (word) | — |
| mixed-008 | ضَحِكَ | كَلِمَةٌ (word) | — |
| mixed-009 | فَرِحَ | كَلِمَةٌ (word) | — |
| mixed-010 | سَكُتَ | كَلِمَةٌ (word) | — |
| mixed-011 | كَبُرَ | كَلِمَةٌ (word) | — |
| mixed-012 | صَغُرَ | كَلِمَةٌ (word) | — |
| mixed-013 | بَعُدَ | كَلِمَةٌ (word) | — |
| mixed-014 | قَرُبَ | كَلِمَةٌ (word) | — |
| mixed-015 | حَسُنَ | كَلِمَةٌ (word) | — |
| mixed-016 | عُلِمَ | كَلِمَةٌ (word) | — |
| mixed-017 | فُهِمَ | كَلِمَةٌ (word) | — |
| mixed-018 | كُسِرَ | كَلِمَةٌ (word) | — |
| mixed-019 | فُتِحَ | كَلِمَةٌ (word) | — |
| mixed-020 | ضُرِبَ | كَلِمَةٌ (word) | CHECK: «was beaten» -- suitable for a young child's reading drill? |
| mixed-021 | سُمِعَ | كَلِمَةٌ (word) | — |
| mixed-022 | قُتِلَ | كَلِمَةٌ (word) | CHECK: «was killed» -- suitable for a young child's reading drill? |
| mixed-023 | جَلَسَ | كَلِمَةٌ (word) | — |
| mixed-024 | حَفِظَ | كَلِمَةٌ (word) | — |
| mixed-025 | نَشِطَ | كَلِمَةٌ (word) | — |
| mixed-026 | تَعِبَ | كَلِمَةٌ (word) | — |
| mixed-027 | مَرِضَ | كَلِمَةٌ (word) | — |
| mixed-028 | غَضِبَ | كَلِمَةٌ (word) | — |
| mixed-029 | كَرُمَ | كَلِمَةٌ (word) | — |
| mixed-030 | شَرُفَ | كَلِمَةٌ (word) | — |
| mixed-031 | عَظُمَ | كَلِمَةٌ (word) | — |
| mixed-032 | ظَرُفَ | كَلِمَةٌ (word) | — |
| mixed-033 | لَطُفَ | كَلِمَةٌ (word) | — |
| mixed-034 | خُبِزَ | كَلِمَةٌ (word) | — |
| mixed-035 | طُبِخَ | كَلِمَةٌ (word) | — |
| mixed-036 | غُسِلَ | كَلِمَةٌ (word) | — |
| mixed-037 | حُفِظَ | كَلِمَةٌ (word) | — |
| mixed-038 | سَأَلَ | كَلِمَةٌ (word) | — |
| mixed-039 | جَمَعَ | كَلِمَةٌ (word) | — |
| mixed-040 | وَضَعَ | كَلِمَةٌ (word) | — |
| mixed-041 | رَفَعَ | كَلِمَةٌ (word) | — |
| mixed-042 | قَطَعَ | كَلِمَةٌ (word) | — |
| mixed-043 | مَنَعَ | كَلِمَةٌ (word) | — |
| mixed-044 | عَجِبَ | كَلِمَةٌ (word) | — |
| mixed-045 | رَكِبَ | كَلِمَةٌ (word) | — |
| mixed-046 | هَرِبَ | كَلِمَةٌ (word) | — |
| mixed-047 | طَرِبَ | كَلِمَةٌ (word) | — |
