# Design Handoff — AI #3 (Flutter Mobile)

**From:** AI #6 · **Date:** 2026-09-05

Everything you need to build the parent and teacher apps without making UX decisions yourself.
No implementation code — where you see `[BE]`, the behaviour is the backend's and you render it.

---

## 1. Read in this order

1. `discovery.md` §5 — the vocabulary reconciliation. Several terms in **your** role assignment
   do not match the PRD; the right-hand column is what ships.
2. `terminology.md` — every string, both languages.
3. `design-system.md` — tokens, components, states.
4. `cross-platform.md` — what must match Admin Web exactly.
5. The screens below.
6. `design-qa.md` — self-check before you hand anything to AI #5.

## 2. Screens you own

| P0 | Screen | Blocked on |
|---|---|---|
| ✓ | `screens/auth.md` | Error taxonomy from AI #1 |
| ✓ | `screens/parent-home.md` | — |
| ✓ | `screens/parent-chat.md` | — |
| ✓ | `screens/notifications.md` | Payload schema |
| ✓ | `screens/settings.md` | Preset↔flag mapping (OQ-5) |
| ⚠ | `screens/student-group.md` | **OQ-3** — the entity does not exist |
| ⚠ | `screens/teacher-home.md` | **OQ-2** — no teacher principal exists |
| ⚠ | `screens/teacher-chat.md` | **OQ-2** |
| ⚠ | `screens/approvals.md` §5 (sender states only) | **OQ-1** |
| ⚠ | `screens/call.md` | **OQ-4** |

**Build the ✓ rows now.** The ⚠ rows are designed and waiting on product decisions you already
escalated — do not start them on the strength of this document alone.

## 3. Navigation — two shells, not one

**Parent:** bottom tabs — Home · Jawwid · Groups · Settings.
**Teacher:** bottom tabs — Home · Groups · Settings.

Icon **and** label always; never icon-only. 56px + safe area. The shells are deliberately
different (`decisions.md` DD-08) — do not unify them to save a widget.

## 4. Tokens

Materialise `design-system.md` §2–§5 **once**, as a `ThemeExtension` in `lib/design/tokens.dart`,
using the semantic names verbatim (`colorAttentionNowFg`, `spacing5`, `radiusLg`).

`Color(0x…)` must not appear outside that file. Same for spacing and radii. When brand sign-off
lands, exactly one file in your repo changes.

Mobile supports **light and dark** (Admin Web does not — DD-13). Every token has a dark value in
§2; none is defined only inside a dark block.

## 5. The rules you cannot bend

1. **Never render an attention score, bucket number, or priority label.** Not on any parent or
   teacher screen, in any form. Your app has no attention model at all — "Needs a reply" on
   Teacher Home is unread-driven and sorted by time (`screens/teacher-home.md` §3).
2. **Never render an internal note, case type, severity, `owner_locked`, escalation, workload,
   response target, coverage, or on-duty state** on a family or teacher surface.
3. **Never render a phone number.** Not in a profile, a group member list, a call log, a
   notification, or a search result.
4. **The parent's contact is always the owner**, even when someone else replies. A covering
   reply shows the replier's real name and photo and **no badge, no mode, no explanation**
   (`screens/parent-chat.md` §3).
5. **You may only author `queued`, `sending`, `failed`.** Everything else comes from the server
   (`cross-platform.md` §2). A queued message must never look delivered.
6. **A pending message is invisible to non-senders** — absent, not greyed (OQ-1).
7. **No teacher → parent 1:1 affordance exists anywhere.** Not disabled. Absent. Member profiles
   have no message action and no call action (`screens/student-group.md` §1).
8. **The composer never jumps when the keyboard opens.** The list resizes; the composer does not
   translate.

## 6. RTL

`cross-platform.md` §4 is the full rule set. The three that catch people:

- **Voice-note waveforms do not mirror.** They are a timeline of physical sound.
- **Delivery ticks, clocks, microphone, camera, paperclip and the handset do not mirror.**
- Message bodies need `unicode-bidi: plaintext` equivalent behaviour so a mixed Arabic/English
  message resolves its own base direction per paragraph.

Use `EdgeInsetsDirectional`, `AlignmentDirectional`, `PositionedDirectional` exclusively. Add a
lint that fails on `EdgeInsets.only(left:` and `right:` — it is cheaper than a QA pass.

Build RTL first, verify LTR. Arabic is the default locale.

## 7. Localisation

ICU messages with named parameters, never string concatenation. **Arabic has six plural forms**
— every count goes through plural selection; test 1, 2, 3, 11, 100.

Western numerals in both locales (DD-09). Gregorian dates, `ص/م`, Africa/Cairo, relative under
24h then absolute.

Server-originated strings (`top_reason` — not yours, system messages, rejection reasons,
reminder bodies) arrive **localised or as key+params** `[BE]`. Do not compose them.

## 8. Offline and realtime

- Local queue keyed by `client_message_id` (UUID v4), generated **once per composed message** and
  reused across every retry. This is a schema request you already raised (C6).
- Offline: in-flow banner, UI stays interactive, sends queue below the last confirmed message
  with a clock glyph. On recovery, send in order.
- Permanent failure: bubble stays in place, red border, inline **Retry**. Never dropped, never
  retried forever.
- Realtime: append; if the user is scrolled up, show **"New messages ↓"** and never auto-scroll;
  never steal focus while composing (`cross-platform.md` §3).
- Reconnect: resync from a cursor. Broad refetch is what you specifically asked to avoid on slow
  networks — press AI #2 for the resumable cursor (your C7).

## 9. Low-end Android — the constraints, concretely

Target 360×640, verify 320 and 200% text scale. Virtualise every list. No blur, no gradients, no
shadow-heavy surfaces, no list-item animation. Skeletons, not spinners. Server-provided
thumbnails and voice-note durations — **decode nothing to render a list**.

## 10. Accessibility

44×44 targets · labelled icons · unread counts in accessible names · 200% text scaling without
clipping · `prefers-reduced-motion` collapses all motion · no status by colour alone, ever.

## 11. Edge cases worth building for from day one

Owner changes mid-conversation · a topic reopens after resolution · a contact loses
`can_message` (composer becomes one explanatory line, history stays) · session expires mid-draft
(**the draft survives**) · emoji-only messages · 4000-character messages · 20 rapid messages
(`[BE]` batches the acknowledgement) · a class starting now outranking every other Home card.

## 12. What to send back to me

If you hit a UX question this pack does not answer, that is a gap in my work, not a decision for
you to make. Write it down and raise it — a `docs/design/questions-mobile.md` is fine. I would
rather add a paragraph than have two apps that disagree.
