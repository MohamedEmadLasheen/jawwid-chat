# PD-29 P0-5: Arabic lesson 2 (letters that look or sound alike), lines held for teacher review

This file is generated from `apps/lessons/src/arabic/lesson-002.json` and the rebuild's report. Do not edit it by hand.

- The lesson was rewritten as data from the old lesson (jawwid-lessons @ c231532, `arabic/lesson-2/data/lettersData.ts`). The old lesson was read as text only, from a quarantined copy, and never built or run.
- **Structure:**
  - There is one group per pair of letters: 12 pairs that look alike and 7 that sound alike.
  - Each group has one unit per letter.
  - A word belongs to a unit only if it contains that letter (the one rule of lesson 1).
  - The quiz's wrong options come from the pair's OTHER letter.
- The file is **pending**: the lesson page shows nothing of it until the Teachers department approves it.
- A held line is never shown. A spelling held anywhere is held everywhere, and so is any quiz question that shows it.

## Summary

| | |
|---|---|
| Pairs (groups) | 19 |
| Units | 38 |
| Words | 515 |
| Held | 513 |
| Clean (unchanged from the old lesson) | 2 |
| Dropped, for a teacher | 1 |
| Old duplicates removed | 0 |
| Quiz questions | 76 |

**Why words are held:**

- 499: ADDED TASHKEEL: final sukun
- 3: NEEDS TASHKEEL: shadda (proposed كُرْسِيّْ)
- 3: NEEDS TASHKEEL: shadda (proposed ذَكِيّْ)
- 2: NEEDS TASHKEEL: shadda (proposed جُنْدِيّْ)
- 2: NEEDS TASHKEEL: shadda (proposed عَرَبِيّْ)
- 2: ADDED TASHKEEL: final vowel replaced by the pausal sukun
- 1: NEEDS TASHKEEL: shadda (proposed قَوِيّْ)
- 1: NEEDS TASHKEEL: shadda (proposed غَنِيّْ)

Almost every hold is the one final mark, the pausal sukun, as in lesson 1. Teachers check each word, not the convention. Clearing a word means setting its `review` and `was` to null, in a reviewed commit.

## Decisions for the teachers

**One bulk decision first: ta marbuta with the pausal sukun (ـةْ).** This is the same question as in lesson 1. 107 words here end this way, so lesson 1's answer clears or changes them too.

1. **The words below.** Every word must be a real word, suitable for a child, spelled correctly and fully vowelled.
2. **Each pair's difference or tip** (next section).
   - The old lesson wrote them without tashkeel, and a lesson note must be fully vowelled. The rebuild adds no marks inside words, so the notes are empty for now.
   - Please supply each text fully vowelled, or rewrite it. It becomes the note of both units of the pair.
3. **Words with BOTH letters of their pair** (27, next section). They are kept, held with a reason, and never used in that pair's quiz. Decide for each one whether it stays.
4. **Nisba words missing their final shadda** (12). They are held with the proposed spelling. Confirm or correct it.
5. **The unit names are new here.** They take lesson 1's letter names (بَاءْ, نُونْ …) and need review in this lesson too.
6. **129 spellings appear in more than one unit.** This is expected: a word can hold letters from several pairs, and 5 sit in both units of one pair. A spelling cleared in one place is cleared everywhere.
7. **The quiz**: up to two questions per unit. It never uses a held both-letters or needs-tashkeel word.

## Words with both letters of their pair (held)

| Unit | Word |
|---|---|
| ba_vs_nun | بِنْتْ |
| ba_vs_nun | بُسْتَانْ |
| ba_vs_nun | أَرْنَبْ |
| nun_vs_ba | نَبَاتْ |
| nun_vs_ba | بَنَاتْ |
| nun_vs_ba | بُسْتَانْ |
| ta_vs_ya | تِينْ |
| ta_vs_ya | تِلْمِيذْ |
| ta_vs_ya | بَيْتْ |
| ta_vs_ya | زَيْتْ |
| ta_vs_ya | تَنِّينْ |
| ya_vs_ta | بَيْتْ |
| ya_vs_ta | زَيْتْ |
| kha_vs_jim | خَلِيجْ |
| sin_vs_shin | شَمْسْ |
| shin_vs_sin | شَمْسْ |
| qaf_vs_fa | قَفَصْ |
| lam_vs_kaf | مَلِكْ |
| kaf_vs_lam | كَلْبْ |
| kaf_vs_lam | مَلِكْ |
| zay_vs_ra | زَرَافَةْ |
| zay_vs_ra | زَهْرَةْ |
| zay_vs_ra | زِرّْ |
| zay_vs_ra | أَرُزْ |
| zay_vs_ra | زُرَافَةْ |
| zay_vs_ra | رُمُوزْ |
| dad_vs_dal | ضِفْدَعْ |

## Nisba words missing their final shadda (held)

| Unit | Word | Proposed |
|---|---|---|
| nun_vs_ba | جُنْدِي | جُنْدِيّْ |
| ya_vs_ta | كُرْسِي | كُرْسِيّْ |
| ya_vs_ta | عَرَبِي | عَرَبِيّْ |
| ya_vs_ta | قَوِي | قَوِيّْ |
| jim_vs_kha | جُنْدِي | جُنْدِيّْ |
| ain_vs_ghain | عَرَبِي | عَرَبِيّْ |
| ghain_vs_ain | غَنِي | غَنِيّْ |
| kaf_vs_lam | كُرْسِي | كُرْسِيّْ |
| dhal_vs_dal | ذَكِي | ذَكِيّْ |
| kaf_vs_qaf | كُرْسِي | كُرْسِيّْ |
| dhal_vs_zay | ذَكِي | ذَكِيّْ |
| dhal_vs_zza | ذَكِي | ذَكِيّْ |

## Each pair's difference or tip (to be vowelled by a teacher)

| Pair | Kind | Old text (unvowelled) |
|---|---|---|
| ب ن | looks alike | الباء نقطة تحت، النون نقطة فوق |
| ت ي | looks alike | التاء نقطتان فوق، الياء نقطتان تحت |
| ث ش | looks alike | الثاء ثلاث نقاط فوق مسطحة، الشين ثلاث نقاط فوق مع أسنان |
| ج خ | looks alike | الجيم نقطة تحت، الخاء نقطة فوق |
| س ش | looks alike | السين بدون نقاط، الشين ثلاث نقاط فوق |
| ص ض | looks alike | الصاد بدون نقطة، الضاد نقطة فوق |
| ط ظ | looks alike | الطاء بدون نقطة، الظاء نقطة فوق |
| ع غ | looks alike | العين بدون نقطة، الغين نقطة فوق |
| ف ق | looks alike | الفاء نقطة فوق، القاف نقطتان فوق |
| ل ك | looks alike | اللام عمودية طويلة، الكاف لها همزة صغيرة |
| ر ز | looks alike | الراء بدون نقطة، الزاي نقطة فوق |
| د ذ | looks alike | الدال بدون نقطة، الذال نقطة فوق |
| ق ك | sounds alike | القاف من أقصى الحلق، الكاف من وسط الفم |
| ز ذ | sounds alike | الزاي من طرف اللسان والأسنان، الذال من طرف اللسان بين الأسنان |
| س ث | sounds alike | السين من طرف اللسان والأسنان، الثاء من طرف اللسان بين الأسنان |
| ظ ذ | sounds alike | الظاء مفخمة وثقيلة، الذال مرققة وخفيفة |
| ه ح | sounds alike | الهاء من أقصى الحلق، الحاء من وسط الحلق |
| ض د | sounds alike | الضاد مفخمة من حافة اللسان، الدال مرققة من طرف اللسان |
| غ خ | sounds alike | الغين مجهورة من أدنى الحلق، الخاء مهموسة من أدنى الحلق |

## Dropped (not in the file; a teacher adds them back if wanted)

| Old unit | Word | Why |
|---|---|---|
| sin_vs_shin | حِصَان | does not contain س |

## The quiz, per unit

