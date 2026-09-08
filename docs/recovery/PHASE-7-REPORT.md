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

**AI cannot outspend or outpace its budget.** All three generating routes carry
`@RateLimited(ActionScope.AI_GENERATE)`, and the send route carries
`MESSAGE_SEND` — the same scope `POST /messages` uses, so a staff member has one
send budget whichever surface they use. Both reuse Phase 8's guard; neither adds
a mechanism.

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

Corrected by the independent audit (§8); the first item previously read "content
safety of a draft is not automated", which is no longer true.

1. **Draft content safety is deterministic but bounded by the rule set.** Every
   generated draft is scanned by Phase 6's `ContentScanner` against the
   organization's own `chat.moderation_rule` rows before it is offered, and a
   flagged draft is discarded rather than shown. That covers what those rules
   cover — contact channels outside Jawwid, and anything an operator adds. It
   does **not** semantically detect an unauthorized *promise* ("we will refund
   you"); that rests on the system prompt, on knowledge grounding for factual
   claims, and on the fact that a person reads the draft and is the author of
   what is sent.
2. **No live provider run.** There is no Anthropic credential in this
   environment and none was invented. Parsing, schema rejection, refusal
   handling, the input ceiling and error classification are proved locally
   (`anthropic-adapter.spec.ts`); the network round trip is not. It is proved
   manually with `ANTHROPIC_API_KEY=… bash scripts/qa/ai-live-smoke.sh`, which
   is opt-in, unreachable from CI, and prints neither the key nor model output.
3. **Retrieval is lexical.** PostgreSQL full-text with the `simple`
   configuration, no stemming. Adequate for a curated FAQ; the seam for
   embeddings is `KnowledgeService.searchApproved`.
4. **Three dormant triggers**, per §4 above.
5. **Automation rules cannot be authored through the API.** `GET /ai/automation/rules`,
   `GET /ai/automation/runs` and one enable/disable switch exist, so §26's
   auditability is reachable and `automation.manage` grants something. Creating
   a rule, or editing its conditions or actions, stays a migration — editing a
   condition expression through a JSON body is how somebody disables the only
   guard on something that messages every family.
6. **No admin-web page for automation.** Deferred deliberately: the
   specification's §35 lists what a manager must be able to do, and every item
   on it is an attention-flag action, all of which are built. The API above is
   what §26 actually requires.

## 7. Verification record

Taken from a detached worktree at the branch head, with no uncommitted file
present, against a database built from the committed migration chain on a
dedicated port (55438).

Re-run at `ed28d20` after the audit fixes.

| Check | Result |
|---|---|
| migration replay from empty | clean |
| `apps/api` typecheck | clean |
| `apps/api` build | clean |
| `apps/api` unit | **438 passed**, 33 suites (106 Phase 7) |
| `apps/api` integration | **757 passed**, 42 suites |
| `phase7-runtime-rls` (as `chat_app`) | 14 passed |
| DB structural gates | `schema_acceptance`, `br1_invariants`, `tenant_isolation` pass |
| protected-tests gate (JC-011) | pass |
| `admin-web` typecheck / tests / build | clean / **111 passed** / clean |
| live provider call | **not performed** — no credential in this environment |

`schema-invariants.spec.ts` must be run with `JAWWID_INT_CONTAINER` and without
`DATABASE_URL` on a host with no `psql` binary; it shells out directly and takes
the docker path only when `DATABASE_URL` is unset.

---

## 8. Independent audit (2026-09-08)

Phase 7 was audited from a detached worktree against a database rebuilt from the
committed migration chain. Five real gaps were found and fixed in `ed28d20`;
none was visible from the feature tests, because each was a thing the
implementation never did rather than a thing it did wrongly.

| # | Gap | Fix |
|---|---|---|
| 1 | AI endpoints carried no rate limit (§29). An authorized session could loop `POST /ai/summaries?refresh=true` — the one route that bypasses the cache — for unbounded provider spend | New `ai_generate_actor` scope on Phase 8's existing guard |
| 2 | `POST /ai/suggestions/:id/send` bypassed the `MESSAGE_SEND` limit, because Phase 8's throttle sits on the message *controller* and this route reaches `MessageService` directly | Same scope applied to the AI send route |
| 3 | AI drafts were never content-scanned. Staff sends are unmoderated by Phase 6's design, so the assistant was the one path by which unreviewed text could reach a family | Phase 6's `ContentScanner` runs at generation; a flagged draft is not offered |
| 4 | `automation.manage` granted access to no endpoint, so §26's auditability was unreachable | Read surface for rules and runs, plus one audited enable/disable switch |
| 5 | No AI variable appeared in `infra/env/manifest.tsv`, the declared source of truth that `check-env.sh` runs on every deployment | Six variables added, all optional in every environment |

Plus one defect of provenance: `549c67e` had restored Phase 6's sweep wiring in
the wrong position, leaving the moderation sweep under a comment reading
"Phase 7" and a truncated orphan comment before a closing brace. The section is
now byte-identical to what Phase 6 wrote.

Three guarantees had no automated test and now do: the knowledge approval
boundary, attention-flag duplicate prevention, and the draft content scan.

**Verified as sound and unchanged:** the dependency direction (nothing outside
`src/ai` imports it except `app.module` and the worker; the send path is
AI-free); no dependency on frozen machinery (`attention_*`, `family_state_cache`,
`chat.subscription`, `chat.task`); no blanket RLS policy on any of the eight
tables; every foreign key, index and both idempotency constraints present; no
conversation content in any log; and no identifier, key or token in any prompt.
