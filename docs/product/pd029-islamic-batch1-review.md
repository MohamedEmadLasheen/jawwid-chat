# PD-29: Islamic Studies batch 1 (the Prophet ﷺ lessons), lines held for teacher review

This file is generated from `apps/lessons/src/islamic/lesson-NNN.json` and the rebuild's reports. Do not edit it by hand.

- Each lesson was rewritten as data from the old lesson (jawwid-lessons @ c231532, `src/lessons/islamic/lesson-N`), as a **topic lesson**. The old lessons were read as text only, from a quarantined copy, and never built or run. Every line is the old lesson's own wording, byte for byte (only emoji, branding, quiz chrome and praise screens were left out).
- Every file is **pending**: the lesson page shows nothing of it until the Teachers department approves it.
- **Quran is shown only by reference** ({surah, ayah}), drawn from the verified text on the page. CI refuses typed Quran in any line (4 or more consecutive words, or a whole short ayah) and any madhhab name.
- **Every hadith is held and never shown**, whatever its review, until a verified hadith source is approved (owner, 2026-10-29). A quiz question that quotes a hadith is held with it.
- No lesson here teaches fiqh, so no scholar sign-off is required beyond the Teachers department.

## Summary

| Lesson | Title | Sections | Text | Quran refs | Hadith (held) | Quiz | Other held lines |
|---|---|---|---|---|---|---|---|
| 8 | التعريف بالنبي ﷺ | 4 | 18 | 0 | 0 | 4 | 2 |
| 9 | رحمته ﷺ | 4 | 19 | 0 | 3 | 15 | 11 |
| 10 | صِدْقُهُ ﷺ | 2 | 4 | 0 | 2 | 6 | 3 |
| 11 | أمانة النبي ﷺ | 5 | 14 | 0 | 0 | 11 | 0 |
| 20 | محمد ﷺ نبيي | 7 | 28 | 5 | 3 | 5 | 3 |

## Decisions for the teachers

1. **Each line** must be correct and suitable for a child. The wording is the old lesson's; nothing was rewritten, even where a line reads awkwardly (each such line is flagged below).
2. **The prose is not fully vowelled**, as in the old lessons. Should it be (as the Arabic lessons now are)? That would be a later, separate change, each word held.
3. **Every hadith**: the text and its source are checked once a verified hadith source is approved. Until then they stay hidden.
4. **Each lesson's own questions**, below.

## Lesson 8: التعريف بالنبي ﷺ

**Sections:** مرحباً يا بطل! (`intro`)، أولاً: التعريف بالنبي محمد ﷺ (`who`)، مَن هو والده ومَن هي والدته؟ (`lineage`)، أين وُلد النبي ﷺ وفي أي عام؟ (`birth`)

**Other held lines:**

| Id | Line | Why it is held |
|---|---|---|
| birth-002 | مكة المكرمة أطهر بقاع الأرض | CHECK: a superlative about Makkah stated as fact ("أطهر بقاع الأرض"); a teacher confirms the wording for children |
| q4 | اسم أم النبي محمد ﷺ هي آمنة بنت وهب. | CHECK: verbatim from the source, but "اسم ... هي" mixes genders (اسم is masculine); a teacher decides whether to fix the wording |

**The quiz:**

| Id | Question | Options | Right answer |
|---|---|---|---|
| q1 | اسم والد النبي ﷺ هو ........ | عبد الله، عبد المطلب، علي | عبد الله |
| q2 | ولد النبي ﷺ في مدينة ........ | المدينة المنورة، الطائف، مكة المكرمة | مكة المكرمة |
| q3 | ولد النبي محمد ﷺ في عام الفيل. | صَحِيحٌ، خَطَأٌ | صَحِيحٌ |
| q4 | اسم أم النبي محمد ﷺ هي آمنة بنت وهب. | صَحِيحٌ، خَطَأٌ | صَحِيحٌ |

**Not carried from the old lesson:**

- Nothing else: the cover line «الدرس الثاني من سلسلة الدروس الإسلامية» was dropped as chrome (it contradicts lesson 8).

## Lesson 9: رحمته ﷺ

**Sections:** مرحباً يا بطل! (`intro`)، رحمته ﷺ بالحيوانات (`animals`)، رحمته ﷺ في الصلاة والحياة (`prayer`)، الدعوة على جبل الصفا (`safa`)

**Hadith (held, never shown):**

