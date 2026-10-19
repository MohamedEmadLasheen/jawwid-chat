# Integration map — realtime chat across accounts (2026-10-14, round 3)

Worktree `jawwid-realtime-chat-accounts-386689`, branch `claude/jawwid-realtime-chat-accounts-386689`,
HEAD `09512c0` (= `main`), **nothing committed**. Every result below comes from throwaway clones and
disposable containers in the session scratchpad; no other worktree, branch or shared database was
modified.

## 1. Exact commits

| Role | Ref | Commit | Verified |
|---|---|---|---|
| Base of this worktree | `main` | `09512c0` | `git rev-parse` |
| Security remediation (RT-030, RT-009, membership authz) | on the target branch | `a360ed3` (parent `09512c0`) | — |
| Super-admin bootstrap | on the target branch | `2409983` (parent `09512c0`) | — |
| Both, merged | on the target branch | `b1f047a` | **byte-identical to this worktree's baseline copy on all 57 baseline paths**, including the 3 files where the two deltas overlap (`git diff b1f047a basecopy -- <57 paths>` is empty) |
| **Integration target** | `integration/admin-profile-2026-10-14` (local, not pushed) | **`f03b636`** | `git rev-parse` |
| PR #27 `fix/parent-account-hardening` (open) | `origin/fix/parent-account-hardening` | `a5e9842` (base `1c234d2`) | 9 commits not on `main` and not on the target |

Target history after the baselines: `8016af1` staff profile + remediation (merged `26ede98`),
`ba5b75d` / `51760da` avatar keys, `64c8ab1` Admin Portal redesign (merged `f8dd885`), `f03b636` docs.

## 2. Trial replay (round 3)

The task-only diff — baseline copy → this worktree, **128 files** — applied with `git apply --3way`
onto `f03b636` (clone `scratchpad/mergetest3`, branch `replay3` = `d17325a`).

