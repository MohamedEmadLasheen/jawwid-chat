# PD-29 P0-5: Arabic lesson 3 (the harakat), lines held for teacher review

This file is generated from `apps/lessons/src/arabic/lesson-003.json` and the rebuild's report. Do not edit it by hand.

- The lesson was rewritten as data from the old lesson (jawwid-lessons @ c231532, `arabic/lesson-3/lib/arabicData.ts`). The old lesson was read as text only, never built or run.
- Each unit is one letter carrying one haraka (بَ, بِ, بُ). A word belongs to a unit only if that letter carries that haraka somewhere in it; the checker proves this for every word and every quiz question, it is not a stored label.
- The file is **pending**: the lesson page shows nothing of it until the Teachers department approves it.
- A held line is never shown. A spelling held anywhere is held everywhere, and so is any quiz question that shows it.

## Summary

| | |
|---|---|
| Units | 83 |
| Words | 747 |
| Held | 729 |
| Clean (unchanged from the old lesson) | 18 |
| Kept with the lesson's vowel on the last letter (held) | 39 |
| Dropped: the letter does not carry the vowel | 89 |
| Dropped: an internal mark is missing | 4 |
| Units left out (no word passed) | 1 |
| Old duplicates removed | 0 |
| Quiz questions | 166 |

**Why words are held:**

- 624: ADDED TASHKEEL: final sukun
- 66: ADDED TASHKEEL: final vowel replaced by the pausal sukun
- 39: FINAL MARK EXCEPTION: the lesson's vowel on the last letter

Almost every hold is the one final mark, the pausal sukun, as in lesson 1. Teachers check each word, not the convention. Clearing a word means setting its `review` and `was` to null (and keeping `finalMarkException` where it is), in a reviewed commit.

## Decisions for the teachers

**One bulk decision first: the lesson's vowel on the last letter (39 words, e.g. كَتَبَ, قَرَأَ).** Everywhere else a word ends in the pausal sukun. These words would lose the very haraka the unit teaches if they did, so they keep their final vowel (`finalMarkException`). Confirm that this is how you want them shown; this one answer clears or changes them all at once. They are listed below.

1. **The words below.** Every word must be a real word, suitable for a child, spelled correctly and fully vowelled.
2. **Unit with no words: يِ (`ya_kasra`).** Please supply 5–10 words in which ي carries kasra, fully vowelled. No word from the old lesson passed (all were a nisba ـِي, whose ي does not carry the kasra), so the unit is not in the file until teachers supply its words. The rebuild invents none.
3. **The unit names** are the letter with its haraka, e.g. بَ. The hamza units use the seat: أَ, إِ, أُ, and count a word with any hamza (ء أ إ ؤ ئ) carrying the haraka.
4. **The quiz**: up to two questions per unit, built from the unit's own words.

## The lesson's vowel on the last letter (one bulk decision, held)

| Unit | Word |
|---|---|
| hamza_fatha | قَرَأَ |
| hamza_fatha | بَدَأَ |
| hamza_damma | يَقْرَأُ |
| ba_fatha | كَتَبَ |
| ba_fatha | لَعِبَ |
| ba_fatha | ذَهَبَ |
| ba_fatha | غَلَبَ |
| ta_fatha | بَيْتَ |
| tha_fatha | بَعَثَ |
| tha_fatha | حَدَثَ |
| jim_fatha | خَرَجَ |
| hha_fatha | فَتَحَ |
| kha_fatha | طَبَخَ |
| dal_fatha | وَجَدَ |
| dhal_fatha | أَخَذَ |
| dhal_fatha | نَفَذَ |
| ra_fatha | نَظَرَ |
| zay_fatha | فَازَ |
| sin_fatha | دَرَسَ |
| sin_fatha | جَلَسَ |
| shin_fatha | فَرَشَ |
| sad_fatha | رَقَصَ |
| dad_fatha | مَرِضَ |
| tta_fatha | سَقَطَ |
| tta_fatha | نَشَطَ |
| zza_fatha | لَفَظَ |
| ain_fatha | سَمِعَ |
| ghain_fatha | بَلَغَ |
| fa_fatha | عَرَفَ |
| qaf_fatha | سَبَقَ |
| qaf_fatha | حَقَّ |
| kaf_fatha | مَلَكَ |
| lam_fatha | أَكَلَ |
| mim_fatha | عَلِمَ |
| nun_fatha | حَزِنَ |
| nun_kasra | حَسَنِ |
| ha_fatha | وَجَهَ |
| waw_fatha | دَعَوَ |
| ya_fatha | هَدَيَ |

## Units left out

- **ya_kasra**: every old word was dropped (listed below under its unit).

## Dropped: the letter does not carry the vowel (not re-filed)

The old lesson listed these under a haraka their letter does not carry (for example a nisba ـِي listed as يِ). They are left out, as decided; a teacher adds a word back under the unit it really belongs to if wanted.

| Old unit | Word |
|---|---|
| ba_damma | مَكْتُوب |
| ba_damma | كُتُب |
| ba_damma | مَطْلُوب |
| ta_kasra | كِتَاب |
| ta_damma | بُيُوت |
| ta_damma | سُكُوت |
| ta_damma | صُمُوت |
| tha_kasra | حَدِيث |
| jim_damma | خُرُوج |
| hha_kasra | فَرِحَ |
| hha_damma | فُتُوح |
| dal_damma | وُجُود |
| dal_damma | جُنُود |
| dal_damma | سُجُود |
| dhal_kasra | تِلْمِيذ |
| dhal_damma | نُفُوذ |
| ra_kasra | صَغِير |
| ra_kasra | كَبِير |
| ra_damma | نُور |
| zay_damma | كُنُوز |
| zay_damma | رُمُوز |
| sin_kasra | جَلِيس |
| sin_kasra | رَئِيس |
| sin_damma | دُرُوس |
| sin_damma | جُلُوس |
| sin_damma | فُنُوس |
| shin_damma | فُرُوش |
| dad_damma | فُرُوض |
| tta_kasra | نَشِيط |
| tta_kasra | بَسِيط |
| tta_damma | سُقُوط |
| tta_damma | شُرُوط |
| zza_kasra | حَفِيظ |
| zza_kasra | غَلِيظ |
| zza_kasra | لَفِيظ |
| ain_kasra | رَبِيع |
| ain_kasra | سَمِيع |
| ain_kasra | بَدِيع |
| ain_damma | شُمُوع |
| ain_damma | دُمُوع |
| ain_damma | فُرُوع |
| ghain_kasra | بَلِيغ |
| ghain_kasra | فَرِيغ |
| ghain_damma | بُلُوغ |
| ghain_damma | فُرُوغ |
| fa_kasra | شَرِيف |
| fa_kasra | لَطِيف |
| fa_kasra | ظَرِيف |
| fa_damma | حُرُوف |
| fa_damma | ظُرُوف |
| fa_damma | سُقُوف |
| qaf_kasra | صَدِيق |
| qaf_kasra | طَرِيق |
| qaf_kasra | عَمِيق |
| qaf_kasra | رَفِيق |
| qaf_damma | طُرُق |
| qaf_damma | شُرُوق |
| kaf_kasra | مَالِك |
| kaf_kasra | شَرِيك |
| kaf_kasra | مُبَارِك |
| kaf_damma | سُلُوك |
| kaf_damma | مُلُوك |
| lam_kasra | جَمِيل |
| lam_damma | فُصُول |
| lam_damma | عُقُول |
| mim_fatha | عَمِلَ |
| mim_kasra | عَلِيم |
| mim_kasra | كَرِيم |
| mim_kasra | سَلِيم |
| mim_damma | عُلُوم |
| mim_damma | نُجُوم |
| mim_damma | رُسُوم |
| nun_kasra | أَمِين |
| nun_kasra | حَزِين |
| nun_kasra | ثَمِين |
| nun_damma | عُيُون |
| nun_damma | شُؤُون |
| ha_fatha | فَهِمَ |
| ha_damma | وُجُوه |
| waw_kasra | مُوَاطِن |
| ya_kasra | طَبِيعِي |
| ya_kasra | عَرَبِي |
| ya_kasra | إِسْلَامِي |
| ya_kasra | يَوْمِي |
| ya_kasra | عِلْمِي |
| ya_kasra | أَدَبِي |
| ya_kasra | رِيَاضِي |
| ya_kasra | تَارِيخِي |
| ya_kasra | مَدَنِي |

## Dropped: needs a teacher

| Old unit | Word | Why |
|---|---|---|
| hamza_kasra | إِنسَان | internal mark missing (letter 2 (ن)): needs a teacher |
| hamza_kasra | إِحسَان | internal mark missing (letter 2 (ح)): needs a teacher |
| kha_fatha | خَروف | internal mark missing (letter 2 (ر), letter 3 (و)): needs a teacher |
| ya_kasra | يِنَاير | internal mark missing (letter 4 (ي)): needs a teacher |

## The quiz, per unit

