> **STATUS: HISTORICAL** (Phase 0, 2026-09-07). Parallel-agent reconciliation record recovered in Phase 0. Decisions it fed are consolidated under `docs/product`, `docs/architecture`, `docs/contracts`, `docs/security` and `docs/recovery`.
> Canonical index: `docs/README.md`.

# Backend Architecture Decision Memo

Date: 2026-09-06 · Owner: AI #10 acting as Backend Architecture Decision Owner
Status: **DECISION MEMO — no code changed, nothing merged, nothing cherry-picked**
Integration HEAD at time of writing: `ed3216d` (unchanged by this memo)

All findings below were produced by reading the actual implementations and by
executing them against disposable stock `postgres:17` databases. Both disposable
databases and both verification worktrees were destroyed afterwards; the
integration branch was never modified.

---

## DECISION 1 — `call_type_immutable`

**Canonical:** `20260905093300_chat_br1_structural_backstop.sql` (already on HEAD).

**Are they functionally identical?** In outcome, yes; in diagnostics, no.

| | 093300 `forbid_call_type_change()` | 090200 `enforce_call_type_immutable()` |
|---|---|---|
| Type unchanged | returns | returns |
| Type changed → teacher+contact participants | `restrict_violation`, generic message | `check_violation`, BR-1-specific message |
| Type changed → any other case | `restrict_violation` | falls through to `restrict_violation` |
| Net effect | **every** type change refused | **every** type change refused |
| Re-runnable | `drop trigger if exists` first | **no drop guard** |

Both refuse the identical set of operations. 090200's only distinctive value is a
more specific error message in the BR-1 case. That is diagnostics, not a control.

**Reason.** Three architectural points, in order of weight:

1. **093300 is a complete control; 090200 is a fragment.** 093300 protects calling
   with `forbid_call_type_change()` *plus* `assert_call_br1()` — which independently
   requires a Jawwid staff participant whenever a call pairs a teacher with a
   contact, and caps a `direct` call at two participants — enforced by deferred
   constraint triggers on **both** `chat.call` and `chat.call_participant`. 090200
   covers type immutability alone. Choosing 090200 as canonical would mean keeping
   093300 anyway.
2. **093300 is idempotent; 090200 is the file that breaks the chain.** 090200 issues
   `create trigger call_type_immutable` with no drop guard. Proven on a disposable
   clean DB built from HEAD: applying it after 093300 fails with
   `ERROR: trigger "call_type_immutable" for relation "call" already exists`.
3. **One trigger name, two implementations, resolved by filename order, is the
   antipattern this whole reconciliation exists to remove.** Adding a drop guard to
   090200 would make the chain apply — and would leave the surviving behaviour
   decided by which filename sorts last. That is not a fix; it is the defect with
   the symptom suppressed.

**Migration action:** **remove** `20260906090200_chat_call_type_immutable.sql` from
`fix/ai8-p0-blockers` before it is merged. Do **not** add a drop guard and retain it.

If the team wants 090200's better BR-1 error message — and it is genuinely better —
it belongs as an edit to `chat.forbid_call_type_change()` in a **new** migration
layered on 093300, not as a competing trigger. That is a follow-up, not a merge
prerequisite.

**Is anything else in 80765dc lost?** No. 80765dc contains ten files: the whole
authentication layer (`access-token.ts`, `authenticated.guard.ts`,
`authentication.service.ts`), the actor decorator, the platform module wiring, two
test suites, and three migrations. Removing 090200 loses **only** the duplicate.
`20260906090000` (message author conversation scope) and `20260906090100` are
untouched by this decision, and both applied cleanly over HEAD in verification.

**Risk:** **Low.** Removal deletes a duplicate of a control that remains enforced by
093300, which is verified closed (RT-024 calling: `REJECTED`). The BR-1 harness
passes with 093300 alone. The only loss is an error message.

**Resulting migration chain (after Decision 1):**

```
20260905090000 … 20260905093200          (19, on HEAD)
20260905093300_chat_br1_structural_backstop      (on HEAD — canonical call/conversation BR-1)
20260906090000_chat_message_author_conversation_scope   (from 80765dc)
20260906090100  → see Decision 2
20260906090200  REMOVED
```

---

## DECISION 2 — Student Group presence

**Canonical rule:** **093300's live-admin presence.** `090100`'s primary-owner
presence is **not** canonical and must not merge in its current form.

**1. What does "required assigned admin/supervisor member" mean?**

The PRD says both things, in different places, and they are not the same rule:

> BR-1 (§4): *"Teachers and parents communicate only inside the official Student
> Group, **where the assigned admin/supervisor is a member**."*
> §4.1 matrix: *"Inside the Student Group; **admin present**."*
> Decision log 2026-09-05: *"Student Group **with admin present** is the only channel."*
> §7.3: *"created automatically from Jawwid Core relationships: the parent, every
> assigned teacher, and **the family's primary owner**. **Coverage admins join
> automatically during their coverage window** (or are permanent silent members,
> configurable)."*

