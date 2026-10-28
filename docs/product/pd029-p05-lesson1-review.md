# PD-29 P0-5: Arabic lesson 1 (the letters), lines held for teacher review

This file is generated from `apps/lessons/src/arabic/lesson-001.json` and the rebuild's report. Do not edit it by hand.

- The lesson was rewritten as data from the old lesson (jawwid-lessons @ c231532, `arabic/lesson-1/lib/lessonData.ts`). The old lesson was read as text only, never built or run. The rebuild follows `pd029-p05-arabic-letters-design.md`.
- The file is **pending**: the lesson page shows nothing of it until the Teachers department approves it.
- A held line is never shown. A spelling held anywhere is held everywhere, and so is any quiz question that shows it.

## Summary

| | |
|---|---|
| Units | 32 |
| Words | 1521 |
| Held | 1416 |
| Clean (unchanged from the old lesson) | 105 |
| Dropped, for a teacher | 4 |
| Moved to their real letter | 29 |
| Old duplicates removed | 87 |
| Quiz questions | 64 |

**Why words are held:**

- 1402: ADDED TASHKEEL: final sukun
- 12: ADDED TASHKEEL: final vowel replaced by the pausal sukun
- 1: SUSPECT: non-standard spelling of سَمَاء
- 1: SUSPECT: usually spelled مُوسِيقَى

Almost every hold is the one final mark, the pausal sukun. That is the owner's decision of 2026-10-28; teachers check each word, not the convention. Clearing a word means setting its `review` and `was` to null, in a reviewed commit.

## Decisions for the teachers

1. **The words below.** Every word must be a real word, suitable for a child, spelled correctly and fully vowelled. The checker has already proved three things: each word holds its unit's letter, each is fully vowelled, and each ends in the pausal sukun.
2. **The suspected words** (next section), held with a reason.
3. **The two notes**: drafts written by the rebuild, held.
4. **The unit names**, including the three new two-word names.
5. **The engine's own wording** (questions and feedback, from `ui-text.ts`).
6. **The quiz**: two questions per unit, built from the unit's own words.

## Suspected words (held)

| Unit | Word | Why |
|---|---|---|
| alif | سَمَا | non-standard spelling of سَمَاء |
| alif | مُوسِيقَا | usually spelled مُوسِيقَى |
| hamza | فِإِنَّ | wrong vowel: فَإِنَّ |
| hamza | بُرُوء | not a standard word |
| hamza | نُبُوء | not a standard word |
| hamza | دُرُوء | not a standard word |
| hamza | ظُهُوء | not a standard word |
| lam_alif | لَابُدّ | two words (لَا بُدَّ), not one |

## Dropped (not in the file; a teacher adds them back if wanted)

| Old unit | Word | Why |
|---|---|---|
| ta | بَطَاطَا | does not contain ت |
| zay | نَظِيفَة | does not contain ز |
| hamza | تَلَألُؤ | internal mark missing (letter 3 (أ)): needs a teacher |
| hamza | مُتَلَألِئ | internal mark missing (letter 4 (أ)): needs a teacher |

## Moved to the letter they really hold

The old alif 'start' words all begin with أ, so they belong to the hamza unit. The old ت entry's ة words belong to the new ta marbuta unit.

- alif → hamza: أَسَد، أَرْنَب، أُمّ، أَخْطَبُوط، أُذُن، أَرْض، أَمِير، أَخْضَر، أَبْيَض، أَصْفَر، أَحْمَد
- ta → ta_marbuta: مُعَلِّمَة، حَقِيبَة، سَمَكَة، وَرْدَة، قِطَّة، بَقَرَة، دَجَاجَة، شَجَرَة، زَهْرَة، نَجْمَة، مَدْرَسَة، حَدِيقَة، سَيَّارَة، طَائِرَة، فَرَاشَة، نَحْلَة، مُعَلِّمَة، طَبِيبَة

## Unit names

| Unit | Old | New |
|---|---|---|
| alif | أَلِف | أَلِفْ |
| ba | بَاء | بَاءْ |
| ta | تَاء | تَاءْ |
| tha | ثَاء | ثَاءْ |
| jim | جِيم | جِيمْ |
| hha | حَاء | حَاءْ |
| kha | خَاء | خَاءْ |
| dal | دَال | دَالْ |
| dhal | ذَال | ذَالْ |
| ra | رَاء | رَاءْ |
| zay | زَاي | زَايْ |
| sin | سِين | سِينْ |
| shin | شِين | شِينْ |
| sad | صَاد | صَادْ |
| dad | ضَاد | ضَادْ |
| tta | طَاء | طَاءْ |
| zza | ظَاء | ظَاءْ |
| ain | عَيْن | عَيْنْ |
| ghain | غَيْن | غَيْنْ |
| fa | فَاء | فَاءْ |
| qaf | قَاف | قَافْ |
| kaf | كَاف | كَافْ |
| lam | لَام | لَامْ |
| mim | مِيم | مِيمْ |
| nun | نُون | نُونْ |
| ha | هَاء | هَاءْ |
| waw | وَاو | وَاوْ |
| ya | يَاء | يَاءْ |
| ta_marbuta | تَاء مَرْبُوطَة (a special form of ت) | تَاءٌ مَرْبُوطَةْ |
| hamza | هَمْزَة (and four seat entries) | هَمْزَةْ |
| alif_maqsura | أَلِف مَقْصُورَة | أَلِفٌ مَقْصُورَةْ |
| lam_alif | لَام أَلِف | لَامُ أَلِفْ |

## Notes (authored drafts, held)

- **alif**: لَا تَبْدَأُ كَلِمَةٌ بِأَلِفٍ عَلَيْهَا حَرَكَةٌ، بَلْ بِهَمْزَةٍ عَلَى الْأَلِفِ: أَسَدْ، إِبْرَةْ.
  - AUTHORED DRAFT by the rebuild: a teacher writes or approves it. Note that hamzat al-wasl words (اِسْم، اِبْن) are written with a bare alif; lesson 1 leaves them out.
- **hamza**: الْهَمْزَةُ حَرْفٌ وَاحِدٌ يُكْتَبُ بِخَمْسِ صُوَرٍ.
  - AUTHORED DRAFT by the rebuild: a teacher writes or approves it (the five seats are its forms).

## The engine's own wording (`apps/lessons/src/arabic/ui-text.ts`)

- فِي أَوَّلِ الْكَلِمَةِ
- فِي وَسَطِ الْكَلِمَةِ
- فِي آخِرِ الْكَلِمَةِ
- أَيُّ كَلِمَةٍ فِيهَا حَرْفُ «${name}»؟
- أَيْنَ حَرْفُ «${name}» فِي هٰذِهِ الْكَلِمَةِ؟
- اُنْقُرْ عَلَى حَرْفِ «${name}».
- اِخْتَرْ كُلَّ كَلِمَةٍ فِيهَا حَرْفُ «${name}».
- أَشْكَالُ الْحَرْفِ
- أَحْسَنْتَ!
- حَاوِلْ مَرَّةً أُخْرَى.
- التَّالِي
- تَحَقَّقْ
- لَيْسَ بَعْدُ، اُنْظُرْ مَرَّةً أُخْرَى.
- أَنْهَيْتُ

## The quiz, per unit

| Unit | Id | Kind | Question shows | Options | Right answer |
|---|---|---|---|---|---|
| alif | alif-q1 | which word has the letter | — | مُوسِيقَى، صَبِي، دُنْيَا | دُنْيَا |
| alif | alif-q2 | where is the letter | عُلْيَا | start / middle / end | end |
| ba | ba-q1 | which word has the letter | — | كَنَدَا، صَلَّا، صَبِي | صَبِي |
| ba | ba-q2 | where is the letter | صَبِي | start / middle / end | middle |
| ta | ta-q1 | which word has the letter | — | عَطْشَى، مَرْضَى، تُفَّاحْ | تُفَّاحْ |
| ta | ta-q2 | where is the letter | تَمْرْ | start / middle / end | start |
| ta_marbuta | ta_marbuta-q1 | which word has the letter | — | مُعَلِّمَةْ، حُسْنَى، قَتْلَى | مُعَلِّمَةْ |
| ta_marbuta | ta_marbuta-q2 | where is the letter | حَقِيبَةْ | start / middle / end | end |
| tha | tha-q1 | which word has the letter | — | ثَانِي، حُلَا، طَلَّا | ثَانِي |
| tha | tha-q2 | where is the letter | ثَانِي | start / middle / end | start |
| jim | jim-q1 | which word has the letter | — | عَطْشَى، مَرْضَى، جُنْدِي | جُنْدِي |
| jim | jim-q2 | where is the letter | جُنْدِي | start / middle / end | start |
| hha | hha-q1 | which word has the letter | — | لَيَالِي، هَادِي، حَلْوَى | حَلْوَى |
| hha | hha-q2 | where is the letter | حَلْوَى | start / middle / end | start |
| kha | kha-q1 | which word has the letter | — | فَتْوَى، رَضْوَى، خُبْزْ | خُبْزْ |
| kha | kha-q2 | where is the letter | خَرُوفْ | start / middle / end | start |
| dal | dal-q1 | which word has the letter | — | مُصْطَفَى، بُشْرَى، دُبّْ | دُبّْ |
| dal | dal-q2 | where is the letter | دَجَاجَةْ | start / middle / end | start |
| dhal | dhal-q1 | which word has the letter | — | مُوسِيقَى، ذِكْرَى، هَادِي | ذِكْرَى |
| dhal | dhal-q2 | where is the letter | ذِكْرَى | start / middle / end | start |
| ra | ra-q1 | which word has the letter | — | لَيْلَى، مُوسَى، رَجُلْ | رَجُلْ |
| ra | ra-q2 | where is the letter | رُمَّانْ | start / middle / end | start |
| zay | zay-q1 | which word has the letter | — | نَجْوَى، خُزَامَى، مَأْوَى | خُزَامَى |
| zay | zay-q2 | where is the letter | خُزَامَى | start / middle / end | middle |
| sin | sin-q1 | which word has the letter | — | مَرْضَى، هُدَى، سَمَكَةْ | سَمَكَةْ |
| sin | sin-q2 | where is the letter | سَيَّارَةْ | start / middle / end | start |
| shin | shin-q1 | which word has the letter | — | رَاضِي، صَبِي، شَمْسْ | شَمْسْ |
| shin | shin-q2 | where is the letter | شَجَرَةْ | start / middle / end | start |
| sad | sad-q1 | which word has the letter | — | مُوسِيقَى، خُزَامَى، صَقْرْ | صَقْرْ |
| sad | sad-q2 | where is the letter | صَبَاحْ | start / middle / end | start |
| dad | dad-q1 | which word has the letter | — | جَرْحَى، كُبْرَى، قَاضِي | قَاضِي |
| dad | dad-q2 | where is the letter | رَاضِي | start / middle / end | middle |
| tta | tta-q1 | which word has the letter | — | بُشْرَى، حَيْرَى، بَطَاطَا | بَطَاطَا |
| tta | tta-q2 | where is the letter | بَطَاطَا | start / middle / end | middle |
| zza | zza-q1 | which word has the letter | — | ظَبْيْ، فَإِذَا، صُغْرَى | ظَبْيْ |
| zza | zza-q2 | where is the letter | ظِلّْ | start / middle / end | start |
| ain | ain-q1 | which word has the letter | — | عَيْنْ، غَضْبَى، ذِكْرَى | عَيْنْ |
| ain | ain-q2 | where is the letter | عُصْفُورْ | start / middle / end | start |
| ghain | ghain-q1 | which word has the letter | — | بُشْرَى، حَيْرَى، غُرَابْ | غُرَابْ |
| ghain | ghain-q2 | where is the letter | غَزَالْ | start / middle / end | start |
| fa | fa-q1 | which word has the letter | — | وَلَّا، عُلَا، فِيلْ | فِيلْ |
| fa | fa-q2 | where is the letter | فَرَاشَةْ | start / middle / end | start |
| qaf | qaf-q1 | which word has the letter | — | دَلَّا، مَلَا، مُوسِيقَى | مُوسِيقَى |
| qaf | qaf-q2 | where is the letter | مُوسِيقَى | start / middle / end | middle |
| kaf | kaf-q1 | which word has the letter | — | رَضْوَى، ذِكْرَى، دَعْوَى | ذِكْرَى |
| kaf | kaf-q2 | where is the letter | بَكَى | start / middle / end | middle |
| lam | lam-q1 | which word has the letter | — | مَعَانِي، رَاعِي، لَيْمُونْ | لَيْمُونْ |
| lam | lam-q2 | where is the letter | لُعْبَةْ | start / middle / end | start |
| mim | mim-q1 | which word has the letter | — | خَلَا، فَتْوَى، مُوسِيقَى | مُوسِيقَى |
| mim | mim-q2 | where is the letter | مُوسِيقَى | start / middle / end | start |
| nun | nun-q1 | which word has the letter | — | أَفْرِيقْيَا، ثَانِي، ذِكْرَى | ثَانِي |
| nun | nun-q2 | where is the letter | ثَانِي | start / middle / end | middle |
| ha | ha-q1 | which word has the letter | — | مُوسَى، لَيَالِي، هِلَالْ | هِلَالْ |
| ha | ha-q2 | where is the letter | هَدِيَّةْ | start / middle / end | start |
| waw | waw-q1 | which word has the letter | — | هَدُو، ثَانِي، أَغَانِي | هَدُو |
| waw | waw-q2 | where is the letter | هَدُو | start / middle / end | end |
| ya | ya-q1 | which word has the letter | — | قَاضِي، وَلَّا، خُزَامَى | قَاضِي |
| ya | ya-q2 | where is the letter | رَاعِي | start / middle / end | end |
| hamza | hamza-q1 | which word has the letter | — | ذِكْرَى، عَطْشَى، وَإِذَا | وَإِذَا |
| hamza | hamza-q2 | where is the letter | فَإِذَا | start / middle / end | middle |
| alif_maqsura | alif_maqsura-q1 | which word has the letter | — | لِيبْيَا، فَتَى، ثَانِي | فَتَى |
| alif_maqsura | alif_maqsura-q2 | where is the letter | هُدَى | start / middle / end | end |
| lam_alif | lam_alif-q1 | which word has the letter | — | تَقْوَى، لَا، مُسْتَوَى | لَا |
| lam_alif | lam_alif-q2 | where is the letter | حَلَّا | start / middle / end | end |

## Every word, per unit

`was` is the old spelling where the rebuild changed it. A held word shows why it is held.

### alif: أَلِفْ (34 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| alif-001 | أَنَانَاسْ | أَنَانَاس | ADDED TASHKEEL: final sukun |
| alif-002 | أَزْهَارْ | أَزْهَار | ADDED TASHKEEL: final sukun |
| alif-003 | أَطْفَالْ | أَطْفَال | ADDED TASHKEEL: final sukun |
| alif-004 | أَقْلَامْ | أَقْلَام | ADDED TASHKEEL: final sukun |
| alif-005 | كِتَابْ | كِتَاب | ADDED TASHKEEL: final sukun |
| alif-006 | بَابْ | بَاب | ADDED TASHKEEL: final sukun |
| alif-007 | سَاعَةْ | سَاعَة | ADDED TASHKEEL: final sukun |
| alif-008 | نَارْ | نَار | ADDED TASHKEEL: final sukun |
| alif-009 | جَمَالْ | جَمَال | ADDED TASHKEEL: final sukun |
| alif-010 | حِمَارْ | حِمَار | ADDED TASHKEEL: final sukun |
| alif-011 | غُرَابْ | غُرَاب | ADDED TASHKEEL: final sukun |
| alif-012 | سَحَابْ | سَحَاب | ADDED TASHKEEL: final sukun |
| alif-013 | جَوَابْ | جَوَاب | ADDED TASHKEEL: final sukun |
| alif-014 | حِسَابْ | حِسَاب | ADDED TASHKEEL: final sukun |
| alif-015 | عِقَابْ | عِقَاب | ADDED TASHKEEL: final sukun |
| alif-016 | ثِيَابْ | ثِيَاب | ADDED TASHKEEL: final sukun |
| alif-017 | رِسَالَةْ | رِسَالَة | ADDED TASHKEEL: final sukun |
| alif-018 | مَقَالْ | مَقَال | ADDED TASHKEEL: final sukun |
| alif-019 | خِيَارْ | خِيَار | ADDED TASHKEEL: final sukun |
| alif-020 | سَمَا | — | SUSPECT: non-standard spelling of سَمَاء |
| alif-021 | دُنْيَا | — | — |
| alif-022 | عُلْيَا | — | — |
| alif-023 | مُوسِيقَا | — | SUSPECT: usually spelled مُوسِيقَى |
| alif-024 | كَنَدَا | — | — |
| alif-025 | فَرَنْسَا | — | — |
| alif-026 | أَمْرِيكَا | — | — |
| alif-027 | أَلْمَانْيَا | — | — |
| alif-028 | رُوسْيَا | — | — |
| alif-029 | أُورُوبَّا | — | — |
| alif-030 | أَفْرِيقْيَا | — | — |
| alif-031 | آسْيَا | — | — |
| alif-032 | تُرْكِيَا | — | — |
| alif-033 | سُورْيَا | — | — |
| alif-034 | لِيبْيَا | — | — |

### ba: بَاءْ (44 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ba-001 | بَابْ | بَاب | ADDED TASHKEEL: final sukun |
| ba-002 | بَيْتْ | بَيْت | ADDED TASHKEEL: final sukun |
| ba-003 | بَطَّةْ | بَطَّة | ADDED TASHKEEL: final sukun |
| ba-004 | بَقَرَةْ | بَقَرَة | ADDED TASHKEEL: final sukun |
| ba-005 | بُرْتُقَالْ | بُرْتُقَال | ADDED TASHKEEL: final sukun |
| ba-006 | بَحْرْ | بَحْر | ADDED TASHKEEL: final sukun |
| ba-007 | بِنْتْ | بِنْت | ADDED TASHKEEL: final sukun |
| ba-008 | بَالُونْ | بَالُون | ADDED TASHKEEL: final sukun |
| ba-009 | بِسْكُوتْ | بِسْكُوت | ADDED TASHKEEL: final sukun |
| ba-010 | بَطِّيخْ | بَطِّيخ | ADDED TASHKEEL: final sukun |
| ba-011 | بُومَةْ | بُومَة | ADDED TASHKEEL: final sukun |
| ba-012 | بَنَفْسَجْ | بَنَفْسَج | ADDED TASHKEEL: final sukun |
| ba-013 | بِئْرْ | بِئْر | ADDED TASHKEEL: final sukun |
| ba-014 | بَطَلْ | بَطَل | ADDED TASHKEEL: final sukun |
| ba-015 | بَرَكَةْ | بَرَكَة | ADDED TASHKEEL: final sukun |
| ba-016 | جَبَلْ | جَبَل | ADDED TASHKEEL: final sukun |
| ba-017 | سَبُورَةْ | سَبُورَة | ADDED TASHKEEL: final sukun |
| ba-018 | حَبْلْ | حَبْل | ADDED TASHKEEL: final sukun |
| ba-019 | كَبِيرْ | كَبِير | ADDED TASHKEEL: final sukun |
| ba-020 | صَبِي | — | — |
| ba-021 | لُبْنَانْ | لُبْنَان | ADDED TASHKEEL: final sukun |
| ba-022 | خُبْزْ | خُبْز | ADDED TASHKEEL: final sukun |
| ba-023 | رَبِيعْ | رَبِيع | ADDED TASHKEEL: final sukun |
| ba-024 | عَبِيرْ | عَبِير | ADDED TASHKEEL: final sukun |
| ba-025 | نَبَاتْ | نَبَات | ADDED TASHKEEL: final sukun |
| ba-026 | حَبِيبْ | حَبِيب | ADDED TASHKEEL: final sukun |
| ba-027 | سَبَّاحْ | سَبَّاح | ADDED TASHKEEL: final sukun |
| ba-028 | جَبَّارْ | جَبَّار | ADDED TASHKEEL: final sukun |
| ba-029 | مُبَارَكْ | مُبَارَك | ADDED TASHKEEL: final sukun |
| ba-030 | عَبَّاسْ | عَبَّاس | ADDED TASHKEEL: final sukun |
| ba-031 | كِتَابْ | كِتَاب | ADDED TASHKEEL: final sukun |
| ba-032 | حِسَابْ | حِسَاب | ADDED TASHKEEL: final sukun |
| ba-033 | ثَوْبْ | ثَوْب | ADDED TASHKEEL: final sukun |
| ba-034 | كَلْبْ | كَلْب | ADDED TASHKEEL: final sukun |
| ba-035 | أَرْنَبْ | أَرْنَب | ADDED TASHKEEL: final sukun |
| ba-036 | عِنَبْ | عِنَب | ADDED TASHKEEL: final sukun |
| ba-037 | ذَهَبْ | ذَهَب | ADDED TASHKEEL: final sukun |
| ba-038 | لَعِبْ | لَعِب | ADDED TASHKEEL: final sukun |
| ba-039 | حَلِيبْ | حَلِيب | ADDED TASHKEEL: final sukun |
| ba-040 | طَبِيبْ | طَبِيب | ADDED TASHKEEL: final sukun |
| ba-041 | رَقِيبْ | رَقِيب | ADDED TASHKEEL: final sukun |
| ba-042 | غُرُوبْ | غُرُوب | ADDED TASHKEEL: final sukun |
| ba-043 | جَنُوبْ | جَنُوب | ADDED TASHKEEL: final sukun |
| ba-044 | حَطَبْ | حَطَب | ADDED TASHKEEL: final sukun |

