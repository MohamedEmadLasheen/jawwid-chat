---
name: codex-delegation
description: Delegate a bounded implementation task, or an independent read-only code review, from the Claude engineering lead to the Codex CLI through scripts/ai/codex-task.sh, then verify and integrate the result. Use when a Jawwid Chat task is well specified with a clear acceptance test, or when a risky PR needs a second, independent review.
---

# Delegating to Codex

The full workflow and routing rules are in `docs/engineering/ai-delegation.md`. This skill is the checklist.

## Decide
- Delegate only if the brief can state the acceptance test exactly and the allowed paths fit in a few globs.
- Keep authorization, money, migrations, realtime and calls with Claude (Codex may review them).
- High risk needs the owner's recorded approval first; pass their words with `--owner-approval`.
- Codex usage is limited: one implementation task at a time unless the work is clearly parallel.

## Implement
1. Write the brief from `scripts/ai/templates/task-brief.md` into the scratchpad: goal, context (paths, not
   pasted code), scope, acceptance criteria, constraints. No secrets.
2. Run, from any checkout of this repository:
   `scripts/ai/codex-task.sh run --task-id <id> --brief <file> --allow '<glob>' [--allow ...] [--prepare '<cmd>'] --test '<cmd>' [--test ...] [--risk low|medium]`
   Long runs: use the Bash tool's `run_in_background`.
3. Read `~/.jawwid-ai/runs/<id>/result.json`. Trust `tests_verified_by_wrapper` (real exit codes) over
   `tests_reported_by_codex`.
4. Review the diff yourself: `git -C ~/jawwid-ai-worktrees/<id> show`. If it needs changes, write concrete
   feedback and run `codex-task.sh retry --task-id <id> --feedback <file>`. The limit is 3 attempts in total;
   after that, do it yourself.
5. When accepted: push the branch (`git -C <worktree> push -u origin claude/codex-<id>`), open the PR with
   `gh pr create`, and merge only under the risk rules. Then `codex-task.sh cleanup --task-id <id>`.

## Review
1. Make or reuse a **clean** checkout at the head commit (a task worktree, or a dedicated clone).
2. `scripts/ai/codex-task.sh review --task-id review-<pr> --repo <checkout> --base <base-sha> --head <head-sha> [--focus <file>]`
3. Compare `review.json` findings with your own review, checking each disputed point in the code.
   Report the agreements, disagreements and severity to the owner. Codex's verdict is evidence, not approval.

## If it fails
`blocked` means auth or usage: fall back to a Claude builder. Any other failure: read the run directory, fix
the invocation or the brief, and stay within the 3-attempt limit. Never weaken a check to make it pass.
