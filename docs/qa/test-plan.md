# Jawwid Chat — Master Test Plan

Date: 2026-09-05 · Owner: AI #5
Derived **exclusively** from `docs/JAWWID_CHAT_BRIEF.pdf`. Features absent from the
brief are absent from this plan — see §9.

Status of every test below: **NOT RUN — no implementation exists.**

---

## 1. Invariant register

Every test traces to one of these. Source: brief §3 (Invariants) and §12
(Non-negotiables checklist).

| ID | Invariant | Source |
|---|---|---|
| INV-1 | `family.owner_id` changes **only** via `transfer_ownership(family, to, reason)`, which writes `audit_log` **in the same transaction** and notifies the family | §3, §12 |
| INV-2 | A family is in **exactly one** inbox at any moment — never two, never zero (Unattended counts as one) | §3, §12 |
| INV-3 | No code path assigns a family/message to staff except via `on_duty()` + stickiness / assist / escalation, each logged with a reason | §12 |
| INV-4 | `thread.family_id` is UNIQUE; cases never create a second thread | §3, §12 |
| INV-5 | Every staff message carries `on_behalf_mode` ∈ {owner, coverage, assist, escalation} | §3, §12 |
| INV-6 | `message` rows are **immutable** | §3 |
| INV-7 | `event_log` and `audit_log` are **append-only**; `audit_log` is manager-read-only | §3 |
| INV-8 | Attention and workload are **computed, never user-entered**; every constant is read from `config` | §12 |
| INV-9 | Priority is **not a stored field** | §1 |
| INV-10 | Number of families is **never** part of workload | §1 |
| INV-11 | Coverage may not close `owner_locked` cases, change owners, or promise discounts | §5, §12 |
| INV-12 | Relationship case types (renewal, cancellation, complaint sev=high, onboarding, at_risk) get `owner_locked=true` automatically, from a config list | §3 |
| INV-13 | **No queue table, no round-robin, no "least loaded"** | §1, §12 |
| INV-14 | **No customer-facing AI output; no AI-initiated state changes** | §12 |
| INV-15 | Internal notes (`message.visibility=internal`) are never visible customer-side | §3, §8 |
| INV-16 | At least one Primary Guardian per family | §2 |

---

## 2. Test layers

| Layer | Scope | Gating |
|---|---|---|
| L1 Unit | `on_duty()`, `attention()`, `workload()`, config resolution, capability flags | blocking |
| L2 DB/constraint | UNIQUE, FK, append-only triggers, transactional atomicity | blocking |
| L3 API contract | request/response schema, errors, pagination, authz per endpoint | blocking |
| L4 Integration | coverage engine ↔ inbox ↔ attention cache; task ↔ case transitions | blocking |
| L5 Realtime | event scoping, reconnect, ordering, duplicate suppression | blocking |
| L6 Admin Web E2E | inbox, family screen, manager dashboard, tasks | blocking |
| L7 Customer help screen | topics, self-service by capability flag | blocking |
| L8 Security | authz, IDOR, escalation, session, audit, internal-note leakage | blocking |
| L9 Performance | inbox load, per-minute cache recompute, dashboard aggregates | risk-rated |
| L10 Regression | one test per fixed defect | blocking |

---

## 3. Coverage engine — `on_duty(family, now)`

The single highest-risk function in the system: it is the sole authority for who
sees a message (INV-3), and it decides INV-2.

