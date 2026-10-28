# PD-42 — entering families by hand (the intake from Jawwid Core)

Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-42. Plan: `docs/product/pd042-direct-enrolment-plan.md`.

## Before anyone enters a family (operator)

The steps are in this order:

1. **Deploy:** set `SALES_FAMILY_SCOPE=all` explicitly. An unknown value refuses to boot, and deploys do not default it.
2. **Key every existing family:**
   - Run `node dist/cli/family-contact-keys-backfill.js` (a dry run) and read its report: collisions and unreadable phones, by family id only.
   - Then run it again with `--apply`. Add `--accept-gaps` only after the gaps were looked at.
   - `--apply` sets `intake.contact_keys_ready`, which opens `/family-intake`. Until then it answers `INTAKE_NOT_READY` and "Add family" is not shown.
3. **During the intake:** supervisors enter their families.
4. **Before the Sales switch (D2):**
   - Run `node dist/cli/pd042-ownership-report.js --text`. It is read-only. Exit status 0 means every family has an Operations supervisor or a Sales owner; 1 means some have neither, and they are listed by id.
   - The Operations manager and the Sales manager sign off the counts per person.
   - With the owner's GO, set `SALES_FAMILY_SCOPE=own` and restart. Switching back is a restart with `all`.

## Who does what

| Act | Who | Where (Admin Web) |
|---|---|---|
| Add a family | an Operations supervisor (placed on themself); a Sales member (owns it); a manager or the super admin **for** one of their supervisors | Parents → **Add family** |
| Add a child | whoever owns the family | Parent Profile → Children → **Add child** |
| Set the sign-in e-mail (the parent had none at intake) | whoever owns the family | Parent Profile → Ownership and sign-in |
| Choose the Operations supervisor of a waiting family | the Operations manager (their department), the super admin | New Students → Families entered by hand → **Choose the supervisor**; or the Parent Profile |
| Suggest one (D1) | the family's Sales owner | the same places → **Suggest a supervisor** |
| Change the Sales owner | the Sales manager, the super admin (a reason is required) | Parent Profile → Ownership and sign-in |
| The child's package from Core: enter it after the intake, or correct it | the supervisor who entered the child (within 14 days); the three managers | Student Profile → Current package |
| A trial sibling | the Operations manager | New Students → the trial's Assign → **Add to «parent»'s family** |
| Read the family's history | whoever owns the family | Parent Profile → Family history |

A manager whose department has nobody to enter a family for sees "Add family" disabled, with what to do first.

## Routes (`/family-intake`)

| Method | Path | Key | Notes |
|---|---|---|---|
| GET | `options` | `new_students.manage` | `{ standing, manager, ready, onBehalfOf, noTeam, teachers }` |
| POST | `/` | `new_students.manage` | `{ intakeId, parent: { name, phone?, email?, country? }, children: [...], payment?, onBehalfOf?, confirmOver? }`. A replayed `intakeId` answers the first result. |
| POST | `families/:id/children` | `new_students.manage` | `{ intakeId, children, confirmDuplicate?, confirmOver? }` → `{ …, group: joined \| none \| not_joined }` |
| POST | `families/:id/sign-in-email` | `new_students.manage` | `{ email }` |
| GET | `entered` | `new_students.view` | New Students' families entered by hand. The sign-up code is shown only to whoever relays it now. |
| GET | `families/:id` | `new_students.view` | sign-in, owners, `can`, the choices for the dialogs |
| GET | `families/:id/history` | `new_students.view` | S4, oldest first; no phone or e-mail |
| POST | `families/:id/operations-supervisor` | `org.manage` | `{ supervisorId }`: once; a later move is PD-24's transfer |
| POST | `families/:id/supervisor-suggestion` | `new_students.manage` | `{ supervisorId }`: the Sales owner only |
| POST | `families/:id/sales-owner` | `org.manage` | `{ staffId, reason }`: the Sales manager or the super admin |
| GET / POST | `learners/:id/carried-over` (and `/void`) | `subscriptions.carry_over` | the package panel; enter `{ total, completed, planMonths?, confirmOver? }`; void `{ reason }` |

PD-16 Assign (`POST /trials/new-students/:trialId/assign`) also takes `{ familyId }`. It adds the form's children to the family the trial's parent is already in. The match uses only the form's own e-mail and number.

Refusals: `INTAKE_DENIED`, `INTAKE_NOT_FOUND`, `INTAKE_INVALID`, `INTAKE_STATE`, `INTAKE_NOT_READY`, `PARENT_EXISTS` (one answer for a parent the caller may not act on; the family is named only to its owner), `CHILD_EXISTS`.

## Permission keys (PD-40 catalogue)

These rows come from PD-42 itself. The catalogue in `catalogue.ts` and `legacy-bundles.ts` is equal to the tables (`pd040-catalogue-seed.spec.ts`):

- `subscriptions.carry_over`: risk `finance`, not delegable. In `supervisor|manager` × `operations|sales` (migration `20261028110000`).
- `parents.edit` for `supervisor:sales` and `manager:sales`: limited in the service to the families a Sales account owns (migration `20261028210000`, `LATER` block `pd042b`).
- No other key. Placing a family and changing a Sales owner use `org.manage`, and enter/view use `new_students.*`. Layer 2 narrows each route; `pd042-intake-routes.spec.ts` pins which bundles pass each one.

## Database rules (the backstop)

- `chat.family_contact_key`: one family per parent per academy.
- `chat.student_enrolment`:
  - origin `trial | intake`, kind `new_family | added_children`;
  - an intake lists only children it creates, and is written by someone who owns the family;
  - `chat.learner_intake` records who entered each child.
- `chat.family_sales_owner`: a live Sales member; set by the Sales manager or the super admin. A Sales member owns only a family they are entering.
- `chat.learner_supervision`: placed by the Operations manager, except a supervisor placing on themself a child they are entering.
- `chat.family_supervisor_suggestion`: written only by the family's Sales owner, naming a live Operations supervisor.
- `learner_subscription` `carried_over`: the five conditions of `PD-30-amendment-carried-over`.
- **The Sales guards** (`zz_pd042_sales_scope`, SECURITY DEFINER): under `own`, they refuse a Sales member's write to a family they do not own.