| Unit | Id | Kind | Question shows | Options | Right answer |
|---|---|---|---|---|---|
| hamza_fatha | hamza_fatha-q1 | which word has it | — | هُدْهُدْ، أَسَدْ، سُهُولْ | أَسَدْ |
| hamza_fatha | hamza_fatha-q2 | where is it | أَرْنَبْ | start / middle / end | start |
| hamza_kasra | hamza_kasra-q1 | which word has it | — | صُفُوفْ، سَفِينَةْ، إِبْرَةْ | إِبْرَةْ |
| hamza_kasra | hamza_kasra-q2 | where is it | سُئِلْ | start / middle / end | middle |
| hamza_damma | hamza_damma-q1 | which word has it | — | رَضَعْ، صُعُودْ، أُمّْ | أُمّْ |
| hamza_damma | hamza_damma-q2 | where is it | أُذُنْ | start / middle / end | start |
| ba_fatha | ba_fatha-q1 | which word has it | — | مَاءْ، بَحْرْ، مِفْتَاحْ | بَحْرْ |
| ba_fatha | ba_fatha-q2 | where is it | بَابْ | start / middle / end | start |
| ba_kasra | ba_kasra-q1 | which word has it | — | بِنْتْ، سُلْطَانْ، عَشَرَةْ | بِنْتْ |
| ba_kasra | ba_kasra-q2 | where is it | بِئْرْ | start / middle / end | start |
| ba_damma | ba_damma-q1 | which word has it | — | بُرْجْ، هُجُومْ، قَوَّةْ | بُرْجْ |
| ba_damma | ba_damma-q2 | where is it | بُسْتَانْ | start / middle / end | start |
| ta_fatha | ta_fatha-q1 | which word has it | — | تَمْرْ، غِنَاءْ، غِرَاسْ | تَمْرْ |
| ta_fatha | ta_fatha-q2 | where is it | تَاجْ | start / middle / end | start |
| ta_kasra | ta_kasra-q1 | which word has it | — | ذُخُورْ، ذِكْرْ، تِينْ | تِينْ |
| ta_kasra | ta_kasra-q2 | where is it | تِلْمِيذْ | start / middle / end | start |
| ta_damma | ta_damma-q1 | which word has it | — | تُرَابْ، فُلُوسْ، قَلْبْ | تُرَابْ |
| ta_damma | ta_damma-q2 | where is it | تُفَّاحْ | start / middle / end | start |
| tha_fatha | tha_fatha-q1 | which word has it | — | فَخِيمْ، دَاخِلْ، ثَعْلَبْ | ثَعْلَبْ |
| tha_fatha | tha_fatha-q2 | where is it | ثَوْبْ | start / middle / end | start |
| tha_kasra | tha_kasra-q1 | which word has it | — | دُنْيَا، ثِقَةْ، ذَيْلْ | ثِقَةْ |
| tha_kasra | tha_kasra-q2 | where is it | كَثِيرْ | start / middle / end | middle |
| tha_damma | tha_damma-q1 | which word has it | — | فَأْرْ، غُصُونْ، ثُلُثْ | ثُلُثْ |
| tha_damma | tha_damma-q2 | where is it | ثُعْبَانْ | start / middle / end | start |
| jim_fatha | jim_fatha-q1 | which word has it | — | شَكَرْ، جَمَلْ، كِفَاحْ | جَمَلْ |
| jim_fatha | jim_fatha-q2 | where is it | جَبَلْ | start / middle / end | start |
| jim_kasra | jim_kasra-q1 | which word has it | — | ذِهْنْ، نَفَذَ، جِدَارْ | جِدَارْ |
| jim_kasra | jim_kasra-q2 | where is it | رَجِيمْ | start / middle / end | middle |
| jim_damma | jim_damma-q1 | which word has it | — | شِرَاءْ، نَشَاطْ، جُبْنْ | جُبْنْ |
| jim_damma | jim_damma-q2 | where is it | جُنْدِي | start / middle / end | start |
| hha_fatha | hha_fatha-q1 | which word has it | — | أُنْشُودَةْ، إِلَى، حَصَانْ | حَصَانْ |
| hha_fatha | hha_fatha-q2 | where is it | حَلِيبْ | start / middle / end | start |
| hha_kasra | hha_kasra-q1 | which word has it | — | شِفَاءْ، شَتَاءْ، حِصَانْ | حِصَانْ |
| hha_kasra | hha_kasra-q2 | where is it | حِمَارْ | start / middle / end | start |
| hha_damma | hha_damma-q1 | which word has it | — | غِيَابْ، حُوتْ، غُبَارْ | حُوتْ |
| hha_damma | hha_damma-q2 | where is it | حُرِّيَّةْ | start / middle / end | start |
| kha_fatha | kha_fatha-q1 | which word has it | — | رُمَّانْ، خَبَزْ، رُكُوعْ | خَبَزْ |
| kha_fatha | kha_fatha-q2 | where is it | خَاتَمْ | start / middle / end | start |
| kha_kasra | kha_kasra-q1 | which word has it | — | نِدَاءْ، نَظَرْ، خِيَارْ | خِيَارْ |
| kha_kasra | kha_kasra-q2 | where is it | دَاخِلْ | start / middle / end | middle |
| kha_damma | kha_damma-q1 | which word has it | — | خُبْزْ، طِوَالْ، طُبُولْ | خُبْزْ |
| kha_damma | kha_damma-q2 | where is it | خُطُوطْ | start / middle / end | start |
| dal_fatha | dal_fatha-q1 | which word has it | — | فَقَدْ، دَجَاجَةْ، قِطَّةْ | دَجَاجَةْ |
| dal_fatha | dal_fatha-q2 | where is it | دَارْ | start / middle / end | start |
| dal_kasra | dal_kasra-q1 | which word has it | — | سَبَقَ، دِيكْ، قِرَاءَةْ | دِيكْ |
| dal_kasra | dal_kasra-q2 | where is it | دِينْ | start / middle / end | start |
| dal_damma | dal_damma-q1 | which word has it | — | ضَيْفْ، صُمُودْ، دُبّْ | دُبّْ |
| dal_damma | dal_damma-q2 | where is it | دُرُوسْ | start / middle / end | start |
| dhal_fatha | dhal_fatha-q1 | which word has it | — | صَقْرْ، شُمُوعْ، ذَهَبْ | ذَهَبْ |
| dhal_fatha | dhal_fatha-q2 | where is it | ذَكَرْ | start / middle / end | start |
| dhal_kasra | dhal_kasra-q1 | which word has it | — | ذِئْبْ، وُجُوهْ، حَيَاةْ | ذِئْبْ |
| dhal_kasra | dhal_kasra-q2 | where is it | ذِرَاعْ | start / middle / end | start |
| dhal_damma | dhal_damma-q1 | which word has it | — | ذُرَةْ، نِسَاءْ، نُقُودْ | ذُرَةْ |
| dhal_damma | dhal_damma-q2 | where is it | ذُبَابْ | start / middle / end | start |
| ra_fatha | ra_fatha-q1 | which word has it | — | ضُحَى، رَجُلْ، مَرْضُوضْ | رَجُلْ |
| ra_fatha | ra_fatha-q2 | where is it | رَأْسْ | start / middle / end | start |
| ra_kasra | ra_kasra-q1 | which word has it | — | وِسَامْ، رِسَالَةْ، وُضُوءْ | رِسَالَةْ |
| ra_kasra | ra_kasra-q2 | where is it | رِجَالْ | start / middle / end | start |
| ra_damma | ra_damma-q1 | which word has it | — | حُقُوقْ، رُمَّانْ، كَتَبْ | رُمَّانْ |
| ra_damma | ra_damma-q2 | where is it | رُكْبَةْ | start / middle / end | start |
| zay_fatha | zay_fatha-q1 | which word has it | — | حُثُوثْ، ثِنَاءْ، زَهْرَةْ | زَهْرَةْ |
| zay_fatha | zay_fatha-q2 | where is it | زَرَافَةْ | start / middle / end | start |
| zay_kasra | zay_kasra-q1 | which word has it | — | زِرَاعَةْ، لَعِبْ، سَلَامْ | زِرَاعَةْ |
| zay_kasra | zay_kasra-q2 | where is it | زِينَةْ | start / middle / end | start |
| zay_damma | zay_damma-q1 | which word has it | — | عِبَادَةْ، زُجَاجْ، عُقُولْ | زُجَاجْ |
| zay_damma | zay_damma-q2 | where is it | زُهُورْ | start / middle / end | start |
| sin_fatha | sin_fatha-q1 | which word has it | — | عِلْمْ، سَمَكَةْ، عُلُومْ | سَمَكَةْ |
| sin_fatha | sin_fatha-q2 | where is it | سَمَاءْ | start / middle / end | start |
| sin_kasra | sin_kasra-q1 | which word has it | — | دَجَاجَةْ، سِتَّةْ، دَوَاءْ | سِتَّةْ |
| sin_kasra | sin_kasra-q2 | where is it | سِرّْ | start / middle / end | start |
| sin_damma | sin_damma-q1 | which word has it | — | ظُلْمْ، نَظِيفْ، سُوقْ | سُوقْ |
| sin_damma | sin_damma-q2 | where is it | سُكَّرْ | start / middle / end | start |
| shin_fatha | shin_fatha-q1 | which word has it | — | كُتُبْ، شَمْسْ، لَعِبْ | شَمْسْ |
| shin_fatha | shin_fatha-q2 | where is it | شَجَرَةْ | start / middle / end | start |
| shin_kasra | shin_kasra-q1 | which word has it | — | شِتَاءْ، رِسَالَةْ، رِفْقْ | شِتَاءْ |
| shin_kasra | shin_kasra-q2 | where is it | شِعْرْ | start / middle / end | start |
| shin_damma | shin_damma-q1 | which word has it | — | حُلْمْ، حِسَابْ، شُرْطَةْ | شُرْطَةْ |
| shin_damma | shin_damma-q2 | where is it | شُكْرْ | start / middle / end | start |
| sad_fatha | sad_fatha-q1 | which word has it | — | صَقْرْ، سُكَّرْ، شَجَرَةْ | صَقْرْ |
| sad_fatha | sad_fatha-q2 | where is it | صَبَاحْ | start / middle / end | start |
| sad_kasra | sad_kasra-q1 | which word has it | — | دَلِيلْ، دَرْسْ، صِغَرْ | صِغَرْ |
| sad_kasra | sad_kasra-q2 | where is it | صِدْقْ | start / middle / end | start |
| sad_damma | sad_damma-q1 | which word has it | — | هُنَا، صُنْدُوقْ، وَقْتْ | صُنْدُوقْ |
| sad_damma | sad_damma-q2 | where is it | صُورَةْ | start / middle / end | start |
| dad_fatha | dad_fatha-q1 | which word has it | — | تَرَكْ، تَمْرْ، ضَفْدَعْ | ضَفْدَعْ |
| dad_fatha | dad_fatha-q2 | where is it | ضَوْءْ | start / middle / end | start |
| dad_kasra | dad_kasra-q1 | which word has it | — | صِغَرْ، قَصَدْ، ضِفَافْ | ضِفَافْ |
| dad_kasra | dad_kasra-q2 | where is it | رَاضِي | start / middle / end | middle |
| dad_damma | dad_damma-q1 | which word has it | — | زُهْدْ، زِحَامْ، ضُحَى | ضُحَى |
| dad_damma | dad_damma-q2 | where is it | ضُيُوفْ | start / middle / end | start |
| tta_fatha | tta_fatha-q1 | which word has it | — | طَائِرَةْ، قَدِيمْ، دُرُوسْ | طَائِرَةْ |
| tta_fatha | tta_fatha-q2 | where is it | طَبِيبْ | start / middle / end | start |
| tta_kasra | tta_kasra-q1 | which word has it | — | حَكَمْ، طِفْلْ، كِبَارْ | طِفْلْ |
| tta_kasra | tta_kasra-q2 | where is it | طِينْ | start / middle / end | start |
| tta_damma | tta_damma-q1 | which word has it | — | ذُكُورْ، حَذِرْ، طُيُورْ | طُيُورْ |
| tta_damma | tta_damma-q2 | where is it | طُفُولَةْ | start / middle / end | start |
| zza_fatha | zza_fatha-q1 | which word has it | — | غِطَاءْ، ظَرْفْ، غُرْفَةْ | ظَرْفْ |
| zza_fatha | zza_fatha-q2 | where is it | ظَبْيْ | start / middle / end | start |
| zza_kasra | zza_kasra-q1 | which word has it | — | لُعْبَةْ، ظِلّْ، مَسْجِدْ | ظِلّْ |
| zza_kasra | zza_kasra-q2 | where is it | نَظِيفْ | start / middle / end | middle |
| zza_damma | zza_damma-q1 | which word has it | — | ظُهْرْ، عِطْرْ، عُيُونْ | ظُهْرْ |
| zza_damma | zza_damma-q2 | where is it | ظُلْمْ | start / middle / end | start |
| ain_fatha | ain_fatha-q1 | which word has it | — | نَشَطَ، عَيْنْ، طِوَالْ | عَيْنْ |
| ain_fatha | ain_fatha-q2 | where is it | عَسَلْ | start / middle / end | start |
| ain_kasra | ain_kasra-q1 | which word has it | — | عِلْمْ، كَبِيرْ، جَبِينْ | عِلْمْ |
| ain_kasra | ain_kasra-q2 | where is it | عِنَبْ | start / middle / end | start |
| ain_damma | ain_damma-q1 | which word has it | — | عُصْفُورْ، خَاتَمْ، خَطَأْ | عُصْفُورْ |
| ain_damma | ain_damma-q2 | where is it | عُلُومْ | start / middle / end | start |
| ghain_fatha | ghain_fatha-q1 | which word has it | — | شُرْطَةْ، غَزَالْ، شُعُورْ | غَزَالْ |
| ghain_fatha | ghain_fatha-q2 | where is it | غَابَةْ | start / middle / end | start |
| ghain_kasra | ghain_kasra-q1 | which word has it | — | غِنَاءْ، حَزِنَ، حَسَنِ | غِنَاءْ |
| ghain_kasra | ghain_kasra-q2 | where is it | صَغِيرْ | start / middle / end | middle |
| ghain_damma | ghain_damma-q1 | which word has it | — | زَرَافَةْ، رُوحْ، غُرَابْ | غُرَابْ |
| ghain_damma | ghain_damma-q2 | where is it | غُرْفَةْ | start / middle / end | start |
| fa_fatha | fa_fatha-q1 | which word has it | — | حَجَرْ، سُجُودْ، فَرَاشَةْ | فَرَاشَةْ |
| fa_fatha | fa_fatha-q2 | where is it | فَأْرْ | start / middle / end | start |
| fa_kasra | fa_kasra-q1 | which word has it | — | ظَاهِرْ، نَهَرْ، فِيلْ | فِيلْ |
| fa_kasra | fa_kasra-q2 | where is it | فِضَّةْ | start / middle / end | start |
| fa_damma | fa_damma-q1 | which word has it | — | كِنَايَةْ، كَوْكَبْ، فُولْ | فُولْ |
| fa_damma | fa_damma-q2 | where is it | فُسْتَانْ | start / middle / end | start |
| qaf_fatha | qaf_fatha-q1 | which word has it | — | خُصُومْ، قَمَرْ، وَجَدَ | قَمَرْ |
| qaf_fatha | qaf_fatha-q2 | where is it | قَلَمْ | start / middle / end | start |
| qaf_kasra | qaf_kasra-q1 | which word has it | — | حَسَنِ، قِرْدْ، فُنُونْ | قِرْدْ |
| qaf_kasra | qaf_kasra-q2 | where is it | قِطَّةْ | start / middle / end | start |
| qaf_damma | qaf_damma-q1 | which word has it | — | قُرْآنْ، ضَمِيرْ، رَضِيعْ | قُرْآنْ |
| qaf_damma | qaf_damma-q2 | where is it | قُوَّةْ | start / middle / end | start |
| kaf_fatha | kaf_fatha-q1 | which word has it | — | حَصِيدْ، صَحْرَاءْ، كَلْبْ | كَلْبْ |
| kaf_fatha | kaf_fatha-q2 | where is it | كَتَبْ | start / middle / end | start |
| kaf_kasra | kaf_kasra-q1 | which word has it | — | كِتَابْ، مِلْحْ، مُدِيرْ | كِتَابْ |
| kaf_kasra | kaf_kasra-q2 | where is it | كِبَارْ | start / middle / end | start |
| kaf_damma | kaf_damma-q1 | which word has it | — | لُطْفْ، كُرَةْ، جَمَلْ | كُرَةْ |
| kaf_damma | kaf_damma-q2 | where is it | كُوبْ | start / middle / end | start |
| lam_fatha | lam_fatha-q1 | which word has it | — | حَمَامْ، لَيْمُونْ، حِكْمَةْ | لَيْمُونْ |
| lam_fatha | lam_fatha-q2 | where is it | لَعِبْ | start / middle / end | start |
| lam_kasra | lam_kasra-q1 | which word has it | — | لِسَانْ، كِبَارْ، كُوبْ | لِسَانْ |
| lam_kasra | lam_kasra-q2 | where is it | لِبَاسْ | start / middle / end | start |
| lam_damma | lam_damma-q1 | which word has it | — | لُؤْلُؤْ، وَلَدْ، سَوَاءْ | لُؤْلُؤْ |
| lam_damma | lam_damma-q2 | where is it | عُلُومْ | start / middle / end | middle |
| mim_fatha | mim_fatha-q1 | which word has it | — | حَيَاةْ، مَدْرَسَةْ، يُوسُفْ | مَدْرَسَةْ |
| mim_fatha | mim_fatha-q2 | where is it | مَاءْ | start / middle / end | start |
| mim_kasra | mim_kasra-q1 | which word has it | — | وَصَلْ، وَطَنْ، مِفْتَاحْ | مِفْتَاحْ |
| mim_kasra | mim_kasra-q2 | where is it | مِصْرْ | start / middle / end | start |
| mim_damma | mim_damma-q1 | which word has it | — | مُعَلِّمْ، عِطْرْ، عُيُونْ | مُعَلِّمْ |
| mim_damma | mim_damma-q2 | where is it | مُسْلِمْ | start / middle / end | start |
| nun_fatha | nun_fatha-q1 | which word has it | — | قَلَمْ، فُسْتَانْ، نَحْلَةْ | نَحْلَةْ |
| nun_fatha | nun_fatha-q2 | where is it | نَجْمْ | start / middle / end | start |
| nun_kasra | nun_kasra-q1 | which word has it | — | كَلْبْ، قُوَّةْ، نِعْمَةْ | نِعْمَةْ |
| nun_kasra | nun_kasra-q2 | where is it | نِظَامْ | start / middle / end | start |
| nun_damma | nun_damma-q1 | which word has it | — | نُورْ، فَصْلْ، فِدَاءْ | نُورْ |
| nun_damma | nun_damma-q2 | where is it | نُجُومْ | start / middle / end | start |
| ha_fatha | ha_fatha-q1 | which word has it | — | مَثَلْ، هَدِيَّةْ، كَثِيرْ | هَدِيَّةْ |
| ha_fatha | ha_fatha-q2 | where is it | هَوَاءْ | start / middle / end | start |
| ha_kasra | ha_kasra-q1 | which word has it | — | طَبِيبْ، هِلَالْ، نَشَطَ | هِلَالْ |
| ha_kasra | ha_kasra-q2 | where is it | فَاهِمْ | start / middle / end | middle |
| ha_damma | ha_damma-q1 | which word has it | — | يَسَارْ، يَدْ، هُدْهُدْ | هُدْهُدْ |
| ha_damma | ha_damma-q2 | where is it | شُهُورْ | start / middle / end | middle |
| waw_fatha | waw_fatha-q1 | which word has it | — | وَرْدَةْ، ضَيْفْ، ضِيَاءْ | وَرْدَةْ |
| waw_fatha | waw_fatha-q2 | where is it | وَلَدْ | start / middle / end | start |
| waw_kasra | waw_kasra-q1 | which word has it | — | وِسَادَةْ، رِحْلَةْ، حُرُوفْ | وِسَادَةْ |
| waw_kasra | waw_kasra-q2 | where is it | وِلَادَةْ | start / middle / end | start |
| waw_damma | waw_damma-q1 | which word has it | — | كَنْزْ، وُجُودْ، كِرَامْ | وُجُودْ |
| waw_damma | waw_damma-q2 | where is it | وُرُودْ | start / middle / end | start |
| ya_fatha | ya_fatha-q1 | which word has it | — | دِفَاعْ، يَدْ، دُبّْ | يَدْ |
| ya_fatha | ya_fatha-q2 | where is it | يَوْمْ | start / middle / end | start |
| ya_damma | ya_damma-q1 | which word has it | — | زَهْرَةْ، يُونُسْ، زَبَدْ | يُونُسْ |
| ya_damma | ya_damma-q2 | where is it | يُوسُفْ | start / middle / end | start |