| Unit | Id | Kind | Question shows | Options | Right answer |
|---|---|---|---|---|---|
| ba_vs_nun | ba_vs_nun-q1 | which word has the letter | — | نَارْ، نَمْلَةْ، بَابْ | بَابْ |
| ba_vs_nun | ba_vs_nun-q2 | where is the letter | بِحَارْ | start / middle / end | start |
| nun_vs_ba | nun_vs_ba-q1 | which word has the letter | — | بَقَرَةْ، نَارْ، سَبُورَةْ | نَارْ |
| nun_vs_ba | nun_vs_ba-q2 | where is the letter | نَحْلَةْ | start / middle / end | start |
| ta_vs_ya | ta_vs_ya-q1 | which word has the letter | — | عَيْنْ، تُفَّاحْ، يَدْ | تُفَّاحْ |
| ta_vs_ya | ta_vs_ya-q2 | where is the letter | تَمْرْ | start / middle / end | start |
| ya_vs_ta | ya_vs_ta-q1 | which word has the letter | — | هَادِي، فَتَاةْ، تَمْرْ | هَادِي |
| ya_vs_ta | ya_vs_ta-q2 | where is the letter | رَاعِي | start / middle / end | end |
| tha_vs_shin | tha_vs_shin-q1 | which word has the letter | — | شِتَاءْ، ثَعْلَبْ، شُبَّاكْ | ثَعْلَبْ |
| tha_vs_shin | tha_vs_shin-q2 | where is the letter | ثَلْجْ | start / middle / end | start |
| shin_vs_tha | shin_vs_tha-q1 | which word has the letter | — | ثَلْجْ، ثَرْوَةْ، شَمْسْ | شَمْسْ |
| shin_vs_tha | shin_vs_tha-q2 | where is the letter | شَجَرَةْ | start / middle / end | start |
| jim_vs_kha | jim_vs_kha-q1 | which word has the letter | — | جَمَلْ، خَاتَمْ، مَطْبَخْ | جَمَلْ |
| jim_vs_kha | jim_vs_kha-q2 | where is the letter | جَبَلْ | start / middle / end | start |
| kha_vs_jim | kha_vs_jim-q1 | which word has the letter | — | حَجَرْ، خَرُوفْ، جَرَسْ | خَرُوفْ |
| kha_vs_jim | kha_vs_jim-q2 | where is the letter | خُبْزْ | start / middle / end | start |
| sin_vs_shin | sin_vs_shin-q1 | which word has the letter | — | شَاطِئْ، عُشْبْ، سَمَكْ | سَمَكْ |
| sin_vs_shin | sin_vs_shin-q2 | where is the letter | سَيَّارَةْ | start / middle / end | start |
| shin_vs_sin | shin_vs_sin-q1 | which word has the letter | — | سَمَكْ، فَانُوسْ، شَجَرَةْ | شَجَرَةْ |
| shin_vs_sin | shin_vs_sin-q2 | where is the letter | شُرْطَةْ | start / middle / end | start |
| sad_vs_dad | sad_vs_dad-q1 | which word has the letter | — | ضَحِكْ، رَوْضَةْ، صَقْرْ | صَقْرْ |
| sad_vs_dad | sad_vs_dad-q2 | where is the letter | صُنْدُوقْ | start / middle / end | start |
| dad_vs_sad | dad_vs_sad-q1 | which word has the letter | — | صَابُونْ، ضِفْدَعْ، نَصْرْ | ضِفْدَعْ |
| dad_vs_sad | dad_vs_sad-q2 | where is the letter | ضَوْءْ | start / middle / end | start |
| tta_vs_zza | tta_vs_zza-q1 | which word has the letter | — | ظَهْرْ، حَفِيظْ، طَائِرْ | طَائِرْ |
| tta_vs_zza | tta_vs_zza-q2 | where is the letter | طَبِيبْ | start / middle / end | start |
| zza_vs_tta | zza_vs_tta-q1 | which word has the letter | — | مَطَرْ، ظَرْفْ، طَرِيقْ | ظَرْفْ |
| zza_vs_tta | zza_vs_tta-q2 | where is the letter | ظِلّْ | start / middle / end | start |
| ain_vs_ghain | ain_vs_ghain-q1 | which word has the letter | — | مَغْرِبْ، غَنَمْ، عَيْنْ | عَيْنْ |
| ain_vs_ghain | ain_vs_ghain-q2 | where is the letter | عُصْفُورْ | start / middle / end | start |
| ghain_vs_ain | ghain_vs_ain-q1 | which word has the letter | — | غَزَالْ، شَمْعْ، عَلَمْ | غَزَالْ |
| ghain_vs_ain | ghain_vs_ain-q2 | where is the letter | غَابَةْ | start / middle / end | start |
| fa_vs_qaf | fa_vs_qaf-q1 | which word has the letter | — | فِيلْ، قَمَرْ، قُرْآنْ | فِيلْ |
| fa_vs_qaf | fa_vs_qaf-q2 | where is the letter | فَرَاشَةْ | start / middle / end | start |
| qaf_vs_fa | qaf_vs_fa-q1 | which word has the letter | — | قَمَرْ، فُرْنْ، مَفْتَاحْ | قَمَرْ |
| qaf_vs_fa | qaf_vs_fa-q2 | where is the letter | قِطَّةْ | start / middle / end | start |
| lam_vs_kaf | lam_vs_kaf-q1 | which word has the letter | — | بَنْكْ، لَيْمُونْ، كِتَابْ | لَيْمُونْ |
| lam_vs_kaf | lam_vs_kaf-q2 | where is the letter | لَعِبَةْ | start / middle / end | start |
| kaf_vs_lam | kaf_vs_lam-q1 | which word has the letter | — | عَلَمْ، كِتَابْ، جَبَلْ | كِتَابْ |
| kaf_vs_lam | kaf_vs_lam-q2 | where is the letter | كُرَةْ | start / middle / end | start |
| ra_vs_zay | ra_vs_zay-q1 | which word has the letter | — | رَجُلْ، كَنْزْ، مَنْزِلْ | رَجُلْ |
| ra_vs_zay | ra_vs_zay-q2 | where is the letter | رُمَّانْ | start / middle / end | start |
| zay_vs_ra | zay_vs_ra-q1 | which word has the letter | — | رِيشَةْ، زَيْتُونْ، بُرْتُقَالْ | زَيْتُونْ |
| zay_vs_ra | zay_vs_ra-q2 | where is the letter | زُجَاجْ | start / middle / end | start |
| dal_vs_dhal | dal_vs_dhal-q1 | which word has the letter | — | دُبّْ، مَلَاذْ، ذِرَاعْ | دُبّْ |
| dal_vs_dhal | dal_vs_dhal-q2 | where is the letter | دَجَاجَةْ | start / middle / end | start |
| dhal_vs_dal | dhal_vs_dal-q1 | which word has the letter | — | ذِئْبْ، دِينَارْ، بَلَدْ | ذِئْبْ |
| dhal_vs_dal | dhal_vs_dal-q2 | where is the letter | ذَهَبْ | start / middle / end | start |
| qaf_vs_kaf | qaf_vs_kaf-q1 | which word has the letter | — | قَمَرْ، كَبِيرْ، كَلْبْ | قَمَرْ |
| qaf_vs_kaf | qaf_vs_kaf-q2 | where is the letter | قَلَمْ | start / middle / end | start |
| kaf_vs_qaf | kaf_vs_qaf-q1 | which word has the letter | — | قَلَمْ، قَمَرْ، كَلْبْ | كَلْبْ |
| kaf_vs_qaf | kaf_vs_qaf-q2 | where is the letter | كِتَابْ | start / middle / end | start |
| zay_vs_dhal | zay_vs_dhal-q1 | which word has the letter | — | ذَيْلْ، زَهْرَةْ، ذَهَبْ | زَهْرَةْ |
| zay_vs_dhal | zay_vs_dhal-q2 | where is the letter | زَرَافَةْ | start / middle / end | start |
| dhal_vs_zay | dhal_vs_zay-q1 | which word has the letter | — | ذِئْبْ، زَرَافَةْ، زَيْتُونْ | ذِئْبْ |
| dhal_vs_zay | dhal_vs_zay-q2 | where is the letter | ذَهَبْ | start / middle / end | start |
| sin_vs_tha | sin_vs_tha-q1 | which word has the letter | — | ثُعْبَانْ، ثَمَرَةْ، سَمَكْ | سَمَكْ |
| sin_vs_tha | sin_vs_tha-q2 | where is the letter | سَيَّارَةْ | start / middle / end | start |
| tha_vs_sin | tha_vs_sin-q1 | which word has the letter | — | ثَعْلَبْ، سُوقْ، سَفِينَةْ | ثَعْلَبْ |
| tha_vs_sin | tha_vs_sin-q2 | where is the letter | ثَلْجْ | start / middle / end | start |
| zza_vs_dhal | zza_vs_dhal-q1 | which word has the letter | — | ذَهَبْ، ظَرْفْ، ذِرَاعْ | ظَرْفْ |
| zza_vs_dhal | zza_vs_dhal-q2 | where is the letter | ظِلّْ | start / middle / end | start |
| dhal_vs_zza | dhal_vs_zza-q1 | which word has the letter | — | ظُفْرْ، ذِئْبْ، ظَهْرْ | ذِئْبْ |
| dhal_vs_zza | dhal_vs_zza-q2 | where is the letter | ذَهَبْ | start / middle / end | start |
| ha_vs_hha | ha_vs_hha-q1 | which word has the letter | — | حَقِيبَةْ، هِلَالْ، حُوتْ | هِلَالْ |
| ha_vs_hha | ha_vs_hha-q2 | where is the letter | هَدِيَّةْ | start / middle / end | start |
| hha_vs_ha | hha_vs_ha-q1 | which word has the letter | — | حُوتْ، هَدِيَّةْ، هَاتِفْ | حُوتْ |
| hha_vs_ha | hha_vs_ha-q2 | where is the letter | حِصَانْ | start / middle / end | start |
| dad_vs_dal | dad_vs_dal-q1 | which word has the letter | — | دَلْوْ، ضَوْءْ، دَوَاءْ | ضَوْءْ |
| dad_vs_dal | dad_vs_dal-q2 | where is the letter | ضَيْفْ | start / middle / end | start |
| dal_vs_dad | dal_vs_dad-q1 | which word has the letter | — | دُبّْ، ضَابِطْ، ضَيْفْ | دُبّْ |
| dal_vs_dad | dal_vs_dad-q2 | where is the letter | دَجَاجَةْ | start / middle / end | start |
| ghain_vs_kha | ghain_vs_kha-q1 | which word has the letter | — | خَشَبْ، خَاتَمْ، غَزَالْ | غَزَالْ |
| ghain_vs_kha | ghain_vs_kha-q2 | where is the letter | غَابَةْ | start / middle / end | start |
| kha_vs_ghain | kha_vs_ghain-q1 | which word has the letter | — | غَنَمْ، خَرُوفْ، غَزَالْ | خَرُوفْ |
| kha_vs_ghain | kha_vs_ghain-q2 | where is the letter | خُبْزْ | start / middle / end | start |

