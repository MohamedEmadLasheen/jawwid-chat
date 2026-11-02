# Claude Code in Jawwid Chat

Read `AGENTS.md` first. Its rules bind every Claude session exactly as they bind Codex; they are not
repeated here.

## Roles
- The **engineering lead** session plans, assigns, reviews, integrates and reports to the owner.
  The owner talks only to the lead; the lead never asks the owner to carry work between agents.
- **Builder sessions** and **Codex runs** implement one bounded task each, in their own worktree and
  branch, and report back. No two agents ever share a working tree.
- Claude owns final engineering quality. A Codex review is independent evidence, never an approval.

## Delegating to Codex
Use the global `ai-delegation` skill together with this repository's `codex-delegation` skill
(`.claude/skills/codex-delegation/SKILL.md`). The workflow, routing rules, risk levels and approval gates
are in `docs/engineering/ai-delegation.md`. The only entry point is `codex-delegate` (installed from
`tools/codex-delegate/`; `scripts/ai/codex-task.sh` is the same engine). Do not call `codex` directly for
repository work.

## Ask the owner only for
Product or business decisions; Quran, religious or lesson content; destructive or production database
operations; infrastructure or paid resources; production deploys; Code Owner approvals; changes to
protections. Everything else (ordinary engineering choices) the lead decides, records, and continues.
