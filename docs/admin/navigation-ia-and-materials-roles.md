# Admin Web navigation (IA) and educational-materials roles

Branch `claude/admin-web-nav-ia`. Local only: not pushed, merged or deployed. The migration was applied only to a throwaway
database used for testing; it has not been run on any shared or production database.

## Navigation: before and after
| Rail item | Before | After |
|---|---|---|
| Dashboard | Dashboard, Tasks | Dashboard, Tasks (Tasks has an **Escalations** tab with the open-case count) |
| Operations | Needs action, Trials (Teachers dept), Educational materials, **Escalations**, **Certificates**, Lesson audio | Needs action, Trials (Teachers dept), Lesson audio |
| **Certificates** | inside Operations | its own item |
| **Educational materials** | inside Operations | its own item (English label was "Materials") |
| Everything else | unchanged | unchanged |

`/cases` still works (the Escalations tab is that page); `/teachers/cases` redirects to it; the Teachers area's duplicate tab is gone.
Cases are not tasks: their page, lifecycle, permissions, database policies, audit history, chat cards, notifications, Dashboard tiles and Teacher File
action are untouched. The Escalations tab is shown to accounts holding `cases.manage`; the server still decides every list.

## Educational materials: who may do what
Three jobs, three keys. A key opens a route; the item's state and its author decide the rest, in the API **and** in the database trigger `chat.guard_material_item`.

| Role | Key | Can |
|---|---|---|
| Super admin; Teachers manager | `materials.manage` (unchanged: `chat.can_manage_materials`) | everything: create (draft or published), edit any item, retire, import, recitations, preview anything |
| Teachers supervisors | **`materials.review`** (new) | see the review queue + the published library; preview an item in review; **approve** (in_review → published) or **return** (→ draft); never the author of the item, never rewriting it |
| Designated Content authors (role `content_author`, granted by the super admin or the Teachers manager) | **`materials.author`** (new) | create drafts, edit **own** drafts, upload files for items, submit own draft for review (draft → in_review); see own items + the published library; no publish / retire / import / recitations |
| Teachers | `materials.view` (unchanged) | open **published** items only; no writing |
| Operations | `materials.view` (unchanged) | open published items only (the Operations manager's `materials.manage` bundle key never opened the workspace: the server refused it before and still does) |

An unreviewed item (draft, in review) is never served to a family, a teacher, a report picker or a child's library: the readers return `published` only.
Existing items and statuses are untouched. New status `in_review` (migration `20261122100000_chat_materials_author_review.sql`).

## Certificates
No permission change. The Marketing Designer (`designer` role: `certificates.view` + `certificates.design`, specialist tier) designs and uploads; it holds none of request / deliver / story / oversee / types, so it
has no student-request, delivery or configuration access. Operations supervisors, Teachers supervisors, the two managers and the super admin keep their existing keys. No Marketing Manager role was invented.

## Lesson Registration
Unresolved by the owner's instruction. No page of that name exists in Admin Web; nothing was removed, renamed or modified.

## Tests run
API unit 209 suites / 3,020 tests; API integration (pd040, pd041, pd048, pd049, supervision cases, staff privilege, materials, new `materials-roles.spec.ts`) 201 + 23 new; Admin Web 116 files / 1,340 tests; both type-checks.
