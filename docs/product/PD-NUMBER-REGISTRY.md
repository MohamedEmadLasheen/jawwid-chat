# Product decision numbers and migration slots — moved

Since 2026-10-27 the registry is **one file per claim**:

- `docs/product/pd-registry/PD-<n>.md`: a PD number (amendments are `PD-<n>-amendment-<slug>.md`). See [its README](pd-registry/README.md).
- `docs/product/migration-slots/<timestamp>.md`: a migration timestamp. See [its README](migration-slots/README.md).

Print the index, with the next free number and slot, by running:

    python3 -I scripts/docs/registry-index.py

The index is printed, never committed. Claiming means **adding a file**, so parallel PRs no longer conflict on one table and one "next free" footer, as nearly every PR of the week of 2026-10-26 did. The guard `bash scripts/qa/guards.sh pd-registry` runs in CI. It refuses a duplicate PD number or migration timestamp, and a migration with no slot claim.

## Rules that did not change

1. **Claim before you write.** A number or slot without a file is not yours.
2. **Amendments keep the parent number** ("PD-N amendment", not a new number).
3. **Migration timestamps are unique and sort last at merge time.** Before merging, make sure your migration's timestamp is later than the newest file in `supabase/migrations/` on `main`. If it is not, rename the migration and its slot file together.
4. **One merge at a time.** Merge `origin/main` into your branch, re-run the gates, then merge.

The decision text itself still lives in [`JAWUID-CHAT-PRODUCT-BOUNDARY.md`](JAWUID-CHAT-PRODUCT-BOUNDARY.md) §4. Every row of the old table (PD-22 … PD-38 and every slot from `20261022130000`) was moved into these files on 2026-10-27.