| Id | Text | Source as the old lesson gave it |
|---|---|---|
| animals-001 | عن عبد الله بن مسعود قَالَ: كُنَّا مَعَ رَسُولِ اللهِ ﷺ فِي سَفَرٍ، فَانْطَلَقَ لِحَاجَتِهِ، فَرَأَيْنَا حُمَّرَةً مَعَهَا فَرْخَانِ، فَأَخَذْنَا فَرْخَيْهَا، فَجَاءَتِ الْحُمَّرَةُ فَجَعَلَتْ تَفْرِشُ، فَجَاءَ النَّبِيُّ ﷺ، فَقَالَ: «مَنْ فَجَعَ هَذِهِ بِوَلَدِهَا؟ رُدُّوا وَلَدَهَا إِلَيْهَا.» | not stated |
| prayer-004 | قال رسول الله ﷺ: «الراحمون يرحمهم الرحمن» | not stated |
| safa-006 | سألهم النبي ﷺ: لو أخبرتكم أن خيلاً بالوادي تريد أن تهجم عليكم، أكنتم تصدقونني؟ قالوا جميعاً: «نعم، ما جربنا عليك كذباً» | not stated |

**Other held lines:**

| Id | Line | Why it is held |
|---|---|---|
| animals-004 | غضب عندما أُخذ فرخا الطائر | CHECK: says the Prophet ﷺ was angry; the narration on this slide reports his words, not anger; a teacher confirms |
| prayer-002 | كان النبي ﷺ يُخفف الصلاة إذا سمع بكاء طفل | CHECK: reports the Prophet's ﷺ practice from a hadith that is not quoted or sourced here; a teacher confirms it |
| safa-007 | قريش كانت تعرف أن النبي ﷺ صادق أمين، لذلك أقروا بصدقه حتى قبل الإسلام | CHECK: "حتى قبل الإسلام" is imprecise: the Safa call came after the mission began; their testimony was to his truthfulness before it; a teacher confirms the wording |
| q3 | اللقب الذي عرف به النبي ﷺ قبل البعثة هو ........ | CHECK: not taught on any slide of this lesson (the source has no slide at order 5, likely the missing one); a teacher confirms the fact and that it is covered before the quiz |
| q4 | الشخص الذي كلفه النبي ﷺ برد الأمانات هو ........ | CHECK: not taught on any slide of this lesson (the source has no slide at order 5, likely the missing one); a teacher confirms the fact and that it is covered before the quiz |
| q7 | اسم أم النبي محمد ﷺ هي آمنة بنت وهب. | CHECK: verbatim from the source, but "اسم ... هي" mixes genders (اسم is masculine); a teacher decides whether to fix the wording |
| q11 | أرسل الله تعالى النبي محمدًا ﷺ لدعوة الناس جميعاً إلى ........ | CHECK: converted from a fill-in-the-blank with a 5-word bank; options are 4 of the bank's words in bank order (الرحمن dropped: it could also complete this sentence); a teacher confirms no other option completes the sentence |
| q12 | طلب النبي ﷺ من علي بن أبي طالب أن يرد ........ لأصحابها. | CHECK: not taught on any slide of this lesson (the source has no slide at order 5, likely the missing one); a teacher confirms the fact and that it is covered before the quiz \| CHECK: converted from a fill-in-the-blank with a 5-word bank; options are 4 of the bank's words in bank order (الإسلام dropped: the last non-answer word of the bank); a teacher confirms no other option completes the sentence |
| q13 | كان جواب قوم النبي ﷺ عندما سألهم عن هجوم خيل عليهم، أنهم ........ | CHECK: converted from a fill-in-the-blank with a 5-word bank; options are 4 of the bank's words in bank order (الإسلام dropped: the last non-answer word of the bank); a teacher confirms no other option completes the sentence |
| q14 | طائر ........ هو الذي فُجع بولده فأمر النبي ﷺ برده إليه. | CHECK: converted from a fill-in-the-blank with a 5-word bank; options are 4 of the bank's words in bank order (الإسلام dropped: the last non-answer word of the bank); a teacher confirms no other option completes the sentence |
| q15 | قال رسول الله ﷺ: «الراحمون يرحمهم ........» | HADITH: held until a verified hadith source is approved; a teacher checks its wording, source and grade \| CHECK: converted from a fill-in-the-blank with a 5-word bank; options are 4 of the bank's words in bank order (الإسلام dropped: the last non-answer word of the bank); a teacher confirms no other option completes the sentence |

**The quiz:**

