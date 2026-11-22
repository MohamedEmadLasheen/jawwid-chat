# Access management M3: enforced denies

Branch `claude/admin-web-nav-ia`. **Isolated development and disposable databases only.** Production authorization is unchanged:
the permission guard is still in `shadow` mode, and denies are **off** (see "Production state"). Nothing is pushed, merged or deployed, and
no shared database was touched. Owner decisions applied: 2026-11-22 (Decision 3 and the M3 authorization).

## What a deny is
An explicit, recorded, time-limited restriction on **one permission of one staff member**. It removes the key whatever granted it (tier
default, access role) and is enforced where the key is enforced. It never touches the super admin.

## Production state (what changes if nothing else is approved: nothing)
| Layer | Production now | Disposable test environment |
|---|---|---|
| `chat.access_switch 'deny_enforcement'` | **OFF** (ships off; server-only table; changes only by an operator statement that sets `chat.access_switch_change`) | turned ON by the spec |
| Recording a deny | **refused** ("denies are not enforced in this environment, so none is recorded") | allowed |
| Evaluator (`chat.staff_denied_keys`) | always empty | active denies |
| `PermissionGuard` mode | `shadow`, **unchanged** | `shadow`, unchanged; a deny is refused regardless |
| Result | identical to before M3 | denies enforced end to end |

So there is **no mixed production state**: a database that does not enforce denies cannot even hold one, so a deny is never recorded and then ignored.
Turning enforcement on anywhere is a separate decision (below).

## Enforcement layers (all in this branch)
1. **One evaluator.** `chat.staff_access_profile` (unchanged signature) subtracts `chat.staff_denied_keys(staff)`. Everything that asks "what does X hold" sees the deny: `PermissionService` (API), `chat.staff_has_permission` (every SQL rule and trigger, including role-grant checks H5 and the certificate, lesson-audio and materials triggers).
2. **API guard.** `PermissionGuard` refuses a route when a key the route accepts is denied, **in every mode and for every tier**, including the legacy-tier shadow mode that otherwise lets requests through. Without a deny the guard is byte-for-byte as before.
3. **Database.** The deny table is append-only (RLS on, no grants to application roles, trigger-guarded; a row changes only to record its revocation). The super admin cannot be denied at the table itself; the evaluator also ignores denies for the super admin.
4. **Deniable keys are a verified list.** A key can be denied only if `permission.deniable`: `materials.author`, `materials.review`, `lesson_audio.view`, `lesson_audio.review`, `certificates.design`. Any other key is refused ("cannot be denied yet: its enforcement is not complete"). `deny-coverage.json` lists every file that names each deniable key and how it honours a deny; a spec fails the build if a new file names one, so a deny can never be silently ignored by a new path. Widening the list is a per-key change with its own coverage review.

## Authority (Decision 3)
| Actor | May | May not |
|---|---|---|
| Super admin | deny any deniable key of any non-super-admin in the organization; up to 365 days, or permanent with a review date; lift any restriction | deny a super admin; themselves |
| Department manager | deny **specialists of their own department**, only keys they **hold and may delegate** (the same triple as granting a role, and they need `staff_accounts.manage`); up to 90 days; lift **only restrictions they made** | deny a manager, supervisor, super admin or themselves; another department's specialist (not even visible); a key they do not hold; anything permanent; lift or replace a super admin's restriction |
| Anyone else | nothing | |

Every deny has a reason (1 to 500 characters), an actor, a target, a permission, a creation time and either an expiry or (super admin only) a permanent flag with a review date. An expired deny stops applying on its own (evaluated by `now()` inside the evaluator). Re-denying an already-denied key is refused; a revoked deny is final.

## Audit
Each record and each lift writes `chat.audit_log` (append-only): actor, affected employee, permission, reason, previous state, new state, timestamp (`staff.permission_denied`, `staff.permission_deny_lifted`).

