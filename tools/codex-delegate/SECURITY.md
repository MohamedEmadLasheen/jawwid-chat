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
| Git | Codex never runs Git operations that matter. The engine does them **outside** the sandbox against the **git dir recorded when it created the worktree** (`--git-dir`/`--work-tree`, so a rewritten `.git` pointer is never followed), with global and system git config ignored (`GIT_CONFIG_GLOBAL=/dev/null`), hooks, fsmonitor, attribute files, colour, external diff, textconv, signing and ssh commands off, and the commit identity taken from the run state. |
| `.git` pointer | The worktree's `.git` file is compared with the value recorded at creation before Codex, after Codex, after the tests and before `cleanup`. Any change is restored and the run stops as `blocked`. |
| Scope | Every changed path (NUL-safe, any file name) must match an `--allow` glob and must not match a protected pattern (case-insensitive, any depth). Otherwise it is reverted and kept as an evidence patch. |
| Protected paths | CI configs, Git hooks and `.gitattributes`/`.gitignore`/`.gitmodules`, instruction files at any depth (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.agents/`, `.codex/`), env and key files, `.npmrc`/`.netrc`, `.ai-delegation.json`, the base commit's Code Owner paths, and the project's own list. Migrations need `--allow-migrations`. |
| File types | Symlinks, nested repositories, submodules (gitlinks) and control characters in names are rejected. |
| Ignored files | Files the agent creates in ignored paths (invisible to `git status`) are deleted before tests run, and listed in `result.json`. Deletion never follows a symlinked path component and never leaves the worktree. |
| Secrets | The candidate diff (every file as text) is scanned for provider keys, private keys, JWTs, credentials in URLs and `*PASSWORD=`-style assignments. A hit blocks the commit, and the report masks values. It is a safety net: the lead still reads the diff. |
| Frozen candidate | After the scope and secret checks, the candidate is frozen as a Git tree object in a private index. Only that tree is committed (`commit-tree` + `update-ref`). Anything tests or leftover processes write afterwards is restored or removed and listed in `post_test_changes_discarded`. |
| Verification | The lead's `--test` commands run inside the Codex sandbox too (write access only to the worktree and the run's temp dir; network only with `--test-network`; extra writable dirs only with `--test-writable`). `--test-unsandboxed` exists for suites that cannot run sandboxed; it is never low risk and is recorded in the result. |
| Dependencies | `--prepare` runs before the agent touches the tree, and accepts only lockfile installs (`npm ci`, `pnpm install --frozen-lockfile`, `yarn install --immutable`, `flutter/dart pub get`, `go mod download`, `cargo fetch --locked`, `bundle install --frozen`), optionally narrowed per project. No pipes, downloads or `..`. |
| Time | Each attempt has a timeout. The whole process group is killed after every run, finished or timed out, so no orphaned tools keep editing the tree (a process that deliberately leaves its group can survive; the frozen candidate makes that harmless to the commit). |
| Concurrency | One lock per task (stale locks from dead processes are detected). One worktree per task. Two agents never share a tree. |
| Attempts | At most 3 per task, automatic or with the lead's feedback. Login and usage errors stop at once (`blocked`). Only Codex's own error stream can trigger that, never the model's text. |

## Approval gates
- `--risk high` requires `--owner-approval "<the owner's words>"`, which is recorded in `result.json`.
- Protected repositories refuse `run` **and** `review` without that approval. Rules match every remote URL
  (case-insensitive, any host alias or port), the repository's path, or its root commit (`root:<sha>`), so a
  clone anywhere is caught. Jawwid Core's rules are built into the engine and also listed in
  `~/.jawwid-ai/protected-repos.conf`, so protection fails closed if that file is missing.
- Migrations and unsandboxed tests are never low risk.
- The engine never pushes, merges, deploys, or changes GitHub settings. Merging and deploying follow each
  project's own approval rules.

## Known limits
- A process the agent deliberately detaches from its process group (`setsid`) can outlive the run and keep
  writing inside the worktree and the run's temp dir (it stays sandboxed). The engine never runs git
  through the worktree's `.git` pointer (the git dir is pinned), re-checks that pointer in `status`,
  `review` and `cleanup`, refuses a review whose git dir resolves into its own folders, and tells the lead to
  inspect through the main repository (`inspect_with` in `result.json`). Never run git, tests or builds
  yourself inside a task worktree.
- Folders that were already ignored before the run (for example `node_modules` from `--prepare`) are
  tracked as one entry, so changes inside them are not detected. Verification runs sandboxed; do not run
  unsandboxed commands in a task worktree.
- A catch-all Code Owner rule (`*` or `/`) protects every path, so nothing can be delegated in that
  repository until the rule is narrower. That is deliberate (it fails closed).
- Runs made before 2.1 cannot be retried (no pinned git dir); start a new task.
- The secret scan is pattern-based and cannot catch every encoding.
- With `--test-network`, sandboxed tests can reach the network (needed for local databases). Leave it off
  unless the suite needs it.
- Codex reviews are evidence, not approval: on one PR it missed a P1 that a Claude review found.
- A project's `.ai-delegation.json` is read from both the default branch and the base commit; protections
  from either apply. A project with no remote and no default branch relies on the base the lead chooses.
- Codex itself must stay logged in to the owner's ChatGPT account. The engine never handles credentials.

## Reporting a problem
A suspected escape or bypass is a P1. Stop delegating (`codex-delegate` is the only entry point), add a
reproduction to `test/codex-delegate.test.sh`, and fix the engine before resuming.