| Id | Question | Options | Right answer |
|---|---|---|---|
| q1 | اسم والد النبي ﷺ هو ........ | عبد الله، عبد المطلب، علي | عبد الله |
| q2 | ولد النبي ﷺ في مدينة ........ | المدينة المنورة، الطائف، مكة المكرمة | مكة المكرمة |
| q3 | اللقب الذي عرف به النبي ﷺ قبل البعثة هو ........ | الفاروق، الصادق الأمين، ذو النورين | الصادق الأمين |
| q4 | الشخص الذي كلفه النبي ﷺ برد الأمانات هو ........ | أبو بكر، عمر، علي بن أبي طالب | علي بن أبي طالب |
| q5 | صعد النبي ﷺ ليدعو أقاربه فوق جبل ........ | أحد، الصفا، حراء | الصفا |
| q6 | ولد النبي محمد ﷺ في عام الفيل. | صَحِيحٌ، خَطَأٌ | صَحِيحٌ |
| q7 | اسم أم النبي محمد ﷺ هي آمنة بنت وهب. | صَحِيحٌ، خَطَأٌ | صَحِيحٌ |
| q8 | صعد النبي ﷺ جبل الصفا ليخبر قومه برسالته. | صَحِيحٌ، خَطَأٌ | صَحِيحٌ |
| q9 | كان النبي ﷺ يخفف الصلاة إذا سمع بكاء طفل رحمةً به وبأمه. | صَحِيحٌ، خَطَأٌ | صَحِيحٌ |
| q10 | أرسل الله تعالى النبي محمدًا ﷺ لدعوة العرب فقط إلى الإسلام. | صَحِيحٌ، خَطَأٌ | خَطَأٌ |
| q11 | أرسل الله تعالى النبي محمدًا ﷺ لدعوة الناس جميعاً إلى ........ | صدقوه، الأمانات، الحُمَّرة، الإسلام | الإسلام |
| q12 | طلب النبي ﷺ من علي بن أبي طالب أن يرد ........ لأصحابها. | الرحمن، صدقوه، الأمانات، الحُمَّرة | الأمانات |
| q13 | كان جواب قوم النبي ﷺ عندما سألهم عن هجوم خيل عليهم، أنهم ........ | الرحمن، صدقوه، الأمانات، الحُمَّرة | صدقوه |
| q14 | طائر ........ هو الذي فُجع بولده فأمر النبي ﷺ برده إليه. | الرحمن، صدقوه، الأمانات، الحُمَّرة | الحُمَّرة |
| q15 | قال رسول الله ﷺ: «الراحمون يرحمهم ........» | الرحمن، صدقوه، الأمانات، الحُمَّرة | الرحمن |

**Not carried from the old lesson:**

- The links slide: two outside links (gemini.google.com) and their notes. Outside links are not lesson content.
- Slide 5 does not exist in the old lesson, yet q3, q4 and q12 ask about what it probably taught (الصادق الأمين, the trusts); those are held.

**Questions for the teachers:**

- q11–q15 were fill-in-the-blank with a 5-word bank; the lesson's quiz allows 4 options, so one wrong word was dropped from each. q11 drops الرحمن because «إلى الرحمن» would also fit. Confirm each.
- safa-002 tells that Allah commanded the Prophet ﷺ to call his relatives (26:214). Should a 26:214 reference be added? The old lesson does not cite it.
- q1, q2, q6 and q7 repeat lesson 8's quiz word for word. Keep them in both lessons?

## Lesson 10: صِدْقُهُ ﷺ

**Sections:** مرحباً (`welcome`)، صِدْقُهُ ﷺ (`sidquh`)

**Hadith (held, never shown):**

| Id | Text | Source as the old lesson gave it |
|---|---|---|
| sidquh-003 | قالوا: نَعَمْ، مَا جَرَّبْنَا عَلَيْكَ كَذِبًا!! | not stated |
| sidquh-004 | فقال ﷺ: فَإنِّي نَذِيرٌ لَكُمْ بَيْنَ يَدَيْ عَذَابٍ شَدِيدٍ | not stated |

**Other held lines:**

| Id | Line | Why it is held |
|---|---|---|
| sidquh-002 | فَلَمَّا جَاءُوا سَأَلَهُمْ رَسُولُ اللهِ ﷺ: لَوْ أَنَّهُ أَخْبَرَهُمْ بِأَنَّ خَيْلًا بِالْوَادِي تُرِيدُ أَنْ تَهْجُمَ عَلَيْهِمْ، فَهَلْ سَيُصَدِّقُونَهُ؟ | CHECK: retells in indirect speech the Prophet’s ﷺ words from a hadith the lesson does not cite; a teacher checks it against the held hadith |
| q3 | ماذا قال قومه عندما سألهم هل يصدقونه؟ | CHECK: quotes the words of the held hadith (sidquh-003); a teacher clears it with that hadith |
| q5 | قال قومه: جربنا عليك الكذب | CHECK: quotes the words of the held hadith (sidquh-003); a teacher clears it with that hadith |

