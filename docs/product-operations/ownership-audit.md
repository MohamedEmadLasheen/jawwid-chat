# Ownership Audit

**Owner:** AI #8 · **Date:** 2026-09-05

The product's one rule: **one family → one Primary Owner**, and the *system*, not the
employee, owns the family's history.

## 1. What holds today

| Requirement | Status | Evidence |
|---|---|---|
| One family, one owner | ✅ | `chat.family.owner_id uuid not null references chat.staff(id) on delete restrict` |
| An owner cannot be deleted out from under a family | ✅ | `on delete restrict` |
| Ownership is not changed by coverage | ✅ *by absence* | no code writes `owner_id` at all |
| `on_behalf_mode` distinguishes owner from coverage | ✅ | `authorization.service.ts::deriveMode()` — derived, never client-supplied (AI #5 PF-4) |
| UI never says "assigned to" | ✅ | `terminology.md` §1, §5 |

## 2. What does not hold

| # | Finding | Sev |
|---|---|---|
| **OW-1** | `transfer_ownership()` **does not exist.** The identifier appears once in the repository — as a field name in `apps/admin-web/src/shared/types/domain.ts`. There is no function, no audit write, no manager gate | **P0** |
| **OW-2** | Nothing prevents a plain `UPDATE chat.family SET owner_id = …`. The brief's non-negotiable *"owner changes only via `transfer_ownership()`; writes `audit_log` in the same transaction"* has no enforcement | **P0** |
| **OW-3** | A family may be owned by an **inactive** staff member. `staff.is_active` can go false with `family.owner_id` still pointing at that row, and no invariant check surfaces it. There is no offboarding path (FS-15) | **P1** |
| **OW-4** | The Prisma stack's `Family` has an `ownerId` with no non-null guarantee equivalent to the SQL stack's, and no `state`/`tier`. If Prisma is the writer, half of ownership's operational context is unrepresentable | **P1** |
| **OW-5** | **Ownership does not reach delivery.** Being the owner determines who is *notified* (`familyThreadAudience`) but not who is *responsible* (`currentHandler`). The two are used inconsistently: ownership drives notification, duty drives authorization | **P0** |

## 3. Orphan and duplication analysis

| Risk | Reachable today? |
|---|---|
| Family with no owner | No — `NOT NULL` |
| Family with two owners | No — single column |
| Family owned by a non-existent staff member | No — FK + `on delete restrict` |
| Family owned by an **inactive** staff member | **Yes** — OW-3 |
| Ownership changed without an audit row | **Yes** — OW-2 |
| Ownership changed as a side effect of coverage | Not yet — but only because coverage is unbuilt |
| Conversation whose handler cannot be explained | **Yes** — sticky handler set by assist/escalation (FS-02) |

## 4. Required acceptance criteria

1. `transfer_ownership(family_id, new_owner_id, reason)` exists, is manager-only, writes
   `audit_log` in the same transaction, and is the **only** path that changes `owner_id` —
   enforced by a trigger, not by convention.
2. A `BEFORE UPDATE OF owner_id` trigger raises unless the change is made through that
   function.
3. Offboarding is one transaction: deactivate → transfer every owned family → flag orphaned
   coverage rules → audit.
4. A manager-dashboard invariant panel shows: families owned by inactive staff (target 0),
   families with no on-duty handler (Unattended, target 0), and threads whose sticky handler
   is offline (target 0).
5. Coverage, handoff, workload and escalation code paths are covered by a test asserting
   `owner_id` is unchanged (release-gate G-13).
