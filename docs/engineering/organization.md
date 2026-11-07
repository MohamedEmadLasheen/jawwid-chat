# Engineering organization: roles, models and operating loop

**Status: PROPOSED 2026-11-08, awaiting the owner's approval.** Once approved, this is the canonical
description of who does what. It adds roles on top of `AGENTS.md` (repository rules, binding on every
agent) and `docs/engineering/ai-delegation.md` (lifecycle, risk levels, merge conditions, Codex
routing). Where they differ, those two files win.

## 1. Principles
- **One accountable lead.** The owner states the goal and talks only to the Chief Engineering Officer
  (the lead session). Every other role is an agent the lead starts for one bounded job. The lead owns
  the final quality of everything any of them produces.
- **A role is a brief, a model and a set of permissions.** It is not a standing process. The lead starts
  it when there is work and stops it when the work is reviewed. Each role is defined in
  `.claude/agents/<role>.md`.
- **The author never approves their own work.** Code is reviewed by a different agent from the one that
  wrote it. High-risk code also gets a security review, and a Codex review where `ai-delegation.md` §2
  calls for one.
- **Isolation.** Each implementer works in its own worktree and branch: the lead starts every builder
  with `isolation: "worktree"`. Two agents never share a tree. The architect, the reviewers and the
  compliance specialist cannot edit files (`disallowedTools` in their definitions).
- **Ten roles, no more.** A new role is added only when a recurring kind of work fits none of these.

## 2. Roles

| # | Role | Definition | Does | Never does |
|---|---|---|---|---|
| 1 | **Chief Engineering Officer** (lead) | the main session | Turns the owner's request into a plan, splits it into tickets, picks the role and model for each, reviews and integrates, merges Low/Medium PRs under the merge conditions, reports to the owner | Implements large changes itself when a builder can; merges High-risk work without the owner |
| 2 | **Principal Software Architect** | `principal-architect` | Designs cross-module changes, data models, migrations and contracts; challenges the lead's plan; writes the spec a builder implements | Writes production code; approves its own design for High-risk work |
| 3 | **Backend Engineer** | `backend-engineer` | NestJS API, Prisma, SQL migrations and RLS (with a claimed slot), integration tests | Applies a migration to a shared or production database |
| 4 | **Frontend Engineer** | `frontend-engineer` | Admin Web (React) and the lessons renderer's non-content code, Vitest tests, Arabic and English copy | Touches Code Owner lesson-content paths |
| 5 | **Mobile Engineer** | `mobile-engineer` | Flutter app, iOS (Swift, PushKit/CallKit, plist, entitlements) and Android (Kotlin, manifest, Gradle), widget and native tests | Changes signing identities, bundle or package ids without the owner |
| 6 | **QA Engineer** | `qa-engineer` | Writes the failing test first for a defect; runs suites under the machine-load rule; owns test plans, device test scripts and the defect log; retests fixes | Weakens or skips a test or guard to get green |
| 7 | **Security Reviewer** | `security-reviewer` | Reviews auth, authorization, RLS, secrets, payments, child data, abuse limits; owns the red-team register | Edits code (read-only); signs off on anything it was not shown |
| 8 | **Independent Code Reviewer** | `code-reviewer` | Reviews every PR it did not write for correctness, tests, scope and rules; posts `Review: ACCEPT @ <sha>` or concrete changes | Edits code (read-only); reviews its own work |
| 9 | **Release and Integration Manager** | `release-manager` | Keeps branches mergeable (`git merge-tree` of the whole queue), watches CI, versions builds, prepares release candidates, runs the store build scripts and audits the artifacts, keeps the release gate current | Merges, deploys, uploads to a store console or changes protections |
| 10 | **App Store Compliance Specialist** | `store-compliance` | Keeps the launch checklist true against current Apple and Google rules; drafts review notes, privacy labels, Data safety, age-rating answers and listing copy; reads rejection messages and plans the response | Submits anything; presents an unverified rule as fact |

**Codex** sits outside the ten roles. It is an independent second opinion and a bounded implementer,
called only through `codex-delegate` under the rules of `ai-delegation.md` §2 and §5.

## 3. Models and effort