### ta: تَاءْ (41 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ta-001 | تُفَّاحْ | تُفَّاح | ADDED TASHKEEL: final sukun |
| ta-002 | تَمْرْ | تَمْر | ADDED TASHKEEL: final sukun |
| ta-003 | تَاجْ | تَاج | ADDED TASHKEEL: final sukun |
| ta-004 | تِينْ | تِين | ADDED TASHKEEL: final sukun |
| ta-005 | تُوتْ | تُوت | ADDED TASHKEEL: final sukun |
| ta-006 | تِمْسَاحْ | تِمْسَاح | ADDED TASHKEEL: final sukun |
| ta-007 | تَلْمِيذْ | تَلْمِيذ | ADDED TASHKEEL: final sukun |
| ta-008 | تُرَابْ | تُرَاب | ADDED TASHKEEL: final sukun |
| ta-009 | تَنِّينْ | تَنِّين | ADDED TASHKEEL: final sukun |
| ta-010 | تِلْفَازْ | تِلْفَاز | ADDED TASHKEEL: final sukun |
| ta-011 | تَمَارِينْ | تَمَارِين | ADDED TASHKEEL: final sukun |
| ta-012 | تَحِيَّةْ | تَحِيَّة | ADDED TASHKEEL: final sukun |
| ta-013 | تَنُّورْ | تَنُّور | ADDED TASHKEEL: final sukun |
| ta-014 | تَذْكِرَةْ | تَذْكِرَة | ADDED TASHKEEL: final sukun |
| ta-015 | تَسْبِيحْ | تَسْبِيح | ADDED TASHKEEL: final sukun |
| ta-016 | كِتَابْ | كِتَاب | ADDED TASHKEEL: final sukun |
| ta-017 | فَتَاةْ | فَتَاة | ADDED TASHKEEL: final sukun |
| ta-018 | زَيْتُونْ | زَيْتُون | ADDED TASHKEEL: final sukun |
| ta-019 | مَكْتَبَةْ | مَكْتَبَة | ADDED TASHKEEL: final sukun |
| ta-020 | بُسْتَانْ | بُسْتَان | ADDED TASHKEEL: final sukun |
| ta-021 | مِفْتَاحْ | مِفْتَاح | ADDED TASHKEEL: final sukun |
| ta-022 | خَاتَمْ | خَاتَم | ADDED TASHKEEL: final sukun |
| ta-023 | سِتَّةْ | سِتَّة | ADDED TASHKEEL: final sukun |
| ta-024 | مَكْتَبْ | مَكْتَب | ADDED TASHKEEL: final sukun |
| ta-025 | فُسْتَانْ | فُسْتَان | ADDED TASHKEEL: final sukun |
| ta-026 | كَتَبْ | كَتَبَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ta-027 | فَتَحْ | فَتَحَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ta-028 | بِنْتْ | بِنْت | ADDED TASHKEEL: final sukun |
| ta-029 | بَيْتْ | بَيْت | ADDED TASHKEEL: final sukun |
| ta-030 | وَقْتْ | وَقْت | ADDED TASHKEEL: final sukun |
| ta-031 | صَوْتْ | صَوْت | ADDED TASHKEEL: final sukun |
| ta-032 | زَيْتْ | زَيْت | ADDED TASHKEEL: final sukun |
| ta-033 | مَوْتْ | مَوْت | ADDED TASHKEEL: final sukun |
| ta-034 | نَبَاتْ | نَبَات | ADDED TASHKEEL: final sukun |
| ta-035 | حُوتْ | حُوت | ADDED TASHKEEL: final sukun |
| ta-036 | سَكَتْ | سَكَتَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ta-037 | كَتَبَتْ | كَتَبَت | ADDED TASHKEEL: final sukun |
| ta-038 | لَعِبَتْ | لَعِبَت | ADDED TASHKEEL: final sukun |
| ta-039 | جَلَسَتْ | جَلَسَت | ADDED TASHKEEL: final sukun |
| ta-040 | أَكَلَتْ | أَكَلَت | ADDED TASHKEEL: final sukun |
| ta-041 | نَامَتْ | نَامَت | ADDED TASHKEEL: final sukun |

### ta_marbuta: تَاءٌ مَرْبُوطَةْ (17 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ta_marbuta-001 | مُعَلِّمَةْ | مُعَلِّمَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-002 | حَقِيبَةْ | حَقِيبَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-003 | سَمَكَةْ | سَمَكَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-004 | وَرْدَةْ | وَرْدَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-005 | قِطَّةْ | قِطَّة | ADDED TASHKEEL: final sukun |
| ta_marbuta-006 | بَقَرَةْ | بَقَرَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-007 | دَجَاجَةْ | دَجَاجَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-008 | شَجَرَةْ | شَجَرَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-009 | زَهْرَةْ | زَهْرَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-010 | نَجْمَةْ | نَجْمَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-011 | مَدْرَسَةْ | مَدْرَسَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-012 | حَدِيقَةْ | حَدِيقَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-013 | سَيَّارَةْ | سَيَّارَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-014 | طَائِرَةْ | طَائِرَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-015 | فَرَاشَةْ | فَرَاشَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-016 | نَحْلَةْ | نَحْلَة | ADDED TASHKEEL: final sukun |
| ta_marbuta-017 | طَبِيبَةْ | طَبِيبَة | ADDED TASHKEEL: final sukun |

### tha: ثَاءْ (42 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| tha-001 | ثَعْلَبْ | ثَعْلَب | ADDED TASHKEEL: final sukun |
| tha-002 | ثَلْجْ | ثَلْج | ADDED TASHKEEL: final sukun |
| tha-003 | ثَوْبْ | ثَوْب | ADDED TASHKEEL: final sukun |
| tha-004 | ثَوْرْ | ثَوْر | ADDED TASHKEEL: final sukun |
| tha-005 | ثُومْ | ثُوم | ADDED TASHKEEL: final sukun |
| tha-006 | ثَمَرَةْ | ثَمَرَة | ADDED TASHKEEL: final sukun |
| tha-007 | ثَلَاثَةْ | ثَلَاثَة | ADDED TASHKEEL: final sukun |
| tha-008 | ثُعْبَانْ | ثُعْبَان | ADDED TASHKEEL: final sukun |
| tha-009 | ثَرِيدْ | ثَرِيد | ADDED TASHKEEL: final sukun |
| tha-010 | ثَابِتْ | ثَابِت | ADDED TASHKEEL: final sukun |
| tha-011 | ثَقِيلْ | ثَقِيل | ADDED TASHKEEL: final sukun |
| tha-012 | ثَمِينْ | ثَمِين | ADDED TASHKEEL: final sukun |
| tha-013 | ثَرْوَةْ | ثَرْوَة | ADDED TASHKEEL: final sukun |
| tha-014 | ثَانِي | — | — |
| tha-015 | ثِيَابْ | ثِيَاب | ADDED TASHKEEL: final sukun |
| tha-016 | كَثِيرْ | كَثِير | ADDED TASHKEEL: final sukun |
| tha-017 | مِثْلْ | مِثْل | ADDED TASHKEEL: final sukun |
| tha-018 | إِثْنَانْ | إِثْنَان | ADDED TASHKEEL: final sukun |
| tha-019 | أَثَاثْ | أَثَاث | ADDED TASHKEEL: final sukun |
| tha-020 | حَدِيثْ | حَدِيث | ADDED TASHKEEL: final sukun |
| tha-021 | مُثَلَّثْ | مُثَلَّث | ADDED TASHKEEL: final sukun |
| tha-022 | بَعْثَرَةْ | بَعْثَرَة | ADDED TASHKEEL: final sukun |
| tha-023 | تُرَاثْ | تُرَاث | ADDED TASHKEEL: final sukun |
| tha-024 | مَثَلْ | مَثَل | ADDED TASHKEEL: final sukun |
| tha-025 | عُثْمَانْ | عُثْمَان | ADDED TASHKEEL: final sukun |
| tha-026 | كُثْبَانْ | كُثْبَان | ADDED TASHKEEL: final sukun |
| tha-027 | مَثَانَةْ | مَثَانَة | ADDED TASHKEEL: final sukun |
| tha-028 | أُثْرِيَّةْ | أُثْرِيَّة | ADDED TASHKEEL: final sukun |
| tha-029 | جُثَّةْ | جُثَّة | ADDED TASHKEEL: final sukun |
| tha-030 | بَثّْ | بَثّ | ADDED TASHKEEL: final sukun |
| tha-031 | ثُلُثْ | ثُلُث | ADDED TASHKEEL: final sukun |
| tha-032 | بَحْثْ | بَحْث | ADDED TASHKEEL: final sukun |
| tha-033 | حَدَثْ | حَدَث | ADDED TASHKEEL: final sukun |
| tha-034 | ثَلَاثْ | ثَلَاث | ADDED TASHKEEL: final sukun |
| tha-035 | حَثّْ | حَثّ | ADDED TASHKEEL: final sukun |
| tha-036 | عَبَثْ | عَبَث | ADDED TASHKEEL: final sukun |
| tha-037 | غَيْثْ | غَيْث | ADDED TASHKEEL: final sukun |
| tha-038 | لَيْثْ | لَيْث | ADDED TASHKEEL: final sukun |
| tha-039 | حَارِثْ | حَارِث | ADDED TASHKEEL: final sukun |
| tha-040 | وَارِثْ | وَارِث | ADDED TASHKEEL: final sukun |
| tha-041 | بَاعِثْ | بَاعِث | ADDED TASHKEEL: final sukun |
| tha-042 | إِرْثْ | إِرْث | ADDED TASHKEEL: final sukun |

### jim: جِيمْ (45 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| jim-001 | جَمَلْ | جَمَل | ADDED TASHKEEL: final sukun |
| jim-002 | جَبَلْ | جَبَل | ADDED TASHKEEL: final sukun |
| jim-003 | جَزَرْ | جَزَر | ADDED TASHKEEL: final sukun |
| jim-004 | جُبْنْ | جُبْن | ADDED TASHKEEL: final sukun |
| jim-005 | جِسْرْ | جِسْر | ADDED TASHKEEL: final sukun |
| jim-006 | جَرَسْ | جَرَس | ADDED TASHKEEL: final sukun |
| jim-007 | جَنَّةْ | جَنَّة | ADDED TASHKEEL: final sukun |
| jim-008 | جَوَّالْ | جَوَّال | ADDED TASHKEEL: final sukun |
| jim-009 | جُنْدِي | — | — |
| jim-010 | جَامِعْ | جَامِع | ADDED TASHKEEL: final sukun |
| jim-011 | جَمِيلْ | جَمِيل | ADDED TASHKEEL: final sukun |
| jim-012 | جَدِيدْ | جَدِيد | ADDED TASHKEEL: final sukun |
| jim-013 | جَرِيدَةْ | جَرِيدَة | ADDED TASHKEEL: final sukun |
| jim-014 | جَزِيرَةْ | جَزِيرَة | ADDED TASHKEEL: final sukun |
| jim-015 | جِلْدْ | جِلْد | ADDED TASHKEEL: final sukun |
| jim-016 | نَجْمَةْ | نَجْمَة | ADDED TASHKEEL: final sukun |
| jim-017 | رِجْلْ | رِجْل | ADDED TASHKEEL: final sukun |
| jim-018 | دَجَاجَةْ | دَجَاجَة | ADDED TASHKEEL: final sukun |
| jim-019 | شُجَاعْ | شُجَاع | ADDED TASHKEEL: final sukun |
| jim-020 | مَسْجِدْ | مَسْجِد | ADDED TASHKEEL: final sukun |
| jim-021 | عَجِينْ | عَجِين | ADDED TASHKEEL: final sukun |
| jim-022 | فُجْلْ | فُجْل | ADDED TASHKEEL: final sukun |
| jim-023 | حَجَرْ | حَجَر | ADDED TASHKEEL: final sukun |
| jim-024 | سِجِلّْ | سِجِلّ | ADDED TASHKEEL: final sukun |
| jim-025 | مُنْجِدْ | مُنْجِد | ADDED TASHKEEL: final sukun |
| jim-026 | تَاجِرْ | تَاجِر | ADDED TASHKEEL: final sukun |
| jim-027 | فَجْرْ | فَجْر | ADDED TASHKEEL: final sukun |
| jim-028 | هِجْرَةْ | هِجْرَة | ADDED TASHKEEL: final sukun |
| jim-029 | أَجْنِحَةْ | أَجْنِحَة | ADDED TASHKEEL: final sukun |
| jim-030 | مَرْجَانْ | مَرْجَان | ADDED TASHKEEL: final sukun |
| jim-031 | ثَلْجْ | ثَلْج | ADDED TASHKEEL: final sukun |
| jim-032 | مَوْجْ | مَوْج | ADDED TASHKEEL: final sukun |
| jim-033 | بُرْجْ | بُرْج | ADDED TASHKEEL: final sukun |
| jim-034 | دَرَجْ | دَرَج | ADDED TASHKEEL: final sukun |
| jim-035 | فَرَجْ | فَرَج | ADDED TASHKEEL: final sukun |
| jim-036 | خُرُوجْ | خُرُوج | ADDED TASHKEEL: final sukun |
| jim-037 | عِلَاجْ | عِلَاج | ADDED TASHKEEL: final sukun |
| jim-038 | زَوَاجْ | زَوَاج | ADDED TASHKEEL: final sukun |
| jim-039 | حَجّْ | حَجّ | ADDED TASHKEEL: final sukun |
| jim-040 | مِنْهَاجْ | مِنْهَاج | ADDED TASHKEEL: final sukun |
| jim-041 | إِنْتَاجْ | إِنْتَاج | ADDED TASHKEEL: final sukun |
| jim-042 | تَدَرُّجْ | تَدَرُّج | ADDED TASHKEEL: final sukun |
| jim-043 | مِزَاجْ | مِزَاج | ADDED TASHKEEL: final sukun |
| jim-044 | سِرَاجْ | سِرَاج | ADDED TASHKEEL: final sukun |
| jim-045 | عَاجْ | عَاج | ADDED TASHKEEL: final sukun |

### hha: حَاءْ (44 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| hha-001 | حِصَانْ | حِصَان | ADDED TASHKEEL: final sukun |
| hha-002 | حَلِيبْ | حَلِيب | ADDED TASHKEEL: final sukun |
| hha-003 | حَدِيقَةْ | حَدِيقَة | ADDED TASHKEEL: final sukun |
| hha-004 | حُوتْ | حُوت | ADDED TASHKEEL: final sukun |
| hha-005 | حَمَامَةْ | حَمَامَة | ADDED TASHKEEL: final sukun |
| hha-006 | حَقِيبَةْ | حَقِيبَة | ADDED TASHKEEL: final sukun |
| hha-007 | حِذَاءْ | حِذَاء | ADDED TASHKEEL: final sukun |
| hha-008 | حَبْلْ | حَبْل | ADDED TASHKEEL: final sukun |
| hha-009 | حَرِيرْ | حَرِير | ADDED TASHKEEL: final sukun |
| hha-010 | حَجَرْ | حَجَر | ADDED TASHKEEL: final sukun |
| hha-011 | حَلْوَى | — | — |
| hha-012 | حَارِسْ | حَارِس | ADDED TASHKEEL: final sukun |
| hha-013 | حَكِيمْ | حَكِيم | ADDED TASHKEEL: final sukun |
| hha-014 | حَيَوَانْ | حَيَوَان | ADDED TASHKEEL: final sukun |
| hha-015 | حَمْرَاءْ | حَمْرَاء | ADDED TASHKEEL: final sukun |
| hha-016 | بَحْرْ | بَحْر | ADDED TASHKEEL: final sukun |
| hha-017 | نَحْلَةْ | نَحْلَة | ADDED TASHKEEL: final sukun |
| hha-018 | سَحَابْ | سَحَاب | ADDED TASHKEEL: final sukun |
| hha-019 | مِفْتَاحْ | مِفْتَاح | ADDED TASHKEEL: final sukun |
| hha-020 | رَحْمَةْ | رَحْمَة | ADDED TASHKEEL: final sukun |
| hha-021 | صَحْرَاءْ | صَحْرَاء | ADDED TASHKEEL: final sukun |
| hha-022 | مَحَبَّةْ | مَحَبَّة | ADDED TASHKEEL: final sukun |
| hha-023 | لَحْمْ | لَحْم | ADDED TASHKEEL: final sukun |
| hha-024 | فَحْمْ | فَحْم | ADDED TASHKEEL: final sukun |
| hha-025 | تُحْفَةْ | تُحْفَة | ADDED TASHKEEL: final sukun |
| hha-026 | مَحَلّْ | مَحَلّ | ADDED TASHKEEL: final sukun |
| hha-027 | سُحُورْ | سُحُور | ADDED TASHKEEL: final sukun |
| hha-028 | بُحَيْرَةْ | بُحَيْرَة | ADDED TASHKEEL: final sukun |
| hha-029 | مَحْكَمَةْ | مَحْكَمَة | ADDED TASHKEEL: final sukun |
| hha-030 | رَحِيلْ | رَحِيل | ADDED TASHKEEL: final sukun |
| hha-031 | صَبَاحْ | صَبَاح | ADDED TASHKEEL: final sukun |
| hha-032 | رِيَاحْ | رِيَاح | ADDED TASHKEEL: final sukun |
| hha-033 | نَجَاحْ | نَجَاح | ADDED TASHKEEL: final sukun |
| hha-034 | فَلَّاحْ | فَلَّاح | ADDED TASHKEEL: final sukun |
| hha-035 | سِلَاحْ | سِلَاح | ADDED TASHKEEL: final sukun |
| hha-036 | تُفَّاحْ | تُفَّاح | ADDED TASHKEEL: final sukun |
| hha-037 | جَنَاحْ | جَنَاح | ADDED TASHKEEL: final sukun |
| hha-038 | مِصْبَاحْ | مِصْبَاح | ADDED TASHKEEL: final sukun |
| hha-039 | رُوحْ | رُوح | ADDED TASHKEEL: final sukun |
| hha-040 | فَرَحْ | فَرَح | ADDED TASHKEEL: final sukun |
| hha-041 | مَرَحْ | مَرَح | ADDED TASHKEEL: final sukun |
| hha-042 | صُلْحْ | صُلْح | ADDED TASHKEEL: final sukun |
| hha-043 | مِلْحْ | مِلْح | ADDED TASHKEEL: final sukun |
| hha-044 | سَطْحْ | سَطْح | ADDED TASHKEEL: final sukun |

