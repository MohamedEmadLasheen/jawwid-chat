# Wording options for the owner (2026-11-09)

Two Arabic wording decisions, each set out so it can be decided in about a minute. Tick one box per row.
Nothing here has been applied. The ARB and `InfoPlist.strings` files are being edited by other PRs, so
whatever is chosen goes into a small follow-up PR after those PRs land.

---

## 1. PARENT-016 (tracker LR-28): the Arabic word for a declined call

**The defect:** the declined outcome shows «مرفوضة» ("rejected"). `docs/design/screens/call.md` §3 says:
*"Declined: Plain, neutral, in both directions. Never 'rejected'."* The English "Declined" is fine and stays.
Source: `docs/qa/reviewer-visible-defects-2026-11-08.md` (PARENT-016 row).

**Where the key appears** (one key, `callOutcomeDeclined`, three screens):

| Screen | Code | How it reads today |
|---|---|---|
| Call-ended screen (shown on its own, both directions) | `lib/features/calls/presentation/active_call_screen.dart:229` | «مرفوضة» |
| Calls history row | `lib/features/calls/presentation/calls_screen.dart:722` | «مرفوضة» |
| Call card in the chat thread | `lib/features/calls/presentation/call_card.dart:94` | «مكالمة صوتية · مرفوضة» / «مكالمة جماعية · مرفوضة» |

**The words next to it** (`lib/l10n/app_ar.arb:149-181`), which the choice should not clash with:
`callOutcomeAnswered` «تم الرد» · `callOutcomeMissed` «فائتة» · `callOutcomeInProgress` «جارية» ·
`callNoAnswer` «لم يتم الرد» (already shown to the caller when an outgoing call was missed) ·
`callMissedIncoming` «مكالمة فائتة» · `callEnded` «انتهت المكالمة» · `callEndedConnectionLost`
«انتهت المكالمة: انقطع الاتصال».

### Options

| ☐ | Arabic | Literal meaning | Tone toward a parent | Length / fit | Clash with nearby strings | Verdict |
|---|---|---|---|---|---|---|
| ☐ **A (recommended)** | «تم الاعتذار» | "it was politely declined" (someone excused themselves) | Courteous. In Arabic, *اعتذر عن المكالمة* is the polite way to say someone could not take a call. It blames nobody and reads correctly to the caller and to the person who declined. | 2 words, about 11 letters (today: 6). Fits the history row and the card: «مكالمة صوتية · تم الاعتذار». | None. It follows the «تم الرد» pattern that "Answered" already uses, and stays different from missed, no answer and ended. | Neutral, accurate and distinct. |
| ☐ B | «لم يتم الرد» | "it was not answered" | Neutral. | Fits. | **The same text as `callNoAnswer`.** A declined call and an unanswered outgoing call would look identical, so the parent can no longer tell them apart. History would also show «لم يتم الرد» next to «فائتة» for two different outcomes. | Not recommended: it loses the information. |
| ☐ C | «أُنهيت المكالمة» | "the call was ended" | Neutral, a little cold. | 2 words. On the card it repeats "call": «مكالمة صوتية · أُنهيت المكالمة». | Almost the same as `callEnded` «انتهت المكالمة», which also shows when no outcome is known yet. A declined call would look like an answered call that ended. | Not recommended: it hides that the call was declined. |

Also considered and dropped: «لم تُقبل» ("not accepted") still carries the refusal the design forbids.

### Exactly what changes if A is chosen (proposed, not applied)

| File | Key | Today | Proposed |
|---|---|---|---|
| `lib/l10n/app_ar.arb:161` | `callOutcomeDeclined` | `"مرفوضة"` | `"تم الاعتذار"` |
| `lib/l10n/app_en.arb:166` | `callOutcomeDeclined` | `"Declined"` | no change |
| `lib/l10n/app_localizations_ar.dart:369` (generated) | `callOutcomeDeclined` | `'مرفوضة'` | regenerated from the ARB |

No test asserts the literal «مرفوضة» (checked with grep over `test/`). The **Decline button**
(`callDecline` «رفض») is an action, matches the platform's own call screen, and is out of scope here.

