# codex-delegate: Claude leads, Codex helps, in every repository on this Mac

One engine lets the Claude lead hand a bounded implementation task, or an independent review, to the
Codex CLI, then verifies everything itself. The owner talks only to Claude.

This folder is the **source of truth**. `install.sh` copies it to user-level locations; nothing runs from
other repositories' code.

## What gets installed
| Path | What | Owner of the content |
|---|---|---|
| `~/.local/bin/codex-delegate` | the engine (`run`, `retry`, `review`, `status`, `list`, `cleanup`, `doctor`) | this folder |
| `~/.jawwid-ai/engine/templates/` | brief template, Codex preambles, JSON schemas | this folder |
| `~/.jawwid-ai/protected-repos.conf` | repositories nobody may delegate in without owner approval (Jawwid Core) | **you**: the installer only adds missing defaults |
| `~/.claude/CLAUDE.md` | a **marked block** with Claude's global routing rules | the block is managed; your text around it is never touched |
| `~/.claude/skills/ai-delegation/` | Claude's skill: how to route, delegate, review, integrate | this folder |
| `~/.codex/AGENTS.md` | a **marked block** with Codex's global rules | the block is managed; your text is never touched |
| `~/.agents/skills/ai-delegation/` | Codex's skill: how to behave as a delegated engineer or reviewer | this folder |
| `~/.jawwid-ai/runs/<repo>/<task>/` | per-task briefs, prompts, logs, `result.json` (kept forever) | the engine |
| `~/jawwid-ai-worktrees/<repo>/<task>/` | one Git worktree per delegated task | the engine (`cleanup` removes clean ones) |
| `~/.jawwid-ai/backups/<time>/` | a copy of every file the installer changed | the installer |

## Install, update, check, remove
```bash
bash tools/codex-delegate/install.sh            # install or update; idempotent
bash tools/codex-delegate/install.sh --check    # what would change; changes nothing
bash tools/codex-delegate/install.sh --uninstall
codex-delegate doctor                           # Codex present, logged in, sandbox works (no usage spent)
```
To update: pull the newer source, run `install.sh` again. `~/.jawwid-ai/engine/INSTALLED` records the
version and source commit. Self-tests (no Codex usage):
```bash
bash tools/codex-delegate/test/codex-delegate.test.sh   # engine: 60 checks incl. every audited exploit
bash tools/codex-delegate/test/install.test.sh          # installer: 17 checks in a throwaway home
```

## Project independence
Each repository keeps its own `CLAUDE.md`, `AGENTS.md`, tests and risk rules, and they always win over the
global files. A project can **tighten** delegation with `.ai-delegation.json` at its root, read from the
base commit so a delegated agent cannot alter it:
```json
{
  "branch_prefix": "team/codex-",
  "protected": ["docs/legal/*"],
  "migration_paths": ["db/migrations/*"],
  "prepare_allow": ["npm ci"],
  "load_max": 40
}
```
Projects add protections; they cannot remove the global ones. Without the file, the defaults apply: branch
`codex/<task>`, base = the remote's default branch (or the current branch when there is no remote).

## Usage (the Claude lead runs these; the owner does not need to)
```bash
codex-delegate run --task-id fix-x --brief brief.md --allow 'src/foo/*' --test 'npm test -- foo'
codex-delegate retry --task-id fix-x --feedback feedback.md
codex-delegate review --task-id review-x --base origin/main
codex-delegate status fix-x ; codex-delegate list ; codex-delegate cleanup --task-id fix-x
```
Exit codes: 0 passed, 1 failed/partial/needs feedback, 2 usage error or refused by a gate, 3 blocked (Codex
login or usage limit, or a hostile action detected).

## Subscriptions
Codex runs on the owner's existing ChatGPT login (`codex login status`). The engine never changes
authentication, never sets an API key, and never switches to API billing. Codex usage is limited, so the
Claude lead uses it for well-specified tasks and second reviews only. See `SECURITY.md` for the trust
boundaries.
