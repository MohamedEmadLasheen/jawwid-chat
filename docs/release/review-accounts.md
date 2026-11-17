# App Store and Google Play review accounts

Store-readiness item 7, Play P-5. Owner decision on 2026-11-07: the review accounts live in their **own
organization**, "Jawwid App Review" (slug `app-review`). A reviewer never sees a real family or a real member of
staff. Nothing a reviewer does reaches Jawwid's staff: a report, a block, a message, or a missed lesson report.

The command is `apps/api/src/cli/provision-review-cohort.ts` and the data is in `apps/api/src/cli/review-cohort.ts`.
The test is `apps/api/test/integration/review-cohort.spec.ts`.

## What it creates

| Who | Login | What they see |
|---|---|---|
| Parent "Mariam Adel" | `parent@<domain>` | Child "Yahya Adel", the family group with the supervisor and the teacher, a 1:1 with the supervisor, upcoming lessons |
| Teacher "Hassan Mourad" | `teacher@<domain>` | The same family group, a 1:1 with the supervisor, Yahya's lessons and schedule |
| Supervisor, Operations Manager, Teachers manager | **none** | Synthetic staff with no login. Nobody can sign in as them. |

- **No admin access.** The review organization has no super admin. The two accounts are an ordinary parent and an
  ordinary teacher, and every admin route refuses them.
- **No WhatsApp code.** Reviewers sign in with email and password on the normal login screen. The WhatsApp code is
  asked for only when a parent first sets their own password. Here, the owner sets the passwords instead. Nothing
  bypasses the code.
- **Lessons.** Three 30-minute lessons a week, on Monday, Wednesday and Friday at 16:00 Cairo time. The worker keeps
  creating the upcoming ones for as long as the schedule stands.
- **No real payments (OA-12, owner decision 2026-11-10).** The child has no subscription, so the payment lock never
  applies (PD-30). Once the review organization is listed in the review payment mode (next section), the parent sees a
  demo amount due and can open the pay sheet, but the server makes every payment a demo: nothing can be paid, sent
  or stored.
- **No lesson content yet.** There are no past lessons or lesson reports, because those need the owner to approve
  the content. The sample messages are everyday academy talk.

## Review payment mode (OA-12)

**Owner decision (2026-11-10).** Reviewers never see Jawwid's real bank details, cannot make a real bank transfer,
and cannot upload or store a real receipt. No real charge, invoice, payment request, payment obligation or staff task
is created for a review account. Public families are not affected. The server enforces all of this; hiding buttons
in the app is only a courtesy. The code is `apps/api/src/billing/review-mode.ts`.

**The switch.** One `chat.config` row:

| Key | Value | Example |
|---|---|---|
| `review.sandbox_organization_ids` | A JSON **array** of organization ids (uuid strings) | `["3f0c…-…"]` (the "Jawwid App Review" organization's id) |

- **No route writes it.** `/billing/settings` writes only `billing.bank_account` and `billing.invoice_issuer`, and
  there is no generic config route. The review-cohort command will set it, in a separate, owner-approved change and
  run. That change should *add* the review organization's id to the array (keeping any id already there), never
  replace the array, and print the value it wrote.
- **Absent:** no organization is in review mode.
- **Not an array** (a string, an object, a number): treated as "no review organization" (public behaviour), and an
  error is logged.
- **An array with entries that are not uuid strings** (B5 P2-1): those entries are ignored and logged (count and
  position, never the value); every valid uuid in the array stays in review mode. A typo beside the review
  organization's id therefore never switches its review mode off, and an ignored entry names no organization, so it can
  never put a real family in the demo.
- **Unreadable** (the database read fails): the request fails with 500; it never falls back to public behaviour. A
  mistake in this row can only make a review account behave like a real one (no money can move: a review family has
  nothing payable). It can never make a real family see the demo: only an organization whose own uuid is in the array
  is in review mode.
- It is read on every request, so a change applies at once, without a restart.

**What a parent of a review organization gets:**

| Where | Behaviour |
|---|---|
| `GET /me/billing` | `reviewMode: true`. One synthetic amount due, never stored: "Lesson package (demo): 8 live one-to-one lessons", USD 80.00, for the family's first child, under the fixed id `00000000-0000-4000-8000-0000000a99e1`. Demo bank details ("Demo bank details for App Review: no transfer is possible", no IBAN, no SWIFT). The real `billing.bank_account` is not even read. `cardAvailable: true` |
| Pay by card (app, `POST /me/billing/checkout`) | Answers `/api/v1/pay/review-demo` (with `?lang=ar` or `?lang=en`), a static page (the same strict CSP as the pay link page) that explains, in Arabic and English, that the live app opens Stripe's secure checkout here and that the review account cannot pay. Stripe is never called. No `payment_checkout` row, no Stripe customer, no payment request |
| Pay link (`/pay/:token`) of a review family's request | Demo bank details, without the "send a photo of the receipt" line; "Pay by card" goes to the same demo page, never Stripe |
| Bank transfer: `POST /me/billing/receipts/upload` and `POST /me/billing/receipts` | Refused: 403 `COMM.BILLING_DENIED` with `error.detail.reviewMode = true`, before anything is signed, stored or written. The app shows a notice on the bank-transfer page and turns Send off |
| Request renewal (`POST /me/subscriptions/:learnerId/renewal-request`) | Refused the same way, before anything is looked up: no renewal request, audit row, chat card or staff task |

**Staff of a review organization** (insurance; the rule no longer depends on that organization having no staff
logins): every staff money write (payment requests and their cancellation, instalments, recorded payments and
voids, receipt decisions, trial payment requests, a family's billing settings, lesson-package voids: everything
behind `BillingService.requireRecorder`), refunds, and `GET`/`POST /billing/settings` are refused the same way. Staff reach only
their own organization's families, so this covers every review family too.

**A failed read** of the key (a database error, not a malformed value) fails the request (500). It never falls back to
public behaviour, so a database hiccup cannot show a review account the real bank details or let it write.

The test is `apps/api/test/integration/review-payment-mode.spec.ts`. It counts the rows in the payment, receipt,
checkout, invoice, Stripe customer, audit, task, renewal request, message, card, notification, outbox and config
tables before and after, and they must not change.

## Run it (the owner, against the backend the store build uses)

1. Choose the login domain and two different passwords, each at least 12 characters.
   - **The domain must be one Jawwid controls** (or one that can never receive mail). "Forgot password" sends a
     code to the login email, so whoever reads mail at that domain can take over the parent account.
   - Keep the same domain for good. The command refuses a different one once the accounts exist. Write each password to its own
   file and make it private:
   ```bash
   umask 077; printf '%s' '<parent password>' > ~/.jawwid/review-parent.pw; printf '%s' '<teacher password>' > ~/.jawwid/review-teacher.pw
   ```
2. Run the command:
   ```bash
   DATABASE_URL=... APP_ENV=production node apps/api/dist/cli/provision-review-cohort.js --target <host:port/db> --email-domain <domain> --parent-password-file ~/.jawwid/review-parent.pw --teacher-password-file ~/.jawwid/review-teacher.pw --allow-non-local
   ```
   - `--target` must match `DATABASE_URL`.
   - Outside local, test and CI it refuses to run without `--allow-non-local`.
   - A password is never accepted on the command line.
   - It prints ids and the two logins, never a password.
3. Enter the logins and passwords **only** in App Store Connect (App Review Information → Sign-in required) and in
   Play Console (App content → App access, and Testing → Pre-launch report → Credentials). Never put them in the
   repository, a ticket, a chat or a log.

## Run it again

Run it again after every review, and whenever an account misbehaves. It is safe to repeat:

- **It never duplicates anything.** Rows are found inside the review organization first.
- **It clears the account lockout.** Ten wrong passwords lock an account for 15 minutes. The login rate limit (also
  10 tries per 15 minutes, kept in Redis) is not cleared. It runs out on its own within 15 minutes.
- **It sets each password from its file.** A changed password also signs out every device that used the old one.
  The change is recorded in the audit log: that it happened, never the password. If a reviewer used "Forgot
  password", a re-run puts your password back.
- **It restores a deleted parent account.** Deleting an account in the app erases the login at once. The family and
  the child stay. The command creates the parent again with the same email and gives it back its place in the
  family group.
- **The teacher account cannot be deleted** while a child is assigned to it, so it never needs restoring.
- **Run one copy at a time.** Two runs at once could create duplicate rows.

After a parent deletion, the review organization keeps a "family without an account" task that nobody works on. It
is harmless.

## Review notes (paste into both consoles; the credentials go in their own fields)

> Sign in with the parent or the teacher account from the credentials field. Sign-in is email and password; no
> verification code is needed. The parent account has one child with weekly lessons, a family group chat with the
> child's supervisor and teacher, and a direct chat with the supervisor. The teacher account is that child's teacher.
> The two accounts can message each other in the family group. All people and data in these accounts are
> fictional. Deleting an account in the app takes effect immediately.

## Still open (owner)

- **Switch on the review payment mode.** Approve the review-cohort command change that writes
  `review.sandbox_organization_ids` (section "Review payment mode"), and run it on the production backend. Until then
  the review family sees no amount due, and the store notes must use the "nothing to pay" text.

- **An exception to OD-04.** In Chat, only Core's assignment ingestion may set a child's teacher. Ingestion does not
  exist yet, so the command sets the teacher of its one synthetic child through the same stand-in the QA seed uses,
  on production, and only inside the review organization. When ingestion exists, the review child's teacher should
  come from Core.

- A production backend. The command runs against the database that the store build talks to.
- Past lessons with reports. They need the owner's approval of the report content, which may name surahs, and then
  a follow-up PR.
- Who reads reports that reviewers file inside the review organization. Today nobody does.
- Whether to add a third, disposable parent account for the deletion test.