## Every word, per unit

`was` is the old spelling where the rebuild changed it. A held word shows why it is held.

### ba_vs_nun (ب ن): بَاءْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ba_vs_nun-001 | بَابْ | بَاب | ADDED TASHKEEL: final sukun |
| ba_vs_nun-002 | بَطَّةْ | بَطَّة | ADDED TASHKEEL: final sukun |
| ba_vs_nun-003 | بِحَارْ | بِحَار | ADDED TASHKEEL: final sukun |
| ba_vs_nun-004 | بَيْتْ | بَيْت | ADDED TASHKEEL: final sukun |
| ba_vs_nun-005 | بُرْتُقَالْ | بُرْتُقَال | ADDED TASHKEEL: final sukun |
| ba_vs_nun-006 | بَقَرَةْ | بَقَرَة | ADDED TASHKEEL: final sukun |
| ba_vs_nun-007 | بَحْرْ | بَحْر | ADDED TASHKEEL: final sukun |
| ba_vs_nun-008 | بِنْتْ | بِنْت | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| ba_vs_nun-009 | بَلَدْ | بَلَد | ADDED TASHKEEL: final sukun |
| ba_vs_nun-010 | بُسْتَانْ | بُسْتَان | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| ba_vs_nun-011 | كِتَابْ | كِتَاب | ADDED TASHKEEL: final sukun |
| ba_vs_nun-012 | لَعِبْ | لَعِب | ADDED TASHKEEL: final sukun |
| ba_vs_nun-013 | حَبِيبْ | حَبِيب | ADDED TASHKEEL: final sukun |
| ba_vs_nun-014 | جَبَلْ | جَبَل | ADDED TASHKEEL: final sukun |
| ba_vs_nun-015 | سَبُورَةْ | سَبُورَة | ADDED TASHKEEL: final sukun |
| ba_vs_nun-016 | رَبِيعْ | رَبِيع | ADDED TASHKEEL: final sukun |
| ba_vs_nun-017 | ذَهَبْ | ذَهَب | ADDED TASHKEEL: final sukun |
| ba_vs_nun-018 | أَرْنَبْ | أَرْنَب | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |

### nun_vs_ba (ب ن): نُونْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| nun_vs_ba-001 | نَارْ | نَار | ADDED TASHKEEL: final sukun |
| nun_vs_ba-002 | نَحْلَةْ | نَحْلَة | ADDED TASHKEEL: final sukun |
| nun_vs_ba-003 | نَجْمْ | نَجْم | ADDED TASHKEEL: final sukun |
| nun_vs_ba-004 | نُورْ | نُور | ADDED TASHKEEL: final sukun |
| nun_vs_ba-005 | نَهْرْ | نَهْر | ADDED TASHKEEL: final sukun |
| nun_vs_ba-006 | نَمِرْ | نَمِر | ADDED TASHKEEL: final sukun |
| nun_vs_ba-007 | نَخْلَةْ | نَخْلَة | ADDED TASHKEEL: final sukun |
| nun_vs_ba-008 | نَمْلَةْ | نَمْلَة | ADDED TASHKEEL: final sukun |
| nun_vs_ba-009 | نَافِذَةْ | نَافِذَة | ADDED TASHKEEL: final sukun |
| nun_vs_ba-010 | نَبَاتْ | نَبَات | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| nun_vs_ba-011 | عَيْنْ | عَيْن | ADDED TASHKEEL: final sukun |
| nun_vs_ba-012 | لَوْنْ | لَوْن | ADDED TASHKEEL: final sukun |
| nun_vs_ba-013 | سِنّْ | سِنّ | ADDED TASHKEEL: final sukun |
| nun_vs_ba-014 | مَنْزِلْ | مَنْزِل | ADDED TASHKEEL: final sukun |
| nun_vs_ba-015 | بَنَاتْ | بَنَات | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| nun_vs_ba-016 | جُنْدِي | — | NEEDS TASHKEEL: shadda (proposed جُنْدِيّْ) |
| nun_vs_ba-017 | حِصَانْ | حِصَان | ADDED TASHKEEL: final sukun |
| nun_vs_ba-018 | بُسْتَانْ | بُسْتَان | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |

### ta_vs_ya (ت ي): تَاءْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ta_vs_ya-001 | تُفَّاحْ | تُفَّاح | ADDED TASHKEEL: final sukun |
| ta_vs_ya-002 | تَمْرْ | تَمْر | ADDED TASHKEEL: final sukun |
| ta_vs_ya-003 | تِينْ | تِين | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| ta_vs_ya-004 | تَاجْ | تَاج | ADDED TASHKEEL: final sukun |
| ta_vs_ya-005 | تِلْمِيذْ | تِلْمِيذ | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| ta_vs_ya-006 | تُرَابْ | تُرَاب | ADDED TASHKEEL: final sukun |
| ta_vs_ya-007 | تَمْسَاحْ | تَمْسَاح | ADDED TASHKEEL: final sukun |
| ta_vs_ya-008 | تَوْتْ | تَوْت | ADDED TASHKEEL: final sukun |
| ta_vs_ya-009 | كِتَابْ | كِتَاب | ADDED TASHKEEL: final sukun |
| ta_vs_ya-010 | فَتَاةْ | فَتَاة | ADDED TASHKEEL: final sukun |
| ta_vs_ya-011 | بَيْتْ | بَيْت | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| ta_vs_ya-012 | وَقْتْ | وَقْت | ADDED TASHKEEL: final sukun |
| ta_vs_ya-013 | زَيْتْ | زَيْت | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| ta_vs_ya-014 | صَوْتْ | صَوْت | ADDED TASHKEEL: final sukun |
| ta_vs_ya-015 | تُوتْ | تُوت | ADDED TASHKEEL: final sukun |
| ta_vs_ya-016 | تَنِّينْ | تَنِّين | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| ta_vs_ya-017 | مَكْتَبَةْ | مَكْتَبَة | ADDED TASHKEEL: final sukun |
| ta_vs_ya-018 | سَاعَاتْ | سَاعَات | ADDED TASHKEEL: final sukun |

### ya_vs_ta (ت ي): يَاءْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ya_vs_ta-001 | يَدْ | يَد | ADDED TASHKEEL: final sukun |
| ya_vs_ta-002 | يَاسَمِينْ | يَاسَمِين | ADDED TASHKEEL: final sukun |
| ya_vs_ta-003 | يَمَامَةْ | يَمَامَة | ADDED TASHKEEL: final sukun |
| ya_vs_ta-004 | يَقْطِينْ | يَقْطِين | ADDED TASHKEEL: final sukun |
| ya_vs_ta-005 | يَوْمْ | يَوْم | ADDED TASHKEEL: final sukun |
| ya_vs_ta-006 | يَنْبُوعْ | يَنْبُوع | ADDED TASHKEEL: final sukun |
| ya_vs_ta-007 | بَيْتْ | بَيْت | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| ya_vs_ta-008 | عَيْنْ | عَيْن | ADDED TASHKEEL: final sukun |
| ya_vs_ta-009 | زَيْتْ | زَيْت | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| ya_vs_ta-010 | لَيْلْ | لَيْل | ADDED TASHKEEL: final sukun |
| ya_vs_ta-011 | كُرْسِي | — | NEEDS TASHKEEL: shadda (proposed كُرْسِيّْ) |
| ya_vs_ta-012 | هَادِي | — | — |
| ya_vs_ta-013 | عَرَبِي | — | NEEDS TASHKEEL: shadda (proposed عَرَبِيّْ) |
| ya_vs_ta-014 | رَاعِي | — | — |
| ya_vs_ta-015 | يَنَابِيعْ | يَنَابِيع | ADDED TASHKEEL: final sukun |
| ya_vs_ta-016 | يَرْقَةْ | يَرْقَة | ADDED TASHKEEL: final sukun |
| ya_vs_ta-017 | خَيْمَةْ | خَيْمَة | ADDED TASHKEEL: final sukun |
| ya_vs_ta-018 | قَوِي | — | NEEDS TASHKEEL: shadda (proposed قَوِيّْ) |