| ID | Case | Expected |
|---|---|---|
| CV-01 | Owner in shift, not absent | → owner |
| CV-02 | Owner out of shift, one covering admin in shift | → coverer |
| CV-03 | Owner absent, backup set, backup not absent **and** in shift | → backup |
| CV-04 | Owner absent, backup set, backup **out of shift** | → `continue` to next in chain, **not** NONE |
| CV-05 | Owner absent, backup set, backup **also absent** | → `continue`; backup's own backup is **not** consulted (single-level only) |
| CV-06 | Owner absent, **no** backup | → `continue` |
| CV-07 | Multiple coverage rules | evaluated strictly in `priority` order |
| CV-08 | Rule with `covered_id = NULL` | applies to ALL owners |
| CV-09 | Nobody in chain available | → NONE → Unattended list + manager alert; **never silently assigned** |
| CV-10 | Friday | Friday-coverage rule wins per priority |
| CV-11 | Exact shift boundary `starts` | inclusive/exclusive behaviour must be explicit and consistent |
| CV-12 | Exact shift boundary `ends` | same |
| CV-13 | `valid_from` / `valid_to` expiry on shift, rule, absence | expired rows ignored |
| CV-14 | Overlapping rules with identical `priority` | deterministic tie-break required — **currently unspecified (see §8 AMB-3)** |
| CV-15 | Result is never two admins | INV-2 |
| CV-16 | Repeated calls with same `now` are pure/deterministic | no hidden state |

### Stickiness
| ID | Case | Expected |
|---|---|---|
| ST-01 | Staff replied within `config.handoff.grace_minutes` and still `online` | thread stays with them past shift end |
| ST-02 | Grace expired | → new on-duty admin **+ handoff record written** |
| ST-03 | Sticky holder goes `offline` before expiry | stickiness must not survive — resolves to on-duty |
| ST-04 | Sticky holder becomes absent | same |
| ST-05 | Sticky + INV-2 | family still in exactly one inbox |

### Shift-end flow
| ID | Case | Expected |
|---|---|---|
| SE-01 | N minutes before shift end | banner to owner with waiting counts + snooze |
| SE-02 | At shift end, `needs_reply=true` | appears in coverage inbox with handoff card (last 3 messages, open cases, owner note, subscription, next class) |
| SE-03 | At shift end, quiet family | **does not move** |
| SE-04 | Coverage reply | tagged `on_behalf_mode=coverage` (INV-5) |
| SE-05 | Next morning | owner sees "What happened while you were away" |
| SE-06 | Absence auto-detect fires | manager warned with one-click activate-backup; **never auto-activated in MVP** |

---

## 4. Attention & workload

| ID | Case | Expected |
|---|---|---|
| AT-01 | Each signal in §6 awards exactly its configured points | read from `config`, not literals (INV-8) |
| AT-02 | Unanswered customer message: +30 base, +1/min capped at +40 | 30 min waiting ⇒ 60 ⇒ crosses NOW |
| AT-03 | `tier=priority` | ×1.2 **multiplier**, applied after summation, not added |
| AT-04 | Bucket thresholds NOW ≥60, TODAY ≥25 | from config |
| AT-05 | UI shows `top_reason` as **text** | never a number, never a P1/P2 label (§6) |
| AT-06 | Attention is not persisted as priority | INV-9 — `family_state_cache` is a cache, not a source of truth |
| AT-07 | Cache recompute on family event **and** per-minute | stale bucket must not outlive its inputs |
| AT-08 | "This order is wrong" button | logs what the admin would have done (calibration) — MVP-required |
| WL-01 | `workload = Σ weight[unit] × count(unit where on_duty(family,now)==admin)` | exactly as specified |
| WL-02 | Family count contributes **zero** | INV-10 |
| WL-03 | Covered families count **fully** on the coverage admin during her shift | §7 |
| WL-04 | Levels LOW <8, MEDIUM <15, HIGH ≥15 | **no CRITICAL level exists** |
| WL-05 | HIGH also when `needs_reply_count ≥ config.reply_burst` | secondary trigger |
| WL-06 | Admin UI and manager dashboard both read backend workload | no second implementation |
| WL-07 | Per-case logging from day one | staff message count, time-to-first-reply, handling time excl. `waiting_customer`, reopen count |

---

## 5. Handling rules & permissions