## Every word, per unit

`was` is the old spelling where the rebuild changed it. A held word shows why it is held.

### hamza_fatha: أَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| hamza_fatha-001 | أَسَدْ | أَسَد | ADDED TASHKEEL: final sukun |
| hamza_fatha-002 | أَرْنَبْ | أَرْنَب | ADDED TASHKEEL: final sukun |
| hamza_fatha-003 | أَكَلْ | أَكَلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| hamza_fatha-004 | سَأَلْ | سَأَلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| hamza_fatha-005 | قَرَأَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| hamza_fatha-006 | أَمَلْ | أَمَل | ADDED TASHKEEL: final sukun |
| hamza_fatha-007 | أَخَذْ | أَخَذَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| hamza_fatha-008 | بَدَأَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| hamza_fatha-009 | أَحَدْ | أَحَد | ADDED TASHKEEL: final sukun |
| hamza_fatha-010 | أَبَدْ | أَبَد | ADDED TASHKEEL: final sukun |

### hamza_kasra: إِ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| hamza_kasra-001 | إِبْرَةْ | إِبْرَة | ADDED TASHKEEL: final sukun |
| hamza_kasra-002 | سُئِلْ | سُئِلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| hamza_kasra-003 | إِسْلَامْ | إِسْلَام | ADDED TASHKEEL: final sukun |
| hamza_kasra-004 | إِيمَانْ | إِيمَان | ADDED TASHKEEL: final sukun |
| hamza_kasra-005 | رُئِيْ | رُئِيَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| hamza_kasra-006 | إِمَامْ | إِمَام | ADDED TASHKEEL: final sukun |
| hamza_kasra-007 | إِذَا | — | — |
| hamza_kasra-008 | إِلَى | — | — |

### hamza_damma: أُ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| hamza_damma-001 | أُمّْ | أُمّ | ADDED TASHKEEL: final sukun |
| hamza_damma-002 | أُذُنْ | أُذُن | ADDED TASHKEEL: final sukun |
| hamza_damma-003 | أُسْرَةْ | أُسْرَة | ADDED TASHKEEL: final sukun |
| hamza_damma-004 | أُخْتْ | أُخْت | ADDED TASHKEEL: final sukun |
| hamza_damma-005 | يَقْرَأُ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| hamza_damma-006 | أُفُقْ | أُفُق | ADDED TASHKEEL: final sukun |
| hamza_damma-007 | أُرْجُوحَةْ | أُرْجُوحَة | ADDED TASHKEEL: final sukun |
| hamza_damma-008 | أُنْشُودَةْ | أُنْشُودَة | ADDED TASHKEEL: final sukun |
| hamza_damma-009 | أُسْتَاذْ | أُسْتَاذ | ADDED TASHKEEL: final sukun |
| hamza_damma-010 | أُمَّةْ | أُمَّة | ADDED TASHKEEL: final sukun |

### ba_fatha: بَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ba_fatha-001 | بَحْرْ | بَحْر | ADDED TASHKEEL: final sukun |
| ba_fatha-002 | بَابْ | بَاب | ADDED TASHKEEL: final sukun |
| ba_fatha-003 | بَدْرْ | بَدْر | ADDED TASHKEEL: final sukun |
| ba_fatha-004 | كَتَبَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| ba_fatha-005 | سَبَبْ | سَبَب | ADDED TASHKEEL: final sukun |
| ba_fatha-006 | جَبَلْ | جَبَل | ADDED TASHKEEL: final sukun |
| ba_fatha-007 | لَعِبَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| ba_fatha-008 | ذَهَبَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| ba_fatha-009 | غَلَبَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| ba_fatha-010 | بَطَلْ | بَطَل | ADDED TASHKEEL: final sukun |

### ba_kasra: بِ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ba_kasra-001 | بِنْتْ | بِنْت | ADDED TASHKEEL: final sukun |
| ba_kasra-002 | بِئْرْ | بِئْر | ADDED TASHKEEL: final sukun |
| ba_kasra-003 | كَبِيرْ | كَبِير | ADDED TASHKEEL: final sukun |
| ba_kasra-004 | حَبِيبْ | حَبِيب | ADDED TASHKEEL: final sukun |
| ba_kasra-005 | سَبِيلْ | سَبِيل | ADDED TASHKEEL: final sukun |
| ba_kasra-006 | بِسَاطْ | بِسَاط | ADDED TASHKEEL: final sukun |
| ba_kasra-007 | بِدَايَةْ | بِدَايَة | ADDED TASHKEEL: final sukun |
| ba_kasra-008 | رَبِيعْ | رَبِيع | ADDED TASHKEEL: final sukun |
| ba_kasra-009 | بِلَادْ | بِلَاد | ADDED TASHKEEL: final sukun |
| ba_kasra-010 | جَبِينْ | جَبِين | ADDED TASHKEEL: final sukun |

### ba_damma: بُ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ba_damma-001 | بُرْجْ | بُرْج | ADDED TASHKEEL: final sukun |
| ba_damma-002 | بُسْتَانْ | بُسْتَان | ADDED TASHKEEL: final sukun |
| ba_damma-003 | بُرْتُقَالْ | بُرْتُقَال | ADDED TASHKEEL: final sukun |
| ba_damma-004 | بُومَةْ | بُومَة | ADDED TASHKEEL: final sukun |
| ba_damma-005 | مَحْبُوبْ | مَحْبُوب | ADDED TASHKEEL: final sukun |
| ba_damma-006 | بُطُولْ | بُطُول | ADDED TASHKEEL: final sukun |
| ba_damma-007 | بُنْدُقْ | بُنْدُق | ADDED TASHKEEL: final sukun |

### ta_fatha: تَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ta_fatha-001 | تَمْرْ | تَمْر | ADDED TASHKEEL: final sukun |
| ta_fatha-002 | تَاجْ | تَاج | ADDED TASHKEEL: final sukun |
| ta_fatha-003 | تَفَّاحْ | تَفَّاح | ADDED TASHKEEL: final sukun |
| ta_fatha-004 | كَتَبْ | كَتَبَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ta_fatha-005 | فَتَحْ | فَتَحَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ta_fatha-006 | بَيْتَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| ta_fatha-007 | تَعَلَّمْ | تَعَلَّمَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ta_fatha-008 | تَرَكْ | تَرَكَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ta_fatha-009 | مَتَى | — | — |
| ta_fatha-010 | تَمَامْ | تَمَام | ADDED TASHKEEL: final sukun |

### ta_kasra: تِ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ta_kasra-001 | تِينْ | تِين | ADDED TASHKEEL: final sukun |
| ta_kasra-002 | تِلْمِيذْ | تِلْمِيذ | ADDED TASHKEEL: final sukun |
| ta_kasra-003 | تِسْعَةْ | تِسْعَة | ADDED TASHKEEL: final sukun |
| ta_kasra-004 | فَتِيلْ | فَتِيل | ADDED TASHKEEL: final sukun |
| ta_kasra-005 | تِجَارَةْ | تِجَارَة | ADDED TASHKEEL: final sukun |
| ta_kasra-006 | مُتِيمْ | مُتِيم | ADDED TASHKEEL: final sukun |
| ta_kasra-007 | تِبْرْ | تِبْر | ADDED TASHKEEL: final sukun |
| ta_kasra-008 | حَتِّى | — | — |
| ta_kasra-009 | تِمْثَالْ | تِمْثَال | ADDED TASHKEEL: final sukun |

### ta_damma: تُ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ta_damma-001 | تُرَابْ | تُرَاب | ADDED TASHKEEL: final sukun |
| ta_damma-002 | تُفَّاحْ | تُفَّاح | ADDED TASHKEEL: final sukun |
| ta_damma-003 | كُتُبْ | كُتُب | ADDED TASHKEEL: final sukun |
| ta_damma-004 | تُحْفَةْ | تُحْفَة | ADDED TASHKEEL: final sukun |
| ta_damma-005 | تُوتْ | تُوت | ADDED TASHKEEL: final sukun |
| ta_damma-006 | تُرْسْ | تُرْس | ADDED TASHKEEL: final sukun |
| ta_damma-007 | تُمْسَاحْ | تُمْسَاح | ADDED TASHKEEL: final sukun |

### tha_fatha: ثَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| tha_fatha-001 | ثَعْلَبْ | ثَعْلَب | ADDED TASHKEEL: final sukun |
| tha_fatha-002 | ثَوْبْ | ثَوْب | ADDED TASHKEEL: final sukun |
| tha_fatha-003 | ثَلْجْ | ثَلْج | ADDED TASHKEEL: final sukun |
| tha_fatha-004 | كَثَرْ | كَثَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| tha_fatha-005 | مَثَلْ | مَثَل | ADDED TASHKEEL: final sukun |
| tha_fatha-006 | بَعَثَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| tha_fatha-007 | ثَمَرْ | ثَمَر | ADDED TASHKEEL: final sukun |
| tha_fatha-008 | ثَابِتْ | ثَابِت | ADDED TASHKEEL: final sukun |
| tha_fatha-009 | حَدَثَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| tha_fatha-010 | ثَلَاثَةْ | ثَلَاثَة | ADDED TASHKEEL: final sukun |

### tha_kasra: ثِ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| tha_kasra-001 | ثِقَةْ | ثِقَة | ADDED TASHKEEL: final sukun |
| tha_kasra-002 | كَثِيرْ | كَثِير | ADDED TASHKEEL: final sukun |
| tha_kasra-003 | ثِمَارْ | ثِمَار | ADDED TASHKEEL: final sukun |
| tha_kasra-004 | أَثِيمْ | أَثِيم | ADDED TASHKEEL: final sukun |
| tha_kasra-005 | ثِيَابْ | ثِيَاب | ADDED TASHKEEL: final sukun |
| tha_kasra-006 | مَثِيلْ | مَثِيل | ADDED TASHKEEL: final sukun |
| tha_kasra-007 | ثِقَلْ | ثِقَل | ADDED TASHKEEL: final sukun |
| tha_kasra-008 | حَثِيثْ | حَثِيث | ADDED TASHKEEL: final sukun |
| tha_kasra-009 | ثِنَاءْ | ثِنَاء | ADDED TASHKEEL: final sukun |

