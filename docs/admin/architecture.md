# Admin Web — Architecture

Owner: AI #4 · App: `apps/admin-web` · Stack: React 18 · TypeScript 5.7 · Vite 6

## 1. What this application is

An operational workspace for Jawwid's CS supervisors and manager. Not a CRM.
The whole design answers one question fast: **"what needs me right now?"** —
and then lets the operator act without leaving the family.

Primary flow: `INBOX → FAMILY CONTEXT → THREAD → ACTION → FOLLOW-UP → RESOLUTION`.

## 2. The rule that shapes every decision

The client owns **no** business truth. `on_duty(family, now)`, `attention(family)`
and `workload(admin, now)` are backend functions whose constants live in the
`config` table (brief §4, §6, §7, §12). This application:

- renders `bucket` + `top_reason` **text**, never a score, never P1/P2/P3;
- renders `workload_score` / `workload_level`, never recomputes them;
- never re-sorts a server-ordered list;
- never chooses `on_behalf_mode` on a message;
- never decides who handles a family.

When a realtime event arrives carrying a new bucket, we **invalidate and
refetch** rather than patch the payload into the cache. That is deliberate: a
patch would make the client a second, divergent source of computed truth, and it
is also what makes concurrent edits reconcile to the server instead of to
whichever browser tab wrote last. `src/core/realtime/realtime.test.tsx` asserts
the cache is *not* patched.

## 3. Layout

```
src/
  app/        App, providers, router, shell, role-gated routes
  core/
    api/      http client, typed endpoints, query keys, error model
    auth/     session + duty state
    realtime/ Socket.IO client, event→invalidation map
    i18n/     ar/en catalogue, RTL, Intl formatters
    permissions/  UX-only, coarse, role-level affordances
    theme/    design tokens + stylesheet
  features/
    inbox/    sections, rows, shift-end banner, away summary, calibration
    family/   workspace, thread, composer, Family 360, cases, actions, transfer
    tasks/    list + creation
    coverage/ shifts, rules, absences, gaps
    dashboard/ manager metrics with drill-down
    auth/     login
  shared/     components, hooks, domain types
```

## 4. State management

Three separated concerns, not one global store:

| Concern | Mechanism | Why |
|---|---|---|
| Server state | TanStack Query | Caching, cursor pagination, and one invalidation surface that realtime can drive |
| Session | `SessionProvider` over a `me` query | Role and duty are server facts, not client state |
| Local UI | component `useState` | Selected section, active case, composer draft — nothing that outlives a view |

Query keys are centralised in `src/core/api/queryKeys.ts` so every key is
derivable from a realtime event payload without guessing.

## 5. API integration

`src/core/api/client.ts`. Cookie session (`credentials: 'include'`) — no token is
held in JavaScript. Every mutation carries an `Idempotency-Key`, so a retried or
double-clicked write cannot create two records.

Errors become `ApiError` with **both** `message_en` and `message_ar`, so the UI
shows the operator a sentence in her own language and never a stack trace. A 401
clears the entire query cache once, so a signed-out operator cannot read a
previous role's data out of the cache. 4xx responses are never retried — retrying
a 403 is precisely the "fallback access attempt" the role brief forbids.

## 6. Realtime

Socket.IO (matching AI #2's `@nestjs/platform-socket.io`), namespace `/staff`,
authenticated on handshake. **The server chooses the rooms.** The client never
subscribes itself to a family, so an admin cannot listen to traffic she may not
read.

On reconnect every operational query is invalidated, because a gap in the event
stream is indistinguishable from nothing having happened.

## 7. Permissions

`src/core/permissions/capabilities.ts` answers only **coarse, role-level**
questions used for navigation. It is UX, not security, and the file says so.

Per-family decisions are *not* made here — they arrive from the server in
`FamilyDetail.capabilities`, because only the server can evaluate
`on_duty(family, now)`, stickiness, assist eligibility and `owner_locked`. The
UI uses them to disable a control **with an honest reason** rather than let the
operator type a reply and discover a 403.

Roles: `admin · coverage · manager · finance · technical · academic · system`.
There is no `super_admin`. `coverage` has the same areas as `admin` — it is a
label, and its restrictions come from §5 handling rules, not from the role.

## 8. Inbox architecture

One query per section (`now`, `today`, `covering`, `waiting_family`, `quiet`),
cursor-paginated, ordered by the server. "Covering" is a separate section on
purpose: an operator must be able to tell at a glance whether she holds a family
because she owns it or because she is covering it.

Also implemented from brief §4 and §6, and easy to miss:

- **End-of-shift banner** with snooze-to-next-shift.
- **"What happened while you were away"** — the owner's morning handoff digest.
- **"This order is wrong"** — MVP-required calibration logging that produces the
  data used to replace the initial attention weights after 60–90 days.

## 9. Family workspace

One continuous thread per family (`thread.family_id` is UNIQUE). Cases are
layered on it; selecting a case **filters** the thread and never opens a second
one.

Three entry kinds are rendered so they cannot be confused: customer message,
system event card, and internal note. The internal note differs by colour, border
style, a leading rule **and** an explicit label — colour alone would fail in
greyscale and for colour-blind operators, and the cost of that confusion is an
internal note reaching a parent.

Owner and on-duty are always shown as two separate lines, because conflating them
is how a coverage reply becomes an accidental ownership change in someone's head.

## 10. Dashboard architecture

Every tile is a link into the list it summarises (role brief §78). Metrics come
from backend aggregates; nothing is computed client-side from partial data.

## 11. Accessibility and RTL

- Layout uses CSS **logical properties** throughout, so Arabic is a real mirror
  rather than a set of overrides.
- Attention states carry colour **plus** shape **plus** text.
- Dialogs trap and restore focus, close on Escape, and deliberately do **not**
  close on backdrop click — a stray click must not discard a typed reason.
- Enter sends, Shift+Enter is a newline.

## 12. Performance

Cursor pagination everywhere, debounced search, server-side filtering, no
polling where realtime exists. Production bundle: ~320 kB raw / ~97 kB gzipped.

## 13. Reserved seams

Approvals, calls and student groups are **not built** — they appear in the AI #4
role assignment but in no part of the product brief. Seams exist so adding them
is not a refactor: the nav is a data-driven registry, routes `/approvals` and
`/calls` are reserved and unregistered, and the message/timeline model is a
discriminated union open to new kinds. See `backend-contract-required.md` §10.