### tha_vs_shin (ث ش): ثَاءْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| tha_vs_shin-001 | ثَعْلَبْ | ثَعْلَب | ADDED TASHKEEL: final sukun |
| tha_vs_shin-002 | ثَلْجْ | ثَلْج | ADDED TASHKEEL: final sukun |
| tha_vs_shin-003 | ثَوْبْ | ثَوْب | ADDED TASHKEEL: final sukun |
| tha_vs_shin-004 | ثَمَرَةْ | ثَمَرَة | ADDED TASHKEEL: final sukun |
| tha_vs_shin-005 | ثُعْبَانْ | ثُعْبَان | ADDED TASHKEEL: final sukun |
| tha_vs_shin-006 | ثَلَاثَةْ | ثَلَاثَة | ADDED TASHKEEL: final sukun |
| tha_vs_shin-007 | ثَوْرْ | ثَوْر | ADDED TASHKEEL: final sukun |
| tha_vs_shin-008 | ثِيَابْ | ثِيَاب | ADDED TASHKEEL: final sukun |
| tha_vs_shin-009 | أَثَاثْ | أَثَاث | ADDED TASHKEEL: final sukun |
| tha_vs_shin-010 | مُثَلَّثْ | مُثَلَّث | ADDED TASHKEEL: final sukun |
| tha_vs_shin-011 | حَدِيثْ | حَدِيث | ADDED TASHKEEL: final sukun |
| tha_vs_shin-012 | بَحْثْ | بَحْث | ADDED TASHKEEL: final sukun |
| tha_vs_shin-013 | ثَرْوَةْ | ثَرْوَة | ADDED TASHKEEL: final sukun |
| tha_vs_shin-014 | ثَابِتْ | ثَابِت | ADDED TASHKEEL: final sukun |
| tha_vs_shin-015 | كَثِيرْ | كَثِير | ADDED TASHKEEL: final sukun |
| tha_vs_shin-016 | حِثّْ | حِثّ | ADDED TASHKEEL: final sukun |
| tha_vs_shin-017 | ثُلُثْ | ثُلُث | ADDED TASHKEEL: final sukun |
| tha_vs_shin-018 | وَرِيثْ | وَرِيث | ADDED TASHKEEL: final sukun |

### shin_vs_tha (ث ش): شِينْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| shin_vs_tha-001 | شَمْسْ | شَمْس | ADDED TASHKEEL: final sukun |
| shin_vs_tha-002 | شَجَرَةْ | شَجَرَة | ADDED TASHKEEL: final sukun |
| shin_vs_tha-003 | شَارِعْ | شَارِع | ADDED TASHKEEL: final sukun |
| shin_vs_tha-004 | شُرْطَةْ | شُرْطَة | ADDED TASHKEEL: final sukun |
| shin_vs_tha-005 | شَايْ | شَاي | ADDED TASHKEEL: final sukun |
| shin_vs_tha-006 | شِتَاءْ | شِتَاء | ADDED TASHKEEL: final sukun |
| shin_vs_tha-007 | شَهْرْ | شَهْر | ADDED TASHKEEL: final sukun |
| shin_vs_tha-008 | شَمْعَةْ | شَمْعَة | ADDED TASHKEEL: final sukun |
| shin_vs_tha-009 | مَشْرُوبْ | مَشْرُوب | ADDED TASHKEEL: final sukun |
| shin_vs_tha-010 | بِشَارَةْ | بِشَارَة | ADDED TASHKEEL: final sukun |
| shin_vs_tha-011 | عُشّْ | عُشّ | ADDED TASHKEEL: final sukun |
| shin_vs_tha-012 | فَرَاشْ | فَرَاش | ADDED TASHKEEL: final sukun |
| shin_vs_tha-013 | شُبَّاكْ | شُبَّاك | ADDED TASHKEEL: final sukun |
| shin_vs_tha-014 | شَرِيطْ | شَرِيط | ADDED TASHKEEL: final sukun |
| shin_vs_tha-015 | مُشْمِشْ | مُشْمِش | ADDED TASHKEEL: final sukun |
| shin_vs_tha-016 | رِيشْ | رِيش | ADDED TASHKEEL: final sukun |
| shin_vs_tha-017 | شَاطِئْ | شَاطِئ | ADDED TASHKEEL: final sukun |
| shin_vs_tha-018 | عَطَشْ | عَطَش | ADDED TASHKEEL: final sukun |

### jim_vs_kha (ج خ): جِيمْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| jim_vs_kha-001 | جَمَلْ | جَمَل | ADDED TASHKEEL: final sukun |
| jim_vs_kha-002 | جَبَلْ | جَبَل | ADDED TASHKEEL: final sukun |
| jim_vs_kha-003 | جَزَرْ | جَزَر | ADDED TASHKEEL: final sukun |
| jim_vs_kha-004 | جُبْنْ | جُبْن | ADDED TASHKEEL: final sukun |
| jim_vs_kha-005 | جَرَسْ | جَرَس | ADDED TASHKEEL: final sukun |
| jim_vs_kha-006 | جَنَّةْ | جَنَّة | ADDED TASHKEEL: final sukun |
| jim_vs_kha-007 | جِدَارْ | جِدَار | ADDED TASHKEEL: final sukun |
| jim_vs_kha-008 | جُنْدِي | — | NEEDS TASHKEEL: shadda (proposed جُنْدِيّْ) |
| jim_vs_kha-009 | نَجْمْ | نَجْم | ADDED TASHKEEL: final sukun |
| jim_vs_kha-010 | رَجُلْ | رَجُل | ADDED TASHKEEL: final sukun |
| jim_vs_kha-011 | دَجَاجْ | دَجَاج | ADDED TASHKEEL: final sukun |
| jim_vs_kha-012 | ثَلْجْ | ثَلْج | ADDED TASHKEEL: final sukun |
| jim_vs_kha-013 | جَوْزْ | جَوْز | ADDED TASHKEEL: final sukun |
| jim_vs_kha-014 | جَامِعْ | جَامِع | ADDED TASHKEEL: final sukun |
| jim_vs_kha-015 | مَسْجِدْ | مَسْجِد | ADDED TASHKEEL: final sukun |
| jim_vs_kha-016 | حَجَرْ | حَجَر | ADDED TASHKEEL: final sukun |
| jim_vs_kha-017 | بُرْجْ | بُرْج | ADDED TASHKEEL: final sukun |
| jim_vs_kha-018 | مَوْجْ | مَوْج | ADDED TASHKEEL: final sukun |

### kha_vs_jim (ج خ): خَاءْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kha_vs_jim-001 | خَرُوفْ | خَرُوف | ADDED TASHKEEL: final sukun |
| kha_vs_jim-002 | خُبْزْ | خُبْز | ADDED TASHKEEL: final sukun |
| kha_vs_jim-003 | خَيْمَةْ | خَيْمَة | ADDED TASHKEEL: final sukun |
| kha_vs_jim-004 | خَاتَمْ | خَاتَم | ADDED TASHKEEL: final sukun |
| kha_vs_jim-005 | خَشَبْ | خَشَب | ADDED TASHKEEL: final sukun |
| kha_vs_jim-006 | خَيْلْ | خَيْل | ADDED TASHKEEL: final sukun |
| kha_vs_jim-007 | خَلِيجْ | خَلِيج | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| kha_vs_jim-008 | خَرِيطَةْ | خَرِيطَة | ADDED TASHKEEL: final sukun |
| kha_vs_jim-009 | نَخْلَةْ | نَخْلَة | ADDED TASHKEEL: final sukun |
| kha_vs_jim-010 | بُخَارْ | بُخَار | ADDED TASHKEEL: final sukun |
| kha_vs_jim-011 | طَبَّاخْ | طَبَّاخ | ADDED TASHKEEL: final sukun |
| kha_vs_jim-012 | مَطْبَخْ | مَطْبَخ | ADDED TASHKEEL: final sukun |
| kha_vs_jim-013 | خَضْرَاءْ | خَضْرَاء | ADDED TASHKEEL: final sukun |
| kha_vs_jim-014 | خَزَانَةْ | خَزَانَة | ADDED TASHKEEL: final sukun |
| kha_vs_jim-015 | دُخَانْ | دُخَان | ADDED TASHKEEL: final sukun |
| kha_vs_jim-016 | صَخْرَةْ | صَخْرَة | ADDED TASHKEEL: final sukun |
| kha_vs_jim-017 | فَخّْ | فَخّ | ADDED TASHKEEL: final sukun |
| kha_vs_jim-018 | تَارِيخْ | تَارِيخ | ADDED TASHKEEL: final sukun |

