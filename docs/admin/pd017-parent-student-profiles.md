# PD-17: Parent Profile, Student Profile, and payments recorded in Chat

Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-17 (closed 2026-10-21).
Migration: `supabase/migrations/20261021150000_chat_pd017_parent_student_profiles.sql`
(runs after PD-16's `20261021140000`).
Code: `apps/api/src/parent-profile`, `apps/api/src/billing`, `apps/api/src/lessons/enrollment.service.ts`
(`profile`), `apps/admin-web/src/features/profiles`, `lib/features/student_profile`.

## Who sees what

| | Super admin, Operations Manager | Operations supervisor / coverage | Sales department | Child's own teacher | Teachers department | The family's billing parent | Anyone else |
|---|---|---|---|---|---|---|---|
| Parent Profile: contact, note, children — read | every parent | parents of families they reach (PD-8) | every parent | **never** | **never** | **never** | **never** |
| — edit (name, phone, e-mail, region, note, photo) | every parent | families they reach | **no** | **never** | **never** | **never** | **never** |
| Family money: read and record (plan, method, instalments, payments, voids) | every family | families they reach | every family | **never** | **never** | own family, **read only** (`/me/billing`), nothing voided | **never** |
| Billing supervisor | set | — | — | — | — | — | — |
| Student Profile | every child | children they supervise (+ backup, manager) | **never** | **their own students** | every child | **never** (their children are on their own profile) | **never** |

"Reach" is `chat.staff_reaches_family`, the same as Instalment Payments
(`billingAccessOf`). Refusals: `COMM.PARENT_PROFILE_DENIED` (403, before any
lookup), `COMM.PARENT_PROFILE_NOT_FOUND` (404: unknown, or out of reach — the
same answer), `COMM.BILLING_DENIED`, `COMM.LESSON_NOT_FOUND` (a teacher's
non-student, the same 404 as an unknown id).

## Routes

| Route | What |
|---|---|
| `GET /parent-profiles?q=` | The parents this staff member may open. |
| `GET /parent-profiles/:contactId` | Name, photo, family, contact `{phone, email, countryCode, region}`, `adminNote`, children. |
| `POST /parent-profiles/:contactId` | `{name?, phone?, email?, countryCode?, region?, adminNote?}` — partial; null clears (not the name). |
| `POST /parent-profiles/:contactId/avatar/upload`, `POST .../avatar`, `DELETE .../avatar` | Change the parent's photo (the one every chat shows); bytes judged as for `/me/avatar`; audited "set by an administrator". |
| `GET /families/:id/billing` | Payment method, currency, plan (1/3/6/12 months), every instalment in date order, totals per currency. |
| `POST /families/:id/billing` | `{paymentMethod?, currency?, planMonths?}` — partial; null clears. |
| `POST /families/:id/instalments` | `{label, amountMinor, firstDueDate, currency?, count? (1–24), everyMonths? (1–12), learnerId?}` — one instalment or a plan. |
| `POST /instalments/:id/payment` | `{paidOn (≤ today), method?, reference?}` — once; `COMM.BILLING_STATE` (409) after. |
| `POST /instalments/:id/void` | `{reason}` — final. |
| `GET /instalments` | Instalment Payments: open (and with `paid=true`, paid) rows in scope; voided rows never. |
| `GET /me/billing` | The parent's own family: plan, method, currency, every instalment that stands (no voided rows, no staff names, no reasons), totals. Only the contact with `can_manage_billing`; anyone else `COMM.BILLING_DENIED`. |
| `GET /learners/:id/profile` | Photo, name, age, course, teacher, weekly slots; staff also `birthDate` and `family.parents`. |

Photos on both profiles are `/media/avatars/<kind>.<id>.profile` links; each
request re-applies the profile's own rule (`AvatarService.registerProfileReader`).

## Where the data lives

* **Name, photo:** `chat.contact.name` / `avatar_object_key` — one value, shown everywhere.
* **Phone, e-mail, emirate/governorate, internal note:** `chat.parent_file` (admin-only,
  confined to `src/parent-profile` by `parent-file-confinement.spec.ts`; G-07 allows the
  one phone declaration). Seeded at Assign (PD-16) from Sales' form, and backfilled for
  families enrolled before this migration.
* **Country, plan:** `chat.family.country_code` / `subscription_plan_months` — the columns
  Stories targeting reads; written with `segment_source = 'admin'`.
* **Payment method, currency:** `chat.family_billing` (seeded at Assign from the form).
* **Instalments and payments:** `chat.family_instalment`. Append-only, enforced by
  `chat.guard_family_instalment`: terms never change, a payment is recorded once and never
  changed, a void is final with a reason, no row is ever deleted.

## Audit

`parent_profile.updated` lists the changed field NAMES (a rename keeps the names),
never a phone or e-mail. `family.billing_set`, `instalment.created`,
`instalment.paid`, `instalment.voided` carry amounts, currency and dates.
`profile_photo.set|removed` with reason "set/removed by an administrator".

## Enforcement in the clients

* **Admin Web:** *Parents* is offered only when `GET /instalments/access` says
  `billingReader` (the super admin has it as an Admin Portal section); a parent's
  name links to their profile in a conversation's members only for those viewers.
  The pages render the server's 403/404 as a plain refusal. The server is the control.
* **App (parents):** Settings › Payments, for the billing parent only; it calls `/me/billing` and nothing else about money.
* **App (teachers):** a teacher opens `/students/:learnerId` from a child's card in group
  info, only for their own students; anyone else is redirected. There is no Parent
  Profile in the app, and a guard test fails if any file under `lib/` names
  `/parent-profiles`, `/instalments` or a family billing path.