### tha_damma: ثُ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| tha_damma-001 | ثُلُثْ | ثُلُث | ADDED TASHKEEL: final sukun |
| tha_damma-002 | ثُعْبَانْ | ثُعْبَان | ADDED TASHKEEL: final sukun |
| tha_damma-003 | ثُومْ | ثُوم | ADDED TASHKEEL: final sukun |
| tha_damma-004 | مَبْثُوثْ | مَبْثُوث | ADDED TASHKEEL: final sukun |
| tha_damma-005 | ثُلَاثَاءْ | ثُلَاثَاء | ADDED TASHKEEL: final sukun |
| tha_damma-006 | ثُمّْ | ثُمَّ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| tha_damma-007 | حُثُوثْ | حُثُوث | ADDED TASHKEEL: final sukun |
| tha_damma-008 | بُثُورْ | بُثُور | ADDED TASHKEEL: final sukun |
| tha_damma-009 | ثُبُوتْ | ثُبُوت | ADDED TASHKEEL: final sukun |
| tha_damma-010 | ثُرَيَّا | — | — |

### jim_fatha: جَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| jim_fatha-001 | جَمَلْ | جَمَل | ADDED TASHKEEL: final sukun |
| jim_fatha-002 | جَبَلْ | جَبَل | ADDED TASHKEEL: final sukun |
| jim_fatha-003 | جَنَّةْ | جَنَّة | ADDED TASHKEEL: final sukun |
| jim_fatha-004 | رَجَعْ | رَجَعَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| jim_fatha-005 | نَجَحْ | نَجَحَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| jim_fatha-006 | خَرَجَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| jim_fatha-007 | جَدِيدْ | جَدِيد | ADDED TASHKEEL: final sukun |
| jim_fatha-008 | جَمِيلْ | جَمِيل | ADDED TASHKEEL: final sukun |
| jim_fatha-009 | عَجَبْ | عَجَب | ADDED TASHKEEL: final sukun |
| jim_fatha-010 | جَرَسْ | جَرَس | ADDED TASHKEEL: final sukun |

### jim_kasra: جِ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| jim_kasra-001 | جِدَارْ | جِدَار | ADDED TASHKEEL: final sukun |
| jim_kasra-002 | رَجِيمْ | رَجِيم | ADDED TASHKEEL: final sukun |
| jim_kasra-003 | نَجِيبْ | نَجِيب | ADDED TASHKEEL: final sukun |
| jim_kasra-004 | جِسْمْ | جِسْم | ADDED TASHKEEL: final sukun |
| jim_kasra-005 | جِلْدْ | جِلْد | ADDED TASHKEEL: final sukun |
| jim_kasra-006 | سَجِينْ | سَجِين | ADDED TASHKEEL: final sukun |
| jim_kasra-007 | جِهَادْ | جِهَاد | ADDED TASHKEEL: final sukun |
| jim_kasra-008 | عَجِيبْ | عَجِيب | ADDED TASHKEEL: final sukun |
| jim_kasra-009 | جِرَاحْ | جِرَاح | ADDED TASHKEEL: final sukun |
| jim_kasra-010 | مَسْجِدْ | مَسْجِد | ADDED TASHKEEL: final sukun |

### jim_damma: جُ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| jim_damma-001 | جُبْنْ | جُبْن | ADDED TASHKEEL: final sukun |
| jim_damma-002 | جُنْدِي | — | — |
| jim_damma-003 | جُمْلَةْ | جُمْلَة | ADDED TASHKEEL: final sukun |
| jim_damma-004 | نُجُومْ | نُجُوم | ADDED TASHKEEL: final sukun |
| jim_damma-005 | جُزْءْ | جُزْء | ADDED TASHKEEL: final sukun |
| jim_damma-006 | وُجُودْ | وُجُود | ADDED TASHKEEL: final sukun |
| jim_damma-007 | جُمُعَةْ | جُمُعَة | ADDED TASHKEEL: final sukun |
| jim_damma-008 | سُجُودْ | سُجُود | ADDED TASHKEEL: final sukun |
| jim_damma-009 | جُنُونْ | جُنُون | ADDED TASHKEEL: final sukun |

### hha_fatha: حَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| hha_fatha-001 | حَصَانْ | حَصَان | ADDED TASHKEEL: final sukun |
| hha_fatha-002 | حَلِيبْ | حَلِيب | ADDED TASHKEEL: final sukun |
| hha_fatha-003 | حَدِيقَةْ | حَدِيقَة | ADDED TASHKEEL: final sukun |
| hha_fatha-004 | فَحَصْ | فَحَصَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| hha_fatha-005 | بَحَرْ | بَحَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| hha_fatha-006 | فَتَحَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| hha_fatha-007 | حَمَامْ | حَمَام | ADDED TASHKEEL: final sukun |
| hha_fatha-008 | حَجَرْ | حَجَر | ADDED TASHKEEL: final sukun |
| hha_fatha-009 | سَحَابَةْ | سَحَابَة | ADDED TASHKEEL: final sukun |
| hha_fatha-010 | حَبَلْ | حَبَل | ADDED TASHKEEL: final sukun |

### hha_kasra: حِ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| hha_kasra-001 | حِصَانْ | حِصَان | ADDED TASHKEEL: final sukun |
| hha_kasra-002 | حِمَارْ | حِمَار | ADDED TASHKEEL: final sukun |
| hha_kasra-003 | رَحِيمْ | رَحِيم | ADDED TASHKEEL: final sukun |
| hha_kasra-004 | حِكْمَةْ | حِكْمَة | ADDED TASHKEEL: final sukun |
| hha_kasra-005 | حِسَابْ | حِسَاب | ADDED TASHKEEL: final sukun |
| hha_kasra-006 | حِوَارْ | حِوَار | ADDED TASHKEEL: final sukun |
| hha_kasra-007 | حِينْ | حِين | ADDED TASHKEEL: final sukun |
| hha_kasra-008 | صَحِيحْ | صَحِيح | ADDED TASHKEEL: final sukun |
| hha_kasra-009 | حِفْظْ | حِفْظ | ADDED TASHKEEL: final sukun |

### hha_damma: حُ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| hha_damma-001 | حُوتْ | حُوت | ADDED TASHKEEL: final sukun |
| hha_damma-002 | حُرِّيَّةْ | حُرِّيَّة | ADDED TASHKEEL: final sukun |
| hha_damma-003 | حُلْمْ | حُلْم | ADDED TASHKEEL: final sukun |
| hha_damma-004 | حُبّْ | حُبّ | ADDED TASHKEEL: final sukun |
| hha_damma-005 | حُرُوفْ | حُرُوف | ADDED TASHKEEL: final sukun |
| hha_damma-006 | حُضُورْ | حُضُور | ADDED TASHKEEL: final sukun |
| hha_damma-007 | حُقُوقْ | حُقُوق | ADDED TASHKEEL: final sukun |
| hha_damma-008 | رُحُومْ | رُحُوم | ADDED TASHKEEL: final sukun |
| hha_damma-009 | حُسُونْ | حُسُون | ADDED TASHKEEL: final sukun |

### kha_fatha: خَ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kha_fatha-001 | خَبَزْ | خَبَز | ADDED TASHKEEL: final sukun |
| kha_fatha-002 | خَاتَمْ | خَاتَم | ADDED TASHKEEL: final sukun |
| kha_fatha-003 | دَخَلْ | دَخَلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| kha_fatha-004 | نَخَلْ | نَخَلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| kha_fatha-005 | طَبَخَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| kha_fatha-006 | خَيْمَةْ | خَيْمَة | ADDED TASHKEEL: final sukun |
| kha_fatha-007 | خَشَبْ | خَشَب | ADDED TASHKEEL: final sukun |
| kha_fatha-008 | أَخَذْ | أَخَذَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| kha_fatha-009 | خَطَأْ | خَطَأ | ADDED TASHKEEL: final sukun |

### kha_kasra: خِ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kha_kasra-001 | خِيَارْ | خِيَار | ADDED TASHKEEL: final sukun |
| kha_kasra-002 | دَاخِلْ | دَاخِل | ADDED TASHKEEL: final sukun |
| kha_kasra-003 | خِدْمَةْ | خِدْمَة | ADDED TASHKEEL: final sukun |
| kha_kasra-004 | خِلَافْ | خِلَاف | ADDED TASHKEEL: final sukun |
| kha_kasra-005 | نَخِيلْ | نَخِيل | ADDED TASHKEEL: final sukun |
| kha_kasra-006 | خِطَابْ | خِطَاب | ADDED TASHKEEL: final sukun |
| kha_kasra-007 | أَخِيرْ | أَخِير | ADDED TASHKEEL: final sukun |
| kha_kasra-008 | خِبْرَةْ | خِبْرَة | ADDED TASHKEEL: final sukun |
| kha_kasra-009 | فَخِيمْ | فَخِيم | ADDED TASHKEEL: final sukun |
| kha_kasra-010 | خِزَانَةْ | خِزَانَة | ADDED TASHKEEL: final sukun |

### kha_damma: خُ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kha_damma-001 | خُبْزْ | خُبْز | ADDED TASHKEEL: final sukun |
| kha_damma-002 | خُطُوطْ | خُطُوط | ADDED TASHKEEL: final sukun |
| kha_damma-003 | دُخُولْ | دُخُول | ADDED TASHKEEL: final sukun |
| kha_damma-004 | خُضَارْ | خُضَار | ADDED TASHKEEL: final sukun |
| kha_damma-005 | خُلُقْ | خُلُق | ADDED TASHKEEL: final sukun |
| kha_damma-006 | خُطُوةْ | خُطُوة | ADDED TASHKEEL: final sukun |
| kha_damma-007 | نُخُوتْ | نُخُوت | ADDED TASHKEEL: final sukun |
| kha_damma-008 | خُصُومْ | خُصُوم | ADDED TASHKEEL: final sukun |
| kha_damma-009 | خُرُوجْ | خُرُوج | ADDED TASHKEEL: final sukun |
| kha_damma-010 | خُطَبْ | خُطَب | ADDED TASHKEEL: final sukun |

### dal_fatha: دَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dal_fatha-001 | دَجَاجَةْ | دَجَاجَة | ADDED TASHKEEL: final sukun |
| dal_fatha-002 | دَارْ | دَار | ADDED TASHKEEL: final sukun |
| dal_fatha-003 | دَرْسْ | دَرْس | ADDED TASHKEEL: final sukun |
| dal_fatha-004 | بَدَأْ | بَدَأَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| dal_fatha-005 | قَدَمْ | قَدَمَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| dal_fatha-006 | وَجَدَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| dal_fatha-007 | دَفْتَرْ | دَفْتَر | ADDED TASHKEEL: final sukun |
| dal_fatha-008 | دَوَاءْ | دَوَاء | ADDED TASHKEEL: final sukun |
| dal_fatha-009 | هَدَفْ | هَدَفَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| dal_fatha-010 | دَلِيلْ | دَلِيل | ADDED TASHKEEL: final sukun |

### dal_kasra: دِ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dal_kasra-001 | دِيكْ | دِيك | ADDED TASHKEEL: final sukun |
| dal_kasra-002 | دِينْ | دِين | ADDED TASHKEEL: final sukun |
| dal_kasra-003 | جَدِيدْ | جَدِيد | ADDED TASHKEEL: final sukun |
| dal_kasra-004 | دِفَاعْ | دِفَاع | ADDED TASHKEEL: final sukun |
| dal_kasra-005 | قَدِيمْ | قَدِيم | ADDED TASHKEEL: final sukun |
| dal_kasra-006 | دِرَاسَةْ | دِرَاسَة | ADDED TASHKEEL: final sukun |
| dal_kasra-007 | بَدِيعْ | بَدِيع | ADDED TASHKEEL: final sukun |
| dal_kasra-008 | دِرْهَمْ | دِرْهَم | ADDED TASHKEEL: final sukun |
| dal_kasra-009 | سَدِيدْ | سَدِيد | ADDED TASHKEEL: final sukun |
| dal_kasra-010 | دِمَاءْ | دِمَاء | ADDED TASHKEEL: final sukun |

### dal_damma: دُ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dal_damma-001 | دُبّْ | دُبّ | ADDED TASHKEEL: final sukun |
| dal_damma-002 | دُرُوسْ | دُرُوس | ADDED TASHKEEL: final sukun |
| dal_damma-003 | دُنْيَا | — | — |
| dal_damma-004 | دُعَاءْ | دُعَاء | ADDED TASHKEEL: final sukun |
| dal_damma-005 | دُخُولْ | دُخُول | ADDED TASHKEEL: final sukun |
| dal_damma-006 | دُسْتُورْ | دُسْتُور | ADDED TASHKEEL: final sukun |
| dal_damma-007 | دُرُوبْ | دُرُوب | ADDED TASHKEEL: final sukun |

### dhal_fatha: ذَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dhal_fatha-001 | ذَهَبْ | ذَهَب | ADDED TASHKEEL: final sukun |
| dhal_fatha-002 | ذَكَرْ | ذَكَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| dhal_fatha-003 | ذَيْلْ | ذَيْل | ADDED TASHKEEL: final sukun |
| dhal_fatha-004 | أَذَانْ | أَذَان | ADDED TASHKEEL: final sukun |
| dhal_fatha-005 | غَذَاءْ | غَذَاء | ADDED TASHKEEL: final sukun |
| dhal_fatha-006 | أَخَذَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| dhal_fatha-007 | ذَرَّةْ | ذَرَّة | ADDED TASHKEEL: final sukun |
| dhal_fatha-008 | ذَاكِرَةْ | ذَاكِرَة | ADDED TASHKEEL: final sukun |
| dhal_fatha-009 | نَفَذَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| dhal_fatha-010 | ذَكَاءْ | ذَكَاء | ADDED TASHKEEL: final sukun |

