# Reviewer access: demo accounts and instructions

**No password, and no review login domain, appears in this repository.** Both are typed only into App Store
Connect. The passwords live in the owner's local file `~/.jawwid-review/REVIEW-PASSWORDS-copy-into-store-consoles.txt`
(mode 600, from `bin/review-passwords-setup.sh`), in the GitHub `production` Environment secrets
(`REVIEW_*_PASSWORD`), and in the owner's password manager. The login domain was typed as the workflow input.

## 1. Accounts

All three live in a **review-only organization** ("app-review") with fictional people. Nothing a reviewer does reaches
a real family or a real staff member. Created by `apps/api/src/cli/provision-review-cohort.ts` through the
**Review cohort** workflow, which needs the owner's approval in the `production` environment.

| Account | Login | Who it is | What it can do | Where it goes in App Store Connect |
|---|---|---|---|---|
| Parent | `parent@<review domain>` | Mariam Adel, mother of Yahya Adel (fictional) | Chats (the "Yahya" family group with the teacher and supervisor, plus a direct chat with supervisor Nada Fawzi), Calls, Packages (demo package; payment disabled by the server), Settings: report, block, My reports, Blocked people, language, support, sign out, delete account | **Sign-In Information** (user name and password) |
| Teacher | `teacher@<review domain>` | Hassan Mourad, Yahya's teacher (fictional) | Tabs Chats, Schedule, Boards, Calls, Settings (the same family group, plus a direct chat with the supervisor). The second device for a call test | **Notes** (login and password typed by the owner) |
| Deletion test | `parent2@<review domain>` | Laila Hamdi, a separate fictional family (child Omar Hamdi) | Same as the parent. Meant to be **deleted** by the reviewer | **Notes** |

Also in the organization: three synthetic staff members with **no login** (supervisor Nada Fawzi; managers Sara
Hamed and Karim Saeed).

**Not provided: a login for the sales role.** Sales staff and the super administrator can sign in to the app and see
Chats, Calls, Payments and Settings. The App Review reply describes this role openly. If Apple asks for it, add a fourth
cohort login (changes to `review-cohort.ts`, `provision-review-cohort.ts`, `review-cohort.yml` and the spec).

## 2. Nothing blocks a reviewer's sign-in

| Possible obstacle | Status | Evidence |
|---|---|---|
| One-time code (WhatsApp, SMS) | **None** for these accounts; e-mail and password only | `review-accounts.md`; sign-in is `POST /auth/login` with username and password (`auth.controller.ts:62`) |
| E-mail verification | None | Same |
| Two-factor | None | Same |
| Terms gate at first sign-in | Once PR #497 is live: one "Before you continue" screen (Terms of Use, zero tolerance §7.3): tick, Agree. It does not block sign-in. Launch scope (owner 2026-11-19): family Terms only; teachers and staff are not asked until their terms are published | `reports/AR-H-terms-gate-e2e.md` (local proof) |
| Lockout | **Ten wrong passwords lock an account for 15 minutes.** The login names are public in the repository, so a guessable domain is a risk | `auth.service.ts:54-57`. Repair: re-run the Review cohort workflow (it clears lockouts) |
| Country or region | None | `REGIONAL_AVAILABILITY.md` |
| Payment | The server enforces review payment mode for this organization: no charge and no receipt are possible | `review-mode.ts`; `billing.service.ts:731` |

## 3. Production status (2026-11-19)

| Fact | Evidence | Status |
|---|---|---|
| The cohort is provisioned in production at the submitted commit `2e41270` (three successful runs; latest 2026-11-19) | `gh run list --workflow review-cohort.yml` (AR-C) | VERIFIED (workflow result) |
| Production API runs `2e41270` | Deploy production run 44401677210, 2026-11-18 21:27Z | VERIFIED (workflow result) |
| The three logins sign in with the passwords the owner will type | Not run: the passwords and the domain are the owner's, and reading them was refused by the agent's permission policy | **BLOCKED (owner, one command)**: `bash ~/jawwid-orchestrator/bin/verify-review-logins.sh` prints only OK or FAIL per account. Self-tested on the local copy of the cohort: all three OK |
| The same provisioning code creates working accounts | The real CLI was run against an isolated local database; all three accounts signed in through the real API | VERIFIED (local) |

## 4. Keep the accounts working during review

1. After the screen recording deletes `parent2` (step 17), **re-run the Review cohort workflow**. It re-creates the
   deletion-test account and re-sets all three passwords from the same secrets.
2. Run `verify-review-logins.sh` again. Submit only when it prints OK three times.
3. Do not change `REVIEW_*_PASSWORD` while the review is open. If you must, re-run the workflow and update App Store
   Connect in the same sitting.
4. Do not deploy a migration or a configuration change that touches the review organization while the review is open.

## 5. Step-by-step instructions for the reviewer

The text the reviewer reads is in `APP_REVIEW_NOTES.md` (§A for Notes, §B §3 for the reply). Both use the paths in
this table:

| Task | Path |
|---|---|
| Sign in | First screen: e-mail in the **Username** field, password, **Sign in** |
| Change the language | Settings > Language |
| Messages | Chats > the "Yahya" family group |
| Voice call | In the family group, tap the phone icon at the top (the teacher, on a second device, answers) |
| Report a message | Long-press the message > Report > reason > Send report |
| Report or block a person | Tap the group title > member row: flag (report) or block icon |
| Unblock; see reports | Settings > Blocked people; Settings > My reports |
| Payment (demo) | Packages > Amount due > Pay |
| Support | Settings > Help and support; Contact support |
| Delete the account | Signed in as the deletion test: Settings > Delete account > password > Delete my account > confirm |
