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

### 2.7 Compounding: an unbuildable intermediate state
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

8. Findings are frozen in `audit-baseline.md` and updated only through dated
   **BEFORE / AFTER / VERIFIED STATUS** rows. Original text is never overwritten.
9. A finding whose subject code is deleted becomes **SUPERSEDED BY REFACTOR**, never FIXED —
   the operational requirement outlives the code.

## 4. What AI #10 should decide

Out of scope for this document; listed so nothing is lost:

- whether agents get per-agent worktrees or branches instead of one shared checkout;
- whether `main` is protected and integration happens only through reviewed merges;
- whether a pre-commit hook rejects staging paths outside the committing agent's ownership map;
- whether CI blocks a merge on `typecheck` + `migrations apply from empty` (which would have
  caught NF-01 and NF-02 automatically);
- how commit authorship is attributed per agent.

## 5. Residual risk statement

Until this is resolved, **every finding in this audit carries an implicit "as of" qualifier**,
and any conclusion older than a few commits should be re-verified before it is acted on. The
audit baseline exists specifically to make that qualifier explicit rather than assumed.