### dhal_kasra: ذِ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dhal_kasra-001 | ذِئْبْ | ذِئْب | ADDED TASHKEEL: final sukun |
| dhal_kasra-002 | ذِرَاعْ | ذِرَاع | ADDED TASHKEEL: final sukun |
| dhal_kasra-003 | ذِكْرَى | — | — |
| dhal_kasra-004 | ذِمَّةْ | ذِمَّة | ADDED TASHKEEL: final sukun |
| dhal_kasra-005 | لَذِيذْ | لَذِيذ | ADDED TASHKEEL: final sukun |
| dhal_kasra-006 | ذِهْنْ | ذِهْن | ADDED TASHKEEL: final sukun |
| dhal_kasra-007 | حَذِرْ | حَذِر | ADDED TASHKEEL: final sukun |
| dhal_kasra-008 | ذِلَّةْ | ذِلَّة | ADDED TASHKEEL: final sukun |
| dhal_kasra-009 | ذِكْرْ | ذِكْر | ADDED TASHKEEL: final sukun |

### dhal_damma: ذُ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dhal_damma-001 | ذُرَةْ | ذُرَة | ADDED TASHKEEL: final sukun |
| dhal_damma-002 | ذُبَابْ | ذُبَاب | ADDED TASHKEEL: final sukun |
| dhal_damma-003 | ذُنُوبْ | ذُنُوب | ADDED TASHKEEL: final sukun |
| dhal_damma-004 | أُذُنْ | أُذُن | ADDED TASHKEEL: final sukun |
| dhal_damma-005 | ذُكُورْ | ذُكُور | ADDED TASHKEEL: final sukun |
| dhal_damma-006 | ذُرِّيَّةْ | ذُرِّيَّة | ADDED TASHKEEL: final sukun |
| dhal_damma-007 | ذُخُورْ | ذُخُور | ADDED TASHKEEL: final sukun |
| dhal_damma-008 | ذُهُولْ | ذُهُول | ADDED TASHKEEL: final sukun |
| dhal_damma-009 | ذُرُوفْ | ذُرُوف | ADDED TASHKEEL: final sukun |

### ra_fatha: رَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ra_fatha-001 | رَجُلْ | رَجُل | ADDED TASHKEEL: final sukun |
| ra_fatha-002 | رَأْسْ | رَأْس | ADDED TASHKEEL: final sukun |
| ra_fatha-003 | رَمْلْ | رَمْل | ADDED TASHKEEL: final sukun |
| ra_fatha-004 | قَرَأْ | قَرَأَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ra_fatha-005 | دَرَسْ | دَرَسَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ra_fatha-006 | نَظَرَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| ra_fatha-007 | رَبِيعْ | رَبِيع | ADDED TASHKEEL: final sukun |
| ra_fatha-008 | رَسَمْ | رَسَمَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ra_fatha-009 | حَرَكَةْ | حَرَكَة | ADDED TASHKEEL: final sukun |
| ra_fatha-010 | رَحْمَةْ | رَحْمَة | ADDED TASHKEEL: final sukun |

### ra_kasra: رِ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ra_kasra-001 | رِسَالَةْ | رِسَالَة | ADDED TASHKEEL: final sukun |
| ra_kasra-002 | رِجَالْ | رِجَال | ADDED TASHKEEL: final sukun |
| ra_kasra-003 | كَرِيمْ | كَرِيم | ADDED TASHKEEL: final sukun |
| ra_kasra-004 | رِيَاضَةْ | رِيَاضَة | ADDED TASHKEEL: final sukun |
| ra_kasra-005 | فَرِحْ | فَرِح | ADDED TASHKEEL: final sukun |
| ra_kasra-006 | رِحْلَةْ | رِحْلَة | ADDED TASHKEEL: final sukun |
| ra_kasra-007 | رِعَايَةْ | رِعَايَة | ADDED TASHKEEL: final sukun |
| ra_kasra-008 | رِفْقْ | رِفْق | ADDED TASHKEEL: final sukun |

### ra_damma: رُ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ra_damma-001 | رُمَّانْ | رُمَّان | ADDED TASHKEEL: final sukun |
| ra_damma-002 | رُكْبَةْ | رُكْبَة | ADDED TASHKEEL: final sukun |
| ra_damma-003 | دُرُوسْ | دُرُوس | ADDED TASHKEEL: final sukun |
| ra_damma-004 | رُوحْ | رُوح | ADDED TASHKEEL: final sukun |
| ra_damma-005 | حُرُوفْ | حُرُوف | ADDED TASHKEEL: final sukun |
| ra_damma-006 | رُؤْيَةْ | رُؤْيَة | ADDED TASHKEEL: final sukun |
| ra_damma-007 | رُسُومْ | رُسُوم | ADDED TASHKEEL: final sukun |
| ra_damma-008 | رُكُوعْ | رُكُوع | ADDED TASHKEEL: final sukun |
| ra_damma-009 | سُرُورْ | سُرُور | ADDED TASHKEEL: final sukun |

### zay_fatha: زَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zay_fatha-001 | زَهْرَةْ | زَهْرَة | ADDED TASHKEEL: final sukun |
| zay_fatha-002 | زَرَافَةْ | زَرَافَة | ADDED TASHKEEL: final sukun |
| zay_fatha-003 | زَيْتْ | زَيْت | ADDED TASHKEEL: final sukun |
| zay_fatha-004 | مَزَرَعَةْ | مَزَرَعَة | ADDED TASHKEEL: final sukun |
| zay_fatha-005 | غَزَالْ | غَزَال | ADDED TASHKEEL: final sukun |
| zay_fatha-006 | فَازَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| zay_fatha-007 | زَمَانْ | زَمَان | ADDED TASHKEEL: final sukun |
| zay_fatha-008 | زَبَدْ | زَبَد | ADDED TASHKEEL: final sukun |
| zay_fatha-009 | جَزَاءْ | جَزَاء | ADDED TASHKEEL: final sukun |
| zay_fatha-010 | زَكَاةْ | زَكَاة | ADDED TASHKEEL: final sukun |

### zay_kasra: زِ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zay_kasra-001 | زِرَاعَةْ | زِرَاعَة | ADDED TASHKEEL: final sukun |
| zay_kasra-002 | زِينَةْ | زِينَة | ADDED TASHKEEL: final sukun |
| zay_kasra-003 | غَزِيرْ | غَزِير | ADDED TASHKEEL: final sukun |
| zay_kasra-004 | زِيَارَةْ | زِيَارَة | ADDED TASHKEEL: final sukun |
| zay_kasra-005 | وَزِيرْ | وَزِير | ADDED TASHKEEL: final sukun |
| zay_kasra-006 | زِمَامْ | زِمَام | ADDED TASHKEEL: final sukun |
| zay_kasra-007 | عَزِيزْ | عَزِيز | ADDED TASHKEEL: final sukun |
| zay_kasra-008 | زِنَادْ | زِنَاد | ADDED TASHKEEL: final sukun |
| zay_kasra-009 | حَزِينْ | حَزِين | ADDED TASHKEEL: final sukun |
| zay_kasra-010 | زِحَامْ | زِحَام | ADDED TASHKEEL: final sukun |

### zay_damma: زُ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zay_damma-001 | زُجَاجْ | زُجَاج | ADDED TASHKEEL: final sukun |
| zay_damma-002 | زُهُورْ | زُهُور | ADDED TASHKEEL: final sukun |
| zay_damma-003 | عُزُوفْ | عُزُوف | ADDED TASHKEEL: final sukun |
| zay_damma-004 | زُبْدَةْ | زُبْدَة | ADDED TASHKEEL: final sukun |
| zay_damma-005 | زُرَافَةْ | زُرَافَة | ADDED TASHKEEL: final sukun |
| zay_damma-006 | زُمُرُّدْ | زُمُرُّد | ADDED TASHKEEL: final sukun |
| zay_damma-007 | زُهْدْ | زُهْد | ADDED TASHKEEL: final sukun |
| zay_damma-008 | زُيُوتْ | زُيُوت | ADDED TASHKEEL: final sukun |

### sin_fatha: سَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| sin_fatha-001 | سَمَكَةْ | سَمَكَة | ADDED TASHKEEL: final sukun |
| sin_fatha-002 | سَمَاءْ | سَمَاء | ADDED TASHKEEL: final sukun |
| sin_fatha-003 | سَرِيرْ | سَرِير | ADDED TASHKEEL: final sukun |
| sin_fatha-004 | دَرَسَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| sin_fatha-005 | حَسَنْ | حَسَن | ADDED TASHKEEL: final sukun |
| sin_fatha-006 | جَلَسَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| sin_fatha-007 | سَعِيدْ | سَعِيد | ADDED TASHKEEL: final sukun |
| sin_fatha-008 | سَلَامْ | سَلَام | ADDED TASHKEEL: final sukun |
| sin_fatha-009 | فَسَادْ | فَسَادَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| sin_fatha-010 | سَبَبْ | سَبَب | ADDED TASHKEEL: final sukun |

### sin_kasra: سِ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| sin_kasra-001 | سِتَّةْ | سِتَّة | ADDED TASHKEEL: final sukun |
| sin_kasra-002 | سِرّْ | سِرّ | ADDED TASHKEEL: final sukun |
| sin_kasra-003 | حَسِيبْ | حَسِيب | ADDED TASHKEEL: final sukun |
| sin_kasra-004 | سِلَاحْ | سِلَاح | ADDED TASHKEEL: final sukun |
| sin_kasra-005 | سِيَاسَةْ | سِيَاسَة | ADDED TASHKEEL: final sukun |
| sin_kasra-006 | سِجْنْ | سِجْن | ADDED TASHKEEL: final sukun |
| sin_kasra-007 | سِوَارْ | سِوَار | ADDED TASHKEEL: final sukun |
| sin_kasra-008 | سِلْسِلَةْ | سِلْسِلَة | ADDED TASHKEEL: final sukun |

### sin_damma: سُ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| sin_damma-001 | سُوقْ | سُوق | ADDED TASHKEEL: final sukun |
| sin_damma-002 | سُكَّرْ | سُكَّر | ADDED TASHKEEL: final sukun |
| sin_damma-003 | سُؤَالْ | سُؤَال | ADDED TASHKEEL: final sukun |
| sin_damma-004 | سُرُورْ | سُرُور | ADDED TASHKEEL: final sukun |
| sin_damma-005 | سُلْطَانْ | سُلْطَان | ADDED TASHKEEL: final sukun |
| sin_damma-006 | سُورَةْ | سُورَة | ADDED TASHKEEL: final sukun |
| sin_damma-007 | سُمُوّْ | سُمُوّ | ADDED TASHKEEL: final sukun |

### shin_fatha: شَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| shin_fatha-001 | شَمْسْ | شَمْس | ADDED TASHKEEL: final sukun |
| shin_fatha-002 | شَجَرَةْ | شَجَرَة | ADDED TASHKEEL: final sukun |
| shin_fatha-003 | شَارِعْ | شَارِع | ADDED TASHKEEL: final sukun |
| shin_fatha-004 | مَشَى | — | — |
| shin_fatha-005 | عَشَرَةْ | عَشَرَة | ADDED TASHKEEL: final sukun |
| shin_fatha-006 | فَرَشَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| shin_fatha-007 | شَتَاءْ | شَتَاء | ADDED TASHKEEL: final sukun |
| shin_fatha-008 | شَبَابْ | شَبَاب | ADDED TASHKEEL: final sukun |
| shin_fatha-009 | نَشَاطْ | نَشَاط | ADDED TASHKEEL: final sukun |
| shin_fatha-010 | شَرَابْ | شَرَاب | ADDED TASHKEEL: final sukun |

### shin_kasra: شِ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| shin_kasra-001 | شِتَاءْ | شِتَاء | ADDED TASHKEEL: final sukun |
| shin_kasra-002 | شِعْرْ | شِعْر | ADDED TASHKEEL: final sukun |
| shin_kasra-003 | عَشِيرَةْ | عَشِيرَة | ADDED TASHKEEL: final sukun |
| shin_kasra-004 | شِفَاءْ | شِفَاء | ADDED TASHKEEL: final sukun |
| shin_kasra-005 | رَشِيدْ | رَشِيد | ADDED TASHKEEL: final sukun |
| shin_kasra-006 | شِرَاءْ | شِرَاء | ADDED TASHKEEL: final sukun |
| shin_kasra-007 | بَشِيرْ | بَشِير | ADDED TASHKEEL: final sukun |
| shin_kasra-008 | شِبْهْ | شِبْه | ADDED TASHKEEL: final sukun |
| shin_kasra-009 | حَشِيشْ | حَشِيش | ADDED TASHKEEL: final sukun |
| shin_kasra-010 | شِعَارْ | شِعَار | ADDED TASHKEEL: final sukun |

### shin_damma: شُ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| shin_damma-001 | شُرْطَةْ | شُرْطَة | ADDED TASHKEEL: final sukun |
| shin_damma-002 | شُكْرْ | شُكْر | ADDED TASHKEEL: final sukun |
| shin_damma-003 | شُمُوعْ | شُمُوع | ADDED TASHKEEL: final sukun |
| shin_damma-004 | نُشُورْ | نُشُور | ADDED TASHKEEL: final sukun |
| shin_damma-005 | شُرُوقْ | شُرُوق | ADDED TASHKEEL: final sukun |
| shin_damma-006 | شُجُونْ | شُجُون | ADDED TASHKEEL: final sukun |
| shin_damma-007 | شُهُودْ | شُهُود | ADDED TASHKEEL: final sukun |
| shin_damma-008 | شُعُورْ | شُعُور | ADDED TASHKEEL: final sukun |
| shin_damma-009 | شُؤُونْ | شُؤُون | ADDED TASHKEEL: final sukun |

