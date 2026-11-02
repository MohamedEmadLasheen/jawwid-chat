# codex-delegate security model

## Trust boundaries
- **Trusted:** the owner, the Claude lead, this engine's installed copy, and the base commit of the
  repository (its `.ai-delegation.json`, `CODEOWNERS`, `.gitignore`).
- **Untrusted:** everything the delegated agent (Codex) writes, and the text it returns. The engine treats a
  run as potentially hostile until its own checks pass, and the lead still reviews every diff.

## What contains the agent
| Layer | Control |
|---|---|
| Filesystem | Codex runs with `-s workspace-write`: it can write only its own worktree and the run's temp dir (macOS Seatbelt). Network is off. |
| Git | Codex never runs Git operations that matter. The engine does them **outside** the sandbox, with hooks, fsmonitor, attribute files, colour and external diff tools turned off (`core.hooksPath=/dev/null`, `--no-verify`, `--no-ext-diff --no-textconv --text`). |
| `.git` pointer | The worktree's `.git` file is compared before and after each attempt. Any change is restored and the run stops as `blocked`. |
| Scope | Every changed path (NUL-safe, any file name) must match an `--allow` glob and must not match a protected pattern (case-insensitive, any depth). Otherwise it is reverted and kept as an evidence patch. |
| Protected paths | CI configs, Git hooks and `.gitattributes`/`.gitignore`/`.gitmodules`, instruction files at any depth (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `.codex/`), env and key files, `.npmrc`/`.netrc`, `.ai-delegation.json`, the base commit's Code Owner paths, and the project's own list. Migrations need `--allow-migrations`. |
| File types | Symlinks, nested repositories, submodules (gitlinks) and control characters in names are rejected. |
| Ignored files | Files the agent creates in ignored paths (invisible to `git status`) are deleted before tests run, and listed in `result.json`. |
| Secrets | The candidate diff (every file as text) is scanned for provider keys, private keys, JWTs, credentials in URLs and `*PASSWORD=`-style assignments. A hit blocks the commit, and the report masks values. It is a safety net: the lead still reads the diff. |
| Verification | The lead's `--test` commands run inside the Codex sandbox too (write access only to the worktree and the run's temp dir; network only with `--test-network`; extra writable dirs only with `--test-writable`). `--test-unsandboxed` exists for suites that cannot run sandboxed; it is never low risk and is recorded in the result. |
| Dependencies | `--prepare` runs before the agent touches the tree, and accepts only lockfile installs (`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`, `flutter/dart pub get`, `go mod download`, `cargo fetch --locked`, `bundle install --frozen`), optionally narrowed per project. No pipes, downloads or `..`. |
| Time | Each attempt has a timeout. The whole process group is killed, so no orphaned tools keep editing the tree. |
| Concurrency | One lock per task (stale locks from dead processes are detected). One worktree per task. Two agents never share a tree. |
| Attempts | At most 3 per task, automatic or with the lead's feedback. Login and usage errors stop at once (`blocked`). Only Codex's own error stream can trigger that, never the model's text. |

## Approval gates
- `--risk high` requires `--owner-approval "<the owner's words>"`, which is recorded in `result.json`.
- Repositories matching `~/.jawwid-ai/protected-repos.conf` (by `origin` URL or path; Jawwid Core by
  default) refuse `run` **and** `review` without that approval.
- Migrations and unsandboxed tests are never low risk.
- The engine never pushes, merges, deploys, or changes GitHub settings. Merging and deploying follow each
  project's own approval rules.

## Known limits
- The secret scan is pattern-based and cannot catch every encoding.
- With `--test-network`, sandboxed tests can reach the network (needed for local databases). Leave it off
  unless the suite needs it.
- Codex reviews are evidence, not approval: on one PR it missed a P1 that a Claude review found.
- Codex itself must stay logged in to the owner's ChatGPT account. The engine never handles credentials.

## Reporting a problem
A suspected escape or bypass is a P1. Stop delegating (`codex-delegate` is the only entry point), add a
reproduction to `test/codex-delegate.test.sh`, and fix the engine before resuming.
