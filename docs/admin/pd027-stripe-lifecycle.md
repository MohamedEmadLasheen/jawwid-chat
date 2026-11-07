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

### 3.4 Database (migration `20261107100000_chat_pd027_stripe_lifecycle.sql`, additive only)

| Change | Why |
|---|---|
| `chat.stripe_customer (family_id, livemode) → stripe_customer_id unique` | Stripe Customer per family. Created on the first card checkout with **metadata only** (family id, organization id; no name, no e-mail). A trial before Assign pays as a guest. |
| `chat.payment` + `stripe_customer_id`, `stripe_charge_id` (unique), `payment_method_type`, `card_brand`, `card_last4`, `card_wallet` | Stripe references and the payment method. Card only; set at insert and never changed (the guard is extended). Last 4 and brand are not cardholder data under PCI DSS; no PAN or CVC ever reaches Chat. |
| `chat.payment_checkout` + `stripe_customer_id`, `stripe_payment_intent_id`, `failure_count`, `failure_code`, `last_failed_at` | Failed attempts and their reason. |
| `chat.stripe_event` + `object_id`, `payment_intent_id`, `stripe_created_at` | Audit and deferred refunds. |
| `chat.config` `abuse.throttle.checkout_start_actor` = 20 a minute | Per-parent rate limit on `POST /me/billing/checkout`. |

Every new column is nullable or has a default. No existing row, constraint or column is changed or removed.
Rollback: `db/rollback/20261107100000_chat_pd027_stripe_lifecycle.down.sql` (it refuses to run once a
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
