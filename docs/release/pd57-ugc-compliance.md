# PD-57: user-generated content and child-safety compliance matrix

**Status: NOT YET COMPLIANT — pending PR-1…PR-7 and the owner items in §5.**
Do not tell a store, a reviewer or anyone else that Jawwid Chat complies until every row in §3 reads
`Implemented & verified`.

- Written 2026-11-06, on `main` @ `63df3ee9`. Docs only; no code changed.
- Plan of record: `docs/release/pd57-closure-plan-2026-11-06.md` (owner decisions D-1 to D-6, PR-1 to PR-8).
  Roadmap: `docs/release/google-play-blocker-roadmap-2026-11-03.md` §5 (Report), §6 (Block), §7 (Terms).
- Branch facts below were read from the local and remote branch tips on 2026-11-06. They change as the
  PRs move; re-check before quoting them.
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
| R1 | **Filter objectionable material before it is posted** (S1 1.2) | **No automatic filter exists.** No keyword, profanity, image or malware filter on chat messages or attachments (searched `apps/api/src`, `supabase/migrations`, `lib/`). The former pre-approval of group messages was **retired by PD-14** (`supabase/migrations/20261020400000_chat_pd014_no_preapproval.sql`: "messages publish immediately; admins moderate after sending"). What exists instead: closed membership and the direct-channel allow-list (§2); attachment MIME allow-list (`apps/api/src/communication/attachments/attachment.service.ts`, `ALLOWED_MIME`); staff present in every Student Group who can edit or delete a teacher's or parent's message at any time. | **Gap** | — | Decide: (a) accept that closed membership plus staff post-moderation answers 1.2's filtering point and say so in App Review notes (a reviewer may not accept it), or (b) ask engineering for a server-side word filter (Arabic and English lists) that holds or rejects matching messages. Recommendation: (b), a small filter, plus (a)'s explanation. |
| R2 | **Report offensive content** in the app (S1 1.2; S2: content **and** users, even in a registered-users-only app) | Report a message (text, voice, photo, video, file, forward) or a person from their profile; five reasons including `child_safety`. API: `POST /reports`, `GET /me/reports` (`apps/api/src/moderation/`, branch `claude/pd57-report-api`, PR-2, local, not pushed). Data model: `chat.content_report` (#463, PR-1). App: report sheet and My reports (#464, PR-7). | In progress: PR-1, PR-2, PR-7 | `apps/api/test/integration/pd057-reports.spec.ts` (PR-2 branch); `pd057-moderation-model.spec.ts` (PR-1). Not run on `main`. | Final reason labels (N-4). |
| R3 | **Timely response** to reports (S1 1.2 "timely"; S6 reviewer practice: act within 24 h; S2 "continually fails" is a violation) | D-1: `due_at = created_at + 24 h`; managers alerted at 18 h; Super Admin alerted and report marked overdue at 24 h; the reporter must be answered to close a report. **The PR-1 and PR-2 branch tips still use 48 h** (`check (due_at = created_at + interval '48 hours')` in `20261104100000_chat_pd057_moderation.sql`, on `pd57-db-fixes` and `claude/pd57-report-api`). The sweep that alerts is PR-4 (no branch yet). | In progress: PR-1, PR-2, PR-4 | None for 24 h yet. | Staff must actually work the queue within 24 h, every day: name who covers weekends and holidays. |
| R4 | **Block abusive users** (S1 1.2; S2: required wherever users interact 1:1) | D-5: enforced on the server for messages, push, realtime, Notification Center, calls and opening a direct conversation. Data model `chat.actor_block` (#463, PR-1). API and enforcement: PR-3 (branch `claude/pd57-block-api` holds only PR-1's commits so far). App block UI: PR-5 (branch `pd57-app-block-ui` holds only the PR-7 report-sheet commit so far). | In progress: PR-1; **not started: PR-3, PR-5** | `pd057-moderation-model.spec.ts` (data model only). | Approve the App Review note on the educational exceptions (§4). |
| R5 | **Blocking keeps lessons working** (D-6; our own rule, must be explained to reviewers) | The exceptions, exactly as in the closure plan §5: lesson calls ring; `system` and `card` messages are never hidden; lesson, schedule and administrative notifications are never suppressed; the official account, department managers and the Super Admin cannot be blocked; nobody leaves a group. | In progress: PR-3 | Planned in `pd057-blocks.spec.ts` (PR-3). | As R4. |
| R6 | **Moderation that is robust, effective and ongoing; act on content and users** (S2) | After-the-fact moderation by the staff in charge of a conversation (PD-14; `AuthorizationService.moderatableAuthorKinds`): edit or delete-for-everyone a teacher's or parent's message, every edit kept (`chat.message_revision`) and audited. Account suspension (PD-21, `POST /admin/accounts/:accountId/suspend`, `docs/security/DEACTIVATION.md`). The report queue and resolutions (`no_action`, `message_removed`, `warned`, `account_suspended`, `reassigned`): PR-2 (API) and PR-6 (#461, Admin Web). | Moderation tools: Implemented & verified. Report queue: In progress: PR-2, PR-6 | `apps/api/test/integration/message-edit-favorites.spec.ts` ("the supervisor deletes a teacher's days-old message for everyone"); `communication-engine.spec.ts` ("PD-14: the admin of a parent's 1:1 deletes the parent's message for everyone"); `apps/api/test/unit/authorization/matrix-and-handling.spec.ts` (moderation matrix); `apps/api/test/unit/auth/session.spec.ts` ("suspending the ACCOUNT stops an existing access token immediately"). Ran on `main` CI, not re-run for this doc. | Train the staff who hold `moderation.act`. |
| R7 | **Escalation** of overdue and serious reports (D-1, D-4) | 18 h → managers, 24 h → Super Admin (PR-4). `child_safety`: urgent, sorted first, restricted to the Super Admin and holders of `moderation.child_safety` (D-4), immediate notification that bypasses quiet hours and the hourly cap. **`moderation.child_safety` does not exist on any branch yet** (searched PR-2's `catalogue.ts`). Process: `docs/security/child-safety-escalation.md` (DRAFT). | In progress: PR-2, PR-4; process: Gap until adopted | Planned (closure plan §3, roadmap §5.6 test 6). | Adopt the escalation process after legal review; name the child-safety contact. |
| R8 | **Published contact information** so users can reach the developer (S1 1.2) | **Nothing in the app.** No support e-mail, support URL, "Contact us" or "Help" entry: Settings (`lib/features/settings/presentation/settings_screen.dart`) shows only the privacy policy and terms links, and only when the build sets `PRIVACY_POLICY_URL` / `TERMS_URL` (`lib/core/legal/legal_links.dart`; `docs/mobile/store-builds.md`). No support URL in any store-listing doc (`docs/infrastructure/production-readiness.md` lists it as an owner item). Families can write to the academy in their direct conversation with the academy, but that is not published contact information. | **Gap** | `test/core/legal/legal_links_test.dart` (links only) | Supply a support e-mail and a support URL (web page with the academy's name and contact). Then engineering adds a "Contact us" entry in Settings (both languages) and the URL goes in both store listings. |
| R9 | **Terms accepted before posting**, defining objectionable content, with **zero tolerance** (S2 for terms; "zero tolerance" wording is the owner's requirement and is commonly asked for by App Review, but we did not find it in an official Apple text) | PD-58: versioned terms per account kind plus a shared Code of Conduct; acceptance recorded; every content-creating route refuses with 403 `COMM.TERMS_NOT_ACCEPTED` until accepted; production refuses to start without configured versions. Data model #462 (`claude/pd58-terms-model`); API and gate on local branch `claude/pd58-terms-api` (`129efdd6`, not pushed); the app and Admin Web gate screens: no branch found. The wording does not exist yet (N-3). | In progress: #462, PD-58 API; app gate: Gap | `apps/api/test/integration/pd058-terms-model.spec.ts`, `pd058-legal.spec.ts`, `apps/api/test/unit/legal/legal-coverage.spec.ts` (on the branches). | Write the terms and Code of Conduct (N-3), including: what objectionable content is, **zero tolerance** for it and for abusive users, that reported content is reviewed within 24 h and offenders removed, and an explicit ban on child sexual abuse and exploitation. |
| R10 | **Published CSAE standards**, linked in Play Console (S3) | Planned inside the Code of Conduct (R9) or a separate public child-safety page. Nothing published. | **Gap** | — | Publish a public web page (Arabic and English) that names the academy and the app and forbids CSAE; enter its URL in Play Console. |
| R11 | **In-app way to raise concerns** (S3) | The report sheet with reason `child_safety` (PR-2, PR-7). Also the family's direct conversation with the academy, and PD-32 teacher feedback (`apps/api/src/teacher-file/parent-feedback.controller.ts`, complaints about a teacher). | In progress: PR-2, PR-7 | As R2. | Self-certify in Play Console once R2 is merged. |
| R12 | **Act on CSAM; report confirmed CSAM to NCMEC or a regional authority** (S3, S4) | Process only: `docs/security/child-safety-escalation.md` §6–§7 (preserve, restrict, remove for users, report where legally required). Removal for users: `message_removed` (PR-2) or delete-for-everyone (on `main`). Evidence is kept after deletion (closure plan §4, 5-minute signed links, audited). | Gap (process is a DRAFT; no legal review; PR-2 evidence links in progress) | — | Legal counsel confirms the jurisdictions and the reporting duties; owner adopts the process. |
| R13 | **Comply with child-safety laws** (S3) | Not an engineering deliverable. | Gap | — | Legal review (§5). |
| R14 | **Child-safety point of contact** in Play Console (S3) | A placeholder in the escalation doc §2. | **Gap** | — | Name the person and contact details; enter them in Play Console. |
| R15 | **Safeguards against harassment and bullying, especially of minors** (S2) | Closed membership, BR-1, staff present in Student Groups (§2); reporting (R2); blocking (R4); moderation (R6). | In progress (as R2, R4) | As above. | — |
| R16 | **Privacy policy; children's privacy laws where a minor can chat** (S1 5.1.4) | Privacy-policy link in sign-in, sign-up and Settings when `PRIVACY_POLICY_URL` is set. Children do not hold accounts. | Implemented, unverified (no store build with the owner's URL yet) | `test/core/legal/legal_links_test.dart` | Publish the privacy policy (N-3); confirm the target audience (N-1). |
| R17 | **Families policy, social features** (S5): safety reminder and adult control | Applies only if the target audience includes children (N-1). Today: not applicable. | N/A pending N-1 | — | Decide N-1. If children are counted, this becomes a separate project. |

## 4. App Review and Play review notes (draft, for the owner to approve)

Short text to paste into App Store Connect "Notes" and Play Console, once R2, R4 and R8 are merged and
verified. Do not submit it before then.

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

1. **Published contact information (R8):** a support e-mail and a support URL. Engineering then adds
   "Contact us" in Settings and the URL goes in both store listings.
2. **Child-safety point of contact (R14):** a named person and contact details, for Play Console and the
   escalation process.
3. **Legal review (R12, R13):** the jurisdictions the academy operates in and the legal duty to report
   child sexual abuse material or child-safety concerns in each; adoption of
   `docs/security/child-safety-escalation.md`.
4. **Final report-reason labels (N-4)**, Arabic and English.
5. **Terms, Code of Conduct and privacy policy wording (N-3)**: definition of objectionable content,
   zero tolerance, the 24 h review, and an explicit CSAE ban; published CSAE standards page (R10).
6. **Content filtering decision (R1):** accept post-moderation with an explanation, or ask for a word
   filter.
7. **App Review and Play notes (§4):** approve the wording.
8. **Store category and target audience (N-1)**: decides whether the Child Safety Standards (Social /
   Dating) and the Families policy apply formally.
9. **Staffing the 24 h clock (R3):** who answers reports at night, at weekends and on holidays.
