# Jawwid Chat — Race Condition Analysis

Owner: AI #9 · 2026-09-05

**Evidence grade for this entire document: STATIC.** The application cannot be
started (no `main.ts`, no `AppModule`, no controllers), so no race below has been
executed. Each row states the probe that would confirm it. Re-run this analysis
as an integration suite once the app boots — `jest --selectProjects integration`
already exists for exactly this.

The severity column reflects the consequence *if* the race lands, discounted by
how reachable it is.

---

## 1. Races with a protection already in place

Recording these matters as much as recording the gaps: they are the invariants a
future refactor must not quietly remove.

| # | Operation A | Operation B | Protection | Verdict |
|---|---|---|---|---|
| R-01 | `send` assigns `seq` | concurrent `send` in same thread | `SELECT "lastSeq" … FOR UPDATE` inside the transaction, plus `@@unique([threadId, seq])` | **Protected.** Ordering is server-decided and gap-free. The row lock serialises the whole thread, and the unique index is the backstop if the lock is ever removed. |
| R-02 | `send(clientMessageId=X)` | retry of the same send | Pre-check, then `@@unique([threadId, authorId, clientMessageId])`, then a `P2002` catch that re-reads and returns the original | **Protected.** Correct three-layer idempotency: the constraint is the guarantee, the pre-check is only an optimisation. |
| R-03 | `getOrCreateFamilyThread` | concurrent create | `@@unique([familyId, kind])` + `P2002` re-read | **Protected**, and explicitly commented as "the unique constraint is the source of truth, so re-read rather than trusting our own check". |
| R-04 | late `DELIVERED` receipt | earlier `READ` receipt | `markState` updates only rows whose current state ranks *lower* than the target | **Protected.** Monotonic, so reconnect replay and out-of-order delivery are both safe. |
| R-05 | duplicate `MessageReceipt` insert | concurrent fan-out | `@@unique([messageId, userId])` + `skipDuplicates` | **Protected.** |

## 2. Unprotected races

### R-06 · Authorization decided before the transaction that acts on it
| | |
|---|---|
| **A** | `MessageService.send` — resolve actor, load family, evaluate `canSendMessage` (lines 81–111) |
| **B** | Staff deactivation / ownership transfer / coverage change / contact removal / `canMessage` revocation |
| **Expected final state** | The message is written under the authority that holds *at commit*. |
| **Possible final state** | Written under authority that was revoked microseconds earlier — and stamped with an `on_behalf_mode` derived from the *old* owner. |
| **DB protection** | None. |
| **Transaction protection** | None — the transaction opens at line 137, after every decision input was read. |
| **Idempotency** | Not applicable. |
| **Severity** | **P2** (narrow window, meaningful consequence) |
| **Fix** | Re-read actor, family and thread inside the transaction after the `FOR UPDATE` lock, and re-evaluate. The lock is already taken; the decision simply needs to move below it. |
| **Probe** | Begin a send, hold it at the lock, deactivate the actor in another session, release. Assert the message is rejected. |

### R-07 · Recipient audience computed outside the transaction
| | |
|---|---|
| **A** | `identity.familyThreadAudience(familyId)` (line 134) |
| **B** | Contact added, deactivated, or reassigned to another family |
| **Possible final state** | A removed contact receives a `MessageReceipt` row (and every downstream notification keyed off it); a newly added contact silently receives none and the message is invisible to them forever — receipts are never backfilled. |
| **DB protection** | None. |
| **Severity** | **P2** — the *missing* receipt is the worse half: it is silent, permanent message loss for that recipient. |
| **Fix** | Compute the audience inside the transaction. |
| **Probe** | Add a contact concurrently with a send; assert they have a receipt or an equivalent catch-up path. |

### R-08 · Stickiness is last-write-wins across concurrent staff
| | |
|---|---|
| **A** | Admin 1 replies → `stickyHandler = 1`, `stickyUntil = now + grace` |
| **B** | Admin 2 replies simultaneously → `stickyHandler = 2` |
| **Expected** | One handler holds the thread for the grace window. |
| **Possible** | Both sends are authorized (each read the pre-update thread), both messages are sent, and the handler is whoever committed last. Two admins have answered the same family, and the audit trail shows one handler. |
| **DB protection** | None — the thread `UPDATE` is inside the transaction, but the *authorization read* of `stickyHandlerId` (`canSendMessage`, line 131) is outside it. Same root cause as R-06. |
| **Severity** | **P2** — customer-visible (duplicate replies), and it is precisely the "no code path assigns a family to a staff member other than via `on_duty()`" invariant the brief calls non-negotiable. |
| **Fix** | Same as R-06 — decide under the lock. |

### R-09 · `markReadUpTo` read cursor can move backwards
| | |
|---|---|
| **A** | Device 1 `markReadUpTo(seq=100)` |
| **B** | Device 2 `markReadUpTo(seq=40)` (a stale device catching up) |
| **Possible final state** | `lastReadSeq = 40`. The `upsert` writes the supplied value unconditionally, unlike `markState`, which is correctly monotonic. |
| **DB protection** | `@@unique([threadId, userId])` prevents duplicates, not regression. |
| **Severity** | **P3** — receipts stay correct (they are monotonic); only the unread badge is wrong. |
| **Fix** | `update: { lastReadSeq: { set: … } }` guarded by `where: { lastReadSeq: { lt: target } }`, or a `GREATEST()` raw update. |

### R-10 · Two devices, no shared idempotency key
`clientMessageId` is optional and per-device. Two devices composing the same
text produce two different keys and two messages — correct behaviour, noted here
only so it is not later mistaken for a bug. The genuine gap is the opposite:
**a client that omits `clientMessageId` has no duplicate protection at all**, and
nothing in the contract requires it. **P3 — Fix:** require it for
contact-authored sends, or reject sends without one.

### R-11 · Config cache is per-process with a 30s TTL and no invalidation channel
`AppConfigService` caches for 30 s in memory. Across N API instances, a manager's
change to `handoff.grace_minutes` or a page-size limit takes effect at different
times on different instances, and `invalidate()` is local. **P3** — thresholds
are not security boundaries, but "we changed it and it did not apply" is an
operational trap. **Fix:** publish an invalidation on Redis pub/sub.

---

## 3. Races that cannot yet exist — and the constraint each will need

Listed so the protection is designed in rather than retrofitted after the first
incident. All **THEORETICAL**; none of this code exists.

| Future race | Constraint that must exist before it ships |
|---|---|
| Two managers transfer ownership simultaneously | Ownership change under a row lock on `family`, with the audit row written in the same transaction. A partial unique index guaranteeing exactly one owner per family. |
| Coverage starts while a message is in flight | Coverage evaluated inside the send transaction (R-06's fix generalises). |
| Approve and reject the same message concurrently | A state machine enforced by a conditional update (`WHERE status = 'PENDING'`), not a read-then-write. Row count zero means "someone else decided first". |
| Duplicate Core webhook delivery | A unique constraint on the provider's event id, checked before any effect. Idempotency at the boundary, never in the handler. |
| Out-of-order Core webhooks | A monotonic version/sequence per entity; reject any event older than the version already applied. |
| Duplicate outbox drain by two workers | `SELECT … FOR UPDATE SKIP LOCKED` when claiming rows, and a status transition that is itself the claim. |
| Two workers process the same notification | `Notification.dedupeKey` is already `@unique` — **this one is designed correctly**; the worker must insert-then-send, never send-then-insert. |
| Call joined after membership removal | Token TTL shorter than the revocation window, and membership re-checked at join, not only at token mint. |
