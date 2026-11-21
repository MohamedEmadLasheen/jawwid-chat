# PD-59: Sales does not administer family login accounts

Owner decision, 2026-11-21: "A Sales Representative should not have `accounts.administer` access to converted
families merely because they originally owned the lead. Restrict family login administration (reset password,
devices, sessions, etc. for a family/parent account) to the appropriate authorized roles. Preserve existing
Operations and Super Admin responsibilities. Review the Sales Manager's required access separately and document
the decision."

## What was wrong (evidence)

- `SALES_MEMBER` in `apps/api/src/platform/permissions/legacy-bundles.ts` held `accounts.administer`, and
  both `manager:sales` and `supervisor:sales` are built from it.
- The server-side rule that actually decides today is `canAdministerAccount` through
  `apps/api/src/platform/account-admin-policy.ts`, which gave every Sales member and the Sales manager
  `reset_password` and `sign_out` on every parent account. The Accounts list, `GET /admin/accounts/:id`,
  the sessions (devices) list and "end all sessions" followed. For a Sales *representative* the list was
  narrowed to the families they own (`AccountAdminService.salesOwnedFamilies`, PD-42 S3), so a representative
  saw and could reset exactly the families they own, including a family converted from their own lead. The
  Sales *manager* was not narrowed at all: every family account of the organization (wider than an Operations
  supervisor, who sees only the families they reach).
- `PermissionGuard` is still in `shadow` mode (`permission.guard.ts`, PD-40 PR-6 flips it). The bundle row
  alone therefore enforces nothing today: the policy is the server-side gate and was changed too. The bundle row
  and its database mirror are changed so the guard refuses the same thing once it enforces.

## What a Sales member legitimately needs, and still has

Nothing in the Sales hand-over rests on `accounts.administer`:

| Sales task | Route / key | After |
|---|---|---|
| Enter the family's first sign-in e-mail (account is created) | `POST /new-students/families/:id/sign-in-email`, `new_students.manage` | unchanged |
| Enrol, book trials, carry a package over | `new_students.*`, `trials.*`, `subscriptions.carry_over` | unchanged |
| Contact record of an owned family (PD-42) | `parents.edit` (`BillingAccess.editOwnedOnly`) | unchanged |
| Record payments | `billing.record` | unchanged |
| Impersonation / support session | `accounts.support_session` (Sales never held it) | unchanged |

A parent who cannot sign in is a support case for Operations (reset, sessions, devices), as for every family
Sales does not own.

## Decision: representative and manager

| Role | Before | After | Why |
|---|---|---|---|
| Sales representative | accounts list/read/reset password/sessions of owned families | none | The owner's decision. Owning the lead (or the family it became) is a commercial relationship, not a credential authority. |
| Sales manager | the same, for every family account of the organization (no ownership narrowing) | none | Reviewed separately, as asked. No Sales workflow needs a credential reset (sign-in e-mail goes through the intake). The manager's reach was wider than Operations' own supervisors'. The Sales manager already assigns ownership and reads every lead; that is the oversight Sales needs. Nothing is lost for the family: Operations resets. The change is two data rows and one table entry to restore if the owner decides otherwise. |
| Operations manager | every act | unchanged | |
| Operations supervisor / backup / cover | every act, for the families they reach (ADMIN-002) | unchanged | |
| Super admin | every act | unchanged | |
| Teachers department | teacher accounts only | unchanged | |

Role x action on a **family (parent) account**:

| Action | Sales rep (before) | Sales rep (after) | Sales manager (before) | Sales manager (after) | Operations | Super admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| List and search (`GET /admin/accounts`) | owned families | none (`administers: []`) | all families | none | their reach / all (manager) | all |
| Read one (`GET /admin/accounts/:id`) | owned | 404 | all | 404 | yes | yes |
| Reset password (`POST .../password-reset`) | owned | 403 | all | 403 | yes | yes |
| List devices/sessions (`GET .../sessions`) | owned | 403 | all | 403 | yes | yes |
| End one / all sessions | owned | 403 | all | 403 | yes | yes |
| Suspend / reactivate | 403 | 403 | 403 | 403 | yes | yes |
| Impersonate (support session) | 403 | 403 | 403 | 403 | yes | yes |
| Family-access grants (list / grant) | empty, cannot grant | same | same | same | manager grants | grants |
| Give the first sign-in e-mail (intake) | yes | yes | yes | yes | yes | yes |

## What changed

- `legacy-bundles.ts`: `accounts.administer` removed from `SALES_MEMBER`.
- `account-admin-policy.ts`: Sales is no longer an administrator of family accounts (the real server gate).
- Migration `20261121140000_chat_pd059_sales_no_accounts_administer.sql` (data only, two rows of
  `chat.legacy_permission_bundle`; rollback in `db/rollback/`), because the table must equal the bundles
  row for row (`pd040-access-roles.spec.ts`).
- `pd040-catalogue-seed.spec.ts`: a later block may now *delete* rows (`removed`), keeping the frozen first
  seed untouched.
- `pd040-shadow-qa.spec.ts`: the a547b0e2 snapshot lists `sales.manager GET /admin/accounts` as a route that
  answered 200; this is now an intended, documented removal.
- Tests over real HTTP: `apps/api/test/integration/sales-accounts-administer-pd059.spec.ts`; the pre-existing
  PD-21/PD-23/ADMIN-002 specs that asserted Sales reset and sign-out were rewritten to the new rule.

## Left alone, on purpose

- `AccountAdminService.salesOwnedFamilies` / `requireOwnedFamily` (the PD-42 S3 narrowing for Sales) are now
  unreachable for a Sales-only caller: the policy refuses first. They stay as a defence in depth; removing them
  is a separate cleanup.
- The Admin Web still offers the Accounts area to every manager and operator; for a Sales member it shows
  the page's existing empty state ("Your department does not administer accounts"), driven by the server's
  `administers: []`. Hiding the entry needs a server-confirmed flag and is a separate change.
- The Sales switch `sales.family_scope` (PD-42) and the rest of Sales' family access are unchanged.
