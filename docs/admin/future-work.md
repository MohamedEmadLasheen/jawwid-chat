# Admin Web — Limitations, Debt and Future Work

## 1. The blocking limitation

**No backend exists.** This application is compiled, typechecked, unit-tested and
built, but it has never spoken to a real server. Every screen is written against
`backend-contract-required.md`, which is a **proposal awaiting AI #1 / AI #2
sign-off**, not an agreed contract.

Nothing here is powered by fake data — there is no mock server, no seeded
fixtures in production paths, and no local business logic standing in for the
backend. The consequence is honest but blunt: **no feature can be called done
until the API lands.** Feature completeness below means "UI and integration code
written and unit-tested", never "verified working".

## 2. Open contract questions (blocking, need AI #1 / AI #2)

| # | Question | Impact |
|---|---|---|
| Q1 | Base path and auth scheme (cookie session assumed) | Client is written for cookies; a bearer scheme is a small change, but it is a change |
| Q2 | Is `top_reason` localised server-side, or a code + params? **Recommend code + params** | It is the single most-read string in the product; server-side Arabic pins localisation in the backend |
| Q3 | Attachment upload: signed URL or through the API? | The composer accepts text only today |
| Q4 | One `/inbox` call per section (assumed) or all sections at once? | Five requests on inbox open |
| Q5 | Preset ↔ capability-flag mapping is unpublished (AI #5 §2) | Contact display shows flags, not preset semantics |

## 3. Not built, and why

### Approvals, calls, student groups
In the AI #4 role assignment; in **no** part of the product brief's data model or
MVP scope. Product decision of 2026-09-05: the brief governs the staff side.

Seams are reserved (nav registry, unregistered `/approvals` and `/calls` routes,
open message-kind union) so adding them is not a refactor.

**Watch this:** AI #3 **is** building student groups, approvals and calling for
mobile under its own product decision (`docs/mobile/decisions.md` D1). If those
entities land in the backend, the admin-side counterpart becomes real work and
should be scheduled deliberately rather than absorbed silently. This is the most
likely source of scope surprise on this project.

### Deferred within the brief's own scope
| Item | Status |
|---|---|
| Attachment upload in the composer | Text only; needs Q3 |
| Canned replies | Brief §8 lists them; needs a templates endpoint |
| "Reply + snooze" / "Reply + resolve" compound actions | Composer has plain send; the two-step path works |
| Shift-banner family selection | Snooze currently sends an empty selection, meaning "all waiting" |
| Settings screen (config weights, offboarding UI) | `configApi` and `staffApi.offboard` are wired; no screen yet |
| Audit log viewer | Endpoint specified, no screen |
| `GET /me/duty` surfacing of sticky threads | Fetched, not yet displayed |

## 4. Technical debt

1. **No list virtualisation.** Cursor pagination bounds what is fetched, but a
   long session in NOW accumulates DOM nodes. Add virtualisation when a real
   dataset shows it matters — not before.
2. **Reconnect invalidates everything.** Correct and safe; coarser than needed.
   A server-side event cursor would let us refetch only what changed.
3. **No optimistic updates anywhere.** A deliberate trade: correctness under
   concurrent edits over perceived speed. Revisit for the composer once real
   latency is known.
4. **Family list shows raw `owner_id` / `on_duty_id`.** Needs the staff roster
   joined client-side or names returned by the endpoint.
5. **No E2E tests.** Impossible without a backend. Playwright against a seeded
   API is the right next step and belongs to AI #5.
6. **No CI.** AI #5 owns it; `npm run build && npm test` is the gate.

## 5. Phase 2 — designed for, not built

Labels · broadcasts · saved views · bulk actions · exports · renewal funnel ·
historical workload trends · AI copilot (handoff summary first) · text-derived
attention signals · CSAT · advanced approval escalation.

The architecture supports these without entity changes: attention and workload
are server-computed and rendered as opaque values, so recalibrating weights after
60–90 days of `order-feedback` data requires **no frontend change at all**. That
is the single most important extensibility property of this design.

## 6. Recommended sequence once the backend lands

1. Wire `/auth/login` + `/me` and confirm the session end-to-end.
2. `GET /config` — assert no threshold is hardcoded anywhere.
3. `GET /inbox?section=now` — the workflow everything else hangs off.
4. `GET /families/:id` — confirm one call, no N+1.
5. Messages + send, then realtime.
6. Tasks → coverage → dashboard.
7. Then E2E and the RBAC assertions in `testing.md` §2.