**Related, for a separate decision:** the Admin Web calls page uses the same word for the same outcome:
`apps/admin-web/src/features/calls-page/copy.ts:135` `declined: 'مرفوضة'`. If A is chosen, the same
change there keeps the two apps consistent. The other «مرفوضة» uses in Admin Web are certificates and
payments, where "rejected" is the correct meaning, and they stay as they are.

---

## 2. LR-41: the five Arabic iOS permission prompts

Files: `ios/Runner/ar.lproj/InfoPlist.strings`, English in `ios/Runner/en.lproj/InfoPlist.strings` (the
same text is in `ios/Runner/Info.plist` as the fallback). App Store guideline 5.1.1 asks each prompt to
say clearly why the app needs the access. All five do; the English needs no change.

| ☐ | Key | English (today) | Arabic (today) | Back-translation of the Arabic | States why? / tone for parents | Recommendation |
|---|---|---|---|---|---|---|
| ☐ keep | `NSCameraUsageDescription` | Jawwid uses the camera to take a photo or record a video to send in a conversation. | يستخدم جَوِّد الكاميرا لالتقاط صورة أو تسجيل فيديو لإرساله في محادثة. | "Jawwid uses the camera to take a photo or record a video to send it in a conversation." | Yes. Clear and polite. | **Keep.** |
| ☐ keep | `NSMicrophoneUsageDescription` | Jawwid uses the microphone to record voice messages and the sound of videos you record, and to make voice calls. | يستخدم جَوِّد الميكروفون لتسجيل الرسائل الصوتية وصوت الفيديو الذي تسجّله، ولإجراء المكالمات الصوتية. | "Jawwid uses the microphone to record voice messages and the sound of the video you record, and to make voice calls." | Yes, all three uses named. Clear. | **Keep.** |
| ☐ keep · ☐ revise | `NSPhotoLibraryUsageDescription` | Jawwid lets you choose a photo or a video to send in a conversation, or a photo to use as a profile photo. | يتيح لك جَوِّد اختيار صورة أو فيديو لإرساله في محادثة، أو صورة لاستخدامها صورةً للملف الشخصي. | "Jawwid lets you choose a photo or video to send in a conversation, or a photo to use as a photo for the profile." | Yes. The ending «صورة … صورةً» repeats the word and reads stiffly. | **Revise (small):** «يتيح لك جَوِّد اختيار صورة أو فيديو لإرساله في محادثة، أو اختيار صورة لملفك الشخصي.» ("…or choose a photo for your profile."). Same meaning, smoother. |
| ☐ keep · ☐ revise | `NSFaceIDUsageDescription` | Jawwid uses Face ID to unlock the app, if you turn on app lock. | يستخدم جَوِّد بصمة الوجه لفتح التطبيق، إذا فعّلت قفل التطبيق. | "Jawwid uses Face ID to **open** the app, if you turn on app lock." | Yes. «بصمة الوجه» is Apple's own Arabic name for Face ID. But «لفتح التطبيق» says "open", not "unlock", and could suggest a face scan every time the app opens. | **Revise (small):** «يستخدم جَوِّد بصمة الوجه لفتح قفل التطبيق، إذا فعّلت قفل التطبيق.» ("…to unlock the app, if you turn on app lock."). Matches the English and the in-app wording (`appLockTitle` «قفل التطبيق», `appLockToggleSubtitle` «…فتح القفل…»). |
| ☐ keep | `NSPhotoLibraryAddUsageDescription` | Jawwid saves a board you export as a picture to your photo library. | يحفظ جَوِّد السبورة التي تصدّرها كصورة في مكتبة الصور. | "Jawwid saves the board you export as a picture in the photo library." | Yes. The reason is your own export. «كصورة» matches the export button (`boardExportPng` «تصدير هذه الصفحة كصورة (PNG)»). | **Keep**, so it stays consistent with the button. |

If the two revisions are ticked, only those two Arabic lines change in
`ios/Runner/ar.lproj/InfoPlist.strings`. The English and `Info.plist` stay as they are.
