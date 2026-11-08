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
- **No payments.** The children have no subscription, so the payment lock never applies (PD-30) and there is nothing
  to pay.
- **No lesson content yet.** There are no past lessons or lesson reports, because those need the owner to approve
  the content. The sample messages are everyday academy talk.

## Run it (the owner, in the browser; never on a laptop)

It runs only through the **Review cohort** GitHub workflow. The workflow uses the API image already built for a
commit on main, runs as the `production` GitHub Environment (so that Environment's required reviewers approve every
run), and never prints a password or the database address.

1. Choose the login domain and three different passwords, each at least 12 characters.
   - **The domain must be one Jawwid controls** (or one that can never receive mail). "Forgot password" sends a
     code to the login email, so whoever reads mail at that domain can take over a parent account.
   - Keep the same domain for good. The command refuses a different one once the accounts exist.
2. In GitHub: Settings → Environments → `production` → Environment secrets, add the three passwords (`DATABASE_URL`
   is already there from the production deploy):
   - `REVIEW_PARENT_PASSWORD` (for `parent@<domain>`)
   - `REVIEW_TEACHER_PASSWORD` (for `teacher@<domain>`)
   - `REVIEW_DELETION_PARENT_PASSWORD` (for `parent2@<domain>`, the deletion test)
3. Actions → **Review cohort** → Run workflow, from `main`:
   - `image_tag`: the full commit SHA that production runs (it must be on main, and its API image must exist);
   - `email_domain`: the domain from step 1.
   Then approve the run when the `production` Environment asks.
   - It stops with a clear error, changing nothing, if a secret is missing, the SHA is not on main, or the image
     does not exist.
   - It writes the passwords to private (mode 600) files on the runner only for the run, and deletes them at the
     end even if the run fails.
   - It prints ids, the three logins and the database's host:port/name, never a password or the database URL.
4. Enter the logins and passwords **only** in App Store Connect (App Review Information → Sign-in required) and in
   Play Console (App content → App access, and Testing → Pre-launch report → Credentials). Never put them in the
   repository, a ticket, a chat or a log.

For local and CI testing the command itself is unchanged: `node dist/cli/provision-review-cohort.js --target
<host:port/db> --email-domain <domain> --parent-password-file <file> --teacher-password-file <file>
--deletion-parent-password-file <file>`, each file chmod 600. `--target` must match `DATABASE_URL`; outside local,
test and CI it refuses without `--allow-non-local`; a password is never accepted on the command line.

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
- **Run one copy at a time.** Two runs at once could create duplicate rows. The workflow queues a second run until
  the first one ends.

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

These need an owner decision before the review data is complete (LR-05, LR-09f):

- **Past lessons and lesson reports.** There are none yet. They need the owner's approval of the report content,
  which may name surahs, and then a follow-up PR.
- **Something payable (OA-12).** The review children have no subscription, so a reviewer has nothing to pay and
  cannot reach the pay sheet (found in #507). The owner must decide what the review family may be billed for, and
  how, before a follow-up PR adds it.
- **An exception to OD-04.** In Chat, only Core's assignment ingestion may set a child's teacher. Ingestion does not
  exist yet, so the command sets the teacher of its one taught synthetic child (Yahya; the deletion-test child has
  no teacher) through the same stand-in the QA seed uses,
  on production, and only inside the review organization. When ingestion exists, the review child's teacher should
  come from Core.

Also open:

- A production backend (LR-01, OA-21). The workflow runs against the database that the store build talks to.
- Who reads reports that reviewers file inside the review organization. Today nobody does.
