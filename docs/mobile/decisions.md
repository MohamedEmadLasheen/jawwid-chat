# Mobile Decisions Record (AI #3)

## D1 — Scope: build the parent and teacher apps in full
**Date:** 2026-09-05 · **Decided by:** product owner · **Status:** accepted, then confirmed
by the governing scope document

`docs/mobile/discovery-report.md` §4 escalated a conflict between the PDF brief (a staff-only
CS console with no teacher role, no student groups, no approvals and no calling) and the AI #3
role assignment (a parent + teacher messenger built largely from those features).

The product owner ruled: **build the parent and teacher apps as assigned.**

`docs/qa/authoritative-scope.md` (GOVERNING, AI #5) then settled the underlying question:
**the PDF brief is superseded** by Jawwid Chat PRD v0.1, and the authoritative MVP scope
explicitly includes the parent mobile app, the teacher mobile app, Student Groups, the message
approval workflow, push notifications, and 1:1 and group voice calling. So the decision here
and the governing document agree; the PDF was simply the wrong source.

Consequences:
- Student Groups, approvals, voice notes and calling are in scope.
- The brief's staff-side invariants still constrain mobile where they touch it (see D3), and
  BR-1 — no teacher ↔ parent direct messaging or calling — is unchanged and absolute.
- `docs/mobile/backend-dependencies.md` recorded these as requests to AI #1 / AI #2. Most are
  now satisfied by `apps/api/src/communication/contracts/`; that file records which remain.

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
**Date:** 2026-09-05 · **Status:** accepted; the contract has since been published

No AI #1 or AI #2 contract exists yet, and role-assignment §57/§58/§80 forbid inventing a
backend protocol. Rather than block all mobile work on that, the client is built against
**repository interfaces**. Two implementations exist:

1. a **fake, in-memory** implementation used by tests and local development, and
2. an **HTTP/WebSocket** implementation written against the contract proposed in
   `docs/mobile/backend-dependencies.md`.

The proposed contract was explicitly a **request awaiting AI #1 / AI #2 sign-off**. AI #2 has
since published the real one at `apps/api/src/communication/contracts/`, and
`lib/core/data/wire/` maps it into the domain models. The seam did its job: adopting the real
contract changed the mapping layer only — no UI, controller, or domain test changed.

## D5 — Retry is explicit, and a refusal is never retried
**Date:** 2026-09-05 · **Status:** accepted

Riverpod 3 retries every failed provider by default. Left alone that would re-attempt a BR-1
refusal, a validation failure, and a revoked session forever — burning battery and data on
exactly the low-end devices and slow networks this audience uses, and directly contradicting
the instruction not to retry a backend refusal.

`lib/app/retry_policy.dart` retries only failures classified as transient (network, timeout,
rate limit, 5xx), with capped exponential backoff and an attempt ceiling. Everything else is
terminal. The same rule governs the message outbox.
