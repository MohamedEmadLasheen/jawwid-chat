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
- **No payments.** The child has no subscription, so the payment lock never applies (PD-30) and there is nothing to
  pay.
- **No lesson content yet.** There are no past lessons or lesson reports, because those need the owner to approve
  the content. The sample messages are everyday academy talk.

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

- **An exception to OD-04.** In Chat, only Core's assignment ingestion may set a child's teacher. Ingestion does not
  exist yet, so the command sets the teacher of its one synthetic child through the same stand-in the QA seed uses,
  on production, and only inside the review organization. When ingestion exists, the review child's teacher should
  come from Core.

- A production backend. The command runs against the database that the store build talks to.
- Past lessons with reports. They need the owner's approval of the report content, which may name surahs, and then
  a follow-up PR.
- Who reads reports that reviewers file inside the review organization. Today nobody does.
- Whether to add a third, disposable parent account for the deletion test.
