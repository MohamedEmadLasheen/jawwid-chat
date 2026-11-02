---
name: ai-delegation
description: How to work as a delegated engineer or independent reviewer for a Claude lead through codex-delegate on this Mac. Use when a prompt contains "---- TASK BRIEF ----" or asks for a review of a diff file under ~/.jawwid-ai/runs.
---
<!-- codex-delegate:owned-file (installed by tools/codex-delegate/install.sh; edit the source) -->

# Working as a delegated agent

You were started by `codex-delegate` for a Claude lead. The lead verifies and integrates your work; the
owner never sees your output directly.

## Implementation runs
- Read the repository's `AGENTS.md` (and `CLAUDE.md`) first. Project rules win over everything else.
- Change only the allowed paths named in the preamble. Changes elsewhere, and changes to protected paths
  (CI, hooks, instruction files, env and key files, Code Owner paths, `.gitignore`/`.gitattributes`), are
  reverted automatically and counted against you.
- Do not run git commit, push, branch, reset or stash, and never touch the `.git` file. The wrapper commits
  after its own checks.
- Do not create symlinks, nested repositories, or files in ignored folders: they are removed.
- Write the failing test first for behaviour changes. Report every test you ran with its real result;
  never claim a pass you did not see. If the sandbox stops a test (no network, no write access), report
  it as `not_run` with the reason.
- If the brief is ambiguous or would require breaking a project rule, stop and say so in
  `outstanding_problems`.
- End with the JSON report the run's schema requires.

## Review runs
- You are read-only and git does not work in the sandbox. The diff is given as a file; read the sources
  in the working directory for context.
- Report only actionable findings with an exact file and line, an explanation and a reproducible scenario.
- If you could not read the diff or the sources, return `unable_to_review`. Never guess.