**The quiz:**

| Id | Question | Options | Right answer |
|---|---|---|---|
| q1 | ماذا فعل النبي ﷺ عندما أمره الله أن يدعو أقاربه؟ | ذهب إلى المدينة، صعد جبل الصفا ونادى أقاربه، أرسل رسائل لهم | صعد جبل الصفا ونادى أقاربه |
| q2 | أين صعد النبي ﷺ لينادي أقاربه؟ | جبل أُحُد، جبل الصفا، جبل النور | جبل الصفا |
| q3 | ماذا قال قومه عندما سألهم هل يصدقونه؟ | لا نصدقك، نعم، ما جربنا عليك كذباً، لا نعرف | نعم، ما جربنا عليك كذباً |
| q4 | صعد النبي ﷺ جبل الصفا لينادي أقاربه | صَحِيحٌ، خَطَأٌ | صَحِيحٌ |
| q5 | قال قومه: جربنا عليك الكذب | صَحِيحٌ، خَطَأٌ | خَطَأٌ |
| q6 | أمر الله النبي ﷺ أن يدعو أقاربه إلى عبادة الله وحده | صَحِيحٌ، خَطَأٌ | صَحِيحٌ |

**Not carried from the old lesson:**

- True/false statement 4 («قال النبي ﷺ: إني نذير لكم بين يدي عذاب شديد»): it is Quran (34:46) typed into a quiz line, which a quiz cannot hold.
- The matching game: pair 4's answer is a run of 34:46, and pairs 1–3 repeat q1–q3.
- The ordering game (6 events): ordering is not a quiz kind yet, and event 6 carries the 34:46 run.

**Questions for the teachers:**

- sidquh-004 (held hadith) quotes 34:46 in the Prophet's ﷺ words. Should a 34:46 reference stand beside it?

## Lesson 11: أمانة النبي ﷺ

**Sections:** مرحباً (`welcome`)، لقب النبي ﷺ (`laqab`)، ثقة الناس بالنبي ﷺ (`thiqa`)، أمانة النبي ﷺ عند الهجرة (`hijra`)، النهاية (`summary`)

**Other held lines:** none.

**The quiz:**

| Id | Question | Options | Right answer |
|---|---|---|---|
| q1 | كان النبي ﷺ يلقب بالصادق الأمين قبل بعثته | صَحِيحٌ، خَطَأٌ | صَحِيحٌ |
| q2 | ترك النبي ﷺ أمانات الناس عندما هاجر من مكة | صَحِيحٌ، خَطَأٌ | خَطَأٌ |
| q3 | طلب النبي ﷺ من علي بن أبي طالب رد الأمانات لأصحابها | صَحِيحٌ، خَطَأٌ | صَحِيحٌ |
| q4 | كان الناس يخافون أن يتركوا أموالهم عند النبي ﷺ | صَحِيحٌ، خَطَأٌ | خَطَأٌ |
| q5 | بماذا كان يلقب النبي ﷺ قبل بعثته؟ | الشجاع المقدام، الصادق الأمين، الكريم الحليم | الصادق الأمين |
| q6 | من الذي طلب منه النبي ﷺ رد الأمانات عند الهجرة؟ | أبو بكر الصديق، عمر بن الخطاب، علي بن أبي طالب | علي بن أبي طالب |
| q7 | لماذا كان الناس يحفظون أموالهم عند النبي ﷺ؟ | لأنه كان غنياً، لأنه كان أميناً وصادقاً، لأنه كان قوياً | لأنه كان أميناً وصادقاً |
| q8 | لقب النبي ﷺ قبل البعثة | المدينة المنورة، الصادق الأمين، أموالهم وأشياءهم الثمينة، علي بن أبي طالب | الصادق الأمين |
| q9 | من ردّ الأمانات عند الهجرة | المدينة المنورة، الصادق الأمين، أموالهم وأشياءهم الثمينة، علي بن أبي طالب | علي بن أبي طالب |
| q10 | هاجر النبي ﷺ من مكة إلى | المدينة المنورة، الصادق الأمين، أموالهم وأشياءهم الثمينة، علي بن أبي طالب | المدينة المنورة |
| q11 | كان الناس يحفظون عند النبي ﷺ | المدينة المنورة، الصادق الأمين، أموالهم وأشياءهم الثمينة، علي بن أبي طالب | أموالهم وأشياءهم الثمينة |

**Not carried from the old lesson:**

