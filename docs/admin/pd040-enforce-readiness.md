# PD-40 · Enforce readiness: the production staff audit

Before `PermissionGuard` switches from SHADOW to ENFORCE (PD-40 PR-6), we need to know which active staff accounts would lose pages. Only the legacy tiers change behaviour:

- **Finance, technical and academic accounts.** Their bundle is empty, so they keep only their own self-service routes.
- **A manager or supervisor in no department.** They fall to the small `manager:none` or `supervisor:none` bundle.
- **A placement that doesn't fit the tier**, for example a manager listed as a member. This also falls to the `:none` bundle.

The super admin and specialists are not affected.

The systest personas are all placed correctly, so only production data can answer this.

## Who runs it

**The operator or the owner, against production.** No Claude session connects to production.

The script is read-only. It opens a `READ ONLY` transaction, runs one `SELECT`, and ends with `ROLLBACK`. It prints counts and staff ids, never a name or an e-mail. `apps/api/test/unit/ops/pd040-enforce-readiness.spec.ts` keeps it that way.

```bash
psql "$PRODUCTION_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/ops/pd040-enforce-readiness.sql
```

## Reading the result

- **`count` rows:** one row per organization, tier, department kind, position and verdict, with the number of staff.
- **`staff` rows:** every at-risk account, with its staff id, role and verdict.

| Verdict | Meaning | What to do before enforcing |
|---|---|---|
| `fits` / `not affected` | Nothing changes. | Nothing. |
| `legacy_department: empty bundle` | The account keeps only self-service routes. | Grant it an access role, change its role, or accept the loss. |
| `no placement: <tier>:none bundle` | A manager or supervisor in no department. | Place them in the organization structure (PD-8), or accept the small bundle. |
| `placement does not fit the tier: …` | For example, a manager listed as a member. | Correct the placement. |
| `unknown role: no bundle` | A role outside the catalogue. | Investigate before enforcing. |

Send the output (ids and counts only) to the department head. Switching to enforce stays the owner's decision.