### sad_fatha: صَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| sad_fatha-001 | صَقْرْ | صَقْر | ADDED TASHKEEL: final sukun |
| sad_fatha-002 | صَبَاحْ | صَبَاح | ADDED TASHKEEL: final sukun |
| sad_fatha-003 | صَدِيقْ | صَدِيق | ADDED TASHKEEL: final sukun |
| sad_fatha-004 | قَصَدْ | قَصَدَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| sad_fatha-005 | فَصَلْ | فَصَلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| sad_fatha-006 | رَقَصَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| sad_fatha-007 | صَلَاةْ | صَلَاة | ADDED TASHKEEL: final sukun |
| sad_fatha-008 | صَحْرَاءْ | صَحْرَاء | ADDED TASHKEEL: final sukun |
| sad_fatha-009 | نَصَرْ | نَصَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| sad_fatha-010 | صَوْتْ | صَوْت | ADDED TASHKEEL: final sukun |

### sad_kasra: صِ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| sad_kasra-001 | صِغَرْ | صِغَر | ADDED TASHKEEL: final sukun |
| sad_kasra-002 | صِدْقْ | صِدْق | ADDED TASHKEEL: final sukun |
| sad_kasra-003 | نَصِيبْ | نَصِيب | ADDED TASHKEEL: final sukun |
| sad_kasra-004 | صِرَاعْ | صِرَاع | ADDED TASHKEEL: final sukun |
| sad_kasra-005 | حَصِيدْ | حَصِيد | ADDED TASHKEEL: final sukun |
| sad_kasra-006 | صِنَاعَةْ | صِنَاعَة | ADDED TASHKEEL: final sukun |
| sad_kasra-007 | قَصِيرْ | قَصِير | ADDED TASHKEEL: final sukun |
| sad_kasra-008 | صِيَامْ | صِيَام | ADDED TASHKEEL: final sukun |
| sad_kasra-009 | رَصِيدْ | رَصِيد | ADDED TASHKEEL: final sukun |
| sad_kasra-010 | صِحَّةْ | صِحَّة | ADDED TASHKEEL: final sukun |

### sad_damma: صُ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| sad_damma-001 | صُنْدُوقْ | صُنْدُوق | ADDED TASHKEEL: final sukun |
| sad_damma-002 | صُورَةْ | صُورَة | ADDED TASHKEEL: final sukun |
| sad_damma-003 | نُصُوصْ | نُصُوص | ADDED TASHKEEL: final sukun |
| sad_damma-004 | صُبْحْ | صُبْح | ADDED TASHKEEL: final sukun |
| sad_damma-005 | فُصُولْ | فُصُول | ADDED TASHKEEL: final sukun |
| sad_damma-006 | صُقُورْ | صُقُور | ADDED TASHKEEL: final sukun |
| sad_damma-007 | خُصُوصْ | خُصُوص | ADDED TASHKEEL: final sukun |
| sad_damma-008 | صُعُودْ | صُعُود | ADDED TASHKEEL: final sukun |
| sad_damma-009 | صُدُورْ | صُدُور | ADDED TASHKEEL: final sukun |
| sad_damma-010 | صُمُودْ | صُمُود | ADDED TASHKEEL: final sukun |

### dad_fatha: ضَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dad_fatha-001 | ضَفْدَعْ | ضَفْدَع | ADDED TASHKEEL: final sukun |
| dad_fatha-002 | ضَوْءْ | ضَوْء | ADDED TASHKEEL: final sukun |
| dad_fatha-003 | ضَرَبْ | ضَرَبَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| dad_fatha-004 | حَضَرْ | حَضَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| dad_fatha-005 | رَضَعْ | رَضَعَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| dad_fatha-006 | مَرِضَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| dad_fatha-007 | ضَيْفْ | ضَيْف | ADDED TASHKEEL: final sukun |
| dad_fatha-008 | ضَحِكْ | ضَحِكَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| dad_fatha-009 | عَضَلَةْ | عَضَلَة | ADDED TASHKEEL: final sukun |
| dad_fatha-010 | ضَمِيرْ | ضَمِير | ADDED TASHKEEL: final sukun |

### dad_kasra: ضِ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dad_kasra-001 | ضِفَافْ | ضِفَاف | ADDED TASHKEEL: final sukun |
| dad_kasra-002 | رَاضِي | — | — |
| dad_kasra-003 | قَاضِي | — | — |
| dad_kasra-004 | ضِيَاءْ | ضِيَاء | ADDED TASHKEEL: final sukun |
| dad_kasra-005 | مَاضِي | — | — |
| dad_kasra-006 | ضِدّْ | ضِدّ | ADDED TASHKEEL: final sukun |
| dad_kasra-007 | رَضِيعْ | رَضِيع | ADDED TASHKEEL: final sukun |
| dad_kasra-008 | ضِحْكْ | ضِحْك | ADDED TASHKEEL: final sukun |
| dad_kasra-009 | فَضِيلَةْ | فَضِيلَة | ADDED TASHKEEL: final sukun |
| dad_kasra-010 | ضِمْنْ | ضِمْن | ADDED TASHKEEL: final sukun |

### dad_damma: ضُ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| dad_damma-001 | ضُحَى | — | — |
| dad_damma-002 | ضُيُوفْ | ضُيُوف | ADDED TASHKEEL: final sukun |
| dad_damma-003 | حُضُورْ | حُضُور | ADDED TASHKEEL: final sukun |
| dad_damma-004 | ضُعْفْ | ضُعْف | ADDED TASHKEEL: final sukun |
| dad_damma-005 | ضُلُوعْ | ضُلُوع | ADDED TASHKEEL: final sukun |
| dad_damma-006 | عُضُو | — | — |
| dad_damma-007 | ضُرُوبْ | ضُرُوب | ADDED TASHKEEL: final sukun |
| dad_damma-008 | مَرْضُوضْ | مَرْضُوض | ADDED TASHKEEL: final sukun |
| dad_damma-009 | ضُمُورْ | ضُمُور | ADDED TASHKEEL: final sukun |

### tta_fatha: طَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| tta_fatha-001 | طَائِرَةْ | طَائِرَة | ADDED TASHKEEL: final sukun |
| tta_fatha-002 | طَبِيبْ | طَبِيب | ADDED TASHKEEL: final sukun |
| tta_fatha-003 | طَعَامْ | طَعَام | ADDED TASHKEEL: final sukun |
| tta_fatha-004 | بَطَلْ | بَطَلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| tta_fatha-005 | خَطَأْ | خَطَأ | ADDED TASHKEEL: final sukun |
| tta_fatha-006 | سَقَطَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| tta_fatha-007 | طَرِيقْ | طَرِيق | ADDED TASHKEEL: final sukun |
| tta_fatha-008 | طَاوِلَةْ | طَاوِلَة | ADDED TASHKEEL: final sukun |
| tta_fatha-009 | نَشَطَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| tta_fatha-010 | طَبَقْ | طَبَق | ADDED TASHKEEL: final sukun |

### tta_kasra: طِ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| tta_kasra-001 | طِفْلْ | طِفْل | ADDED TASHKEEL: final sukun |
| tta_kasra-002 | طِينْ | طِين | ADDED TASHKEEL: final sukun |
| tta_kasra-003 | بَطِيخْ | بَطِيخ | ADDED TASHKEEL: final sukun |
| tta_kasra-004 | طِبَاعَةْ | طِبَاعَة | ADDED TASHKEEL: final sukun |
| tta_kasra-005 | خَطِيرْ | خَطِير | ADDED TASHKEEL: final sukun |
| tta_kasra-006 | طِبّْ | طِبّ | ADDED TASHKEEL: final sukun |
| tta_kasra-007 | طِوَالْ | طِوَال | ADDED TASHKEEL: final sukun |
| tta_kasra-008 | طِلَاءْ | طِلَاء | ADDED TASHKEEL: final sukun |

### tta_damma: طُ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| tta_damma-001 | طُيُورْ | طُيُور | ADDED TASHKEEL: final sukun |
| tta_damma-002 | طُفُولَةْ | طُفُولَة | ADDED TASHKEEL: final sukun |
| tta_damma-003 | خُطُوطْ | خُطُوط | ADDED TASHKEEL: final sukun |
| tta_damma-004 | طُوبْ | طُوب | ADDED TASHKEEL: final sukun |
| tta_damma-005 | طُلَّابْ | طُلَّاب | ADDED TASHKEEL: final sukun |
| tta_damma-006 | طُرُقْ | طُرُق | ADDED TASHKEEL: final sukun |
| tta_damma-007 | طُبُولْ | طُبُول | ADDED TASHKEEL: final sukun |
| tta_damma-008 | طُمُوحْ | طُمُوح | ADDED TASHKEEL: final sukun |

### zza_fatha: ظَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zza_fatha-001 | ظَرْفْ | ظَرْف | ADDED TASHKEEL: final sukun |
| zza_fatha-002 | ظَبْيْ | ظَبْي | ADDED TASHKEEL: final sukun |
| zza_fatha-003 | ظَلَامْ | ظَلَام | ADDED TASHKEEL: final sukun |
| zza_fatha-004 | نَظَرْ | نَظَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| zza_fatha-005 | حَظَرْ | حَظَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| zza_fatha-006 | لَفَظَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| zza_fatha-007 | ظَاهِرْ | ظَاهِر | ADDED TASHKEEL: final sukun |
| zza_fatha-008 | ظَفَرْ | ظَفَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| zza_fatha-009 | مَظَلَّةْ | مَظَلَّة | ADDED TASHKEEL: final sukun |
| zza_fatha-010 | ظَنّْ | ظَنَّ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |

### zza_kasra: ظِ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zza_kasra-001 | ظِلّْ | ظِلّ | ADDED TASHKEEL: final sukun |
| zza_kasra-002 | نَظِيفْ | نَظِيف | ADDED TASHKEEL: final sukun |
| zza_kasra-003 | حَظِيرَةْ | حَظِيرَة | ADDED TASHKEEL: final sukun |
| zza_kasra-004 | ظِهَارْ | ظِهَار | ADDED TASHKEEL: final sukun |
| zza_kasra-005 | عَظِيمْ | عَظِيم | ADDED TASHKEEL: final sukun |
| zza_kasra-006 | ظِفْرْ | ظِفْر | ADDED TASHKEEL: final sukun |
| zza_kasra-007 | ظِمَاءْ | ظِمَاء | ADDED TASHKEEL: final sukun |

### zza_damma: ظُ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| zza_damma-001 | ظُهْرْ | ظُهْر | ADDED TASHKEEL: final sukun |
| zza_damma-002 | ظُلْمْ | ظُلْم | ADDED TASHKEEL: final sukun |
| zza_damma-003 | ظُرُوفْ | ظُرُوف | ADDED TASHKEEL: final sukun |
| zza_damma-004 | نُظُورْ | نُظُور | ADDED TASHKEEL: final sukun |
| zza_damma-005 | ظُفُورْ | ظُفُور | ADDED TASHKEEL: final sukun |
| zza_damma-006 | حُظُوظْ | حُظُوظ | ADDED TASHKEEL: final sukun |
| zza_damma-007 | ظُنُونْ | ظُنُون | ADDED TASHKEEL: final sukun |
| zza_damma-008 | مَحْظُوظْ | مَحْظُوظ | ADDED TASHKEEL: final sukun |
| zza_damma-009 | ظُهُورْ | ظُهُور | ADDED TASHKEEL: final sukun |
| zza_damma-010 | ظُلُمَاتْ | ظُلُمَات | ADDED TASHKEEL: final sukun |

### ain_fatha: عَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ain_fatha-001 | عَيْنْ | عَيْن | ADDED TASHKEEL: final sukun |
| ain_fatha-002 | عَسَلْ | عَسَل | ADDED TASHKEEL: final sukun |
| ain_fatha-003 | عَلَمْ | عَلَم | ADDED TASHKEEL: final sukun |
| ain_fatha-004 | سَعَدْ | سَعَدَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ain_fatha-005 | جَعَلْ | جَعَلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ain_fatha-006 | سَمِعَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| ain_fatha-007 | عَرَبِي | — | — |
| ain_fatha-008 | عَجَلَةْ | عَجَلَة | ADDED TASHKEEL: final sukun |
| ain_fatha-009 | نَعَمْ | نَعَمَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ain_fatha-010 | عَمَلْ | عَمَل | ADDED TASHKEEL: final sukun |

### ain_kasra: عِ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ain_kasra-001 | عِلْمْ | عِلْم | ADDED TASHKEEL: final sukun |
| ain_kasra-002 | عِنَبْ | عِنَب | ADDED TASHKEEL: final sukun |
| ain_kasra-003 | سَعِيدْ | سَعِيد | ADDED TASHKEEL: final sukun |
| ain_kasra-004 | عِبَادَةْ | عِبَادَة | ADDED TASHKEEL: final sukun |
| ain_kasra-005 | عِطْرْ | عِطْر | ADDED TASHKEEL: final sukun |
| ain_kasra-006 | عِنْدْ | عِنْد | ADDED TASHKEEL: final sukun |
| ain_kasra-007 | عِمَارَةْ | عِمَارَة | ADDED TASHKEEL: final sukun |

