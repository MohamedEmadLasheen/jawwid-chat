# Domain Reconciliation

Date: 2026-09-06 · Auditor: AI #4 · Status: 🟡 **PARTIAL — 2 of 5 questions BLOCKED ON PRD**

> **Authority caveat.** PRD v0.1 is **not in the repository** (Phase 1 BLOCKED).
> This document reconciles what the *code* says and marks every product question
> the code cannot answer. **No product behaviour is invented here.** Where the
> answer requires the PRD, the row says so and stops.

## 1. Entity reconciliation — current state across agents

| Entity | AI #1 (SQL `chat`) | AI #2 (Prisma/services) | AI #3 (Flutter) | AI #4 (Admin Web) | Reconciled? |
|---|---|---|---|---|---|
| **Family** | `chat.family` | `family` | family-scoped views | `FamilyDetail` | ✅ agreed |
| **Parent** | `chat.contact` + 6 capability flags | `ConversationMember{actorKind:CONTACT}` | `ParticipantRole.parent` | `Contact` (flags, **no phone**) | ✅ agreed; preset→flag map is **AMB-10** |
| **Student (learner)** | `chat.learner` | `learnerId` on conversation | `LearnerRef` | `Learner` | ✅ agreed |
| **Teacher** | `learner.teacher_id` — bare uuid, **no FK, no identity** | `ActorKind.TEACHER` exists in conversation members | `ParticipantRole.teacher` | ❌ **absent from `StaffRole`** | ❌ **DIVERGENT** — see §3C |
| **Admin / Coverage / Manager** | `staff.role` enum | `ActorKind.STAFF` + role | — | `StaffRole` union | ✅ agreed; no `super_admin` anywhere |
| **Ownership** | `family.owner_id` + `transfer_ownership()` | — | — | owner vs on-duty rendered separately | ✅ agreed |
| **On-duty** | `chat.on_duty()` | `coverage.service.ts` | `handledByLabel` (verbatim) | `on_duty.mode` | ✅ agreed |
| **Conversation** | `chat.conversation` + `type` | `conversation.service.ts` + `ConversationMember` | `ConversationKind{jawwidSupport, studentGroup, adminDirect}` | ❌ **`thread.family_id UNIQUE`** | ❌ **DIVERGENT** — AI #4 is the outlier |
| **Student Group** | `type='student_group'`, `learner_id` | implemented | `studentGroup` kind | ❌ absent | 🟡 AI #4 lagging |
| **Message** | `chat.message` | `message.service.ts` | `Message` + `ApprovalState` | `Message` | 🟡 casing + field divergence |
| **Approval** | — | `approval.service.ts` + events | `ApprovalState` + `rejectionReason` | ❌ absent | 🟡 AI #4 lagging |
| **Call** | `chat.call_participant` + trigger | `call.service.ts` + events | ❌ none | ❌ absent | 🟡 backend-only |

**Headline:** since my last audit AI #2 has implemented conversations,
approvals and calling server-side. **Admin Web is now the least PRD-conformant
consumer in the system**, not AI #3.

## 2. The single largest divergence

Three conversation models coexist. Only one can survive:

| Model | Shape | BR-1 evaluable? |
|---|---|---|
| AI #4 | one thread per family (`family_id UNIQUE`) | ❌ no participant set |
| AI #3 | `ConversationKind` — forbidden channel unrepresentable in the type system | ⚠️ kinds, no explicit member list |
| **AI #1/#2** | `chat.conversation{type}` + `conversation_member{actor_kind, member_role}` | ✅ **yes — typed + explicit members** |

**Recommendation: AI #1/#2's `conversation` + `conversation_member` is the only
model that can carry BR-1**, because BR-1 must be evaluated over
*(actor, conversation, channel)* and it is the only one with an explicit
participant set. AI #3's `ConversationKind` should map onto it as the client-side
projection. **AI #4 must adopt it.**

## 3. The five required resolutions

### A. One family may contain multiple students — ✅ **SUPPORTED, no change**
`chat.learner.family_id` is many-to-one; `Family 360` already renders a learner
list; `LearnerRef` scopes group rows per child. No agent assumes one student per
family. **Resolved by existing code.**

### B. One official Student Group per student — 🔴 **BLOCKED ON PRD**
The code permits `chat.conversation{type='student_group', learner_id}` but
**enforces no uniqueness** on `(learner_id, type)`. Whether exactly one official
group per student is required — and whether a second is a defect or a legitimate
case (e.g. per subject, or an archived predecessor) — **is a product question the
PRD must answer.**

*I will not add a uniqueness constraint on an assumption.* Note AI #9's **RT-025**
already flags `class_group` as unscoped, which is the same gap seen from the
security side.

