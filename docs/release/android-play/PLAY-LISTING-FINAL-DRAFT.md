# Google Play listing: final draft (Jawwid), for the owner to paste

Status: DRAFT FOR OWNER APPROVAL. Nothing was entered in any console. Source: PR #591 `listing-copy.md` (card-free; PR #591 is unmerged, do not use the text on `main`, which still mentions card payments). Changes made here: app name Jawwid; the first paragraph now states the parent-focused purpose; privacy, terms and support placeholders replaced by the live public URLs (English and Arabic privacy, terms and support pages all returned HTTP 200 on 2026-11-18). Arabic text is unchanged from #591 and still needs a native-speaker read.

## Title (limit 30)
`Jawwid` (6 characters). Arabic title (if a second language is added): `جَوِّد`.

## Short description (limit 80)
Owner approval is needed for the religious wording. Pick one:
- **Option 1 (text already in the repo docs):** Live one-to-one Quran lessons, and your family's chat with the teacher. (78 characters)
- **Option 2 (neutral, no religious claim; proposed, not yet approved):** Live one-to-one lessons, and your family's chat with the teacher and supervisor. (79 characters)
- Arabic (from #591): دروس قرآن فردية مباشرة، ومحادثة أسرتك مع المعلّم والمشرف في مكان واحد. (contains the Quran wording; same approval)

## Full description, English (limit 4000)
```text
Jawwid helps parents stay in touch with their child's teacher and the academy supervisor, and follow the lessons. It brings the family, the teacher and the supervisor together in one place.

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
• Pay for a lesson package by bank transfer, with the transfer receipt uploaded in the app.
• See your payments and invoices.

Privacy and safety
• Lock the app with Face ID, fingerprint or the device passcode.
• Names stay hidden in lock-screen notifications unless you turn them on.
• Report a message or a person, and block a person.
• Delete your account from Settings at any time.

For teachers
• The lesson schedule, lesson reports, and chats with families and the supervisor.

The app is in Arabic and English.

Privacy Policy: https://admin.chat.jawwid.com/legal/en/privacy
Terms of Use: https://admin.chat.jawwid.com/legal/en/terms
Support: https://admin.chat.jawwid.com/legal/en/support
```
Length: 1567 characters.

## Full description, Arabic (limit 4000)
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
• ادفع باقة الدروس بالتحويل البنكي مع رفع إيصال التحويل في التطبيق.
• اطّلع على المدفوعات والفواتير.

الخصوصية والأمان
• قفل التطبيق ببصمة الوجه أو الإصبع أو رمز الجهاز.
• لا تظهر الأسماء في إشعارات شاشة القفل إلا إذا فعّلت ذلك.
• الإبلاغ عن رسالة أو شخص، وحظر شخص.
• حذف الحساب من الإعدادات في أي وقت.

للمعلّمين
• جدول الدروس، وكتابة تقرير الدرس، والتواصل مع الأسر والمشرف.

التطبيق باللغتين العربية والإنجليزية.

سياسة الخصوصية: https://admin.chat.jawwid.com/legal/ar/privacy
شروط الاستخدام: https://admin.chat.jawwid.com/legal/ar/terms
الدعم: https://admin.chat.jawwid.com/legal/ar/support
```
Length: 1223 characters.

## Other store settings
- Category: Education (proposed, not final). Free. Contact email: info@jawwid.com (from the `store-release` variable `SUPPORT_EMAIL`).
- Privacy policy URL: https://admin.chat.jawwid.com/legal/en/privacy
- What's new (first release): "The first release of Jawwid." / AR: "الإصدار الأول من جَوِّد."
- Graphics: icon 512x512 (`assets/brand/play-store-icon-512.png`, not yet reviewed for final quality), feature graphic (`feature-graphic/feature-graphic-1024x500.png`, awaiting approval and the Quran-wording decision), phone screenshots: NOT YET MADE (need a phone or emulator).

## Claims check (each rests on code, per #591 section 5.3)
Live one-to-one lessons not recorded; schedule and the teacher's report; family group and one-to-one chats; voice messages, photos, videos, files; voice calls; announcements; materials; bank transfer with receipt uploaded and invoices (no card claim); app lock; lock-screen names hidden by default; report and block; delete account from Settings; Arabic and English. Not re-verified on a device.
