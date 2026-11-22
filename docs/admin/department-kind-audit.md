# Department-kind audit (access management, stage M2)

Branch `claude/admin-web-nav-ia`. Local only; the migration was applied to disposable databases only.
Owner decision (2026-11-22): complete this audit and correct every comparison that could confuse two distinct configurable
departments **before** any schema change. This stage changes **no behaviour** while only the three core kinds exist.

## What was audited
Four independent read-only audits, each citing file and line: the latest definition of every SQL function that reads a
department table or names a kind (65), the TypeScript API and Prisma schema, and the Admin Web. Their results are reduced to a
permanent registry, `apps/api/test/unit/authorization/department-kind-audit.json`, enforced by a spec: a new function that reads
department tables fails the build until it is classified.

## Findings and what was done
| Class | Count | Meaning | Action |
|---|---|---|---|
| core_only | 31 | restricts to operations/teachers/sales explicitly; a configurable department is excluded | none |
| id_scoped | 5 | joins or compares on the department **id** | none |
| not_affected | 15 | organization checks only | none |
| by_design | 5 | kind-agnostic on purpose and harmless (membership guards; own-department account administration, which also needs `staff_accounts.manage`; task assignee model; an identity helper used only behind a core guard) | documented |
| safe_by_empty_bundle | 2 | a kind with no `legacy_permission_bundle` rows gets no tier-default keys: a new department starts with **no access** | spec forbids adding such rows |
| **fixed_m2** | **8** | kind-agnostic reach, or two people's kinds compared with `=` | **corrected** (below) |

### The eight corrected rules (`20261124100000_chat_dept_kind_audit.sql`)
| Function | Defect with configurable departments | Fix |
|---|---|---|
| `staff_acts_for` | a manager of any department gets "manager" standing over its members; feeds family reach, conversation standing, family ownership and certificate acts-as | core departments only |
| `staff_principals` | a manager's members become "principals", feeding conversation visibility, learner transfers, case ownership | core departments only |
| `case_owner_fits` | a manager of any department "fits" any case ownership | manager branch core only |
| `work_task_standing` | manager standing over tasks of staff in any managed department | core only |
| `work_task_unmanaged` | any department counted as "managed", suppressing the unmanaged escalation | core only |
| `mention_role_targets` | notifies the manager of any department a supervisor sits in | core only |
| `content_report_managers` | a manager of any department named on a report receives it | core only |
| `may_void_testimonial` | **compared two people's department KIND with `=`**: two staff in two different general departments counted as the same department | compares department **ids**, core departments only |

New helpers: `chat.is_core_department_kind(kind)` (the one definition of "has built-in workflow semantics") and
`chat.staff_department_id(staff)`. Rollback script: `db/rollback/20261124100000_chat_dept_kind_audit.down.sql`.

## Proof
- **Neutral for the core kinds:** the whole API integration suite is unchanged and green, plus pinned controls for the edited rules (manager standing, principals, case fit, task standing, voiding by the Operations manager and super admin, a supervisor of another core department still refused).
- **Power of the new test:** a simulated future, run inside a transaction that is always rolled back (nothing is written), lifts the closed set and creates two distinct `general` departments with managers and members. They reach nothing: no manager standing, no principals, no case ownership, no task standing, no tier-default keys, and colleagues in different (or the same) general department cannot void testimonials. **Run against the pre-fix functions the same test fails; after the fix it passes.**
- Permanent guard: the registry spec above; and a check that no bundle row exists for a configurable kind.

## Deliberately not changed in M2 (stage M5 prerequisites)
These work today because `(organization_id, kind)` is unique, and become wrong or ambiguous when the unique is relaxed. They belong with the schema change, which keeps the unique **only for the three core kinds** (a partial unique index):
- `chat.department.kind` CHECK and `department_one_kind_per_organization`; Prisma `@@unique` (Prisma cannot express a partial unique, so the compound key `organizationId_kind` disappears) and its four call sites: `moderation/departments.ts`, `cli/review-cohort.ts`, `org/org-structure.service.ts` (`upsertDepartment`), plus `findFirst`-by-kind lookups that stay correct while core kinds stay unique.
- `org-structure.service` needs a create path for configurable departments and update-by-id; Admin Web has no create-department flow yet.
- Closed type unions in the Admin Web (`DepartmentKind`, `DEPARTMENT_LABEL[kind]`) must show the department's own name; `tasks` assignee lists key by kind.
- `findFirst({ managerId })` call sites assume one managed department per manager (true: `department_one_per_manager`).
- `staff_access_profile` and `staff_in_managed_department` read `department_member` and `department_account` respectively: the **department default role** (M5) must resolve through both tables or it would reach supervisors but not specialists.
- A manager who creates specialists in a configurable department (`create_staff_account`, `staff_in_managed_department`) is by design id-scoped and needs `staff_accounts.manage`; configurable-department managers hold none by default.

## Remaining risks
- Indirect callers of the corrected functions (conversation standing, family ownership, certificate acts-as) are covered by the existing integration suites, not individually re-audited; the guard sits at the shared helper, so they inherit it.
- `work_task_standing` still grants "manager" standing to the **creator** of a task who has the manager role (independent of departments). It is not a department rule; noted for the scopes stage (Tasks).
