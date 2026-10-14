# Deactivation — one model for every writer (RT-032)

Status: implemented and verified on isolated databases, **uncommitted** in worktree
`jawwid-realtime-chat-accounts-386689` (2026-10-14). Migration
`supabase/migrations/20261014150000_chat_rt032_revocation_journal.sql`; rollback
`db/rollback/20261014150000_rt032.down.sql`.

## 1. Who writes deactivations today (inventory, with evidence)

"Deactivation" = an account, contact, staff member or teacher stops being *live* as
`IdentityService` / `AuthService` read it: `account.is_active and status = 'active'`,
`contact.is_active`, `staff|teacher.is_active and left_at is null` — or the row is deleted.

| Writer | Where | Can it deactivate? | Status before this change |
|---|---|---|---|
| The API at runtime | `apps/api/src` | **No.** No service writes `is_active=false`, `left_at`, `status` or deletes a principal (grep; the only principal write is `cli/super-admin-bootstrap.ts`, which creates an ACTIVE staff login) | — |
| `chat.offboard_staff()` on this branch (= `main`) | `20260905090700_chat_ownership_invariants.sql:209` | **Never commits.** It calls `chat.log_event` in a six-argument form that no longer exists and fails on every path (pinned by `rt032-revocation-journal.spec.ts`). Pre-existing; repaired on the staff-profile branch by `20261014090100_chat_ownership_event_logging_repair.sql` | no barrier |
| `chat.deactivate_staff()` / `chat.offboard_staff()` on `integration/admin-profile-2026-10-14` (`f03b636`) | `20261014110000_chat_ownership_policy_split.sql:271,318` | Yes — SECURITY INVOKER, executable by server-side roles only (EXECUTE revoked from `anon`, `authenticated`, `chat_app`); super admin only. **No runtime caller**: only Admin Web capability flags name them | no barrier |
| Jawwid Core sync | Core is read-only and never writes this database. The Chat-side consumer (`origin/claude/admiring-feynman-v3l4xh` @ `156b035`, unmerged, never deployed) only **activates** (`on conflict … set is_active = true`) | No | — |
| Workers / jobs | `apps/api/src/worker.ts` (outbox, story sweep, call sweep) | No | — |
| Request roles through RLS | `20260905091200_chat_rls.sql:53,85` — `grant update on chat.staff to authenticated` (manager policy), `insert, update on chat.contact` (admins) | **Yes, in principle** — no client uses it (Admin Web talks to the API), but a request session with a manager context could set `is_active=false` (reproduced) | no barrier |
| Operators / migrations / fixtures | psql, `20260910120000` (one-time backfill, not a transition), test suites | Yes | no barrier |

So every deactivation that can happen is a **database write**, and none of them could
wait for the API's completion barrier (`confirmRevoked`): that is RT-032.

## 2. The model

A deactivation is **two steps for every writer**, and is *complete* only after the second:

1. **COMMIT** — whoever writes it. The deactivating transaction also inserts a row into
   `chat.principal_revocation`: eight `ENABLE ALWAYS` `AFTER` row triggers (UPDATE that
   takes a live row out of service, DELETE of a live row; on `account`, `contact`,
   `staff`, `teacher`). The row exists iff the deactivation committed.
2. **CONFIRM** — an API node's `RevocationConfirmer`
   (`apps/api/src/communication/realtime/revocation-confirmer.service.ts`, started by the
   gateway, every 1 s) claims unconfirmed rows (`FOR UPDATE SKIP LOCKED` + a 30 s claim
   lease), pushes a disconnect for the login (cleanup), runs the RT-009 completion
   barrier, and only when it confirms stamps `confirmed_at` / `confirmed_by`. A barrier
   that does not confirm stamps nothing, records `last_error`, releases the claim; the
   row is retried. A timeout is never a confirmation.

**Guarantee:** no realtime event decided before a deactivation's commit is emitted after
its `confirmed_at`, on any node. Events decided after the commit read it and are refused.
This is exactly the guarantee API revocations already had (RT-009); RT-032 was that
database writers never reached step 2.

