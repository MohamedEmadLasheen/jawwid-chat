# Store listing copy and screenshot shot list (Arabic first)

**Launch item LR-09. Draft, 2026-11-08.** Every sentence below describes something the app on `main` @
`cf731af2` does. Nothing is promised that the code cannot show.

**Rules this copy follows**
- **Arabic first**, then English. Arabic is the primary language (`AGENTS.md`).
- **Written to parents and teachers**, never to children. No "For Kids" or "For Children" (Apple 2.3.8),
  no child imagery, no cartoon art (Play target audience; `play-declarations.md` §1).
- **"Lesson package" (باقة دروس), never "subscription" (اشتراك).** Families pay for live one-to-one
  lessons, a service; the word "subscription" would read as an auto-renewing digital subscription
  (Apple 3.1.2; launch item LR-15).
- **Payments are described as live one-to-one lessons**, matching the pay sheet and
  `docs/release/app-review-notes-payments.md` §2–§3: "one teacher and one student, in real time; lessons
  are not recorded".
- **No unbacked claims:** no "best", "certified", "ijazah", "guaranteed", no number of teachers or
  students, no price, no recording or replay.
- Character limits (check them in the Console as you paste): Apple name 30, subtitle 30, promotional
  text 170, description 4000, keywords 100; Play title 30, short description 80, full description 4000.

---

## 1. App name

| Store | Arabic | English |
|---|---|---|
| App Store name (30) | جَوِّد: أكاديمية القرآن | Jawwid: Quran Academy |
| Play title (30) | جَوِّد: أكاديمية القرآن | Jawwid: Quran Academy |

`[OWNER DECISION: the final name.]` The installed app is called "Jawwid Chat" on iOS
(`ios/Runner/Info.plist:14-15`) and «جَوِّد» / "Jawwid" on Android
(`android/app/src/main/res/values-ar/strings.xml:5`, `values/strings.xml:6`). Apple expects the store
name and the name under the icon to be recognisably the same app; "Jawwid" is common to all of them. The
store name must also be free in App Store Connect.

## 2. Apple subtitle (30)

- **AR:** دروس قرآن فردية مباشرة
- **EN:** Live one-to-one Quran lessons

## 3. Play short description (80)

- **AR:** دروس قرآن فردية مباشرة، ومحادثة أسرتك مع المعلّم والمشرف في مكان واحد.
- **EN:** Live one-to-one Quran lessons, and your family's chat with the teacher.

## 4. Apple promotional text (170, optional, can change without a new build)

- **AR:** تابع دروس القرآن الفردية المباشرة لأبنائك، وتواصل مع المعلّم والمشرف بالرسائل والمكالمات الصوتية، من تطبيق واحد.
- **EN:** Follow your children's live one-to-one Quran lessons and talk to their teacher and supervisor by message or voice call, all in one app.

## 5. Full description (Apple description and Play full description; 4000)

### 5.1 Arabic

```text
جَوِّد هو تطبيق أكاديمية جَوِّد لتعليم القرآن الكريم، يجمع الأسرة والمعلّم والمشرف في مكان واحد.

يحتاج التطبيق إلى حساب في الأكاديمية: تفعّل الأسرة المسجّلة حسابها بالبريد الإلكتروني الذي سجّلته لدى الأكاديمية.

دروس فردية مباشرة
• كل درس مكالمة صوتية مباشرة بين معلّم واحد وطالب واحد.
• لا يتم تسجيل الدروس.
• جدول الدروس القادمة في متناولك، مع تقرير المعلّم بعد الدرس.

تواصل مع المعلّم والمشرف
• مجموعة للأسرة تضم المعلّم والمشرف، ومحادثات فردية.
• رسائل نصية وصوتية، وصور وفيديو وملفات.
• مكالمات صوتية من داخل التطبيق.
• إعلانات الأكاديمية في مكان واحد.

مواد تعليمية
• مواد وأنشطة تعليمية يفتحها المعلّم للطالب.

المدفوعات
• ادفع باقة الدروس ببطاقة عبر صفحة Stripe الآمنة، أو بالتحويل البنكي مع رفع إيصال التحويل.
• اطّلع على المدفوعات والفواتير.

الخصوصية والأمان
• قفل التطبيق ببصمة الوجه أو الإصبع أو رمز الجهاز.
• لا تظهر الأسماء في إشعارات شاشة القفل إلا إذا فعّلت ذلك.
• الإبلاغ عن رسالة أو شخص، وحظر شخص.
• حذف الحساب من الإعدادات في أي وقت.

للمعلّمين
• جدول الدروس، وكتابة تقرير الدرس، والتواصل مع الأسر والمشرف.

التطبيق باللغتين العربية والإنجليزية.

سياسة الخصوصية: {{PRIVACY_POLICY_URL}}
شروط الاستخدام: {{TERMS_URL}}
الدعم: {{SUPPORT_URL}}
```