### kha: خَاءْ (45 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kha-001 | خُبْزْ | خُبْز | ADDED TASHKEEL: final sukun |
| kha-002 | خَرُوفْ | خَرُوف | ADDED TASHKEEL: final sukun |
| kha-003 | خَيْمَةْ | خَيْمَة | ADDED TASHKEEL: final sukun |
| kha-004 | خَاتَمْ | خَاتَم | ADDED TASHKEEL: final sukun |
| kha-005 | خَيْلْ | خَيْل | ADDED TASHKEEL: final sukun |
| kha-006 | خَضْرَاءْ | خَضْرَاء | ADDED TASHKEEL: final sukun |
| kha-007 | خَرِيطَةْ | خَرِيطَة | ADDED TASHKEEL: final sukun |
| kha-008 | خَلِيجْ | خَلِيج | ADDED TASHKEEL: final sukun |
| kha-009 | خِيَارْ | خِيَار | ADDED TASHKEEL: final sukun |
| kha-010 | خَزَانَةْ | خَزَانَة | ADDED TASHKEEL: final sukun |
| kha-011 | خَطّْ | خَطّ | ADDED TASHKEEL: final sukun |
| kha-012 | خَادِمْ | خَادِم | ADDED TASHKEEL: final sukun |
| kha-013 | خَلِيفَةْ | خَلِيفَة | ADDED TASHKEEL: final sukun |
| kha-014 | خَشَبْ | خَشَب | ADDED TASHKEEL: final sukun |
| kha-015 | خَمْسَةْ | خَمْسَة | ADDED TASHKEEL: final sukun |
| kha-016 | نَخْلَةْ | نَخْلَة | ADDED TASHKEEL: final sukun |
| kha-017 | بُخَارْ | بُخَار | ADDED TASHKEEL: final sukun |
| kha-018 | مَخْبَزْ | مَخْبَز | ADDED TASHKEEL: final sukun |
| kha-019 | دُخَانْ | دُخَان | ADDED TASHKEEL: final sukun |
| kha-020 | صَخْرَةْ | صَخْرَة | ADDED TASHKEEL: final sukun |
| kha-021 | فَخَّارْ | فَخَّار | ADDED TASHKEEL: final sukun |
| kha-022 | مُخَيَّمْ | مُخَيَّم | ADDED TASHKEEL: final sukun |
| kha-023 | سَخِيّْ | سَخِيّ | ADDED TASHKEEL: final sukun |
| kha-024 | بَخِيلْ | بَخِيل | ADDED TASHKEEL: final sukun |
| kha-025 | أَخْضَرْ | أَخْضَر | ADDED TASHKEEL: final sukun |
| kha-026 | مَخْلُوقْ | مَخْلُوق | ADDED TASHKEEL: final sukun |
| kha-027 | تَخْفِيضْ | تَخْفِيض | ADDED TASHKEEL: final sukun |
| kha-028 | أَخْبَارْ | أَخْبَار | ADDED TASHKEEL: final sukun |
| kha-029 | مَخْزَنْ | مَخْزَن | ADDED TASHKEEL: final sukun |
| kha-030 | دَاخِلْ | دَاخِل | ADDED TASHKEEL: final sukun |
| kha-031 | أَخْ | أَخ | ADDED TASHKEEL: final sukun |
| kha-032 | مَطْبَخْ | مَطْبَخ | ADDED TASHKEEL: final sukun |
| kha-033 | تَارِيخْ | تَارِيخ | ADDED TASHKEEL: final sukun |
| kha-034 | صَارُوخْ | صَارُوخ | ADDED TASHKEEL: final sukun |
| kha-035 | شَيْخْ | شَيْخ | ADDED TASHKEEL: final sukun |
| kha-036 | فَخّْ | فَخّ | ADDED TASHKEEL: final sukun |
| kha-037 | نُسَخْ | نُسَخ | ADDED TASHKEEL: final sukun |
| kha-038 | طَبَخْ | طَبَخ | ADDED TASHKEEL: final sukun |
| kha-039 | صُرَاخْ | صُرَاخ | ADDED TASHKEEL: final sukun |
| kha-040 | مُخّْ | مُخّ | ADDED TASHKEEL: final sukun |
| kha-041 | بَذْخْ | بَذْخ | ADDED TASHKEEL: final sukun |
| kha-042 | رُخّْ | رُخّ | ADDED TASHKEEL: final sukun |
| kha-043 | وَسَخْ | وَسَخ | ADDED TASHKEEL: final sukun |
| kha-044 | سَلَخْ | سَلَخ | ADDED TASHKEEL: final sukun |
| kha-045 | نَفْخْ | نَفْخ | ADDED TASHKEEL: final sukun |

### dal: دَالْ (42 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dal-001 | دُبّْ | دُبّ | ADDED TASHKEEL: final sukun |
| dal-002 | دَجَاجَةْ | دَجَاجَة | ADDED TASHKEEL: final sukun |
| dal-003 | دَرَّاجَةْ | دَرَّاجَة | ADDED TASHKEEL: final sukun |
| dal-004 | دَلْفِينْ | دَلْفِين | ADDED TASHKEEL: final sukun |
| dal-005 | دُودَةْ | دُودَة | ADDED TASHKEEL: final sukun |
| dal-006 | دِيكْ | دِيك | ADDED TASHKEEL: final sukun |
| dal-007 | دَفْتَرْ | دَفْتَر | ADDED TASHKEEL: final sukun |
| dal-008 | دَوَاءْ | دَوَاء | ADDED TASHKEEL: final sukun |
| dal-009 | دُرَّاقْ | دُرَّاق | ADDED TASHKEEL: final sukun |
| dal-010 | دُكَّانْ | دُكَّان | ADDED TASHKEEL: final sukun |
| dal-011 | دَقِيقْ | دَقِيق | ADDED TASHKEEL: final sukun |
| dal-012 | دَرْسْ | دَرْس | ADDED TASHKEEL: final sukun |
| dal-013 | دَوْلَةْ | دَوْلَة | ADDED TASHKEEL: final sukun |
| dal-014 | دَلِيلْ | دَلِيل | ADDED TASHKEEL: final sukun |
| dal-015 | دُعَاءْ | دُعَاء | ADDED TASHKEEL: final sukun |
| dal-016 | مَدْرَسَةْ | مَدْرَسَة | ADDED TASHKEEL: final sukun |
| dal-017 | قِنْدِيلْ | قِنْدِيل | ADDED TASHKEEL: final sukun |
| dal-018 | هُدْهُدْ | هُدْهُد | ADDED TASHKEEL: final sukun |
| dal-019 | بَدْرْ | بَدْر | ADDED TASHKEEL: final sukun |
| dal-020 | صَدِيقْ | صَدِيق | ADDED TASHKEEL: final sukun |
| dal-021 | قَدَمْ | قَدَم | ADDED TASHKEEL: final sukun |
| dal-022 | مَدِينَةْ | مَدِينَة | ADDED TASHKEEL: final sukun |
| dal-023 | حَدِيقَةْ | حَدِيقَة | ADDED TASHKEEL: final sukun |
| dal-024 | جَدِيدْ | جَدِيد | ADDED TASHKEEL: final sukun |
| dal-025 | قَدِيمْ | قَدِيم | ADDED TASHKEEL: final sukun |
| dal-026 | عَدَدْ | عَدَد | ADDED TASHKEEL: final sukun |
| dal-027 | مُهَنْدِسْ | مُهَنْدِس | ADDED TASHKEEL: final sukun |
| dal-028 | بَرِيدْ | بَرِيد | ADDED TASHKEEL: final sukun |
| dal-029 | سَعِيدْ | سَعِيد | ADDED TASHKEEL: final sukun |
| dal-030 | حَدِيدْ | حَدِيد | ADDED TASHKEEL: final sukun |
| dal-031 | وَلَدْ | وَلَد | ADDED TASHKEEL: final sukun |
| dal-032 | أَسَدْ | أَسَد | ADDED TASHKEEL: final sukun |
| dal-033 | بَلَدْ | بَلَد | ADDED TASHKEEL: final sukun |
| dal-034 | جَدّْ | جَدّ | ADDED TASHKEEL: final sukun |
| dal-035 | جَلِيدْ | جَلِيد | ADDED TASHKEEL: final sukun |
| dal-036 | عِيدْ | عِيد | ADDED TASHKEEL: final sukun |
| dal-037 | وَرْدْ | وَرْد | ADDED TASHKEEL: final sukun |
| dal-038 | قِرْدْ | قِرْد | ADDED TASHKEEL: final sukun |
| dal-039 | بَرْدْ | بَرْد | ADDED TASHKEEL: final sukun |
| dal-040 | مَجْدْ | مَجْد | ADDED TASHKEEL: final sukun |
| dal-041 | سَعْدْ | سَعْد | ADDED TASHKEEL: final sukun |
| dal-042 | رَعْدْ | رَعْد | ADDED TASHKEEL: final sukun |

### dhal: ذَالْ (42 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dhal-001 | ذِئْبْ | ذِئْب | ADDED TASHKEEL: final sukun |
| dhal-002 | ذَهَبْ | ذَهَب | ADDED TASHKEEL: final sukun |
| dhal-003 | ذُبَابَةْ | ذُبَابَة | ADDED TASHKEEL: final sukun |
| dhal-004 | ذُرَةْ | ذُرَة | ADDED TASHKEEL: final sukun |
| dhal-005 | ذَيْلْ | ذَيْل | ADDED TASHKEEL: final sukun |
| dhal-006 | ذَكِيّْ | ذَكِيّ | ADDED TASHKEEL: final sukun |
| dhal-007 | ذِرَاعْ | ذِرَاع | ADDED TASHKEEL: final sukun |
| dhal-008 | ذَاكِرَةْ | ذَاكِرَة | ADDED TASHKEEL: final sukun |
| dhal-009 | ذَوْقْ | ذَوْق | ADDED TASHKEEL: final sukun |
| dhal-010 | ذِكْرَى | — | — |
| dhal-011 | ذَخِيرَةْ | ذَخِيرَة | ADDED TASHKEEL: final sukun |
| dhal-012 | ذَنْبْ | ذَنْب | ADDED TASHKEEL: final sukun |
| dhal-013 | ذَرَّةْ | ذَرَّة | ADDED TASHKEEL: final sukun |
| dhal-014 | ذَبِيحَةْ | ذَبِيحَة | ADDED TASHKEEL: final sukun |
| dhal-015 | ذُنُوبْ | ذُنُوب | ADDED TASHKEEL: final sukun |
| dhal-016 | غِذَاءْ | غِذَاء | ADDED TASHKEEL: final sukun |
| dhal-017 | حِذَاءْ | حِذَاء | ADDED TASHKEEL: final sukun |
| dhal-018 | جَذْعْ | جَذْع | ADDED TASHKEEL: final sukun |
| dhal-019 | أُذُنْ | أُذُن | ADDED TASHKEEL: final sukun |
| dhal-020 | لَذِيذْ | لَذِيذ | ADDED TASHKEEL: final sukun |
| dhal-021 | تِلْمِيذْ | تِلْمِيذ | ADDED TASHKEEL: final sukun |
| dhal-022 | مَأْذَنَةْ | مَأْذَنَة | ADDED TASHKEEL: final sukun |
| dhal-023 | بَذْرَةْ | بَذْرَة | ADDED TASHKEEL: final sukun |
| dhal-024 | نَبَذْ | نَبَذَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| dhal-025 | أَخَذْ | أَخَذَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| dhal-026 | جَاذِبِيَّةْ | جَاذِبِيَّة | ADDED TASHKEEL: final sukun |
| dhal-027 | مُنْذِرْ | مُنْذِر | ADDED TASHKEEL: final sukun |
| dhal-028 | حَذَرْ | حَذَر | ADDED TASHKEEL: final sukun |
| dhal-029 | عُذْرْ | عُذْر | ADDED TASHKEEL: final sukun |
| dhal-030 | نُفُوذْ | نُفُوذ | ADDED TASHKEEL: final sukun |
| dhal-031 | أُسْتَاذْ | أُسْتَاذ | ADDED TASHKEEL: final sukun |
| dhal-032 | مَلَاذْ | مَلَاذ | ADDED TASHKEEL: final sukun |
| dhal-033 | إِنْقَاذْ | إِنْقَاذ | ADDED TASHKEEL: final sukun |
| dhal-034 | نَفَّاذْ | نَفَّاذ | ADDED TASHKEEL: final sukun |
| dhal-035 | فُولَاذْ | فُولَاذ | ADDED TASHKEEL: final sukun |
| dhal-036 | شُذُوذْ | شُذُوذ | ADDED TASHKEEL: final sukun |
| dhal-037 | مَأْخَذْ | مَأْخَذ | ADDED TASHKEEL: final sukun |
| dhal-038 | مَنْفَذْ | مَنْفَذ | ADDED TASHKEEL: final sukun |
| dhal-039 | مُنْقِذْ | مُنْقِذ | ADDED TASHKEEL: final sukun |
| dhal-040 | جَرَذْ | جَرَذ | ADDED TASHKEEL: final sukun |
| dhal-041 | فَخِذْ | فَخِذ | ADDED TASHKEEL: final sukun |
| dhal-042 | عَوَذْ | عَوَذ | ADDED TASHKEEL: final sukun |

### ra: رَاءْ (45 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ra-001 | رَجُلْ | رَجُل | ADDED TASHKEEL: final sukun |
| ra-002 | رُمَّانْ | رُمَّان | ADDED TASHKEEL: final sukun |
| ra-003 | رِسَالَةْ | رِسَالَة | ADDED TASHKEEL: final sukun |
| ra-004 | رَبِيعْ | رَبِيع | ADDED TASHKEEL: final sukun |
| ra-005 | رِيشَةْ | رِيشَة | ADDED TASHKEEL: final sukun |
| ra-006 | رَأْسْ | رَأْس | ADDED TASHKEEL: final sukun |
| ra-007 | رُكْبَةْ | رُكْبَة | ADDED TASHKEEL: final sukun |
| ra-008 | رَحْمَةْ | رَحْمَة | ADDED TASHKEEL: final sukun |
| ra-009 | رِحْلَةْ | رِحْلَة | ADDED TASHKEEL: final sukun |
| ra-010 | رَمْلْ | رَمْل | ADDED TASHKEEL: final sukun |
| ra-011 | رَغِيفْ | رَغِيف | ADDED TASHKEEL: final sukun |
| ra-012 | رَفِيقْ | رَفِيق | ADDED TASHKEEL: final sukun |
| ra-013 | رَقَمْ | رَقَم | ADDED TASHKEEL: final sukun |
| ra-014 | رُوحْ | رُوح | ADDED TASHKEEL: final sukun |
| ra-015 | رِيَاضَةْ | رِيَاضَة | ADDED TASHKEEL: final sukun |
| ra-016 | شَجَرَةْ | شَجَرَة | ADDED TASHKEEL: final sukun |
| ra-017 | بُرْتُقَالْ | بُرْتُقَال | ADDED TASHKEEL: final sukun |
| ra-018 | فَرَاشَةْ | فَرَاشَة | ADDED TASHKEEL: final sukun |
| ra-019 | مَرْكَبْ | مَرْكَب | ADDED TASHKEEL: final sukun |
| ra-020 | دَرَّاجَةْ | دَرَّاجَة | ADDED TASHKEEL: final sukun |
| ra-021 | غُرْفَةْ | غُرْفَة | ADDED TASHKEEL: final sukun |
| ra-022 | حَرِيرْ | حَرِير | ADDED TASHKEEL: final sukun |
| ra-023 | كُرَةْ | كُرَة | ADDED TASHKEEL: final sukun |
| ra-024 | سَرِيرْ | سَرِير | ADDED TASHKEEL: final sukun |
| ra-025 | مَرِيضْ | مَرِيض | ADDED TASHKEEL: final sukun |
| ra-026 | بَرْقْ | بَرْق | ADDED TASHKEEL: final sukun |
| ra-027 | عَرُوسْ | عَرُوس | ADDED TASHKEEL: final sukun |
| ra-028 | فَرَسْ | فَرَس | ADDED TASHKEEL: final sukun |
| ra-029 | قَرْيَةْ | قَرْيَة | ADDED TASHKEEL: final sukun |
| ra-030 | جَرِيدَةْ | جَرِيدَة | ADDED TASHKEEL: final sukun |
| ra-031 | بَحْرْ | بَحْر | ADDED TASHKEEL: final sukun |
| ra-032 | قَمَرْ | قَمَر | ADDED TASHKEEL: final sukun |
| ra-033 | نَهْرْ | نَهْر | ADDED TASHKEEL: final sukun |
| ra-034 | زَهْرْ | زَهْر | ADDED TASHKEEL: final sukun |
| ra-035 | فَجْرْ | فَجْر | ADDED TASHKEEL: final sukun |
| ra-036 | عَصْرْ | عَصْر | ADDED TASHKEEL: final sukun |
| ra-037 | نَسْرْ | نَسْر | ADDED TASHKEEL: final sukun |
| ra-038 | صَقْرْ | صَقْر | ADDED TASHKEEL: final sukun |
| ra-039 | تَمْرْ | تَمْر | ADDED TASHKEEL: final sukun |
| ra-040 | خَيْرْ | خَيْر | ADDED TASHKEEL: final sukun |
| ra-041 | طَيْرْ | طَيْر | ADDED TASHKEEL: final sukun |
| ra-042 | سِحْرْ | سِحْر | ADDED TASHKEEL: final sukun |
| ra-043 | شَعْرْ | شَعْر | ADDED TASHKEEL: final sukun |
| ra-044 | عُمْرْ | عُمْر | ADDED TASHKEEL: final sukun |
| ra-045 | صَبْرْ | صَبْر | ADDED TASHKEEL: final sukun |

### zay: زَايْ (43 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zay-001 | زَهْرَةْ | زَهْرَة | ADDED TASHKEEL: final sukun |
| zay-002 | زَرَافَةْ | زَرَافَة | ADDED TASHKEEL: final sukun |
| zay-003 | زَيْتُونْ | زَيْتُون | ADDED TASHKEEL: final sukun |
| zay-004 | زُجَاجْ | زُجَاج | ADDED TASHKEEL: final sukun |
| zay-005 | زَبِيبْ | زَبِيب | ADDED TASHKEEL: final sukun |
| zay-006 | زَمَانْ | زَمَان | ADDED TASHKEEL: final sukun |
| zay-007 | زِرَاعَةْ | زِرَاعَة | ADDED TASHKEEL: final sukun |
| zay-008 | زِينَةْ | زِينَة | ADDED TASHKEEL: final sukun |
| zay-009 | زُبْدَةْ | زُبْدَة | ADDED TASHKEEL: final sukun |
| zay-010 | زَنْبَقْ | زَنْبَق | ADDED TASHKEEL: final sukun |
| zay-011 | زَلَّاجَةْ | زَلَّاجَة | ADDED TASHKEEL: final sukun |
| zay-012 | زَمِيلْ | زَمِيل | ADDED TASHKEEL: final sukun |
| zay-013 | زَاوِيَةْ | زَاوِيَة | ADDED TASHKEEL: final sukun |
| zay-014 | زَعْفَرَانْ | زَعْفَرَان | ADDED TASHKEEL: final sukun |
| zay-015 | زَوْرَقْ | زَوْرَق | ADDED TASHKEEL: final sukun |
| zay-016 | مَوْزْ | مَوْز | ADDED TASHKEEL: final sukun |
| zay-017 | غَزَالْ | غَزَال | ADDED TASHKEEL: final sukun |
| zay-018 | خَزَانَةْ | خَزَانَة | ADDED TASHKEEL: final sukun |
| zay-019 | جَزَرْ | جَزَر | ADDED TASHKEEL: final sukun |
| zay-020 | مِيزَانْ | مِيزَان | ADDED TASHKEEL: final sukun |
| zay-021 | جَزِيرَةْ | جَزِيرَة | ADDED TASHKEEL: final sukun |
| zay-022 | وَزِيرْ | وَزِير | ADDED TASHKEEL: final sukun |
| zay-023 | مَخْبَزْ | مَخْبَز | ADDED TASHKEEL: final sukun |
| zay-024 | عَزِيزْ | عَزِيز | ADDED TASHKEEL: final sukun |
| zay-025 | حَزِينْ | حَزِين | ADDED TASHKEEL: final sukun |
| zay-026 | مَرْكَزْ | مَرْكَز | ADDED TASHKEEL: final sukun |
| zay-027 | فَوَازِيرْ | فَوَازِير | ADDED TASHKEEL: final sukun |
| zay-028 | خُزَامَى | — | — |
| zay-029 | بَازِلَّاءْ | بَازِلَّاء | ADDED TASHKEEL: final sukun |
| zay-030 | خُبْزْ | خُبْز | ADDED TASHKEEL: final sukun |
| zay-031 | أَرُزْ | أَرُز | ADDED TASHKEEL: final sukun |
| zay-032 | رَمْزْ | رَمْز | ADDED TASHKEEL: final sukun |
| zay-033 | كَنْزْ | كَنْز | ADDED TASHKEEL: final sukun |
| zay-034 | عَجُوزْ | عَجُوز | ADDED TASHKEEL: final sukun |
| zay-035 | فَوْزْ | فَوْز | ADDED TASHKEEL: final sukun |
| zay-036 | لَوْزْ | لَوْز | ADDED TASHKEEL: final sukun |
| zay-037 | بُرُوزْ | بُرُوز | ADDED TASHKEEL: final sukun |
| zay-038 | تَمْيِيزْ | تَمْيِيز | ADDED TASHKEEL: final sukun |
| zay-039 | إِنْجَازْ | إِنْجَاز | ADDED TASHKEEL: final sukun |
| zay-040 | جِهَازْ | جِهَاز | ADDED TASHKEEL: final sukun |
| zay-041 | إِعْجَازْ | إِعْجَاز | ADDED TASHKEEL: final sukun |
| zay-042 | مُمْتَازْ | مُمْتَاز | ADDED TASHKEEL: final sukun |
| zay-043 | طِرَازْ | طِرَاز | ADDED TASHKEEL: final sukun |

