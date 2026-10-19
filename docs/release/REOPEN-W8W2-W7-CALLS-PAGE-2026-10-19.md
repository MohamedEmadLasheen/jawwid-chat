# Reopen record: the Calls page (W8-W2 Calls tab + W7 entry points), 2026-10-19

**State: REOPENED BY EXPLICIT AUTHORIZATION.**

The product owner authorized this reopen on 2026-10-19 with "Authorize reopen
(Recommended)" in AskUserQuestion. The full request was the WhatsApp-style
Calls page for Admin, Parent and Teacher.

This is **not closed**. Closure needs the owner's explicit CLOSED. The product
decision behind this work is PD-13 (`docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md`
§4), and the backend contract is `docs/communication/scheduled-calls.md`.

| Workstream | Previous CLOSED SHA | Reopened for |
|---|---|---|
| W8-W2: account call history, Calls tab | `3719b14` (`claude/voice-calls-production-76022c`) | The Calls tab presentation, plus call direction on history rows |
| W7: user-facing call experience | `a91c690` (`claude/admin-portal-call-screen`) | Additive entry points only: `joinScheduled` on both call controllers, and a scheduled-call chat card |

## 1. Authorized scope, and nothing else

**In scope:**
- Replace the Calls tab screen with the Calls page.
- Add one additive `joinScheduled` entry point to each call controller (Flutter
  and Admin Web).
- Derive call direction (`initiatorId` compared with the viewer) on history
  rows.
- Register the new scheduled-call repository in the Flutter composition root.

**Out of scope and unchanged:**
- The call lifecycle (`CallService` start/accept/decline/end and the ring
  timeout).
- `GET /calls/history` and `GET /calls/history/:conversationId`.
- The call screens (`ActiveCallScreen`, `CallOverlay`) and `CallPresenter`.
- Media code, call cards derived from history (D2a), and the frozen W1–W6
  server code.
- Every existing controller method's behaviour.

## 2. What changed in the frozen files

| File | Change |
|---|---|
| `lib/features/calls/presentation/calls_screen.dart` (W8-W2) | Rewritten as the Calls page: search, four tiles, Upcoming, Favorites and Recent. It keeps the "not available" state, never shows an error as an empty list, and keeps pull-to-refresh. |
| `lib/features/calls/data/http_account_call_history.dart` (W8-W2) | Direction derived from `initiatorId`. It still fails closed, and the endpoint is unchanged. |
| `lib/core/data/repositories.dart` | Optional `CallHistoryEntry.direction` (enum `CallHistoryDirection`). |
| `lib/features/calls/application/call_controller.dart` (W7) | New additive `joinScheduled`. `started` ends in the same state `start()` reaches; `joined` uses the existing accept path or `_joinMedia`. It is never sent while a different conversation's call is ringing (no phantom call). |
| `lib/app/bootstrap.dart` (W3 composition root) | Additive registration of the scheduled-call repository for both the HTTP and the fake build. This is the same composition-root exception W8-W2 used. |
| `apps/admin-web/src/features/calls/callController.ts`, `callApi.ts` (W7) | New additive `joinScheduled`, with the same rules and the same no-phantom-call guard. |
| `lib/features/messages/presentation/message_bubble.dart`, `apps/admin-web/src/features/chat/ChatPage.tsx` | The scheduled-call card is appended to the existing card chain. |

Retired by PD-13: the Calls tab's "no new-call button" rule. A call still
starts only where `POST /calls` authorizes it, because every tile re-checks
capability and the server decides.

## 3. Closure evidence (2026-10-19, branch `claude/calls-page-pd13` on PR #56's head `3dbc7c0`)

| Evidence | Result |
|---|---|
| API integration: `scheduled-calls.spec.ts` (permissions, PD-2, PD-7, window, serialization, cancel, DB guards) | 18/18. Removing the join lock fails the concurrency test 3/3. |
| API unit project | 768/768 |
| API full integration project, own DB `:55915` | 1372 passed. Two failing suites hit `psql` ENOENT (pre-existing harness gap) and pass with a shim. One was a cross-suite truncate deadlock that passes alone. `role-capability-preflight` fails only under the shim, because the shim replaces the URL's role. |
| Live HTTP probe on a seeded QA stack (supervisor, parent, teacher, out-of-scope supervisor) | 18/18 |
| Admin Web (Vitest) + typecheck | 362/362, clean. Removing the phantom-call guard fails its test. |
| Flutter `flutter test` + `flutter analyze lib test` | 1313 passed, 18 env-gated skips, no analyzer issues |
| Real two-device audio through a scheduled call | **NOT RUN.** Needs LiveKit plus two real clients. Required before closure. |
