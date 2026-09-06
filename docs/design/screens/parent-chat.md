# Screen: Parent ↔ Jawwid conversation

**Priority:** P0 · **Platform:** Flutter (parent) · **Owner:** AI #3

---

## 1. Role and purpose

**Role:** parent / family contact with `can_message`.

**Purpose:** *"talk to Jawwid, and see where my topics stand."*

This is the same parent↔admin conversation the admin sees, with everything internal filtered
out `[BE]`. **It is continuous:** it does not reset when the Current Handler changes, when
coverage takes over, or when a topic is resolved (journey J1).

A parent's **Student Groups are separate conversations**, one per child, reached from the Groups
tab — not content on this screen. Whether a parent has exactly one channel to Jawwid or two is
**OD-05**, open; this screen is drawn for one.

**Entry points:** the Jawwid tab · the Home card · a notification deep-link · a topic card.

**Primary action:** send a message.
**Secondary:** attach · voice note · reply · react · start a topic · self-service · call *(OQ-4)*.

## 2. Layout

```
┌──────────────────────────────────────┐
│ ‹  Jawwid                        [☎] │  ← header
│    Admin A · usually replies in 30m  │
├──────────────────────────────────────┤
│  Your topics  ▸  2 open              │  ← collapsed strip, only when non-empty
├──────────────────────────────────────┤
│                                      │
│   messages                           │
│   ─────── Unread ───────             │
│                                      │
├──────────────────────────────────────┤
│ [+]  Message…                   [▶]  │
└──────────────────────────────────────┘
```

## 3. Header

Title is **"Jawwid"** — the organisation, not the person. Subtitle names the **owner** and the
honest reply expectation `[BE]`.

The parent is never shown that coverage is happening. A reply from Coverage B renders with
Coverage B's name and photo — they are a real person and pretending otherwise would be a lie —
but no badge, no mode, no explanation, and the header still says Admin A is their contact
(journey J3). The staff-side machinery is not the parent's concern and never appears.

## 4. Topics strip

Collapsed by default, expands to a list of open topics with plain-language status
(`terminology.md` §3). Tapping filters the conversation to that topic — the same mechanism as
the admin's case cards, in customer language.

**Starting a topic:** the composer's `+` → *"What is this about?"* → **~5 plain categories**
(brief §8) plus an optional *"I can't join the class"*. That last one matters: it is a
blocking-issue signal `[BE]` and it is worth its own button.

No case type, no severity, no internal category ever appears. The five customer categories are a
product decision, not a mirror of the ten internal case types.

## 5. Messages

Familiar chat. Incoming from staff (name + photo). Outgoing on the reading-end side.
Attachments, voice notes, reply-quote, reactions.

**System cards** — plain, calm, never attributed to a person: the automatic acknowledgement
(*"We've got your message. Admin A usually replies within 30 minutes."*), class started,
payment reminders, topic resolved, topic reopened.

**The automatic acknowledgement must never look like a human reply** (journey J1). It is a
`SystemCard`, without an avatar, without a name. A parent who thinks a person replied and then
waits 30 more minutes has been misled by the interface.

**Never rendered here, under any circumstance:** internal notes · case types · severity ·
`owner_locked` · escalation · attention · response targets · workload · other staff identities ·
other families · phone numbers (DQ-03, DQ-04, risk R3).

## 6. Composer

`+` → photo · file · voice note · start a topic · self-service (by capability flags) ·
call *(OQ-4)*. Then the text field, then send.

Anchored to the keyboard; the message list resizes and **the composer never translates or jumps**
(role brief §45). Drafts persist per conversation and survive session expiry (journey J24).

**Message states** are exactly the shared state machine (`cross-platform.md` §2): the client may
author only `queued`, `sending`, `failed`. `sent` / `delivered` / `read` come from the server.
A queued message sits below the last confirmed message with a clock glyph — **never** styled as
delivered (DQ-05).

## 7. States

- **Loading** — header renders immediately from cache; message skeletons below.
- **Empty** — *"Say hello. Admin A is your contact at Jawwid."* + the reply expectation.
  Composer fully enabled.
- **Error** — *"We couldn't load your messages."* + Retry. The header stays.
- **Offline** — banner; history readable; sends queue; the composer stays enabled.
- **Send failed** — the bubble stays in place, red border, inline **Retry**. Never dropped.
- **Read-only** (`can_message=false`) — the composer is replaced by one calm line:
  *"Only your family's primary guardian can send messages."* The history stays readable.
- **Session expired** — sheet, sign in, **the draft is restored** (journey J24).

## 8. Responsive · RTL · Low-end

360×640 target, verified at 320 and 200% text scale. Virtualised list. No blur, no shadow-heavy
bubbles, server-provided voice-note durations and image thumbnails — the client decodes nothing
to render the list (risk R7).

**RTL:** bubbles swap sides with the tail radius following; reply and send arrows mirror;
**delivery ticks, the clock glyph and voice-note waveforms do not**. Message bodies use
`unicode-bidi: plaintext` so a mixed Arabic/English message resolves per paragraph.

## 9. Edge cases

- **The handling person changes mid-conversation** — nothing visible happens. No "X joined",
  no divider. The thread is continuous; that is the promise.
- **The owner changes permanently** — one plain message explaining it, then the header updates.
- **A topic is resolved and the parent replies** — the topic reopens automatically `[BE]`;
  a `SystemCard` says so; no new conversation is created (journey J7).
- **Out of hours** — the acknowledgement states the next shift honestly. Never
  *"we'll reply shortly"* at 02:00.
- **Emoji-only message** — larger glyphs, no bubble restyle.
- **4000-character message** — renders and scrolls.
- **20 rapid messages** — `[BE]` batches the acknowledgement (~60s) so the parent gets one
  reply, not twenty.

## 10. Backend dependencies

Conversation list and message history with **cursor pagination and a server-authoritative
ordering key** · send with `client_message_id` idempotency (a schema addition AI #3 has already
requested, C6) · realtime with a **resumable cursor** so a reconnect does not force a broad
refetch on a slow network · media upload with short-lived access URLs, server-provided
thumbnails and durations · **server-side filtering of everything internal** · customer-safe topic
status strings · the honest reply-time estimate.