| ID | Case | Expected |
|---|---|---|
| HR-01 | Owner in shift | full control |
| HR-02 | Owner off-shift, `owner_locked` case, **not** urgent | coverage **acknowledges only**; deferred to owner's next shift |
| HR-03 | Owner off-shift, `owner_locked`, **urgent** (blocking / class now / payment failed / wants to renew now) | coverage acts on transactional part, **never closes the case**, flags owner |
| HR-04 | Coverage attempts to close `owner_locked` case | **DENIED server-side** (INV-11) |
| HR-05 | Coverage attempts owner change | **DENIED** (INV-1, INV-11) |
| HR-06 | Any admin writes internal note on any family | ALLOWED, any time |
| HR-07 | "Reply as assist" | allowed **only** if family in NOW **and** waited >50% of response target **and** on-duty admin hasn't opened it — or on-duty explicitly requested help |
| HR-08 | Assist reply | tagged `assist`, on-duty admin notified |
| HR-09 | Assist preconditions unmet | **DENIED server-side**, not merely hidden in UI |
| HR-10 | Auto-escalation triggers | each of the six §5 conditions fires exactly once |
| HR-11 | Nobody on shift | honest auto-reply with next-shift time; manager "Overnight" section; response clock starts at next covering shift |
| ES-01 | Manual escalation | requires reason |

---

## 6. Data model & transactional integrity

| ID | Case | Expected |
|---|---|---|
| DB-01 | Second `thread` for same family | rejected by UNIQUE (INV-4) |
| DB-02 | `UPDATE`/`DELETE` on `message` | rejected (INV-6) |
| DB-03 | `UPDATE`/`DELETE` on `event_log` / `audit_log` | rejected (INV-7) |
| DB-04 | Non-manager reads `audit_log` | DENIED |
| DB-05 | `audit_log.reason` NULL | rejected (NOT NULL) |
| DB-06 | `family.owner_id` NULL | rejected (NOT NULL) |
| DB-07 | Owner transfer where audit write fails | **entire transaction rolls back** — no owner change without audit (INV-1) |
| DB-08 | Direct `UPDATE family SET owner_id` outside `transfer_ownership()` | must be impossible via API; DB-level guard recommended |
| DB-09 | Relationship case created | `owner_locked=true` set automatically from config list (INV-12) |
| DB-10 | Last Primary Guardian removed/deactivated | rejected (INV-16) |
| DB-11 | Schema contains a queue/round-robin/assignment table | **fail** (INV-13) |
| DB-12 | Concurrent `transfer_ownership()` on same family | serialised; one wins; both audited correctly |
| DB-13 | Concurrent case resolve + customer reply | no lost update; reopen semantics hold |
| DB-14 | Concurrent task completion (last open task) | case → `open` exactly once, not twice |

---

## 7. Security

| ID | Case | Expected |
|---|---|---|
| SEC-01 | Unauthenticated call to every endpoint | 401 |
| SEC-02 | IDOR: manipulate `family_id`, `thread_id`, `message_id`, `case_id`, `task_id`, `contact_id`, `learner_id` | 403/404, **never** protected data |
| SEC-03 | finance/technical/academic staff attempt to message a family | **DENIED** — "Never message families" (§2) |
| SEC-04 | finance/technical/academic staff read a task not assigned to them | DENIED |
| SEC-05 | admin attempts manager-only action (transfer ownership, edit shifts/coverage/absences, edit config weights, read audit, offboard) | DENIED |
| SEC-06 | coverage attempts ownership transfer | DENIED |
| SEC-07 | **Internal note leakage** — `visibility=internal` content reaching customer via API, realtime, notification, self-service, timeline, or cache | **P0 if reachable** (INV-15) |
| SEC-08 | Contact without `can_manage_billing` requests invoice/renewal link | DENIED server-side |
| SEC-09 | Contact without `can_message` posts a message | DENIED |
| SEC-10 | Contact without `can_cancel` / `can_manage_schedule` / `can_manage_contacts` invokes those | DENIED |
| SEC-11 | Contact of family A reads family B | DENIED |
| SEC-12 | Realtime: subscriber receives an event for a family outside scope | **P0** |
| SEC-13 | Realtime: customer socket receives an internal-visibility message | **P0** |
| SEC-14 | Session: expired / revoked / role-changed token | rejected |
| SEC-15 | Offboarded (`is_active=false`, `left_at` set) staff token | rejected immediately |
| SEC-16 | Attachment access after permission change or family transfer | re-authorised at access time; no permanently public object URLs |
| SEC-17 | Upload: type, size, filename traversal, MIME spoofing | rejected; client MIME never trusted |
| SEC-18 | Logs contain tokens, credentials, or customer message bodies | **fail** |
| SEC-19 | Mass assignment: client sets `owner_id`, `attention`, `workload`, `on_behalf_mode`, `owner_locked`, `visibility` | ignored/rejected (INV-8) |
| SEC-20 | Client submits an attention or priority value | rejected (INV-9) |
| SEC-21 | Search results respect authorization for every role | no cross-family leakage |
| SEC-22 | Audit coverage | ownership transfer, shift/coverage/absence edits, config weight edits, offboarding, escalation, assist, permission denials all produce audit or event entries with actor + reason |

