# LR-28: defects a store reviewer could see, 2026-11-08

Tracker item **LR-28**: "Defects a reviewer could see are closed" (TEACHER-020, PARENT-016, PARENT-024, and the P2 retests in `docs/qa/release-gate.md` §2b).
This is a QA status report. It changes no code. `release-gate.md` and the device plan are left as they are, and the lead decides what goes into them.
"main" means `22237717` (2026-11-08). Every PR below was checked as **MERGED**, and its merge commit was found in `git log main`.

## How the search was done

- `grep -rn` for each id over the whole worktree: `docs/`, `lib/`, `test/`, `apps/`.
- `git log --all --oneline --grep=<id>`, plus `git log --all -S <id>` (pickaxe: every commit that added or removed the text).
- `gh pr list --state all --search <id>`, `gh issue list --state all --search ...`, and `gh pr view N` on every PR that matched or that §2b cites.
- **Not read by the builder (the lead read them afterwards; see the PARENT rows):** `~/jawwid-acceptance/final/defect-log.md`, `~/jawwid-acceptance/chat-scheduling/bugs.md` and the other QA logs outside the repository. `release-gate.md` §2b calls the first one "the full list, with owners". This builder session was limited to its own worktree, so it did not open them. The lead then found the PARENT-016 and PARENT-024 write-ups in `~/jawwid-acceptance/parent/bugs.md` (see their rows).

## 1. The three named defects

| ID | What | Evidence | State on main | Proving device step | Still needed |
|---|---|---|---|---|---|
| **TEACHER-020** (P3) | "Board header taps do nothing on iOS" (store review, 2026-11-03). | `docs/release/store-readiness-2026-11-03.md` row 11 and §8; PR #491 body; `test/features/whiteboards/boards_screens_test.dart:459-465`. #491 states that the original write-up was not found and that the fix is a **best guess, not reproduced on a device**. | **A fix is on main, but it is unproven.** #491 was merged 2026-11-07 (merge `7ae40105af9813703dd603a15de83e16d46babee`; fix commit `5dc38bb7`). `lib/features/whiteboards/presentation/board_editor_screen.dart:46` (`kIosStatusBarStrip = 20`) and `:412-416`: on iOS, the full-screen header's `SafeArea` keeps at least 20 pt clear of the top edge. The widget test proves the layout, not the touch. | **No §12 row covers it.** Proposed row **I-60** (iPhone; tracker LR-28): *Preconditions:* signed in as the review teacher, who has a board. *Steps:* 1) Open a board. 2) In the normal (not full-screen) top bar, tap the title to rename it, then tap Undo, Redo and the menu. 3) Tap Full screen. 4) Tap each header button: Back, Exit full screen, Undo, Redo, save, page. *Expected:* every tap acts the first time; none is ignored or taken by iOS. *Evidence:* a screen recording with touches visible. Repeat the steps on an iPhone **without** a notch (SE) or an iPad if one is available, and record the model. | **1) The iPhone check.** The owner's §12.2 phone is an iPhone 16 Pro Max, which has a Dynamic Island. Its safe area is already above 20 pt, so #491 changes nothing on it. A PASS there proves the normal top bar and full screen on that model only. It does not prove the no-notch case that #491 targets. **2)** If I-60 fails on the normal top bar, #491 did not fix the reported defect (its body says so), and the defect stays open. **3)** The original write-up, from the files outside the repo. |
| **PARENT-016** | Declined-call screen says «مرفوضة» ("rejected") in Arabic (P3). | **Found by the lead on 2026-11-08** in the QA log outside the repository (`~/jawwid-acceptance/parent/bugs.md`, "PARENT-016"; evidence `P-241-incoming-declined.png`). Steps: Arabic UI; the teacher calls the group; Decline. `docs/design/screens/call.md:71` says "Declined: Plain, neutral … Never *rejected*". | **Not fixed on main:** `lib/l10n/app_ar.arb:161` `"callOutcomeDeclined": "مرفوضة"` (English "Declined" is fine). | Arabic UI: decline a group call; the outcome reads a neutral word. Add a §12 row when fixed. | A neutral Arabic word, which the owner approves as Arabic copy. The fix waits until #449, #498 and #503 land, because they edit the same l10n files. |
| **PARENT-024** | The video screen's title and error text are dark grey on black (P3). | **Found by the lead on 2026-11-08** in `~/jawwid-acceptance/parent/bugs.md` ("PARENT-024"; evidence `P-331e-video-player-missing-file.png`). Steps: open a chat video that cannot play. The "Video" title and "This video could not be played." are almost invisible. | **Not fixed on main:** `lib/features/messages/presentation/chat_video_screen.dart:73-80` sets the media surface colours on the Scaffold and AppBar, but the title and `JawwidErrorView(title: l10n.storyVideoFailed)` use the theme's default text colours. | Open a chat video whose file is missing: the title and the error are readable (light on black). Add a §12 row when fixed. | Fix in PR #520 (Builder N), under review. |

