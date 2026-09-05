# Screen: Settings

**Priority:** P0 · **Platform:** Flutter + Admin Web · **Owner:** AI #3 / AI #4

One screen name, four role-specific contents. Nothing here is a dumping ground: an item earns
its place by being something a user genuinely changes.

---

## 1. Parent

| Section | Contents |
|---|---|
| **Profile** | Name, photo, relationship to the students. Read-only where the family's primary guardian manages contacts. |
| **My family** | Contacts with their **preset** and what it allows in plain language — *"Can send messages and manage billing"* — not six raw flag names. Editable only with `can_manage_contacts`. |
| **Language** | العربية · English. Applies immediately, no restart. |
| **Notifications** | `screens/notifications.md` §6. |
| **Subscription** | Visible with `can_manage_billing`; otherwise the section is **absent**, not greyed. |
| **Help** | How to reach Jawwid, and the owner's name. |
| **Account** | Sign out. Sessions and devices, with revoke. |

Never here: ownership, coverage, cases, staff identities beyond the owner, **phone numbers**.

## 2. Teacher

Profile · Language · Notifications · **My groups** (read-only; membership is not a teacher's to
change) · Account. Nothing operational.

## 3. Staff (admin / coverage)

| Section | Contents |
|---|---|
| **Profile** | Name, photo, presence (online / away / offline — settable manually). |
| **My shift** | **Read-only.** Days and hours, and who covers for the user outside them. Editing lives in `screens/coverage.md` and is the manager's. |
| **My workload** | Their own breakdown (`screens/workload.md`), self only. |
| **Canned replies** | Personal and shared. Create, edit, reorder. |
| **Language** · **Notifications** | Per `notifications.md` §6; response-target and unattended alerts cannot be disabled. |
| **Account** | Sign out, sessions, revoke. |

Showing a staff member their own shift **read-only** is deliberate: they need to know when they
go off duty (the end-of-shift banner depends on it) and they must not be able to change who sees
a customer's message. That is `on_duty()`'s input, and only a manager touches it.

## 4. Manager

Everything in §3, plus:

| Section | Contents |
|---|---|
| **Team** | Roster, roles, presence, `WorkloadBadge`. Per person: change owner *(bulk)*, offboard. |
| **Coverage** | Link to `screens/coverage.md`. |
| **Configuration** | Attention weights, workload weights, bucket thresholds, response targets, timers, windows. |
| **Audit log** | Filterable by entity, actor and date. Manager-only read. |

### Configuration — the screen that must not lie

Every value renders with **its current value, its default, and the words "initial hypothesis"**,
because that is precisely what the brief says each of them is. Editing shows the consequence
before saving:

> *"Changing the NOW threshold from 60 to 50 would move **7 families** into Now right now."*

`[BE]` supplies the preview. Every change is audited with a reason.

**The client stores none of these numbers.** `GET /config` is the only source, and the literals
`60`, `25`, `8`, `15` appear nowhere in either codebase (brief §12, DQ-06/07).

## 5. States

- **Loading** — section skeletons.
- **Saving** — inline per-field, with an optimistic value and rollback on error. No global save
  button; a settings screen with one save button loses work.
- **Error** — inline on the field, with the previous value restored.
- **Offline** — read-only with a banner; edits are blocked rather than queued, because a queued
  configuration change that applies an hour later is a routing change nobody expected.
- **Permission denied** — the section is absent for roles that never have it; disabled with a
  reason only where a role normally has it but cannot right now (DD-10).
- **Language change** — applies immediately, including direction. The screen re-lays out in the
  new direction without a restart; this is the single best RTL test in the product and should
  be exercised on every screen (`design-qa.md` §C).

## 6. RTL · Accessibility

Labels lead, values and chevrons trail; both mirror. Switches mirror. Times and numbers stay LTR.
Every switch has a label and a described state; grouped settings use real headings so a
screen-reader user can navigate by section.

## 7. Edge cases

- **A contact demoted while their settings are open** — sections disappear on the next fetch
  with a brief explanation, never silently.
- **A staff member offboarded while signed in** — next action returns *account disabled*,
  distinguishable from a session expiry (journey J24).
- **Two managers editing config simultaneously** — last write wins with an explicit conflict
  notice naming who changed it; never a silent overwrite.
- **Language changed on one device** — a per-user preference, applied across devices `[BE]`.

## 8. Backend dependencies

`GET /me`, `GET /me/duty` · sessions and device revoke, with a **distinguishable** error for
*session revoked* vs *account disabled* vs *bad credentials* (AI #3's C1/C3) · `GET/PATCH /config`
with an impact preview · `GET /audit` · `GET /staff` · contact capability flags and the
preset↔flag mapping (OQ-5) · canned replies · per-user locale.