## Administration (Admin Web)
The staff profile Access panel (M1) shows restricted keys struck through with a **Restricted** badge, a **Restrictions** list (reason, who, until when, lifted or expired) and **Restrict / Lift** controls. All of it appears **only when the server says restrictions are enforced**, so in production the page is unchanged. Managers are not offered "permanent". The server decides every request.

## Evidence (disposable database, switch on by an operator statement)
- **Unit (guard):** a denied key is refused for manager, supervisor, legacy-department and specialist tiers; a route with several keys stays open through an undenied key; with nothing denied the guard is exactly as before (shadow still lets a lacking legacy account through).
- **Integration (real HTTP + real triggers), 17 tests:**
  - *Production state:* switch ships off and cannot be changed by an ordinary statement; with it off a deny is refused and nothing is recorded; a deny row forced into the table still changes nothing.
  - *Overrides every grant:* a super-admin deny of `materials.author` is refused at the route, the access probe and the `material_item` trigger (direct write), while the same person keeps `certificates.design`; lifting restores everything. A supervisor (legacy tier, key held by default, shadow mode) is refused, a colleague is not. Lesson-audio and certificates routes close exactly where a denied key is the only way in.
  - *Authority:* manager succeeds for own-department specialists; refused for a supervisor, manager, super admin, self, another department's specialist (404), and (at the database, directly) a key the manager does not hold; limits (90/365 days, permanent only for the super admin with a review date); a manager cannot lift or replace a super admin's restriction; the super admin can lift a manager's; super admin never denied, not even by a row forced into the table.
  - *Records:* non-deniable keys, keys the account does not hold, missing reason and duplicates refused; expiry lifts the restriction by itself; records cannot be edited, deleted or written outside the writers; the audit rows carry actor, target, permission, reason, before/after, time; the listing is visible only to whoever may see the account.
  - *Neutral when unused:* with the switch on and no denies, every staff member's held keys equal the M1 sources (no one gains or loses anything).
- **Admin Web:** controls absent when not enforced; Restrict dialog sends exactly reason and end date; permanent only for the super admin; restricted key and lift flow.
- **Migration:** apply, rollback (with a deny recorded) and re-apply on a disposable database. Rollback removes the switch, table, writers and evaluator and restores `staff_access_profile`/M1 `staff_access_sources`; recorded denies are lost (the audit log keeps their history). Re-apply returns to switch OFF.

## Coverage by path (the requested matrix, for the deniable keys)
| Path | Honours a deny? | How |
|---|---|---|
| Frontend routes / navigation | yes (UX) | the nav reads server probes built on the profile (`/materials/admin/access`, `/lesson-audio/access`, `/certificates/access`); never the enforcement |
| API endpoints | **yes** | `PermissionGuard` refuses a denied key in every mode; services use the deny-aware profile |
| Database / RLS | **yes** | `staff_access_profile` -> `staff_has_permission` in the materials, lesson-audio and certificate triggers, role-grant checks, task assignment |
| Realtime | n/a | no event or subscription is authorised by these keys (coverage spec) |
| Notifications | n/a | none is addressed to holders of these keys; task assignees are chosen by `staff_has_permission` (honours a deny) |
| Search / reports / exports | n/a | none (coverage spec) |

## Remaining in shadow / residual risks
- `PermissionGuard` stays `shadow` for everything else. M3 enforces **only** denies; it does not enforce missing permissions.
- A task already assigned to someone who is later denied `certificates.design` stays in their task list until reassigned (assignee candidates exclude them, but existing assignments are tasks, not the key).
- Keys outside the five are not deniable yet; each needs its own coverage review before it can be added (the spec forces the review).
- Direct readers of role keys that bypass the profile (staff-account role editor, `may_administer_staff_account`) count denied keys as held for **account administration**; this is deliberate (a suspended or restricted account's grants stay visible to administrators) and unaffected by the deny.
- Production readiness (separate approval): export of existing staff and effective permissions, endpoint inventory, a staged rollout with the switch turned on for one department first, and the rollback script. The switch is the single control; no code change is needed to turn it on, which is exactly why it is a deliberate operator statement and not a console setting.
