# App Store and Google Play review accounts

Store-readiness item 7, Play P-5. Owner decision on 2026-11-07: the review accounts live in their **own
organization**, "Jawwid App Review" (slug `app-review`). A reviewer never sees a real family or a real member of
staff. Nothing a reviewer does reaches Jawwid's staff: a report, a block, a message, or a missed lesson report.

Tracker: LR-05 (Apple 2.1(a); Play App access). The command is `apps/api/src/cli/provision-review-cohort.ts` and the
data is in `apps/api/src/cli/review-cohort.ts`. The test is `apps/api/test/integration/review-cohort.spec.ts`. In
production it runs **only** through the "Review cohort" workflow (`.github/workflows/review-cohort.yml`), never on a
laptop.

## What it creates

| Who | Login | What they see |
|---|---|---|
| Parent "Mariam Adel" | `parent@<domain>` | Child "Yahya Adel", the family group with the supervisor and the teacher, a 1:1 with the supervisor, upcoming lessons |
| Teacher "Hassan Mourad" | `teacher@<domain>` | The same family group, a 1:1 with the supervisor, Yahya's lessons and schedule |
| Disposable parent "Laila Hamdi" (for the deletion test) | `parent2@<domain>` | Her own family ("Hamdi family") and child "Omar Hamdi" (no teacher, no lessons), and a 1:1 with the supervisor. She shares no chat with the other two. |
| Supervisor, Operations Manager, Teachers manager | **none** | Synthetic staff with no login. Nobody can sign in as them. |

- **No admin access.** The review organization has no super admin. The three accounts are ordinary parents and an
  ordinary teacher, and every admin route refuses them.
- **The deletion test uses `parent2`.** Reviewers delete that account in the app (Apple 5.1.1(v)). Deleting it
  changes nothing the parent and teacher accounts see, and the next run creates it again.
- **No WhatsApp code.** Reviewers sign in with email and password on the normal login screen. The WhatsApp code is
  asked for only when a parent first sets their own password. Here, the owner sets the passwords instead. Nothing
  bypasses the code.
- **Lessons.** Three 30-minute lessons a week, on Monday, Wednesday and Friday at 16:00 Cairo time. The worker keeps
  creating the upcoming ones for as long as the schedule stands.
- **No real payments (OA-12, owner decision 2026-11-10).** The children have no subscription, so the payment lock never
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
- **Malformed** (not an array, or any entry that is not a uuid): treated as "no review
  organization", so every family behaves as a real one, and the API logs an error. **Unreadable** (the
  database read fails): the request fails with 500; it never falls back to public behaviour. A mistake in this row can only
  make the review account behave like a real one. It can never make a real family see the demo.
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

## Run it (the owner, in the browser; never on a laptop)

It runs only through the **Review cohort** GitHub workflow. The workflow uses the API image already built for a
commit on main, runs as the `production` GitHub Environment (so that Environment's required reviewers approve every
run), and never prints a password, a review login or the database address: the repository is public, so anyone can
read its run logs and summaries.

Because it runs as the `production` Environment, every run also appears in that Environment's **deployment
history**, next to the real deploys. A "Review cohort" entry there is this workflow, not a deploy: it changes only
the review organization's rows and deploys nothing.

1. Choose the login domain and three different passwords, each at least 12 characters.
   - **The domain must be one Jawwid controls** (or one that can never receive mail). "Forgot password" sends a
     code to the login email, so whoever reads mail at that domain can take over a parent account.
   - Keep the same domain for good. The command refuses a different one once the accounts exist.
2. In GitHub: Settings → Environments → `production` → Environment secrets, add the three passwords (`DATABASE_URL`
   is already there from the production deploy):
   - `REVIEW_PARENT_PASSWORD` (for `parent@<domain>`)
   - `REVIEW_TEACHER_PASSWORD` (for `teacher@<domain>`)
   - `REVIEW_DELETION_PARENT_PASSWORD` (for `parent2@<domain>`, the deletion test)
3. **Run it only when no production deploy is in progress** (Actions → **Deploy production** shows no queued or
   running run), and with **the SHA production currently runs**: the `image_tag` of the latest successful
   **Deploy production** run. The workflow checks only that the SHA is on main. A merged commit that is not deployed
   yet may expect a migration production does not have, and the run would then stop partway. (A re-run with the
   right SHA repairs that: every step finds before it creates.) The two workflows deliberately do not share a
   concurrency group, because a queued cohort run could then cancel a queued deploy, so this rule is yours to keep.
