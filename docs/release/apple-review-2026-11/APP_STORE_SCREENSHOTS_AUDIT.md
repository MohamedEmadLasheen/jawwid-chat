# App Store screenshots audit (Guideline 2.3.3)

## 1. What exists today

| Item | Finding | Evidence |
|---|---|---|
| Screenshots uploaded in App Store Connect | **Not visible to us**: the agent has no App Store Connect access. The owner checks Version 1.0 > Previews and Screenshots | — |
| Store-sized screenshots on disk (before 2026-11-19) | Only one: `n1-qa-shots/ios-01-coldstart-en.png`, the **sign-in screen**. Guideline 2.3.3 says screenshots must show the app in use, not mainly sign-in or splash screens, so this one must not be used | AR-F §3 (scan of 2,145 images in the orchestrator, evidence folders, Desktop and Downloads) |
| Generator | `scripts/...` screenshot generator is in unmerged PR #549 | AR-F |

**Conclusion:** if anything is uploaded today, it is at best the sign-in screen. **Replace every iPhone screenshot.**

## 2. Apple's sizes

AR-F read Apple's screenshot specification page on 2026-11-19:
- **Mandatory:** at least one iPhone screenshot at the **6.3" Dynamic Island** size, **1206 x 2622** or **1179 x 2556**, portrait.
- **Optional:** the 6.9" size, **1320 x 2868**. App Store Connect scales from it if the 6.3" set is missing, but providing both is safest.
- Format: PNG or JPEG, no transparency, 1 to 10 per localization.

Re-check the console on the day of upload: Apple changes these pages.

## 3. Replacement set (produced 2026-11-19)

**How they were made:**
- The real app at the submitted commit `2e4127015`, on iOS simulators at native resolution:
  - iPhone 17 Pro: 1206 x 2622
  - iPhone 17 Pro Max: 1320 x 2868
- The status bar is fixed at 9:41, full battery and full signal.
- The same fictional review people as production, from the real `provision-review-cohort` command on an isolated local
  backend.
- No mock-ups, no artwork, no device frames, and no text added on top. Every screenshot is a real screen of the app
  in use.

**The one difference from a user's phone:** the QA build skips the system notification-permission alert, so it does not
cover the screenshots. That is a harness-only change in the QA worktree, never shipped (`AppDelegate.swift`, marked
`QA-HARNESS ONLY`). The app's own screens are unchanged.

**Files (local evidence, not in Git):** `~/jawwid-evidence/apple-review-2026-11-19/store-shots/<size>/<lang>/`:

| # | Screen | Shows (2.3.3: app in use) |
|---|---|---|
| 01 | Chats | The family's conversations with the academy |
| 02 | Family group | A real conversation between the parent, the teacher and the supervisor |
| 03 | Calls | Voice calls |
| 04 | Packages | Lesson packages and the amount due (demo; no in-app purchase) |
| 05 | Settings | Language, reports, blocked people, help and support, delete account |

For each size and language (English, Arabic): see the table filled in §4.

## 4. Produced files and checks

Captured on 2026-11-19 (capture log: `store-shots.log`). Every file was checked with
`sips -g pixelWidth -g pixelHeight -g hasAlpha`. The simulator PNGs have an alpha channel, which App Store Connect
refuses, so the **upload set is JPEG at quality 95 with no alpha**: `store-shots/upload/<size>/<lang-role>/*.jpg`.

| Set | Files | Size | Alpha | Use |
|---|---|---|---|---|
| `upload/1206x2622/en-parent/` | 01 chats, 02 family group, 03 calls, 04 packages, 05 settings | 1206 x 2622 | no | **English, 6.3" (mandatory slot)** |
| `upload/1206x2622/ar-parent/` | Same five, Arabic | 1206 x 2622 | no | **Arabic, 6.3"** |
| `upload/1320x2868/en-parent/` | Same five | 1320 x 2868 | no | English, 6.9" |
| `upload/1320x2868/ar-parent/` | Same five, Arabic | 1320 x 2868 | no | Arabic, 6.9" |
| `upload/1206x2622/en-teacher/` | Chats, family group, calls, settings (teacher view) | 1206 x 2622 | no | Optional: shows the teacher's side |

Totals: 14 files at 1206 x 2622 and 10 at 1320 x 2868, all without alpha.

**Reviewed by eye (sample):**
- Chats: the family group and the supervisor chat.
- Family group: the supervisor, the teacher and the parent in a real conversation.
- Arabic Settings: right-to-left layout, Arabic labels.
- Arabic Packages: the amount due and Pay.

No sign-in screen, no artwork, and no real person.

**Owner's choice for 04 Packages:** it shows the review family's demo item, "Lesson package (demo): 8 live one-to-one
lessons, USD 80.00". That text comes from the server in English, also in the Arabic screenshot. It is accurate but
says "(demo)". If you prefer not to show it in the store, upload four screenshots (01, 02, 03, 05) per language.

## 5. Owner upload steps

1. App Store Connect > the app > version 1.0 > **English (U.S.)** > iPhone:
   - Upload the `1206x2622/en` set to the 6.3" slot.
   - Upload the `1320x2868/en` set to the 6.9" slot.
   - Delete any sign-in-screen image.
2. Repeat for **Arabic** with the `ar` sets.
3. Do not upload a picture that shows a real person's data. These show only the fictional review family.
