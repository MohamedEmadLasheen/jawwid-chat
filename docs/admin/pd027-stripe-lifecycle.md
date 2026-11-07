# PD-27 Stripe: lifecycle, webhooks, reconciliation (completion)

Status: implemented on branch `claude/stripe-jawwid-chat-integration-f3e06a`. Not deployed.
Builds on `pd027-payments.md` (the PD-27 contract) and `pd030-subscriptions.md`. It does **not**
replace either, and it adds no second payment system.

## 1. What was already there (verified in code, 2026-11-07)

Stripe has been Chat's card provider since PD-27 (closed 2026-10-22, PRs #117 and #118).

| Piece | Where | State before this work |
|---|---|---|
| Payment links (`/pay/<256-bit token>`), no account needed | `billing/pay-link.controller.ts`, `pay-page.ts` | done |
| Stripe Checkout, opened for what is still owed, server-side amount | `billing/checkout.service.ts`, `stripe.gateway.ts` | done |
| In-app checkout for the parent (`POST /me/billing/checkout`) | `parent-payments.service.ts`, Flutter `lib/features/billing` | done |
| A webhook verified by the SDK over the raw body | `stripe-webhook.controller.ts` | done |
| Exactly-once: `stripe_event.id` PK, unique session, payment intent and refund ids | migration `20261022170000` | done |
| Amount and currency checked against the checkout Chat opened; a mismatch is audited, never recorded | `CheckoutService.confirm` | done |
| One writer for money: payment, invoice, request paid, instalment paid, audit | `payment-ledger.service.ts` | done |
| Lessons credited exactly once, on the request's transition to paid (database trigger) | PD-30 ledger | done |
| Refunds through Stripe (staff, `canVerify`) and from the Dashboard (webhook) | `payments.service.ts`, `CheckoutService` | done |
| Numbered invoices (`JW-<year>-<n>`), frozen, PDF in Arabic and English | `invoice-pdf.ts` | done |
| Parent payment history, invoices, receipts, subscription state | `GET /me/billing`, Flutter Settings > Payments | done |
| Production guard: no test key, no missing webhook secret in production | `stripe-config.ts` | done |
| Append-only payments, refunds, invoices (database guards) | migration `20261022170000` | done |

## 2. Gaps found

1. **Out-of-order refunds are lost.** A `refund.created` that arrives before the payment is recorded is
   stored as `refund_unknown_payment`; its redelivery is then a `duplicate`, so that refund is never
   recorded.
