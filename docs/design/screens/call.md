# Screen: Calls

**Priority:** **CONDITIONAL — blocked on OQ-4** · **Platform:** Flutter + Admin Web · **Owner:** AI #3 / AI #4

> **Calling appears nowhere in the project brief.** It is in the mobile role assignment only.
> AI #3 called it *"the single largest and riskiest piece of mobile work"* (LiveKit, CallKit,
> ConnectionService) and asked for it to be confirmed before it is built. AI #4 has reserved a
> route slot and built nothing.
>
> **Do not build this until OQ-4 is answered.** This spec exists to make the decision cheap in
> either direction. If the answer is no, delete this file; the `TimelineEntry` union already
> reserves a `call` kind, so adding it later is not a refactor.

---

## 1. Role and purpose

**Roles:** parent ↔ Jawwid · teacher ↔ Jawwid · group calls within a Student Group ·
admin → family. **Never teacher ↔ parent 1:1**, in either direction.

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
`[BE]`. In a Student Group, a member profile has **no call action at all** — teacher ↔ parent
1:1 calling must not be suggested any more than teacher ↔ parent messaging is
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

## 8. Backend dependencies — none of these exist

A **call session entity** and authorization returning a short-lived token + server URL, per
conversation (never a client-constructed room) · group call authorization · call history with
**no phone numbers** · push payloads for incoming and missed calls carrying only id, type and
target · a server-enforced prohibition on teacher ↔ parent 1:1 calls.
