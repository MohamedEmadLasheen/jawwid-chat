# Screen: Calls

**Priority:** **P0 — PRD MVP scope** · **Platform:** Flutter + Admin Web · **Owner:** AI #3 / AI #4

> **In-app voice calling is MVP** — 1:1 **and group calling in Student Groups**
> (`docs/qa/authoritative-scope.md` §3). **Video is Phase 2.**
>
> **Corrected on review.** An earlier revision of this pack marked calling *"conditional"* and
> said this file could be deleted if the answer were no. That framing came from the superseded
> brief, in which calling does not appear, and it risked reading as a design decision to drop a
> PRD capability. **Calling is in scope. This pack does not question that.**
>
> **OQ-4 is now narrowed to implementation status and sequencing**, owned by the integration /
> release authority — not to whether the capability exists. `docs/qa/defects.md` **JC-001**
> records calling as P0 and currently DESIGN-ONLY in the backend. AI #3 has flagged it as the
> largest mobile workstream (LiveKit, CallKit, ConnectionService); that is a sequencing input,
> not a scope argument.
>
> This spec defines the UX states and the contract the interface needs. It does not define the
> transport, the signalling, or the authorization rule.

---

## 1. Role and purpose

**Roles:** parent ↔ Jawwid · teacher ↔ Jawwid · **parent ↔ authorized teacher, 1:1** ·
**group calls within a Student Group** · admin → family.

> **Updated 2026-09-23 by PD-6.** An earlier revision of this spec read *"Never teacher ↔ parent
> 1:1, in either direction"*. That was correct under PRD v0.1 BR-1 and is now superseded.

**Teacher ↔ parent 1:1 calling is allowed — and only — where the backend authorizes the
relationship** (PRD v0.2 BR-1; `architecture/AUTHORIZATION-MODEL.md` §4.1). The rule is
**enforced server-side**; the interface's only job is to render the affordance exactly where the
backend authorizes it and nowhere else. The client never decides the relationship and never
caches the answer.

**Purpose:** *"talk, when typing is the wrong tool."*

**Entry points:** a conversation header's call button · a group header · Family 360 *(admin)* ·
an incoming call notification.

**Primary action:** answer / end. **Secondary:** mute · speaker · switch device.

## 2. Non-negotiables

1. **No phone numbers, anywhere.** Not on the call screen, not in history, not in a
   notification, not in a payload. People are named, never dialled (DQ-04).
2. **No recording UI in MVP.** No record button, no "this call may be recorded" banner, no
   playback surface.
3. **The client never constructs or guesses a room** and never self-authorizes. It asks the
   backend for a session against a conversation; the backend authorizes and returns a
   short-lived token. **If authorization fails there is no fallback** — the app shows a safe
   error and stops (AI #3's C13).

## 3. States

| State | Screen |
|---|---|
| **Incoming** | Full screen. Caller name + avatar + relationship/role. Decline · Answer. Platform call UI (CallKit / ConnectionService) where available. |
| **Outgoing** | Callee name + avatar, *"Calling…"*, End. |
| **Connecting** | *"Connecting…"* with the identity still visible — never a blank screen with a spinner. |
| **Connected** | Identity, duration (LTR run), controls: mute · speaker · end. |
| **Poor connection** | An in-flow line *"Connection is weak"*. The call is not dropped by the UI. |
| **Reconnecting** | *"Reconnecting…"*, controls stay, audio resumes without user action. |
| **Ended** | Duration + a return to the conversation. A `SystemCard` lands in the thread. |
| **Missed** | Notification + a `SystemCard`. History entry with the outcome. |
| **Failed** | *"We couldn't connect the call."* + Retry + *"Send a message instead"*. Never a technical code. |
| **Declined** | Plain, neutral, in both directions. Never *"rejected"*. |

**Group call:** a participant list replaces the single avatar; each participant shows name and
role; joins and leaves are `SystemCard`s in the group. Same controls; no per-participant mute
for non-hosts in MVP.

## 4. Permissions *(UX affordances only)*

The call button renders **only** where the backend authorizes a call for that conversation
`[BE]`. This is unchanged by PD-6 and matters more, not less: the set of authorized pairs is now
data rather than a constant, so the client must never infer it. Where the backend does not
authorize the pairing, the affordance is **absent, not disabled**.

In a Student Group, a member profile still has **no call action** — a direct call is reached from
the parent's or teacher's own 1:1 conversation, not from a group roster
(`screens/student-group.md` §1).

## 5. Call history

Reachable from a conversation header and from Family 360. Each entry: participants **by name and
role**, direction, duration, outcome, timestamp. **No phone numbers.** For staff, a call is also
a timeline event (`family-360.md` §6).

## 6. Responsive · RTL · Accessibility · Low-end

Mobile is the primary surface; the admin surface is a compact panel, not a full screen.
**RTL:** identity and controls mirror; **the duration timer does not** and stays an LTR run;
the mute and speaker glyphs do not mirror (physical objects, `cross-platform.md` §4).
**Accessibility:** every control is labelled; state changes are announced; the end-call button
is the largest target on screen and is never adjacent to mute.
**Low-end:** audio only in MVP; no video, no background blur, no animated avatars.

## 7. Edge cases

- **Incoming call while the app is closed** — platform call UI; answering deep-links into the call.
- **Incoming call during a call** — the second is declined with a missed entry. No call waiting in MVP.
- **Permission denied by the OS (microphone)** — a clear explanation and a link to settings,
  before dialling rather than after.
- **The authorizing session expires mid-call** — the call continues on its existing token; the
  next action requires sign-in.
- **A group call with one participant** — allowed; it shows *"Waiting for others"*.
- **Call ends while the app is backgrounded** — the `SystemCard` is present on next open.

## 8. Backend contract required

| # | Requirement | Owner |
|---|---|---|
| K1 | A **call session** entity — participants, direction, duration, outcome, timestamp — with **no phone number in any column or payload** | AI #1 / AI #2 |
| K2 | **Authorization per conversation**, returning a short-lived token + server URL. The client never constructs or guesses a room and never self-authorizes | AI #1 |
| K3 | **Group call** authorization within a Student Group | AI #1 |
| K4 | Calling authorization evaluated by the **same** *(actor, conversation, channel)* code path as messaging, so BR-1 cannot be enforced in one and missed in the other (`docs/qa/authoritative-scope.md` C-2) | AI #1 |
| K5 | Push payloads for incoming and missed calls carrying **only** id, type and target id | AI #2 |
| K6 | Call history readable by the authorized participants, **no phone numbers** | AI #2 |

None of these is designed here.
