# Migration slots: one file per claim

A migration timestamp is claimed by **adding a file** named after it:

```
docs/product/migration-slots/<14-digit timestamp>.md
```

```
---
slot: 20261027100000
pd: PD-39                  # must have a file in ../pd-registry/
migration: chat_pd039_something   # the migration's name without timestamp and .sql
pr: #160
---
Optional notes (renumbered from …, sub-slots …).
```

**Rules**
1. **Claim before you write the migration.**
   - Print the highest claimed slot with `python3 -I scripts/docs/registry-index.py`.
   - Add your slot file, with a timestamp later than every slot and every file in `supabase/migrations/` on `main`.
   - Sub-slots of one PD (for example `…160001`, `…160002`) are each a file of their own.
2. **Timestamps are unique.** `scripts/db/apply.sh` keys its ledger on the whole filename, so a duplicate timestamp does not fail. It silently orders by the suffix instead.
3. **Renumbering is a rename.**
   - When a later merge makes you move your migration, rename the slot file in the same commit.
   - Keep the old timestamp as a note.

The guard `bash scripts/qa/guards.sh pd-registry` runs in CI. It fails on:
- two migrations with the same timestamp;
- a slot naming a PD with no registry file;
- any `supabase/migrations/*.sql` from `20261022130000` (when the registry began) that has **no slot file**, or whose name differs from its claim.
