# Seams QA Requires — Student Groups, Approvals, Calling

Date: 2026-09-05 · Owner: AI #5 · Audience: AI #1, AI #2
Status: **request, not a design**

## Purpose and limits

QA cannot test what it cannot address. This document states the **minimum
observable surface** the conformance suites need, so implementation can start
immediately once the PRD decisions land.

**What this document deliberately does NOT do**, per the standing constraints:

- It does not design Student Groups, approvals or calling.
- It does not choose tables, columns, endpoints or transports.
- It does not invent any product rule absent from the PRD.
- It does not resolve **AMB-9**.

Anything below that could not be verified against the actual PRD text is marked
**UNVERIFIED** and must be confirmed before it is treated as a requirement.

---

## 1. The one seam BR-1 needs

Authorization must be answerable as a **total function** over an actor, a
conversation and a channel — the same function for messaging and calling.

```
canCommunicate(actor, conversation, channel, context) -> Decision
```

- `channel` distinguishes at least MESSAGE and VOICE_CALL, so calling can never
  be more permissive than messaging by omission.
- `conversation` exposes its **type** and its **participant set** (identity and
  role of each member). BR-1 is a statement about a participant set; it cannot
  be expressed without one.
- A `Decision` denies with a **stable error code** (`errors.ts` convention) so
  AI #3 and AI #4 branch on codes, never on message text.

**Today this is unreachable.** `AuthorizationService` keys on
`Thread(kind=FAMILY)` unique per family, so there is no participant set to
reason about (JC-002), and there is no teacher actor to place in one (JC-003).

### The invariant the suite will assert

> No conversation of a 1:1 type may contain both a teacher and a parent.

Checked at **creation** and at **every membership mutation**, so the forbidden
state cannot be reached by creating a legal conversation and mutating it
afterwards. `BR1-07`, `BR1-08` and `BR1-10` exist specifically to attack the
mutation path.

### What QA needs to be able to do

1. Construct an actor that **is a teacher** and is not CS back-office staff.
2. Construct each conversation type and read back its participant set.
3. Call the authorization seam directly, without going through a controller.
4. Attempt every membership mutation and observe allow/deny.
5. Request a **call token** and observe allow/deny — including at room join,
   not only at issuance (`BR1-13`).

Items 1–5 are the whole dependency. No product decision is required for any of
them.

---

## 2. Approvals — observable surface only

MVP approval is **approve · reject · rejection reason**. Escalation, expiry and
coverage-aware approval are Phase 2 and must not appear.

QA needs to observe:

| # | Requirement |
|---|---|
| A1 | A submitted message can be in a **pending** state that is distinguishable from published |
| A2 | A pending message is **not delivered** — not to recipients, push, realtime, search, exports or group reads |
| A3 | An authorized approver can approve, and the message becomes published **exactly once** |
| A4 | An approver can reject **with a reason**, and rejection **without** a reason is refused |
| A5 | The author cannot approve their own message |
| A6 | Approve and reject are **terminal** — no transition out of a decided state |
| A7 | Concurrent decisions resolve to **one** final state with no duplicate publication |
| A8 | Every decision is audited with actor, timestamp and reason |

**UNVERIFIED — needs PRD confirmation, do not assume:** which message types and
which groups require approval; **who** the authorized approver is when the
family's owner is off duty (see `test-plan.md` AMB-11); whether a rejected
message is visible to its author and in what form.

`ModerationStatus` already declares `PENDING` / `REJECTED`, so A1 is close.

---

## 3. Calling — observable surface only

MVP is **voice**, 1:1 and group. Video is Phase 2.

| # | Requirement |
|---|---|
| C1 | Call authorization routes through the **same** seam as messaging (§1), not a parallel matrix |
| C2 | Call tokens are **server-generated**, short-lived and scoped to one room and one identity |
| C3 | A client cannot obtain a token for an arbitrary room, nor reuse another identity's token |
| C4 | Authorization is re-checked **at room join**, not only at token issuance |
| C5 | Revoking permission mid-call terminates access |
| C6 | Call lifecycle and history are observable: participants, type, start, duration, outcome |
| C7 | **No phone number** appears in call setup, signalling, metadata, history or push payloads |

**C7 is a release gate (G-07).** Phone privacy currently holds by construction —
no actor or communication entity carries a number — and CI enforces that
(`no-contact-channel-columns.spec.ts`). Telephony integrations are the most
common place a number is reintroduced; if the calling provider requires any
identifier, it must be an **opaque** one, and the privacy suite extended in the
same change.

**UNVERIFIED — needs PRD confirmation:** group call size limits; whether a group
call requires admin presence to start or only to continue (this is **AMB-9**
again, in the calling channel); missed-call and call-history retention.

---

## 4. Ready to run the moment the seam lands

| Artifact | State |
|---|---|
| `br1-conformance.spec.ts` | 23 pending cases, exact matrix fixed |
| `test-plan.md` §3–§6 | BR1-01…BR1-20, SG-01…SG-12, AP-01…AP-15, CL-01…CL-14 |
| `rbac-matrix.md` §2–§3 | full allow/deny matrix for groups, approvals, calling |
| `release-gate.md` | G-01…G-06 held at FAIL until these pass |

Conversion from pending to asserting is mechanical once §1 items 1–5 exist.

---

## 5. Still blocked on product, not on engineering

**AMB-9 — "required admin presence/authorization" in a Student Group is
undefined.** Must an admin be a member? online? on duty? Does the group become
invalid if the admin is removed or offboarded, and what happens to an in-flight
call at that moment?

It is the load-bearing condition of BR-1's **permitted** case. `BR1-09` and
`SG-12` cannot be written until it is answered, and QA will not resolve it by
assumption. Everything else in this document proceeds without it.