Two related defects from the same readiness row 11, closed in code by #491 (merge `7ae40105`), with no device row yet:

- **PARENT-009:** "Active" was shown next to "No subscription yet".
- **PARENT-010:** the raw word "parent" was shown under the parent's name on My profile.

Proposed row **I-61 / A-61**:
- *Preconditions:* the review parent, with one child who has no subscription.
- *Steps:* 1) Open Billing / the child's subscription card. 2) Open My profile. Do both in English and in Arabic.
- *Expected:* 1) No "Active" chip beside "No subscription yet". 2) The line under the name reads "Parent" / "ولي الأمر", not "parent".

The review cohort may not include a child without a subscription. If it does not, mark step 1 BLOCKED (P-5).

## 2. Retests from `release-gate.md` §2b and readiness §8

**§2b is out of date.**
- It lists TEACHER-005 (#398) and TEACHER-008 (#396) under "open PR". Both were merged on 2026-11-02.
- Under "no fix on main", seven of its nine rows now have a merged fix: CHATSCHED-012, TEACHER-026, TEACHER-013, TEACHER-002, TEACHER-API-002, PARENT-003 and RQA-F1. The remaining two are CHATSCHED-003, which is not built by decision, and the PARENT-005 P-182 remainder, which is unknown.

The lead should update §2b; this task does not edit it.

**What a store reviewer can see.** A reviewer uses only the mobile app, signed in as the review parent or the review teacher. Admin Web and API-only behaviour is not reviewer-visible. Those rows are still listed below, because §2b names them as pending, but they are proved on the system-test or staging stack, not by a §12 phone row.

### 2a. Visible in the app: a device step is needed

| ID | What (from the PR) | Evidence | State on main | Proving device step | Still needed |
|---|---|---|---|---|---|
| CHATSCHED-010 (P2) | Chat videos did not play in the app. The fix plays them in the app, with a seek bar. | #373 | On main: merge `d059c8bc` (2026-11-02) | No §12 row. Proposed **I/A-62**: the teacher (portal) sends a short video into the family group. On the phone, tap it: it plays in the app with sound, and the seek bar moves and can be dragged. | Run the row |
| CHATSCHED-013 (P2) | A dropped call waits 60 s to reconnect, then ends as `connection_lost`. | #367 | On main: merge `85ea73be` | Partly covered by **I-13 / A-14**, whose expected result already says that the portal must not stay "in call" (CHATSCHED-013). | Run I-13 and A-14. The 60-second reconnect itself has no row. Proposed **I/A-63**: during a live call, kill the app and reopen it within 60 s. The call is resumed, or ended cleanly, and the portal never stays "in call". |
| CHATSCHED-016 (P3; readiness §8 retest #440) | A call in its reconnect grace showed a red "Missed", and kept it until a pull-to-refresh. | #440 | On main: merge `8ff9570e` | Add to the proposed I/A-63: during the grace, open the Calls tab. The row reads "In progress", then changes to its outcome **without** a pull-to-refresh. | Run the row |
| CHATSCHED-001, -002, -004 (P2) | 001: a lesson added outside the weekly times posted no card. 002: an old lesson card did not say where the lesson stands now. 004: a lesson change reached no socket, so lists went stale. | #390 (PD-46 PR-1), #420 (PR-2a), #443 (PR-3a, CHATSCHED-002 app) | On main: merges `fc05847b`, `f7b89bf7`, `dad9bc8c` | No §12 row. Proposed **I/A-64**: with the family group open on the phone, staff move one of Yahya's lessons and add a one-off lesson in Admin Web. One card appears for each change, without a refresh. The earlier card for the moved lesson says where it stands now. | Run the row. §2b says the retest decides whether all three close. |
| TEACHER-023 (P2, app half) | Any signed-in account can change its own password: Settings → Change password. | #370 (API retest PASS per §2b) | On main: merge `37bb3bac` | No §12 row. Proposed **I/A-65**: as a disposable P-6 parent (never the review accounts), go to Settings → Change password. Enter a wrong current password: refused. Then the right one: changed. Sign out, and sign in with the new password. | Run the row with a disposable account |
| PARENT-003 (P2) | Messages had no length limit. The limit is now 4000 characters, on the server and in both clients. | #421 | On main: merge `402a554a`. §2b wrongly lists it as "no fix". | No §12 row. Proposed **I/A-66**: paste text longer than 4000 characters into the composer. It is limited or refused with a message, and nothing breaks. | Run the row |
| PARENT-005 (P2) | A failed attachment stalled the chat; the fix makes Discard clear it. The **"P-182 remainder"** in §2b is not described anywhere in the repository or in any PR. | #357 | The fix is on main: merge `f4af5452` (2026-10-31). The remainder is **unknown**. | I-20 / A-20 cover offline sending, but not attachments. Proposed **I/A-67**: in Airplane Mode, attach a photo and send it. When it fails, tap Discard. The chat stays usable, and later messages send. | The P-182 write-up (outside the repo); then run the row |
| PARENT-013 (P3; readiness §8 retest #423) | A chat's theme was not re-read for whoever signs in. | #423 | On main: merge `a2b244bf` | Proposed **I/A-68**: set a chat theme, sign out and sign in again (as in I-04). The theme returns for that account. | Run the row |
| PARENT-001, RQA-F4, RQA-F7 (P3; readiness §8 retest #433) | PARENT-001: "Lock the app?" opened on top of "About lesson audio". RQA-F4: chat-list rows whose last item was a card showed no preview. RQA-F7: all "My leave" states were the same green. | #433 | On main: merge `3ae83ffa` | Proposed **I/A-69**: 1) On the first sign-in after the fresh install in I-02 / A-02: the lesson-audio notice shows first, and the app-lock offer appears only after it closes. 2) A chat-list row whose last item is a card has a preview line. 3) As the review teacher, My leave states have distinct colours. | Run the row |

### 2b. Admin Web or API only: not reviewer-visible, retest on the system-test or staging stack

| ID | What (from the PR title) | State on main | Proving step | Still needed |
|---|---|---|---|---|
| ADMIN-012 | "Paid" counts standalone payments; the app lists them | #386, merge `119b1a4c` | Admin Web billing retest | Retest |
| ADMIN-006, TEACHER-API-001 | Credential review belongs to the Teachers department and the super admin; the SQL rule follows the API | #375 `ca783d2d`, #395 `05493f34` | API / Admin Web retest | Retest |
| TEACHER-007 | Approving or declining a leave request counts once | #399, merge `1a6ad5b1` | Admin Web retest | Retest |
| TEACHER-005 | Leave beyond the balance is allowed and recorded as unpaid | #398, merge `1e6b7638` (§2b still says "open PR") | Admin Web retest | Retest |
| TEACHER-008 | Lessons cancelled because of the teacher owe the family a make-up | #396, merge `6a364024` (§2b still says "open PR") | Admin Web retest | Retest |
| CHATSCHED-012 | An old teacher's remaining records posted no card after a transfer | #420, merge `f7b89bf7` (§2b says "no fix") | System-test retest | Retest |
| TEACHER-026 | An apologised or moved lesson came back after a change of teacher | #437, merge `94ba40e2` (§2b says "no fix") | System-test retest | Retest |
| TEACHER-013 | The lateness ladder ranks deterministically | #406, merge `6fcdf6fd` (§2b says "no fix") | System-test retest | Retest |
| TEACHER-002 | A double-clicked Add teacher issues one code | #424, merge `30cbc36e` (§2b says "no fix") | Admin Web retest | Retest |
| TEACHER-API-002 | Staff could add a one-off lesson in the past or on a leave day | #442, merge `7e10a7ad` (§2b says "no fix") | Admin Web / API retest | Retest |
| RQA-F1 | The Teacher File had no lesson reports | #417, merge `d7d3b387` (§2b says "no fix") | Admin Web retest | Retest |
| CHATSCHED-003 | The `schedule_change` push rule | **Not built, by decision**: #390's body says "CHATSCHED-003 (push) is not built, by decision. The seeded `schedule_change` notification rule stays unused." §2b calls it an owner question. | None | Record the decision in §2b as closed (won't fix) or still open. That is a lead or owner call. |

## 3. What LR-28 still needs, in order

1. **PARENT-016:** the owner approves a neutral Arabic word for a declined call; it is applied once #449, #498 and #503 have landed (they share the l10n files). **PARENT-024:** fixed in PR #520 (under review); add a §12 row when merged. **PARENT-005 P-182 remainder:** its write-up is still to be found in the QA logs outside the repository.
2. **The TEACHER-020 iPhone check** (proposed I-60). On the owner's iPhone 16 Pro Max it proves only the normal and full-screen bars on that model. The no-notch case that #491 changed needs an iPhone SE or an iPad.
3. **Add the proposed rows to the §12 run sheet:** I/A-60 (iPhone only for I-60), I/A-61 to I/A-69. The lead decides; this task does not edit the device plan. All of them run on today's main and need no unmerged PR.
4. **Correct `release-gate.md` §2b:** #398 and #396 are merged, and seven "no fix" rows now have merged fixes. Then run the Admin Web and API retests in §2b of this file on the system-test stack.
5. **CHATSCHED-003:** record "not built, by decision" (#390) as the closure, or keep it open as an owner question.

Nothing here was run on a device or a test stack. Every "State on main" above comes from `git log` on main and the PR record, not from a retest.
