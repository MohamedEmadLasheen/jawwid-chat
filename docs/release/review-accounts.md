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
- **No payments, and nothing to pay.** OA-12 is an open owner decision. The current state is **Option B (nothing
  payable for review)** until the owner decides OA-12; Option A would add a payable request to the cohort. The command creates no lesson package, instalment, payment request or invoice for either family,
  so the parents' payments tab ("Subscriptions" today) shows no amount due and no Pay button, and the payment lock
  never applies (PD-30). The test checks this in the database and over `GET /me/billing`, the route that tab reads.
  The review notes below say so.
- **No lesson content yet.** There are no past lessons or lesson reports, because those need the owner to approve
  the content. The sample messages are everyday academy talk.

## Run it (the owner, in the browser; never on a laptop)

It runs only through the **Review cohort** GitHub workflow. The workflow uses the API image already built for a
commit on main, runs as the `production` GitHub Environment (so that Environment's required reviewers approve every
run), and never prints a password or the database address: the repository is public, so anyone can read its run
logs.

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
   - It stops with a clear error, changing nothing, if a secret is missing, the two domains differ, the SHA is not
     on main, or the image does not exist.
   - It writes the passwords to private (mode 600) files on the runner only for the run, and deletes them at the
     end even if the run fails.
   - It prints ids and the three logins. The database's host:port/name is masked (the log shows `***` in its
     place), and a password or the database URL is never printed.
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

The canonical paste-ready text is `store-console/review-notes.md` (§2 for App Store Connect, §3 for Play, each
with Option B for the payments paragraph while OA-12 is open). Paste from that file; the summary below only
describes what the review accounts hold.

> Sign in with the parent or the teacher account from the credentials field. Sign-in is email and password; no
> verification code is needed. The parent account has one child with weekly lessons, a family group chat with the
> child's supervisor and teacher, and a direct chat with the supervisor. The teacher account is that child's teacher.
> The two accounts can message each other in the family group. To test account deletion, please use the third
> account (parent2), which exists for that purpose; deleting it does not affect the other two. All people and data
> in these accounts are fictional. Deleting an account in the app takes effect immediately. The review families have
> nothing to pay, so the payments tab shows no amount due.

## Still open (owner)

These need an owner decision before the review data is complete (LR-05, LR-09f):

- **Past lessons and lesson reports.** There are none yet. They need the owner's approval of the report content,
  which may name surahs, and then a follow-up PR.
- **Something payable (OA-12).** Still the owner's decision; the owner picks the option in
  `store-console/review-notes.md` §2.1. The current state is Option B (nothing payable for review) until the owner
  decides OA-12: a reviewer has nothing to pay and cannot reach the pay sheet (found in #507). Option A would add a
  payable request to the cohort, so a reviewer can reach Pay; a follow-up PR must then add it to the command,
  change the tests above, and change the review notes. The owner must also decide what the review family may be
  billed for, and how.
- **Docs that still promise a payable item (to align after OA-12).** These assume a payable request in the review
  cohort, which the current state (Option B) does not have. Once the owner decides OA-12, a follow-up must align
  them (this change may not edit them):
  - `app-review-notes-payments.md` §4 (Apple, "Amount due → Pay"), §5 (Play) and §6 item 2 (an open
    lesson-package request so the reviewer can reach the pay sheet).
  - `store-console/play-declarations.md` §2: the paste ("Amount due → Pay") and the owner note below it ("Either
    add an open lesson-package request ... or delete the Payments paragraph").
  - `store-console/README.md` item 8 ("A payable lesson-package request in the review cohort | Yes").
  - `store-console/listing-copy.md` screenshot 5 (the pay sheet, taken from "An open request in the review
    cohort").
  - `store-console/review-notes.md` §2.1 Option A paste ("Amount due > Pay"), its recommendation ("Option A, with
    a payable request in the review cohort"), and the §3 Play Option A sentence.
- **An exception to OD-04.** In Chat, only Core's assignment ingestion may set a child's teacher. Ingestion does not
  exist yet, so the command sets the teacher of its one taught synthetic child (Yahya; the deletion-test child has
  no teacher) through the same stand-in the QA seed uses,
  on production, and only inside the review organization. When ingestion exists, the review child's teacher should
  come from Core.

Also open:

- A production backend (LR-01, OA-21). The workflow runs against the database that the store build talks to.
- Who reads reports that reviewers file inside the review organization. Today nobody does.