### sin_vs_shin (س ش): سِينْ (17 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| sin_vs_shin-001 | سَمَكْ | سَمَك | ADDED TASHKEEL: final sukun |
| sin_vs_shin-002 | سَيَّارَةْ | سَيَّارَة | ADDED TASHKEEL: final sukun |
| sin_vs_shin-003 | سَاعَةْ | سَاعَة | ADDED TASHKEEL: final sukun |
| sin_vs_shin-004 | سَرِيرْ | سَرِير | ADDED TASHKEEL: final sukun |
| sin_vs_shin-005 | سَلَحْفَاةْ | سَلَحْفَاة | ADDED TASHKEEL: final sukun |
| sin_vs_shin-006 | سَمَاءْ | سَمَاء | ADDED TASHKEEL: final sukun |
| sin_vs_shin-007 | سُوقْ | سُوق | ADDED TASHKEEL: final sukun |
| sin_vs_shin-008 | سَفِينَةْ | سَفِينَة | ADDED TASHKEEL: final sukun |
| sin_vs_shin-009 | مَدْرَسَةْ | مَدْرَسَة | ADDED TASHKEEL: final sukun |
| sin_vs_shin-010 | شَمْسْ | شَمْس | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| sin_vs_shin-011 | فَانُوسْ | فَانُوس | ADDED TASHKEEL: final sukun |
| sin_vs_shin-012 | سَحَابْ | سَحَاب | ADDED TASHKEEL: final sukun |
| sin_vs_shin-013 | سِكِّينْ | سِكِّين | ADDED TASHKEEL: final sukun |
| sin_vs_shin-014 | مَسْجِدْ | مَسْجِد | ADDED TASHKEEL: final sukun |
| sin_vs_shin-015 | جَلَسْ | جَلَسَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| sin_vs_shin-016 | سُلَّمْ | سُلَّم | ADDED TASHKEEL: final sukun |
| sin_vs_shin-017 | دَرْسْ | دَرْس | ADDED TASHKEEL: final sukun |

### shin_vs_sin (س ش): شِينْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| shin_vs_sin-001 | شَمْسْ | شَمْس | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| shin_vs_sin-002 | شَجَرَةْ | شَجَرَة | ADDED TASHKEEL: final sukun |
| shin_vs_sin-003 | شُرْطَةْ | شُرْطَة | ADDED TASHKEEL: final sukun |
| shin_vs_sin-004 | شَايْ | شَاي | ADDED TASHKEEL: final sukun |
| shin_vs_sin-005 | شَمْعَةْ | شَمْعَة | ADDED TASHKEEL: final sukun |
| shin_vs_sin-006 | شَارِعْ | شَارِع | ADDED TASHKEEL: final sukun |
| shin_vs_sin-007 | شِتَاءْ | شِتَاء | ADDED TASHKEEL: final sukun |
| shin_vs_sin-008 | شَهْرْ | شَهْر | ADDED TASHKEEL: final sukun |
| shin_vs_sin-009 | مَشْرُوبْ | مَشْرُوب | ADDED TASHKEEL: final sukun |
| shin_vs_sin-010 | عُشْبْ | عُشْب | ADDED TASHKEEL: final sukun |
| shin_vs_sin-011 | فَرَاشْ | فَرَاش | ADDED TASHKEEL: final sukun |
| shin_vs_sin-012 | رِيشْ | رِيش | ADDED TASHKEEL: final sukun |
| shin_vs_sin-013 | شُبَّاكْ | شُبَّاك | ADDED TASHKEEL: final sukun |
| shin_vs_sin-014 | شَرِيطْ | شَرِيط | ADDED TASHKEEL: final sukun |
| shin_vs_sin-015 | بِشَارَةْ | بِشَارَة | ADDED TASHKEEL: final sukun |
| shin_vs_sin-016 | عَطَشْ | عَطَش | ADDED TASHKEEL: final sukun |
| shin_vs_sin-017 | شَاطِئْ | شَاطِئ | ADDED TASHKEEL: final sukun |
| shin_vs_sin-018 | عُشّْ | عُشّ | ADDED TASHKEEL: final sukun |

### sad_vs_dad (ص ض): صَادْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| sad_vs_dad-001 | صَقْرْ | صَقْر | ADDED TASHKEEL: final sukun |
| sad_vs_dad-002 | صُنْدُوقْ | صُنْدُوق | ADDED TASHKEEL: final sukun |
| sad_vs_dad-003 | صَابُونْ | صَابُون | ADDED TASHKEEL: final sukun |
| sad_vs_dad-004 | صَحْرَاءْ | صَحْرَاء | ADDED TASHKEEL: final sukun |
| sad_vs_dad-005 | صَدِيقْ | صَدِيق | ADDED TASHKEEL: final sukun |
| sad_vs_dad-006 | صُورَةْ | صُورَة | ADDED TASHKEEL: final sukun |
| sad_vs_dad-007 | صَبَاحْ | صَبَاح | ADDED TASHKEEL: final sukun |
| sad_vs_dad-008 | صَخْرَةْ | صَخْرَة | ADDED TASHKEEL: final sukun |
| sad_vs_dad-009 | عُصْفُورْ | عُصْفُور | ADDED TASHKEEL: final sukun |
| sad_vs_dad-010 | نَصْرْ | نَصْر | ADDED TASHKEEL: final sukun |
| sad_vs_dad-011 | قَفَصْ | قَفَص | ADDED TASHKEEL: final sukun |
| sad_vs_dad-012 | رَصَاصْ | رَصَاص | ADDED TASHKEEL: final sukun |
| sad_vs_dad-013 | صَيْفْ | صَيْف | ADDED TASHKEEL: final sukun |
| sad_vs_dad-014 | صَلَاةْ | صَلَاة | ADDED TASHKEEL: final sukun |
| sad_vs_dad-015 | مِصْبَاحْ | مِصْبَاح | ADDED TASHKEEL: final sukun |
| sad_vs_dad-016 | قَصْرْ | قَصْر | ADDED TASHKEEL: final sukun |
| sad_vs_dad-017 | حِصَانْ | حِصَان | ADDED TASHKEEL: final sukun |
| sad_vs_dad-018 | خَلَاصْ | خَلَاص | ADDED TASHKEEL: final sukun |

### dad_vs_sad (ص ض): ضَادْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dad_vs_sad-001 | ضِفْدَعْ | ضِفْدَع | ADDED TASHKEEL: final sukun |
| dad_vs_sad-002 | ضَوْءْ | ضَوْء | ADDED TASHKEEL: final sukun |
| dad_vs_sad-003 | ضَبَابْ | ضَبَاب | ADDED TASHKEEL: final sukun |
| dad_vs_sad-004 | ضَيْفْ | ضَيْف | ADDED TASHKEEL: final sukun |
| dad_vs_sad-005 | ضَحِكْ | ضَحِك | ADDED TASHKEEL: final sukun |
| dad_vs_sad-006 | ضَرْبْ | ضَرْب | ADDED TASHKEEL: final sukun |
| dad_vs_sad-007 | ضَعِيفْ | ضَعِيف | ADDED TASHKEEL: final sukun |
| dad_vs_sad-008 | ضَمِيرْ | ضَمِير | ADDED TASHKEEL: final sukun |
| dad_vs_sad-009 | رِيَاضَةْ | رِيَاضَة | ADDED TASHKEEL: final sukun |
| dad_vs_sad-010 | حَضَانَةْ | حَضَانَة | ADDED TASHKEEL: final sukun |
| dad_vs_sad-011 | أَبْيَضْ | أَبْيَض | ADDED TASHKEEL: final sukun |
| dad_vs_sad-012 | مَرِيضْ | مَرِيض | ADDED TASHKEEL: final sukun |
| dad_vs_sad-013 | ضَابِطْ | ضَابِط | ADDED TASHKEEL: final sukun |
| dad_vs_sad-014 | ضَخْمْ | ضَخْم | ADDED TASHKEEL: final sukun |
| dad_vs_sad-015 | مُضِيءْ | مُضِيء | ADDED TASHKEEL: final sukun |
| dad_vs_sad-016 | رَوْضَةْ | رَوْضَة | ADDED TASHKEEL: final sukun |
| dad_vs_sad-017 | أَرْضْ | أَرْض | ADDED TASHKEEL: final sukun |
| dad_vs_sad-018 | بَيْضْ | بَيْض | ADDED TASHKEEL: final sukun |

### tta_vs_zza (ط ظ): طَاءْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| tta_vs_zza-001 | طَائِرْ | طَائِر | ADDED TASHKEEL: final sukun |
| tta_vs_zza-002 | طَبِيبْ | طَبِيب | ADDED TASHKEEL: final sukun |
| tta_vs_zza-003 | طَاوِلَةْ | طَاوِلَة | ADDED TASHKEEL: final sukun |
| tta_vs_zza-004 | طَرِيقْ | طَرِيق | ADDED TASHKEEL: final sukun |
| tta_vs_zza-005 | طَبَقْ | طَبَق | ADDED TASHKEEL: final sukun |
| tta_vs_zza-006 | طِفْلْ | طِفْل | ADDED TASHKEEL: final sukun |
| tta_vs_zza-007 | طَمَاطِمْ | طَمَاطِم | ADDED TASHKEEL: final sukun |
| tta_vs_zza-008 | طَيَّارَةْ | طَيَّارَة | ADDED TASHKEEL: final sukun |
| tta_vs_zza-009 | بَطَّةْ | بَطَّة | ADDED TASHKEEL: final sukun |
| tta_vs_zza-010 | قِطَارْ | قِطَار | ADDED TASHKEEL: final sukun |
| tta_vs_zza-011 | قِطّْ | قِطّ | ADDED TASHKEEL: final sukun |
| tta_vs_zza-012 | خَيْطْ | خَيْط | ADDED TASHKEEL: final sukun |
| tta_vs_zza-013 | طَبْلْ | طَبْل | ADDED TASHKEEL: final sukun |
| tta_vs_zza-014 | طَحِينْ | طَحِين | ADDED TASHKEEL: final sukun |
| tta_vs_zza-015 | مَطَرْ | مَطَر | ADDED TASHKEEL: final sukun |
| tta_vs_zza-016 | خَطّْ | خَطّ | ADDED TASHKEEL: final sukun |
| tta_vs_zza-017 | بِسَاطْ | بِسَاط | ADDED TASHKEEL: final sukun |
| tta_vs_zza-018 | نَشَاطْ | نَشَاط | ADDED TASHKEEL: final sukun |