Models, strongest first (Anthropic's model table, 2026-10): **Fable 5.1** (most capable; about 2.5×
the price of Opus), **Opus 5.5**, **Sonnet 5.5** (about half of Opus), **Haiku 5.5** (about 1/40 of
Opus). Effort runs `low` → `medium` → `high` → `xhigh` → `max`; lower effort means fewer and shorter
steps. On the Max plan the cost is usage allowance, not money, but the proportions hold.

| Role | Default model | Effort | Raised to | When |
|---|---|---|---|---|
| Chief Engineering Officer | Opus 5.5 | high | xhigh | integration of several PRs, a release decision |
| Principal Architect | **Fable 5.1** | high | xhigh | schema, authorization model, payments or child-data design |
| Backend Engineer | Sonnet 5.5 | high | Opus 5.5, high | anything High-risk: auth, money, migrations, RLS, realtime, calls |
| Frontend Engineer | Sonnet 5.5 | medium | Sonnet 5.5, high | a new screen or flow, not a copy change |
| Mobile Engineer | Sonnet 5.5 | high | Opus 5.5, high | native push, calls, CallKit/PushKit, signing |
| QA Engineer | Sonnet 5.5 | medium | Haiku 5.5, low | mechanical runs: execute a suite, summarize the log |
| Security Reviewer | Opus 5.5 | high | **Fable 5.1**, high | High-risk diffs and the pre-submission security sign-off |
| Independent Code Reviewer | Opus 5.5 | high | — | Codex review in addition for High-risk |
| Release and Integration Manager | Sonnet 5.5 | medium | — | |
| App Store Compliance Specialist | Opus 5.5 | high | **Fable 5.1**, high | the final pre-submission audit and a rejection response |
| Read-only sweeps (any role) | Haiku 5.5 | low | — | "find every X", string parity, file inventories |

**Rules**
1. The definition holds the default. The lead raises a single task by passing `model` on that call and
   records why in the ticket. It never lowers below the default for High-risk work.
2. A reviewer is never a weaker model than the author of the same change.
3. Fable 5.1 is reserved for the four cases marked in bold. Everything else runs on Opus or below.
4. A task that fails twice on Sonnet goes to Opus. One that fails three times goes back to the lead
   (`ai-delegation.md` §1 step 11).

## 4. How a request flows
1. **Owner → lead**: a goal in natural language.
2. **Lead**: restates the outcome, reads only what it touches, classifies risk (`ai-delegation.md` §3).
   Business, religious-content, money, production or protection questions go to the owner as one
   consolidated question. Everything else the lead decides and records.
3. **Architect** (High-risk or cross-module only): spec and acceptance tests.
4. **Lead**: tickets that do not share files, each with an acceptance test and allowed paths.
   A migration slot is claimed before a backend ticket starts.
5. **Builders** (backend, frontend, mobile; or Codex) in parallel, each in its own worktree. Tests first.
6. **QA**: runs the suites on the integrated branch and retests defects.
7. **Code reviewer**, plus the **security reviewer** and Codex for High-risk, review the exact head SHA.
8. **Release manager**: conflict check against the whole queue, CI green on the head commit.
9. **Lead**: merges Low/Medium under the merge conditions. High-risk waits for the owner.
10. **Lead → owner**: what shipped, PR links, what was verified (only checks that ran), what waits on them,
    and what the owner should try on their phone.

## 5. Store releases
- The **release manager** builds the candidate (`scripts/mobile/build-store.sh`) from a merged `main`
  SHA and audits the artifact (entitlements, permissions, signing, version).
- The **compliance specialist** checks it against `docs/release/launch-readiness-checklist.md`. No
  submission while any Critical or High item is open or unverified.
- **The owner uploads and submits** (their accounts and signing keys). Engineering never presses
  "Submit for review" or "Send to production".
- **Review feedback.** Apple and Google write to the account holder. The owner forwards the message, or
  grants read access (an App Store Connect API key, Play Console read access, or the mailbox) when they
  choose to. The compliance specialist classifies it, the lead plans the fix, the normal flow above
  applies, and the specialist drafts the reply and the resolution-centre notes.

## 6. What the owner is asked
Only what `CLAUDE.md` lists: product or business decisions, Quran, religious or lesson content,
destructive or production database operations, infrastructure and paid resources, production deploys,
Code Owner approvals, protections, and the store consoles. Every report ends with a short
"waiting on you" list. The owner never carries text between agents.