### Who may write step 1

Only a **server-side** writer: a superuser, a member of the `chat` table owner, or a
member of `service_role` — `chat.caller_is_server_side()`, decided from the *invoking*
role (`SET ROLE` or the session user), which a request connection cannot raise (it holds
no membership in either role; asserted by test). A request role (`anon`,
`authenticated`, `chat_app`) is refused with `RT-032: … use chat.deactivate_principal()`.
There is no GUC, flag or setting that opens this — unlike `chat.syncing_assignment`,
which any session can set.

`chat.invoking_role()` and `chat.caller_is_server_side()` are byte-identical to the
staff-profile branch's (`20261014110100`); on that history the migration replaces each
with itself. It adds one grant: `EXECUTE on chat.invoking_role()` to `service_role` —
without it a `service_role` writer fails inside the trigger (found by test).

### The operation

`chat.deactivate_principal(kind, id, reason, requested_by, status)` — server-side only —
writes the coupled columns correctly (`account.status/is_active/deactivated_at`;
`staff/teacher.left_at`; staff presence `offline`), labels the journal row (reason,
requested_by), and is **idempotent**: a repeat returns the latest revocation; a
principal already inactive with no journal row gets one (`already_inactive`), so a retry
is still answered by a barrier and never by a commit alone. `chat.guard_staff_deactivation`
still refuses a staff member who owns families.

The operator procedure waits for step 2:
`node dist/cli/deactivate-principal.js --kind contact --id <uuid> --reason "<why>" --target <host:port/db>`
— exit 0 = complete; **75 = saved, not yet complete** (re-run; idempotent); 2 = refused.

### What happens to each surface

| Surface | After the commit | After confirmation |
|---|---|---|
| REST / socket handshake | refused (live per-request lookup) | same |
| Realtime delivery | every NEW decision refused (reads committed state) | no stale decision can emit on any node |
| Existing sockets | swept within 15 s | disconnected at once (cleanup push); sweep remains |
| Pending outbox events | refused at delivery when published (tested) | same |
| Send / react / approve / call start / accept / media token | refused, **ordered**: each re-reads liveness under `FOR SHARE` on the login and principal rows inside its own transaction (`ConversationService.assertActorLive`), so it commits strictly before the deactivation or is refused | same |
| Push notifications already scheduled | dispatch re-reads the recipient's liveness (principal and login) at SEND time; an inactive recipient's notification is cancelled (`RECIPIENT_INACTIVE`), never retried or replayed after re-activation | still-scheduled ones are cancelled by the confirmer |
| A push already handed to APNs / FCM | **may still arrive** (provider queue; cannot be recalled) — but its text names nobody (generic templates, owner decision 2026-10-14) | same |
| Sessions | refresh refused (account/principal inactive); sessions are not rewritten (the trigger takes no extra locks — see §4) | same |
| Attachment / story media links already issued | **refused on the next request** — links point at the API's media route, which re-checks liveness and read rights on every request and streams the bytes itself (RT-037); no storage URL is ever handed out | same |
| A live call room the person is in (joined or holding a token) | still in it until confirmation | **removed** via LiveKit RoomService before the deactivation is stamped complete (unconfirmed while LiveKit refuses) |
| A re-join with a token issued earlier (or one LiveKit refreshed) | ejected on LiveKit's `participant_joined` webhook (503 → LiveKit retries if removal fails); LiveKit admits tokens ~60 s past `exp` | same |

## 3. What this does not cover (stated, not implied)

- **The schema owner / a superuser** can `DISABLE TRIGGER`, `TRUNCATE` (row triggers do
  not fire) or drop the objects. That is the trust root — the same as for every other
  guard.
- **Pushes already handed to APNs / FCM** before the commit (or in flight at it) can still be
  delivered from the provider's queue; no API can recall them (RT-037). Push bodies carry the
  sender's name and no message text (`preview` is empty).