### zza_vs_tta (ط ظ): ظَاءْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zza_vs_tta-001 | ظَرْفْ | ظَرْف | ADDED TASHKEEL: final sukun |
| zza_vs_tta-002 | ظِلّْ | ظِلّ | ADDED TASHKEEL: final sukun |
| zza_vs_tta-003 | ظَبْيْ | ظَبْي | ADDED TASHKEEL: final sukun |
| zza_vs_tta-004 | ظُفْرْ | ظُفْر | ADDED TASHKEEL: final sukun |
| zza_vs_tta-005 | ظَهْرْ | ظَهْر | ADDED TASHKEEL: final sukun |
| zza_vs_tta-006 | ظَلَامْ | ظَلَام | ADDED TASHKEEL: final sukun |
| zza_vs_tta-007 | ظَرِيفْ | ظَرِيف | ADDED TASHKEEL: final sukun |
| zza_vs_tta-008 | ظَالِمْ | ظَالِم | ADDED TASHKEEL: final sukun |
| zza_vs_tta-009 | نَظَّارَةْ | نَظَّارَة | ADDED TASHKEEL: final sukun |
| zza_vs_tta-010 | مَحْفَظَةْ | مَحْفَظَة | ADDED TASHKEEL: final sukun |
| zza_vs_tta-011 | حَظّْ | حَظّ | ADDED TASHKEEL: final sukun |
| zza_vs_tta-012 | لَفْظْ | لَفْظ | ADDED TASHKEEL: final sukun |
| zza_vs_tta-013 | ظَمْآنْ | ظَمْآن | ADDED TASHKEEL: final sukun |
| zza_vs_tta-014 | ظَنّْ | ظَنّ | ADDED TASHKEEL: final sukun |
| zza_vs_tta-015 | نِظَامْ | نِظَام | ADDED TASHKEEL: final sukun |
| zza_vs_tta-016 | حَفِيظْ | حَفِيظ | ADDED TASHKEEL: final sukun |
| zza_vs_tta-017 | مُنَظَّمْ | مُنَظَّم | ADDED TASHKEEL: final sukun |
| zza_vs_tta-018 | وَعْظْ | وَعْظ | ADDED TASHKEEL: final sukun |

### ain_vs_ghain (ع غ): عَيْنْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ain_vs_ghain-001 | عَيْنْ | عَيْن | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-002 | عُصْفُورْ | عُصْفُور | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-003 | عِنَبْ | عِنَب | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-004 | عَسَلْ | عَسَل | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-005 | عَرَبِي | — | NEEDS TASHKEEL: shadda (proposed عَرَبِيّْ) |
| ain_vs_ghain-006 | عَلَمْ | عَلَم | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-007 | عَجَلَةْ | عَجَلَة | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-008 | عَقْرَبْ | عَقْرَب | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-009 | مَعْلَمْ | مَعْلَم | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-010 | سَاعَةْ | سَاعَة | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-011 | رَبِيعْ | رَبِيع | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-012 | شُجَاعْ | شُجَاع | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-013 | عَنْكَبُوتْ | عَنْكَبُوت | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-014 | عَرُوسْ | عَرُوس | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-015 | مَعْرِفَةْ | مَعْرِفَة | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-016 | شَمْعْ | شَمْع | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-017 | جَامِعْ | جَامِع | ADDED TASHKEEL: final sukun |
| ain_vs_ghain-018 | صُنْعْ | صُنْع | ADDED TASHKEEL: final sukun |

### ghain_vs_ain (ع غ): غَيْنْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ghain_vs_ain-001 | غَزَالْ | غَزَال | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-002 | غَابَةْ | غَابَة | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-003 | غُرَابْ | غُرَاب | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-004 | غَيْمَةْ | غَيْمَة | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-005 | غُرْفَةْ | غُرْفَة | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-006 | غَدَاءْ | غَدَاء | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-007 | غَنَمْ | غَنَم | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-008 | غَسَّالَةْ | غَسَّالَة | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-009 | صَغِيرْ | صَغِير | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-010 | بَغْدَادْ | بَغْدَاد | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-011 | دِمَاغْ | دِمَاغ | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-012 | فَرَاغْ | فَرَاغ | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-013 | غَرِيبْ | غَرِيب | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-014 | غَنِي | — | NEEDS TASHKEEL: shadda (proposed غَنِيّْ) |
| ghain_vs_ain-015 | مَغْرِبْ | مَغْرِب | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-016 | صِبَاغْ | صِبَاغ | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-017 | بَلَاغْ | بَلَاغ | ADDED TASHKEEL: final sukun |
| ghain_vs_ain-018 | نُغَمْ | نُغَم | ADDED TASHKEEL: final sukun |

### fa_vs_qaf (ف ق): فَاءْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| fa_vs_qaf-001 | فِيلْ | فِيل | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-002 | فَرَاشَةْ | فَرَاشَة | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-003 | فَأْرْ | فَأْر | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-004 | فُسْتَانْ | فُسْتَان | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-005 | فَوَاكِهْ | فَوَاكِه | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-006 | فَنّْ | فَنّ | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-007 | فَجْرْ | فَجْر | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-008 | فُرْنْ | فُرْن | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-009 | عُصْفُورْ | عُصْفُور | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-010 | سَفِينَةْ | سَفِينَة | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-011 | خَرُوفْ | خَرُوف | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-012 | صَيْفْ | صَيْف | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-013 | فَرَحْ | فَرَح | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-014 | فَلَّاحْ | فَلَّاح | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-015 | مَفْتَاحْ | مَفْتَاح | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-016 | ظَرْفْ | ظَرْف | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-017 | نَظِيفْ | نَظِيف | ADDED TASHKEEL: final sukun |
| fa_vs_qaf-018 | رَغِيفْ | رَغِيف | ADDED TASHKEEL: final sukun |

### qaf_vs_fa (ف ق): قَافْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| qaf_vs_fa-001 | قَمَرْ | قَمَر | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-002 | قِطَّةْ | قِطَّة | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-003 | قَلَمْ | قَلَم | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-004 | قَلْبْ | قَلْب | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-005 | قَوْسْ | قَوْس | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-006 | قَصْرْ | قَصْر | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-007 | قَارِبْ | قَارِب | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-008 | قُرْآنْ | قُرْآن | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-009 | بَقَرَةْ | بَقَرَة | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-010 | صَقْرْ | صَقْر | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-011 | طَرِيقْ | طَرِيق | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-012 | سُوقْ | سُوق | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-013 | قِرْدْ | قِرْد | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-014 | قَفَصْ | قَفَص | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| qaf_vs_fa-015 | مَقْبَرَةْ | مَقْبَرَة | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-016 | حَقِيبَةْ | حَقِيبَة | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-017 | بُرَاقْ | بُرَاق | ADDED TASHKEEL: final sukun |
| qaf_vs_fa-018 | عِرَاقْ | عِرَاق | ADDED TASHKEEL: final sukun |

### lam_vs_kaf (ل ك): لَامْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| lam_vs_kaf-001 | لَيْمُونْ | لَيْمُون | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-002 | لَعِبَةْ | لَعِبَة | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-003 | لَوْنْ | لَوْن | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-004 | لَيْلْ | لَيْل | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-005 | لَبَنْ | لَبَن | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-006 | لُغَةْ | لُغَة | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-007 | لَوْحَةْ | لَوْحَة | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-008 | لِسَانْ | لِسَان | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-009 | عَلَمْ | عَلَم | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-010 | جَمَلْ | جَمَل | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-011 | طِفْلْ | طِفْل | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-012 | عَسَلْ | عَسَل | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-013 | لَحْمْ | لَحْم | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-014 | لُؤْلُؤْ | لُؤْلُؤ | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-015 | سُلَّمْ | سُلَّم | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-016 | جَبَلْ | جَبَل | ADDED TASHKEEL: final sukun |
| lam_vs_kaf-017 | مَلِكْ | مَلِك | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| lam_vs_kaf-018 | هِلَالْ | هِلَال | ADDED TASHKEEL: final sukun |

