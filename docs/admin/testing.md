# Admin Web — Testing Notes for AI #5

App: `apps/admin-web` · `npm test` (Vitest + Testing Library, jsdom)
**Current: 74 tests, 11 files, all passing.** Typecheck and production build clean.

## 1. What the existing tests already cover

| Area | File | Guarantees |
|---|---|---|
| Role → navigation | `core/permissions/capabilities.test.ts` | No `super_admin`; departments get tasks only; coverage ≡ admin areas; manager-only actions |
| Error model | `core/api/errors.test.ts` | ar/en messages, 403/409 classification, no stack traces |
| HTTP client | `core/api/client.test.ts` | Cookie auth, idempotency keys, 401 → cache clear, 204, empty-param stripping |
| Realtime | `core/realtime/realtime.test.tsx` | Events **invalidate**, never patch computed state; coverage change also refreshes duty + inbox |
| i18n / RTL | `core/i18n/i18n.test.tsx` | Real RTL, key parity ar↔en, no untranslated strings, no digits in bucket labels |
| Inbox row | `features/inbox/InboxRowItem.test.tsx` | No score / no P1-P3 / no phone number; coverage labelled; bucket not colour-only |
| Thread | `features/family/Thread.test.tsx` | Internal notes distinct; coverage/assist labelled |
| Composer | `features/family/Composer.test.tsx` | Never sends `on_behalf_mode`; off-duty falls back to internal note; no double-submit; Enter/Shift+Enter |
| Cases | `features/family/CaseCards.test.tsx` | `owner_locked` shows reason instead of a close button |
| Ownership | `features/family/FamilyActions.test.tsx` | Manager-only **and** server-gated; reason required; Escape cancels |
| States | `shared/components/States.test.tsx` | 403 offers no retry; Arabic errors; empty states reassure |

Fixtures use synthetic staff (`Admin A`, `staff_a`) only — **no real employee
names**, per `docs/qa/system-inventory.md` §4 / gate G-16.

## 2. What AI #5 must test that this suite cannot

These are the ones that matter, because **the frontend is not a security
boundary** and none of the above proves anything about the server.

### RBAC — assert against the API, not the UI
Every DENY in `docs/qa/rbac-matrix.md` must be proven by direct API call with a
**valid session for that role**. A hidden button proves nothing. Specifically:

- `admin` (not on duty) sending a customer message → 403, empty body.
- `coverage` closing an `owner_locked` case → 403.
- `admin` / `coverage` calling `POST /families/:id/transfer-ownership` → 403.
- `finance` / `technical` / `academic` calling `GET /families/:id` → 403.
- Any role writing an attention score, bucket or workload value → 403 (no such
  endpoint should exist at all).

### Scope
- Family scope: an admin fetching a family she neither owns nor covers.
- Coverage scope: assert by **moving the fixture clock**, not by editing
  assignment state — there is no assignment state to edit.
- Realtime scope: connect as admin A and assert **no** event for a family only
  admin B may see. The client never chooses its rooms, so this is entirely a
  server guarantee.

### Concurrency
- Two operators resolving the same case: one wins, the other gets 409 and the UI
  reconciles to server truth.
- Two managers transferring the same family: exactly one `audit_log` row.
- Confirm no duplicate message is created when the same `Idempotency-Key` is
  replayed.

### Invariants (brief §12)
- A family is in exactly one inbox, or in Unattended. Never two, never zero.
- `thread.family_id` is UNIQUE; no flow creates a second thread.
- Every staff message has `on_behalf_mode`.
- `owner_id` changed only via `transfer_ownership()`, audit written in the same
  transaction.

### Privacy
- Grep every admin API response for phone-shaped strings.
- Assert no `visibility=internal` message is reachable through any family-side
  endpoint.

## 3. Browser and environment

Desktop-first: verify at **1280px and 1440px**. The Family 360 panel is hidden
below 1180px and the rail collapses below 900px — both are intentional, not
breakage. Chromium and Firefox current; Safari 17+.

## 4. Arabic / RTL checklist

Arabic is the default locale. Check with **real Arabic family names**: tables,
dialogs, dropdowns, the composer, mixed Arabic/English message bodies, dates,
times and numbers. Confirm the layout is genuinely mirrored — logical properties
are used throughout, so a physical-property regression will show up as a panel on
the wrong side.

## 5. Performance-sensitive screens

`GET /inbox` (per section), `GET /families/:id` (single call, no N+1),
`GET /families/:id/messages`. Long lists are cursor-paginated but **not yet
virtualised** — see limitations.

## 6. Blocking

**Every screen is currently unverifiable end-to-end: no backend exists.** All of
the above becomes runnable only once AI #1 and AI #2 implement
`docs/admin/backend-contract-required.md`. Until then this app compiles, tests
and builds, but has never exchanged a byte with a real server.
