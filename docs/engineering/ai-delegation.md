# AI delegation workflow: Claude leads, Codex implements and reviews

The owner talks to one agent: the Claude engineering lead. The lead plans the work, runs some of it,
delegates bounded pieces to Claude builder sessions or to the Codex CLI, verifies everything
independently, and delivers one result. Shared repository rules are in `/AGENTS.md`.

## 1. Lifecycle (every request)
1. **Receive** the request and restate the outcome in one line.
2. **Inspect** only what the task touches: the relevant files, `AGENTS.md`, open PRs on the same area.
   Do not rescan the whole repository.
3. **Classify risk** (section 3). High risk stops at an owner gate before implementation.
4. **Resolve open decisions.** If a business or architecture decision is genuinely unresolved, interview
   the owner (the `grill-with-docs` skill if installed, otherwise short direct questions) and record the
   answer. Ordinary engineering choices are the lead's: decide, record the assumption, continue.
5. **Specify**: write the spec or plan, then split it into tasks that do not touch the same files.
6. **Route** each task (section 2) and write its brief from `tools/codex-delegate/templates/task-brief.md`.
7. **Execute in parallel where safe**: each agent has its own worktree and branch. Never two agents in
   one tree.
8. **Collect** results: Codex runs write `result.json`; builder sessions report by message.
9. **Verify**: the wrapper re-runs the tests for Codex work; the lead runs the wider suites on the
   integrated branch (respecting the machine-load rule).
10. **Review** every diff (section 4).
11. **Correct**: failures go back to the same agent with concrete feedback, **at most 3 attempts per
    task**. After the third failure the lead takes the task over or escalates.
12. **Integrate** on one branch, push it as `claude/...`, open a pull request with `gh pr create`.
13. **Merge** only when the autonomous-merge conditions hold and the change is not high risk.
    Otherwise the PR waits for the owner.
14. **Report** to the owner: what shipped, the PR links, what was verified (only checks actually run),
    and anything waiting on them.

## 2. Routing: who does what
Codex usage is limited (ChatGPT Go); Claude capacity is larger (Max 20x). Use Codex where it adds the most.

| Work | Owner |
|---|---|
| Requirements, architecture, plans, splitting work, cross-cutting refactors | Claude lead |
| Anything touching authorization, money, migrations, realtime, calls | Claude builder (Codex may review) |
| Well-specified, self-contained implementation with clear tests (a bug fix with a repro, a small endpoint, a UI string set, test hardening) | **Codex** |
| Independent second review of a risky PR (auth, money, migrations, concurrency) | **Codex review** plus Claude's own review |
| Codex unavailable, out of usage, or failed 3 times | Claude |

Rule of thumb: delegate to Codex when the brief can state the acceptance test exactly and the
allowed paths fit in a few globs. Do not delegate when the task needs conversation context, judgment
across many modules, or owner decisions.

## 3. Risk levels and approval gates
| Level | Examples | Gate |
|---|---|---|
| Low | Tests, docs, copy, isolated UI, a pure function | Lead merges when checks pass |
| Medium | API behaviour, a new endpoint, a non-destructive additive migration, a dependency added | Lead merges after its own review plus checks; Codex review recommended |
| High | Authorization, payments and refunds, data deletion or rewrite, destructive migrations, auth/session, infrastructure, CI/protections, Quran or lesson content | **Owner approval before implementation and before merge.** Never auto-merged. The wrapper refuses `--risk high` without `--owner-approval "<owner's words>"`. |

Always owner-only: production deploys, production migrations, Jawwid Core, Code Owner approvals,
changes to protections or paid resources.

## 4. Review standard (important changes)
- Read the complete diff, not a summary.
- Tests exist for the new behaviour and for the risky negatives (who must be refused).
- Migrations: idempotent where the repo expects it, row-level security correct, rollback path, slot claimed.
- Authorization boundaries, API compatibility (additive changes only unless agreed), regressions.
- Arabic and English behaviour when user-facing.
- For high-risk diffs, add an independent Codex review: `codex-delegate review` (section 5). Compare it with
  the lead's own findings; disagreements are resolved by reading the code, not by vote.

## 5. The Codex wrapper: `codex-delegate`
All Codex use goes through `codex-delegate`, the user-level engine installed from `tools/codex-delegate/`
(see its `README.md` and `SECURITY.md`; `scripts/ai/codex-task.sh` runs the same engine from this checkout).
It works in any repository; this repository's extra rules are in `/.ai-delegation.json`. It never pushes,
merges or deploys.