§7.3 is a **composition** rule — how the group is built. BR-1, §4.1 and the decision
log are the **safety** rule — what must hold for teacher↔parent communication to be
permitted. The safety rule says *admin present*, not *owner present*.

That reading is confirmed by §7.3 itself: coverage admins join during their window.
Under §5.2 a coverage admin *"acts with the owner's permissions on that family"*. If
BR-1 required the **owner** specifically, coverage would be pointless inside a group
— the very scenario the PRD builds the operating model around.

**2. Is owner presence required?** As a **composition** property, yes (§7.3). As a
**BR-1 safety** property, no. The PRD nowhere makes teacher↔parent communication
conditional on the *owner* specifically.

**3. Is any Jawwid admin presence required independently of owner presence?** **Yes** —
and this is the BR-1 condition. `admin present` is satisfied by the owner, by a
covering admin, or by a manager.

**4. Can both coexist without unintended restriction?** **No — proven, not argued.**
093300's invariant is closed over the tables its triggers watch (`conversation`,
`conversation_member`). 090100's is not: it depends on `chat.family.owner_id`, and
**090100 installs no trigger on `chat.family`**. `chat.transfer_ownership()` does not
add the new owner to any conversation.

Executed on a disposable clean DB (HEAD chain + 090100):

```
STEP 1  compliant Student Group committed OK
STEP 2  chat.transfer_ownership(...) SUCCEEDED — no objection raised
        group contains the NEW owner? false        ← silently non-compliant
STEP 3  unrelated membership insert (adding an observer)
        ERROR: Student Group ... must contain the family's primary owner (...)
```

A manager performs a legitimate, PRD-sanctioned ownership transfer (§5.1). Nothing
objects. The group is now non-compliant, invisibly. The failure surfaces later, on an
unrelated action, with an error naming a cause the operator did not touch. **093300
is unaffected in the same scenario** — the outgoing owner is still a live admin
member, so BR-1 safety genuinely still holds. 090100 rejects a state that is not
unsafe, at a moment unrelated to its cause.

**5. Which rule is canonical?** 093300. It is the rule BR-1 states, it applies to
**every** group type — `class_group` was outside the old trigger's scope, which was
half of RT-025 — and its invariant is closed over the tables it guards.

**6. What happens to 090100 vs 093300?**

- **093300: KEEP as-is.** Already on HEAD, verified closed for RT-024 and RT-025, all
  18 BR-1 invariants pass.
- **090100: DO NOT MERGE in its current form.** The rule it encodes (§7.3 composition)
  is real and worth enforcing, but not as a BR-1 safety trigger with an open input.
  Two viable follow-ups, both **owned by AI #1, neither a merge prerequisite**:
  *(a)* re-express it as a **sync-completeness check** — a reconciliation job or a
  `chat.non_compliant_student_group` view the Manager Dashboard surfaces — which is
  what a composition property warrants; or *(b)* keep it as a constraint **and** close
  its input, by having `transfer_ownership()` add the incoming owner to every live
  Student Group for that family in the same transaction, plus a trigger on
  `chat.family`. *(b)* changes ownership-transfer semantics and is a larger change
  than it looks.

**Reason (summary):** BR-1's safety condition is *an admin is present*; §7.3's
composition rule is *the owner is a member*. Enforcing the composition rule as a
safety constraint over an input the trigger does not watch converts a legitimate
manager action into a delayed, misattributed failure.

**Risk:** **Low for 093300** (verified). **Medium if 090100 merges as-is** — it does not
break BR-1, it breaks ownership transfer, and it does so silently.

**Recommended migration state after Decision 2:**

```
20260905093300  KEEP    canonical BR-1 presence (admin), conversations + calls
20260906090000  MERGE   message author conversation scope
20260906090100  HOLD    return to AI #1; re-express as sync-completeness, or close its input
20260906090200  REMOVE  duplicate (Decision 1)
```

---

## DECISION 3 — `organization_id`

**Canonical implementation:** **A**, taken from **`72a5f29`** (`ai4/rbac-canonicalization`).

**Rejected:** `f9f3eca` — byte-identical to `72a5f29` (same `git patch-id`
`976f5507fb80a85d`); it is a pure duplicate and `72a5f29` has the closer base
(`d236ce3`, an ancestor of HEAD, vs `03d4119`). **Deferred, not rejected:**
implementation B on `feat/core-integration-boundary` — see below.

| | **A** — `72a5f29` (228 lines + tests + Prisma) | **B** — core-integration-boundary (4 migrations, 1,129 lines) |
|---|---|---|
| Root-entity definition | Semantic: PRD §6 entity, or owned directly by the organization | Mechanical: NOT NULL FK + ON DELETE CASCADE ⇒ derived. 19 root / 24 derived, documented |
| RLS strategy | **RESTRICTIVE policies that AND with existing ones.** Its header: *"the policies already shipped keep their exact meaning and none of them is rewritten here"* | **Rewrites every existing policy** — 76 drop/create statements across ~38 policies |
| Natural keys (`core_*_id`, IdP subjects, push tokens, room names, dedupe keys) | not addressed | addressed (095300) |
| Lifecycle / bootstrap | minimal | `bootstrap_organization()`, Core-payload rules (095100) |
| Executable tenant tests | `db/tests/tenant_isolation.sql` (193 lines) | in-branch |