| Result | Detail |
|---|---|
| Textual conflicts | 2, as in round 2: `apps/admin-web/src/app/AppRoutes.tsx` (home route), `AppShell.tsx` (the redesign moved the rail into `app/navigation.ts`) |
| Clean applies on files both sides edited | `messages.ts`, `capabilities.ts`, `authorization.service.ts`, `errors.ts`, `error-codes.md` — reviewed: the target adds staff-profile and ownership methods and capabilities; no caller of a signature this task changed (`canRead`, `canSend`, `canOpenDirect`, `canCall`) |
| Migration versions | no duplicate prefix. This task adds `20261014120000` (PD-7 — sorts BEFORE the target's last, `20261014130000_chat_avatar_key_format`), `20261014140000` (RT-031) and `20261014150000` (RT-032). On a database already at the target's head, PD-7 is therefore applied out of order; `scripts/db/apply.sh` applies by ledger, not by position, and that path is tested separately (§6) |
| Dependency manifests | identical (`package.json` / lock files for both apps); `schema.prisma` differs (the target's avatar fields) — the trial generates its own client |

### Navigation resolution (reviewed)

| Role | Lands on | Conversations destination |
|---|---|---|
| super_admin | `/admin/conversations` (the redesign's read-only inspection — unchanged) | — |
| manager, admin, coverage | **`/chat`** (this task's workspace on the real API) | a menu: **Chat** + **Inbox** |
| departments (finance, …) | `/tasks` (unchanged) | — |

`AppShell.tsx` is the redesign's, byte-for-byte. `navigation.ts` gains `chat` in `AREA_DESTINATION`,
`AREA_PATH`, `AREA_ICON`; the redesign's `Navigation.test.tsx` gets 2 expectation updates (landing
`/chat`; Conversations listed as a menu).

**Decided 2026-10-14 (owner): the legacy Inbox is not offered.** `capabilities.ts` adds
`UNLISTED_AREAS` / `navAreas()`; routes keep using `visibleAreas` (so `/inbox` still opens for old
links) while navigation uses `navAreas`. In the combined tree `navigation.ts` iterates `navAreas`, so
Conversations becomes a direct link to `/chat` for manager / admin / coverage; the redesign's
`Navigation.test.tsx` expectations follow (and a new test asserts no role is shown any `/inbox`
link, menus opened, and that `/inbox` still routes). Previously recorded: `features/inbox` calls `/inbox`, `/inbox/*` and
`/families/*`. **No such route exists on `main` or on the target** (no controller for either), so the
Inbox page cannot load against the real API on either branch; it is what the redesign shows today as
"Conversations". The resolution above keeps it reachable beside Chat. Options: (a) keep it (status
quo of the redesign); (b) **recommended** — remove `inbox` from the operator areas so Conversations is
a direct link to Chat, keeping the `/inbox` route for old links; (c) remove the feature. (b) and (c)
change the redesign's navigation and need your approval.

## 3. Semantic conflicts found only by running the combined tree

| # | Found by | What | Resolution |
|---|---|---|---|
| S1 | target's `security-regression-guard.spec.ts` (round 2) | migration version `20261014130000` collided with the target's avatar migration | RT-031 renamed to `20261014140000` in this worktree |
| S2 | target's `db-identity-boundary.spec.ts` (round 3) | it forbids `$queryRawUnsafe` anywhere in the API; this task's new `ConversationService.assertActorLive` used it (identifier from a closed set) | **fixed in this worktree**: one tagged statement per principal table; re-proven red/green (no `FOR SHARE` → 6 tests fail) |
| S3 | probe of a database built from the target's history alone | **a defect on the target**: `chat.caller_is_server_side()` calls `chat.invoking_role()`, which the target grants only to `authenticated` — so a `service_role` session gets *permission denied* instead of a decision, inside every guard that asks | this task's migration adds `grant execute on function chat.invoking_role() to service_role` (additive; the function bodies stay byte-identical to the target's). It changes behaviour on the target's history and is listed for approval |
| S4 | test environment only | a fresh database's `chat_app` has no password; the target's staff-profile suites log in as it | set on the disposable database; not a product change |

## 4. RT-032 against the target's deactivation writers

The target's only deactivation writers are `chat.deactivate_staff()` and `chat.offboard_staff()`
(server-side SQL, super admin; no runtime caller). On the combined tree they work **unchanged** and
are journaled for the completion barrier (`rt032-revocation-journal.spec.ts`, "staff-profile
history" — it runs only there). Request roles there hold no UPDATE on `chat.staff` at all (the
target's column grants); where a request role can still write a principal row the gate refuses
taking it out of service (the test discovers the path per history). `chat.invoking_role()` and
`chat.caller_is_server_side()` are byte-identical to the target's (source text and `prosrc` hash).
No change to the target's files is needed for RT-032 beyond S3.

## 5. PR #27 — integrated exactly once

Of PR #27's 9 commits, this task contains exactly one piece: `SocketIoRealtimeSocket.originOf` and
`test/core/realtime/realtime_socket_origin_test.dart` from `4bca902`, **byte-identical** to
`a5e9842`. The combined tree has one `originOf` definition. PR #27's auth change — `67fe1e5`,
migration `20260929120000_chat_app_runtime_grants` (grants `chat_app` UPDATE on `chat.account`) — is
**not** in the combined tree: the target declined it as an escalation, and this task's RT-032 gate
would refuse a `chat_app` deactivation even if it landed. When PR #27 is merged, its `originOf` hunk
must be taken once (identical text), and `enableForceNew()` / the subscribe ack timeout beside it kept.

## 6. Combined-tree verification (trial clone `replay3` = `90ec29f`, isolated DB/Redis)

API typecheck clean · unit 635/635 · integration 54/54 suites, 1078 passed, 1 skipped (the
main-history-only offboarding test) · SQL suites schema_acceptance, br1_invariants,
relationship_predicate, story_rls, invariants, od01_conversation_model all pass · Admin Web 200/200,
typecheck clean, production build ok · `migtest32` on the target history 25/25 · out-of-order path
(database at the target head with data → this task's three migrations → rollback → re-forward)
17/17, with the target's `chat.deactivate_staff` journaled unchanged. The first combined run failed
3 tests (S2 and two over-specified gate tests); all three were fixed in this worktree and re-run.

## 7. Authoritative implementation per feature after integration

| Feature | Authoritative code |
|---|---|
| Socket origin | `SocketIoRealtimeSocket.originOf` (identical in PR #27 and here) + `enableForceNew()` (here only) |
| Fresh-session socket credentials | `bootstrap.dart` socket keyed on the account (here) |
| Authentication | `AuthService` from the security remediation (`a360ed3`); unchanged by this task |
| Admin Web login / API client | bootstrap (`2409983`); unchanged by this task |
| Admin Web realtime | `RealtimeProvider` (this task: default namespace + bearer `auth`) |
| Admin chat UI | `features/chat/*` (this task); the redesign's read-only `/admin/conversations` for super_admin stays |
| Routes / navigation | the redesign + the resolution in §2 |
| Error codes | union of both baselines + `STAFF_OUT_OF_SCOPE`; PD-7 re-activates `BR1_TEACHER_PARENT_DIRECT` |
| Authorization matrix | security remediation + bootstrap + staff profile (target) + this task (PD-7, staff scope, `canApprove` activity) |
| Deactivation | **the journal + `RevocationConfirmer` (this task)** for every writer, including the target's `deactivate_staff` / `offboard_staff` as they are |
| Server-side predicate | `chat.caller_is_server_side()` / `chat.invoking_role()` — the target's, unchanged; + the `service_role` grant (S3) |

## 7b. Round 4 additions (RT-037 / RT-038)

- New: `platform/{liveness,media-url,request-origin}.ts`, `communication/api/media.controller.ts`,
  `communication/calls/media-room-control.ts`; `ObjectStorage.read()` (local + S3); `StoryService.authorizeMediaRead`,
  `MessageService.authorizeAttachmentRead`; optional env `MEDIA_PUBLIC_BASE_URL` (manifest updated).
- **W5 (closed `2be26b8`) and W8-W1 (closed `814fda0`) code is touched** — `livekit-webhook.controller.ts`
  (`@Public()`, join-time ejection) and `notification.service.ts` (send-time liveness). Under the
  Critical Defect Reopen Protocol this needs the owner's explicit authorization before it lands; the
  previous CLOSED SHAs are recorded here, and those workstreams' suites (`call-media-presence`,
  `call-notifications`, `call-push-delivery`) are re-run in the final verification.
- No migration changes this round.

## 7c. Round 5 (owner decisions 2026-10-14)

- **W5 / W8-W1 reopened by explicit authorization** — record: `docs/release/REOPEN-W5-W8W1-2026-10-14.md`.
- **Staff profile photos (integration-only code):** `docs/communication/integration-patches/rt037-staff-profile-photos.patch`
  — applied in the trial on top of the replay; adds `StaffPhotoController` (`GET /media/staff/:id`, served by the
  shared `serveAuthorizedMedia`) and `StaffProfileService.authorizePhotoRead` (profile visibility, the reporting-manager
  card, the organization overview — re-decided per request); `sign()` now mints media links. Apply it AFTER the task
  replay at the integration step. Storage interface keeps both `read()` and `readHead()`.
- **Push privacy:** migration `20261014160000_chat_push_privacy_templates` (new generic template versions, older ones
  kept) + rollback; worker no longer stores sender / caller names.
- **RT-039:** local reference storage refused outside `local/test/ci`; media links are proxy-aware
  (`X-Forwarded-Host` only behind `TRUSTED_PROXY_HOPS`), `MEDIA_PUBLIC_BASE_URL` overrides.
- Migration order on the target: `…130000` (target) · `120000` (PD-7, applied out of order) · `140000` · `150000` · `160000`.

## 8. Not integrated, deliberately

The Admin Portal redesign, staff profiles and avatar work are separate work; they appear here only as
the trial target. `feat/account-avatar` was not merged or modified. No team- or reporting-line-based
conversation access was invented: the target's teams and reporting lines feed staff-profile
visibility only (`chat.current_staff_manages`, `current_staff_may_view`), not conversation access.
