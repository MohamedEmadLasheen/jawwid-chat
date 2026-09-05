# Jawwid Chat — System Inventory (AI #5, QA/Security/Release)

Date: 2026-09-05
Authoritative contract: `docs/JAWWID_CHAT_BRIEF.pdf` (8 pp) — *"this brief is the contract for what to build."*
Method: direct filesystem + git inspection. Nothing below is inferred from another agent's claims.

## 1. Verified repository state

`git log` contains **one commit** (`4c923da`), consisting of the brief plus two discovery reports.
**Zero lines of application code exist.**

| Component | Owner | Technology | Location | Exists | Tested | Integrated |
|---|---|---|---|---|---|---|
| Backend / API | AI #1 | undecided | — | ❌ | ❌ | ❌ |
| Database + migrations | AI #1 | undecided | — | ❌ | ❌ | ❌ |
| Auth / session | AI #1 | undecided | — | ❌ | ❌ | ❌ |
| RBAC + `on_duty()` | AI #1 | undecided | — | ❌ | ❌ | ❌ |
| `event_log` / `audit_log` | AI #1 | undecided | — | ❌ | ❌ | ❌ |
| Thread / message / case / task / handoff | AI #2 | undecided | — | ❌ | ❌ | ❌ |
| Attention + workload engines | AI #2 | undecided | — | ❌ | ❌ | ❌ |
| Deterministic automation + timers | AI #2 | undecided | — | ❌ | ❌ | ❌ |
| Admin Web (inbox, family, manager, tasks) | AI #4 | undecided | — | ❌ | ❌ | ❌ |
| Customer help screen | AI #3 | undecided | — | ❌ | ❌ | ❌ |
| Realtime transport | AI #2 | undecided | — | ❌ | ❌ | ❌ |
| Storage (attachments) | AI #1 | undecided | — | ❌ | ❌ | ❌ |
| Queue / scheduler | AI #2 | undecided | — | ❌ | ❌ | ❌ |
| Observability | AI #5 | undecided | — | ❌ | ❌ | ❌ |
| CI/CD | AI #5 | none | — | ❌ | — | — |
| Deployment / IaC / Docker | AI #5 | none | — | ❌ | — | — |
| Test suites (any level) | AI #5 | none | — | ❌ | — | — |

**No technology stack has been chosen for any component.** There is no
`package.json`, `pyproject.toml`, `go.mod`, `pubspec.yaml`, Dockerfile, migration
directory, or environment template anywhere in the tree.

## 2. Toolchain availability on this host

| Tool | State | Consequence |
|---|---|---|
| Flutter / Dart SDK | **absent** | Mobile code cannot be compiled, analysed, or tested. Verified independently. |
| `pdftotext` / poppler | absent | Brief extracted via `pypdf` instead. |
| git | present | Repo initialised on `main`. |

A component whose toolchain is absent cannot pass a release gate, because no
test result from it can be produced. This is a release risk, not a rumour.

## 3. Positive security finding

No secrets, credentials, tokens, connection strings, or `.env` files exist in
the repository or in git history. Verified by scan. This is the one thing
currently in a passing state, and it is trivially true because there is no code.

## 4. Privacy finding — real staff names in repository (P2)

The brief names six real employees and embeds their personal work schedules
(shift times, Friday duty, coverage assignments). This file is now committed.

- Acceptable: it is an internal operational document.
- **Not acceptable:** propagating these names into seed data, fixtures, test
  assertions, or demo databases. Test fixtures must use synthetic staff
  (`admin_a`, `coverage_b`, `manager_c`) with synthetic schedules.
- Enforced by gate **G-16** in `release-gate.md`.

## 5. Cross-agent corroboration

AI #3 and AI #4 each performed an independent discovery pass and reached the
same two conclusions I did: (a) the repository is empty, (b) the role briefs
materially contradict the authoritative product brief. Three independent
findings agreeing is sufficient evidence to treat both as established fact
rather than as one agent's misreading.