**Reason.**

1. **The RLS strategy is the deciding factor, and it is not a matter of taste.**
   OD-01 (`be5a508`) **also rewrites policies** — 9 drop/create statements over
   `message` and `handoff`, because removing `chat.thread` forces every policy that
   derived family scope through it to be re-derived. B rewrites all ~38 policies
   including those same ones. **B and OD-01 collide head-on**, and the collision is
   in the authorization layer, which is the worst place to resolve a merge by hand.
   A is additive: restrictive policies can only narrow, never redefine, so A composes
   with OD-01's rewrite and with the preserved backstop without either being touched.
2. **B embeds an assumption about Jawwid Core that the PRD does not ratify.** 095300
   states: *"Each organization has its own Jawwid Core and its own identity
   provider."* Searched against the authoritative PRD: **0 matches.** §12.4 describes
   **a** Jawwid Core integration service, and §2.3 explicitly says the product is
   *"not multi-tenant"* today. B is not wrong to anticipate it, but per-organization
   Core instances and per-organization identity providers change the Core integration
   contract, and that decision belongs to Core-boundary ratification, not to the
   tenancy foundation.
3. **Scope entanglement.** B lives on a branch 13 commits ahead carrying the Core
   integration boundary. Adopting B's tenancy means merging the Core boundary, or
   surgically extracting four migrations from a branch designed around them.
   Tenancy should not be gated on Core ratification.
4. **Coexistence with the preserved backstop.** Both are compatible in principle —
   093300's controls are *triggers*, not policies, so neither implementation removes
   them. A is compatible by construction. B's compatibility is **unverified**: it has
   never been applied over a tree containing 093300, and 095000 additionally makes
   cross-organization references unrepresentable via constraints whose interaction
   with `conversation_member` has not been tested.

**What must not be lost from B.** B is the more complete piece of work and rejecting
it wholesale would be wrong. **095300's natural-key scoping identifies a real
multi-tenant correctness defect that A leaves open** — `core_*_id`, push tokens,
room names and dedupe keys are globally unique today, so two organizations minting
the same id would collide. Harvest 095300 (and 095100's lifecycle questions) as a
follow-up **after** the per-organization-Core assumption is ratified. Recorded here
so it is not silently dropped.

**Core-boundary implications:** adopting A leaves the Core integration contract
untouched and unratified-assumption-free. Adopting B would ratify, by implementation,
that each organization has its own Core and its own IdP — a product/architecture
decision that has not been made and is not tenancy's to make.

**Risk:** **Medium.** A is additive and testable, but it is still a schema-wide change
and must merge **after** OD-01 so it applies over the final policy set, not before.
Choosing A defers the natural-key defect — accepted knowingly, recorded, not hidden.

---

## FINAL MERGE PREREQUISITES

Release Readiness may merge nothing until **all** of these hold:

1. **`20260906090200` is removed** from `fix/ai8-p0-blockers`, not drop-guarded
   (Decision 1). Verified by: clean-DB chain apply from zero, exit 0, ledger count
   equals file count.
2. **`20260906090100` is withdrawn** from the merge set and returned to AI #1
   (Decision 2), or re-expressed so its invariant is closed over its inputs.
   Verified by: `transfer_ownership()` on a family with a live Student Group leaves
   no latent violation.
3. **`f9f3eca` is abandoned** in favour of `72a5f29` (Decision 3). Verified by: only
   one organization migration exists in the merge set.
4. **B's four organization migrations are explicitly deferred**, with 095300's
   natural-key defect logged as a known open risk.
5. **Merge order is fixed as:** `80765dc` (post-1, post-2) → OD-01 (`be5a508`,
   `61e810c`) → `72a5f29` → RBAC. Organization **after** OD-01, so restrictive
   policies apply over the final policy set.
6. **Every merge is preceded by a clean-DB gate**: empty stock `postgres:17`, no
   Supabase image, no Core shim, no pre-seed; full chain from zero; re-apply is a
   no-op; `schema_acceptance.sql`; `br1_invariants.sql`; then the suites and a boot
   with `/health/live` and `/health/ready` at 200 and a clean SIGTERM.
7. **After OD-01 merges, AI #9 re-attacks the authorization layer** — OD-01 re-derives
   7 RLS policies; a passing regression suite is not sufficient evidence that a
   rewritten policy set is still tight.
8. **RT-001 remains open** until `80765dc` merges. Socket identity is still
   client-declared on the integration line. No realtime end-to-end claim may be made
   before then.

## Decisions NOT made here, and why

- **PD-1** (coverage admins: permanent silent members vs window-joined) and **PD-2**
  (parent-initiated group calls) remain PRD §15.2 open questions. Decision 2 is
  deliberately compatible with either answer: requiring *an admin* rather than *the
  owner* neither requires nor forbids coverage-admin membership.
- **Owner-locked closure** stays removed; verified again against the PRD alone, which
  nowhere restricts who may resolve a conversation.
- No new business rule was invented in this memo.
