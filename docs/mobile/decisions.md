# Mobile Decisions Record (AI #3)

## D1 — Scope: the AI #3 role assignment is authoritative for the mobile client
**Date:** 2026-09-05 · **Decided by:** product owner · **Status:** accepted

`docs/mobile/discovery-report.md` §4 documented a conflict between the project brief
(a staff-facing CS console with no teacher role, no student groups, no approvals and no
calling) and the AI #3 role assignment (a parent + teacher messenger built largely from those
features). The decision is:

> The project brief governs the **staff** side. The AI #3 role assignment governs the
> **family/teacher** side. Build the parent + teacher Flutter application as assigned.

Consequences:
- Student Groups, message approvals, voice notes, and 1:1 / group calling are **in scope** for
  mobile even though they are absent from the brief's data model.
- These features imply backend entities that do not exist in the brief's §3 data model.
  Every one of them is recorded in `docs/mobile/backend-dependencies.md` as a **request** to
  AI #1 / AI #2, not as an assumption.
- The brief's staff-side invariants are **not** contradicted by this decision and are still
  respected where they touch mobile (see D3).

## D2 — Toolchain: Flutter stable 3.47.2 / Dart 3.13.2
**Date:** 2026-09-05 · **Decided by:** product owner · **Status:** accepted

The machine had no Flutter or Dart SDK. Flutter stable was installed to `~/development/flutter`
so that all delivered code is compiled, analysed and tested rather than shipped unverified.
The version is pinned in the repository so every agent and CI runner builds identically.

## D3 — The client owns no business truth
**Date:** 2026-09-05 · **Status:** accepted (derived from the brief's §12 checklist)

The brief's non-negotiables are backend-enforced, but two of them constrain mobile directly:

- *"Attention and workload are computed, never user-entered"* → the app renders
  `top_reason` text supplied by the backend and **never** computes or displays a score,
  a bucket number, or an internal label.
- *"No code path assigns a message/family to a staff member other than via on_duty()"* → the
  app never chooses or displays a handler of its own accord; the "Handled by …" label is
  whatever the backend reports for the family thread.

Hardcoding staff names, schedules, class times, or payment/subscription state is prohibited.

## D4 — Backend integration is behind a data-source seam, with a fake for development
**Date:** 2026-09-05 · **Status:** accepted

No AI #1 or AI #2 contract exists yet, and role-assignment §57/§58/§80 forbid inventing a
backend protocol. Rather than block all mobile work on that, the client is built against
**repository interfaces**. Two implementations exist:

1. a **fake, in-memory** implementation used by tests and local development, and
2. an **HTTP/WebSocket** implementation written against the contract proposed in
   `docs/mobile/backend-dependencies.md`.

The proposed contract is explicitly a **request awaiting AI #1 / AI #2 sign-off** — it is not
treated as agreed, and it is not a second source of truth. When the real contract lands, only
the HTTP implementation changes; UI, state, and tests do not.