4. Actions → **Review cohort** → Run workflow, from `main`:
   - `image_tag`: the SHA from step 3 (it must be on main, and its API image must exist);
   - `email_domain`: the domain from step 1;
   - `confirm_email_domain`: the same domain typed again. The first run fixes the domain for good, so the run stops,
     changing nothing, if the two differ.
   Then approve the run when the `production` Environment asks.
   - Before you are asked to approve, a **Preflight** job (no secrets) refuses the run unless the `production`
     Environment has **required reviewers** and **Deployment branches = Selected branches, with exactly one rule:
     the branch `main`**. It reads this through the GitHub API and refuses if it cannot read it. Its summary lists
     the reviewers and branch rules it found.
   - Preflight also checks the **image itself**, not only the commit: `api:<sha>` must point at the digest that a
     **Deploy staging** run at that same commit recorded when it pushed the image (LR-46). If the tag was
     overwritten, or the record is older than 90 days, the run stops. Only a **manual Deploy staging run from `main`**
     counts (a pull-request or branch run could execute an edited workflow), so build the image while that commit is
     `main`'s head; for an older commit, deploy a newer one instead.
     The `production` Environment's required reviewer may approve their own run: with the owner as the only reviewer
     that is intended (self-review and admin bypass are shown in the run summary, not refused). A commit from before this check cannot be used, because its workflow records no digest. The accounts job
     then pulls and runs the image **by digest**, and the run summary records it.
   - It stops with a clear error, changing nothing, if a secret is missing, the two domains differ, the SHA is not
     on main, the image does not exist, or the image is not the recorded one.
   - It writes the passwords to private (mode 600) files on the runner only for the run, and deletes them at the
     end even if the run fails.
   - **It never prints the logins** (LR-46 P3-9). The repository is public, so its run logs and summaries are
     too. The run log and summary show only how many review logins were provisioned (and how many were new), the
     `app-review` organization, the commit and the image digest. The login domain is masked in the log (`***`),
     including in any error message from the command, and the command's own output is reduced to counts before it
     is printed. A domain containing a line break is refused before anything else, without printing it (a mask
     covers one line). The database's host:port/name is masked the same way, and a password or the database URL is
     never printed.
   - **This only reduces exposure; it does not protect the accounts.** The login names (`parent`, `teacher`,
     `parent2`) are written in this public repository, and the domain may be easy to guess (for example Jawwid's
     own domain). Anyone who guesses it can still lock a review account with ten wrong passwords during store
     review. The real protection is a login domain (or login names) that is hard to guess; which domain to use is
     the owner's decision. If a review account is locked, re-running this workflow clears the lockout.
   - **Where the logins are:** `parent@<domain>`, `teacher@<domain>` and `parent2@<domain>`, with the domain you
     typed in step 4. Keep them, with the passwords, in your password manager and in the store review fields of
     step 5. The run will not show them to you.
5. Enter the logins and passwords **only** in App Store Connect (App Review Information → Sign-in required) and in
   Play Console (App content → App access, and Testing → Pre-launch report → Credentials). Never put them in the
   repository, a ticket, a chat or a log.

For local and CI testing the command itself is unchanged: `node dist/cli/provision-review-cohort.js --target
<host:port/db> --email-domain <domain> --parent-password-file <file> --teacher-password-file <file>
--deletion-parent-password-file <file>`, each file chmod 600. `--target` must match `DATABASE_URL`; outside local,
test and CI it refuses without `--allow-non-local`; a password is never accepted on the command line.

## It writes only into its own organization

The organization is found by its slug `app-review`. The database has no column that marks an organization as the
review one, so the slug alone is not trusted (LR-46 P3-10). Before it writes anything, the command checks that the
organization with that slug:

- is named exactly "Jawwid App Review", the name the command gives it when it creates it; and
- has no login other than `parent@`, `teacher@` and `parent2@` of the right kind (or a login a reviewer deleted);
- has no staff other than the three synthetic ones;
- has no teacher other than "Hassan Mourad", except a teacher whose login was deleted (deletion keeps the teacher
  row and renames it "Deleted user"; it is accepted because its login is deleted, not because of that name); and