### C. Teacher ≠ CS Staff — ⚠️ **PARTIALLY RESOLVED, one P0 remains**
Correct today: `ActorKind.TEACHER` is distinct from `ActorKind.STAFF`;
`ParticipantRole.teacher` is distinct from `.admin`; `staff.role` has no teacher.
**The separation is right and must be preserved.**

Still broken: `chat.learner.teacher_id` is a bare uuid with **no FK and no
identity table** — a teacher cannot authenticate. Admin Web has no teacher actor
at all, so it cannot render a Teacher↔Admin conversation or a teacher group
member.

**Do not fix this by adding `teacher` to `staff.role`.** That would make teachers
CS staff and hand them family-facing permissions — inverting BR-1. Teacher needs
its own identity, authenticating independently, permanently barred from a 1:1
with a parent. *Owner: AI #1.*

### D. Permanent Owner vs on-duty coverage stay distinct — ✅ **HOLDS**
`family.owner_id` is mutated only by `transfer_ownership()` (audited, reason
required, manager-only). `on_duty()` is a pure function of shifts/rules/absences
and never writes ownership. Coverage and handoff do not change ownership. Admin
Web renders the two on separate lines and has 8 tests fixing this. **No
divergence found.**

⚠️ One caveat: AI #9 **RT-004** reports `deriveMode` now returns the caller's
fallback, stamping every internal note `OWNER` regardless of who owns the family.
That does not change ownership, but it **writes a false ownership claim into the
audit trail**. Owner: AI #2.

### E. Student Groups must not become Teacher↔Parent channels — 🔴 **NOT ENFORCED**
See §4. This is the live P0.

## 4. BR-1 — enforcement gap (AI #9 RT-024, runtime-confirmed)

The database backstop validates **membership** but not **type**:

```sql
-- legal student group, allowed
insert into chat.conversation_member … ('teacher','teacher'), ('contact','parent');
-- then simply change what it is:
update chat.conversation set type='direct', direct_key='…', learner_id=null where id=:conv;  -- ALLOWED
```

Result: `direct | contact | parent` + `direct | teacher | teacher` — precisely
the channel BR-1 forbids. **Calling has the identical bypass**:
`enforce_call_participant_rules()` is also attached only to `call_participant`.

### Required enforcement surface (specification, not implementation)

BR-1 must hold across **every** mutation path, not just creation:

| Path | Required | Today |
|---|---|---|
| Conversation **creation** | reject teacher+parent in a `direct` | ✅ trigger |
| **Membership** change | re-validate on INSERT **and UPDATE** of `conversation_member` | ⚠️ INSERT only |
| **Type** change | re-validate on `UPDATE OF type, direct_key, learner_id` on `conversation` | ❌ **none — RT-024** |
| **Call** creation / participants | same predicate, same code path | ⚠️ same INSERT-only gap |
| API paths | one policy, server-side | ⚠️ partial |
| SQL paths | trigger backstop in the schema the code targets | ❌ RT-026 |
| Realtime paths | authorize per recipient | ⚠️ unverified |

**The fix is a statement-level trigger on `chat.conversation` UPDATE that
re-runs the same predicate** — plus the same on `conversation_member` UPDATE, and
the call equivalents. One shared predicate function, four triggers.

**I have not written it.** `supabase/migrations/20260905093000_chat_communication.sql`
is being modified in the working tree by another agent right now; editing it
would collide and violate the Phase 8 rule. **Owner: AI #1.**

**Do not "solve" this by removing Student Groups** — that removes the one channel
BR-1 *permits* and is the JC-002 error. Do not weaken the rule.

## 5. AMB-9 — still explicitly UNRESOLVED

> *"Required admin presence/authorization" in a Student Group is undefined.
> Member? online? on-duty? Does the group become invalid if the admin is removed
> or offboarded?*

Re-verified today: **no agent has encoded an admin-presence predicate anywhere.**
AI #3 keeps `requiresApproval` backend-supplied; AI #2's approval service decides
on backend policy; no `isAdminPresent()` exists in any layer.

AI #9's **RT-025** confirms it from the attack side: *"BR-1's required admin
presence unenforced."* That is the correct state — **unenforced because
undefined**, not enforced wrongly.

**It must be enforced once, explicitly, after the PRD defines it — and not before.**

## 6. Blocked on PRD (Phase 1)

| # | Question |
|---|---|
| B-1 | Exactly one official Student Group per student? (§3B) |
| B-2 | AMB-9 — what "required admin presence" means (§5) |
| B-3 | Do `case`, and response targets, survive in PRD v0.1? |
| B-4 | Attention bucket vocabulary |
| B-5 | Approval scope — which message types/groups require approval (AMB-11) |
