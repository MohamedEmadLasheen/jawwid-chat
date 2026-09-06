# Shared Working-Tree Risk

**Owner:** AI #8 (observation) · **Resolution owner:** AI #10
**Date:** 2026-09-05 · **Status:** ACTIVE INTEGRATION RISK

> This document records the hazard and a minimal safe procedure. It deliberately does **not**
> attempt to design a global Git workflow — that is AI #10's call as release commander.

## 1. What actually happened

Nine or more agents work concurrently in one checkout at
`~/Documents/jawwid chat`. During this audit, three incidents were observed directly:

| # | Incident | Evidence |
|---|---|---|
| **I-1** | **Cross-agent commit.** 15 of the 18 files I wrote were swept into another agent's commit by a `git add -A`-style stage. My own commit `c6aa4a6` contains only the 3 files written after that sweep | `git log --diff-filter=A -- docs/product-operations/discovery.md` → `fa53ba7 fix(authz): close the assist/escalation bypass and the offboarded-staff read` |
| **I-2** | **Stale audit conclusion.** I documented the assist/escalation bypass as an open P0. It had been fixed in `fa53ba7` while the audit was being written. Corrected in `d23bf93` | `authorization.service.ts:150-175` |
| **I-3** | **Code deleted underneath the analysis.** `apps/api/src/communication/threads/thread.service.ts` was deleted and `familyThreadAudience()` removed from `IdentityService` mid-audit. Findings FS-01 and FS-13 describe code that no longer exists | `git status --short`; `npx tsc --noEmit` fails |

### Incidents 4 and 5 — observed 2026-09-06, while writing this document

| # | Incident | Evidence |
|---|---|---|
| **I-4** | **The sweep recurred, against an agent actively following the safe procedure.** I staged 9 explicit paths and verified the stage with `git diff --cached --name-only`. Between that verification and `git commit`, a peer committed; my `git commit` returned *"no changes added to commit"*. All 9 files had landed in `939b41f feat(mobile): chat screen, messages controller and the send pipeline` | `git log --diff-filter=A -1 -- docs/product-operations/audit-baseline.md` → `939b41f` |
| **I-5** | **Index lock contention.** A later commit failed with `Unable to create '.git/index.lock': File exists`. The holder was a `git gc --auto` / `repack` storm triggered by a peer's commit, not an editor. It cleared in under a minute, but a fixed retry would have failed and a manual `rm` would have corrupted the peer's operation | `pgrep -fl "git "` → `git maintenance run --auto`, `git gc --auto`, `git repack`, `git pack-objects` |

**What I-4 proves.** §3's procedure is necessary but **not sufficient**. Explicit staging and
stage verification do not close the window between `git add` and `git commit`; in a tree with
nine concurrent agents that window is routinely lost. Only isolation — a worktree or a branch
per agent — actually closes it. The procedure below reduces blast radius; it does not prevent
the incident.

**What I-5 adds.** Git's own background maintenance becomes a contention source at this commit
frequency. An agent that treats a lock as stale and removes it will corrupt a peer's commit.
**Never remove `.git/index.lock`; wait for it, and check `pgrep` before concluding it is stale.**

## 2. The risk classes

### 2.1 Accidental staging
`git add -A`, `git add .` and `git commit -a` stage every agent's in-flight work, including
files being written at that instant. There is no locking; the filesystem is the only shared
state.

### 2.2 Cross-agent commits
Work lands under another agent's commit message and authorship. The commit message then
describes something the commit does not do — `fa53ba7` is titled as an authorization fix and
also contains an 18-file product audit. Anyone reading history is misled.

### 2.3 Partially written artifacts
A sweep that fires mid-write commits a truncated file. In I-1 the files happened to be
complete; nothing prevented the alternative. Multi-file artifact sets are especially exposed
because they are written sequentially over minutes.