### sin: سِينْ (44 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| sin-001 | سَمَكَةْ | سَمَكَة | ADDED TASHKEEL: final sukun |
| sin-002 | سَيَّارَةْ | سَيَّارَة | ADDED TASHKEEL: final sukun |
| sin-003 | سَاعَةْ | سَاعَة | ADDED TASHKEEL: final sukun |
| sin-004 | سَرِيرْ | سَرِير | ADDED TASHKEEL: final sukun |
| sin-005 | سَفِينَةْ | سَفِينَة | ADDED TASHKEEL: final sukun |
| sin-006 | سُلَحْفَاةْ | سُلَحْفَاة | ADDED TASHKEEL: final sukun |
| sin-007 | سَحَابْ | سَحَاب | ADDED TASHKEEL: final sukun |
| sin-008 | سَبُورَةْ | سَبُورَة | ADDED TASHKEEL: final sukun |
| sin-009 | سِكِّينْ | سِكِّين | ADDED TASHKEEL: final sukun |
| sin-010 | سُوقْ | سُوق | ADDED TASHKEEL: final sukun |
| sin-011 | سَلَامْ | سَلَام | ADDED TASHKEEL: final sukun |
| sin-012 | سَمَاءْ | سَمَاء | ADDED TASHKEEL: final sukun |
| sin-013 | سَعِيدْ | سَعِيد | ADDED TASHKEEL: final sukun |
| sin-014 | سِرّْ | سِرّ | ADDED TASHKEEL: final sukun |
| sin-015 | سَهْلْ | سَهْل | ADDED TASHKEEL: final sukun |
| sin-016 | مَدْرَسَةْ | مَدْرَسَة | ADDED TASHKEEL: final sukun |
| sin-017 | فُسْتَانْ | فُسْتَان | ADDED TASHKEEL: final sukun |
| sin-018 | حِسَابْ | حِسَاب | ADDED TASHKEEL: final sukun |
| sin-019 | مِسْطَرَةْ | مِسْطَرَة | ADDED TASHKEEL: final sukun |
| sin-020 | بِسْكُوتْ | بِسْكُوت | ADDED TASHKEEL: final sukun |
| sin-021 | إِنْسَانْ | إِنْسَان | ADDED TASHKEEL: final sukun |
| sin-022 | مُسَابَقَةْ | مُسَابَقَة | ADDED TASHKEEL: final sukun |
| sin-023 | حَسَنْ | حَسَن | ADDED TASHKEEL: final sukun |
| sin-024 | مُهَنْدِسْ | مُهَنْدِس | ADDED TASHKEEL: final sukun |
| sin-025 | مَسْجِدْ | مَسْجِد | ADDED TASHKEEL: final sukun |
| sin-026 | بَسْمَةْ | بَسْمَة | ADDED TASHKEEL: final sukun |
| sin-027 | رَسْمْ | رَسْم | ADDED TASHKEEL: final sukun |
| sin-028 | قِسْمْ | قِسْم | ADDED TASHKEEL: final sukun |
| sin-029 | جِسْرْ | جِسْر | ADDED TASHKEEL: final sukun |
| sin-030 | حَبْسْ | حَبْس | ADDED TASHKEEL: final sukun |
| sin-031 | شَمْسْ | شَمْس | ADDED TASHKEEL: final sukun |
| sin-032 | فَرَسْ | فَرَس | ADDED TASHKEEL: final sukun |
| sin-033 | دَرْسْ | دَرْس | ADDED TASHKEEL: final sukun |
| sin-034 | عَرُوسْ | عَرُوس | ADDED TASHKEEL: final sukun |
| sin-035 | فَانُوسْ | فَانُوس | ADDED TASHKEEL: final sukun |
| sin-036 | قَامُوسْ | قَامُوس | ADDED TASHKEEL: final sukun |
| sin-037 | جَرَسْ | جَرَس | ADDED TASHKEEL: final sukun |
| sin-038 | حَارِسْ | حَارِس | ADDED TASHKEEL: final sukun |
| sin-039 | نَفَسْ | نَفَس | ADDED TASHKEEL: final sukun |
| sin-040 | رَأْسْ | رَأْس | ADDED TASHKEEL: final sukun |
| sin-041 | كَأْسْ | كَأْس | ADDED TASHKEEL: final sukun |
| sin-042 | حِسّْ | حِسّ | ADDED TASHKEEL: final sukun |
| sin-043 | لَمْسْ | لَمْس | ADDED TASHKEEL: final sukun |
| sin-044 | هَمْسْ | هَمْس | ADDED TASHKEEL: final sukun |

### shin: شِينْ (45 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| shin-001 | شَمْسْ | شَمْس | ADDED TASHKEEL: final sukun |
| shin-002 | شَجَرَةْ | شَجَرَة | ADDED TASHKEEL: final sukun |
| shin-003 | شُرْطِيّْ | شُرْطِيّ | ADDED TASHKEEL: final sukun |
| shin-004 | شَاطِئْ | شَاطِئ | ADDED TASHKEEL: final sukun |
| shin-005 | شِتَاءْ | شِتَاء | ADDED TASHKEEL: final sukun |
| shin-006 | شَمْعَةْ | شَمْعَة | ADDED TASHKEEL: final sukun |
| shin-007 | شُوكَةْ | شُوكَة | ADDED TASHKEEL: final sukun |
| shin-008 | شَرِيطْ | شَرِيط | ADDED TASHKEEL: final sukun |
| shin-009 | شَبَكَةْ | شَبَكَة | ADDED TASHKEEL: final sukun |
| shin-010 | شَارِعْ | شَارِع | ADDED TASHKEEL: final sukun |
| shin-011 | شَهْرْ | شَهْر | ADDED TASHKEEL: final sukun |
| shin-012 | شُكْرْ | شُكْر | ADDED TASHKEEL: final sukun |
| shin-013 | شَرَابْ | شَرَاب | ADDED TASHKEEL: final sukun |
| shin-014 | شَبَابْ | شَبَاب | ADDED TASHKEEL: final sukun |
| shin-015 | شَرِيكْ | شَرِيك | ADDED TASHKEEL: final sukun |
| shin-016 | فَرَاشَةْ | فَرَاشَة | ADDED TASHKEEL: final sukun |
| shin-017 | مَشْرُوبْ | مَشْرُوب | ADDED TASHKEEL: final sukun |
| shin-018 | عُشْبْ | عُشْب | ADDED TASHKEEL: final sukun |
| shin-019 | بِشَارَةْ | بِشَارَة | ADDED TASHKEEL: final sukun |
| shin-020 | حَشَرَةْ | حَشَرَة | ADDED TASHKEEL: final sukun |
| shin-021 | نَشِيدْ | نَشِيد | ADDED TASHKEEL: final sukun |
| shin-022 | رَشِيدْ | رَشِيد | ADDED TASHKEEL: final sukun |
| shin-023 | مُشْمِشْ | مُشْمِش | ADDED TASHKEEL: final sukun |
| shin-024 | خَشَبْ | خَشَب | ADDED TASHKEEL: final sukun |
| shin-025 | عِشْرِينْ | عِشْرِين | ADDED TASHKEEL: final sukun |
| shin-026 | بَشَرْ | بَشَر | ADDED TASHKEEL: final sukun |
| shin-027 | نَشَاطْ | نَشَاط | ADDED TASHKEEL: final sukun |
| shin-028 | كَشَّافْ | كَشَّاف | ADDED TASHKEEL: final sukun |
| shin-029 | مَشْهُورْ | مَشْهُور | ADDED TASHKEEL: final sukun |
| shin-030 | عَشَاءْ | عَشَاء | ADDED TASHKEEL: final sukun |
| shin-031 | رِيشْ | رِيش | ADDED TASHKEEL: final sukun |
| shin-032 | عَرْشْ | عَرْش | ADDED TASHKEEL: final sukun |
| shin-033 | فَرْشْ | فَرْش | ADDED TASHKEEL: final sukun |
| shin-034 | نَقْشْ | نَقْش | ADDED TASHKEEL: final sukun |
| shin-035 | جَيْشْ | جَيْش | ADDED TASHKEEL: final sukun |
| shin-036 | عَطَشْ | عَطَش | ADDED TASHKEEL: final sukun |
| shin-037 | وَحْشْ | وَحْش | ADDED TASHKEEL: final sukun |
| shin-038 | رَشّْ | رَشّ | ADDED TASHKEEL: final sukun |
| shin-039 | قُمَاشْ | قُمَاش | ADDED TASHKEEL: final sukun |
| shin-040 | إِنْعَاشْ | إِنْعَاش | ADDED TASHKEEL: final sukun |
| shin-041 | فِرَاشْ | فِرَاش | ADDED TASHKEEL: final sukun |
| shin-042 | دُشّْ | دُشّ | ADDED TASHKEEL: final sukun |
| shin-043 | بَطْشْ | بَطْش | ADDED TASHKEEL: final sukun |
| shin-044 | خَدْشْ | خَدْش | ADDED TASHKEEL: final sukun |
| shin-045 | رَعْشْ | رَعْش | ADDED TASHKEEL: final sukun |

### sad: صَادْ (45 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| sad-001 | صَقْرْ | صَقْر | ADDED TASHKEEL: final sukun |
| sad-002 | صَبَاحْ | صَبَاح | ADDED TASHKEEL: final sukun |
| sad-003 | صَحْرَاءْ | صَحْرَاء | ADDED TASHKEEL: final sukun |
| sad-004 | صُنْدُوقْ | صُنْدُوق | ADDED TASHKEEL: final sukun |
| sad-005 | صَدِيقْ | صَدِيق | ADDED TASHKEEL: final sukun |
| sad-006 | صَابُونْ | صَابُون | ADDED TASHKEEL: final sukun |
| sad-007 | صَاعِقَةْ | صَاعِقَة | ADDED TASHKEEL: final sukun |
| sad-008 | صُورَةْ | صُورَة | ADDED TASHKEEL: final sukun |
| sad-009 | صَيَّادْ | صَيَّاد | ADDED TASHKEEL: final sukun |
| sad-010 | صَخْرَةْ | صَخْرَة | ADDED TASHKEEL: final sukun |
| sad-011 | صَلَاةْ | صَلَاة | ADDED TASHKEEL: final sukun |
| sad-012 | صِحَّةْ | صِحَّة | ADDED TASHKEEL: final sukun |
| sad-013 | صَبْرْ | صَبْر | ADDED TASHKEEL: final sukun |
| sad-014 | صَوْتْ | صَوْت | ADDED TASHKEEL: final sukun |
| sad-015 | صِنَاعَةْ | صِنَاعَة | ADDED TASHKEEL: final sukun |
| sad-016 | عُصْفُورْ | عُصْفُور | ADDED TASHKEEL: final sukun |
| sad-017 | مِقَصّْ | مِقَصّ | ADDED TASHKEEL: final sukun |
| sad-018 | حِصَانْ | حِصَان | ADDED TASHKEEL: final sukun |
| sad-019 | قَصْرْ | قَصْر | ADDED TASHKEEL: final sukun |
| sad-020 | نَصْرْ | نَصْر | ADDED TASHKEEL: final sukun |
| sad-021 | فَصْلْ | فَصْل | ADDED TASHKEEL: final sukun |
| sad-022 | وَصْفَةْ | وَصْفَة | ADDED TASHKEEL: final sukun |
| sad-023 | مُصَوِّرْ | مُصَوِّر | ADDED TASHKEEL: final sukun |
| sad-024 | قِصَّةْ | قِصَّة | ADDED TASHKEEL: final sukun |
| sad-025 | نَصِيحَةْ | نَصِيحَة | ADDED TASHKEEL: final sukun |
| sad-026 | عَصِيرْ | عَصِير | ADDED TASHKEEL: final sukun |
| sad-027 | بَصَلْ | بَصَل | ADDED TASHKEEL: final sukun |
| sad-028 | حَصَادْ | حَصَاد | ADDED TASHKEEL: final sukun |
| sad-029 | مِصْبَاحْ | مِصْبَاح | ADDED TASHKEEL: final sukun |
| sad-030 | خَصْمْ | خَصْم | ADDED TASHKEEL: final sukun |
| sad-031 | قَفَصْ | قَفَص | ADDED TASHKEEL: final sukun |
| sad-032 | رَقْصْ | رَقْص | ADDED TASHKEEL: final sukun |
| sad-033 | نَقْصْ | نَقْص | ADDED TASHKEEL: final sukun |
| sad-034 | فَحْصْ | فَحْص | ADDED TASHKEEL: final sukun |
| sad-035 | شَخْصْ | شَخْص | ADDED TASHKEEL: final sukun |
| sad-036 | حِرْصْ | حِرْص | ADDED TASHKEEL: final sukun |
| sad-037 | خَاصّْ | خَاصّ | ADDED TASHKEEL: final sukun |
| sad-038 | رَصَاصْ | رَصَاص | ADDED TASHKEEL: final sukun |
| sad-039 | قَنَّاصْ | قَنَّاص | ADDED TASHKEEL: final sukun |
| sad-040 | غَوَّاصْ | غَوَّاص | ADDED TASHKEEL: final sukun |
| sad-041 | خَلَاصْ | خَلَاص | ADDED TASHKEEL: final sukun |
| sad-042 | إِخْلَاصْ | إِخْلَاص | ADDED TASHKEEL: final sukun |
| sad-043 | فُرْصْ | فُرْص | ADDED TASHKEEL: final sukun |
| sad-044 | لُصُوصْ | لُصُوص | ADDED TASHKEEL: final sukun |
| sad-045 | حِصَصْ | حِصَص | ADDED TASHKEEL: final sukun |

### dad: ضَادْ (44 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dad-001 | ضِفْدَعْ | ضِفْدَع | ADDED TASHKEEL: final sukun |
| dad-002 | ضَوْءْ | ضَوْء | ADDED TASHKEEL: final sukun |
| dad-003 | ضَيْفْ | ضَيْف | ADDED TASHKEEL: final sukun |
| dad-004 | ضَبَابْ | ضَبَاب | ADDED TASHKEEL: final sukun |
| dad-005 | ضَحِكْ | ضَحِك | ADDED TASHKEEL: final sukun |
| dad-006 | ضَرْبْ | ضَرْب | ADDED TASHKEEL: final sukun |
| dad-007 | ضَعِيفْ | ضَعِيف | ADDED TASHKEEL: final sukun |
| dad-008 | ضَمِيرْ | ضَمِير | ADDED TASHKEEL: final sukun |
| dad-009 | ضَرُورَةْ | ضَرُورَة | ADDED TASHKEEL: final sukun |
| dad-010 | ضَجِيجْ | ضَجِيج | ADDED TASHKEEL: final sukun |
| dad-011 | ضَخْمْ | ضَخْم | ADDED TASHKEEL: final sukun |
| dad-012 | ضَرِيبَةْ | ضَرِيبَة | ADDED TASHKEEL: final sukun |
| dad-013 | ضَابِطْ | ضَابِط | ADDED TASHKEEL: final sukun |
| dad-014 | ضِدّْ | ضِدّ | ADDED TASHKEEL: final sukun |
| dad-015 | ضَرَرْ | ضَرَر | ADDED TASHKEEL: final sukun |
| dad-016 | خُضَارْ | خُضَار | ADDED TASHKEEL: final sukun |
| dad-017 | رِيَاضَةْ | رِيَاضَة | ADDED TASHKEEL: final sukun |
| dad-018 | حَضَارَةْ | حَضَارَة | ADDED TASHKEEL: final sukun |
| dad-019 | رَمَضَانْ | رَمَضَان | ADDED TASHKEEL: final sukun |
| dad-020 | فِضَّةْ | فِضَّة | ADDED TASHKEEL: final sukun |
| dad-021 | أَخْضَرْ | أَخْضَر | ADDED TASHKEEL: final sukun |
| dad-022 | حُضُورْ | حُضُور | ADDED TASHKEEL: final sukun |
| dad-023 | مُعَارَضَةْ | مُعَارَضَة | ADDED TASHKEEL: final sukun |
| dad-024 | قَاضِي | — | — |
| dad-025 | رَاضِي | — | — |
| dad-026 | فَضَاءْ | فَضَاء | ADDED TASHKEEL: final sukun |
| dad-027 | عَضَلَةْ | عَضَلَة | ADDED TASHKEEL: final sukun |
| dad-028 | نَضِيجْ | نَضِيج | ADDED TASHKEEL: final sukun |
| dad-029 | مَرِيضْ | مَرِيض | ADDED TASHKEEL: final sukun |
| dad-030 | بَيْضَةْ | بَيْضَة | ADDED TASHKEEL: final sukun |
| dad-031 | أَبْيَضْ | أَبْيَض | ADDED TASHKEEL: final sukun |
| dad-032 | أَرْضْ | أَرْض | ADDED TASHKEEL: final sukun |
| dad-033 | عَرْضْ | عَرْض | ADDED TASHKEEL: final sukun |
| dad-034 | غَرَضْ | غَرَض | ADDED TASHKEEL: final sukun |
| dad-035 | فَرْضْ | فَرْض | ADDED TASHKEEL: final sukun |
| dad-036 | رَفْضْ | رَفْض | ADDED TASHKEEL: final sukun |
| dad-037 | نَبْضْ | نَبْض | ADDED TASHKEEL: final sukun |
| dad-038 | حَمْضْ | حَمْض | ADDED TASHKEEL: final sukun |
| dad-039 | خَفْضْ | خَفْض | ADDED TASHKEEL: final sukun |
| dad-040 | قَبْضْ | قَبْض | ADDED TASHKEEL: final sukun |
| dad-041 | عَرِيضْ | عَرِيض | ADDED TASHKEEL: final sukun |
| dad-042 | حَوْضْ | حَوْض | ADDED TASHKEEL: final sukun |
| dad-043 | رَوْضْ | رَوْض | ADDED TASHKEEL: final sukun |
| dad-044 | مَحْضْ | مَحْض | ADDED TASHKEEL: final sukun |

### tta: طَاءْ (44 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| tta-001 | طَائِرَةْ | طَائِرَة | ADDED TASHKEEL: final sukun |
| tta-002 | طَبِيبْ | طَبِيب | ADDED TASHKEEL: final sukun |
| tta-003 | طَاوُوسْ | طَاوُوس | ADDED TASHKEEL: final sukun |
| tta-004 | طَبْلْ | طَبْل | ADDED TASHKEEL: final sukun |
| tta-005 | طَرِيقْ | طَرِيق | ADDED TASHKEEL: final sukun |
| tta-006 | طَعَامْ | طَعَام | ADDED TASHKEEL: final sukun |
| tta-007 | طِفْلْ | طِفْل | ADDED TASHKEEL: final sukun |
| tta-008 | طَبِيعَةْ | طَبِيعَة | ADDED TASHKEEL: final sukun |
| tta-009 | طَابِعْ | طَابِع | ADDED TASHKEEL: final sukun |
| tta-010 | طَاوِلَةْ | طَاوِلَة | ADDED TASHKEEL: final sukun |
| tta-011 | طَالِبْ | طَالِب | ADDED TASHKEEL: final sukun |
| tta-012 | طَوِيلْ | طَوِيل | ADDED TASHKEEL: final sukun |
| tta-013 | طَيِّبْ | طَيِّب | ADDED TASHKEEL: final sukun |
| tta-014 | طَبَقْ | طَبَق | ADDED TASHKEEL: final sukun |
| tta-015 | طَحِينْ | طَحِين | ADDED TASHKEEL: final sukun |
| tta-016 | بَطَّةْ | بَطَّة | ADDED TASHKEEL: final sukun |
| tta-017 | قِطَّةْ | قِطَّة | ADDED TASHKEEL: final sukun |
| tta-018 | بَطِّيخْ | بَطِّيخ | ADDED TASHKEEL: final sukun |
| tta-019 | مَطَرْ | مَطَر | ADDED TASHKEEL: final sukun |
| tta-020 | سَطْحْ | سَطْح | ADDED TASHKEEL: final sukun |
| tta-021 | خَطّْ | خَطّ | ADDED TASHKEEL: final sukun |
| tta-022 | مَحَطَّةْ | مَحَطَّة | ADDED TASHKEEL: final sukun |
| tta-023 | بَطَاطَا | — | — |
| tta-024 | مُعَطَّرْ | مُعَطَّر | ADDED TASHKEEL: final sukun |
| tta-025 | قُطْنْ | قُطْن | ADDED TASHKEEL: final sukun |
| tta-026 | خَطِيرْ | خَطِير | ADDED TASHKEEL: final sukun |
| tta-027 | مَطْبَخْ | مَطْبَخ | ADDED TASHKEEL: final sukun |
| tta-028 | فُطُورْ | فُطُور | ADDED TASHKEEL: final sukun |
| tta-029 | سُلْطَانْ | سُلْطَان | ADDED TASHKEEL: final sukun |
| tta-030 | بَطَلْ | بَطَل | ADDED TASHKEEL: final sukun |
| tta-031 | قِطّْ | قِطّ | ADDED TASHKEEL: final sukun |
| tta-032 | بَسِيطْ | بَسِيط | ADDED TASHKEEL: final sukun |
| tta-033 | نَشِيطْ | نَشِيط | ADDED TASHKEEL: final sukun |
| tta-034 | مُحِيطْ | مُحِيط | ADDED TASHKEEL: final sukun |
| tta-035 | خَيْطْ | خَيْط | ADDED TASHKEEL: final sukun |
| tta-036 | شَرْطْ | شَرْط | ADDED TASHKEEL: final sukun |
| tta-037 | نُقْطَةْ | نُقْطَة | ADDED TASHKEEL: final sukun |
| tta-038 | رَبْطْ | رَبْط | ADDED TASHKEEL: final sukun |
| tta-039 | ضَبْطْ | ضَبْط | ADDED TASHKEEL: final sukun |
| tta-040 | خَلْطْ | خَلْط | ADDED TASHKEEL: final sukun |
| tta-041 | غَلَطْ | غَلَط | ADDED TASHKEEL: final sukun |
| tta-042 | وَسَطْ | وَسَط | ADDED TASHKEEL: final sukun |
| tta-043 | قِسْطْ | قِسْط | ADDED TASHKEEL: final sukun |
| tta-044 | بَلَاطْ | بَلَاط | ADDED TASHKEEL: final sukun |