### 5.2 English

```text
Jawwid is the app of the Jawwid Quran academy. It brings the family, the teacher and the supervisor together in one place.

You need an account with the academy: an enrolled family activates its account with the e-mail address it registered with the academy.

Live one-to-one lessons
• Each lesson is a live audio call between one teacher and one student.
• Lessons are not recorded.
• See the upcoming lesson schedule, and read the teacher's report after each lesson.

Talk to the teacher and the supervisor
• A family group with the teacher and the supervisor, and one-to-one chats.
• Text and voice messages, photos, videos and files.
• Voice calls inside the app.
• The academy's announcements in one place.

Learning materials
• Materials and activities the teacher opens for the student.

Payments
• Pay for a lesson package by card on Stripe's secure page, or by bank transfer with the transfer receipt uploaded in the app.
• See your payments and invoices.

Privacy and safety
• Lock the app with Face ID, fingerprint or the device passcode.
• Names stay hidden in lock-screen notifications unless you turn them on.
• Report a message or a person, and block a person.
• Delete your account from Settings at any time.

For teachers
• The lesson schedule, lesson reports, and chats with families and the supervisor.

The app is in Arabic and English.

Privacy Policy: {{PRIVACY_POLICY_URL}}
Terms of Use: {{TERMS_URL}}
Support: {{SUPPORT_URL}}
```

### 5.3 What each claim rests on (for the second reader)

