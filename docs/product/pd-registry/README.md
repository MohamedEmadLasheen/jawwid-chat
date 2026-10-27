# PD numbers: one file per claim

A product-decision number is claimed by **adding a file** here. Nothing else is
edited to claim it, so two sessions claiming at the same time add two different
files and never conflict.

```
docs/product/pd-registry/PD-<n>.md                    a decision
docs/product/pd-registry/PD-<n>-amendment-<slug>.md   an amendment (keeps the parent number)
```

Each file is a front-matter block of `key: value` lines, then optional notes:

```
---
pd: PD-39
kind: decision            # or: amendment
subject: One line saying what is decided
branch: claude/pd39-something-abc123
pr: #160                  # several: "#160, #161"; empty until a PR exists
state: IN PROGRESS        # IN PROGRESS | OPEN | MERGED
---
Optional notes. The decision text itself lives in the boundary doc §4.
```

**To claim:**
1. Print the index with `python3 -I scripts/docs/registry-index.py`. It shows the next free number.
2. Add `PD-<that number>.md` in your branch, before any code, doc or migration names the number.
3. A number that has no file is not yours.

PD-1 … PD-21 are recorded in the boundary doc §4 and are never claimed here.

Update your own file's `pr:` and `state:` as the work lands. Only you edit it.

The guard `bash scripts/qa/guards.sh pd-registry` runs in CI. It fails on:
- the same number claimed twice;
- a file whose name does not match its fields;
- a claim of PD-1 … PD-21.
