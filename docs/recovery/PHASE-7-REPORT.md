# Phase 7 — AI & Automation: what was built, and what was deliberately not

Status: **CANONICAL** for Phase 7 · 2026-09-08
Design: `architecture/PHASE-7-AI-ARCHITECTURE.md` · Governs: `product/JAWUID-CHAT-PRODUCT-BOUNDARY.md`

---

## 1. What was implemented

| Sub-phase | Delivered |
|---|---|
| 7.1 Provider seam | `AiProvider` port, Anthropic adapter, `DisabledAiProvider`, `AiInvocationService`, `chat.ai_invocation` |
| 7.2 Approved knowledge | `chat.knowledge_article` + `chat.knowledge_revision`, versioning triggers, `KnowledgeService`, grounded `FaqService` |
| 7.3 Suggested replies | `chat.ai_suggestion`, `SuggestionService`, bounded transcript builder |
| 7.4 Summaries | `chat.conversation_summary`, four required sections, inferences held apart, `up_to_seq` cache |
| 7.5 Risk detection | `chat.attention_flag`, deterministic detector, AI classifier, `RiskSweeper` |
| 7.6/7.7 Automation | `chat.automation_rule` + `chat.automation_run`, condition evaluator, engine, trigger sources, worker sweep |
| 7.8 Manager surfaces | Attention queue, knowledge management, assistant panel, the AI marker |
| 7.9 Security | `phase7-runtime-rls.spec.ts` (as `chat_app`), `governance-bypass.spec.ts` |

## 2. The three governance guarantees, and how each is made true

**AI cannot send.** `chat.ai_suggestion` is not `chat.message` with a flag — a
draft in its own table cannot be delivered by code that does not know it
exists. The single bridge, `SuggestionService.send`, calls `MessageService.send`
authored by the staff member, so `canSend`, BR-1, scope, the C-4 admin-presence
rule and group moderation holds all apply, and none of them had to learn AI
exists. A refusal surfaces with the pipeline's own error code and the draft
stays pending.

**AI cannot invent facts.** An FAQ answer is assembled only from `approved`
knowledge, and `FaqService` rejects any answer citing an article it was not
given, or citing nothing at all. When no approved article matches, no model is
consulted at all.

**AI cannot act on the business.** `AttentionService` writes a flag and an audit
row. It injects nothing that reaches billing, subscriptions, assignment or
lifecycle, and no route exposes one. Detecting cancellation intent produces a
card in a queue.

## 3. Database changes

Six migrations, `20260907180000` … `20260907180500`. Seven new tables
(`ai_invocation`, `knowledge_article`, `knowledge_revision`, `ai_suggestion`,
`conversation_summary`, `attention_flag`, `automation_rule`, `automation_run`),
one additive nullable column (`chat.conversation.follow_up_at`), six new
permissions, and eleven config keys.

Two idempotency guarantees are indexes rather than application checks:

* `attention_flag_one_open_per_risk` — partial unique on
  `(conversation_id, risk_type) where status in ('open','acknowledged')`;
* `automation_run_once_per_occurrence` — unique on
  `(rule_key, subject_id, occurrence_key)`.

Every table has RLS enabled, a restrictive tenant policy, and narrow read
policies. `conversation_summary` and `attention_flag` delegate visibility to
`chat.conversation` through an `exists` subquery evaluated under the caller's
privileges, so they cannot drift from the conversation's own rules.

## 4. What Phase 7 refused to build, and why

**`CREATE_TASK` is not an automation action.** PD-4 froze `chat.task` and ruled
that system-generated events are system messages. That is `SEND_MESSAGE`.

**Attention flags are a new table, not the `attention_*` machinery.** The
product boundary §3 freezes that as deprecated CRM tooling no new code may
depend on.

**Class, payment and renewal reminders are dormant, not mirrored.** There is no
schedule table and no invoice table in this repository, and `chat.subscription`
is frozen. Those facts belong to Jawwid Core and arrive through
`chat.core_event`. The three trigger types are implemented, tested and seeded
**disabled**; they begin working when Core delivers the events, with no
deployment. Building a local billing mirror would have created a second source
of truth for the amount a family is asked to pay.

**`subscription_active` fails closed.** A condition naming it is not met, and
says so — better than a frozen mirror answering "active" from data nobody
updates.

## 5. AI limitations — what it can and cannot do

*Can:* answer from approved knowledge with citations; draft a reply for review;
summarise a conversation into four sections plus separated inferences; classify
frustration, escalation and cancellation intent.

*Cannot:* send anything; approve knowledge; read a conversation its caller
cannot; change any account, subscription, assignment or billing state; override
a permission, a moderation hold or a business rule; be consulted for a
deterministic fact (elapsed time, family state, payment status).

*Degrades:* with no `ANTHROPIC_API_KEY`, or with `ai.enabled` false, the system
behaves exactly as it did before Phase 7. The deterministic unanswered-message
detector keeps running.

## 6. Known limitations

1. **Content safety of a draft is not automated.** §11's list (no discounts, no
   refunds, no policy exceptions) is enforced by the system prompt, by knowledge
   grounding for factual claims, and by mandatory human review before sending.
   No automated classifier checks a draft's content. The structural guarantee is
   that nothing is sent without a person.
2. **No live provider run.** Every test uses a scripted provider. The Anthropic
   adapter has not been exercised against the real API in this environment.
3. **Retrieval is lexical.** PostgreSQL full-text with the `simple`
   configuration, no stemming. Adequate for a curated FAQ; the seam for
   embeddings is `KnowledgeService.searchApproved`.
4. **Three dormant triggers**, per §4 above.
5. **Automation rules have no management UI.** They are data; a manager holding
   `automation.manage` changes them through the database or a future settings
   surface.

## 7. Verification record

Taken from a detached worktree at the branch head, with no uncommitted file
present, against a database built from the committed migration chain on a
dedicated port (55438).

| Check | Result |
|---|---|
| `apps/api` typecheck | clean |
| `apps/api` build | clean |
| `apps/api` unit | **375 passed**, 26 suites (83 Phase 7) |
| `apps/api` integration | **737 passed**, 41 suites |
| `phase7-runtime-rls` (as `chat_app`) | 12 passed |
| DB structural gates | `schema_acceptance` + `br1_invariants` pass |
| `admin-web` typecheck / tests / build | clean / **111 passed** / clean |

`schema-invariants.spec.ts` must be run with `JAWWID_INT_CONTAINER` and without
`DATABASE_URL` on a host with no `psql` binary; it shells out directly and takes
the docker path only when `DATABASE_URL` is unset.
