# Uncommitted work rescued during Phase 0

Files in this directory were found **uncommitted** in agent worktrees when the
repository was frozen on 2026-09-07 (see `../../PHASE-0-BRANCH-LEDGER.md`,
section "Uncommitted work"). They are preserved here as evidence and as input to
later phases. **Nothing in this directory is applied, compiled or executed.**

| File | Found in | Owner | Disposition |
|---|---|---|---|
| `ai4-20260906130000_chat_rbac_canonical_roles.sql` | worktree of `ai4/rbac-canonicalization` | AI #4 | Input to Phase 1 role migration. Competes with `ee0dcdd` on `integration/prd-reconciliation`; both are superseded by `docs/architecture/AUTHORIZATION-MODEL.md`. |
| `ai7-config.controller.ts` | worktree of `feat/ai7-runtime-fixes` | AI #7 | `GET /config` (staff-only). Deferred: specified in `docs/contracts/API-CONTRACT.md`, not implemented in Phase 0. |
| `ai3-signed_out_startup_test.dart` | detached worktree at `148b7a2` | AI #3 | Superseded by `test/app/startup_routing_test.dart` (committed in Phase 0), which covers the same regression more completely. |
| `ai10-od01-worktree-fixtures.diff` | worktree of `integration/od-01-reconciliation` | AI #10 | Applied in Phase 0 on top of the OD-01 cherry-pick (family-scoped fixtures for `schema-invariants.spec.ts`). Kept for provenance. |
| `ai10-od01-schema_acceptance.sql` | same | AI #10 | The OD-01 variant of `db/tests/schema_acceptance.sql` (asserts `chat.thread` and `chat.support_case` are absent). Applied in Phase 0. |