- **RT-037 (OPEN pending external verification):** join-time ejection relies on LiveKit
  delivering `participant_joined` for a media-connected participant to the API — verified
  here with real signed payloads and a real LiveKit's own (non-media) deliveries, but not
  with a real WebRTC client; staging must configure the webhook URL and confirm it. Between
  such a re-join and the ejection the participant can receive media for the webhook round
  trip. Bytes already downloaded, and one response already streaming at the commit, cannot
  be recalled.
- **Other access reductions** made by direct SQL are not deactivations and are not
  journaled: a staff role change, `contact.can_message`, a membership ended in SQL, an
  `account_id` rebinding. Each is still enforced at delivery (RT-009 reads them), but
  without a barrier when written outside the API. Membership removal through the API
  already passes the barrier.
- `organization.is_active` is read by nothing in identity resolution; deactivating an
  organization grants or revokes nothing today.

## 4. Why the trigger does so little

It reads only catalogs and inserts one new row. It takes no lock on any `chat` row a
delivery locks (`conversation_member`, `session`, `account`, principals), so it adds no
deadlock edge to the delivery path; concurrent deactivations of one row serialize on
that row and the second finds nothing to change (one journal row, tested); a rolled-back
deactivation rolls back its journal row (tested). It is `ENABLE ALWAYS`, so
`session_replication_role = replica` does not silence it (tested). Revoking sessions
inside it would lock `session` after the principal row — the reverse of the delivery
order — and deadlock with deliveries, so it does not.

## 5. Production preflight (before applying 20261014150000)

1. `select version from chat.schema_migrations order by version desc limit 5` — the
   history this is applied on, and that `20261014140000` (or the target branch's last)
   is present.
2. The migration role can create a table, triggers on the four principal tables
   (requires owning them) and `ALTER TABLE … ENABLE ALWAYS TRIGGER`.
3. `select rolname from pg_roles where rolname in ('service_role','authenticated','anon','chat_app')`
   — all four exist (the migration's assertions name them).
4. Which role every real deactivation writer connects as is **server-side** (a member
   of `service_role` or of the table owner). Any writer that is not will be refused —
   list them first.
5. The API is deployed with this code **before or with** the migration: without
   `RevocationConfirmer` rows are journaled but never confirmed (fails closed: the CLI
   reports "not yet complete"; `/health/ready` reports `revocations: down` after 30 s).
6. Backup as usual; apply through `scripts/db/apply.sh`.

## 6. Evidence (isolated databases and processes; no production or staging evidence exists)

| What | Result |
|---|---|
| `rt032-revocation-journal.spec.ts` — gate per role and history, operation, writers, confirmer, CLI, write-path ordering, pending notifications | 35 passed + 1 skipped (the staff-profile-history test; it runs and passes on the combined tree, where the main-only one is skipped) |
| `realtime-revocation.spec.ts` RT-032 blocks — one node, two nodes, connection loss, transaction timeout, account suspension, the window itself, prompt disconnect, counters, outbox | 8 passed (suite total 61) |
| Mutations — each control removed in turn: barrier skipped by the confirmer (M1), live check without `FOR SHARE` (M2, re-run as M2' on the final code), send without the live check (M3), trigger journals nothing (M4), gate admits request roles (M5), dispatch liveness always true (N1), no cancellation on confirm (N2) | every mutant caught -- failing tests: M1 4+5, M2 6 (M2' 6), M3 2, M4 7+7, M5 2, N1 2, N2 1; restores checksum-verified; green after |
| Migration — this branch's history (`migtest32`) / the target's history / the target's head with data, then this task's migrations out of order, rollback, re-forward (`migtest-ooo`) | 25/25 · 25/25 · 17/17 |
| Live QA stack (real API + worker, real logins and sockets) — operator CLI probe | 11/11: complete in ~1.1 s via the running API's barrier, socket disconnected at once, retry idempotent, API down ⇒ exit 75 (never a false success), confirmed after restart |
| Live session probe (incl. direct-SQL deactivation with a live socket, Redis and Postgres outages) | 30/30 |