```bash
# Implement (creates ~/jawwid-ai-worktrees/<repo>/<id> on branch claude/codex-<id> from origin/main)
codex-delegate run --task-id fix-x --brief /path/brief.md \
  --allow 'apps/api/src/foo/*' --allow 'apps/api/test/foo/*' \
  --prepare 'cd apps/api && npm ci' \
  --test 'cd apps/api && npx jest --maxWorkers=2 test/foo'

# Send review feedback back to the same worktree (counts toward the 3-attempt limit)
codex-delegate retry --task-id fix-x --feedback /path/feedback.md

# Independent read-only review of any clean checkout at the head commit
codex-delegate review --task-id review-pr-123 --repo /path/clean-clone --base <sha> --head <sha>

codex-delegate status --task-id fix-x
codex-delegate list
codex-delegate cleanup --task-id fix-x [--delete-merged-branch]
```

What `run` does, in order:
1. Refuses an existing task id or worktree, and holds a lock so only one agent works on the tree.
2. Creates the worktree and branch from the verified base, and copies the brief into the run directory.
3. Runs `--prepare` commands **outside** the sandbox (dependency installs may need the network). Only
   lockfile installs are accepted: `[cd <path> && ] npm ci [--flags]` or `flutter pub get`. No pipes or downloads.
4. Runs Codex with `-s workspace-write` inside the worktree only, `-a never`, `--ignore-user-config`
   (no personal plugins or hooks), a per-attempt timeout, and a JSON output schema for the report.
5. **Scope check:** any change outside `--allow` globs, or inside a protected path (`.github/`, Code
   Owner paths, instruction files at any depth, hooks, env and key files, the delegation tooling, and migrations
   unless `--allow-migrations`), is saved as a patch for evidence and reverted.
6. **Secret scan** of the candidate diff (provider tokens, private keys, JWTs, credentials inside URLs,
   `*PASSWORD=`/`*TOKEN=`-style assignments). A suspected credential blocks the commit; values are masked
   in the report. It is a safety net, not a guarantee: the lead still reads every diff.
7. **Independent verification:** the wrapper re-runs every `--test` command itself, inside the Codex
   sandbox (worktree-only writes, no network unless `--test-network`), honouring the machine-load rule.
   Files the agent created in git-ignored paths are deleted first.
8. **Commit** on the task branch with `Task-Id`, `Attempt`, `Delegated-Agent` and `Verified-By` trailers.
9. On any failure it writes concrete feedback and retries automatically, up to `--max-attempts` (max 3).
   Usage-limit or authentication errors stop immediately with status `blocked`.
10. Writes `result.json`.

| Status | Meaning | Lead's next action |
| --- | --- | --- |
| `passed` | Changes were committed and Codex reports the task complete. | Review the result and continue. |
| `partial` | Changes were committed, but Codex reports unfinished items. | Read the outstanding problems and finish or re-scope the work. |
| `failed` | The allowed attempts were exhausted without a successful result. | Read the feedback and take the task or re-scope it. |
| `blocked` | Codex could not run because of an auth or usage limit; no retry. | Fall back to a Claude builder; resolve login if needed. |
| `needs_feedback` | Auto-retry is off after a failed attempt. | Read the feedback and retry or re-scope the task. |

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Successful run (`passed`) or review. |
| 1 | Run did not pass (`partial`, `failed` or `needs_feedback`), or review failed. |
| 2 | Invalid invocation or precondition; the wrapper reported an error. |
| 3 | Run or review was blocked, including an authentication or usage limit. |

`result.json` carries: task id, status, attempts, branch, worktree, base and commit SHAs, Codex's own
report (completion, summary, files, the tests it says it ran, outstanding problems), the tests the
wrapper re-ran with their real exit codes, and any scope or secret findings.

Files live outside every repository: run data in `~/.jawwid-ai/runs/<repo>/<id>/` (kept after cleanup),
worktrees in `~/jawwid-ai-worktrees/<repo>/<id>/`. macOS purges `/tmp` after a few days, so nothing durable
goes there.

## 6. Failure handling
- **Codex cannot start** (missing binary, unknown flag): fix the invocation in the wrapper. The flags were
  checked against `codex --help` for codex-cli 0.166.0; re-check after a Codex upgrade.
- **Usage limit or login expired:** status `blocked`. Fall back to a Claude builder; the owner is told only
  if they must log in again.
- **Git inside the sandbox:** Apple's git shim writes to the temp directory, which the read-only sandbox
  blocks. The wrapper redirects `TMPDIR` into the run directory and adds it as writable. Implementers are
  told not to use git; reviewers get the diff as a file.
- **Three failed attempts:** the lead reads the run directory, then takes the task or re-scopes it.
- **Never** disable a check, widen `--allow` to swallow a scope violation, or force-remove a dirty worktree.
  `cleanup` refuses dirty trees.

## 7. Owner-facing behaviour
The owner is never asked to move text between agents or to approve ordinary engineering decisions.
They are asked only at the gates in section 3, and every update ends with a short "waiting on you" list.