2. **A lost webhook is never recovered.** If Stripe gives up (the endpoint was down more than three days,
   or the endpoint's event list is wrong), a paid Checkout stays `open` in Chat. The next checkout for the
   same request finds it, but a request that is never opened again stays unpaid in Chat while the parent
   has paid.
3. **Failed card attempts are invisible.** A declined card (`payment_intent.payment_failed`) is ignored.
   Staff cannot see failed attempts, and the parent is not told why after leaving Stripe's page.
4. **Events in the brief that are not handled:** `payment_intent.succeeded`, `payment_intent.payment_failed`
   and `charge.refunded` (only `refund.*` was handled). `invoice.*` and `customer.subscription.*` do not
   apply (see §4).
5. **No Stripe references beyond the session and payment intent:** no customer, charge, or payment method
   (brand, last 4) on a payment.
6. **No organization-wide transaction view.** Staff see money per family (Parent Profile) and the receipts
   queue; there is no list of all transactions with filters, no failed attempts, no refunds list, no
   webhook log, and no reconcile.
7. **`POST /me/billing/checkout` has no per-actor rate limit.** It is capped at 10 checkouts an hour per
   request, but not per parent.
8. **Webhook audit rows carry no object reference.** `chat.stripe_event` keeps id, type and outcome, but
   not the session, payment intent or refund the event was about.

## 3. The design

### 3.1 State machine

There is one machine per thing, and each state change has exactly one writer.

```
Card attempt (chat.payment_checkout)       writer: CheckoutService
  open ──paid (verified)──▶ complete        the payment is recorded in the same transaction
  open ──expired──────────▶ expired         Stripe's checkout.session.expired, or a new attempt expires it
  open ──async failure────▶ failed          checkout.session.async_payment_failed
  open ──declined─────────▶ open            payment_intent.payment_failed: failure_count+1, failure_code;
                                            the parent may retry on the same page

Payment request (chat.payment_request)     writer: PaymentLedger (paid_at follows the payments)
  open ──payments cover it──▶ paid          lessons are credited on THIS transition (PD-30 trigger), once
  open ──staff───────────────▶ cancelled
  open ──expires_at──────────▶ expired (derived)

Payment (chat.payment)                     writer: PaymentLedger.record, once per session / intent
  standing ──refunds < amount──▶ partially refunded (derived)
  standing ──refunds = amount──▶ refunded (derived)       a card payment is never voided
```

Activation (lessons credited, the child unlocked) happens **only** on a request's transition to paid. That
transition is reachable only through `PaymentLedger.record`, which needs a verified, matching paid session.
It is guarded by `FOR UPDATE` on the request and by unique keys. No event triggers activation directly.

### 3.2 Webhook events

| Event | Action | Outcome |
|---|---|---|
| `checkout.session.completed`, `checkout.session.async_payment_succeeded` | confirm (unchanged) | `recorded`, `already_recorded`, `awaiting_payment`, `mismatch`, `unknown_session` |
| `checkout.session.async_payment_failed` | attempt → `failed` | `checkout_failed` |
| `checkout.session.expired` | attempt → `expired` | `checkout_expired` |
| `payment_intent.succeeded` **(new)** | ours (metadata `paymentRequestId`): find its session at Stripe, confirm it. This is a second path to the same idempotent confirm, so a missed `checkout.session.completed` still records. | as confirm, or `ignored` |
| `payment_intent.payment_failed` **(new)** | ours: the attempt's `failure_count`, `failure_code` (Stripe's decline code, never a message, never card data) and `last_failed_at` | `payment_failed` |
| `refund.created`, `refund.updated` | record (unchanged); an unknown payment is now **deferred**, not dropped | `refund_recorded`, `refund_deferred`, `refund_not_final` |
| `charge.refunded` **(new)** | sync every refund of that payment intent from Stripe | `refund_recorded`, `refund_deferred`, `already_recorded` |
| `invoice.*`, `customer.subscription.*` **(new)** | none: Chat opens no Stripe Billing subscriptions (§4). A warning is logged. | `ignored_not_chat` |
| anything else | none | `ignored` |

**Order does not matter.**
- A refund before its payment is stored as `refund_deferred`, with the payment intent. When the payment is
  recorded, its refunds are synced from Stripe, and the reconciler retries.
- `payment_intent.succeeded` before `checkout.session.completed`: whichever comes first records the
  payment; the other answers `already_recorded`.
- A late `checkout.session.expired` moves only an `open` attempt.

**Retries.** A database failure answers 500, and Stripe retries. The event row is written in the same
transaction as the money, so a failed attempt leaves no row and the retry runs again. Unique keys keep two
concurrent deliveries exactly-once.

**Audit.** Every verified event gets one `chat.stripe_event` row. It now also holds the Stripe object id,
the payment intent and Stripe's `created` time. It never holds the body.

### 3.3 Reconciliation (status sync)

`StripeReconciler`. The worker runs it every 5 minutes (`STRIPE_RECONCILE_MS`). Staff with `canVerify`
can also run it now from Admin > Payments.
- Each attempt still `open` 10 minutes after it was opened (up to 30 days back, 25 a pass): ask Stripe.
  A paid one is confirmed through the same idempotent path; an expired one is marked expired.
- Deferred refunds whose payment now exists: sync that payment's refunds.
- Per payment (`POST /payments/:id/reconcile`, `canVerify`): Stripe's amount received, amount refunded,
  currency and status, set beside Chat's. Missing refunds are recorded, and the answer says whether the
  two agree.

### 3.4 Database (migration `20261107120000_chat_pd027_stripe_lifecycle.sql`, additive only)

