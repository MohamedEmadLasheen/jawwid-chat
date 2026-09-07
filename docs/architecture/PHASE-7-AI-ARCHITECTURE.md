# Phase 7 — AI & Automation: architecture map

Status: **CANONICAL** for the Phase 7 AI layer · Opened 2026-09-07
Read with `product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` (which governs),
`architecture/AUTHORIZATION-MODEL.md` and `security/RLS-STRATEGY.md`.

This is the reconnaissance record required before Phase 7 wrote any code, and
the design it settled. Its purpose is to say what already existed, what Phase 7
therefore must **not** rebuild, and where the intelligence layer attaches.

---

## 1. What the reconnaissance found

**There was no AI infrastructure.** A sweep of `apps/`, `lib/`, `supabase/`,
`infra/` and `scripts/` for `openai|anthropic|claude|llm|embedding|pgvector|
vector|rag|prompt|completion|model` returned no integration, no SDK dependency
and no configuration key. Phase 7 builds the provider seam from nothing.

**Almost everything else already existed.** The table below is the reuse
contract: Phase 7 depends on these and duplicates none of them.

| Concern | Existing component | Phase 7 uses it for |
|---|---|---|
| Authorization | `AuthorizationService` (`can`, `canRead`, `canSend`), `ScopeService` | every AI read and every AI-assisted write |
| RBAC vocabulary | `chat.permission`, `chat.role_permission`, mirrored in `rbac/permissions.ts` | `ai.use` and the Phase 7 keys |
| Moderation | `canSend` → `Moderation.PENDING` → `chat.message_approval` → `ApprovalService` | a suggested reply is moderated like any other message |
| Send pipeline | `MessageService.send` | the **only** way an AI-drafted reply reaches a family |
| Audit | `PrismaAuditService.audit/event`, transaction-bound | every AI-assisted privileged act |
| Reminder engine | `ReminderService` + `chat.notification_rule` (rules are DATA, deterministic `rule:subject:recipient` dedupe keys) | all Phase 7.6 reminders |
| Scheduled execution | `worker.ts` loop, `CallSweeper`'s idempotent sweep | the automation sweep |
| Durable async work | `OutboxWorker`'s conditional-update lease | the automation lease |
| Config | `AppConfigService` + `chat.config` | every Phase 7 threshold |
| RLS helpers | `chat.current_has_permission()`, `current_actor_ids()`, `current_organization_id()`, `current_family_ids()` | every Phase 7 policy |

**Two findings that changed the plan.**

1. *Attention scoring is deprecated machinery.* The product boundary §3 freezes
   `attention_*`, `family_state_cache` and the attention buckets: "no new code
   may depend on it". Phase 7 §16 suggests reusing existing flag infrastructure;
   here that would mean building on frozen CRM tooling. Phase 7 therefore
   creates a **new** `chat.attention_flag`, and the boundary's own note that
   "the *idea* returns as a conversation section in the console" is what it
   implements.

2. *Three of the four reminder triggers have no deterministic data source.*
   There is no schedule table, no invoice, no payment and no installment
   anywhere in the schema; `chat.subscription` exists only inside the frozen
   `090300` migration and is absent from the Prisma schema entirely. Schedules,
   payments and renewals belong to **Jawwid Core**, reachable only through the
   `chat.core_event` / `chat.sync_state` boundary. Inventing a billing schema
   would contradict the boundary document and Phase 7 §49; asking a model to
   guess a due date would contradict Phase 7 §20. See §5 below for what Phase 7
   does instead.

---

## 2. The layering

```
        Communication Engine  (conversations, messages, delivery)
                    |
        Permissions  (AuthorizationService, ScopeService, RLS)
                    |
        Moderation   (canSend, message_approval)
                    |
   ---------------- AI Intelligence Layer ----------------
   |  reads what the actor may already read               |
   |  FAQ · Suggested replies · Summaries · Risk          |
   |  produces SUGGESTIONS and FLAGS, never actions       |
   -------------------------------------------------------
                    |
        Human / deterministic decision
                    |
        Permissions -> Moderation -> Business rules
                    |
        Existing action pipeline  ->  Audit
```

`AiModule` imports `PlatformModule`. `PlatformModule` imports nothing from
`AiModule`, and nothing under `src/platform` imports `src/ai`. The dependency
direction is the architecture: governance is never downstream of the assistant,
so no AI failure and no AI output can widen what an actor may do.

## 3. The provider seam

```
feature service ──> AiInvocationService ──> AiProvider ──> Anthropic
                       (audit, kill switch,      |
                        never throws)            └──> Disabled (no key)
```

Nothing above `AiInvocationService` injects a provider, so three properties hold
by construction rather than by convention: every consultation is recorded in
`chat.ai_invocation`; the `ai.enabled` kill switch is honoured on paths written
after the switch existed; and a provider failure is a **value**, never an
exception escaping into the communication engine.

`AiResult<T>` is a discriminated union with no throwing variant. A deployment
with no `ANTHROPIC_API_KEY` gets `DisabledAiProvider`, and the system behaves
exactly as it did before Phase 7.

## 4. Untrusted content

Conversation text is data. `AiRequest` has separate fields for trusted
(`system`, `instruction`) and untrusted (`untrusted`) content, so there is no
string concatenation at a call site in which a parent's message could become
part of a system prompt.

Untrusted blocks are wrapped in an envelope tagged with a **per-request random
nonce**, and any text resembling the delimiter is neutralized first. A fixed
delimiter fails the moment a message contains it; a nonce cannot be guessed,
because it did not exist when the message was written.

## 5. Reminders and the Core boundary

The automation engine defines all six trigger types. `FOLLOW_UP_DUE`,
`MESSAGE_UNANSWERED` and `RISK_FLAG_CREATED` are computed from conversation and
message timestamps this system owns, and run today.

`CLASS_UPCOMING`, `PAYMENT_DUE` and `RENEWAL_APPROACHING` are fed from
`chat.core_event`. They are implemented and tested, and **dormant until Jawwid
Core delivers those events** — which is the honest state of the integration, not
a gap in the engine. No local mirror of Core's schedules or billing is created,
and no model is asked whether a payment is due.

## 6. What Phase 7 adds

| Object | Why it could not be an existing one |
|---|---|
| `chat.ai_invocation` | no audit surface described an external model call |
| `chat.knowledge_article` / `_revision` | no approved-content store existed |
| `chat.ai_suggestion` | a draft awaiting a human is not a `chat.message` |
| `chat.conversation_summary` | cached derived text, authorization-gated |
| `chat.attention_flag` | `attention_*` is frozen (§1) |
| `chat.automation_rule` / `_run` | `notification_rule` schedules; it does not gate on conditions |
