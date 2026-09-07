> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). Brief-derived, snake_case, thread/case vocabulary. Superseded by `docs/contracts/API-CONTRACT.md`; still useful as the list of what the inbox needs.
> Canonical index: `docs/README.md`.

# Admin Web — Required Backend Contract

Author: AI #4 (Admin Operations) · Date: 2026-09-05 · Status: **proposed, awaiting AI #1 / AI #2 sign-off**

This document specifies exactly what the Admin Web application needs from the
backend. It is derived **strictly from the project brief** (`docs/JAWWID_CHAT_BRIEF.txt`).
It is a dependency request, not a second source of truth. Where the brief is
silent, the field is marked `PROPOSED` and needs a decision.

Consumed from peers (already decided, not re-litigated):
- Transport: **REST + Socket.IO** (AI #2's `@nestjs/platform-socket.io`).
- Roles: `admin · coverage · manager · finance · technical · academic · system`.
  No `super_admin` (AI #5, `docs/qa/rbac-matrix.md`).
- Authorization is **backend-owned**. Everything below that looks like a
  permission is UX affordance only.

## 0. Conventions

- Base path `PROPOSED: /api/v1`. JSON. `snake_case` field names (matches the brief's schema).
- Errors: `{ "error": { "code": string, "message_en": string, "message_ar": string } }`.
  The UI renders `message_{locale}` and never a stack trace.
- Pagination: cursor-based. Request `?cursor=&limit=`; response
  `{ items: [...], next_cursor: string | null }`.
- Every mutation that the brief marks sensitive requires a `reason` and writes
  `audit_log` server-side in the same transaction. The UI always collects it.
- **Idempotency:** mutations accept `Idempotency-Key` header. Required to make
  double-submit protection real rather than cosmetic.

## 1. Session and configuration

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/login` | Returns session token + `staff` record |
| `POST` | `/auth/logout` | Ends session |
| `GET` | `/me` | Current staff: `id, name, role, presence, is_active` |
| `GET` | `/me/duty` | `{ in_shift, shift_ends_at, covering_for: [staff_id], sticky_threads: n }` |
| `GET` | `/config` | **All** thresholds, weights, windows and bucket labels |

`GET /config` is mandatory, not a nicety. Brief §12: *"all constants read from
`config`"*. The admin UI must not contain the number 60, 25, 8 or 15 anywhere.

## 2. Inbox — the primary surface

```
GET /inbox?section=now|today|waiting_family|quiet|covering&cursor=&limit=
```

Response item (one **family**, never a ticket — brief §8):

```jsonc
{
  "family_id": "...",
  "display_name": "...",
  "bucket": "now|today|waiting_family|quiet",
  "top_reason": "class started 5 minutes ago",   // TEXT, localised, never a score
  "waiting_since": "2026-09-05T12:01:00Z",        // null when not waiting
  "needs_reply": true,
  "tier": "standard|priority",
  "state": "onboarding|active|at_risk|renewal_due|paused|churned",
  "on_duty_id": "...",          // may differ from owner_id
  "owner_id": "...",
  "handling_mode": "owner|coverage|assist|escalation|sticky",
  "open_case_count": 2,
  "response_target": { "elapsed_pct": 0.7, "breached": false, "due_at": "..." }
}
```

**Hard requirement (brief §6):** the server returns `top_reason` as display text
and **never** an attention number or internal bucket label for the admin to read.
The UI sorts by the order the server returns. It does not re-sort by score.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/inbox/away-summary` | "What happened while you were away" — handoffs + summaries since owner's last shift |
| `GET` | `/inbox/shift-banner` | End-of-shift banner: `{ minutes_remaining, waiting_count, follow_up_count, can_snooze }` |
| `POST` | `/inbox/snooze-to-next-shift` | `{ family_ids: [] }` — from the banner |
| `POST` | `/inbox/order-feedback` | **Calibration logging, MVP-required (brief §6).** `{ family_id, section, position, what_i_would_have_done }` |

## 3. Family 360

```
GET /families/:id
```

Returns everything the side panel needs in **one** call (brief §8: side panel is
always visible — N+1 calls per family open is not acceptable):

```jsonc
{
  "family": { "id","display_name","tier","tier_reason","state","state_reason",
              "state_changed_at","language","manual_flag","manual_flag_reason" },
  "owner":   { "id","name" },
  "on_duty": { "id","name","mode":"owner|coverage|assist|escalation|sticky|none" },
  "contacts":[{ "id","name","relationship","role_preset",
                "can_message","can_view_progress","can_manage_schedule",
                "can_manage_billing","can_manage_contacts","can_cancel","is_active" }],
  "learners":[{ "id","name","level","teacher_name","next_class_at",
                "last_attended_at","consecutive_absences" }],
  "subscription": { "plan","status","ends_at","renewal_due_at",
                    "last_payment_status","last_payment_at" },
  "pinned_notes": [...],
  "recent_cases": [...],   // last 5
  "open_tasks": [...],
  "capabilities": {        // UX affordances ONLY — server re-checks every write
     "can_send_customer_message": true,
     "can_reply_as_assist": false,
     "assist_blocked_reason": "on-duty admin has this open",
     "can_close_owner_locked": false,
     "can_transfer_ownership": false
  }
}
```

`capabilities` exists so the UI can disable a control **with an honest reason**
instead of letting the admin discover a 403 after typing a reply. It is not a
permission system; brief §12 and AI #5's matrix keep the backend authoritative.

**No phone numbers.** Contacts expose `name` and `relationship` only.

### Thread and messages

| Method | Path | Notes |
|---|---|---|
| `GET` | `/families/:id/messages?cursor=&limit=` | One thread per family (`family_id UNIQUE`). Returns customer + staff + system + internal notes, ordered. |
| `POST` | `/families/:id/messages` | `{ body, visibility: "customer"\|"internal", case_id?, attachments[] }`. Server sets `on_behalf_mode` from `on_duty()` — **the client must not choose it** (brief §12). |

Message payload must carry `visibility` and `on_behalf_mode` so the UI can render
internal notes in a visually distinct style and label coverage/assist replies.

### Cases

| Method | Path | Notes |
|---|---|---|
| `GET`/`POST` | `/families/:id/cases` | type, severity, is_blocking, due_at |
| `PATCH` | `/cases/:id` | status transitions; server rejects coverage closing `owner_locked` |
| `POST` | `/cases/:id/escalate` | `{ reason }` — required |
| `POST` | `/cases/:id/follow-up` | `{ due_at, reason }` — the one-action follow-up |

`case.owner_locked` must be returned so the UI can show *"deferred to owner's
next shift"* rather than a dead button.

### Family actions

| Method | Path | Notes |
|---|---|---|
| `POST` | `/families/:id/notes` | internal note, any admin, any time (brief §5) |
| `POST` | `/families/:id/pin-handler` | "I'll keep this" → `sticky_handler_id` |
| `POST` | `/families/:id/defer-to-owner` | "for owner" |
| `GET` | `/families?owner_id=&on_duty_id=&bucket=&state=&needs_reply=&q=&cursor=` | Server-side filtering + pagination. Never client-side over a partial set. |

## 4. Tasks

| Method | Path | Notes |
|---|---|---|
| `GET` | `/tasks?scope=mine\|team\|department&status=&type=&overdue=&cursor=` | `department` scope returns **only** the caller's assigned tasks (finance/technical/academic) |
| `POST` | `/tasks` | `{ case_id, family_id, type, title, details, owner_id, due_at }` |
| `PATCH` | `/tasks/:id` | status, due_at, result |

Brief §8: completing the **last** open task on a case moves the case
`waiting_internal → open` and the family to TODAY with reason *"inform family of
finance result"*. That transition is **server-side**; the UI learns it via the
`case.updated` event.

## 5. Coverage (manager)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/coverage/shifts` · `POST` · `PATCH` · `DELETE` | `staff_id, days[], starts, ends, valid_from, valid_to` |
| `GET` | `/coverage/rules` · `POST` · `PATCH` · `DELETE` | `covering_id, covered_id (null = ALL), days[], window, custom_from, custom_to, priority` |
| `GET` | `/coverage/absences` · `POST` · `PATCH` | `staff_id, from, to, backup_id, type` |
| `GET` | `/coverage/tonight` | who → whom, right now |
| `GET` | `/coverage/gaps?days=7` | absence without backup, missing rule, uncovered window |
| `POST` | `/absences/:id/activate-backup` | manager one-click; **never automatic in MVP** |

Overlap/conflict validation is a **server** responsibility. The UI surfaces
`409` conflict detail; it does not re-implement the rule.

## 6. Ownership

| Method | Path | Notes |
|---|---|---|
| `GET` | `/families/:id/transfer-impact?to_staff_id=` | Preview: families affected, open cases, open tasks, target's current workload |
| `POST` | `/families/:id/transfer-ownership` | `{ to_staff_id, reason }` — **`reason` NOT NULL**, audit in same transaction, family notified |

This is the **only** path that changes `family.owner_id` (brief §3 invariant, §12).

## 7. Manager dashboard

| Method | Path | Returns |
|---|---|---|
| `GET` | `/dashboard/header` | `{ unattended_count, open_escalations }` — target 0 |
| `GET` | `/dashboard/team-now` | per admin: `presence, now_count, today_count, late_replies, workload_score, workload_level, inactivity_warning` |
| `GET` | `/dashboard/unattended` | families where `on_duty()` returned NONE |
| `GET` | `/dashboard/needs-action` | escalations, auto-detected absences, HIGH admin receiving a NOW item |
| `GET` | `/dashboard/this-week` | renewals (due/renewed/no reply/refused), at_risk by reason, response-target compliance, median first reply by shift |
| `GET` | `/staff` | roster for pickers |
| `POST` | `/staff/:id/offboard` | `{ mode: "even"\|"named", to_staff_id?, reason }` — deactivate, transfer families, flag orphaned coverage rules, notify, audit |
| `GET` | `/audit?entity=&entity_id=&cursor=` | manager-only |
| `GET`/`PATCH` | `/config` | manager edits weights/thresholds |

`workload_score` and `workload_level` are **computed server-side** (brief §7).
The UI displays them and must never recompute. `workload_level` is
`LOW | MEDIUM | HIGH` — there is no CRITICAL level in the brief.

Every dashboard number must be accompanied by enough identity to drill into it
(`?owner_id=`, `?bucket=`, `?overdue=true`), otherwise the dashboard is a wall of
numbers — explicitly rejected by the role brief §78.

## 8. Realtime (Socket.IO)

Namespace `PROPOSED: /staff`. Auth via session token on handshake. The server
subscribes each socket to **only** what that staff member may see — the client
does not choose its own rooms (brief §12 / rule 72).

| Event | Payload | UI effect |
|---|---|---|
| `family.updated` | `{ family_id, bucket, top_reason, needs_reply, on_duty_id }` | Re-place the row across inbox sections |
| `message.created` | `{ family_id, message }` | Append to open thread; bump inbox row |
| `case.updated` | `{ family_id, case }` | Update case cards |
| `task.updated` | `{ task }` | Update task lists |
| `handoff.created` | `{ handoff }` | Handoff card + "while you were away" |
| `coverage.changed` | `{ family_ids?, effective_at }` | Re-fetch duty + affected sections |
| `ownership.changed` | `{ family_id, from, to }` | Refresh family; timeline event |
| `unattended.changed` | `{ count }` | Manager header |
| `escalation.created` | `{ family_id, case_id, reason }` | Manager needs-action |
| `presence.changed` | `{ staff_id, presence }` | Team-now |
| `shift.ending` | `{ minutes_remaining, waiting_count, follow_up_count }` | End-of-shift banner |

Events are **signals, not state**. On receipt the client invalidates and refetches
the affected query rather than patching a score locally — this is what keeps
brief §12's "attention is computed, never user-entered" true on the client too,
and it is how concurrent edits reconcile to server truth.

## 9. Open questions requiring a decision

| # | Question | Blocks |
|---|---|---|
| Q1 | Base path and auth scheme (cookie session vs bearer)? | API client |
| Q2 | Is `top_reason` localised server-side, or a code + params the client renders? A code + params localises better for ar/en. **AI #4 recommends code + params.** | i18n of the single most-read string in the product |
| Q3 | Attachment upload: direct-to-storage signed URL, or through the API? | Composer |
| Q4 | Does `GET /inbox` return all sections in one call or one call per section? One call per section is assumed. | Inbox fetching |
| Q5 | Preset ↔ capability-flag mapping is unpublished (AI #5 §2). | Contact display |

## 10. Explicitly out of scope (seams reserved, not built)

Approvals, student groups and calling appear in the AI #4 role assignment but in
**no** part of the brief's data model or MVP scope. Per the product decision of
2026-09-05 they are **not built**, and the following seams are reserved so they
can be added without refactoring:

- `TimelineEntry` is a discriminated union open to `approval` and `call` kinds.
- The nav registry is data-driven; a module is one entry.
- Route slots `/approvals` and `/calls` are unregistered but reserved.

Note that AI #3 (mobile) **is** building student groups, approvals and calling
per its own product decision (`docs/mobile/decisions.md` D1). If those entities
land in the backend, the admin-side counterpart becomes real work and should be
scheduled deliberately — not absorbed silently.