### zza: ظَاءْ (42 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zza-001 | ظَبْيْ | ظَبْي | ADDED TASHKEEL: final sukun |
| zza-002 | ظِلّْ | ظِلّ | ADDED TASHKEEL: final sukun |
| zza-003 | ظَرْفْ | ظَرْف | ADDED TASHKEEL: final sukun |
| zza-004 | ظُهْرْ | ظُهْر | ADDED TASHKEEL: final sukun |
| zza-005 | ظَلَامْ | ظَلَام | ADDED TASHKEEL: final sukun |
| zza-006 | ظَاهِرْ | ظَاهِر | ADDED TASHKEEL: final sukun |
| zza-007 | ظَالِمْ | ظَالِم | ADDED TASHKEEL: final sukun |
| zza-008 | ظَفَرْ | ظَفَر | ADDED TASHKEEL: final sukun |
| zza-009 | ظَمَأْ | ظَمَأ | ADDED TASHKEEL: final sukun |
| zza-010 | ظَنّْ | ظَنّ | ADDED TASHKEEL: final sukun |
| zza-011 | ظَرِيفْ | ظَرِيف | ADDED TASHKEEL: final sukun |
| zza-012 | ظُلْمْ | ظُلْم | ADDED TASHKEEL: final sukun |
| zza-013 | ظَهِيرَةْ | ظَهِيرَة | ADDED TASHKEEL: final sukun |
| zza-014 | ظَاهِرَةْ | ظَاهِرَة | ADDED TASHKEEL: final sukun |
| zza-015 | ظَفِيرَةْ | ظَفِيرَة | ADDED TASHKEEL: final sukun |
| zza-016 | نَظَّارَةْ | نَظَّارَة | ADDED TASHKEEL: final sukun |
| zza-017 | مَحْفَظَةْ | مَحْفَظَة | ADDED TASHKEEL: final sukun |
| zza-018 | نَظِيفْ | نَظِيف | ADDED TASHKEEL: final sukun |
| zza-019 | مُنَظَّمْ | مُنَظَّم | ADDED TASHKEEL: final sukun |
| zza-020 | حَظّْ | حَظّ | ADDED TASHKEEL: final sukun |
| zza-021 | نِظَامْ | نِظَام | ADDED TASHKEEL: final sukun |
| zza-022 | مُلَاحَظَةْ | مُلَاحَظَة | ADDED TASHKEEL: final sukun |
| zza-023 | حِفَاظْ | حِفَاظ | ADDED TASHKEEL: final sukun |
| zza-024 | أَنْظِمَةْ | أَنْظِمَة | ADDED TASHKEEL: final sukun |
| zza-025 | مَوْعِظَةْ | مَوْعِظَة | ADDED TASHKEEL: final sukun |
| zza-026 | عَظِيمْ | عَظِيم | ADDED TASHKEEL: final sukun |
| zza-027 | حَظِيرَةْ | حَظِيرَة | ADDED TASHKEEL: final sukun |
| zza-028 | نَظَرْ | نَظَر | ADDED TASHKEEL: final sukun |
| zza-029 | وَعْظْ | وَعْظ | ADDED TASHKEEL: final sukun |
| zza-030 | لَفْظْ | لَفْظ | ADDED TASHKEEL: final sukun |
| zza-031 | حِفْظْ | حِفْظ | ADDED TASHKEEL: final sukun |
| zza-032 | غَيْظْ | غَيْظ | ADDED TASHKEEL: final sukun |
| zza-033 | يَقَظَةْ | يَقَظَة | ADDED TASHKEEL: final sukun |
| zza-034 | فَظّْ | فَظّ | ADDED TASHKEEL: final sukun |
| zza-035 | كَظْمْ | كَظْم | ADDED TASHKEEL: final sukun |
| zza-036 | عَظْمْ | عَظْم | ADDED TASHKEEL: final sukun |
| zza-037 | نَظْمْ | نَظْم | ADDED TASHKEEL: final sukun |
| zza-038 | حَفِيظْ | حَفِيظ | ADDED TASHKEEL: final sukun |
| zza-039 | غَلِيظْ | غَلِيظ | ADDED TASHKEEL: final sukun |
| zza-040 | وَعِيظْ | وَعِيظ | ADDED TASHKEEL: final sukun |
| zza-041 | لَحْظْ | لَحْظ | ADDED TASHKEEL: final sukun |
| zza-042 | مُلَاحِظْ | مُلَاحِظ | ADDED TASHKEEL: final sukun |

### ain: عَيْنْ (40 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ain-001 | عَيْنْ | عَيْن | ADDED TASHKEEL: final sukun |
| ain-002 | عُصْفُورْ | عُصْفُور | ADDED TASHKEEL: final sukun |
| ain-003 | عِنَبْ | عِنَب | ADDED TASHKEEL: final sukun |
| ain-004 | عَسَلْ | عَسَل | ADDED TASHKEEL: final sukun |
| ain-005 | عَرُوسْ | عَرُوس | ADDED TASHKEEL: final sukun |
| ain-006 | عَقْرَبْ | عَقْرَب | ADDED TASHKEEL: final sukun |
| ain-007 | عَلَمْ | عَلَم | ADDED TASHKEEL: final sukun |
| ain-008 | عِلْمْ | عِلْم | ADDED TASHKEEL: final sukun |
| ain-009 | عَجَلَةْ | عَجَلَة | ADDED TASHKEEL: final sukun |
| ain-010 | عَمُودْ | عَمُود | ADDED TASHKEEL: final sukun |
| ain-011 | عَظِيمْ | عَظِيم | ADDED TASHKEEL: final sukun |
| ain-012 | عَادِلْ | عَادِل | ADDED TASHKEEL: final sukun |
| ain-013 | عَرَبِيّْ | عَرَبِيّ | ADDED TASHKEEL: final sukun |
| ain-014 | عَائِلَةْ | عَائِلَة | ADDED TASHKEEL: final sukun |
| ain-015 | عَمَلْ | عَمَل | ADDED TASHKEEL: final sukun |
| ain-016 | مَعْلَمْ | مَعْلَم | ADDED TASHKEEL: final sukun |
| ain-017 | شَمْعَةْ | شَمْعَة | ADDED TASHKEEL: final sukun |
| ain-018 | مَصْنَعْ | مَصْنَع | ADDED TASHKEEL: final sukun |
| ain-019 | سَاعَةْ | سَاعَة | ADDED TASHKEEL: final sukun |
| ain-020 | مَعْرِفَةْ | مَعْرِفَة | ADDED TASHKEEL: final sukun |
| ain-021 | نَعَامْ | نَعَام | ADDED TASHKEEL: final sukun |
| ain-022 | صَنَاعَةْ | صَنَاعَة | ADDED TASHKEEL: final sukun |
| ain-023 | رَبِيعْ | رَبِيع | ADDED TASHKEEL: final sukun |
| ain-024 | مَعْبَدْ | مَعْبَد | ADDED TASHKEEL: final sukun |
| ain-025 | جَامِعَةْ | جَامِعَة | ADDED TASHKEEL: final sukun |
| ain-026 | مُعَلِّمْ | مُعَلِّم | ADDED TASHKEEL: final sukun |
| ain-027 | بَدِيعْ | بَدِيع | ADDED TASHKEEL: final sukun |
| ain-028 | سَرِيعْ | سَرِيع | ADDED TASHKEEL: final sukun |
| ain-029 | مَنْبَعْ | مَنْبَع | ADDED TASHKEEL: final sukun |
| ain-030 | مَطْبَعْ | مَطْبَع | ADDED TASHKEEL: final sukun |
| ain-031 | شُجَاعْ | شُجَاع | ADDED TASHKEEL: final sukun |
| ain-032 | شَارِعْ | شَارِع | ADDED TASHKEEL: final sukun |
| ain-033 | جَامِعْ | جَامِع | ADDED TASHKEEL: final sukun |
| ain-034 | وَاسِعْ | وَاسِع | ADDED TASHKEEL: final sukun |
| ain-035 | رَائِعْ | رَائِع | ADDED TASHKEEL: final sukun |
| ain-036 | مُرْتَفِعْ | مُرْتَفِع | ADDED TASHKEEL: final sukun |
| ain-037 | مَطْلَعْ | مَطْلَع | ADDED TASHKEEL: final sukun |
| ain-038 | مَرْجِعْ | مَرْجِع | ADDED TASHKEEL: final sukun |
| ain-039 | مَوْضِعْ | مَوْضِع | ADDED TASHKEEL: final sukun |
| ain-040 | مَسْمَعْ | مَسْمَع | ADDED TASHKEEL: final sukun |

### ghain: غَيْنْ (42 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ghain-001 | غُرَابْ | غُرَاب | ADDED TASHKEEL: final sukun |
| ghain-002 | غَزَالْ | غَزَال | ADDED TASHKEEL: final sukun |
| ghain-003 | غَابَةْ | غَابَة | ADDED TASHKEEL: final sukun |
| ghain-004 | غُرْفَةْ | غُرْفَة | ADDED TASHKEEL: final sukun |
| ghain-005 | غَيْمَةْ | غَيْمَة | ADDED TASHKEEL: final sukun |
| ghain-006 | غِذَاءْ | غِذَاء | ADDED TASHKEEL: final sukun |
| ghain-007 | غَنِيّْ | غَنِيّ | ADDED TASHKEEL: final sukun |
| ghain-008 | غَرِيبْ | غَرِيب | ADDED TASHKEEL: final sukun |
| ghain-009 | غَسَّالَةْ | غَسَّالَة | ADDED TASHKEEL: final sukun |
| ghain-010 | غُصْنْ | غُصْن | ADDED TASHKEEL: final sukun |
| ghain-011 | غَدَاءْ | غَدَاء | ADDED TASHKEEL: final sukun |
| ghain-012 | غُبَارْ | غُبَار | ADDED TASHKEEL: final sukun |
| ghain-013 | غَضَبْ | غَضَب | ADDED TASHKEEL: final sukun |
| ghain-014 | غَفَلَةْ | غَفَلَة | ADDED TASHKEEL: final sukun |
| ghain-015 | غُرُوبْ | غُرُوب | ADDED TASHKEEL: final sukun |
| ghain-016 | صَغِيرْ | صَغِير | ADDED TASHKEEL: final sukun |
| ghain-017 | شُغْلْ | شُغْل | ADDED TASHKEEL: final sukun |
| ghain-018 | بَغْدَادْ | بَغْدَاد | ADDED TASHKEEL: final sukun |
| ghain-019 | فَرَاغْ | فَرَاغ | ADDED TASHKEEL: final sukun |
| ghain-020 | مَغْرِبْ | مَغْرِب | ADDED TASHKEEL: final sukun |
| ghain-021 | لُغَةْ | لُغَة | ADDED TASHKEEL: final sukun |
| ghain-022 | صِيَاغَةْ | صِيَاغَة | ADDED TASHKEEL: final sukun |
| ghain-023 | مُبَالَغَةْ | مُبَالَغَة | ADDED TASHKEEL: final sukun |
| ghain-024 | بُلُوغْ | بُلُوغ | ADDED TASHKEEL: final sukun |
| ghain-025 | فُرُوغْ | فُرُوغ | ADDED TASHKEEL: final sukun |
| ghain-026 | رَغِيفْ | رَغِيف | ADDED TASHKEEL: final sukun |
| ghain-027 | تَغْيِيرْ | تَغْيِير | ADDED TASHKEEL: final sukun |
| ghain-028 | مَغَارَةْ | مَغَارَة | ADDED TASHKEEL: final sukun |
| ghain-029 | صَاغْ | صَاغَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ghain-030 | بَلَّغْ | بَلَّغَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ghain-031 | بَلَاغْ | بَلَاغ | ADDED TASHKEEL: final sukun |
| ghain-032 | دِمَاغْ | دِمَاغ | ADDED TASHKEEL: final sukun |
| ghain-033 | صِبَاغْ | صِبَاغ | ADDED TASHKEEL: final sukun |
| ghain-034 | مَرَاغْ | مَرَاغ | ADDED TASHKEEL: final sukun |
| ghain-035 | صِيغْ | صِيغ | ADDED TASHKEEL: final sukun |
| ghain-036 | دَبَغْ | دَبَغ | ADDED TASHKEEL: final sukun |
| ghain-037 | صَبَغْ | صَبَغ | ADDED TASHKEEL: final sukun |
| ghain-038 | نَبَغْ | نَبَغ | ADDED TASHKEEL: final sukun |
| ghain-039 | بَالِغْ | بَالِغ | ADDED TASHKEEL: final sukun |
| ghain-040 | فَارِغْ | فَارِغ | ADDED TASHKEEL: final sukun |
| ghain-041 | صَائِغْ | صَائِغ | ADDED TASHKEEL: final sukun |
| ghain-042 | مُبَالِغْ | مُبَالِغ | ADDED TASHKEEL: final sukun |

### fa: فَاءْ (44 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| fa-001 | فِيلْ | فِيل | ADDED TASHKEEL: final sukun |
| fa-002 | فَرَاشَةْ | فَرَاشَة | ADDED TASHKEEL: final sukun |
| fa-003 | فُسْتَانْ | فُسْتَان | ADDED TASHKEEL: final sukun |
| fa-004 | فَأْرْ | فَأْر | ADDED TASHKEEL: final sukun |
| fa-005 | فُولْ | فُول | ADDED TASHKEEL: final sukun |
| fa-006 | فَانُوسْ | فَانُوس | ADDED TASHKEEL: final sukun |
| fa-007 | فُنْدُقْ | فُنْدُق | ADDED TASHKEEL: final sukun |
| fa-008 | فَرَحْ | فَرَح | ADDED TASHKEEL: final sukun |
| fa-009 | فَوَاكِهْ | فَوَاكِه | ADDED TASHKEEL: final sukun |
| fa-010 | فَلَّاحْ | فَلَّاح | ADDED TASHKEEL: final sukun |
| fa-011 | فَجْرْ | فَجْر | ADDED TASHKEEL: final sukun |
| fa-012 | فَضَاءْ | فَضَاء | ADDED TASHKEEL: final sukun |
| fa-013 | فَصْلْ | فَصْل | ADDED TASHKEEL: final sukun |
| fa-014 | فَنّْ | فَنّ | ADDED TASHKEEL: final sukun |
| fa-015 | فِكْرَةْ | فِكْرَة | ADDED TASHKEEL: final sukun |
| fa-016 | تُفَّاحْ | تُفَّاح | ADDED TASHKEEL: final sukun |
| fa-017 | دَفْتَرْ | دَفْتَر | ADDED TASHKEEL: final sukun |
| fa-018 | عُصْفُورْ | عُصْفُور | ADDED TASHKEEL: final sukun |
| fa-019 | سَفِينَةْ | سَفِينَة | ADDED TASHKEEL: final sukun |
| fa-020 | مِفْتَاحْ | مِفْتَاح | ADDED TASHKEEL: final sukun |
| fa-021 | كَفِيلْ | كَفِيل | ADDED TASHKEEL: final sukun |
| fa-022 | نَفْسْ | نَفْس | ADDED TASHKEEL: final sukun |
| fa-023 | حَفْلَةْ | حَفْلَة | ADDED TASHKEEL: final sukun |
| fa-024 | رَفِيقْ | رَفِيق | ADDED TASHKEEL: final sukun |
| fa-025 | صَفّْ | صَفّ | ADDED TASHKEEL: final sukun |
| fa-026 | قَفَصْ | قَفَص | ADDED TASHKEEL: final sukun |
| fa-027 | لَفْتْ | لَفْت | ADDED TASHKEEL: final sukun |
| fa-028 | عَفْوْ | عَفْو | ADDED TASHKEEL: final sukun |
| fa-029 | سَافَرْ | سَافَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| fa-030 | غَافَلْ | غَافَلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| fa-031 | خَرُوفْ | خَرُوف | ADDED TASHKEEL: final sukun |
| fa-032 | صَيْفْ | صَيْف | ADDED TASHKEEL: final sukun |
| fa-033 | ضَيْفْ | ضَيْف | ADDED TASHKEEL: final sukun |
| fa-034 | سَقْفْ | سَقْف | ADDED TASHKEEL: final sukun |
| fa-035 | رَفّْ | رَفّ | ADDED TASHKEEL: final sukun |
| fa-036 | كَهْفْ | كَهْف | ADDED TASHKEEL: final sukun |
| fa-037 | نَصْفْ | نَصْف | ADDED TASHKEEL: final sukun |
| fa-038 | ظَرْفْ | ظَرْف | ADDED TASHKEEL: final sukun |
| fa-039 | حَرْفْ | حَرْف | ADDED TASHKEEL: final sukun |
| fa-040 | عَطْفْ | عَطْف | ADDED TASHKEEL: final sukun |
| fa-041 | لُطْفْ | لُطْف | ADDED TASHKEEL: final sukun |
| fa-042 | ضَعْفْ | ضَعْف | ADDED TASHKEEL: final sukun |
| fa-043 | خَوْفْ | خَوْف | ADDED TASHKEEL: final sukun |
| fa-044 | أَلْفْ | أَلْف | ADDED TASHKEEL: final sukun |

