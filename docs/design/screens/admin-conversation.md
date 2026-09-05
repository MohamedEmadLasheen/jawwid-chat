# Screen: Admin Conversation (Family workspace)

**Priority:** P0 · **Platform:** Admin Web · **Owner:** AI #4

---

## 1. Role and purpose

**Roles:** admin · coverage · manager. Department staff never reach this screen.

**Purpose:** *"understand this family and act, without leaving the screen."*

One continuous thread per family, forever (`thread.family_id` UNIQUE). Cases are layered on it,
not separate conversations (`decisions.md` DD-01). The thread is never opened, closed or
resolved — **cases** are.

**Entry points:** an inbox row · a notification deep-link · a search result · a task's family
link · a handover card · a timeline event.

**Primary action:** reply.
**Secondary:** internal note · new case · follow-up · task · escalate · keep this · leave for
owner · reply as assist · reply + snooze · reply + resolve · call *(OQ-4)*.

## 2. Layout

The centre pane of the three-pane shell. Family 360 (`screens/family-360.md`) is the right pane
and is **already populated** when this opens — no second click to learn who this family is.

```
┌──────────────────────────────────────────────────┐
│ ConversationHeader                               │  ← owner + on-duty, always
├──────────────────────────────────────────────────┤
│ Open case cards (horizontal, click to filter)    │  ← only when cases are open
├──────────────────────────────────────────────────┤
│                                                  │
│   messages · internal notes · system cards       │  ← scroll, virtualised
│   ─────────── Unread ───────────                 │
│                                                  │
├──────────────────────────────────────────────────┤
│ MessageComposer                                  │
└──────────────────────────────────────────────────┘
```

## 3. ConversationHeader — carries risk R2

```
Al-Farsi                                    [Priority]   ⋯
Owner · Admin A
On duty · Coverage B — Covering                          ← line 3 only when ≠ owner
```

| Line | Content | Rule |
|---|---|---|
| 1 | Family name (`type.h2`) + tier marker if `priority` + overflow menu | |
| 2 | **`Owner · {name}`** | **Always present.** Never replaced, never conditional, never moved. |
| 3 | `On duty · {name}` + `ModeBadge` | Rendered **only when the on-duty person differs from the owner.** For an owner working her own family, line 3 is absent — the normal case must look normal. |

Additional header state, appended to line 3 when it applies: **Keeping this · until 18:30** ·
**Unattended** *(manager view only)*.

This component is the single place the product teaches "coverage is not ownership". It is worth
the two lines it costs (DD-02).

## 4. Case cards

A horizontal strip above the thread, one card per **open** case: type icon, type, `StatusBadge`,
`owner_locked` marker, `is_blocking` marker, due date.

Clicking a card **filters the thread to that case's messages** and the card becomes selected;
clicking again clears. This is how a family with three simultaneous topics stays legible without
a second thread.

Resolved and closed cases live in Family 360's history, not here.

## 5. Thread

Rendered top-to-bottom, oldest first, virtualised, with a persistent **Unread** divider until
the user leaves.

| Kind | Treatment |
|---|---|
| Family message | Incoming bubble, `surface.default` + border, avatar + contact name + relationship |
| Staff message | Outgoing bubble, `message.outgoing.bg`, staff name, `ModeBadge` when mode ≠ owner |
| **Internal note** | **Not a bubble.** Full-width violet block, 3px leading edge, explicit `Internal note · {author}` label (DD-05) |
| System event | Full-width centred `SystemCard`: payment failed · class started · handover · task completed · owner changed · case reopened · call ended |

Message footer: time · `ModeBadge` · delivery state icon. Long text wraps; mixed-script bodies
use `unicode-bidi: plaintext`.

**Realtime:** at the bottom → append and scroll. Scrolled up → append + **"New messages ↓"**
pill. Composing → append silently, never steal focus, never move the composer (DD-12).

## 6. Composer

Default state shows **three** affordances: attach · text field · send. Everything else is behind
one overflow (`design-system.md` §7.9).

**Send is a split button:** Send · **Reply + snooze** · **Reply + resolve** (brief §8).