- The ordering game (5 events): ordering is not a quiz kind yet.

**Questions for the teachers:**

- q8–q11 were a matching game: each stem became a choose question, all four sharing the same four answers. Confirm.

## Lesson 20: محمد ﷺ نبيي

**Sections:** السلام عليكم ورحمة الله! (`welcome`)، أهداف الدرس (`objectives`)، محمد ﷺ نبيي (`my_prophet`)، محمد ﷺ عبد الله ورسوله (`servant_messenger`)، ذكر الصباح والمساء (`dhikr`)، أحب نبيي ﷺ وأطيعه (`love_obey`)، ماذا نقول عندما يُذكر النبي؟ (`salawat`)

**Quran references** (the ayat are drawn from the verified text):

| Id | Reference |
|---|---|
| my_prophet-003 | الأعراف 7:158 |
| servant_messenger-002 | الكهف 18:1 |
| servant_messenger-005 | الأحزاب 33:40 |
| love_obey-006 | النساء 4:13 |
| salawat-002 | الأحزاب 33:56 |

**Hadith (held, never shown):**

| Id | Text | Source as the old lesson gave it |
|---|---|---|
| dhikr-002 | مَا مِنْ عَبْدٍ مُسْلِمٍ يَقُولُ حِينَ يُصْبِحُ وَحِينَ يُمْسِي ثَلَاثَ مَرَّاتٍ: رَضِيتُ بِاللهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ ﷺ نَبِيًّا، إِلَّا كَانَ حَقًّا عَلَى اللهِ أَنْ يُرْضِيَهُ يَوْمَ الْقِيَامَةِ | رواه أحمد وأبو داود (no number stated) |
| salawat-003 | مَنْ صَلَّى عَلَيَّ صَلَاةً وَاحِدَةً، صَلَّى الله عَلَيْهِ عَشْرَ صَلَوَاتٍ، وَحَطَّ عَنْهُ عَشْرَ خَطِيئَاتٍ | رواه مسلم (no number stated) |
| salawat-004 | الْبَخِيلُ مَنْ ذُكِرْتُ عِنْدَهُ، ثُمَّ لَمْ يُصَلِّ عَلَيَّ | رواه الترمذي (no number stated) |

**Other held lines:**

| Id | Line | Why it is held |
|---|---|---|
| welcome-004 | السلام عليكم ورحمة الله وبركاته! أهلًا بكم يا أحبائي في درس جديد. اليوم سنتعرف على نبينا الحبيب محمد صلى الله عليه وسلم. | CHECK: the old slide's voice-over script note (shown on the slide under a microphone icon); keep it as narration or drop it |
| dhikr-003 | رَضِيتُ بِاللهِ رَبًّا وَبِالْإِسْلَامِ دِينًا وَبِمُحَمَّدٍ ﷺ نَبِيًّا | CHECK: the dhikr is the wording of the held hadith above; check it together with that hadith |
| salawat-005 | لا تكن بخيلًا! صلِّ على النبي ﷺ كلما ذُكر اسمه! | CHECK: a practice ruling (salawat every time he is mentioned) resting on the held hadith above; a qualified scholar confirms the wording |

**The quiz:**

| Id | Question | Options | Right answer |
|---|---|---|---|
| q1 | من هو نبينا؟ | إبراهيم عليه السلام، محمد ﷺ ابن عبد الله بن عبد المطلب، موسى عليه السلام، عيسى عليه السلام | محمد ﷺ ابن عبد الله بن عبد المطلب |
| q2 | النبي ﷺ أُرسل إلى العرب فقط | صَحِيحٌ، خَطَأٌ | خَطَأٌ |
| q3 | ماذا أنزل الله على نبينا محمد ﷺ؟ | القرآن الكريم، التوراة، الإنجيل، الزبور | القرآن الكريم |
| q4 | ماذا نقول عندما يُذكر النبي ﷺ؟ | سبحان الله، الحمد لله، صلى الله عليه وسلم، لا حول ولا قوة إلا بالله | صلى الله عليه وسلم |
| q5 | من أطاع الرسول ﷺ دخل الجنة | صَحِيحٌ، خَطَأٌ | صَحِيحٌ |

**Not carried from the old lesson:**

- One line on the love-and-obey slide: it carries 5 consecutive words of 4:13 as typed Quran. 4:13 is referenced by love_obey-006 instead.
- Quiz 4 (fill in the blank): it had no options, and its prompt is the held hadith's wording.

**Questions for the teachers:**

- dhikr-003 and salawat-005 rest on held hadith (dhikr-002, salawat-004): they are settled together with those hadith.