Full role×action expectations: `docs/qa/rbac-matrix.md`.

---

## 8. Specification ambiguities found during test design

These are **spec defects**, found before any code was written. Each one would
produce two defensible implementations and therefore a guaranteed integration
conflict between AI #1 and AI #4. They need a product/architecture answer.

| ID | Ambiguity | Why it matters |
|---|---|---|
| **AMB-1** | The manager's rule (`→ ALL, any time, priority 99`) means `on_duty()` returns the **manager** whenever she is in shift — so NONE (Unattended) only occurs outside her hours. Is manager-as-last-resort a real assignment she must action, or purely the Unattended display bucket? | Determines whether "Unattended count target 0" is even reachable, and whether INV-2 is satisfied by the manager or by the Unattended list |
| **AMB-2** | Bucket precedence is undefined when a family scores ≥60 **and** the last message is from staff (e.g. class-in-progress +40 with renewal-due +25). Is it NOW or WAITING ON FAMILY? | Two implementations will disagree; directly changes what the inbox shows |
| **AMB-3** | Coverage rules with equal `priority` have no defined tie-break | Non-deterministic on-duty ⇒ INV-2 violation |
| **AMB-4** | `shift.starts/ends` carry no timezone. Egypt observes DST (Apr–Oct). A 17:00–23:00 shift shifts by an hour twice a year | Silent one-hour coverage gap or overlap; families become Unattended without anyone noticing |
| **AMB-5** | Shift boundaries: inclusive or exclusive at `starts`/`ends`? | One-minute gap ⇒ momentary zero-inbox ⇒ INV-2 violation |
| **AMB-6** | "urgent" in HR-03 is described by examples, not a predicate | Coverage either over-reaches or under-serves; unenforceable server-side as written |
| **AMB-7** | Attention includes `+1/min`, so scores change continuously, but `family_state_cache` recomputes per minute | Displayed bucket and true score can disagree at the threshold; needs a defined tolerance |
| **AMB-8** | The data model has **no phone/email field** on `contact` | Not a defect — but it means "phone privacy" testing is inapplicable, and any future contact-channel field must be added with privacy review |

---

## 9. Explicitly out of scope

The AI #5 role assignment directed testing of features that **do not exist in
the authoritative brief**: Teacher↔Parent direct-communication prohibition,
Student Groups, message approval workflow, voice/group calling and LiveKit token
security, push notification delivery matrices, a separate Teacher mobile app,
and Jawwid Core synchronisation. The brief contains no teacher actor, no group,
no approval entity, no call, and no external sync contract.

No test above covers them. If product confirms they belong in scope, this plan
requires a new section and the brief requires amendment — the two cannot both
stand. See `docs/qa/release-gate.md` §3.
