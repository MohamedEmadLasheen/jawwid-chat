---
name: codex-delegation
description: Jawwid Chat's additions to the global ai-delegation skill. Use together with it whenever delegating work or reviews to Codex in this repository.
---

# Codex delegation in Jawwid Chat

Follow the global `ai-delegation` skill (`~/.claude/skills/ai-delegation/`); this file only adds what is
specific to this repository. The engine is `codex-delegate` (installed from `tools/codex-delegate/`);
`scripts/ai/codex-task.sh` still works and runs this checkout's copy of it.

- **Policy:** `/.ai-delegation.json` sets the branch prefix `claude/codex-` (the only prefix worker sessions
  may push), protects the delegation tooling and the PD/migration registries, gates `supabase/migrations`
  and Prisma migrations behind `--allow-migrations`, and allows only `npm ci` and `flutter pub get` as
  `--prepare`.
- **Keep with Claude:** authorization, payments and refunds, migrations, realtime, calls, Quran and lesson
  content. Codex may review them, never implement them.
- **Tests:** use the machine-load rule commands from `AGENTS.md`. API integration suites need their own
  Postgres and Redis, so pass `--test-network`. Flutter needs `--test-writable "$HOME/development/flutter"`.
- **Merging** follows the autonomous-merge rules and the owner gates in `docs/engineering/ai-delegation.md`.