### qaf: قَافْ (42 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| qaf-001 | قَمَرْ | قَمَر | ADDED TASHKEEL: final sukun |
| qaf-002 | قِطَّةْ | قِطَّة | ADDED TASHKEEL: final sukun |
| qaf-003 | قَلَمْ | قَلَم | ADDED TASHKEEL: final sukun |
| qaf-004 | قَلْبْ | قَلْب | ADDED TASHKEEL: final sukun |
| qaf-005 | قَصْرْ | قَصْر | ADDED TASHKEEL: final sukun |
| qaf-006 | قَارِبْ | قَارِب | ADDED TASHKEEL: final sukun |
| qaf-007 | قِرْدْ | قِرْد | ADDED TASHKEEL: final sukun |
| qaf-008 | قَوْسْ | قَوْس | ADDED TASHKEEL: final sukun |
| qaf-009 | قَمِيصْ | قَمِيص | ADDED TASHKEEL: final sukun |
| qaf-010 | قَهْوَةْ | قَهْوَة | ADDED TASHKEEL: final sukun |
| qaf-011 | قَائِدْ | قَائِد | ADDED TASHKEEL: final sukun |
| qaf-012 | قَرْيَةْ | قَرْيَة | ADDED TASHKEEL: final sukun |
| qaf-013 | قَدَمْ | قَدَم | ADDED TASHKEEL: final sukun |
| qaf-014 | قُوَّةْ | قُوَّة | ADDED TASHKEEL: final sukun |
| qaf-015 | قِصَّةْ | قِصَّة | ADDED TASHKEEL: final sukun |
| qaf-016 | صَدِيقْ | صَدِيق | ADDED TASHKEEL: final sukun |
| qaf-017 | حَقِيبَةْ | حَقِيبَة | ADDED TASHKEEL: final sukun |
| qaf-018 | عَقْرَبْ | عَقْرَب | ADDED TASHKEEL: final sukun |
| qaf-019 | بَقَرَةْ | بَقَرَة | ADDED TASHKEEL: final sukun |
| qaf-020 | طَرِيقْ | طَرِيق | ADDED TASHKEEL: final sukun |
| qaf-021 | دَقِيقْ | دَقِيق | ADDED TASHKEEL: final sukun |
| qaf-022 | رَقَمْ | رَقَم | ADDED TASHKEEL: final sukun |
| qaf-023 | سُوقْ | سُوق | ADDED TASHKEEL: final sukun |
| qaf-024 | وَقْتْ | وَقْت | ADDED TASHKEEL: final sukun |
| qaf-025 | مُوسِيقَى | — | — |
| qaf-026 | حَقِيقَةْ | حَقِيقَة | ADDED TASHKEEL: final sukun |
| qaf-027 | عَقْلْ | عَقْل | ADDED TASHKEEL: final sukun |
| qaf-028 | نُقْطَةْ | نُقْطَة | ADDED TASHKEEL: final sukun |
| qaf-029 | مَقَالْ | مَقَال | ADDED TASHKEEL: final sukun |
| qaf-030 | فَقِيرْ | فَقِير | ADDED TASHKEEL: final sukun |
| qaf-031 | حَرِيقْ | حَرِيق | ADDED TASHKEEL: final sukun |
| qaf-032 | عَمِيقْ | عَمِيق | ADDED TASHKEEL: final sukun |
| qaf-033 | رَفِيقْ | رَفِيق | ADDED TASHKEEL: final sukun |
| qaf-034 | شَفَقْ | شَفَق | ADDED TASHKEEL: final sukun |
| qaf-035 | بَرْقْ | بَرْق | ADDED TASHKEEL: final sukun |
| qaf-036 | وَرَقْ | وَرَق | ADDED TASHKEEL: final sukun |
| qaf-037 | فُنْدُقْ | فُنْدُق | ADDED TASHKEEL: final sukun |
| qaf-038 | شَرْقْ | شَرْق | ADDED TASHKEEL: final sukun |
| qaf-039 | فَوْقْ | فَوْق | ADDED TASHKEEL: final sukun |
| qaf-040 | حَقّْ | حَقّ | ADDED TASHKEEL: final sukun |
| qaf-041 | سَبَقْ | سَبَق | ADDED TASHKEEL: final sukun |
| qaf-042 | فَرَقْ | فَرَق | ADDED TASHKEEL: final sukun |

### kaf: كَافْ (44 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kaf-001 | كِتَابْ | كِتَاب | ADDED TASHKEEL: final sukun |
| kaf-002 | كَلْبْ | كَلْب | ADDED TASHKEEL: final sukun |
| kaf-003 | كُرَةْ | كُرَة | ADDED TASHKEEL: final sukun |
| kaf-004 | كَنْزْ | كَنْز | ADDED TASHKEEL: final sukun |
| kaf-005 | كُرْسِيّْ | كُرْسِيّ | ADDED TASHKEEL: final sukun |
| kaf-006 | كَعْكَةْ | كَعْكَة | ADDED TASHKEEL: final sukun |
| kaf-007 | كَوْكَبْ | كَوْكَب | ADDED TASHKEEL: final sukun |
| kaf-008 | كَبِيرْ | كَبِير | ADDED TASHKEEL: final sukun |
| kaf-009 | كَرِيمْ | كَرِيم | ADDED TASHKEEL: final sukun |
| kaf-010 | كَهْفْ | كَهْف | ADDED TASHKEEL: final sukun |
| kaf-011 | كَمَانْ | كَمَان | ADDED TASHKEEL: final sukun |
| kaf-012 | كَنِيسَةْ | كَنِيسَة | ADDED TASHKEEL: final sukun |
| kaf-013 | كَسُولْ | كَسُول | ADDED TASHKEEL: final sukun |
| kaf-014 | كَلِمَةْ | كَلِمَة | ADDED TASHKEEL: final sukun |
| kaf-015 | كَثِيرْ | كَثِير | ADDED TASHKEEL: final sukun |
| kaf-016 | سَمَكَةْ | سَمَكَة | ADDED TASHKEEL: final sukun |
| kaf-017 | مَكْتَبَةْ | مَكْتَبَة | ADDED TASHKEEL: final sukun |
| kaf-018 | سُكَّرْ | سُكَّر | ADDED TASHKEEL: final sukun |
| kaf-019 | شُكْرْ | شُكْر | ADDED TASHKEEL: final sukun |
| kaf-020 | ذَكِيّْ | ذَكِيّ | ADDED TASHKEEL: final sukun |
| kaf-021 | مَكَانْ | مَكَان | ADDED TASHKEEL: final sukun |
| kaf-022 | حِكَايَةْ | حِكَايَة | ADDED TASHKEEL: final sukun |
| kaf-023 | شَبَكَةْ | شَبَكَة | ADDED TASHKEEL: final sukun |
| kaf-024 | رُكْبَةْ | رُكْبَة | ADDED TASHKEEL: final sukun |
| kaf-025 | مُبَارَكْ | مُبَارَك | ADDED TASHKEEL: final sukun |
| kaf-026 | فِكْرَةْ | فِكْرَة | ADDED TASHKEEL: final sukun |
| kaf-027 | ذِكْرَى | — | — |
| kaf-028 | مَكْتَبْ | مَكْتَب | ADDED TASHKEEL: final sukun |
| kaf-029 | بَكَى | — | — |
| kaf-030 | سَكَنْ | سَكَنَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| kaf-031 | دِيكْ | دِيك | ADDED TASHKEEL: final sukun |
| kaf-032 | سَمَكْ | سَمَك | ADDED TASHKEEL: final sukun |
| kaf-033 | مَلِكْ | مَلِك | ADDED TASHKEEL: final sukun |
| kaf-034 | شَرِيكْ | شَرِيك | ADDED TASHKEEL: final sukun |
| kaf-035 | بَنْكْ | بَنْك | ADDED TASHKEEL: final sukun |
| kaf-036 | فَلَكْ | فَلَك | ADDED TASHKEEL: final sukun |
| kaf-037 | حَرَكْ | حَرَك | ADDED TASHKEEL: final sukun |
| kaf-038 | دَرَكْ | دَرَك | ADDED TASHKEEL: final sukun |
| kaf-039 | سِلْكْ | سِلْك | ADDED TASHKEEL: final sukun |
| kaf-040 | مِسْكْ | مِسْك | ADDED TASHKEEL: final sukun |
| kaf-041 | تُرْكْ | تُرْك | ADDED TASHKEEL: final sukun |
| kaf-042 | شَوْكْ | شَوْك | ADDED TASHKEEL: final sukun |
| kaf-043 | مُشْتَرَكْ | مُشْتَرَك | ADDED TASHKEEL: final sukun |
| kaf-044 | مَسْلَكْ | مَسْلَك | ADDED TASHKEEL: final sukun |

### lam: لَامْ (42 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| lam-001 | لَيْمُونْ | لَيْمُون | ADDED TASHKEEL: final sukun |
| lam-002 | لُعْبَةْ | لُعْبَة | ADDED TASHKEEL: final sukun |
| lam-003 | لَحْمْ | لَحْم | ADDED TASHKEEL: final sukun |
| lam-004 | لَوْنْ | لَوْن | ADDED TASHKEEL: final sukun |
| lam-005 | لِسَانْ | لِسَان | ADDED TASHKEEL: final sukun |
| lam-006 | لَيْلْ | لَيْل | ADDED TASHKEEL: final sukun |
| lam-007 | لُؤْلُؤْ | لُؤْلُؤ | ADDED TASHKEEL: final sukun |
| lam-008 | لَبَنْ | لَبَن | ADDED TASHKEEL: final sukun |
| lam-009 | لَوْحَةْ | لَوْحَة | ADDED TASHKEEL: final sukun |
| lam-010 | لَطِيفْ | لَطِيف | ADDED TASHKEEL: final sukun |
| lam-011 | لُغَةْ | لُغَة | ADDED TASHKEEL: final sukun |
| lam-012 | لَهَبْ | لَهَب | ADDED TASHKEEL: final sukun |
| lam-013 | لَقَبْ | لَقَب | ADDED TASHKEEL: final sukun |
| lam-014 | لَذِيذْ | لَذِيذ | ADDED TASHKEEL: final sukun |
| lam-015 | لَمْسْ | لَمْس | ADDED TASHKEEL: final sukun |
| lam-016 | فِيلْ | فِيل | ADDED TASHKEEL: final sukun |
| lam-017 | جَمَلْ | جَمَل | ADDED TASHKEEL: final sukun |
| lam-018 | عَسَلْ | عَسَل | ADDED TASHKEEL: final sukun |
| lam-019 | بَلَدْ | بَلَد | ADDED TASHKEEL: final sukun |
| lam-020 | قَلَمْ | قَلَم | ADDED TASHKEEL: final sukun |
| lam-021 | سُلَحْفَاةْ | سُلَحْفَاة | ADDED TASHKEEL: final sukun |
| lam-022 | عِلْمْ | عِلْم | ADDED TASHKEEL: final sukun |
| lam-023 | ظِلّْ | ظِلّ | ADDED TASHKEEL: final sukun |
| lam-024 | حَلِيبْ | حَلِيب | ADDED TASHKEEL: final sukun |
| lam-025 | جَلِيدْ | جَلِيد | ADDED TASHKEEL: final sukun |
| lam-026 | مَلِكْ | مَلِك | ADDED TASHKEEL: final sukun |
| lam-027 | سَلَامْ | سَلَام | ADDED TASHKEEL: final sukun |
| lam-028 | عَالَمْ | عَالَم | ADDED TASHKEEL: final sukun |
| lam-029 | كَلِمَةْ | كَلِمَة | ADDED TASHKEEL: final sukun |
| lam-030 | مَلْعَبْ | مَلْعَب | ADDED TASHKEEL: final sukun |
| lam-031 | جَبَلْ | جَبَل | ADDED TASHKEEL: final sukun |
| lam-032 | نَحْلْ | نَحْل | ADDED TASHKEEL: final sukun |
| lam-033 | رَمْلْ | رَمْل | ADDED TASHKEEL: final sukun |
| lam-034 | طِفْلْ | طِفْل | ADDED TASHKEEL: final sukun |
| lam-035 | عَقْلْ | عَقْل | ADDED TASHKEEL: final sukun |
| lam-036 | فَصْلْ | فَصْل | ADDED TASHKEEL: final sukun |
| lam-037 | نَخْلْ | نَخْل | ADDED TASHKEEL: final sukun |
| lam-038 | حَبْلْ | حَبْل | ADDED TASHKEEL: final sukun |
| lam-039 | مَنْزِلْ | مَنْزِل | ADDED TASHKEEL: final sukun |
| lam-040 | عَمَلْ | عَمَل | ADDED TASHKEEL: final sukun |
| lam-041 | أَمَلْ | أَمَل | ADDED TASHKEEL: final sukun |
| lam-042 | مَحَلّْ | مَحَلّ | ADDED TASHKEEL: final sukun |

### mim: مِيمْ (45 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| mim-001 | مَدْرَسَةْ | مَدْرَسَة | ADDED TASHKEEL: final sukun |
| mim-002 | مَوْزْ | مَوْز | ADDED TASHKEEL: final sukun |
| mim-003 | مِفْتَاحْ | مِفْتَاح | ADDED TASHKEEL: final sukun |
| mim-004 | مَسْجِدْ | مَسْجِد | ADDED TASHKEEL: final sukun |
| mim-005 | مَلِكْ | مَلِك | ADDED TASHKEEL: final sukun |
| mim-006 | مَكْتَبَةْ | مَكْتَبَة | ADDED TASHKEEL: final sukun |
| mim-007 | مِصْبَاحْ | مِصْبَاح | ADDED TASHKEEL: final sukun |
| mim-008 | مَطَرْ | مَطَر | ADDED TASHKEEL: final sukun |
| mim-009 | مُعَلِّمْ | مُعَلِّم | ADDED TASHKEEL: final sukun |
| mim-010 | مَدِينَةْ | مَدِينَة | ADDED TASHKEEL: final sukun |
| mim-011 | مَرْكَبْ | مَرْكَب | ADDED TASHKEEL: final sukun |
| mim-012 | مُوسِيقَى | — | — |
| mim-013 | مَائِدَةْ | مَائِدَة | ADDED TASHKEEL: final sukun |
| mim-014 | مَنْزِلْ | مَنْزِل | ADDED TASHKEEL: final sukun |
| mim-015 | مَلْعَبْ | مَلْعَب | ADDED TASHKEEL: final sukun |
| mim-016 | جَمَلْ | جَمَل | ADDED TASHKEEL: final sukun |
| mim-017 | سَمَكَةْ | سَمَكَة | ADDED TASHKEEL: final sukun |
| mim-018 | شَمْسْ | شَمْس | ADDED TASHKEEL: final sukun |
| mim-019 | قَمَرْ | قَمَر | ADDED TASHKEEL: final sukun |
| mim-020 | تَمْرْ | تَمْر | ADDED TASHKEEL: final sukun |
| mim-021 | حَمَامَةْ | حَمَامَة | ADDED TASHKEEL: final sukun |
| mim-022 | عَمُودْ | عَمُود | ADDED TASHKEEL: final sukun |
| mim-023 | ثَمَرَةْ | ثَمَرَة | ADDED TASHKEEL: final sukun |
| mim-024 | رُمَّانْ | رُمَّان | ADDED TASHKEEL: final sukun |
| mim-025 | سَمَاءْ | سَمَاء | ADDED TASHKEEL: final sukun |
| mim-026 | زَمَانْ | زَمَان | ADDED TASHKEEL: final sukun |
| mim-027 | حِمَارْ | حِمَار | ADDED TASHKEEL: final sukun |
| mim-028 | جَمِيلْ | جَمِيل | ADDED TASHKEEL: final sukun |
| mim-029 | سَمِينْ | سَمِين | ADDED TASHKEEL: final sukun |
| mim-030 | عَمِيقْ | عَمِيق | ADDED TASHKEEL: final sukun |
| mim-031 | قَلَمْ | قَلَم | ADDED TASHKEEL: final sukun |
| mim-032 | عَلَمْ | عَلَم | ADDED TASHKEEL: final sukun |
| mim-033 | رَقَمْ | رَقَم | ADDED TASHKEEL: final sukun |
| mim-034 | نَجْمْ | نَجْم | ADDED TASHKEEL: final sukun |
| mim-035 | عِلْمْ | عِلْم | ADDED TASHKEEL: final sukun |
| mim-036 | حُلْمْ | حُلْم | ADDED TASHKEEL: final sukun |
| mim-037 | سَلَامْ | سَلَام | ADDED TASHKEEL: final sukun |
| mim-038 | كَلَامْ | كَلَام | ADDED TASHKEEL: final sukun |
| mim-039 | نِظَامْ | نِظَام | ADDED TASHKEEL: final sukun |
| mim-040 | طَعَامْ | طَعَام | ADDED TASHKEEL: final sukun |
| mim-041 | إِسْلَامْ | إِسْلَام | ADDED TASHKEEL: final sukun |
| mim-042 | اهْتِمَامْ | اهْتِمَام | ADDED TASHKEEL: final sukun |
| mim-043 | سَهْمْ | سَهْم | ADDED TASHKEEL: final sukun |
| mim-044 | وَهْمْ | وَهْم | ADDED TASHKEEL: final sukun |
| mim-045 | فَهْمْ | فَهْم | ADDED TASHKEEL: final sukun |

### nun: نُونْ (43 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| nun-001 | نَجْمَةْ | نَجْمَة | ADDED TASHKEEL: final sukun |
| nun-002 | نَحْلَةْ | نَحْلَة | ADDED TASHKEEL: final sukun |
| nun-003 | نَمِرْ | نَمِر | ADDED TASHKEEL: final sukun |
| nun-004 | نَهْرْ | نَهْر | ADDED TASHKEEL: final sukun |
| nun-005 | نَارْ | نَار | ADDED TASHKEEL: final sukun |
| nun-006 | نَخْلَةْ | نَخْلَة | ADDED TASHKEEL: final sukun |
| nun-007 | نُورْ | نُور | ADDED TASHKEEL: final sukun |
| nun-008 | نَمْلَةْ | نَمْلَة | ADDED TASHKEEL: final sukun |
| nun-009 | نَظِيفْ | نَظِيف | ADDED TASHKEEL: final sukun |
| nun-010 | نَسِيمْ | نَسِيم | ADDED TASHKEEL: final sukun |
| nun-011 | نَبَاتْ | نَبَات | ADDED TASHKEEL: final sukun |
| nun-012 | نِسْرْ | نِسْر | ADDED TASHKEEL: final sukun |
| nun-013 | نَشِيدْ | نَشِيد | ADDED TASHKEEL: final sukun |
| nun-014 | نَافِذَةْ | نَافِذَة | ADDED TASHKEEL: final sukun |
| nun-015 | نَعَامْ | نَعَام | ADDED TASHKEEL: final sukun |
| nun-016 | بِنْتْ | بِنْت | ADDED TASHKEEL: final sukun |
| nun-017 | عِنَبْ | عِنَب | ADDED TASHKEEL: final sukun |
| nun-018 | إِنْسَانْ | إِنْسَان | ADDED TASHKEEL: final sukun |
| nun-019 | كَنْزْ | كَنْز | ADDED TASHKEEL: final sukun |
| nun-020 | مَنْزِلْ | مَنْزِل | ADDED TASHKEEL: final sukun |
| nun-021 | جُنْدِيّْ | جُنْدِيّ | ADDED TASHKEEL: final sukun |
| nun-022 | فُنْدُقْ | فُنْدُق | ADDED TASHKEEL: final sukun |
| nun-023 | سِنّْ | سِنّ | ADDED TASHKEEL: final sukun |
| nun-024 | عَيْنْ | عَيْن | ADDED TASHKEEL: final sukun |
| nun-025 | لُبْنَانْ | لُبْنَان | ADDED TASHKEEL: final sukun |
| nun-026 | أَنَانَاسْ | أَنَانَاس | ADDED TASHKEEL: final sukun |
| nun-027 | قِنْدِيلْ | قِنْدِيل | ADDED TASHKEEL: final sukun |
| nun-028 | مُهَنْدِسْ | مُهَنْدِس | ADDED TASHKEEL: final sukun |
| nun-029 | فَنّْ | فَنّ | ADDED TASHKEEL: final sukun |
| nun-030 | ثَانِي | — | — |
| nun-031 | حِصَانْ | حِصَان | ADDED TASHKEEL: final sukun |
| nun-032 | بُسْتَانْ | بُسْتَان | ADDED TASHKEEL: final sukun |
| nun-033 | دُكَّانْ | دُكَّان | ADDED TASHKEEL: final sukun |
| nun-034 | مِيزَانْ | مِيزَان | ADDED TASHKEEL: final sukun |
| nun-035 | أَذَانْ | أَذَان | ADDED TASHKEEL: final sukun |
| nun-036 | زَمَانْ | زَمَان | ADDED TASHKEEL: final sukun |
| nun-037 | مَكَانْ | مَكَان | ADDED TASHKEEL: final sukun |
| nun-038 | أَلْوَانْ | أَلْوَان | ADDED TASHKEEL: final sukun |
| nun-039 | حَيَوَانْ | حَيَوَان | ADDED TASHKEEL: final sukun |
| nun-040 | عُنْوَانْ | عُنْوَان | ADDED TASHKEEL: final sukun |
| nun-041 | بُرْهَانْ | بُرْهَان | ADDED TASHKEEL: final sukun |
| nun-042 | سُلْطَانْ | سُلْطَان | ADDED TASHKEEL: final sukun |
| nun-043 | إِيمَانْ | إِيمَان | ADDED TASHKEEL: final sukun |

