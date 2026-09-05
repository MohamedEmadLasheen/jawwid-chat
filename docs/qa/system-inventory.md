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

---

## 6. Addendum — live state at 16:02 (repository is actively changing)

Sections 1–5 snapshot the repository at 15:58. Within four minutes AI #1 and
AI #4 began scaffolding, so the "no stack chosen" finding above is now
**superseded**. Recorded here rather than rewritten, because the timestamps
matter for the discovery trail.

Newly observed:

| Item | Finding |
|---|---|
| Backend stack | **Supabase / PostgreSQL**, declared in `supabase/migrations/20260905090000_chat_foundation.sql` |
| Schema strategy | Jawwid Chat lives in a `chat` schema **inside the Jawwid Core database**; Core's `public` schema remains source of truth, read only via `chat.core_*` boundary views |
| Directories created | `apps/admin-web/`, `src/`, `db/tests/`, `prisma/`, `scripts/db/`, `test/`, `README.md`, `.gitignore` |
| First real artifact | `chat.config` table + typed accessors + `chat.forbid_mutation()` append-only trigger function |

**This materially changes one QA conclusion.** Jawwid Core integration is real
and architectural, not absent as the discovery pass concluded. The `chat.core_*`
boundary is now a first-class test target: it is the seam where Chat could
silently become a second source of truth (brief §3 treats Core data as read-only
input). Integration tests must assert the boundary views are read-only and that
no `chat.*` table duplicates a Core-owned entity.

`prisma/` alongside `supabase/migrations/` is a **contract-drift risk to watch**:
two schema authorities over one database is exactly how migration state diverges.
Flagged, not yet a defect — neither directory is populated.

### First code-level observation (P3, non-blocking)

`chat.config_num()` and `chat.config_text()` document the intent *"raise if a key
is missing rather than silently defaulting."* They detect a **missing row**
(`v is null` after `SELECT INTO`) but not a row **holding JSON `null`** — in that
case `v` is `'null'::jsonb`, `v #>> '{}'` yields SQL NULL, and the function
returns NULL silently, which is the behaviour the comment says it prevents.

A `not null` check on the stored value, or `jsonb_typeof(v) = 'null'` guard,
closes it. Raised to AI #1; the migration was still being written when observed,
so this may already be addressed.


---

## 7. Addendum — 16:20

| Component | Owner | Stack | Exists | Tests |
|---|---|---|---|---|
| Backend API | AI #1/#2 | NestJS 11 + Prisma 6 + Postgres, socket.io + Redis adapter, BullMQ | partial | **unit suite now runs** |
| Database | AI #1 | Supabase/Postgres, `chat` schema inside Jawwid Core | partial | SQL harness present |
| Admin Web | AI #4 | Vite + React + TanStack Query + vitest | partial | none yet |
| Parent/Teacher mobile | AI #3 | Flutter/Dart | partial | **not executable — SDK absent** |
| CI/CD | AI #5 | — | **none** | — |

**Test runner is live.** `apps/api/package.json` declared `test:unit` /
`test:int` but no jest config or test existed; AI #5 added
`apps/api/jest.config.js` and the first suites.
Run: `npm --prefix apps/api run test:unit` → currently 6 passing, 4 failing,
every failure a recorded defect (JC-005, JC-006).

**Still absent:** any CI pipeline, Dockerised integration DB for the
`integration` project, Flutter toolchain, deployment/IaC, observability,
backup/restore.