### ain_damma: عُ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ain_damma-001 | عُصْفُورْ | عُصْفُور | ADDED TASHKEEL: final sukun |
| ain_damma-002 | عُلُومْ | عُلُوم | ADDED TASHKEEL: final sukun |
| ain_damma-003 | عُمَرْ | عُمَر | ADDED TASHKEEL: final sukun |
| ain_damma-004 | عُقُولْ | عُقُول | ADDED TASHKEEL: final sukun |
| ain_damma-005 | عُيُونْ | عُيُون | ADDED TASHKEEL: final sukun |
| ain_damma-006 | عُنُقْ | عُنُق | ADDED TASHKEEL: final sukun |
| ain_damma-007 | عُطُورْ | عُطُور | ADDED TASHKEEL: final sukun |

### ghain_fatha: غَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ghain_fatha-001 | غَزَالْ | غَزَال | ADDED TASHKEEL: final sukun |
| ghain_fatha-002 | غَابَةْ | غَابَة | ADDED TASHKEEL: final sukun |
| ghain_fatha-003 | غَيْمَةْ | غَيْمَة | ADDED TASHKEEL: final sukun |
| ghain_fatha-004 | صَغَرْ | صَغَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ghain_fatha-005 | فَغَرْ | فَغَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ghain_fatha-006 | بَلَغَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| ghain_fatha-007 | غَنِيّْ | غَنِيّ | ADDED TASHKEEL: final sukun |
| ghain_fatha-008 | غَدَاءْ | غَدَاء | ADDED TASHKEEL: final sukun |
| ghain_fatha-009 | شَغَلْ | شَغَلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ghain_fatha-010 | غَرَفَةْ | غَرَفَة | ADDED TASHKEEL: final sukun |

### ghain_kasra: غِ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ghain_kasra-001 | غِنَاءْ | غِنَاء | ADDED TASHKEEL: final sukun |
| ghain_kasra-002 | صَغِيرْ | صَغِير | ADDED TASHKEEL: final sukun |
| ghain_kasra-003 | غِطَاءْ | غِطَاء | ADDED TASHKEEL: final sukun |
| ghain_kasra-004 | غِذَاءْ | غِذَاء | ADDED TASHKEEL: final sukun |
| ghain_kasra-005 | شَغِيلْ | شَغِيل | ADDED TASHKEEL: final sukun |
| ghain_kasra-006 | غِيَابْ | غِيَاب | ADDED TASHKEEL: final sukun |
| ghain_kasra-007 | غِلَافْ | غِلَاف | ADDED TASHKEEL: final sukun |
| ghain_kasra-008 | غِرَاسْ | غِرَاس | ADDED TASHKEEL: final sukun |

### ghain_damma: غُ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ghain_damma-001 | غُرَابْ | غُرَاب | ADDED TASHKEEL: final sukun |
| ghain_damma-002 | غُرْفَةْ | غُرْفَة | ADDED TASHKEEL: final sukun |
| ghain_damma-003 | غُصُونْ | غُصُون | ADDED TASHKEEL: final sukun |
| ghain_damma-004 | غُرُوبْ | غُرُوب | ADDED TASHKEEL: final sukun |
| ghain_damma-005 | غُبَارْ | غُبَار | ADDED TASHKEEL: final sukun |
| ghain_damma-006 | غُمُوضْ | غُمُوض | ADDED TASHKEEL: final sukun |
| ghain_damma-007 | شُغُولْ | شُغُول | ADDED TASHKEEL: final sukun |
| ghain_damma-008 | غُيُومْ | غُيُوم | ADDED TASHKEEL: final sukun |

### fa_fatha: فَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| fa_fatha-001 | فَرَاشَةْ | فَرَاشَة | ADDED TASHKEEL: final sukun |
| fa_fatha-002 | فَأْرْ | فَأْر | ADDED TASHKEEL: final sukun |
| fa_fatha-003 | فَجْرْ | فَجْر | ADDED TASHKEEL: final sukun |
| fa_fatha-004 | سَفَرْ | سَفَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| fa_fatha-005 | كَفَرْ | كَفَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| fa_fatha-006 | عَرَفَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| fa_fatha-007 | فَوَاكِهْ | فَوَاكِه | ADDED TASHKEEL: final sukun |
| fa_fatha-008 | فَرَحْ | فَرَح | ADDED TASHKEEL: final sukun |
| fa_fatha-009 | نَفَعْ | نَفَعَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| fa_fatha-010 | فَصْلْ | فَصْل | ADDED TASHKEEL: final sukun |

### fa_kasra: فِ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| fa_kasra-001 | فِيلْ | فِيل | ADDED TASHKEEL: final sukun |
| fa_kasra-002 | فِضَّةْ | فِضَّة | ADDED TASHKEEL: final sukun |
| fa_kasra-003 | سَفِينَةْ | سَفِينَة | ADDED TASHKEEL: final sukun |
| fa_kasra-004 | فِكْرَةْ | فِكْرَة | ADDED TASHKEEL: final sukun |
| fa_kasra-005 | فِرَاشْ | فِرَاش | ADDED TASHKEEL: final sukun |
| fa_kasra-006 | فِنَاءْ | فِنَاء | ADDED TASHKEEL: final sukun |
| fa_kasra-007 | فِدَاءْ | فِدَاء | ADDED TASHKEEL: final sukun |

### fa_damma: فُ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| fa_damma-001 | فُولْ | فُول | ADDED TASHKEEL: final sukun |
| fa_damma-002 | فُسْتَانْ | فُسْتَان | ADDED TASHKEEL: final sukun |
| fa_damma-003 | صُفُوفْ | صُفُوف | ADDED TASHKEEL: final sukun |
| fa_damma-004 | فُنُونْ | فُنُون | ADDED TASHKEEL: final sukun |
| fa_damma-005 | فُرُوعْ | فُرُوع | ADDED TASHKEEL: final sukun |
| fa_damma-006 | فُؤَادْ | فُؤَاد | ADDED TASHKEEL: final sukun |
| fa_damma-007 | فُلُوسْ | فُلُوس | ADDED TASHKEEL: final sukun |

### qaf_fatha: قَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| qaf_fatha-001 | قَمَرْ | قَمَر | ADDED TASHKEEL: final sukun |
| qaf_fatha-002 | قَلَمْ | قَلَم | ADDED TASHKEEL: final sukun |
| qaf_fatha-003 | قَطَارْ | قَطَار | ADDED TASHKEEL: final sukun |
| qaf_fatha-004 | صَقَرْ | صَقَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| qaf_fatha-005 | فَقَدْ | فَقَدَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| qaf_fatha-006 | سَبَقَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| qaf_fatha-007 | قَلْبْ | قَلْب | ADDED TASHKEEL: final sukun |
| qaf_fatha-008 | قَصَّةْ | قَصَّة | ADDED TASHKEEL: final sukun |
| qaf_fatha-009 | حَقَّ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| qaf_fatha-010 | قَوِيّْ | قَوِيّ | ADDED TASHKEEL: final sukun |

### qaf_kasra: قِ (6 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| qaf_kasra-001 | قِرْدْ | قِرْد | ADDED TASHKEEL: final sukun |
| qaf_kasra-002 | قِطَّةْ | قِطَّة | ADDED TASHKEEL: final sukun |
| qaf_kasra-003 | قِرَاءَةْ | قِرَاءَة | ADDED TASHKEEL: final sukun |
| qaf_kasra-004 | قِصَّةْ | قِصَّة | ADDED TASHKEEL: final sukun |
| qaf_kasra-005 | قِيَادَةْ | قِيَادَة | ADDED TASHKEEL: final sukun |
| qaf_kasra-006 | قِسْمْ | قِسْم | ADDED TASHKEEL: final sukun |

### qaf_damma: قُ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| qaf_damma-001 | قُرْآنْ | قُرْآن | ADDED TASHKEEL: final sukun |
| qaf_damma-002 | قُوَّةْ | قُوَّة | ADDED TASHKEEL: final sukun |
| qaf_damma-003 | حُقُوقْ | حُقُوق | ADDED TASHKEEL: final sukun |
| qaf_damma-004 | قُلُوبْ | قُلُوب | ADDED TASHKEEL: final sukun |
| qaf_damma-005 | قُدُومْ | قُدُوم | ADDED TASHKEEL: final sukun |
| qaf_damma-006 | عُقُولْ | عُقُول | ADDED TASHKEEL: final sukun |
| qaf_damma-007 | قُطُوفْ | قُطُوف | ADDED TASHKEEL: final sukun |
| qaf_damma-008 | قُصُورْ | قُصُور | ADDED TASHKEEL: final sukun |

### kaf_fatha: كَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kaf_fatha-001 | كَلْبْ | كَلْب | ADDED TASHKEEL: final sukun |
| kaf_fatha-002 | كَتَبْ | كَتَبَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| kaf_fatha-003 | كَبِيرْ | كَبِير | ADDED TASHKEEL: final sukun |
| kaf_fatha-004 | سَكَنْ | سَكَنَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| kaf_fatha-005 | حَكَمْ | حَكَمَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| kaf_fatha-006 | مَلَكَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| kaf_fatha-007 | كَنْزْ | كَنْز | ADDED TASHKEEL: final sukun |
| kaf_fatha-008 | كَرِيمْ | كَرِيم | ADDED TASHKEEL: final sukun |
| kaf_fatha-009 | شَكَرْ | شَكَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| kaf_fatha-010 | كَوْكَبْ | كَوْكَب | ADDED TASHKEEL: final sukun |

### kaf_kasra: كِ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kaf_kasra-001 | كِتَابْ | كِتَاب | ADDED TASHKEEL: final sukun |
| kaf_kasra-002 | كِبَارْ | كِبَار | ADDED TASHKEEL: final sukun |
| kaf_kasra-003 | سَكِينَةْ | سَكِينَة | ADDED TASHKEEL: final sukun |
| kaf_kasra-004 | كِرَامْ | كِرَام | ADDED TASHKEEL: final sukun |
| kaf_kasra-005 | كِسَاءْ | كِسَاء | ADDED TASHKEEL: final sukun |
| kaf_kasra-006 | كِفَاحْ | كِفَاح | ADDED TASHKEEL: final sukun |
| kaf_kasra-007 | كِنَايَةْ | كِنَايَة | ADDED TASHKEEL: final sukun |

### kaf_damma: كُ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| kaf_damma-001 | كُرَةْ | كُرَة | ADDED TASHKEEL: final sukun |
| kaf_damma-002 | كُوبْ | كُوب | ADDED TASHKEEL: final sukun |
| kaf_damma-003 | كُتُبْ | كُتُب | ADDED TASHKEEL: final sukun |
| kaf_damma-004 | كُنُوزْ | كُنُوز | ADDED TASHKEEL: final sukun |
| kaf_damma-005 | شُكُوكْ | شُكُوك | ADDED TASHKEEL: final sukun |
| kaf_damma-006 | كُرُومْ | كُرُوم | ADDED TASHKEEL: final sukun |
| kaf_damma-007 | سُكُونْ | سُكُون | ADDED TASHKEEL: final sukun |
| kaf_damma-008 | كُلِّيَّةْ | كُلِّيَّة | ADDED TASHKEEL: final sukun |

### lam_fatha: لَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| lam_fatha-001 | لَيْمُونْ | لَيْمُون | ADDED TASHKEEL: final sukun |
| lam_fatha-002 | لَعِبْ | لَعِبَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| lam_fatha-003 | لَوْنْ | لَوْن | ADDED TASHKEEL: final sukun |
| lam_fatha-004 | عَلَمْ | عَلَمَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| lam_fatha-005 | جَلَسْ | جَلَسَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| lam_fatha-006 | أَكَلَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| lam_fatha-007 | لَبَنْ | لَبَن | ADDED TASHKEEL: final sukun |
| lam_fatha-008 | لَحْمْ | لَحْم | ADDED TASHKEEL: final sukun |
| lam_fatha-009 | سَلَامْ | سَلَام | ADDED TASHKEEL: final sukun |
| lam_fatha-010 | لَطِيفْ | لَطِيف | ADDED TASHKEEL: final sukun |

### lam_kasra: لِ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| lam_kasra-001 | لِسَانْ | لِسَان | ADDED TASHKEEL: final sukun |
| lam_kasra-002 | لِبَاسْ | لِبَاس | ADDED TASHKEEL: final sukun |
| lam_kasra-003 | جَلِيلْ | جَلِيل | ADDED TASHKEEL: final sukun |
| lam_kasra-004 | لِقَاءْ | لِقَاء | ADDED TASHKEEL: final sukun |
| lam_kasra-005 | لِحَافْ | لِحَاف | ADDED TASHKEEL: final sukun |
| lam_kasra-006 | قَلِيلْ | قَلِيل | ADDED TASHKEEL: final sukun |
| lam_kasra-007 | لِوَاءْ | لِوَاء | ADDED TASHKEEL: final sukun |
| lam_kasra-008 | دَلِيلْ | دَلِيل | ADDED TASHKEEL: final sukun |
| lam_kasra-009 | لِئَامْ | لِئَام | ADDED TASHKEEL: final sukun |

### lam_damma: لُ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| lam_damma-001 | لُؤْلُؤْ | لُؤْلُؤ | ADDED TASHKEEL: final sukun |
| lam_damma-002 | لُغَةْ | لُغَة | ADDED TASHKEEL: final sukun |
| lam_damma-003 | عُلُومْ | عُلُوم | ADDED TASHKEEL: final sukun |
| lam_damma-004 | لُعْبَةْ | لُعْبَة | ADDED TASHKEEL: final sukun |
| lam_damma-005 | لُطْفْ | لُطْف | ADDED TASHKEEL: final sukun |
| lam_damma-006 | حُلُولْ | حُلُول | ADDED TASHKEEL: final sukun |
| lam_damma-007 | لُحُومْ | لُحُوم | ADDED TASHKEEL: final sukun |
| lam_damma-008 | لُزُومْ | لُزُوم | ADDED TASHKEEL: final sukun |