| Change | Why |
|---|---|
| `chat.stripe_customer (family_id, livemode) → stripe_customer_id unique` | Stripe Customer per family. Created on the first card checkout with **metadata only** (family id, organization id; no name, no e-mail). A trial before Assign pays as a guest. |
| `chat.payment` + `stripe_customer_id`, `stripe_charge_id` (unique), `payment_method_type`, `card_brand`, `card_last4`, `card_wallet` | Stripe references and the payment method. Card only; set at insert and never changed (the guard is extended). Last 4 and brand are not cardholder data under PCI DSS; no PAN or CVC ever reaches Chat. |
| `chat.payment_checkout` + `stripe_customer_id`, `stripe_payment_intent_id`, `failure_count`, `failure_code`, `last_failed_at` | Failed attempts and their reason. |
| `chat.stripe_event` + `object_id`, `payment_intent_id`, `stripe_created_at` | Audit and deferred refunds. |
| `chat.config` `abuse.throttle.checkout_start_actor` = 20 a minute | Per-parent rate limit on `POST /me/billing/checkout`. |

Every new column is nullable or has a default. No existing row, constraint or column is changed or removed.
Rollback: `db/rollback/20261107120000_chat_pd027_stripe_lifecycle.down.sql` (it refuses to run once a
payment holds the new data, unless exported first).

### 3.5 API

| Route | Who | |
|---|---|---|
| `GET /payments` | billing readers, in their family scope | all transactions. Filters: `status` (standing, refunded, partially_refunded, voided), `method`, `purpose`, `planMonths`, `from`/`to` (paid on), `familyId`, `q` (family, child, invoice number, Stripe id). Totals per currency, cursor paging. |
| `GET /payments/:id` | billing readers in scope | the payment, refunds, invoice, request, the request's card attempts, Stripe references and webhook events |
| `GET /payment-attempts` | billing readers in scope | card attempts. `status=failed` covers declined, failed and expired-unpaid attempts. |
| `GET /stripe/events` | `canVerify` | the webhook log, filterable by outcome and type |
| `POST /payments/:id/reconcile` | `canVerify` | compare with Stripe, record missing refunds |
| `POST /stripe/reconcile` | `canVerify` | run the reconciler now, for the actor's organization |
| `GET /me/billing` | parent | requests gain `lastCardFailure: {code, at} \| null`; payments gain `card: {brand, last4, wallet} \| null` |

### 3.6 Interfaces

- **Admin Web, Payments:** new tabs Transactions (filters, totals, detail drawer with Stripe references and
  Reconcile), Card attempts (failed and abandoned), Stripe events (`canVerify`). The existing tabs Receipts,
  Renewals and Settings are unchanged. This follows the existing `FilterChips`, `SearchableSelect`, copy
  files (Arabic and English) and the portal theme.
- **Parent app:** an open payment whose last card attempt was declined shows why (insufficient funds,
  expired card, and so on), with "try another card or pay by bank transfer". The payment history shows the
  card brand and last 4. The public link page shows the same failure note.

### 3.7 Security

- The secret key and the webhook secret stay server-side environment secrets. Nothing reaches a client,
  log, report or commit. Logs carry event type, outcome and ids, never a body, signature or key.
- Amounts are always Chat's: the server computes what is owed, Stripe is asked for exactly that, and the
  webhook must match it.
- Authorization is unchanged: a parent pays only their own family's request (`/me/*`); the link holder only
  that link; staff reads go through `billingAccessOf` and the family scope SQL; reconciliation and the
  webhook log are `canVerify`.
- Card data never touches Chat (Stripe-hosted Checkout). Only brand, last 4 and wallet type are stored.

## 4. Not done, on purpose

- **Automatic recurring card charges (Stripe Billing subscriptions).** PD-27 and PD-30 define a
  subscription as a **prepaid lesson package** (1/3/6/12 months, N lessons), renewed by a new payment
  request when the parent asks or staff send one. Charging a saved card each month would be a new business
  rule. It needs consent wording in the Terms (docs/legal), a store-policy check, and a decision on what an
  automatic renewal buys. That is an owner decision. Until then, `invoice.*` and `customer.subscription.*`
  are recorded and ignored, with a warning in the logs, in case someone sets up Billing on the account.
