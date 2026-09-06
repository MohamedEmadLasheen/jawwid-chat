# Worktree Isolation Strategy

**Drafted by:** AI #8 at the product owner's instruction · **Owner:** AI #10 (Release &
Integration Commander) · **Date:** 2026-09-06 · **Status:** proposed, not implemented

> This document lives in AI #10's directory because AI #10 owns integration. AI #8 drafted it
> because AI #8 recorded the incidents. **Adopt, amend or replace it as you see fit.**

**Standing constraint until isolation exists: NO BROAD MERGES.**

---

## 1. The evidence

Nine or more agents share one checkout at `~/Documents/jawwid chat`. Five incidents observed:

| # | Incident | Evidence |
|---|---|---|
| **I-1** | 15 of AI #8's 18 files swept into another agent's commit by a `git add -A` | `git log --diff-filter=A -- docs/product-operations/discovery.md` → `fa53ba7`, a commit titled as an authorization fix |
| **I-2** | A finding published against already-fixed code | corrected in `d23bf93` |
| **I-3** | `thread.service.ts` deleted mid-analysis; `familyThreadAudience()` removed while a caller still referenced it | `npx tsc --noEmit` failed |
| **I-4** | **The sweep recurred against an agent following the safe procedure exactly** — 9 explicit paths staged, stage verified with `git diff --cached --name-only`, then `git commit` returned *"no changes added to commit"*. All 9 had landed in `939b41f feat(mobile): chat screen…` | `git log --diff-filter=A -1 -- docs/product-operations/audit-baseline.md` → `939b41f` |
| **I-5** | `.git/index.lock` contention from a `git gc --auto` storm triggered by a peer's commit | `pgrep -fl "git "` → `git maintenance run --auto`, `gc`, `repack`, `pack-objects` |

**The load-bearing fact is I-4.** I-1 happened to an agent taking no precautions. **I-4 happened
to the same agent taking every precaution.** Explicit staging does not close the window between
`git add` and `git commit`; with nine concurrent agents that window is routinely lost.

**Therefore: this is not solvable with instructions to be careful.** Discipline reduces blast
radius. Only isolation removes the shared mutable index.

### Second-order damage already caused

- **Commit history is unreliable.** `939b41f` is titled as mobile work and contains a product
  audit. `git blame` and `git log --author` cannot attribute work.
- **The tree has been non-buildable for extended periods** — `apps/api` had no compiling state
  and still has no `main.ts` (RC-01), partly because partial refactors land in a shared branch.
- **AI #9 RT-027** — the unit suite stopped running entirely at one point, so the regression
  tests guarding RT-003/004/005/007/008 silently stopped protecting anything.

---

## 2. Options considered

| Option | Isolates the index? | Cost | Verdict |
|---|---|---|---|
| **A. Stricter staging discipline** | ❌ | zero | **Rejected — I-4 disproves it** |
| **B. Per-agent `git worktree`** | ✅ | one command per agent; shared object store | **Recommended** |
| **C. Per-agent branches in one checkout** | ❌ | low | Rejected — one index, one working tree; the sweep survives |
| **D. Per-agent full clones** | ✅ | disk; push/pull to integrate | Viable; heavier than B, no extra safety |
| **E. Dedicated integration checkout, agents read-only elsewhere** | partial | moderate | Recommended **as a complement** to B |

## 3. Recommendation — B + E

**B. One `git worktree` per agent.** Each agent gets its own directory, its own index, its own
`HEAD`, on its own branch, sharing one object store:

```bash
git worktree add ../jawwid-chat-ai1  agent/ai1-backend
git worktree add ../jawwid-chat-ai2  agent/ai2-communication
# … one per agent, including AI #8 and AI #9
```

- Each agent works only in its own directory. `git add -A` there is now **safe** — it can only
  sweep that agent's own files.
- Concurrent commits no longer contend for one index (removes I-4 and I-5).
- Cheap: no duplicated history, and a worktree is removable in one command.
- Auditable: authorship follows the branch.

**E. A dedicated integration checkout owned by AI #10**, the only place merges happen. Agents
never merge into each other; they merge **into integration**, and only when the merge gates pass.

### Merge gates — the second half of the fix

Isolation stops files being *lost*. It does not stop a broken state being *integrated*. Both
NF-02 and RT-027 would have been caught automatically by two gates on every merge into the
integration branch:

1. **`typecheck`** — `npx tsc --noEmit` in `apps/api` and `apps/admin-web`
2. **`migrations apply from empty`** — stock PostgreSQL, no shim; also satisfies **G-CORE-02**
3. **`unit suite executes`** — not "passes": *executes*. RT-027 was a suite that stopped running,
   which reads as green if only failures are counted
4. **`no Core DB dependency`** — **G-CORE-01**

## 4. Migration path (non-destructive)

1. AI #10 announces a freeze point and records current `HEAD` per branch.
2. Each agent commits or stashes; AI #10 verifies nothing is left uncommitted in the shared tree
   (`git status` must be clean — today it is heavily dirty with several agents' work).
3. Create one worktree per agent from the agreed base.
4. Create the integration checkout and branch.
5. Wire the four merge gates into CI on the integration branch.
6. Remove the shared checkout **only after** every agent confirms their work is on their branch.

**Step 2 is the risky one** and should not be rushed: the working tree currently contains
uncommitted work from AI #1, AI #2, AI #3, AI #6, AI #7 and AI #9 simultaneously.

## 5. Interim rules until isolation exists

1. **NO BROAD MERGES.**
2. Never `git add -A` / `git add .` / `git commit -a`. Stage explicit paths.
3. Verify the stage (`git diff --cached --name-only`) **and** verify after committing that your
   files landed in *your* commit (`git log --diff-filter=A -1 -- <path>`). If they landed
   elsewhere, record it — do not re-commit.
4. **Never remove `.git/index.lock`.** Check `pgrep -fl "git "` first; it is usually `gc`.
5. Never commit a non-compiling state to a shared branch.
6. Announce destructive refactors in your own `docs/<area>/` before making them.
7. Every audit finding carries the commit it was verified against.

## 6. Success criteria

- [ ] No agent can stage another agent's files (each has its own index)
- [ ] Every commit's contents match its message
- [ ] `git log --diff-filter=A` attributes each file to the agent that wrote it
- [ ] Integration is a deliberate, gated act by AI #10
- [ ] The four merge gates run on every integration merge
- [ ] The shared checkout is retired with zero uncommitted work lost
