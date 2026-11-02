---
name: ai-delegation
description: Lead multi-agent engineering in any Git repository on this Mac. Decide per task whether to do it yourself, use Claude subagents, delegate a bounded implementation to the Codex CLI, or get an independent Codex review, then verify and integrate everything yourself. Use for any development task with a separable, well-specified piece, or when a risky diff needs a second reviewer.
---

# AI delegation (Claude leads, Codex helps)

You stay responsible for planning, decomposition, review, integration and final quality. The owner talks
only to you and never moves text, code or reports between agents. Project `CLAUDE.md` / `AGENTS.md`
rules always win over this skill.

The command is `~/.local/bin/codex-delegate`. Use the full path from the Bash tool: that directory is on the
login shell's PATH but may not be on the tool shell's. Run it from inside the target repository, or pass
`--repo <dir>`.

## 1. Route each piece
| Piece | Who |
|---|---|
| Needs conversation context, judgment across modules, product/architecture decisions | You |
| Parallel reading, research, a second opinion | Claude subagents (Agent tool) |
| Well-specified change: exact acceptance test, a few path globs, low/medium risk | **Codex** via `codex-delegate run` |
| Risky diff (auth, money, migrations, concurrency, security) | Your review **plus** `codex-delegate review` |
| Codex `blocked` (usage/login), or 3 failed attempts | You (or a Claude subagent) |

Codex usage is limited: never send it trivial work, and run one Codex task at a time unless the pieces are
clearly independent. Never switch anything to API billing.

## 2. Delegate an implementation
1. Write a brief (template: `~/.jawwid-ai/engine/templates/task-brief.md`): goal, context (file paths, not
   pasted code), allowed scope, acceptance criteria, constraints. No secrets. Save it in your scratchpad.
2. From inside the repository:
   ```bash
   codex-delegate run --task-id <id> --brief <file> --allow '<glob>' [--allow ...] \
     --test '<command>' [--test ...] [--prepare 'cd <dir> && npm ci'] [--test-network] [--risk low|medium]
   ```
   For long runs use the Bash tool with `run_in_background`, and wait for the completion notice.
3. Read the JSON it prints (also in `result.json`). Exit codes: 0 passed, 1 failed/partial, 2 usage error,
   3 blocked. Trust `tests_verified_by_wrapper` (real exit codes, run sandboxed) over
   `tests_reported_by_codex`.
4. Review the commit yourself: `git -C <worktree> show`. If it needs work, write concrete feedback and run
   `codex-delegate retry --task-id <id> --feedback <file>` (3 attempts in total).
5. Integrate: push the task branch or cherry-pick it into your branch, open the PR the project's way, and
   merge only under the project's approval rules. Then `codex-delegate cleanup --task-id <id>`.

## 3. Independent review
From a **clean** checkout at the head commit (a task worktree, or a dedicated clone):
`codex-delegate review --task-id review-<name> --base <base-ref> [--head <ref>] [--focus <file>]`.
It diffs from the merge base, gives Codex the diff as a file (read-only sandbox), and returns findings as
JSON. Check every finding in the code, then report agreements, disagreements and severities. A Codex
"merge" verdict is evidence, never approval.

## 4. Gates (the engine enforces them)
- `--risk high` needs `--owner-approval "<the owner's words>"`, quoted from the owner's own message.
- Repositories in `~/.jawwid-ai/protected-repos.conf` (e.g. Jawwid Core) refuse all delegation and review
  without that approval.
- Migrations (`--allow-migrations`) and `--test-unsandboxed` are never low risk.
- Protected paths are always reverted: CI config, hooks, instruction files (any depth), env and key
  files, Code Owner paths (read from the base commit), plus the project's `.ai-delegation.json` list.
- The engine never pushes, merges or deploys.

## 5. If something fails
Run `codex-delegate doctor` (no usage spent). `blocked` means login or usage: do the work yourself and tell
the owner only if they must log in. Otherwise read the run directory, fix the brief or the invocation,
and stay within 3 attempts. Never weaken a check, widen `--allow` to swallow a violation, or force-remove a
worktree.
