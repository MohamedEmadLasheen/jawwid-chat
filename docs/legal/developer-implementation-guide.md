# Legal and privacy: developer implementation guide

**Version 0.1 (draft), 2026-11-06.**
- **Audience:** the Jawwid Chat engineering team.
- **State: GUIDANCE. No code, schema or configuration is changed by this document.**
- **Base:** `main` @ `647dfc27`, with draft PR #462 (`claude/pd58-terms-model`, commit `8f829d87`) read but not modified.
- **Paths** are relative to the repository root.

This guide turns the documents in `docs/legal/` into engineering work. It builds on the plans already approved and does not replace them:
- roadmap `docs/release/google-play-blocker-roadmap-2026-11-03.md`, §5–§7;
- the PD-57 closure plan `docs/release/pd57-closure-plan-2026-11-06.md`;
- PD-58 (`docs/product/pd-registry/PD-58.md` on #462).

Where this guide differs from them, **they win**. The difference is then raised with the lead as a proposal (marked **P-n**).

---

## 0. Status at a glance

| Area | On `main` | In progress | Missing |
|---|---|---|---|
| Privacy policy and terms **links** (sign-in, sign-up, Settings) | Yes: `lib/core/legal/legal_links.dart`, from `PRIVACY_POLICY_URL` and `TERMS_URL` dart-defines with `{lang}` | — | The URLs themselves (§6). Admin Web has no links (§6.4) |
| Terms **acceptance** (A-3) | No | #462 data model (ENG-09). The API gate (ENG-10), Flutter gate (ENG-11) and Admin Web gate (ENG-12) are planned in roadmap §7 | Final texts and versions (N-3) |
| Report and Block (PD-57) | Yes: merged (`apps/api/src/moderation/`, `apps/admin-web/src/features/moderation/`, `lib/features/moderation/`) | #479, lifecycle end-to-end | Terms gate on report and block (`reports.controller.ts:38`, `blocks.controller.ts:24` TODOs); appeals; pre-posting content filter |
| Account deletion | Yes: in-app and `/account-deletion` (`chat.erase_account`) | — | Propagation to processors; trial-request data; retention purges (§4.5) |
| Staff support sessions (PD-21) | Yes: logged, time-limited, allowlisted | — | User-side notice (owner decision LD-3) |
| Data export / access requests | No | — | A manual procedure first (§4.6) |
| Privacy-incident procedure | No (`docs/infrastructure/incident-response.md` covers availability, not personal-data breaches) | — | §4.8 |
| PD-48 lesson-audio notice | Yes: separate acknowledgement (`chat.parent_notice_ack`, `apps/api/src/lesson-audio/parent-notices.ts`) | — | Nothing. It stays separate from terms |

---

## 1. Terms acceptance (A-3, PD-58)

### 1.1 What is already decided (do not reopen)

- **Four acceptance documents:**
  - `terms_family`, file `docs/legal/terms-of-use-*.md`;
  - `terms_teacher`, file `terms-teachers-*.md`;
  - `terms_staff`, file `terms-staff-*.md`;
  - `code_of_conduct`, file `user-conduct-policy-*.md`.
- Each account accepts **its kind's terms plus the Code of Conduct**.
- **Recorded:** account, document key, version, server time, client (`android | ios | web_portal | admin_web`) and locale. The record is immutable and kept through erasure (#462).
- **Versions and URLs are configuration**, published with `chat.publish_legal_version(...)`. The version in force is named by `chat.config` `legal.current.<key>`. Production refuses to start without it (roadmap §7.3).
- **Enforced on the server, for every way an account is created.** Every content-creating route is gated with `@RequiresLegal()` and answers 403 `COMM.TERMS_NOT_ACCEPTED` (roadmap §7.4).
- **Never gated:** reading, `/auth/*`, `GET /me`, `/me/legal/accept`, account deletion (in-app and web), and `/parent-notices/*`.
- **The Privacy Policy is a notice, not a click-through.** It is linked at sign-in, at sign-up, in Settings, and on the gate. It is never "accepted".
- **The PD-48 notice keeps its own acknowledgement.** Terms acceptance never stands in for it.
- A support session **cannot accept** on anyone's behalf (403).

### 1.2 How the four non-acceptance policies are bound

The following policies are **incorporated by reference** into the Terms of Use, the Teacher Terms and the Staff Terms:
- Reporting and Complaints;
- Blocking, Suspension and Enforcement;
- Child Safety and Parental Responsibility.

Each terms document names them. They need **no document key** and **no change to #462's `check (document_key in (...))`**.

**Rule for the owner's release process:** a *material* change to one of these three policies is published as a **new version of every terms document that incorporates it**, so the affected accounts accept again. A non-material change follows §2.3.

### 1.3 Gaps in #462 worth closing before it merges (proposals for the PD-58 owner)

#462 is still a draft, and adding a column now is cheaper than adding it in a later migration. These are proposals for the lead and the PD-58 session. **This guide does not change #462.**

| # | Proposal | Why | Fit with #462 |
|---|---|---|---|
| **P-1** | **Fingerprint the published text.** Add `content_sha256_ar` and `content_sha256_en` (`text`, 64 hex characters, not null) to `chat.legal_document_version`, and as arguments to `chat.publish_legal_version`. Each is the SHA-256 of the exact bytes served at `url_ar` / `url_en`. | A URL can be edited after publication. The hash proves which text a person accepted, and the release process can check that the live page matches (§6.3) | One column pair. The idempotent re-publish compares them too |
| **P-2** | **Record the acceptance method.** Add `method` (`signup` \| `gate`) to `chat.terms_acceptance` and to `chat.accept_legal_documents`. | The owner's brief asks for the method of acceptance. Today it can only be inferred: sign-up and the gate share one writer | One column with a check constraint |
| **P-3** | **Decide whether a version requires re-acceptance.** Add `requires_reacceptance boolean not null default true` to `chat.legal_document_version`. The required set is then: for each of the account's keys, the latest version with `requires_reacceptance = true` that is at or before `legal.current.<key>`, with the account having accepted that version or any later one. | It lets the owner publish a typo fix (a new version, a new hash) without forcing every family to accept again (§2.3). Without it, every new version forces re-acceptance, which is safe but heavy-handed | This changes the ENG-10 query, not the tables' immutability. If it is rejected, every version change forces re-acceptance, which is acceptable |
| **P-4** | **Do not add IP address or user agent** to the acceptance record. | `session.ip_hash` and `user_agent` already exist for the same request, and duplicating them adds personal data without adding evidential value. The session id could be recorded instead, if counsel wants the link (L-9) | No change |

If P-1 to P-3 are not taken into #462, they go into ENG-10's migration (a new slot from the lead), **never** into a second, parallel acceptance table.

### 1.4 The flows

**A. Parent sign-up (PD-16, `parent-signup.service.ts` `verify`)**

PD-16 "sign-up" is account **activation**. The academy has already created the family and enrolled the children (Sales and PD-42 intake). The parent enters the e-mail Sales recorded, receives a one-time code (relayed by the family's supervisor over WhatsApp until a WhatsApp sender is connected), and sets a password. That screen is therefore the first moment the parent can accept anything in the app, and it is where both the terms and the LD-13 consent are taken.
1. The sign-up screen shows two required checkboxes, one for the Terms of Use (family) and one for the Code of Conduct. Each opens its URL from the server's `legal.required` for the chosen language.
   - The **existing PD-48 checkbox stays exactly as it is**, as a third, separate checkbox.
   - The Privacy Policy is a link under the form, with no checkbox.
2. `POST /auth/signup/verify` carries `acceptLegal: [{documentKey, version}]`.
3. The server records acceptance in the same transaction as the account, with `method = 'signup'` (P-2), the same way the lesson-audio notice is recorded today (`:154-156`).
4. Without `acceptLegal`, the request fails with 400 `COMM.LEGAL_REQUIRED`.

**B. Every other account (intake families, teachers, staff, bootstrap Super Admin, seeded, Core-linked)**
1. `/auth/login`, `/auth/refresh` and `GET /me` return `legal.required`.
2. The client shows the **legal gate**:
   - Flutter: `lib/features/legal/presentation/legal_gate.dart`, before `AppLockGate`.
   - Admin Web: `src/features/legal/LegalGate.tsx`, after the authentication check.
3. The gate shows one row per required document: its title in the user's language, an "Open" link, and a checkbox.
   - "Agree" stays disabled until every box is ticked.
   - The gate also offers **Sign out**, **Delete account** and the **Privacy Policy** link.
4. `POST /me/legal/accept {documents}` must be **exactly** the required set; otherwise 400 `COMM.LEGAL_WRONG_DOCUMENTS`. A stale version answers 409 `COMM.LEGAL_VERSION_STALE`.

**C. First UGC post**
- Because of flows A and B, no account can reach a content route without current acceptance.
- `@RequiresLegal()` is the **backstop**: any 403 `TERMS_NOT_ACCEPTED` makes the client refresh `/me` and show the gate.
- The route-coverage test (roadmap §7.6) makes it impossible to add an ungated content route.

**D. A new version**
1. The owner publishes the new version and moves `legal.current.<key>`.
2. At each account's next request, `legal.required` lists it; the gate appears; posting is refused until it is accepted.
3. Reading continues, so a parent can still see lesson times and messages while deciding.

**E. Language**
- The gate opens the URL for the app's current language (`url_ar` or `url_en`).
- `locale` records the language the user was shown.
- Both language versions of one version number are the **same legal version**. Whether one prevails is legal item L-3.

### 1.5 What "acceptance" must look like on screen (store reviewers check this)

- Each checkbox has its own label naming the document. No pre-ticked boxes.
- Texts are in `lib/l10n/app_ar.arb` and `app_en.arb`, and the Admin Web copy files, in both languages, with Arabic as the primary language.
- Suggested labels (owner wording, N-3):
  - "I have read and agree to the Terms of Use" / «قرأتُ شروط الاستخدام وأوافق عليها»
  - "I have read and agree to the Code of Conduct" / «قرأتُ ميثاق السلوك وأوافق عليه»
- The gate is a full screen, readable by screen readers, and laid out right-to-left in Arabic.
- Screenshots of sign-up and the gate go into the store submission evidence (`app-store-compliance-checklist.md`).

---

## 2. Policy version management

### 2.1 Source of truth

| Item | Where it lives |
|---|---|
| The legal text (draft and approved) | `docs/legal/<document>-<lang>.md` in this repository, with a front-matter `version` and `effective_date` |
| The published page | The public site (§6). It is generated from the approved Markdown, never hand-edited |
| The version in force (acceptance documents) | `chat.legal_document_version` and `chat.config legal.current.<key>` |
| The version in force (notices and policies) | The page's header and its version history (§2.4) |
| Approval | The owner's approval, recorded in the PR that changes the text. Legal review evidence is attached to it |

### 2.2 Version names

- Use `YYYY-MM-DD` of the effective date, plus `.n` if there are two on one day, for example `2026-12-01` or `2026-12-01.2`. The name is short, sortable and fits #462's 64-character check.
- The owner may choose another scheme; nothing in code depends on it.
- **Arabic and English share one version name.** A change in only one language is still a new version of both, so they never drift apart.

### 2.3 Material and non-material changes

| Change | Example | What happens |
|---|---|---|
| **Material** | New fees or refund rules; a new kind of data collected or a new purpose; a new processor receiving children's data; changed enforcement or liability; changed governing law | New version, `requires_reacceptance = true` (P-3). Notice in the app and by e-mail at least {{NOTICE_DAYS}} days before the effective date (L-7). Acceptance documents ask again; for the Privacy Policy, the notice is the mechanism |
| **Non-material** | A typo, formatting, an updated contact address, a clarification that changes no right or duty | New version, `requires_reacceptance = false` (P-3), or no re-acceptance if P-3 is rejected. The version history records it |
| **Privacy Policy** | Any change | A new version and a history entry. A material change is notified in the app. It is never a click-through |

Deciding whether a change is material is the **owner's call, with counsel**. The PR that changes the text states which it is.

### 2.4 Previous versions and evidence

- Every superseded version stays published at a **stable, versioned URL**, for example `…/{lang}/terms/2026-12-01` (§6.2). The page footer lists the history (version, effective date, a one-line summary of the change).
- **Evidence of acceptance** for any account is the join of `chat.terms_acceptance` with `chat.legal_document_version`: the version, URL, hash (P-1) and time. Only the server role reads it (RLS fail-closed). An Admin Web view for the Super Admin is a later, read-only addition, never an edit.
- Acceptance rows are kept for as long as the account record exists, which is indefinitely, because erasure anonymises rather than deletes. Whether to set an end date is owner decision LD-7.

---

## 3. Reporting, blocking and moderation (PD-57)

PD-57 is merged. The rules below restate what is built, so the policies can rely on it, then list the gaps.

### 3.1 Report a message or a user (built)

- **Reasons:** `harassment`, `inappropriate`, `spam`, `child_safety`, `other`. `other` needs a note.
- **Limit:** 10 reports per reporter per hour.
- `due_at = created_at + 24 h` (PD-57 D-1). Managers are alerted at 18 h; the Super Admin at 24 h, and the report is marked overdue.
- **`child_safety`:**
  - the report is urgent and the Super Admin is notified immediately, past quiet hours;
  - it is visible only to the Super Admin and holders of `moderation.child_safety` (PD-57 D-4);
  - it never appears in a department queue.
- **Department scope (PD-57 D-3):** other holders of `moderation.view` and `moderation.act` see only their departments' reports. Anything else answers 404.
- **Resolutions:**
  - `no_action`;
  - `message_removed`, through `removeForModeration`;
  - `warned`, which sends a `conduct_warning` notice;
  - `account_suspended`, through PD-21 suspension;
  - `reassigned`, which creates a task.
- The reporter is always answered. A report row is never deleted. Its reason can only be raised to `child_safety`, never lowered.

### 3.2 Block (built)

- Enforced on the server (PD-57 D-5): messages, push, realtime, Notification Center, calls, and opening a direct conversation.
- **Exceptions (PD-57 D-6):**
  - lesson calls ring;
  - lesson cards and system messages are not hidden;
  - the academy's administrative channel stays.
- The official account, managers and the Super Admin cannot be blocked. Staff cannot block families.
- Every responsible manager is notified once per case.
- **Limit:** 20 blocks per day. Unblock is available.

### 3.3 Gaps the policies depend on

| # | Gap | Policy that depends on it | Proposal |
|---|---|---|---|
| MG-1 | The terms gate on `POST /reports` and `POST /me/blocks` (TODO ENG-10) | Terms of Use §acceptance | Part of ENG-10. **Rule:** a user without acceptance must still be able to report a **child-safety** concern. Proposal: gate `POST /reports` for every reason **except `child_safety`**, and record the exception in PD-58. This needs the owner's agreement (LD-11). Store reviewers favour more reporting, not less. |
| MG-2 | **No appeal workflow** | Enforcement Policy §appeals | **Phase 1** (no code): appeals by e-mail to {{SUPPORT_EMAIL}} within 14 days. A staff member not involved in the decision reviews it and records the outcome as a `moderation` audit entry by hand. **Phase 2**: a `content_report_appeal` table (report id, appellant, text, decided by, outcome, timestamps; append-only), a "Request a review" button on the outcome notice, and a queue tab. A new migration slot is needed. Owner decision LD-10 |
| MG-3 | **No pre-posting content filter** (Apple 1.2 "a method for filtering objectionable material") | Code of Conduct; App Review notes | Before submission, at least a **server-side word list** for the clearest terms, in Arabic and English. On a match, the message is held, the sender sees a neutral notice, and a report is created with reason `inappropriate`. The list is configuration, reviewed by the Teachers department. Images: staff review on report (documented). Recorded as a risk in the App Review notes. Owner decision LD-12 |
| MG-4 | What the **reported person** is told | Reporting Policy | Confirm in `moderation.service.ts` that the reporter's identity is never shown to the reported person. Add a test if one does not exist (DEV-CONFIRM #19) |
| MG-5 | Report and appeal **records retention** | Reporting Policy; Privacy Policy | Owner decision LD-7. No purge exists today, and a child-safety report must not be purged while a legal hold applies (`docs/security/child-safety-escalation.md` §legal hold) |
| MG-6 | **Evidence preservation** (legal hold) for child-safety cases | Child Safety Policy | Today the evidence is the report's JSON snapshot (text plus attachment object keys, not copies). A removed or "deleted for everyone" message is a soft delete, so its text and files stay today; but if E-2 (clearing deleted content) or any retention purge is built, referenced files would go. Proposal: on a `child_safety` report, copy referenced attachments to a restricted `evidence/` prefix that is excluded from purges, and record it in the audit log. Design with counsel (L-8) |

### 3.4 Enforcement records

- Every resolution, warning, suspension, reactivation and support session already writes to `chat.audit_log`, which is append-only and kept through erasure.
- The Enforcement Policy's "previous violations count" relies on the moderator reading earlier reports about the same subject. A "history" panel in the moderation detail view, read-only, is a small Admin Web addition (optional).

---

## 4. Privacy and data protection

### 4.1 Access controls (built; keep it that way)

- Permission keys are enforced in the API (`apps/api/src/platform/permissions/`). Admin Web capabilities are display only (`capabilities.ts`: "not a security boundary").
- **Teachers never read** `parent_file`, `family.country_code`, `family.subdivision_code` or family payments. Add a test that walks every route a teacher token can call and checks that none returns those fields (DEV-CONFIRM #11).
- The BR-1 boundary (no teacher–parent direct channel) is enforced in `authorization.service.ts` and by database triggers. Keep it, and keep its tests.

### 4.2 Audit logs

- `chat.audit_log` (before and after values, actor, reason, support-session id) is append-only.
- **Gap:** no retention period. Owner decision LD-7. The stated "7 years" applies to financial records and the audit log (erasure migration header). If confirmed, a purge job for rows older than the period runs in `worker.ts`, with an exemption for rows under legal hold.

### 4.3 Staff support sessions (PD-21)

**Built:**
- A written reason is required.
- Sessions last 15 minutes at a time, 60 at most.
- Writes are refused unless on an allowlist.
- No realtime connection.
- Every session and every request is logged in `impersonation_session` and `impersonation_action`; if writing the log fails, the request fails.
- Messages sent in a session are labelled "Sent by support".
- Staff accounts can never be entered this way.

**What the Privacy Policy says** is exactly this list (`privacy-policy-*.md` §staff support sessions).

**Gaps:**

| # | Gap | Proposal |
|---|---|---|
| S-1 | The user is **not told** that a session took place. Messages are labelled, but read-only sessions leave no trace on the user's side | Owner decision LD-3. Options: (a) a notice in the user's Notification Center once a session ends: "The academy's support team opened your account to help you on {date}. Reason: {category}." (b) Notice only when the session wrote something. (c) Status quo, disclosed in the policy. **Recommendation: (a)**. It is the most transparent, and it matches the expectation in the GCC laws that data subjects are informed of processing. A grant-based start (ADMIN-002) is deliberately silent today; changing that is part of the same decision |
| S-2 | **No second-person approval** | Acceptable with logging and time limits, if the owner agrees (LD-3). Optional: Super Admin review of a weekly digest of sessions |
| S-3 | **No periodic review of the log** | Add a monthly review of `impersonation_session` by the Super Admin to the Staff Terms and the operations calendar (no code) |
| S-4 | Session logs have **no retention period** | LD-7 |

### 4.4 Account deletion (built)

See `data-inventory-and-retention-matrix.md` §4. The policies describe it as built. Proposed changes, each needing an owner decision:

| # | Change | Why |
|---|---|---|
| E-1 | Erasure also clears `trial_subscription` parent name, e-mail and phone for that person, and `payment_request.payer_name` once the financial retention period has passed | Today they survive deletion (DEV-CONFIRM #12) |
| E-2 | "Delete for everyone" also clears the message body and removes its attachments after a short undo window (or a moderation hold) | Today the text and files stay (DEV-CONFIRM #13). The Privacy Policy must otherwise say so |
| E-3 | Purge revoked `session` rows after a set period | They hold a hashed IP and user agent (DEV-CONFIRM #10) |
| E-4 | Children's records when the **last** parent leaves | LD-6. The academy keeps them as "the academy's records". The GCC laws give the parent, as guardian, deletion rights over the child's data, subject to retention exceptions. Proposal: keep only what a retention period requires (lesson and payment history), delete the photo and about text, and anonymise the child's name after the retention period |
| E-5 | Tell processors | Stripe: the customer data is Stripe's under its own policy; no API call is needed, because Jawwid creates no Customer object. Sentry: the events hold only a hashed id, so they expire under Sentry's own retention (DEV-CONFIRM #6). LiveKit: no stored content. Push tokens: deleted locally, and Apple/Google discard them. **Document this; build nothing** unless counsel requires it |
| E-6 | Remove the child's name from the Stripe line item (`checkout.service.ts:129`), or keep it and disclose it | It is the only place a child's name reaches a third party. Disclosed in the Privacy Policy today. Owner decision LD-8 |

### 4.5 Data retention (purges to configure)

These periods exist today and are enforced in code:
- notifications: 90 and 365 days;
- story media: 72 hours;
- whiteboard trash: 30 days;
- a departed teacher's boards: 12 months;
- trial location: 90 days;
- sign-up failures: 7 days;
- backups: 30 and 56 days.

**No period exists** for:
- messages;
- call records;
- lesson records;
- reports;
- the audit log;
- support-session logs;
- sessions;
- feedback;
- payments (the stated "7 years" is not enforced).

When the owner sets them (LD-7):
- Put each period in `chat.config` (like `story.media_retention_hours`), never a constant.
- One worker job per table family, in `worker.ts`, idempotent, in batches, with an `audit_log` summary row per run.
- A child-safety or legal-hold flag exempts rows.
- Add a test per job with fixed dates (AGENTS.md: never `today + N`).
- Update the retention table in `privacy-policy-*.md` in the same PR.

### 4.6 Access and data-export requests

- **There is no self-service export.**
- **Phase 1 (no code):**
  1. Requests arrive at {{PRIVACY_EMAIL}} or through in-app feedback.
  2. Staff verify identity by asking the person to make the request from the signed-in account, or to confirm a one-time code sent to the account's e-mail.
  3. The Super Admin produces an export with a reviewed, read-only SQL script kept in `scripts/privacy/` (a future PR). It covers the profile, children, lesson records, messages the person sent, payments and consent records, as JSON and PDF.
  4. The export is delivered through a time-limited signed link.
  5. Each step is logged in `audit_log`.
  6. Deadline: within 30 days (L-5 confirms the strictest legal deadline).
- **Phase 2:** a `GET /me/export` job that produces the same bundle, rate-limited, and never available in a support session.
- **Correction:** parents edit their profile and their children's details in the app; anything else on request. Consent withdrawal: the PD-48 notice is acknowledged, not consented to; story-certificate consent can be withdrawn (confirm the UI exists, DEV-CONFIRM #20).

### 4.7 Third-party deletion requests

When a person asks for deletion beyond what erasure does:
1. Run the erasure.
2. Delete any trial records by hand (until E-1 is built).
3. Record that the processors were considered (E-5).
4. Answer within the legal deadline.
5. Keep a log entry of the request and the answer, but not the deleted data.

### 4.8 Privacy-incident handling (missing; to write)

`docs/infrastructure/incident-response.md` covers outages, not personal-data breaches. Add a **privacy-incident runbook**, owned by the Super Admin and {{DPO_CONTACT}}, covering:
1. Detect and contain.
2. Assess: whose data (children's?), which countries, which processors.
3. Record it in an incident register: what, when, who, the decision, and the notifications made.
4. **Notify the authorities where the law requires.** The Saudi PDPL requires notification to SDAIA within **72 hours** of becoming aware; other countries' rules are in `legal-research-and-compliance-matrix.md`. Notify the affected parents without undue delay.
5. Notify the processors and get their reports.
6. Hold a post-incident review.

Processors must notify Jawwid promptly (check each DPA, L-4). This is documentation, not code.

### 4.9a Parental consent for children's data (LD-13)

**Why.** The research found that several target-market laws expect the guardian's consent to the processing of a child's data to be explicit, documented and withdrawable (`legal-research-and-compliance-matrix.md` F-2):
- UAE Decree-Law 26/2025, for children under 13;
- Qatar PDPPL Art. 17;
- Oman PDPL Art. 6;
- the Saudi Implementing Regulation.

The same research treats Quran and Islamic-studies enrolment as data that may reveal religion, which is sensitive data (F-1).

**What exists today:**
- the PD-48 lesson-audio acknowledgement, which is a notice and not a consent;
- the terms acceptance from #462, which is a contract.

**Neither is a consent to process the child's data.** Bundling that consent into the terms is what counsel is likely to advise against (L-14).

**Proposal (no new table).** Reuse the PD-48 parent-notice mechanism. `chat.parent_notice_ack.notice_key` already accepts any key matching `^[a-z][a-z0-9_]{1,39}$` (migration `20261029235700`, line 21), so a new key needs **no migration**:
1. Add `child_data: 1` to `PARENT_NOTICES` in `apps/api/src/lesson-audio/parent-notices.ts`, or better, move the map to a neutral module, since it is no longer only about lesson audio.
2. At sign-up and enrolment, show a separate, unticked checkbox. Wording is owner and legal text (N-3), for example: "As the parent or legal guardian, I consent to the Academy processing my children's information, including their lesson and Quran records, to teach them, as described in the Privacy Policy."
3. Families already enrolled are asked once, at their next sign-in, the same way PD-48 is today.
4. **Withdrawal.** An acknowledgement row cannot express withdrawal. Withdrawal is therefore one of:
   - (a) removing a child from the academy, an operations flow that exists today;
   - (b) deleting the account;
   - (c) a new `parent_notice_withdrawal` row type, which needs a migration if the owner wants a self-service toggle.

   Phase 1 documents (a) and (b) in the Privacy Policy §6.
5. **Scope.** The acknowledgement is per parent contact, and covers that family's children. A per-child record is a later refinement, if counsel requires it.

This is a proposal for the lead and the PD-48 owner. It needs owner decision LD-13 and the legal wording.

### 4.9 Processor and transfer register (no code)

Keep a vendor register, a new file `docs/legal/processor-register.md` once the DPAs are confirmed. For each vendor: the entity, the DPA's date, the data region, the sub-processors link, the transfer mechanism, and the deletion terms. Seeded from `data-inventory-and-retention-matrix.md` §2.

---

## 5. Developer data inventory

The table the owner asked for is in `data-inventory-and-retention-matrix.md` §3:

| Data Category | Data Collected | Purpose | Storage Location | Third Party | Retention |
|---|---|---|---|---|---|

Every unknown in it is marked **DEV-CONFIRM #n** (§6 of that file).

**Rule:** a PR that adds a table, column, attachment kind, SDK or vendor that holds personal data updates that table **and** the Privacy Policy retention table in the same PR. Proposal: add a check to `scripts/qa/guards.sh`. When a migration creates a table in `chat`, the guard fails unless `docs/legal/data-inventory-and-retention-matrix.md` names it. This is a guard change, so it goes in its own PR under the lead (no Code Owner path).

---

## 6. Public hosting and links in the app

The full requirements are in `public-hosting-requirements.md`. What engineering does:

1. **One build-time setting per document type, as today.** `PRIVACY_POLICY_URL` and `TERMS_URL` take a `{lang}` placeholder (`legal_links.dart`). Example: `https://<host>/{lang}/privacy`, with the host to be decided by the owner (H-1). **No URL is written into code.**
2. **The acceptance documents' URLs come from the server** (`legal_document_version.url_ar` / `url_en`), never from the build. So the gate can always show the version in force without a new app release.
3. **A link check in the release audit** (WP-6), sketched below. A pinned version may simply not be published yet, so it fails only for the version in force. This is a release-time script under `scripts/qa/`, not CI on every PR.
   ```
   for each legal.current.<key> → fetch url_ar and url_en →
     status 200, no authentication, content-type text/html,
     page shows the version and effective date →
     SHA-256 equals content_sha256_* (P-1)
   ```
4. **Admin Web and the teacher web portal:** add the same two links to the sign-in page and the account menu, using the Admin Web copy files. This is small and independent.
5. **Support URL and contact** (Apple 1.5, Apple 1.2 "published contact information"): the app's Settings shows the support e-mail and the support page link. These are owner-provided; add them as `SUPPORT_URL` and `SUPPORT_EMAIL` dart-defines with the same https rule. Proposal P-5.
6. **Account deletion web resource** (Google Play): The route `/account-deletion` exists in code (`apps/api/src/account-deletion/`); the production host `api.chat.jawwid.com` comes from `docs/infrastructure/production-readiness.md`, not from code (the code uses `${API_DOMAIN}`). Whether the store listing uses that host or a page on the public site that links to it is owner decision H-3.

---

## 7. Work breakdown (proposed tickets; the lead assigns)

| Ticket | Scope | Depends on | Risk |
|---|---|---|---|
| L-ENG-1 | P-1, P-2, P-3 into #462 (or ENG-10's migration) | Lead and PD-58 owner agree | High (migration) |
| L-ENG-2 | ENG-10 API gate, including the child-safety report exception (MG-1) | #462 merged; LD-11 | High (authorization) |
| L-ENG-3 | ENG-11 Flutter gate and sign-up checkboxes; ENG-12 Admin Web gate | L-ENG-2 contract | Medium |
| L-ENG-4 | Support URL and e-mail in Settings (P-5); legal links in Admin Web and the portal | Owner values | Low |
| L-ENG-5 | Support-session user notice (S-1) | LD-3 | Medium |
| L-ENG-6 | Server word-list filter (MG-3) | LD-12 | Medium |
| L-ENG-7 | Appeals, phase 2 (MG-2) | LD-10 | Medium (migration) |
| L-ENG-8 | Erasure additions E-1, E-2, E-3, E-6 | LD-6, LD-8 | High (data deletion) |
| L-ENG-9 | Retention purges (§4.5) | LD-7 | High (data deletion) |
| L-ENG-10 | Export script, phase 1 (§4.6) | — | Medium (personal data) |
| L-ENG-11 | Release link and hash check (§6.3); inventory guard (§5) | P-1 | Low |
| L-ENG-12 | Child-safety evidence hold (MG-6) | L-8 | High |
| L-ENG-13 | Parental consent for children's data (§4.9a) | LD-13 and the legal wording | Medium |

Every ticket follows `AGENTS.md`:
- tests first;
- a migration slot from the lead;
- Arabic and English strings;
- no blanket RLS.