- **Stripe Invoices.** Chat issues its own numbered, frozen invoices (PD-27). Stripe Invoicing would be a
  second, paid invoice series. "Stripe Invoice ID" therefore does not apply. The Chat invoice number and the
  Stripe charge and payment intent identify a payment.
- **Jawwid Core:** not read, called or changed.
- **A refund that Stripe fails after Chat recorded it.** PD-27 records a refund once it is `pending` or
  `succeeded`, and refund rows are append-only and only add up. If Stripe later reports that refund as
  `failed` or `canceled` (`refund.updated` or `refund.failed`; rare for cards, for example a closed card
  account), Chat cannot reverse the row without a schema change that every refund total in the system
  reads. Decision (2026-11-07, from the independent review): **detect, audit and alert, do not
  auto-correct**. The event's outcome is `refund_failed_after_record`, an audit row
  `payment.refund_failed_at_stripe` names the payment and refund, and the API logs an error. Admin shows
  the outcome in Stripe events. Follow-up: a reversal entry on `chat.payment_refund` (forward-only, with a
  reason) that the totals subtract.

## 5. Operations: setup, deploy, verify, roll back

Nothing here has been done in staging or production. Every step below is for the owner (or whoever the
owner authorizes) to run.

### 5.1 Environment

| Variable | Where | |
|---|---|---|
| `STRIPE_SECRET_KEY` | API + worker, secret | Unchanged name. Use a **restricted** key (`rk_live_…` in production, `rk_test_…` in staging) with these scopes: Checkout Sessions **write**, Refunds **write**, Customers **write**, PaymentIntents **read**, Charges **read**. The last three are new. Without them, customers are not created and card details and reconciliation are not read, but payments still record. Production refuses a test key (`stripe-config.ts`). |
| `STRIPE_WEBHOOK_SECRET` | API, secret | Unchanged: the endpoint's `whsec_…`. Production refuses to start without it when a key is set. |
| `PAYMENT_LINK_BASE_URL` | API | Unchanged. |
| `STRIPE_RECONCILE_MS` | worker, optional | Reconcile interval. The default is `300000` (5 minutes); `0` turns it off. |

No secret is ever logged, returned or stored by Chat. Configure the secrets only in the platform's secret
store (`infra/env/manifest.tsv` lists them).

### 5.2 Stripe Dashboard

1. **Developers → Webhooks → Add endpoint**: `https://<api host>/api/v1/stripe/webhook`. Events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `refund.created`, `refund.updated`, `charge.refunded`.
   For an existing endpoint, **add** the four new ones: `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `refund.updated` (if missing) and `charge.refunded`.
   Do not subscribe `invoice.*` or `customer.subscription.*`: they are harmless (recorded as
   `ignored_not_chat`) but noise.
2. Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`. Staging and production have separate
   endpoints and separate secrets.
3. **Developers → API keys → Create restricted key** with the scopes in 5.1.
4. **Do not delete Stripe Customers that Chat created** (metadata `familyId`). If one is deleted, that
   family pays as a guest, and the API logs a warning each time.
5. Stripe Radar, 3-D Secure and payment-method settings stay at Stripe's defaults. Checkout applies them.

### 5.3 Database migration

`supabase/migrations/20261107120000_chat_pd027_stripe_lifecycle.sql` is additive. It adds one table, adds
nullable or defaulted columns, adds indexes, and replaces `chat.guard_payment` with a superset.
- Apply through the normal pipeline (`scripts/db/apply.sh` via the deploy workflow), never by hand in
  production. It takes `lock_timeout = 5s`. The `ALTER TABLE`s on `chat.payment`, `chat.payment_checkout`
  and `chat.stripe_event` take brief exclusive locks. Columns with a constant default do not rewrite the
  table on Postgres 11+.
- Order: the migration first, then the API and worker. Today's code ignores the new columns, so the
  migration is safe to run before the release.
- Verified on a private Postgres 17: apply → rollback → apply again, plus `scripts/db/integration-db.sh verify`.

### 5.4 Deploy

Before deploying:
1. The migration is applied.
2. The restricted key has the new scopes.
3. The webhook endpoint has the new events.
Deploying itself is unchanged. There is no flag to switch on: the reconciler starts with the worker.

### 5.5 Production verification checklist (owner, in test mode first)