### kaf_vs_lam (ل ك): كَافْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kaf_vs_lam-001 | كَلْبْ | كَلْب | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| kaf_vs_lam-002 | كِتَابْ | كِتَاب | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-003 | كُرَةْ | كُرَة | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-004 | كَنْزْ | كَنْز | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-005 | كَعْكَةْ | كَعْكَة | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-006 | كُرْسِي | — | NEEDS TASHKEEL: shadda (proposed كُرْسِيّْ) |
| kaf_vs_lam-007 | كَبِيرْ | كَبِير | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-008 | كَوْكَبْ | كَوْكَب | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-009 | سَمَكْ | سَمَك | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-010 | دِيكْ | دِيك | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-011 | مَلِكْ | مَلِك | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| kaf_vs_lam-012 | بَنْكْ | بَنْك | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-013 | كَأْسْ | كَأْس | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-014 | كَرَزْ | كَرَز | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-015 | شَبَكَةْ | شَبَكَة | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-016 | حِكَايَةْ | حِكَايَة | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-017 | سِكِّينْ | سِكِّين | ADDED TASHKEEL: final sukun |
| kaf_vs_lam-018 | مُبَارَكْ | مُبَارَك | ADDED TASHKEEL: final sukun |

### ra_vs_zay (ر ز): رَاءْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ra_vs_zay-001 | رَجُلْ | رَجُل | ADDED TASHKEEL: final sukun |
| ra_vs_zay-002 | رُمَّانْ | رُمَّان | ADDED TASHKEEL: final sukun |
| ra_vs_zay-003 | رِيشَةْ | رِيشَة | ADDED TASHKEEL: final sukun |
| ra_vs_zay-004 | رَبِيعْ | رَبِيع | ADDED TASHKEEL: final sukun |
| ra_vs_zay-005 | رَأْسْ | رَأْس | ADDED TASHKEEL: final sukun |
| ra_vs_zay-006 | رَمْلْ | رَمْل | ADDED TASHKEEL: final sukun |
| ra_vs_zay-007 | رِسَالَةْ | رِسَالَة | ADDED TASHKEEL: final sukun |
| ra_vs_zay-008 | رُكْبَةْ | رُكْبَة | ADDED TASHKEEL: final sukun |
| ra_vs_zay-009 | شَجَرَةْ | شَجَرَة | ADDED TASHKEEL: final sukun |
| ra_vs_zay-010 | بُرْتُقَالْ | بُرْتُقَال | ADDED TASHKEEL: final sukun |
| ra_vs_zay-011 | نَهْرْ | نَهْر | ADDED TASHKEEL: final sukun |
| ra_vs_zay-012 | بَحْرْ | بَحْر | ADDED TASHKEEL: final sukun |
| ra_vs_zay-013 | رَقَمْ | رَقَم | ADDED TASHKEEL: final sukun |
| ra_vs_zay-014 | رَوْضَةْ | رَوْضَة | ADDED TASHKEEL: final sukun |
| ra_vs_zay-015 | مَرْكَبْ | مَرْكَب | ADDED TASHKEEL: final sukun |
| ra_vs_zay-016 | قَمَرْ | قَمَر | ADDED TASHKEEL: final sukun |
| ra_vs_zay-017 | طَيْرْ | طَيْر | ADDED TASHKEEL: final sukun |
| ra_vs_zay-018 | سِحْرْ | سِحْر | ADDED TASHKEEL: final sukun |

### zay_vs_ra (ر ز): زَايْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zay_vs_ra-001 | زَرَافَةْ | زَرَافَة | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| zay_vs_ra-002 | زَهْرَةْ | زَهْرَة | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| zay_vs_ra-003 | زَيْتُونْ | زَيْتُون | ADDED TASHKEEL: final sukun |
| zay_vs_ra-004 | زُجَاجْ | زُجَاج | ADDED TASHKEEL: final sukun |
| zay_vs_ra-005 | زَيْتْ | زَيْت | ADDED TASHKEEL: final sukun |
| zay_vs_ra-006 | زِرّْ | زِرّ | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| zay_vs_ra-007 | زَلَّاجَةْ | زَلَّاجَة | ADDED TASHKEEL: final sukun |
| zay_vs_ra-008 | زِينَةْ | زِينَة | ADDED TASHKEEL: final sukun |
| zay_vs_ra-009 | مَنْزِلْ | مَنْزِل | ADDED TASHKEEL: final sukun |
| zay_vs_ra-010 | غَزَالْ | غَزَال | ADDED TASHKEEL: final sukun |
| zay_vs_ra-011 | خُبْزْ | خُبْز | ADDED TASHKEEL: final sukun |
| zay_vs_ra-012 | أَرُزْ | أَرُز | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| zay_vs_ra-013 | زَبِيبْ | زَبِيب | ADDED TASHKEEL: final sukun |
| zay_vs_ra-014 | زُرَافَةْ | زُرَافَة | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| zay_vs_ra-015 | مِيزَانْ | مِيزَان | ADDED TASHKEEL: final sukun |
| zay_vs_ra-016 | كَنْزْ | كَنْز | ADDED TASHKEEL: final sukun |
| zay_vs_ra-017 | جَوْزْ | جَوْز | ADDED TASHKEEL: final sukun |
| zay_vs_ra-018 | رُمُوزْ | رُمُوز | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |

### dal_vs_dhal (د ذ): دَالْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dal_vs_dhal-001 | دُبّْ | دُبّ | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-002 | دَجَاجَةْ | دَجَاجَة | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-003 | دَرَّاجَةْ | دَرَّاجَة | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-004 | دَلْوْ | دَلْو | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-005 | دَوَاءْ | دَوَاء | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-006 | دُخَانْ | دُخَان | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-007 | دَفْتَرْ | دَفْتَر | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-008 | دِينَارْ | دِينَار | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-009 | مَدْرَسَةْ | مَدْرَسَة | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-010 | هُدْهُدْ | هُدْهُد | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-011 | أَسَدْ | أَسَد | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-012 | وَلَدْ | وَلَد | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-013 | دُودَةْ | دُودَة | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-014 | دَقِيقْ | دَقِيق | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-015 | بَلَدْ | بَلَد | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-016 | جَدِيدْ | جَدِيد | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-017 | قَائِدْ | قَائِد | ADDED TASHKEEL: final sukun |
| dal_vs_dhal-018 | مَسْجِدْ | مَسْجِد | ADDED TASHKEEL: final sukun |

### dhal_vs_dal (د ذ): ذَالْ (18 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dhal_vs_dal-001 | ذِئْبْ | ذِئْب | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-002 | ذَهَبْ | ذَهَب | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-003 | ذُرَةْ | ذُرَة | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-004 | ذُبَابَةْ | ذُبَابَة | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-005 | ذَكِي | — | NEEDS TASHKEEL: shadda (proposed ذَكِيّْ) |
| dhal_vs_dal-006 | ذِرَاعْ | ذِرَاع | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-007 | ذَيْلْ | ذَيْل | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-008 | ذَاكِرَةْ | ذَاكِرَة | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-009 | نَافِذَةْ | نَافِذَة | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-010 | تِلْمِيذْ | تِلْمِيذ | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-011 | أُسْتَاذْ | أُسْتَاذ | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-012 | مُنْذْ | مُنْذُ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| dhal_vs_dal-013 | ذَوْقْ | ذَوْق | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-014 | ذَخِيرَةْ | ذَخِيرَة | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-015 | لَذِيذْ | لَذِيذ | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-016 | مَلَاذْ | مَلَاذ | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-017 | إِنْقَاذْ | إِنْقَاذ | ADDED TASHKEEL: final sukun |
| dhal_vs_dal-018 | حَذَاءْ | حَذَاء | ADDED TASHKEEL: final sukun |

### qaf_vs_kaf (ق ك): قَافْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| qaf_vs_kaf-001 | قَمَرْ | قَمَر | ADDED TASHKEEL: final sukun |
| qaf_vs_kaf-002 | قَلَمْ | قَلَم | ADDED TASHKEEL: final sukun |
| qaf_vs_kaf-003 | قِطَّةْ | قِطَّة | ADDED TASHKEEL: final sukun |
| qaf_vs_kaf-004 | قَلْبْ | قَلْب | ADDED TASHKEEL: final sukun |
| qaf_vs_kaf-005 | قَصْرْ | قَصْر | ADDED TASHKEEL: final sukun |
| qaf_vs_kaf-006 | قَارِبْ | قَارِب | ADDED TASHKEEL: final sukun |

### kaf_vs_qaf (ق ك): كَافْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kaf_vs_qaf-001 | كَلْبْ | كَلْب | ADDED TASHKEEL: final sukun |
| kaf_vs_qaf-002 | كِتَابْ | كِتَاب | ADDED TASHKEEL: final sukun |
| kaf_vs_qaf-003 | كُرَةْ | كُرَة | ADDED TASHKEEL: final sukun |
| kaf_vs_qaf-004 | كَبِيرْ | كَبِير | ADDED TASHKEEL: final sukun |
| kaf_vs_qaf-005 | كَعْكَةْ | كَعْكَة | ADDED TASHKEEL: final sukun |
| kaf_vs_qaf-006 | كُرْسِي | — | NEEDS TASHKEEL: shadda (proposed كُرْسِيّْ) |