### ha: هَاءْ (45 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ha-001 | هِلَالْ | هِلَال | ADDED TASHKEEL: final sukun |
| ha-002 | هُدْهُدْ | هُدْهُد | ADDED TASHKEEL: final sukun |
| ha-003 | هَدِيَّةْ | هَدِيَّة | ADDED TASHKEEL: final sukun |
| ha-004 | هَاتِفْ | هَاتِف | ADDED TASHKEEL: final sukun |
| ha-005 | هَوَاءْ | هَوَاء | ADDED TASHKEEL: final sukun |
| ha-006 | هِرَّةْ | هِرَّة | ADDED TASHKEEL: final sukun |
| ha-007 | هَرَمْ | هَرَم | ADDED TASHKEEL: final sukun |
| ha-008 | هَدَفْ | هَدَف | ADDED TASHKEEL: final sukun |
| ha-009 | هَمْسَةْ | هَمْسَة | ADDED TASHKEEL: final sukun |
| ha-010 | هَادِئْ | هَادِئ | ADDED TASHKEEL: final sukun |
| ha-011 | هَنَاءْ | هَنَاء | ADDED TASHKEEL: final sukun |
| ha-012 | هِجْرَةْ | هِجْرَة | ADDED TASHKEEL: final sukun |
| ha-013 | هَيْكَلْ | هَيْكَل | ADDED TASHKEEL: final sukun |
| ha-014 | هَضْبَةْ | هَضْبَة | ADDED TASHKEEL: final sukun |
| ha-015 | هُنَاكْ | هُنَاك | ADDED TASHKEEL: final sukun |
| ha-016 | نَهْرْ | نَهْر | ADDED TASHKEEL: final sukun |
| ha-017 | ظُهْرْ | ظُهْر | ADDED TASHKEEL: final sukun |
| ha-018 | شَهْرْ | شَهْر | ADDED TASHKEEL: final sukun |
| ha-019 | زَهْرَةْ | زَهْرَة | ADDED TASHKEEL: final sukun |
| ha-020 | فَهْمْ | فَهْم | ADDED TASHKEEL: final sukun |
| ha-021 | سَهْلْ | سَهْل | ADDED TASHKEEL: final sukun |
| ha-022 | أَهْلْ | أَهْل | ADDED TASHKEEL: final sukun |
| ha-023 | جَوْهَرْ | جَوْهَر | ADDED TASHKEEL: final sukun |
| ha-024 | مَهَارَةْ | مَهَارَة | ADDED TASHKEEL: final sukun |
| ha-025 | شَهَادَةْ | شَهَادَة | ADDED TASHKEEL: final sukun |
| ha-026 | نَظَاهُرْ | نَظَاهُر | ADDED TASHKEEL: final sukun |
| ha-027 | مُشَاهَدَةْ | مُشَاهَدَة | ADDED TASHKEEL: final sukun |
| ha-028 | ظَاهِرَةْ | ظَاهِرَة | ADDED TASHKEEL: final sukun |
| ha-029 | بَاهِرْ | بَاهِر | ADDED TASHKEEL: final sukun |
| ha-030 | طَاهِرْ | طَاهِر | ADDED TASHKEEL: final sukun |
| ha-031 | وَجْهْ | وَجْه | ADDED TASHKEEL: final sukun |
| ha-032 | فَاكِهَةْ | فَاكِهَة | ADDED TASHKEEL: final sukun |
| ha-033 | نَزِيهْ | نَزِيه | ADDED TASHKEEL: final sukun |
| ha-034 | شَبِيهْ | شَبِيه | ADDED TASHKEEL: final sukun |
| ha-035 | تَنْبِيهْ | تَنْبِيه | ADDED TASHKEEL: final sukun |
| ha-036 | تَوْجِيهْ | تَوْجِيه | ADDED TASHKEEL: final sukun |
| ha-037 | فِقْهْ | فِقْه | ADDED TASHKEEL: final sukun |
| ha-038 | سَفِيهْ | سَفِيه | ADDED TASHKEEL: final sukun |
| ha-039 | نَبِيهْ | نَبِيه | ADDED TASHKEEL: final sukun |
| ha-040 | وَجِيهْ | وَجِيه | ADDED TASHKEEL: final sukun |
| ha-041 | مِيَاهْ | مِيَاه | ADDED TASHKEEL: final sukun |
| ha-042 | أَفْوَاهْ | أَفْوَاه | ADDED TASHKEEL: final sukun |
| ha-043 | شِفَاهْ | شِفَاه | ADDED TASHKEEL: final sukun |
| ha-044 | سِلَاهْ | سِلَاه | ADDED TASHKEEL: final sukun |
| ha-045 | رِفَاهْ | رِفَاه | ADDED TASHKEEL: final sukun |

### waw: وَاوْ (45 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| waw-001 | وَرْدَةْ | وَرْدَة | ADDED TASHKEEL: final sukun |
| waw-002 | وَلَدْ | وَلَد | ADDED TASHKEEL: final sukun |
| waw-003 | وَزَّةْ | وَزَّة | ADDED TASHKEEL: final sukun |
| waw-004 | وَطَنْ | وَطَن | ADDED TASHKEEL: final sukun |
| waw-005 | وَقْتْ | وَقْت | ADDED TASHKEEL: final sukun |
| waw-006 | وَجْهْ | وَجْه | ADDED TASHKEEL: final sukun |
| waw-007 | وَعْدْ | وَعْد | ADDED TASHKEEL: final sukun |
| waw-008 | وَسَادَةْ | وَسَادَة | ADDED TASHKEEL: final sukun |
| waw-009 | وَاحَةْ | وَاحَة | ADDED TASHKEEL: final sukun |
| waw-010 | وَزِيرْ | وَزِير | ADDED TASHKEEL: final sukun |
| waw-011 | وَالِدْ | وَالِد | ADDED TASHKEEL: final sukun |
| waw-012 | وَصْفَةْ | وَصْفَة | ADDED TASHKEEL: final sukun |
| waw-013 | وَحِيدْ | وَحِيد | ADDED TASHKEEL: final sukun |
| waw-014 | وَفَاءْ | وَفَاء | ADDED TASHKEEL: final sukun |
| waw-015 | وَسِيلَةْ | وَسِيلَة | ADDED TASHKEEL: final sukun |
| waw-016 | مَوْزْ | مَوْز | ADDED TASHKEEL: final sukun |
| waw-017 | نُورْ | نُور | ADDED TASHKEEL: final sukun |
| waw-018 | صُورَةْ | صُورَة | ADDED TASHKEEL: final sukun |
| waw-019 | ثَوْبْ | ثَوْب | ADDED TASHKEEL: final sukun |
| waw-020 | لَوْنْ | لَوْن | ADDED TASHKEEL: final sukun |
| waw-021 | خَوْخْ | خَوْخ | ADDED TASHKEEL: final sukun |
| waw-022 | جَوْزْ | جَوْز | ADDED TASHKEEL: final sukun |
| waw-023 | حُوتْ | حُوت | ADDED TASHKEEL: final sukun |
| waw-024 | سُورْ | سُور | ADDED TASHKEEL: final sukun |
| waw-025 | دَوْرْ | دَوْر | ADDED TASHKEEL: final sukun |
| waw-026 | فَوْزْ | فَوْز | ADDED TASHKEEL: final sukun |
| waw-027 | قُوَّةْ | قُوَّة | ADDED TASHKEEL: final sukun |
| waw-028 | رُوحْ | رُوح | ADDED TASHKEEL: final sukun |
| waw-029 | سُوقْ | سُوق | ADDED TASHKEEL: final sukun |
| waw-030 | غُرُوبْ | غُرُوب | ADDED TASHKEEL: final sukun |
| waw-031 | حُلْوْ | حُلْو | ADDED TASHKEEL: final sukun |
| waw-032 | عَفْوْ | عَفْو | ADDED TASHKEEL: final sukun |
| waw-033 | جَوّْ | جَوّ | ADDED TASHKEEL: final sukun |
| waw-034 | دَلْوْ | دَلْو | ADDED TASHKEEL: final sukun |
| waw-035 | غَزْوْ | غَزْو | ADDED TASHKEEL: final sukun |
| waw-036 | نَحْوْ | نَحْو | ADDED TASHKEEL: final sukun |
| waw-037 | سَهْوْ | سَهْو | ADDED TASHKEEL: final sukun |
| waw-038 | مَحْوْ | مَحْو | ADDED TASHKEEL: final sukun |
| waw-039 | شَكْوْ | شَكْو | ADDED TASHKEEL: final sukun |
| waw-040 | رَجْوْ | رَجْو | ADDED TASHKEEL: final sukun |
| waw-041 | عُلُوّْ | عُلُوّ | ADDED TASHKEEL: final sukun |
| waw-042 | سُمُوّْ | سُمُوّ | ADDED TASHKEEL: final sukun |
| waw-043 | نُمُوّْ | نُمُوّ | ADDED TASHKEEL: final sukun |
| waw-044 | بَدْوْ | بَدْو | ADDED TASHKEEL: final sukun |
| waw-045 | هَدُو | — | — |

### ya: يَاءْ (45 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ya-001 | يَدْ | يَد | ADDED TASHKEEL: final sukun |
| ya-002 | يَمَامَةْ | يَمَامَة | ADDED TASHKEEL: final sukun |
| ya-003 | يَقْطِينْ | يَقْطِين | ADDED TASHKEEL: final sukun |
| ya-004 | يَاسَمِينْ | يَاسَمِين | ADDED TASHKEEL: final sukun |
| ya-005 | يَوْمْ | يَوْم | ADDED TASHKEEL: final sukun |
| ya-006 | يَنْبُوعْ | يَنْبُوع | ADDED TASHKEEL: final sukun |
| ya-007 | يَخْتْ | يَخْت | ADDED TASHKEEL: final sukun |
| ya-008 | يَابَانْ | يَابَان | ADDED TASHKEEL: final sukun |
| ya-009 | يَسَارْ | يَسَار | ADDED TASHKEEL: final sukun |
| ya-010 | يَتِيمْ | يَتِيم | ADDED TASHKEEL: final sukun |
| ya-011 | يَقِينْ | يَقِين | ADDED TASHKEEL: final sukun |
| ya-012 | يَنَابِيعْ | يَنَابِيع | ADDED TASHKEEL: final sukun |
| ya-013 | يُسْرْ | يُسْر | ADDED TASHKEEL: final sukun |
| ya-014 | يَمِينْ | يَمِين | ADDED TASHKEEL: final sukun |
| ya-015 | يَقَظَةْ | يَقَظَة | ADDED TASHKEEL: final sukun |
| ya-016 | بَيْتْ | بَيْت | ADDED TASHKEEL: final sukun |
| ya-017 | زَيْتُونْ | زَيْتُون | ADDED TASHKEEL: final sukun |
| ya-018 | خَيْمَةْ | خَيْمَة | ADDED TASHKEEL: final sukun |
| ya-019 | عَيْنْ | عَيْن | ADDED TASHKEEL: final sukun |
| ya-020 | لَيْمُونْ | لَيْمُون | ADDED TASHKEEL: final sukun |
| ya-021 | صَيْفْ | صَيْف | ADDED TASHKEEL: final sukun |
| ya-022 | طَيْرْ | طَيْر | ADDED TASHKEEL: final sukun |
| ya-023 | سَيْفْ | سَيْف | ADDED TASHKEEL: final sukun |
| ya-024 | غَيْمَةْ | غَيْمَة | ADDED TASHKEEL: final sukun |
| ya-025 | قَيْصَرْ | قَيْصَر | ADDED TASHKEEL: final sukun |
| ya-026 | زَيْتْ | زَيْت | ADDED TASHKEEL: final sukun |
| ya-027 | خَيْرْ | خَيْر | ADDED TASHKEEL: final sukun |
| ya-028 | شَيْخْ | شَيْخ | ADDED TASHKEEL: final sukun |
| ya-029 | بَيْضْ | بَيْض | ADDED TASHKEEL: final sukun |
| ya-030 | لَيْلْ | لَيْل | ADDED TASHKEEL: final sukun |
| ya-031 | كُرْسِيّْ | كُرْسِيّ | ADDED TASHKEEL: final sukun |
| ya-032 | قَاضِي | — | — |
| ya-033 | رَاعِي | — | — |
| ya-034 | هَادِي | — | — |
| ya-035 | سَاعِي | — | — |
| ya-036 | نَادِي | — | — |
| ya-037 | وَادِي | — | — |
| ya-038 | مَاضِي | — | — |
| ya-039 | أَغَانِي | — | — |
| ya-040 | مَعَانِي | — | — |
| ya-041 | لَيَالِي | — | — |
| ya-042 | أَمَانِي | — | — |
| ya-043 | تَهَانِي | — | — |
| ya-044 | أَرَاضِي | — | — |
| ya-045 | مَبَانِي | — | — |

