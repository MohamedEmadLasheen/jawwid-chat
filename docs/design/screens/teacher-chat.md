# Screen: Teacher ↔ Jawwid conversation

**Priority:** P0 for mobile · **CONDITIONAL — depends on OQ-2** · **Platform:** Flutter (teacher) · **Owner:** AI #3

---

## 1. Role and purpose

**Role:** teacher.

**Purpose:** *"ask Jawwid something, or tell them something, about my students."*

This is a teacher's only 1:1 channel, and it is with **Jawwid**, never with a parent.

**Entry points:** the Jawwid row on Teacher Home · a notification.

**Primary action:** send a message. **Secondary:** attach · voice note · reply · react.

## 2. Layout and behaviour

Identical in structure to `parent-chat.md` §2, with three differences:

1. **No topics strip.** Cases are an operational construct for families; a teacher's messages
   are not case-managed and showing them a topic list would expose the internal model.
2. **No self-service actions.** Subscriptions and invoices are a family's concern.
3. **The header names "Jawwid"**, not an individual — a teacher does not have an owner. Whoever
   is on duty replies, and the teacher is not told about duty, coverage or handovers.

Everything else — message rendering, system cards, the state machine, offline queueing,
keyboard-anchored composer, draft persistence — is exactly `parent-chat.md`. **One component
set, two configurations.** A second chat implementation is how two chats drift.

## 3. Permissions *(UX affordances only)*

A teacher sees only their own conversation. Never other teachers, never families, never internal
notes, never cases, never staff identities beyond whoever replied, never phone numbers.

Approval *(OQ-1)*: whether teacher ↔ Jawwid messages are subject to approval is a **policy
decision** and the policy is per conversation and server-supplied. The client never assumes.
**Recommendation:** approval applies to Student Groups (parent-visible) and **not** to the
teacher ↔ Jawwid channel — approving a teacher's question to their own operations team adds
latency to an internal conversation and protects nobody.

## 4. States · Responsive · RTL · Edge cases

All as `parent-chat.md` §7–§9, minus the read-only capability-flag state (a teacher either has
an account or does not) and minus topic reopening.

Additional edge case: **a teacher messages about a student they no longer teach** — allowed;
the conversation is with Jawwid, not with the group, and cutting it off mid-thread would strand
a legitimate handover conversation.

## 5. Backend dependencies

A teacher principal (OQ-2) · a teacher ↔ Jawwid conversation entity · the same messaging,
realtime, media and push contracts as `parent-chat.md` §10 · a per-conversation approval policy
if OQ-1 lands.