### 2.4 Testing and auditing against moving code
Every static finding in this audit is a claim about a tree that changes continuously.
Between the first read of `authorization.service.ts` and the writing of the finding, the file
changed twice. A test run, a typecheck, or a grep is a snapshot, not a fact.

### 2.5 Stale conclusions
A finding published against a tree that has already moved is worse than no finding: it sends
an agent to fix something that is fixed, or lends confidence to a control that has since been
deleted.

### 2.6 Commit ownership ambiguity
`git log --author` and `git blame` no longer answer "who wrote this". Every commit carries
the same human author and `Co-Authored-By: Claude Opus 5`. Attribution has to be reconstructed
from file paths and commit messages, which I-1 shows can be wrong.

### 2.7 Index lock contention and maintenance storms
At this commit frequency `git gc --auto` runs often and holds the index lock. A blind retry
loop fails; a `rm .git/index.lock` corrupts whatever held it. Both failure modes are worse
than waiting.

### 2.8 Compounding: an unbuildable intermediate state
Because agents commit partial refactors into a shared tree, the tree can be — and currently
is — in a state where the Node stack does not compile (NF-01) and no branch can build a
database (NF-02). Neither agent introduced a defect; the *interleaving* did.

## 3. Recommended safe operating procedure (minimal, pending AI #10)

**For every agent, immediately:**

1. **Never** run `git add -A`, `git add .`, or `git commit -a`. Stage explicit paths only:
   `git add docs/product-operations/ apps/api/src/platform/authorization.service.ts`.
2. **Verify the stage before committing:** `git status --short` and confirm every listed path
   is yours. If a path you do not own appears, unstage it (`git restore --staged <path>`).
3. **Write to your own directories.** Cross-boundary edits are raised as findings, not made
   directly. (This audit has changed no file outside `docs/product-operations/`.)
4. **Re-verify before publishing a finding.** Re-read the file at the moment of writing, and
   record the commit the claim was verified against.
5. **Timestamp and pin every claim.** "Verified at `d23bf93`" is a fact; "the code does X" is
   not.
6. **Announce destructive refactors** — file deletions, interface removals, schema
   replacement — in the owning agent's `docs/<area>/` before making them, so peers auditing
   that code know it is moving.
7. **Never commit a non-compiling state to a shared branch.** If the refactor spans files,
   complete it before staging, or work on a dedicated branch.

**For the audit function specifically:**

8. Treat every commit as best-effort: after committing, **verify your files actually landed
   in your commit** (`git log --diff-filter=A -1 -- <path>`). If they landed elsewhere, record
   it rather than re-committing.
9. Findings are frozen in `audit-baseline.md` and updated only through dated
   **BEFORE / AFTER / VERIFIED STATUS** rows. Original text is never overwritten.
10. A finding whose subject code is deleted becomes **SUPERSEDED BY REFACTOR**, never FIXED —
   the operational requirement outlives the code.

## 4. What AI #10 should decide

Out of scope for this document; listed so nothing is lost:

- whether agents get per-agent worktrees or branches instead of one shared checkout;
- whether `main` is protected and integration happens only through reviewed merges;
- whether a pre-commit hook rejects staging paths outside the committing agent's ownership map;
- whether CI blocks a merge on `typecheck` + `migrations apply from empty` (which would have
  caught NF-01 and NF-02 automatically);
- how commit authorship is attributed per agent.

## 4a. Evidence that isolation is the only sufficient control

I-1 happened to an agent taking no precautions. **I-4 happened to the same agent taking every
precaution this document recommends.** That is the strongest available argument that the
answer is per-agent worktrees or branches, not better discipline — and it is why §4 is AI #10's
decision and not a procedural note.

## 5. Residual risk statement

Until this is resolved, **every finding in this audit carries an implicit "as of" qualifier**,
and any conclusion older than a few commits should be re-verified before it is acted on. The
audit baseline exists specifically to make that qualifier explicit rather than assumed.