**Overflow:** Internal note *(switches the field to the violet internal treatment so you can see
what you are writing before you send it)* · New case · Follow-up · Task · Escalate to manager ·
I'll keep this · Leave for the owner · Reply as assist · Canned replies · Call *(OQ-4)*.

**Conditional actions are disabled with an honest reason**, never hidden (DD-10):

| Action | Disabled reason `[BE]` supplies |
|---|---|
| Reply as assist | "Available when the on-duty admin hasn't opened this and the reply is overdue." |
| Resolve an `owner_locked` case, as coverage | "Leave for the owner — Admin A's next shift, Sunday 09:00." |
| Send a customer message when not on duty | "Coverage B is on duty for this family. You can add an internal note." |

Actions the **role** can never perform are hidden entirely (department staff never see a
composer at all).

Drafts persist per family, survive navigation, and survive session expiry (J24).
Keyboard: `r` focus composer, `n` internal note, `Cmd/Ctrl+Enter` send, `Esc` blur.

## 7. Permissions *(UX affordances only)*

| Situation | Composer |
|---|---|
| On duty (owner, coverage, sticky, assist granted, escalation) | Full |
| Not on duty | **Internal note only.** Customer send is disabled with the reason above. Brief §5: any admin may write internal notes any time. |
| Coverage + case is `owner_locked` + not urgent | Reply and acknowledge; **resolve disabled**. |
| Coverage + `owner_locked` + urgent | Transactional actions enabled; **resolve stays disabled**. Coverage never closes relationship cases. |
| Manager | Full, plus Change owner in the header overflow. |
| finance / technical / academic | No access to this screen. |

## 8. States

- **Loading** — header skeleton, three message skeletons, composer disabled but visible.
- **Empty thread** (a family that has never written) — *"No messages yet."* + *"Start the
  conversation, or add an internal note."* Composer is fully enabled.
- **Error** — *"We couldn't load this conversation."* + Retry. The header and Family 360 stay,
  because they loaded from a different call and are still useful.
- **Offline** — banner; the thread is readable; sends queue below the last confirmed message
  with a clock glyph; the composer stays enabled.
- **Permission denied** — *"You don't have permission to access this family."* Nothing else:
  no owner name, no rule, no id (role brief §53).
- **Send failed** — the bubble stays in place with a red border and an inline **Retry**. Never
  dropped, never silently retried forever.
- **Success** — a sent message is its own confirmation; **no toast for sending**. Toasts fire
  only for actions with no visible artefact: "Follow-up created", "Escalated to the manager",
  "Task created".

## 9. Responsive

≥ 1280: centre pane. 1024–1279: Family 360 becomes a drawer; a **Family** button in the header
opens it. < 1024: full screen with a back affordance; Family 360 is a full-screen modal.

## 10. RTL

Bubble sides swap (own messages on the reading-start-opposite edge), tail radius follows.
Avatars, mode badges and timestamps mirror. Reply and send arrows mirror. Delivery ticks,
clocks and the voice-note waveform **do not**. The internal note's 3px edge is on the
reading-start side. Case cards scroll in the reading direction.

## 11. Edge cases

- **Owner changes while open** → a `SystemCard` appears in the thread *and* the header updates.
  Never a silent header change.
- **Coverage changes while open** → header line 3 updates; if it now affects the current user's
  ability to send, the composer's disabled reason updates live rather than failing on submit.
- **Stickiness expires while open** → toast + header badge clears + a `SystemCard`.
- **A case is reopened by a family message** → `SystemCard` "Topic reopened", the case card
  returns to the strip.
- **4000-character message** → renders and scrolls; the bubble does not widen past its max.
- **Emoji-only message** → larger glyph size, no bubble restyle.
- **20 attachments** → each is its own `AttachmentPreview`; failures keep their row with Retry.
- **Two admins typing** → both indicators show, at the bottom of the list, never in the header.

## 12. Backend dependencies

`GET /families/:id/messages` (cursor) · `POST /families/:id/messages` with **server-set
`on_behalf_mode`** — the client must never choose it (brief §12) · `POST /families/:id/notes` ·
cases and follow-up endpoints · `capabilities.*` with `*_blocked_reason` strings for every
disabled action · realtime `message.created`, `case.updated`, `ownership.changed`,
`coverage.changed`, `handoff.created` · a `client_message_id` accepted for idempotency.
