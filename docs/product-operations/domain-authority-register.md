# Domain Authority Register — One Definition Per Entity

**Owner:** AI #8 (audit) · **Date:** 2026-09-06
**Governing decision:** SQL migrations are the **only** schema authority. Prisma is a **query
client only**. There must be exactly one definition of each domain entity.

**Purpose.** Prisma reintroducing a competing schema is a silent failure — nobody gets an
error when a second definition appears; the two simply drift until a default or a constraint
disagrees. This register is the artifact that makes such a drift visible.

---

## 1. Status at `4ff47c3`

**Prisma has converged onto the SQL schema.** It now declares
`previewFeatures = ["multiSchema"]`, `schemas = ["chat"]`, and `@@schema("chat")` per model —
so it maps onto `chat.*` rather than defining a parallel `public.*` schema. CI runs
`npx prisma generate` only; no `prisma migrate` and no `prisma db push` appear anywhere
(`ci.yml:124`, `:232`). **The client-only rule currently holds.**

`StudentGroup` and `StudentGroupMember` are gone from Prisma, replaced by `Conversation` and
`ConversationMember` — the superseded `/// DESIGN-ONLY` block (DB-M8) has been removed.

**This is a substantial correction of my earlier finding X-01 and DB-M1.** They described two
competing schemas; that is no longer accurate. What remains is narrower and is recorded below.

## 2. The register

| # | Entity | SQL authority | Prisma client model | One definition? |
|---|---|---|---|---|
| 1 | **Family** | `chat.family` (`…090300`) | `Family` `@@schema("chat")` | ✅ |
| 2 | **Parent** (family contact) | `chat.contact` | `Contact` | ✅ |
| 3 | **Student** (learner) | `chat.learner` | `Learner` | ✅ |
| 4 | **Teacher** | **none** — `chat.learner.teacher_id`, a bare uuid, no table, no FK | none | ❌ **CF-08 — no definition anywhere** |
| 5 | **Admin** (staff) | `chat.staff` | `Staff` | ✅ |
| 6 | **Conversation** | `chat.conversation` (typed) (`…093000`) | `Conversation` | ⚠️ **legacy `Thread` persists in both** |
| 7 | **Student Group** | `chat.conversation` `type='student_group'` + `conversation_one_group_per_learner` | `Conversation` | ✅ |
| 8 | **Message** | `chat.message` (extended in place) | `Message` | ✅ |
| 9 | **Approval** | `chat.message_approval` | `MessageApproval` | ✅ |
| 10 | **Call** | `chat.call`, `chat.call_participant` | `Call`, `CallParticipant` | ✅ |
| 11 | **Ownership** | `chat.family.owner_id` + `transfer_ownership()` + `guard_owner_change()` trigger (`…090700`) | `Family.ownerId` (column only) | ✅ — enforcement is SQL-side, correctly |
| 12 | **Coverage** | `chat.shift`, `coverage_rule`, `absence`, `on_duty()`, `effective_handler()` (`…090600`) | not modelled | ✅ |
| 13 | **Task** | `chat.task`, `chat.support_case` (`feat/backend-foundation`) | not modelled | ✅ |
| 14 | **Notification** | `chat.notification`, `notification_rule`, `notification_template`, `device_token`, `quiet_hours` | matching models | ✅ |

## 3. Open items

| # | Item | Sev |
|---|---|---|
| **DA-1** | **Teacher has no definition in any stack.** Not a divergence — an absence. See CF-08 and §4 | **P0** |
| **DA-2** | **`Thread` survives alongside `Conversation`** in Prisma (`model Thread`, line 107) and in SQL (`chat.thread`, referenced by `chat.conversation.thread_id`). Two conversation-shaped entities coexist; which one the services target decides whether the BR-1 triggers on `conversation_member` actually guard live traffic (AI #9 **RT-026**) | **P1** |
| **DA-3** | `Thread @@unique([familyId, kind])` — re-verify it is gone from the Prisma `Thread` model. If `Thread` is retained for migration purposes it must not carry a constraint that contradicts `conversation_one_group_per_learner` | **P1** |
| **DA-4** | No mechanism prevents a future `@@map` to a table Prisma also *defines*. The register above is the control; it must be re-run at each merge | **P2** |

## 4. Teacher identity — CF-08 (remains blocking)

**Current mechanism, and why it must not ship.** `PrismaIdentityService.resolveActor()`
resolves a teacher by `this.prisma.learner.findFirst({ where: { teacherId: actorId } })` and
returns `{ kind: TEACHER, displayName: 'Teacher', isActive: true }`.

Three properties make this unfit for any deployed environment:

1. **Any uuid present in `chat.learner.teacher_id` authenticates as a teacher.** The column has
   no FK and no identity behind it, so the set of valid teacher principals is whatever a sync
   job happened to write.
2. **`isActive: true` is hardcoded.** A teacher cannot be deactivated. Offboarding a teacher is
   not expressible.
3. **`displayName: 'Teacher'`** — the actor has no name, so no surface can attribute a message
   to a person.

AI #1 declares this a temporary seam and says so in the file. **The seam is honest; the risk is
that it is invisible once the API boots.**

**Required invariant.**
> **INV-CF08** — A teacher is a first-class Chat-owned actor with its own identity record,
> independently deactivatable, and resolvable without reading a relationship column. Teacher
> identity is **never** inferred from `learner.teacher_id`, and **never** requires a direct
> Core database read.

**Core boundary.** Teacher↔learner assignment may be **synchronised** through the API/webhook
boundary into Chat-owned tables. It must not be a Core DB read (CF-09, C-01…C-05).

**Still an open product decision — not decided here.** Who is authoritative for the
teacher↔learner assignment (**OD-04**), and what "required admin presence" in a Student Group
means (**OD-03 / AMB-9 — must not be guessed**).

**Acceptance criteria.** (1) A Chat-owned teacher identity exists with an `is_active` flag;
(2) `resolveActor` reads it, not `learner`; (3) a deactivated teacher is denied on messaging,
calling and group membership; (4) a teacher actor carries a real display name;
(5) no teacher resolution path touches `public.*`.

## 5. Conversation model — reconciliation conditions

The model must support: multiple students per family · one official Student Group per student ·
direct conversations where allowed · Student Group conversations · official conversations ·
class groups **if explicitly required by the PRD**.

`chat.conversation` supports all six shapes today: `type in ('direct','student_group',
'class_group','official')`, `learner_id` scoping, `conversation_one_group_per_learner`, and an
explicit participant set in `conversation_member`.

**Two conditions before this can be called reconciled:**

- **DA-2/DA-3** — the legacy `Thread` must not retain a constraint or a role that contradicts
  the conversation model, and the services must target `chat.conversation` (RT-026).
- **PRD ratification** — whether `class_group` is required at all is
  **UNVERIFIED — PRD SOURCE NOT PRESENT**. It is currently in the CHECK constraint. Carrying an
  unused enum value is harmless; building behaviour for it is scope creep. **Neither is decided
  here.**

## 6. Merge-time checklist

- [ ] Every entity in §2 has exactly one SQL definition
- [ ] No Prisma model defines a table; every model carries `@@schema("chat")`
- [ ] No `prisma migrate` / `prisma db push` in CI, scripts or package.json (G-CORE-06)
- [ ] `Thread` is either removed or provably inert (DA-2)
- [ ] Teacher has a Chat-owned identity (DA-1 / CF-08)
- [ ] Services target `chat.conversation`, so the BR-1 triggers guard live traffic (RT-026)
