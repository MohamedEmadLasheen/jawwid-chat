# PD-49 games: the Arabic copy, for the Teachers department's review

Every Arabic string the games show or speak to a screen reader, taken from the code (`apps/lessons/src/play`). Regenerate the table after any copy change. The verses themselves are not here: they are the verified text, never edited.

**How a string is held until approved.** Every string here is in a game's file or in the shared play code, and the signed code covers both (`check-quran-content.py` `SHARED_CODE`). A game reaches a child only after a teacher **and** the scholar sign its mechanic (signed `play.json`). So **the teacher's signature is the approval of this copy**, and a changed string unsigns every game that shows it. This document is the checklist the teacher signs against.

## Rules the copy follows (2026-10-29)
- **Modern Standard Arabic, short and simple.** The child's instructions use the first person plural (هيّا… / لنلمس… / نردّد…). This is natural for a game played with a grown-up, and it is gender-neutral, with no اِلمسْ / اِلمسي choice.
- **The grown-up's controls are nouns** (إعادة اللعبة، تخطّي اللعبة، إيقاف، تشغيل التلاوة، متابعة), not commands.
- **Numbers are Arabic-Indic digits** (`toLocaleString('ar-EG')`). Counts agree with the noun: آية واحدة، آيتين، ٣–١٠ آيات، ١١+ آية.
- **Praise is unvowelled** (أحسنت), so it reads for a boy or a girl.
- **3–5 is being redesigned** as a pre-reader mode with spoken clips and no text for the child (mock under review). Its strings below are interim.

## Status
**Awaiting the Teachers department's review.** Mark each line ✓ or give a correction. A teacher's signature on a mechanic confirms that game's strings.