### hamza: هَمْزَةْ (206 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| hamza-001 | أَسَدْ | أَسَد | ADDED TASHKEEL: final sukun |
| hamza-002 | أَرْنَبْ | أَرْنَب | ADDED TASHKEEL: final sukun |
| hamza-003 | أُمّْ | أُمّ | ADDED TASHKEEL: final sukun |
| hamza-004 | أَخْطَبُوطْ | أَخْطَبُوط | ADDED TASHKEEL: final sukun |
| hamza-005 | أُذُنْ | أُذُن | ADDED TASHKEEL: final sukun |
| hamza-006 | أَرْضْ | أَرْض | ADDED TASHKEEL: final sukun |
| hamza-007 | أَمِيرْ | أَمِير | ADDED TASHKEEL: final sukun |
| hamza-008 | أَخْضَرْ | أَخْضَر | ADDED TASHKEEL: final sukun |
| hamza-009 | أَبْيَضْ | أَبْيَض | ADDED TASHKEEL: final sukun |
| hamza-010 | أَصْفَرْ | أَصْفَر | ADDED TASHKEEL: final sukun |
| hamza-011 | أَحْمَدْ | أَحْمَد | ADDED TASHKEEL: final sukun |
| hamza-012 | رَأْسْ | رَأْس | ADDED TASHKEEL: final sukun |
| hamza-013 | فَأْرْ | فَأْر | ADDED TASHKEEL: final sukun |
| hamza-014 | بِئْرْ | بِئْر | ADDED TASHKEEL: final sukun |
| hamza-015 | كَأْسْ | كَأْس | ADDED TASHKEEL: final sukun |
| hamza-016 | مَسْأَلَةْ | مَسْأَلَة | ADDED TASHKEEL: final sukun |
| hamza-017 | تَفَاؤُلْ | تَفَاؤُل | ADDED TASHKEEL: final sukun |
| hamza-018 | تَشَاؤُمْ | تَشَاؤُم | ADDED TASHKEEL: final sukun |
| hamza-019 | رُؤْيَةْ | رُؤْيَة | ADDED TASHKEEL: final sukun |
| hamza-020 | مَسْؤُولْ | مَسْؤُول | ADDED TASHKEEL: final sukun |
| hamza-021 | سُؤَالْ | سُؤَال | ADDED TASHKEEL: final sukun |
| hamza-022 | قِرَاءَةْ | قِرَاءَة | ADDED TASHKEEL: final sukun |
| hamza-023 | بَرَاءَةْ | بَرَاءَة | ADDED TASHKEEL: final sukun |
| hamza-024 | كِسَاءْ | كِسَاء | ADDED TASHKEEL: final sukun |
| hamza-025 | رِدَاءْ | رِدَاء | ADDED TASHKEEL: final sukun |
| hamza-026 | جَزَاءْ | جَزَاء | ADDED TASHKEEL: final sukun |
| hamza-027 | فَأْسْ | فَأْس | ADDED TASHKEEL: final sukun |
| hamza-028 | يَأْكُلْ | يَأْكُل | ADDED TASHKEEL: final sukun |
| hamza-029 | يَأْخُذْ | يَأْخُذ | ADDED TASHKEEL: final sukun |
| hamza-030 | مَأْذَنَةْ | مَأْذَنَة | ADDED TASHKEEL: final sukun |
| hamza-031 | شَأْنْ | شَأْن | ADDED TASHKEEL: final sukun |
| hamza-032 | بَأْسْ | بَأْس | ADDED TASHKEEL: final sukun |
| hamza-033 | رَأْيْ | رَأْي | ADDED TASHKEEL: final sukun |
| hamza-034 | تَأْثِيرْ | تَأْثِير | ADDED TASHKEEL: final sukun |
| hamza-035 | مَأْلُوفْ | مَأْلُوف | ADDED TASHKEEL: final sukun |
| hamza-036 | تَأْمِينْ | تَأْمِين | ADDED TASHKEEL: final sukun |
| hamza-037 | جُزْءْ | جُزْء | ADDED TASHKEEL: final sukun |
| hamza-038 | شَيْءْ | شَيْء | ADDED TASHKEEL: final sukun |
| hamza-039 | مَاءْ | مَاء | ADDED TASHKEEL: final sukun |
| hamza-040 | هَوَاءْ | هَوَاء | ADDED TASHKEEL: final sukun |
| hamza-041 | سَمَاءْ | سَمَاء | ADDED TASHKEEL: final sukun |
| hamza-042 | بَطِيءْ | بَطِيء | ADDED TASHKEEL: final sukun |
| hamza-043 | دَفِيءْ | دَفِيء | ADDED TASHKEEL: final sukun |
| hamza-044 | مَلِيءْ | مَلِيء | ADDED TASHKEEL: final sukun |
| hamza-045 | بَرِيءْ | بَرِيء | ADDED TASHKEEL: final sukun |
| hamza-046 | هَنِيءْ | هَنِيء | ADDED TASHKEEL: final sukun |
| hamza-047 | مُضِيءْ | مُضِيء | ADDED TASHKEEL: final sukun |
| hamza-048 | عِبْءْ | عِبْء | ADDED TASHKEEL: final sukun |
| hamza-049 | دِفْءْ | دِفْء | ADDED TASHKEEL: final sukun |
| hamza-050 | مَرْءْ | مَرْء | ADDED TASHKEEL: final sukun |
| hamza-051 | نَشْءْ | نَشْء | ADDED TASHKEEL: final sukun |
| hamza-052 | فِدَاءْ | فِدَاء | ADDED TASHKEEL: final sukun |
| hamza-053 | دُعَاءْ | دُعَاء | ADDED TASHKEEL: final sukun |
| hamza-054 | نِدَاءْ | نِدَاء | ADDED TASHKEEL: final sukun |
| hamza-055 | عَطَاءْ | عَطَاء | ADDED TASHKEEL: final sukun |
| hamza-056 | بِنَاءْ | بِنَاء | ADDED TASHKEEL: final sukun |
| hamza-057 | شِتَاءْ | شِتَاء | ADDED TASHKEEL: final sukun |
| hamza-058 | غِذَاءْ | غِذَاء | ADDED TASHKEEL: final sukun |
| hamza-059 | دَوَاءْ | دَوَاء | ADDED TASHKEEL: final sukun |
| hamza-060 | ثَنَاءْ | ثَنَاء | ADDED TASHKEEL: final sukun |
| hamza-061 | وَفَاءْ | وَفَاء | ADDED TASHKEEL: final sukun |
| hamza-062 | أَنَانَاسْ | أَنَانَاس | ADDED TASHKEEL: final sukun |
| hamza-063 | أَزْهَارْ | أَزْهَار | ADDED TASHKEEL: final sukun |
| hamza-064 | أَطْفَالْ | أَطْفَال | ADDED TASHKEEL: final sukun |
| hamza-065 | أَقْلَامْ | أَقْلَام | ADDED TASHKEEL: final sukun |
| hamza-066 | مَأْمُونْ | مَأْمُون | ADDED TASHKEEL: final sukun |
| hamza-067 | مَبْدَأْ | مَبْدَأ | ADDED TASHKEEL: final sukun |
| hamza-068 | مَلْجَأْ | مَلْجَأ | ADDED TASHKEEL: final sukun |
| hamza-069 | مُبْتَدَأْ | مُبْتَدَأ | ADDED TASHKEEL: final sukun |
| hamza-070 | خَطَأْ | خَطَأ | ADDED TASHKEEL: final sukun |
| hamza-071 | نَبَأْ | نَبَأ | ADDED TASHKEEL: final sukun |
| hamza-072 | وَبَأْ | وَبَأ | ADDED TASHKEEL: final sukun |
| hamza-073 | مَرْفَأْ | مَرْفَأ | ADDED TASHKEEL: final sukun |
| hamza-074 | مُنْشَأْ | مُنْشَأ | ADDED TASHKEEL: final sukun |
| hamza-075 | مَنْشَأْ | مَنْشَأ | ADDED TASHKEEL: final sukun |
| hamza-076 | مَلْتَجَأْ | مَلْتَجَأ | ADDED TASHKEEL: final sukun |
| hamza-077 | مُتَّكَأْ | مُتَّكَأ | ADDED TASHKEEL: final sukun |
| hamza-078 | مَبْرَأْ | مَبْرَأ | ADDED TASHKEEL: final sukun |
| hamza-079 | مُتَوَضَّأْ | مُتَوَضَّأ | ADDED TASHKEEL: final sukun |
| hamza-080 | مَنْبَأْ | مَنْبَأ | ADDED TASHKEEL: final sukun |
| hamza-081 | مُبَرَّأْ | مُبَرَّأ | ADDED TASHKEEL: final sukun |
| hamza-082 | إِيمَانْ | إِيمَان | ADDED TASHKEEL: final sukun |
| hamza-083 | إِبْرَةْ | إِبْرَة | ADDED TASHKEEL: final sukun |
| hamza-084 | إِنْسَانْ | إِنْسَان | ADDED TASHKEEL: final sukun |
| hamza-085 | إِسْلَامْ | إِسْلَام | ADDED TASHKEEL: final sukun |
| hamza-086 | إِبْرِيقْ | إِبْرِيق | ADDED TASHKEEL: final sukun |
| hamza-087 | إِمَامْ | إِمَام | ADDED TASHKEEL: final sukun |
| hamza-088 | إِنْجَازْ | إِنْجَاز | ADDED TASHKEEL: final sukun |
| hamza-089 | إِعْجَازْ | إِعْجَاز | ADDED TASHKEEL: final sukun |
| hamza-090 | إِخْلَاصْ | إِخْلَاص | ADDED TASHKEEL: final sukun |
| hamza-091 | إِنْقَاذْ | إِنْقَاذ | ADDED TASHKEEL: final sukun |
| hamza-092 | إِشَارَةْ | إِشَارَة | ADDED TASHKEEL: final sukun |
| hamza-093 | إِجَابَةْ | إِجَابَة | ADDED TASHKEEL: final sukun |
| hamza-094 | إِرَادَةْ | إِرَادَة | ADDED TASHKEEL: final sukun |
| hamza-095 | إِضَاءَةْ | إِضَاءَة | ADDED TASHKEEL: final sukun |
| hamza-096 | إِعْلَانْ | إِعْلَان | ADDED TASHKEEL: final sukun |
| hamza-097 | بِإِذْنْ | بِإِذْن | ADDED TASHKEEL: final sukun |
| hamza-098 | بِإِيمَانْ | بِإِيمَان | ADDED TASHKEEL: final sukun |
| hamza-099 | فِإِنّْ | فِإِنَّ | ADDED TASHKEEL: final vowel replaced by the pausal sukun; SUSPECT: wrong vowel: فَإِنَّ |
| hamza-100 | وَإِذَا | — | — |
| hamza-101 | بِإِحْسَانْ | بِإِحْسَان | ADDED TASHKEEL: final sukun |
| hamza-102 | بِإِخْلَاصْ | بِإِخْلَاص | ADDED TASHKEEL: final sukun |
| hamza-103 | بِإِسْلَامْ | بِإِسْلَام | ADDED TASHKEEL: final sukun |
| hamza-104 | وَإِنْسَانْ | وَإِنْسَان | ADDED TASHKEEL: final sukun |
| hamza-105 | فَإِنَّهْ | فَإِنَّهُ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| hamza-106 | بِإِرَادَةْ | بِإِرَادَة | ADDED TASHKEEL: final sukun |
| hamza-107 | وَإِشَارَةْ | وَإِشَارَة | ADDED TASHKEEL: final sukun |
| hamza-108 | بِإِجَابَةْ | بِإِجَابَة | ADDED TASHKEEL: final sukun |
| hamza-109 | فَإِذَا | — | — |
| hamza-110 | وَإِعْلَانْ | وَإِعْلَان | ADDED TASHKEEL: final sukun |
| hamza-111 | بِإِنْجَازْ | بِإِنْجَاز | ADDED TASHKEEL: final sukun |
| hamza-112 | إِحْسَانْ | إِحْسَان | ADDED TASHKEEL: final sukun |
| hamza-113 | إِتْقَانْ | إِتْقَان | ADDED TASHKEEL: final sukun |
| hamza-114 | إِبْدَاعْ | إِبْدَاع | ADDED TASHKEEL: final sukun |
| hamza-115 | إِصْلَاحْ | إِصْلَاح | ADDED TASHKEEL: final sukun |
| hamza-116 | رُؤُوسْ | رُؤُوس | ADDED TASHKEEL: final sukun |
| hamza-117 | فُؤَادْ | فُؤَاد | ADDED TASHKEEL: final sukun |
| hamza-118 | بُؤْسْ | بُؤْس | ADDED TASHKEEL: final sukun |
| hamza-119 | لُؤْلُؤْ | لُؤْلُؤ | ADDED TASHKEEL: final sukun |
| hamza-120 | شُؤُونْ | شُؤُون | ADDED TASHKEEL: final sukun |
| hamza-121 | كُؤُوسْ | كُؤُوس | ADDED TASHKEEL: final sukun |
| hamza-122 | رُؤَسَاءْ | رُؤَسَاء | ADDED TASHKEEL: final sukun |
| hamza-123 | مُؤَسَّسَةْ | مُؤَسَّسَة | ADDED TASHKEEL: final sukun |
| hamza-124 | مُؤَلَّفْ | مُؤَلَّف | ADDED TASHKEEL: final sukun |
| hamza-125 | مُؤْتَمَرْ | مُؤْتَمَر | ADDED TASHKEEL: final sukun |
| hamza-126 | مُؤْمِنْ | مُؤْمِن | ADDED TASHKEEL: final sukun |
| hamza-127 | مُؤَدَّبْ | مُؤَدَّب | ADDED TASHKEEL: final sukun |
| hamza-128 | مُؤَلِّفْ | مُؤَلِّف | ADDED TASHKEEL: final sukun |
| hamza-129 | مُؤَثِّرْ | مُؤَثِّر | ADDED TASHKEEL: final sukun |
| hamza-130 | مُؤَيَّدْ | مُؤَيَّد | ADDED TASHKEEL: final sukun |
| hamza-131 | مُؤَهَّلْ | مُؤَهَّل | ADDED TASHKEEL: final sukun |
| hamza-132 | مُؤَقَّتْ | مُؤَقَّت | ADDED TASHKEEL: final sukun |
| hamza-133 | مُؤَنَّثْ | مُؤَنَّث | ADDED TASHKEEL: final sukun |
| hamza-134 | مُؤَخَّرْ | مُؤَخَّر | ADDED TASHKEEL: final sukun |
| hamza-135 | مُؤَرِّخْ | مُؤَرِّخ | ADDED TASHKEEL: final sukun |
| hamza-136 | تَكَافُؤْ | تَكَافُؤ | ADDED TASHKEEL: final sukun |
| hamza-137 | تَوَاطُؤْ | تَوَاطُؤ | ADDED TASHKEEL: final sukun |
| hamza-138 | تَبَاطُؤْ | تَبَاطُؤ | ADDED TASHKEEL: final sukun |
| hamza-139 | تَلَكُّؤْ | تَلَكُّؤ | ADDED TASHKEEL: final sukun |
| hamza-140 | تَهَيُّؤْ | تَهَيُّؤ | ADDED TASHKEEL: final sukun |
| hamza-141 | تَجَرُّؤْ | تَجَرُّؤ | ADDED TASHKEEL: final sukun |
| hamza-142 | تَوَضُّؤْ | تَوَضُّؤ | ADDED TASHKEEL: final sukun |
| hamza-143 | تَنَبُّؤْ | تَنَبُّؤ | ADDED TASHKEEL: final sukun |
| hamza-144 | امْرُؤْ | امْرُؤ | ADDED TASHKEEL: final sukun |
| hamza-145 | تَبَوُّؤْ | تَبَوُّؤ | ADDED TASHKEEL: final sukun |
| hamza-146 | تَجَزُّؤْ | تَجَزُّؤ | ADDED TASHKEEL: final sukun |
| hamza-147 | سُوءْ | سُوء | ADDED TASHKEEL: final sukun |
| hamza-148 | ضَوْءْ | ضَوْء | ADDED TASHKEEL: final sukun |
| hamza-149 | مِلْءْ | مِلْء | ADDED TASHKEEL: final sukun |
| hamza-150 | نُشُوءْ | نُشُوء | ADDED TASHKEEL: final sukun |
| hamza-151 | هُدُوءْ | هُدُوء | ADDED TASHKEEL: final sukun |
| hamza-152 | لُجُوءْ | لُجُوء | ADDED TASHKEEL: final sukun |
| hamza-153 | بُرُوءْ | بُرُوء | ADDED TASHKEEL: final sukun; SUSPECT: not a standard word |
| hamza-154 | وُضُوءْ | وُضُوء | ADDED TASHKEEL: final sukun |
| hamza-155 | قُرُوءْ | قُرُوء | ADDED TASHKEEL: final sukun |
| hamza-156 | نُبُوءْ | نُبُوء | ADDED TASHKEEL: final sukun; SUSPECT: not a standard word |
| hamza-157 | دُرُوءْ | دُرُوء | ADDED TASHKEEL: final sukun; SUSPECT: not a standard word |
| hamza-158 | ظُهُوءْ | ظُهُوء | ADDED TASHKEEL: final sukun; SUSPECT: not a standard word |
| hamza-159 | رَئِيسْ | رَئِيس | ADDED TASHKEEL: final sukun |
| hamza-160 | ذِئْبْ | ذِئْب | ADDED TASHKEEL: final sukun |
| hamza-161 | فِئَةْ | فِئَة | ADDED TASHKEEL: final sukun |
| hamza-162 | مِئَةْ | مِئَة | ADDED TASHKEEL: final sukun |
| hamza-163 | بِيئَةْ | بِيئَة | ADDED TASHKEEL: final sukun |
| hamza-164 | هَيْئَةْ | هَيْئَة | ADDED TASHKEEL: final sukun |
| hamza-165 | رِئَةْ | رِئَة | ADDED TASHKEEL: final sukun |
| hamza-166 | سَيِّئَةْ | سَيِّئَة | ADDED TASHKEEL: final sukun |
| hamza-167 | خَطِيئَةْ | خَطِيئَة | ADDED TASHKEEL: final sukun |
| hamza-168 | بَرِيئَةْ | بَرِيئَة | ADDED TASHKEEL: final sukun |
| hamza-169 | رَدِيئَةْ | رَدِيئَة | ADDED TASHKEEL: final sukun |
| hamza-170 | مُفَاجِئَةْ | مُفَاجِئَة | ADDED TASHKEEL: final sukun |
| hamza-171 | قَائِمْ | قَائِم | ADDED TASHKEEL: final sukun |
| hamza-172 | صَائِمْ | صَائِم | ADDED TASHKEEL: final sukun |
| hamza-173 | نَائِمْ | نَائِم | ADDED TASHKEEL: final sukun |
| hamza-174 | دَائِمْ | دَائِم | ADDED TASHKEEL: final sukun |
| hamza-175 | عَائِدْ | عَائِد | ADDED TASHKEEL: final sukun |
| hamza-176 | فَائِزْ | فَائِز | ADDED TASHKEEL: final sukun |
| hamza-177 | جَائِزَةْ | جَائِزَة | ADDED TASHKEEL: final sukun |
| hamza-178 | حَائِطْ | حَائِط | ADDED TASHKEEL: final sukun |
| hamza-179 | طَائِرْ | طَائِر | ADDED TASHKEEL: final sukun |
| hamza-180 | زَائِرْ | زَائِر | ADDED TASHKEEL: final sukun |
| hamza-181 | سَائِلْ | سَائِل | ADDED TASHKEEL: final sukun |
| hamza-182 | وَسَائِلْ | وَسَائِل | ADDED TASHKEEL: final sukun |
| hamza-183 | مُبْتَدِئْ | مُبْتَدِئ | ADDED TASHKEEL: final sukun |
| hamza-184 | قَارِئْ | قَارِئ | ADDED TASHKEEL: final sukun |
| hamza-185 | لَاجِئْ | لَاجِئ | ADDED TASHKEEL: final sukun |
| hamza-186 | نَاشِئْ | نَاشِئ | ADDED TASHKEEL: final sukun |
| hamza-187 | بَادِئْ | بَادِئ | ADDED TASHKEEL: final sukun |
| hamza-188 | طَارِئْ | طَارِئ | ADDED TASHKEEL: final sukun |
| hamza-189 | هَادِئْ | هَادِئ | ADDED TASHKEEL: final sukun |
| hamza-190 | دَافِئْ | دَافِئ | ADDED TASHKEEL: final sukun |
| hamza-191 | خَاطِئْ | خَاطِئ | ADDED TASHKEEL: final sukun |
| hamza-192 | مُخْطِئْ | مُخْطِئ | ADDED TASHKEEL: final sukun |
| hamza-193 | شَاطِئْ | شَاطِئ | ADDED TASHKEEL: final sukun |
| hamza-194 | بَارِئْ | بَارِئ | ADDED TASHKEEL: final sukun |
| hamza-195 | مُنْشِئْ | مُنْشِئ | ADDED TASHKEEL: final sukun |
| hamza-196 | مُبْطِئْ | مُبْطِئ | ADDED TASHKEEL: final sukun |
| hamza-197 | مُقْرِئْ | مُقْرِئ | ADDED TASHKEEL: final sukun |
| hamza-198 | مُتَّكِئْ | مُتَّكِئ | ADDED TASHKEEL: final sukun |
| hamza-199 | مُتَوَضِّئْ | مُتَوَضِّئ | ADDED TASHKEEL: final sukun |
| hamza-200 | مُتَهَيِّئْ | مُتَهَيِّئ | ADDED TASHKEEL: final sukun |
| hamza-201 | مُتَلَكِّئْ | مُتَلَكِّئ | ADDED TASHKEEL: final sukun |
| hamza-202 | مُتَبَاطِئْ | مُتَبَاطِئ | ADDED TASHKEEL: final sukun |
| hamza-203 | مُتَكَافِئْ | مُتَكَافِئ | ADDED TASHKEEL: final sukun |
| hamza-204 | مُتَجَرِّئْ | مُتَجَرِّئ | ADDED TASHKEEL: final sukun |
| hamza-205 | مُتَنَبِّئْ | مُتَنَبِّئ | ADDED TASHKEEL: final sukun |
| hamza-206 | مُتَوَاطِئْ | مُتَوَاطِئ | ADDED TASHKEEL: final sukun |

### alif_maqsura: أَلِفٌ مَقْصُورَةْ (45 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| alif_maqsura-001 | فَتَى | — | — |
| alif_maqsura-002 | هُدَى | — | — |
| alif_maqsura-003 | مُوسَى | — | — |
| alif_maqsura-004 | عِيسَى | — | — |
| alif_maqsura-005 | يَحْيَى | — | — |
| alif_maqsura-006 | كُبْرَى | — | — |
| alif_maqsura-007 | صُغْرَى | — | — |
| alif_maqsura-008 | أُولَى | — | — |
| alif_maqsura-009 | حُسْنَى | — | — |
| alif_maqsura-010 | فُضْلَى | — | — |
| alif_maqsura-011 | وُسْطَى | — | — |
| alif_maqsura-012 | لَيْلَى | — | — |
| alif_maqsura-013 | سَلْمَى | — | — |
| alif_maqsura-014 | مَرْضَى | — | — |
| alif_maqsura-015 | جَرْحَى | — | — |
| alif_maqsura-016 | قَتْلَى | — | — |
| alif_maqsura-017 | أَسْرَى | — | — |
| alif_maqsura-018 | صَرْعَى | — | — |
| alif_maqsura-019 | سَكْرَى | — | — |
| alif_maqsura-020 | حَيْرَى | — | — |
| alif_maqsura-021 | غَضْبَى | — | — |
| alif_maqsura-022 | عَطْشَى | — | — |
| alif_maqsura-023 | نَشْوَى | — | — |
| alif_maqsura-024 | رَضْوَى | — | — |
| alif_maqsura-025 | زُلْفَى | — | — |
| alif_maqsura-026 | سَلْوَى | — | — |
| alif_maqsura-027 | نَجْوَى | — | — |
| alif_maqsura-028 | بُشْرَى | — | — |
| alif_maqsura-029 | ذِكْرَى | — | — |
| alif_maqsura-030 | شُورَى | — | — |
| alif_maqsura-031 | فَتْوَى | — | — |
| alif_maqsura-032 | دَعْوَى | — | — |
| alif_maqsura-033 | تَقْوَى | — | — |
| alif_maqsura-034 | مَأْوَى | — | — |
| alif_maqsura-035 | مُسْتَشْفَى | — | — |
| alif_maqsura-036 | مُصْطَفَى | — | — |
| alif_maqsura-037 | مُرْتَضَى | — | — |
| alif_maqsura-038 | مُنْتَهَى | — | — |
| alif_maqsura-039 | مُلْتَقَى | — | — |
| alif_maqsura-040 | مُسْتَوَى | — | — |
| alif_maqsura-041 | مَعْنَى | — | — |
| alif_maqsura-042 | مَبْنَى | — | — |
| alif_maqsura-043 | مَغْزَى | — | — |
| alif_maqsura-044 | مَسْعَى | — | — |
| alif_maqsura-045 | مَرْعَى | — | — |

### lam_alif: لَامُ أَلِفْ (45 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| lam_alif-001 | لَا | — | — |
| lam_alif-002 | لَاعِبْ | لَاعِب | ADDED TASHKEEL: final sukun |
| lam_alif-003 | لَابُدّْ | لَابُدّ | ADDED TASHKEEL: final sukun; SUSPECT: two words (لَا بُدَّ), not one |
| lam_alif-004 | لَاحِقْ | لَاحِق | ADDED TASHKEEL: final sukun |
| lam_alif-005 | لَازِمْ | لَازِم | ADDED TASHKEEL: final sukun |
| lam_alif-006 | لَائِقْ | لَائِق | ADDED TASHKEEL: final sukun |
| lam_alif-007 | لَامِعْ | لَامِع | ADDED TASHKEEL: final sukun |
| lam_alif-008 | لَاهِبْ | لَاهِب | ADDED TASHKEEL: final sukun |
| lam_alif-009 | لَاذِعْ | لَاذِع | ADDED TASHKEEL: final sukun |
| lam_alif-010 | لَابِسْ | لَابِس | ADDED TASHKEEL: final sukun |
| lam_alif-011 | لَاجِئْ | لَاجِئ | ADDED TASHKEEL: final sukun |
| lam_alif-012 | لَافِتْ | لَافِت | ADDED TASHKEEL: final sukun |
| lam_alif-013 | لَاصِقْ | لَاصِق | ADDED TASHKEEL: final sukun |
| lam_alif-014 | لَاهُوتْ | لَاهُوت | ADDED TASHKEEL: final sukun |
| lam_alif-015 | لَابَّةْ | لَابَّة | ADDED TASHKEEL: final sukun |
| lam_alif-016 | بِلَادْ | بِلَاد | ADDED TASHKEEL: final sukun |
| lam_alif-017 | أَوْلَادْ | أَوْلَاد | ADDED TASHKEEL: final sukun |
| lam_alif-018 | سِلَاحْ | سِلَاح | ADDED TASHKEEL: final sukun |
| lam_alif-019 | بَلَاطْ | بَلَاط | ADDED TASHKEEL: final sukun |
| lam_alif-020 | خِلَافْ | خِلَاف | ADDED TASHKEEL: final sukun |
| lam_alif-021 | جِلَادْ | جِلَاد | ADDED TASHKEEL: final sukun |
| lam_alif-022 | مِيلَادْ | مِيلَاد | ADDED TASHKEEL: final sukun |
| lam_alif-023 | فِلَاحَةْ | فِلَاحَة | ADDED TASHKEEL: final sukun |
| lam_alif-024 | عِلَاجْ | عِلَاج | ADDED TASHKEEL: final sukun |
| lam_alif-025 | إِسْلَامْ | إِسْلَام | ADDED TASHKEEL: final sukun |
| lam_alif-026 | أَعْلَامْ | أَعْلَام | ADDED TASHKEEL: final sukun |
| lam_alif-027 | إِعْلَانْ | إِعْلَان | ADDED TASHKEEL: final sukun |
| lam_alif-028 | سُلَالَةْ | سُلَالَة | ADDED TASHKEEL: final sukun |
| lam_alif-029 | دَلَالَةْ | دَلَالَة | ADDED TASHKEEL: final sukun |
| lam_alif-030 | حَلَالْ | حَلَال | ADDED TASHKEEL: final sukun |
| lam_alif-031 | حَلَّا | — | — |
| lam_alif-032 | عَلَّا | — | — |
| lam_alif-033 | تَلَا | — | — |
| lam_alif-034 | خَلَا | — | — |
| lam_alif-035 | مَلَا | — | — |
| lam_alif-036 | حُلَا | — | — |
| lam_alif-037 | عُلَا | — | — |
| lam_alif-038 | غَلَا | — | — |
| lam_alif-039 | جَلَا | — | — |
| lam_alif-040 | صَلَّا | — | — |
| lam_alif-041 | بَلَّا | — | — |
| lam_alif-042 | دَلَّا | — | — |
| lam_alif-043 | طَلَّا | — | — |
| lam_alif-044 | وَلَّا | — | — |
| lam_alif-045 | سَلَّا | — | — |

