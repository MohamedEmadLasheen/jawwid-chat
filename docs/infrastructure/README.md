# Infrastructure

Owner: AI #7 · Production infrastructure for Jawwid Chat.

Jawwid Chat is an independent product. It shares no infrastructure, credentials,
domains, pipelines or deployment machinery with any other system.

**Current status: 🔴 NOT READY** — see `production-readiness.md`.

## Start here

| If you want to… | Read |
|---|---|
| Run the project locally | `local-development.md` |
| Know what exists and what does not | `production-readiness.md`, `inventory.md` |
| Understand the design and why | `architecture.md`, `decisions.md` |
| Configure an environment | `environment.md`, `secrets.md` |
| Operate production | `production-runbook.md`, `incident-response.md` |
| Recover data | `backup-recovery.md` |
| Know what was found on arrival | `discovery.md` |
| Work in your own area | `handoff-ai1.md` … `handoff-ai6.md` |

## Tools

```bash
scripts/infra/dev.sh up                              # local stack
scripts/infra/check-env.sh <env> [--file f]          # validate configuration
scripts/infra/scan-secrets.sh [--history]            # credential tripwire
scripts/infra/check-web-env.sh [--bundle dir]        # keep secrets out of the browser
scripts/infra/smoke.sh <url> [--web <url>]           # post-deploy verification
scripts/infra/backup-db.sh --out dir [--schema s]    # backup + checksum
scripts/infra/restore-db.sh --file f --into url      # guarded restore
scripts/infra/render-env-template.sh <env>           # regenerate env templates
```

`infra/env/manifest.tsv` is the machine-readable source of truth for
configuration. Add variables there, not to a template.