| # | File : line | Who reads it | Text | Review |
|---|---|---|---|---|
| 1 | `PlayLesson.tsx:178` | everyone (page state) | تعذّر التحقق من نص السورة، فلم يُعرض شيء منه. | |
| 2 | `PlayLesson.tsx:182` | everyone (page state) | جارٍ التحميل… | |
| 3 | `PlayLesson.tsx:186` | child | ألعاب سورة ${s.info.nameAr} | |
| 4 | `PlayLesson.tsx:192` | everyone (page state) | الألعاب قيد المراجعة: لا تظهر لعبة قبل أن يعتمدها المعلم والمراجع الشرعي. | |
| 5 | `PlayLesson.tsx:201` | everyone (page state) | جارٍ تجهيز الألعاب… | |
| 6 | `PlayLesson.tsx:216` | grown-up | الآيات التالية ← | |
| 7 | `PlayLesson.tsx:224` | everyone (page state) | لا توجد لعبة لهذه الآيات بعد. | |
| 8 | `PlayLesson.tsx:247` | grown-up | ⚙ للكبار | |
| 9 | `PlayLesson.tsx:250` | screen reader | أدوات الكبير | |
| 10 | `PlayLesson.tsx:254` | grown-up | ↻ إعادة اللعبة | |
| 11 | `PlayLesson.tsx:257` | grown-up | ⏭ تخطّي اللعبة | |
| 12 | `PlayLesson.tsx:260` | grown-up | ■ إيقاف | |
| 13 | `PlayLesson.tsx:266` | grown-up | 🔊 تشغيل التلاوة | |
| 14 | `PlayLesson.tsx:266` | grown-up | 🔇 بلا تلاوة | |
| 15 | `PlayLesson.tsx:270` | grown-up | أ− تصغير الآيات | |
| 16 | `PlayLesson.tsx:273` | grown-up | أ+ تكبير الآيات | |
| 17 | `PlayLesson.tsx:275` | screen reader | عمر الطفل | |
| 18 | `PlayLesson.tsx:276` | grown-up | العمر: | |
| 19 | `PlayLesson.tsx:293` | child | توقّفت الألعاب. | |
| 20 | `PlayLesson.tsx:296` | grown-up | متابعة | |
| 21 | `PlayLesson.tsx:312` | child | أحسنت! انتهت ألعاب هذه الآيات | |
| 22 | `games/AyahNumber.tsx:75` | screen reader | رقم الآية | |
| 23 | `games/AyahNumber.tsx:78` | child | ما رقم هذه الآية؟ | |
| 24 | `games/AyahNumber.tsx:82` | screen reader | الأرقام | |
| 25 | `games/AyahNumber.tsx:86` | child | ✓ أحسنت | |
| 26 | `games/AyahNumber.tsx:86` | child | ✓ هذه هي | |
| 27 | `games/AyahNumber.tsx:93` | child | أيّ الآيتين تأتي أولًا في السورة؟ | |
| 28 | `games/AyahNumber.tsx:94` | screen reader | الآيتان | |
| 29 | `games/AyahNumber.tsx:103` | child | لنحاول مرة أخرى | |
| 30 | `games/AyahNumber.tsx:108` | child | التالي ← | |
| 31 | `games/BuildAyah.tsx:94` | screen reader | ركّب الآية | |
| 32 | `games/BuildAyah.tsx:105` | screen reader | الكلمات المرتّبة: ${arabic(placed.length)} من ${arabic(current.tiles.length)}: | |
| 33 | `games/BuildAyah.tsx:114` | screen reader | الكلمات | |
| 34 | `games/BuildAyah.tsx:120` | child | ✓ هذه هي | |
| 35 | `games/BuildAyah.tsx:126` | child | هذه هي الكلمة التالية | |
| 36 | `games/BuildAyah.tsx:126` | child | لنحاول مرة أخرى | |
| 37 | `games/BuildAyah.tsx:133` | child | التالي ← | |
| 38 | `games/BuildAyah.tsx:136` | screen reader | الآيات | |
| 39 | `games/CompleteAyah.tsx:117` | screen reader | أكمل الآية | |
| 40 | `games/CompleteAyah.tsx:140` | screen reader | الكلمة الناقصة | |
| 41 | `games/CompleteAyah.tsx:140` | screen reader | كلمة ناقصة أخرى | |
| 42 | `games/CompleteAyah.tsx:149` | screen reader | الاختيارات | |
| 43 | `games/CompleteAyah.tsx:159` | child | ✓ هذه هي | |
| 44 | `games/CompleteAyah.tsx:165` | child | هذه هي الكلمة | |
| 45 | `games/CompleteAyah.tsx:165` | child | لنحاول مرة أخرى | |
| 46 | `games/CompleteAyah.tsx:172` | child | التالي ← | |
| 47 | `games/CountAyat.tsx:13` | child | آية واحدة | |
| 48 | `games/CountAyat.tsx:13` | child | آيتين | |
| 49 | `games/CountAyat.tsx:13` | child | ${arabic(n)} ${n <= 10 ? 'آيات' : 'آية'} | |
| 50 | `games/CountAyat.tsx:28` | screen reader | عُدّ الآيات | |
| 51 | `games/CountAyat.tsx:29` | child | لنلمس الآية المضيئة: نسمعها ونعدّها | |
| 52 | `games/CountAyat.tsx:29` | child | يقرأ الكبير الآية المضيئة، ثم نلمسها لنعدّها | |
| 53 | `games/CountAyat.tsx:35` | screen reader | الآيات التي عددتها | |
| 54 | `games/CountAyat.tsx:36` | child | أحسنت! عددنا ${ayatCount(ayahs.length)} | |
| 55 | `games/Echo.tsx:49` | screen reader | ردّد معي | |
| 56 | `games/Echo.tsx:56` | child | والآن دورنا: نردّد الآية معًا | |
| 57 | `games/Echo.tsx:58` | child | ✓ ردّدناها | |
| 58 | `games/Echo.tsx:63` | child | 🔊 لنستمع | |
| 59 | `games/Echo.tsx:66` | screen reader | مرات الترديد | |
| 60 | `games/FadingAyah.tsx:72` | screen reader | المحو التدريجي | |
| 61 | `games/FadingAyah.tsx:74` | child | هذه هي الآية كاملة | |
| 62 | `games/FadingAyah.tsx:74` | child | لنقرأ الآية ${arabic(current.ayah.ayah)} بصوت مسموع | |
| 63 | `games/FadingAyah.tsx:74` | child | لنقرأها مرة أخرى، ولو خفيت بعض كلماتها | |
| 64 | `games/FadingAyah.tsx:82` | screen reader | الآية ${arabic(current.ayah.ayah)}، وفيها ${arabic(hidden.size)} من الكلمات مخفية: | |
| 65 | `games/FadingAyah.tsx:104` | screen reader | الكلمة: | |
| 66 | `games/FadingAyah.tsx:109` | screen reader | أول حرف: | |
| 67 | `games/FadingAyah.tsx:114` | screen reader | كلمة مخفية، تظهر عند لمسها | |
| 68 | `games/FadingAyah.tsx:126` | child | 🔊 لنستمع إليها | |
| 69 | `games/FadingAyah.tsx:131` | child | التالي ← | |
| 70 | `games/FadingAyah.tsx:135` | child | نبقي الحرف الأول من كل كلمة | |
| 71 | `games/FadingAyah.tsx:135` | child | نخفي كلمات أخرى | |
| 72 | `games/FadingAyah.tsx:139` | child | نكشف الآية | |
| 73 | `games/ListenGlow.tsx:22` | screen reader | اسمع والمس | |
| 74 | `games/ListenGlow.tsx:23` | child | لنلمس الآية ونسمعها | |
| 75 | `games/ListenGlow.tsx:29` | screen reader | الآيات التي سمعتها | |
| 76 | `games/NextAyah.tsx:91` | child | ما الآية التي تأتي بعدها؟ | |
| 77 | `games/NextAyah.tsx:91` | child | ما الآية التي تأتي قبلها؟ | |
| 78 | `games/NextAyah.tsx:94` | screen reader | ما الآية التالية؟ | |
| 79 | `games/NextAyah.tsx:99` | screen reader | الاختيارات | |
| 80 | `games/NextAyah.tsx:113` | child | لنحاول مرة أخرى | |
| 81 | `games/NextAyah.tsx:118` | child | التالي ← | |
| 82 | `games/OrderAyat.tsx:117` | screen reader | رتّب الآيات | |
| 83 | `games/OrderAyat.tsx:119` | child | أيّ الآيتين تأتي أولًا؟ | |
| 84 | `games/OrderAyat.tsx:119` | child | أحسنت! هذا ترتيبها | |
| 85 | `games/OrderAyat.tsx:119` | child | لنلمس الآية التي تأتي أولًا | |
| 86 | `games/OrderAyat.tsx:119` | child | لنلمس الآية التي تليها | |
| 87 | `games/OrderAyat.tsx:128` | screen reader | إلى آية ${SHAPE_NAMES[i % SHAPE_NAMES.length]} | |
| 88 | `games/OrderAyat.tsx:137` | screen reader | الآيات المرتّبة | |
| 89 | `games/OrderAyat.tsx:146` | screen reader | الآيات | |
| 90 | `games/OrderAyat.tsx:156` | child | هذه هي الآية التالية | |
| 91 | `games/OrderAyat.tsx:156` | child | لنحاول مرة أخرى | |
| 92 | `games/OrderAyat.tsx:161` | child | التالي ← | |
| 93 | `games/OrderAyat.tsx:164` | screen reader | الجولات | |
| 94 | `games/StartEnd.tsx:105` | screen reader | بداية ونهاية | |
| 95 | `games/StartEnd.tsx:106` | child | لنلمس بداية آية، ثم نهايتها | |
| 96 | `games/StartEnd.tsx:108` | screen reader | آيات اكتملت | |
| 97 | `games/StartEnd.tsx:118` | child | التالي ← | |
| 98 | `games/StartEnd.tsx:122` | child | البدايات | |
| 99 | `games/StartEnd.tsx:129` | screen reader | بداية آية: | |
| 100 | `games/StartEnd.tsx:138` | child | النهايات | |
| 101 | `games/StartEnd.tsx:148` | screen reader | نهاية آية: | |
| 102 | `games/StartEnd.tsx:151` | child | ✓ هذه هي | |
| 103 | `games/StartEnd.tsx:157` | child | لنختر بداية أولًا | |
| 104 | `games/StartEnd.tsx:157` | child | هذه هي نهايتها | |
| 105 | `games/StartEnd.tsx:157` | child | لنحاول مرة أخرى | |
| 106 | `games/WhichHeard.tsx:56` | child | هذه السورة قصيرة جدًّا لهذه اللعبة. | |
| 107 | `games/WhichHeard.tsx:73` | screen reader | أيّ آية سمعت؟ | |
| 108 | `games/WhichHeard.tsx:75` | child | 🔊 لنستمع | |
| 109 | `games/WhichHeard.tsx:77` | child | أيّ آية سمعنا؟ | |
| 110 | `games/WhichHeard.tsx:91` | child | لنحاول مرة أخرى | |
| 111 | `games/WhichHeard.tsx:96` | child | التالي ← | |
| 112 | `games/WhichHeard.tsx:99` | screen reader | الجولات | |
| 113 | `games/common.tsx:87` | screen reader | الدائرة | |
| 114 | `games/common.tsx:87` | screen reader | المثلث | |
| 115 | `games/common.tsx:87` | screen reader | المربع | |
| 116 | `games/common.tsx:87` | screen reader | النجمة | |
| 117 | `games/common.tsx:87` | screen reader | المعيّن | |
| 118 | `games/common.tsx:137` | screen reader | الآية | |
| 119 | `games/common.tsx:145` | child | ✓ أحسنت | |
| 120 | `games/common.tsx:145` | child | ✓ هذه هي | |
| 121 | `games/common.tsx:160` | screen reader | ${label}: ${arabic(done)} من ${arabic(total)} | |
| 122 | `games/common.tsx:166` | child | أحسنت! ما شاء الله | |
| 123 | `games/common.tsx:186` | screen reader | لنراجع هذه الآيات | |
| 124 | `games/common.tsx:187` | child | أحسنت! انتهت اللعبة | |
| 125 | `games/common.tsx:195` | child | التالي ← | |