| Claim | Evidence |
|---|---|
| Live one-to-one lessons, not recorded | `docs/release/app-review-notes-payments.md` §2 (schema: one learner per lesson; no LiveKit egress) |
| Lesson schedule and teacher's report | `lib/core/data/http/http_lesson_repository.dart:54`, `:59` (the teacher writes the report); review cohort has upcoming lessons (`docs/release/review-accounts.md`) |
| Family group, one-to-one chats, voice messages, photos, videos, files | `lib/core/data/http/http_message_repository.dart:99`, `:215`; `lib/core/audio/voice_recorder.dart:80`; `lib/core/media/media_picker.dart` |
| Voice calls | `lib/core/data/http/http_call_repository.dart:55-106`; `lib/features/calls/` |
| Announcements | `lib/core/data/http/http_story_repository.dart` |
| Materials and activities | `lib/features/materials/` |
| Card on Stripe's page, bank transfer with receipt, invoices | `lib/core/data/http/http_billing_repository.dart:31-93`; `lib/features/billing/presentation/my_payments_screen.dart:323-330`. **Card appears only if live Stripe keys are configured** (launch item LR-34). If the owner launches without them, delete "by card on Stripe's secure page" from both languages. |
| App lock | `ios/Runner/Info.plist:65-69`; `android/app/src/main/AndroidManifest.xml:14-17` |
| Names hidden on the lock screen by default | `docs/legal/data-inventory-and-retention-matrix.md` §2 (APNs row: `notification.lock_screen_names_default: false`) |
| Report and block | PD-57: `lib/core/data/http/http_moderation_repository.dart:21`; `lib/core/data/http/http_block_repository.dart:23` |
| Delete account in Settings | `lib/features/settings/presentation/settings_screen.dart:277-285`. **Teachers:** true only after launch item LR-03 (PR #498); today a teacher with lessons ahead is refused |
| Arabic and English | `ios/Runner/Info.plist:9-13`; `lib/l10n/` |
| Account needed; activation with the registered e-mail | `lib/core/data/http/http_parent_signup_repository.dart:18`, `:49-50` |

`[OWNER DECISION: does the academy also teach Arabic or tajweed as separate courses?]` `pubspec.yaml:2`
calls it "the Jawwid Quran and Arabic academy", but only Quran lessons are payable in the app. The copy
says Quran only. Add Arabic only if Arabic lessons are offered to the families who use this app.

## 6. Apple keywords (100, comma-separated, no spaces)

Words already in the name ("Quran", "Jawwid", "Academy") are not repeated; Apple indexes the name already.

- **AR:** `تحفيظ,تلاوة,تجويد,معلم,معلمة,دروس,حفظ,مراجعة,تعليم`
  (42 letters + 8 commas. If the Console counts bytes, Arabic letters count double: 92 bytes, still under 100.)
- **EN:** `lessons,teacher,tutor,memorization,hifz,recitation,tajweed,islamic,live,one-to-one,family,parents`
  (97 characters)

`[OWNER DECISION: keep "tajweed" / «تجويد» only if lessons include tajweed.]` Never add another app's or
academy's name.

## 7. What's new (first release)

- **AR:** الإصدار الأول من جَوِّد.
- **EN:** The first release of Jawwid.

## 8. Category

- **Apple:** primary **Education**; no secondary category `[OWNER DECISION]`. Not "Kids" (`age-rating.md` §1.4).
- **Play:** **Education** (`play-declarations.md` §8).

## 9. Screenshot shot list

### 9.1 Sizes

**Re-check the live pages on the day:** Apple
<https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/> and Play
<https://support.google.com/googleplay/android-developer/answer/9866151>. They could not be read from this
machine when this was drafted; the sizes below are the long-standing requirements.

| Store | Required | Size | Count |
|---|---|---|---|
| Apple, iPhone | **6.9-inch display** (Apple scales it down for smaller iPhones) | 1320 × 2868 px portrait (1290 × 2796 also accepted) | 1 to 10 per language; plan 6 |
| Apple, iPad | **Not required.** The app is iPhone only: `TARGETED_DEVICE_FAMILY = 1` for the Runner target (`ios/Runner.xcodeproj/project.pbxproj:409`, `:593`, `:618`) | — | — |
| Play, phone | **Required** | 9:16 portrait, each side 320–3840 px; 1080 × 1920 px or larger (needed for Play's recommendations) | 2 to 8 per language; plan 6 |
| Play, tablets (7-inch and 10-inch) | Optional; only for a tablet-ready listing | — | — |
| Play, feature graphic | **Required** | 1024 × 500 px, JPG or 24-bit PNG, no transparency | 1 per language |
| Play, app icon | **Required** | 512 × 512 px, 32-bit PNG | 1 (launch item LR-36: the owner supplies a vector logo) |
| Apple, app icon | From the build | 1024 × 1024 px | 1 (LR-36: today's is an upscale) |

Each shot is taken **twice**: Arabic (right to left) with the phone in Arabic, and English.

### 9.2 Shots

Use only the review cohort (`docs/release/review-accounts.md`): fictional parent "Mariam Adel", teacher
"Hassan Mourad", child "Yahya Adel".

| # | Screen | Account | Shows | Caption AR | Caption EN | Blocked by |
|---|---|---|---|---|---|---|
| 1 | Chats list | Parent | Family group, the supervisor chat | تواصل مع المعلّم والمشرف | Talk to the teacher and supervisor | LR-01, LR-05 |
| 2 | Family group chat | Parent | A text message, a voice message, a photo of a notebook page (no face, no handwriting with a real name) | رسائل نصية وصوتية وصور | Text, voice messages and photos | LR-05 |
| 3 | Audio call in progress | Parent with teacher | The call screen with the teacher's name | دروس فردية مباشرة بالصوت | Live one-to-one audio lessons | LR-05; a second phone |
| 4 | Lesson schedule | Parent | Upcoming Monday, Wednesday, Friday lessons | جدول الدروس القادمة | Your upcoming lessons | LR-05 |
| 5 | Pay sheet | Parent | The amount due and the line "Live one-to-one Quran lessons: one teacher and one student, in real time. Lessons are not recorded." | ادفع باقة الدروس بسهولة | Pay for a lesson package | An open request in the review cohort (`play-declarations.md` §2); **the tab name** (below) |
| 6 | Settings | Parent | App lock, Language, Delete account | خصوصيتك بين يديك | Your privacy, your control | — |
| 7 (optional) | Lesson report | Parent | The teacher's report on a past lesson | تقرير المعلّم بعد كل درس | The teacher's report after each lesson | Past lessons with reports need the owner's content approval (`review-accounts.md`, "Still open") |
| 8 (optional) | Teacher's day | Teacher | Today's lessons | للمعلّمين: جدول اليوم | For teachers: today's lessons | LR-05 |

**Rules for every shot**
- **No photo of any child or real person.** Avatars show initials. No cartoon children.
- **No Quran text in a screenshot** unless the academy's qualified reviewer has checked it (Quran data is a
  Code Owner path; religious content needs qualified approval). Shot 7 must not show a surah's text.
- **No "Subscriptions" / «الاشتراكات» on screen.** LR-15 renamed the parent's payment tab to
  "Packages" / «الباقات» (`tabSubscriptions` in `lib/l10n/app_en.arb` and `app_ar.arb`; the key and the
  `/subscriptions` route keep their old names). Take shot 5 (and any shot showing the bottom bar) only
  from a build that has the rename, or crop the bottom bar out.
- A clean status bar (full battery, signal, a neutral time such as 9:41), no debug banner, a release build
  against the production backend.
- Captions are optional. If used, they repeat only claims from §5.3.

## 10. Before you paste

- [ ] Name, keywords and category decided (§1, §6, §8).
- [ ] Every `{{...}}` URL is live in both languages (LR-04).
- [ ] Card payment is live at launch, or the card sentence is removed (LR-34).
- [ ] Teacher deletion works in the app (LR-03), or "Delete your account … at any time" is reworded.
- [ ] The submitted build's payment tab says "Packages" / «الباقات», not "Subscriptions" (LR-15).
- [ ] A second person reads §5 against the app on a phone.
