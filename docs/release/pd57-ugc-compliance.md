# PD-57: user-generated content and child-safety compliance matrix

**Status: NOT YET COMPLIANT.** Reporting, blocking, moderation, escalation, the pre-posting word filter, the
in-app support contact rows and the app and Admin Web Terms gates are **merged on `main`** (refresh of
2026-11-09 below). These remain open: the server-side Terms gate (R9, **open PR #497**) and the Terms and Code
of Conduct wording (N-3); owner approval of the filter's draft word list (R1, LD-12); the support URL and
e-mail values (R8); published CSAE standards (R10); the authorities process and legal review (R12, R13); and
the child-safety point of contact (R14).
Do not tell a store, a reviewer or anyone else that Jawwid Chat complies until every row in §3 reads
`Implemented & verified` and the owner items in §5 are done.

- **Refreshed 2026-11-09 against `main` @ `bc47d376`** (LR-71 pre-audit, finding 9). Merged since the
  first version: #463, #474, #477, #478 (backend, brought onto `main` together in `ee7b24ed`), #461, #464,
  #475, #479 (PD-57); #462 (PD-58 data model); #492 (P-5 support contact rows); #493 (LD-12 content filter);
  #504 (app Terms gate); #500 (Admin Web Terms gate). Still open: **#497** (PD-58 API Terms gate). File and
  line references in §3 are to that commit. Tests were not re-run for this refresh; "verified" names the
  suites on `main` that CI runs.
- Written 2026-11-06, on `main` @ `63df3ee9`. Docs only; no code changed.
- Plan of record: `docs/release/pd57-closure-plan-2026-11-06.md` (owner decisions D-1 to D-6, PR-1 to PR-8).
  Roadmap: `docs/release/google-play-blocker-roadmap-2026-11-03.md` §5 (Report), §6 (Block), §7 (Terms).
- **Updated 2026-11-06 after PR-1 to PR-7 and the end-to-end run.** The PRs are #463 (data model), #474 (Report API),
  #478 (Block API and enforcement), #477 (escalation), #461 (Admin Web), #464 (Report sheet), #475 (Block UI),
  #479 (lifecycle end to end). At the time none was merged; all are now (see the 2026-11-09 refresh above).
  The product changes only when the release that carries them is deployed.
- The child-safety process is in `docs/security/child-safety-escalation.md` (DRAFT).

## 1. Sources (official texts, read 2026-11-06)

| # | Source | URL |
|---|---|---|
| S1 | Apple App Store Review Guidelines, 1.2 User-Generated Content, 1.2.1, 1.3, 5.1.4 | https://developer.apple.com/app-store/review/guidelines/ |
| S2 | Google Play, User Generated Content policy | https://support.google.com/googleplay/android-developer/answer/9876937?hl=en |
| S3 | Google Play, Learning more about our Child Safety Standards policy | https://support.google.com/googleplay/android-developer/answer/14747720?hl=en |
| S4 | Google Play, Child Endangerment policy (states the Child Safety Standards requirements) | https://support.google.com/googleplay/android-developer/answer/9878809?hl=en |
| S5 | Google Play, Families policies (social features only) | https://support.google.com/googleplay/android-developer/answer/9893335?hl=en |
| S6 | Apple Developer Forums thread 807358 (a developer quoting an App Review rejection, November 2025). **Not an official Apple policy text.** | https://developer.apple.com/forums/thread/807358 |

**What the sources say, in short**

- **Apple 1.2 (S1).** An app with user-generated content must have: a way to filter objectionable
  material before it is posted; a way to report offensive content with "timely responses to concerns";
  a way to block abusive users; and published contact information. 1.2 gives **no number of hours**.
  1.2.1 (creator content) does not apply: nobody sells content in the app. 5.1.4: an app that lets a
  minor chat must have a privacy policy and follow children's privacy laws. 1.3 (Kids Category) applies
  only if the app is listed in that category; it is not planned.
- **The 24-hour expectation (S6).** App Review rejection messages under 1.2, as quoted by developers,
  say the developer must act on objectionable-content reports within 24 hours by removing the content
  and ejecting the user. We found this only in developer forum posts, not in the guidelines. **Treat it
  as App Review practice, not a written rule.** D-1 (24 h) meets it either way.
- **Google Play UGC (S2).** Users accept terms that define and forbid objectionable content before they
  create or upload content; moderation is "robust, effective, and ongoing"; an in-app way to report
  content and users (required even for apps limited to registered users, such as a school's); in-app
  blocking wherever users interact 1:1; action against content and users where appropriate; safeguards
  against harassment and bullying, especially of minors. No number of hours is given; an app that
  "continually" fails to address complaints is in violation.
- **Google Play Child Safety Standards (S3, S4).** Formally applies to **Social** and **Dating** apps
  and to anonymous or random chat apps, by core function or declared category, whether or not children
  use them. Requirements: published standards that forbid child sexual abuse and exploitation (CSAE),
  linked in Play Console; an in-app way to raise concerns; appropriate action on CSAM (e.g. removal on
  actual knowledge) and, per S4, reporting confirmed CSAM to NCMEC or a relevant regional authority;
  compliance with child-safety laws; a named child-safety point of contact declared in Play Console.
- **Families (S5).** Only if the target audience includes children (owner decision N-1): an in-app
  reminder to be safe online before children exchange free-form content, and adult control of social
  features. Not applicable while the declared audience is adults (parents and teachers).

**Is Jawwid in scope of the Child Safety Standards?** Only if the app is declared in Social or Dating, or
is judged a chat app by core function. The owner chooses the category (likely Education). Because the
learners are children, **we plan to meet these standards anyway**; the owner confirms the category (§5).

## 2. How Jawwid differs from an open social app (context for every row)

- **Closed membership.** No public sign-up to strangers. Families are enrolled by the academy (a parent
  sign-up needs a code sent by a supervisor); teachers and staff are created by the academy.
- **No stranger contact.** Who may open a direct conversation is an allow-list
  (`AuthorizationService.canOpenDirect`, `apps/api/src/platform/authorization.service.ts`). A teacher
  and a parent never share a direct channel (BR-1): they speak only in the Student Group, where academy
  staff are present. Two families cannot open a channel. Enforced in the API and by database triggers.
- **Children do not hold accounts.** The account holder is the parent; children use the parent's phone
  during lessons (`docs/release/google-play-readiness-2026-11-03.md` D-3).
- **Stories and learning materials** are published by staff only, so they are not user content.

## 3. Requirement matrix

Status values: `Implemented & verified` (on `main`, with a passing test we can name), `Implemented,
unverified` (on `main`, no test or no device run), `In progress: PR-x` (on a branch, not merged), `Gap`
(nothing built). PR numbers are those of the closure plan §2.

| # | Requirement (paraphrased, source) | How Jawwid meets it (feature, file, PR) | Status | Evidence (tests) | Owner action |
|---|---|---|---|---|---|
| R1 | **Filter objectionable material before it is posted** (S1 1.2) | **Server-side pre-posting word filter (LD-12, #493).** Text written by a parent or a teacher is checked before it is stored and refused with 400 `COMM.CONTENT_NOT_ALLOWED` on a match (`apps/api/src/platform/content-filter/content-filter.service.ts:8-24`, `:49-61`); staff and system text is not filtered. Applied to chat messages and captions (`apps/api/src/communication/messages/message.service.ts:292`) and edits (`:1859`), parent feedback (`apps/api/src/teacher-file/parent-feedback.service.ts:105`), parent profiles (`apps/api/src/communication/profile/parent-profile.service.ts:125`, `:164`) and teacher profiles (`apps/api/src/communication/teacher-profile/teacher-profile.service.ts:126`, `:181`). On by default; `moderation.content_filter.enabled` = false turns it off without a deploy (`content-filter.service.ts:21-25`). **The word list is a DRAFT, not approved** (`apps/api/src/platform/content-filter/word-list.draft.json:2-4`). Images and files are not filtered: the attachment MIME allow-list (`apps/api/src/communication/attachments/attachment.service.ts`, `ALLOWED_MIME`), closed membership (§2) and staff post-moderation (PD-14, R6) cover them. | Filter: Implemented & verified; word list: **Gap (owner)**: still a DRAFT awaiting approval (LD-12) | `apps/api/test/integration/content-filter-ld12.spec.ts`; `apps/api/test/unit/content-filter/` (`content-filter-service`, `word-matcher`, `normalise`, `false-positive-guard`: the list run over the Quran and lesson text); app: `test/features/messages/content_filter_ld12_test.dart` | Approve or replace the draft word list (LD-12). In App Review notes, explain the filter plus closed membership and staff post-moderation. |
| R2 | **Report offensive content** in the app (S1 1.2; S2: content **and** users, even in a registered-users-only app) | Report a message (text, voice, photo, video, file, forward) or a person (group member row, 1:1 profile), five reasons including `child_safety`; `POST /reports`, `GET /me/reports` (#474, `apps/api/src/moderation/`); data model `chat.content_report` (#463); app Report sheet and My reports (#464); Admin Web queue (#461). The reader must be able to read the message now (API) and be or have been in its conversation (database). On `main`: `apps/api/src/moderation/reports.controller.ts:29` (`POST /reports`), `:47` (`GET /me/reports`); `supabase/migrations/20261104100000_chat_pd057_moderation.sql`; app: `lib/features/moderation/presentation/report_sheet.dart`, `my_reports_screen.dart`, reached from a message (`lib/features/messages/presentation/chat_screen.dart:549`) and a person (`lib/features/profile/presentation/profile_screen.dart:93`, `:232-233`), My reports at `/settings/reports` (`lib/app/router.dart:117`); Admin Web: `apps/admin-web/src/features/moderation/ReportsPage.tsx`, `ReportDetail.tsx`. | **Implemented & verified** (merged on `main`) | `pd057-reports.spec.ts`, `pd057-moderation-scope.spec.ts` (contract tests for #461/#464), `pd057-moderation-model.spec.ts`; `report_sheet_test.dart`, `moderation_over_http_test.dart`; `ReportsPage.test.tsx`; **end to end against the real API and worker: `apps/api/test/e2e/pd057-lifecycle.e2e.ts` (#479), 8/8 (PR-branch run)**. | Final reason labels (N-4). |
| R3 | **Timely response** to reports (S1 1.2 "timely"; S6 reviewer practice: act within 24 h; S2 "continually fails" is a violation) | D-1: `due_at = created_at + 24 h` (database check, #463); the responsible managers alerted at 18 h, every Super Admin at 24 h with `overdue_at` set, once each (sweep every 5 minutes, #477); a PD-47 task per report due at `due_at`; a report closes only with an answer to the reporter, who is notified (`report_answered`). On `main`: `apps/api/src/moderation/report-escalation.service.ts:11`, `:46-47` (18 h and 24 h stages), `:199` (sweep); `supabase/migrations/20261106150000_chat_pd057_report_escalation.sql`. | **Implemented & verified** (merged on `main`); staffing: owner (R3 action) | `pd057-escalation.spec.ts` (fixed instants: 18 h once, 24 h once, two concurrent sweeps alert once); `pd057-moderation-model.spec.ts` (24 h check); e2e: reporter answered through the real worker. | Staff must actually work the queue within 24 h, every day: name who covers weekends and holidays. |
| R4 | **Block abusive users** (S1 1.2; S2: required wherever users interact 1:1) | D-5, enforced on the server (#478): the blocker never receives the blocked person's chat messages (hidden in lists, pins, starred, search, previews, media 404), pushes, mentions, Notification Center items, unread-badge increments or non-lesson calls; queued pushes are cancelled; the blocked person cannot open a direct conversation. Block, Unblock and Blocked people in the app (#475); a block opens a moderation case and tells every responsible manager once per case (A-2a). 20 blocks a day; staff never block. On `main`: `apps/api/src/moderation/blocks.controller.ts:15-39` (`POST`, `GET`, `DELETE /me/blocks`), `blocks.service.ts`; `supabase/migrations/20261106140000_chat_pd057_block_notices.sql`; app: `lib/features/moderation/presentation/block_actions.dart`, `blocked_people_screen.dart` (`/settings/blocked`, `lib/app/router.dart:120`), the chat re-read after a block or unblock (`chat_screen.dart:1075-1105`). | **Implemented & verified** (merged on `main`) | `pd057-blocks.spec.ts` 19/19 (PR-branch run); regression 43 suites / 797 tests (PR-branch run); `block_test.dart`, `block_over_http_test.dart`; **e2e: the blocked teacher's message hidden for the parent over REST and a real socket, never for its author; unblock restores it (#479)**. | Approve the App Review note on the educational exceptions (§4). |
| R5 | **Blocking keeps lessons working** (D-6; our own rule, must be explained to reviewers) | Exactly as the closure plan §5, in code and tests (#478): a **lesson call** (teacher to a learner's family with a lesson from 15 min before start to 15 min after end) still rings; `system` and `card` messages are never hidden; Notification Center `lesson`, `payment`, `task` and `system` categories are never suppressed (`BLOCK_EXEMPT_CATEGORIES`); the official account, department managers and the Super Admin cannot be blocked; nobody leaves a group. On `main`: `BLOCK_EXEMPT_CATEGORIES` at `apps/api/src/communication/notifications/notification-catalog.ts:175`, used by `notification-pipeline.service.ts:118`. | **Implemented & verified** (merged on `main`) | `pd057-blocks.spec.ts` (lesson call rings; cards and system messages visible; protected targets 403); `block-allowlist.spec.ts`. | As R4. |
| R6 | **Moderation that is robust, effective and ongoing; act on content and users** (S2) | After-the-fact moderation by the staff in charge of a conversation (PD-14; `AuthorizationService.moderatableAuthorKinds`): edit or delete-for-everyone a teacher's or parent's message, every edit kept (`chat.message_revision`) and audited. Account suspension (PD-21, `POST /admin/accounts/:accountId/suspend`, `docs/security/DEACTIVATION.md`). The report queue and resolutions (`no_action`, `message_removed`, `warned`, `account_suspended`, `reassigned`): PR-2 (#474, API: `apps/api/src/moderation/moderation.controller.ts:19-63`, take and resolve) and PR-6 (#461, Admin Web: `apps/admin-web/src/features/moderation/`), both merged. | Moderation tools and report queue: **Implemented & verified** (merged on `main`) | `apps/api/test/integration/message-edit-favorites.spec.ts` ("the supervisor deletes a teacher's days-old message for everyone"); `communication-engine.spec.ts` ("PD-14: the admin of a parent's 1:1 deletes the parent's message for everyone"); `apps/api/test/unit/authorization/matrix-and-handling.spec.ts` (moderation matrix); `apps/api/test/unit/auth/session.spec.ts` ("suspending the ACCOUNT stops an existing access token immediately"). Ran on `main` CI, not re-run for this doc. | Train the staff who hold `moderation.act`. |
| R7 | **Escalation** of overdue and serious reports (D-1, D-4) | D-4: `child_safety` reports are visible only to the Super Admin and holders of `moderation.child_safety` (non-delegable, given to no role), never in a department queue (#474). On filing, every Super Admin and holder is notified at once, critical, bypassing quiet hours and the hourly cap, never coalesced (#477). 18 h / 24 h escalation as R3. Process: `docs/security/child-safety-escalation.md` (DRAFT). On `main`: `apps/api/src/moderation/moderation-scope.ts:16-17`, `:39`, `:49-51` (the `child_safety` scope); `report-escalation.service.ts:17` (`report_child_safety`). | **Engineering: Implemented & verified** (merged on `main`). **Process: Gap until adopted** | `pd057-moderation-scope.spec.ts` (department managers 404; holder and Super Admin see it); `pd057-escalation.spec.ts` (during quiet hours and past the cap); e2e: the Super Admin notified through the real worker, the department manager 404. | Adopt the escalation process after legal review; name the child-safety contact. |
| R8 | **Published contact information** so users can reach the developer (S1 1.2) | **In-app rows built (P-5, #492); the values are not yet supplied.** "Help and support" and "Contact support" rows in Settings (`lib/features/settings/presentation/settings_screen.dart:273-274`, `SupportLinksTiles` at `lib/core/legal/legal_links.dart:163`), under the sign-in and sign-up forms (`LegalLinksRow`, `legal_links.dart:76-78`) and on the Terms gate (`lib/features/legal/presentation/legal_gate.dart:439`), from the build-time `SUPPORT_URL` and `SUPPORT_EMAIL` (`legal_links.dart:38-39`, `:66-67`); a row is hidden while its value is unset. The store build refuses to run without both (`scripts/mobile/build-store.sh:91-92`, `:123-124`). The public support page is drafted in open PR #525 (LR-04). | In-app rows: Implemented & verified; contact values: **Gap (owner)**: no support URL or e-mail exists yet | `test/core/legal/support_contact_test.dart`, `test/features/settings/settings_support_test.dart`, `test/core/legal/legal_links_test.dart` | Supply the support e-mail and the support URL (web page with the academy's name and contact); host the page (LR-04); put the URL in both store listings. |
| R9 | **Terms accepted before posting**, defining objectionable content, with **zero tolerance** (S2 for terms; "zero tolerance" wording is the owner's requirement and is commonly asked for by App Review, but we did not find it in an official Apple text) | PD-58: versioned terms per account kind plus a shared Code of Conduct; acceptance recorded; every content-creating route refuses with 403 `COMM.TERMS_NOT_ACCEPTED` until accepted; production refuses to start without configured versions. On `main`: data model #462 (`supabase/migrations/20261107110000_chat_pd058_terms.sql`); app gate #504 (`lib/features/legal/presentation/legal_gate.dart:18-30`, `lib/features/legal/application/legal_gate_state.dart:6-18`; parent sign-up boxes in `lib/features/auth/presentation/parent_signup_screen.dart`); Admin Web gate #500 (`apps/admin-web/src/features/legal/LegalGate.tsx`, `LegalGuard.tsx`). Both client gates are **inert until the API sends the `legal` block** (`legal_gate.dart:28-30`). **The API gate is open PR #497** (`claude/pd58-eng10-terms-gate`: `LegalGuard`, `@RequiresLegal()`, fail-closed production configuration); until it merges, no route refuses with `COMM.TERMS_NOT_ACCEPTED` (`apps/api/src/moderation/reports.controller.ts:37` and `blocks.controller.ts:24` still carry the TODO). The wording does not exist yet (N-3). | Data model, app and Admin Web gates: Implemented & verified (merged on `main`). **API gate: In progress, PR #497 (open). Terms text: Gap (N-3)** | On `main`: `apps/api/test/integration/pd058-terms-model.spec.ts`; `test/features/legal/legal_gate_test.dart`; `apps/admin-web/src/features/legal/LegalGate.test.tsx`, `apps/admin-web/src/core/api/clientTerms.test.ts`. On #497 only: `pd058-legal.spec.ts`, `apps/api/test/unit/legal/legal-coverage.spec.ts`. | Write the terms and Code of Conduct (N-3), including: what objectionable content is, **zero tolerance** for it and for abusive users, that reported content is reviewed within 24 h and offenders removed, and an explicit ban on child sexual abuse and exploitation. |
| R10 | **Published CSAE standards**, linked in Play Console (S3) | Planned inside the Code of Conduct (R9) or a separate public child-safety page. Nothing published. | **Gap** | — | Publish a public web page (Arabic and English) that names the academy and the app and forbids CSAE; enter its URL in Play Console. |
| R11 | **In-app way to raise concerns** (S3) | The report sheet with reason `child_safety` (#464, #474). Also the family's direct conversation with the academy, and PD-32 teacher feedback (`apps/api/src/teacher-file/parent-feedback.controller.ts`). | **Implemented & verified** (merged on `main`) | As R2 and R7. | Self-certify in Play Console (R2 is merged). |
| R12 | **Act on CSAM; report confirmed CSAM to NCMEC or a regional authority** (S3, S4) | Process only: `docs/security/child-safety-escalation.md` §6–§7 (preserve, restrict, remove for users, report where legally required). Removal for users: `message_removed` (PR-2, merged) or delete-for-everyone. Evidence is kept after deletion (closure plan §4, 5-minute signed links, audited: `apps/api/src/moderation/moderation.controller.ts:43`, `moderation-media.controller.ts`, on `main`). | Engineering merged; **process: Gap** (a DRAFT; no legal review) | — | Legal counsel confirms the jurisdictions and the reporting duties; owner adopts the process. |
| R13 | **Comply with child-safety laws** (S3) | Not an engineering deliverable. | Gap | — | Legal review (§5). |
| R14 | **Child-safety point of contact** in Play Console (S3) | A placeholder in the escalation doc §2. | **Gap** | — | Name the person and contact details; enter them in Play Console. |
| R15 | **Safeguards against harassment and bullying, especially of minors** (S2) | Closed membership, BR-1, staff present in Student Groups (§2); reporting (R2); blocking (R4); moderation (R6); the word filter (R1). | Implemented & verified (R1 code, R2, R4, R6 merged on `main`) | As above. | — |
| R16 | **Privacy policy; children's privacy laws where a minor can chat** (S1 5.1.4) | Privacy-policy link in sign-in, sign-up and Settings when `PRIVACY_POLICY_URL` is set. Children do not hold accounts. | Implemented, unverified (no store build with the owner's URL yet) | `test/core/legal/legal_links_test.dart` | Publish the privacy policy (N-3); confirm the target audience (N-1). |
| R17 | **Families policy, social features** (S5): safety reminder and adult control | Applies only if the target audience includes children (N-1). Today: not applicable. | N/A pending N-1 | — | Decide N-1. If children are counted, this becomes a separate project. |

## 4. App Review and Play review notes (draft, for the owner to approve)

Short text to paste into App Store Connect "Notes" and Play Console. R2 and R4 are merged; do not submit it
until the support contact is filled in (R8) and the API Terms gate (#497) is merged and deployed with the
published texts (R9, N-3): the last sentence about accepting the Terms is not true before then.

> Jawwid Chat is the private messaging app of an online Quran and Arabic academy. Only enrolled families,
> the academy's teachers and its staff have accounts; there is no public sign-up and no contact with
> strangers. Every user can report any message or person (long-press a message → Report; or a person's
> profile → Report) and block a person (profile → Block). Reports are reviewed by the academy's staff
> within 24 hours, and child-safety reports go immediately to a restricted team. Blocking hides the
> person's messages, notifications and calls. Two things are deliberately not blocked, so a child's
> lessons are never interrupted: the scheduled lesson call between the learner and their teacher, and
> the academy's own administrative messages (lesson cards, schedule changes, and the academy's official
> account and managers). A family that no longer wants a teacher is moved to another teacher by the
> academy. Users must accept the Terms of Use and Code of Conduct, which have zero tolerance for
> objectionable content and abusive users, before posting. Contact: [SUPPORT E-MAIL / URL, OWNER].

## 5. Owner items (engineering cannot do these)

1. **Published contact information (R8):** a support e-mail and a support URL. The in-app rows are already
   built (#492) and appear once the store build sets them; the URL goes in both store listings.
2. **Child-safety point of contact (R14):** a named person and contact details, for Play Console and the
   escalation process.
3. **Legal review (R12, R13):** the jurisdictions the academy operates in and the legal duty to report
   child sexual abuse material or child-safety concerns in each; adoption of
   `docs/security/child-safety-escalation.md`.
4. **Final report-reason labels (N-4)**, Arabic and English.
5. **Terms, Code of Conduct and privacy policy wording (N-3)**: definition of objectionable content,
   zero tolerance, the 24 h review, and an explicit CSAE ban; published CSAE standards page (R10).
6. **Content filter word list (R1, LD-12):** the filter is built and on by default; approve or replace
   the DRAFT word list (`apps/api/src/platform/content-filter/word-list.draft.json`).
7. **App Review and Play notes (§4):** approve the wording.
8. **Store category and target audience (N-1)**: decides whether the Child Safety Standards (Social /
   Dating) and the Families policy apply formally.
9. **Staffing the 24 h clock (R3):** who answers reports at night, at weekends and on holidays.