Run in **staging with Stripe test mode** first. Test cards: `4242 4242 4242 4242` (succeeds),
`4000 0000 0000 9995` (insufficient funds), `4000 0000 0000 0069` (expired), `4000 0025 0000 3155` (3-D Secure).
1. Create a renewal request for a test family. Pay it with 4242 from the link. The payment appears once in
   Admin → Payments → Transactions with brand and last 4, and the parent's invoice shows the card.
2. Pay another request with 9995. Card attempts shows the decline (`insufficient_funds`), and the parent's
   app and the link page say why.
3. Open a checkout and abandon it. After 45 minutes, the attempt shows as expired.
4. Refund part of a payment from Admin, then refund the rest from the Stripe Dashboard. Each is recorded
   once, and the transaction shows "refunded".
5. Stripe Dashboard → the webhook → **Resend** an old event. Admin → Stripe events shows `duplicate`, and
   nothing changes.
6. Disable the webhook endpoint for a few minutes and pay. Within about 15 minutes the worker log shows
   `stripe reconcile: a paid checkout had no webhook; recorded from Stripe`, and the payment is there
   once. Re-enable the endpoint: its late delivery shows `already_recorded`.
7. On one card payment, press **Reconcile with Stripe**. It shows "in sync".
Then in production, with one small real payment by the owner, refunded afterwards: steps 1, 4 and 7.

### 5.6 Rollback

- **Code:** redeploy the previous release. The old code ignores the new columns and table. Webhook
  events the old code does not handle (`payment_intent.*`, `charge.refunded`) are answered 200 and
  `ignored`. Nothing is lost: refunds still arrive as `refund.created`.
- **Database:** usually unnecessary (additive). If required:
  `psql -v ON_ERROR_STOP=1 -1 "$DATABASE_URL" -f db/rollback/20261107120000_chat_pd027_stripe_lifecycle.down.sql`,
  **after** the code rollback. It refuses while the new columns hold data, unless that data was exported
  and `chat.allow_pd027_lifecycle_rollback` is set (see the file). It restores `chat.guard_payment` to
  20261022170000's body verbatim. Existing payments, refunds and invoices are never touched.

### 5.7 Monitoring and logs

Logs carry event type, outcome, ids and Stripe error categories. They never carry a body, a signature, a
key, a card number or Stripe's error message. Errors go to Sentry, as before.

| Signal | Meaning | Action |
|---|---|---|
| `stripe webhook: rejected, signature did not verify` (warn) | Wrong `STRIPE_WEBHOOK_SECRET`, or a forged call | A burst after a deploy: check the secret |
| HTTP 5xx on `POST /stripe/webhook` (Stripe Dashboard → webhook → failures) | Database or Stripe unavailable; Stripe retries | Persistent: check the API logs and Sentry (`billing`) |
| `stripe reconcile: a paid checkout had no webhook; recorded from Stripe` (warn) | A webhook was lost | Occasional is fine; frequent means check the endpoint's events and delivery |
| `stripe reconcile: payment … differs from Stripe` (warn) | Chat and Stripe disagree after reconciling | Open the payment in Admin and reconcile; escalate if it stays out of sync |
| `payment.stripe_mismatch` in `chat.audit_log`, outcome `mismatch` | Paid amount or currency differs from what Chat asked | Investigate. It was never recorded as a payment. |
| outcome `ignored_not_chat` (warn) | Stripe Billing is in use on the account | Nothing in Chat; ask who set it up |
| outcome `refund_deferred` older than an hour | A refund for a payment Chat never recorded | Admin → Stripe events; find the payment intent in Stripe |
| `stripe customer not created` / `paying as a guest` (warn) | Customers scope missing, or a customer was deleted | Fix the key scopes |

SQL for operations (read-only):
```sql
-- webhook outcomes in the last day
select outcome, type, count(*) from chat.stripe_event where received_at > now() - interval '1 day' group by 1, 2 order by 3 desc;
-- card attempts still open after their expiry (the reconciler should clear these within minutes)
select stripe_session_id, created_at from chat.payment_checkout where status = 'open' and expires_at < now() - interval '15 minutes';
```
