# Super admin bootstrap (PD-5)

How the organization's designated `super_admin` is established, what that role
can and cannot do today, and how to verify it.

## What exists

| Layer | Piece | File |
|---|---|---|
| Database | `super_admin` admitted by `chat.staff.role`'s CHECK; trigger `staff_super_admin_is_guarded` refuses any ungated INSERT / promotion / demotion / DELETE / account re-binding of the role | `supabase/migrations/20261013120000_chat_super_admin_role.sql` |
| Procedure | The only writer of the role: opens `chat.provisioning_super_admin` for its own transaction | `apps/api/src/cli/super-admin-bootstrap.ts`, CLI `apps/api/src/cli/bootstrap-super-admin.ts` |
| Authorization | `AuthorizationService.canInspectOrganization` — `super_admin` only, active, with an organization | `apps/api/src/platform/authorization.service.ts` |
| API | Read-only `GET /api/v1/admin/{overview,users,conversations,conversations/:id/messages,stories}`, organization-scoped; anyone else gets `403 COMM.ADMIN_INSPECTION_DENIED` | `apps/api/src/admin/` |
| Admin Web | Bearer-token session (the API never set a cookie, so the old client could not log in); all 17 planned sections in the rail, unbuilt ones marked *In development* | `apps/admin-web/src/core/auth/tokens.ts`, `apps/admin-web/src/features/admin/` |

The login is an ordinary `chat.account` (kind `staff`) + `chat.staff` row +
`chat.account_credential` hashed with the product's Argon2id. It signs in through
`POST /api/v1/auth/login` like any other account. There is no second user table,
no bypass, and no hard-coded identity.

## What super_admin may do in this milestone

Verified over real HTTP against the QA account on 2026-10-13. Nothing in this
milestone widened any other role.

| Operation | Route | super_admin today |
|---|---|---|
| Sign in, refresh, sign out | `POST /auth/login`, `/auth/refresh`, `/auth/logout` | ✅ |
| Who am I | `GET /me` → `staffRole: "super_admin"` | ✅ |
| Organization overview (counts) | `GET /admin/overview` | ✅ read-only |
| List staff, teachers, contacts | `GET /admin/users` | ✅ read-only, no login identifiers |
| List conversations; read messages incl. internal notes | `GET /admin/conversations`, `/admin/conversations/:id/messages` | ✅ read-only |
| List stories (all states) | `GET /admin/stories` | ✅ read-only |
| Reply in a conversation | `POST /conversations/:id/messages` | ❌ `403 COMM.ROLE_CANNOT_MESSAGE_FAMILY` |
| Read conversations through the engine | `GET /conversations` | ❌ `403 COMM.ROLE_CANNOT_MESSAGE_FAMILY` (use `/admin`) |
| Create / publish / delete a story | `POST /stories`, `/stories/:id/publish`, `DELETE /stories/:id` | ❌ `403 COMM.STORY_CANNOT_PUBLISH` (create exercised over HTTP; publish and delete open with the same `requirePublisher` check) |
| Publisher story list (legacy Stories screen) | `GET /stories` | ❌ `403 COMM.STORY_CANNOT_PUBLISH` — by design |
| Approve / reject held messages | `GET /approvals/pending`, `POST /approvals/:id/*` | ❌ `403 COMM.CANNOT_APPROVE` |
| Reassign families, manage accounts, change settings | — | ❌ no endpoint exists yet |

`super_admin` is deliberately **not** in `FAMILY_FACING_STAFF_ROLES`: the SQL
helpers that admit family-facing staff still list `('admin', 'coverage',
'manager')`, and the API must not allow a write the database will refuse.
Operational permissions are a separate, tested phase (the rest of PD-5's
normalization: rename `coverage`, departments to an attribute, SQL helpers, RLS).

### Stories: two routes, two answers

The Admin Portal's **Stories** section reads `GET /admin/stories`
(super_admin, read-only, real rows from `chat.story`). The **legacy** Stories
screen at `/stories` is the *publisher's* page and calls `GET /stories`, which
`canPublishStory` reserves for admin, coverage and manager; it refuses
super_admin on purpose. The portal links that screen with the label
"Unsupported for super_admin by design". Publishing from the portal is not built.

## Running the bootstrap

The password is never accepted on the command line. It must be 4 to 256
characters -- the same minimum as every other account (owner decision
2026-10-27; it was 12). Put it in a file only you can read:

```bash
mkdir -p -m 700 ~/.jawwid && read -rs "pw?Initial super admin password: " && (umask 077; printf '%s' "$pw" > ~/.jawwid/super-admin.pw) && unset pw && echo saved
```

Then, from `apps/api` after `npm run build`:

```bash
DATABASE_URL=postgres://… node dist/cli/bootstrap-super-admin.js --email <address> --password-file ~/.jawwid/super-admin.pw --target <host:port/database>
```

`--target` must restate where `DATABASE_URL` points; a mismatch is refused. Add
`--dry-run` first to see the outcome without writing. Outside `APP_ENV`
local/test/ci it also requires `--allow-non-local`.

| Existing state | Result |
|---|---|
| no account | `created` |
| already this organization's super admin | `already_super_admin`; password kept unless `--reset-password` (which also revokes every live session) |
| a staff login with another role | refused unless `--promote-existing-staff` |
| a parent or teacher login with that address | **always refused** |
| same address, different letter case | refused |
| an inactive account | refused (reactivation is a separate decision) |
| another super admin already exists | **always refused** |

Every write lands in `chat.audit_log` (`staff.super_admin_bootstrapped`),
recording the account and outcome, never the password or the address.

## Known gaps

* **No forced password change.** The API has no change-password endpoint and no
  `must_change_password` flag; rotating means re-running with `--reset-password`.
* `/admin` reads are not themselves audited.
* Realtime (socket) is not wired for Admin Web; the `/admin` pages do not need it.