- has no family other than "Adel family" and "Hamdi family" (checked by name).

Only logins, staff, teachers and families are checked. Contacts, children, departments and conversations are not:
a contact or child added by hand to one of the two review families is not caught.

If any check fails, it stops with `NOT_REVIEW_ORGANIZATION` and writes nothing. That means a real organization
took the slug, or someone added people to the review organization by hand. Investigate; do not rename or empty the
organization to make the run pass.

"Writes nothing" is promised for `NOT_REVIEW_ORGANIZATION`, not for every refusal. Later refusals
(`DOMAIN_CHANGED`, `STAFF_ACCOUNT`, `SUBJECT_TAKEN`, `ACCOUNT_DEACTIVATED` and the rest) can come after the run has
already written staff, departments and, for some, a login and its password into the review organization. The
checks and the writes are also not one transaction, so someone added in the moment between them is not seen.

It also never takes an account from another organization. If `parent@<domain>`, `teacher@<domain>` or
`parent2@<domain>` already belongs to any other organization, the run stops with `SUBJECT_TAKEN`. That account is
left exactly as it was: not moved, no new password, and no seat in any review chat. Choose a domain no real account
uses.

## Run it again

Run the workflow again after every review, and whenever an account misbehaves. It is safe to repeat:

- **It never duplicates anything.** Rows are found inside the review organization first.
- **It clears the account lockout.** Ten wrong passwords lock an account for 15 minutes. The login rate limit (also
  10 tries per 15 minutes, kept in Redis) is not cleared. It runs out on its own within 15 minutes.
- **It sets each password from its file.** A changed password also signs out every device that used the old one.
  The change is recorded in the audit log: that it happened, never the password. If a reviewer used "Forgot
  password", a re-run puts your password back.
- **It restores a deleted parent account**, either parent. Deleting an account in the app erases the login at once.
  The family and the child stay. The command creates the parent again with the same email and gives it back its
  place: the family group for `parent`, a new 1:1 with the supervisor for `parent2`.
- **The teacher account cannot be deleted** while a child is assigned to it, so it never needs restoring.
- **Run one copy at a time.** Two runs at once could create duplicate rows. The workflow never runs two at once: it
  holds a second run as pending until the first one ends. GitHub keeps only one pending run, so a third run cancels
  the pending second one (nothing is changed by a cancelled pending run). Start the next run after the last one ends.
- **The same rules as the first run apply:** no production deploy in progress, and the SHA production currently runs
  (step 3 above).

After a parent deletion, the review organization keeps a "family without an account" task that nobody works on. It
is harmless.

## Review notes (paste into both consoles; the credentials go in their own fields)

> Sign in with the parent or the teacher account from the credentials field. Sign-in is email and password; no
> verification code is needed. The parent account has one child with weekly lessons, a family group chat with the
> child's supervisor and teacher, and a direct chat with the supervisor. The teacher account is that child's teacher.
> The two accounts can message each other in the family group. To test account deletion, please use the third
> account (parent2), which exists for that purpose; deleting it does not affect the other two. All people and data
> in these accounts are fictional. Deleting an account in the app takes effect immediately.

## Still open (owner)

These need an owner decision or action before the review data is complete (LR-05, LR-09f):

- **Switch on the review payment mode.** Approve the review-cohort command change that writes
  `review.sandbox_organization_ids` (section "Review payment mode"), and run it on the production backend. Until then
  the review family sees no amount due, and the store notes must use the "nothing to pay" text.
- **Past lessons and lesson reports.** There are none yet. They need the owner's approval of the report content,
  which may name surahs, and then a follow-up PR.
- **An exception to OD-04.** In Chat, only Core's assignment ingestion may set a child's teacher. Ingestion does not
  exist yet, so the command sets the teacher of its one taught synthetic child (Yahya; the deletion-test child has
  no teacher) through the same stand-in the QA seed uses,
  on production, and only inside the review organization. When ingestion exists, the review child's teacher should
  come from Core.

Also open:

- A production backend (LR-01, OA-21). The workflow runs against the database that the store build talks to.
- Who reads reports that reviewers file inside the review organization. Today nobody does.