### zay_vs_dhal (ز ذ): زَايْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zay_vs_dhal-001 | زَهْرَةْ | زَهْرَة | ADDED TASHKEEL: final sukun |
| zay_vs_dhal-002 | زَرَافَةْ | زَرَافَة | ADDED TASHKEEL: final sukun |
| zay_vs_dhal-003 | زَيْتُونْ | زَيْتُون | ADDED TASHKEEL: final sukun |
| zay_vs_dhal-004 | زُجَاجْ | زُجَاج | ADDED TASHKEEL: final sukun |
| zay_vs_dhal-005 | زَيْتْ | زَيْت | ADDED TASHKEEL: final sukun |
| zay_vs_dhal-006 | زِينَةْ | زِينَة | ADDED TASHKEEL: final sukun |

### dhal_vs_zay (ز ذ): ذَالْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dhal_vs_zay-001 | ذِئْبْ | ذِئْب | ADDED TASHKEEL: final sukun |
| dhal_vs_zay-002 | ذَهَبْ | ذَهَب | ADDED TASHKEEL: final sukun |
| dhal_vs_zay-003 | ذُرَةْ | ذُرَة | ADDED TASHKEEL: final sukun |
| dhal_vs_zay-004 | ذُبَابَةْ | ذُبَابَة | ADDED TASHKEEL: final sukun |
| dhal_vs_zay-005 | ذَكِي | — | NEEDS TASHKEEL: shadda (proposed ذَكِيّْ) |
| dhal_vs_zay-006 | ذَيْلْ | ذَيْل | ADDED TASHKEEL: final sukun |

### sin_vs_tha (س ث): سِينْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| sin_vs_tha-001 | سَمَكْ | سَمَك | ADDED TASHKEEL: final sukun |
| sin_vs_tha-002 | سَيَّارَةْ | سَيَّارَة | ADDED TASHKEEL: final sukun |
| sin_vs_tha-003 | سَاعَةْ | سَاعَة | ADDED TASHKEEL: final sukun |
| sin_vs_tha-004 | سَمَاءْ | سَمَاء | ADDED TASHKEEL: final sukun |
| sin_vs_tha-005 | سُوقْ | سُوق | ADDED TASHKEEL: final sukun |
| sin_vs_tha-006 | سَفِينَةْ | سَفِينَة | ADDED TASHKEEL: final sukun |

### tha_vs_sin (س ث): ثَاءْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| tha_vs_sin-001 | ثَعْلَبْ | ثَعْلَب | ADDED TASHKEEL: final sukun |
| tha_vs_sin-002 | ثَلْجْ | ثَلْج | ADDED TASHKEEL: final sukun |
| tha_vs_sin-003 | ثَوْبْ | ثَوْب | ADDED TASHKEEL: final sukun |
| tha_vs_sin-004 | ثَمَرَةْ | ثَمَرَة | ADDED TASHKEEL: final sukun |
| tha_vs_sin-005 | ثُعْبَانْ | ثُعْبَان | ADDED TASHKEEL: final sukun |
| tha_vs_sin-006 | ثَوْرْ | ثَوْر | ADDED TASHKEEL: final sukun |

### zza_vs_dhal (ظ ذ): ظَاءْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zza_vs_dhal-001 | ظَرْفْ | ظَرْف | ADDED TASHKEEL: final sukun |
| zza_vs_dhal-002 | ظِلّْ | ظِلّ | ADDED TASHKEEL: final sukun |
| zza_vs_dhal-003 | ظُفْرْ | ظُفْر | ADDED TASHKEEL: final sukun |
| zza_vs_dhal-004 | ظَهْرْ | ظَهْر | ADDED TASHKEEL: final sukun |
| zza_vs_dhal-005 | ظَلَامْ | ظَلَام | ADDED TASHKEEL: final sukun |
| zza_vs_dhal-006 | ظَرِيفْ | ظَرِيف | ADDED TASHKEEL: final sukun |

### dhal_vs_zza (ظ ذ): ذَالْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dhal_vs_zza-001 | ذِئْبْ | ذِئْب | ADDED TASHKEEL: final sukun |
| dhal_vs_zza-002 | ذَهَبْ | ذَهَب | ADDED TASHKEEL: final sukun |
| dhal_vs_zza-003 | ذُرَةْ | ذُرَة | ADDED TASHKEEL: final sukun |
| dhal_vs_zza-004 | ذَكِي | — | NEEDS TASHKEEL: shadda (proposed ذَكِيّْ) |
| dhal_vs_zza-005 | ذِرَاعْ | ذِرَاع | ADDED TASHKEEL: final sukun |
| dhal_vs_zza-006 | ذَيْلْ | ذَيْل | ADDED TASHKEEL: final sukun |

### ha_vs_hha (ه ح): هَاءْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ha_vs_hha-001 | هِلَالْ | هِلَال | ADDED TASHKEEL: final sukun |
| ha_vs_hha-002 | هَدِيَّةْ | هَدِيَّة | ADDED TASHKEEL: final sukun |
| ha_vs_hha-003 | هَاتِفْ | هَاتِف | ADDED TASHKEEL: final sukun |
| ha_vs_hha-004 | هَوَاءْ | هَوَاء | ADDED TASHKEEL: final sukun |
| ha_vs_hha-005 | هُدْهُدْ | هُدْهُد | ADDED TASHKEEL: final sukun |
| ha_vs_hha-006 | هَرَمْ | هَرَم | ADDED TASHKEEL: final sukun |

### hha_vs_ha (ه ح): حَاءْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| hha_vs_ha-001 | حُوتْ | حُوت | ADDED TASHKEEL: final sukun |
| hha_vs_ha-002 | حِصَانْ | حِصَان | ADDED TASHKEEL: final sukun |
| hha_vs_ha-003 | حَلِيبْ | حَلِيب | ADDED TASHKEEL: final sukun |
| hha_vs_ha-004 | حَدِيقَةْ | حَدِيقَة | ADDED TASHKEEL: final sukun |
| hha_vs_ha-005 | حَمَامَةْ | حَمَامَة | ADDED TASHKEEL: final sukun |
| hha_vs_ha-006 | حَقِيبَةْ | حَقِيبَة | ADDED TASHKEEL: final sukun |

### dad_vs_dal (ض د): ضَادْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dad_vs_dal-001 | ضِفْدَعْ | ضِفْدَع | ADDED TASHKEEL: final sukun; CONTAINS BOTH LETTERS OF THE PAIR: a teacher decides |
| dad_vs_dal-002 | ضَوْءْ | ضَوْء | ADDED TASHKEEL: final sukun |
| dad_vs_dal-003 | ضَيْفْ | ضَيْف | ADDED TASHKEEL: final sukun |
| dad_vs_dal-004 | ضَحِكْ | ضَحِك | ADDED TASHKEEL: final sukun |
| dad_vs_dal-005 | ضَعِيفْ | ضَعِيف | ADDED TASHKEEL: final sukun |
| dad_vs_dal-006 | ضَابِطْ | ضَابِط | ADDED TASHKEEL: final sukun |

### dal_vs_dad (ض د): دَالْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dal_vs_dad-001 | دُبّْ | دُبّ | ADDED TASHKEEL: final sukun |
| dal_vs_dad-002 | دَجَاجَةْ | دَجَاجَة | ADDED TASHKEEL: final sukun |
| dal_vs_dad-003 | دَلْوْ | دَلْو | ADDED TASHKEEL: final sukun |
| dal_vs_dad-004 | دَوَاءْ | دَوَاء | ADDED TASHKEEL: final sukun |
| dal_vs_dad-005 | دَفْتَرْ | دَفْتَر | ADDED TASHKEEL: final sukun |
| dal_vs_dad-006 | دُودَةْ | دُودَة | ADDED TASHKEEL: final sukun |

### ghain_vs_kha (غ خ): غَيْنْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ghain_vs_kha-001 | غَزَالْ | غَزَال | ADDED TASHKEEL: final sukun |
| ghain_vs_kha-002 | غَابَةْ | غَابَة | ADDED TASHKEEL: final sukun |
| ghain_vs_kha-003 | غُرَابْ | غُرَاب | ADDED TASHKEEL: final sukun |
| ghain_vs_kha-004 | غَيْمَةْ | غَيْمَة | ADDED TASHKEEL: final sukun |
| ghain_vs_kha-005 | غُرْفَةْ | غُرْفَة | ADDED TASHKEEL: final sukun |
| ghain_vs_kha-006 | غَنَمْ | غَنَم | ADDED TASHKEEL: final sukun |

### kha_vs_ghain (غ خ): خَاءْ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kha_vs_ghain-001 | خَرُوفْ | خَرُوف | ADDED TASHKEEL: final sukun |
| kha_vs_ghain-002 | خُبْزْ | خُبْز | ADDED TASHKEEL: final sukun |
| kha_vs_ghain-003 | خَيْمَةْ | خَيْمَة | ADDED TASHKEEL: final sukun |
| kha_vs_ghain-004 | خَاتَمْ | خَاتَم | ADDED TASHKEEL: final sukun |
| kha_vs_ghain-005 | خَشَبْ | خَشَب | ADDED TASHKEEL: final sukun |
| kha_vs_ghain-006 | خَيْلْ | خَيْل | ADDED TASHKEEL: final sukun |