### mim_fatha: مَ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| mim_fatha-001 | مَدْرَسَةْ | مَدْرَسَة | ADDED TASHKEEL: final sukun |
| mim_fatha-002 | مَاءْ | مَاء | ADDED TASHKEEL: final sukun |
| mim_fatha-003 | مَسْجِدْ | مَسْجِد | ADDED TASHKEEL: final sukun |
| mim_fatha-004 | جَمَلْ | جَمَلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| mim_fatha-005 | عَلِمَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| mim_fatha-006 | مَكْتَبَةْ | مَكْتَبَة | ADDED TASHKEEL: final sukun |
| mim_fatha-007 | مَلِكْ | مَلِك | ADDED TASHKEEL: final sukun |
| mim_fatha-008 | سَمَكَةْ | سَمَكَة | ADDED TASHKEEL: final sukun |
| mim_fatha-009 | مَوْزْ | مَوْز | ADDED TASHKEEL: final sukun |

### mim_kasra: مِ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| mim_kasra-001 | مِفْتَاحْ | مِفْتَاح | ADDED TASHKEEL: final sukun |
| mim_kasra-002 | مِصْرْ | مِصْر | ADDED TASHKEEL: final sukun |
| mim_kasra-003 | حَمِيدْ | حَمِيد | ADDED TASHKEEL: final sukun |
| mim_kasra-004 | مِلْحْ | مِلْح | ADDED TASHKEEL: final sukun |
| mim_kasra-005 | مِسْكْ | مِسْك | ADDED TASHKEEL: final sukun |
| mim_kasra-006 | مِنْبَرْ | مِنْبَر | ADDED TASHKEEL: final sukun |
| mim_kasra-007 | مِيزَانْ | مِيزَان | ADDED TASHKEEL: final sukun |

### mim_damma: مُ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| mim_damma-001 | مُعَلِّمْ | مُعَلِّم | ADDED TASHKEEL: final sukun |
| mim_damma-002 | مُسْلِمْ | مُسْلِم | ADDED TASHKEEL: final sukun |
| mim_damma-003 | مُؤْمِنْ | مُؤْمِن | ADDED TASHKEEL: final sukun |
| mim_damma-004 | مُدِيرْ | مُدِير | ADDED TASHKEEL: final sukun |
| mim_damma-005 | مُلُوكْ | مُلُوك | ADDED TASHKEEL: final sukun |
| mim_damma-006 | هُمُومْ | هُمُوم | ADDED TASHKEEL: final sukun |
| mim_damma-007 | مُرُوءَةْ | مُرُوءَة | ADDED TASHKEEL: final sukun |

### nun_fatha: نَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| nun_fatha-001 | نَحْلَةْ | نَحْلَة | ADDED TASHKEEL: final sukun |
| nun_fatha-002 | نَجْمْ | نَجْم | ADDED TASHKEEL: final sukun |
| nun_fatha-003 | نَهْرْ | نَهْر | ADDED TASHKEEL: final sukun |
| nun_fatha-004 | بَنَى | — | — |
| nun_fatha-005 | سَنَةْ | سَنَة | ADDED TASHKEEL: final sukun |
| nun_fatha-006 | حَزِنَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| nun_fatha-007 | نَارْ | نَار | ADDED TASHKEEL: final sukun |
| nun_fatha-008 | نَظَرْ | نَظَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| nun_fatha-009 | مَنَعْ | مَنَعَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| nun_fatha-010 | نَبَاتْ | نَبَات | ADDED TASHKEEL: final sukun |

### nun_kasra: نِ (7 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| nun_kasra-001 | نِعْمَةْ | نِعْمَة | ADDED TASHKEEL: final sukun |
| nun_kasra-002 | نِظَامْ | نِظَام | ADDED TASHKEEL: final sukun |
| nun_kasra-003 | حَسَنِ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| nun_kasra-004 | نِسَاءْ | نِسَاء | ADDED TASHKEEL: final sukun |
| nun_kasra-005 | نِدَاءْ | نِدَاء | ADDED TASHKEEL: final sukun |
| nun_kasra-006 | نِهَايَةْ | نِهَايَة | ADDED TASHKEEL: final sukun |
| nun_kasra-007 | نِقَاشْ | نِقَاش | ADDED TASHKEEL: final sukun |

### nun_damma: نُ (8 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| nun_damma-001 | نُورْ | نُور | ADDED TASHKEEL: final sukun |
| nun_damma-002 | نُجُومْ | نُجُوم | ADDED TASHKEEL: final sukun |
| nun_damma-003 | فُنُونْ | فُنُون | ADDED TASHKEEL: final sukun |
| nun_damma-004 | نُقُودْ | نُقُود | ADDED TASHKEEL: final sukun |
| nun_damma-005 | نُزُولْ | نُزُول | ADDED TASHKEEL: final sukun |
| nun_damma-006 | جُنُونْ | جُنُون | ADDED TASHKEEL: final sukun |
| nun_damma-007 | نُصُوصْ | نُصُوص | ADDED TASHKEEL: final sukun |
| nun_damma-008 | نُفُوسْ | نُفُوس | ADDED TASHKEEL: final sukun |

### ha_fatha: هَ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ha_fatha-001 | هَدِيَّةْ | هَدِيَّة | ADDED TASHKEEL: final sukun |
| ha_fatha-002 | هَوَاءْ | هَوَاء | ADDED TASHKEEL: final sukun |
| ha_fatha-003 | هَاتِفْ | هَاتِف | ADDED TASHKEEL: final sukun |
| ha_fatha-004 | ذَهَبْ | ذَهَبَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ha_fatha-005 | وَجَهَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| ha_fatha-006 | هَلَالْ | هَلَال | ADDED TASHKEEL: final sukun |
| ha_fatha-007 | هَرَبْ | هَرَبَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ha_fatha-008 | نَهَرْ | نَهَرَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ha_fatha-009 | هَمَسْ | هَمَسَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |

### ha_kasra: هِ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ha_kasra-001 | هِلَالْ | هِلَال | ADDED TASHKEEL: final sukun |
| ha_kasra-002 | فَاهِمْ | فَاهِم | ADDED TASHKEEL: final sukun |
| ha_kasra-003 | هِجْرَةْ | هِجْرَة | ADDED TASHKEEL: final sukun |
| ha_kasra-004 | شَاهِدْ | شَاهِد | ADDED TASHKEEL: final sukun |
| ha_kasra-005 | هِدَايَةْ | هِدَايَة | ADDED TASHKEEL: final sukun |
| ha_kasra-006 | ظَاهِرْ | ظَاهِر | ADDED TASHKEEL: final sukun |
| ha_kasra-007 | هِمَّةْ | هِمَّة | ADDED TASHKEEL: final sukun |
| ha_kasra-008 | مَاهِرْ | مَاهِر | ADDED TASHKEEL: final sukun |
| ha_kasra-009 | هِنْدْ | هِنْد | ADDED TASHKEEL: final sukun |
| ha_kasra-010 | بَاهِرْ | بَاهِر | ADDED TASHKEEL: final sukun |

### ha_damma: هُ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ha_damma-001 | هُدْهُدْ | هُدْهُد | ADDED TASHKEEL: final sukun |
| ha_damma-002 | هُمُومْ | هُمُوم | ADDED TASHKEEL: final sukun |
| ha_damma-003 | شُهُورْ | شُهُور | ADDED TASHKEEL: final sukun |
| ha_damma-004 | هُدُوءْ | هُدُوء | ADDED TASHKEEL: final sukun |
| ha_damma-005 | ظُهُورْ | ظُهُور | ADDED TASHKEEL: final sukun |
| ha_damma-006 | هُجُومْ | هُجُوم | ADDED TASHKEEL: final sukun |
| ha_damma-007 | هُرُوبْ | هُرُوب | ADDED TASHKEEL: final sukun |
| ha_damma-008 | سُهُولْ | سُهُول | ADDED TASHKEEL: final sukun |
| ha_damma-009 | هُنَا | — | — |

### waw_fatha: وَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| waw_fatha-001 | وَرْدَةْ | وَرْدَة | ADDED TASHKEEL: final sukun |
| waw_fatha-002 | وَلَدْ | وَلَد | ADDED TASHKEEL: final sukun |
| waw_fatha-003 | وَطَنْ | وَطَن | ADDED TASHKEEL: final sukun |
| waw_fatha-004 | قَوَّةْ | قَوَّة | ADDED TASHKEEL: final sukun |
| waw_fatha-005 | حَوَّلْ | حَوَّلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| waw_fatha-006 | دَعَوَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| waw_fatha-007 | وَقْتْ | وَقْت | ADDED TASHKEEL: final sukun |
| waw_fatha-008 | وَعْدْ | وَعْد | ADDED TASHKEEL: final sukun |
| waw_fatha-009 | سَوَاءْ | سَوَاء | ADDED TASHKEEL: final sukun |
| waw_fatha-010 | وَصَلْ | وَصَلَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |

### waw_kasra: وِ (9 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| waw_kasra-001 | وِسَادَةْ | وِسَادَة | ADDED TASHKEEL: final sukun |
| waw_kasra-002 | وِلَادَةْ | وِلَادَة | ADDED TASHKEEL: final sukun |
| waw_kasra-003 | وِقَايَةْ | وِقَايَة | ADDED TASHKEEL: final sukun |
| waw_kasra-004 | وِزَارَةْ | وِزَارَة | ADDED TASHKEEL: final sukun |
| waw_kasra-005 | وِعَاءْ | وِعَاء | ADDED TASHKEEL: final sukun |
| waw_kasra-006 | وِصَالْ | وِصَال | ADDED TASHKEEL: final sukun |
| waw_kasra-007 | وِفَاقْ | وِفَاق | ADDED TASHKEEL: final sukun |
| waw_kasra-008 | وِدَادْ | وِدَاد | ADDED TASHKEEL: final sukun |
| waw_kasra-009 | وِسَامْ | وِسَام | ADDED TASHKEEL: final sukun |

### waw_damma: وُ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| waw_damma-001 | وُجُودْ | وُجُود | ADDED TASHKEEL: final sukun |
| waw_damma-002 | وُرُودْ | وُرُود | ADDED TASHKEEL: final sukun |
| waw_damma-003 | وُصُولْ | وُصُول | ADDED TASHKEEL: final sukun |
| waw_damma-004 | وُقُوفْ | وُقُوف | ADDED TASHKEEL: final sukun |
| waw_damma-005 | وُعُودْ | وُعُود | ADDED TASHKEEL: final sukun |
| waw_damma-006 | وُقُودْ | وُقُود | ADDED TASHKEEL: final sukun |
| waw_damma-007 | وُضُوءْ | وُضُوء | ADDED TASHKEEL: final sukun |
| waw_damma-008 | وُجُوهْ | وُجُوه | ADDED TASHKEEL: final sukun |
| waw_damma-009 | وُلُوجْ | وُلُوج | ADDED TASHKEEL: final sukun |
| waw_damma-010 | وُفُودْ | وُفُود | ADDED TASHKEEL: final sukun |

### ya_fatha: يَ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ya_fatha-001 | يَدْ | يَد | ADDED TASHKEEL: final sukun |
| ya_fatha-002 | يَوْمْ | يَوْم | ADDED TASHKEEL: final sukun |
| ya_fatha-003 | يَمِينْ | يَمِين | ADDED TASHKEEL: final sukun |
| ya_fatha-004 | بَيَانْ | بَيَانَ | ADDED TASHKEEL: final vowel replaced by the pausal sukun |
| ya_fatha-005 | حَيَاةْ | حَيَاة | ADDED TASHKEEL: final sukun |
| ya_fatha-006 | هَدَيَ | — | FINAL MARK EXCEPTION: the lesson's vowel on the last letter |
| ya_fatha-007 | يَقِينْ | يَقِين | ADDED TASHKEEL: final sukun |
| ya_fatha-008 | يَسَارْ | يَسَار | ADDED TASHKEEL: final sukun |
| ya_fatha-009 | زِيَارَةْ | زِيَارَة | ADDED TASHKEEL: final sukun |
| ya_fatha-010 | يَابِسْ | يَابِس | ADDED TASHKEEL: final sukun |

### ya_damma: يُ (10 words)

| Id | Word | Was | Held because |
|---|---|---|---|
| ya_damma-001 | يُونُسْ | يُونُس | ADDED TASHKEEL: final sukun |
| ya_damma-002 | يُوسُفْ | يُوسُف | ADDED TASHKEEL: final sukun |
| ya_damma-003 | يُسْرْ | يُسْر | ADDED TASHKEEL: final sukun |
| ya_damma-004 | يُمْنْ | يُمْن | ADDED TASHKEEL: final sukun |
| ya_damma-005 | يُحِبّْ | يُحِبّ | ADDED TASHKEEL: final sukun |
| ya_damma-006 | يُرِيدْ | يُرِيد | ADDED TASHKEEL: final sukun |
| ya_damma-007 | يُسَاعِدْ | يُسَاعِد | ADDED TASHKEEL: final sukun |
| ya_damma-008 | يُعَلِّمْ | يُعَلِّم | ADDED TASHKEEL: final sukun |
| ya_damma-009 | يُكْرِمْ | يُكْرِم | ADDED TASHKEEL: final sukun |
| ya_damma-010 | يُنَادِي | — | — |

