# PD-27 Stripe: lifecycle, webhooks, reconciliation (completion)

Status: implemented on branch `claude/stripe-jawwid-chat-integration-f3e06a`. Not deployed.
Builds on `pd027-payments.md` (the PD-27 contract) and `pd030-subscriptions.md`. It does **not**
replace either, and it adds no second payment system.
The owner-executable steps for turning Stripe on at the public launch (shared account pre-checks, the
webhook endpoint and its events, the restricted key, the GitHub Environment, the M4 live smoke test and the
rollback) are in `docs/release/stripe-launch-runbook.md`; §5 below is the reference it builds on.

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
| Production guard: only a live `sk_live_`/`rk_live_` key, with a well-formed `whsec_` webhook secret | `stripe-config.ts`, `check-env.sh` | done |
| Launch gate: both Stripe secrets required at `LAUNCH_PHASE=launch` (optional in review) | `check-env.sh` | done |
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
| `refund.created`, `refund.updated`, `refund.failed` | record (unchanged). A payment not recorded yet that belongs to a checkout Chat opened is **deferred**, not dropped. A payment Chat did not take (another system on the same Stripe account) is `not_chat` (W59). | `refund_recorded`, `refund_deferred`, `refund_not_final`, `refund_failed_after_record`, `not_chat` |
| `charge.refunded` **(new)** | sync every refund of that payment intent from Stripe | `refund_recorded`, `refund_deferred`, `already_recorded`, `not_chat` |
| `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated` **(W59)** | Chat's own payments only (matched by payment intent, else charge). Flag only: one audit row per event, an error log for opened and funds withdrawn, **no change to the money ledger** (§4). | `dispute_opened`, `dispute_updated`, `dispute_closed_<status>` (`won`, `lost`, `warning_closed`, …), `dispute_funds_withdrawn`, `dispute_funds_reinstated`, `not_chat` |
| `invoice.*`, `customer.subscription.*`, `subscription_schedule.*` | none: Chat opens no Stripe Billing subscriptions (§4). Logged at info level. | `ignored_not_chat` |
| anything else | none | `ignored` |

**Whose object is it (W59).** Chat decides from its own tables, never from metadata alone (metadata can be
edited in the Dashboard): a payment in `chat.payment` (by payment intent or charge), or a checkout in
`chat.payment_checkout` (locally by the payment intent, else the session Stripe lists for that intent).
Anything else is another system's and is recorded as `not_chat`, with no academy, and never acted on. If
Chat cannot tell (no secret key, or Stripe unreachable), a refund is kept as `refund_deferred`. It is never
dropped, and it is harmless if it turns out to be foreign: the reconciler only syncs it once a Chat payment
with that payment intent exists. One safeguard for refunds only: when Chat finds no checkout of its own
but the Stripe session or its payment intent carries `metadata.system = jawwid-chat`, the refund is kept
as `refund_deferred` with a warning log (never `not_chat`), so a missing row or an empty Stripe session
list cannot silently drop a Chat refund. The tag only keeps a refund waiting; it never records money or
flags a dispute. A dispute Chat cannot classify because Stripe is unreachable answers
500, so Stripe retries. Without a secret key Chat opens no checkouts, so an unmatched dispute is `not_chat`.

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

### 3.8 Overpayments and one payable checkout (M3, S1; 2026-11-10)

**M3: money beyond what was owed is recorded, then flagged.** `PaymentLedger.record` reads what the
request or instalment still owed *before* the payment, under the same row locks. It never changes what is
recorded: money that was taken is always recorded. When the payment is larger than what was owed, it
writes an audit row `payment.overpayment_detected` (entity `payment`, the payment id) with `amountMinor`,
`owedMinor`, `overpaidMinor`, `currency` and `why`:

| `why` | When |
|---|---|
| `request_paid` | the request was already paid (two payments, e.g. a bank transfer approved, then a late card webhook) |
| `request_cancelled` | the request was cancelled (replaced, or cancelled by staff) |
| `instalment_closed` | its instalment was already paid another way, or voided (also a receipt approved after that, which the ledger records against no request) |
| `more_than_owed` | still open, but this payment is larger than what remained |

After the transaction, the staff who refund and reconcile (`canVerify`: the super admin and the Operations
Manager of the academy) get a notice through `NotificationService.schedule`, as other staff notices are
sent (event type `payment_overpaid`, one per payment and person). The push is the generic one, so the
amount stays behind sign-in. The notice is best effort. The audit row is the record. Admin > Payments >
Transactions shows **"Overpaid: refund or credit"** on the row and in the detail (with the amount and the
reason). It reads **"Overpaid (settled)"** once refunds or a void *of the flagged payment itself* cover
it. Resolve a double payment by refunding (or voiding) the flagged payment: voiding the *other* payment
(for example the bank transfer) does not clear the marker, which stays red. The API gives
`overpaid: { amountMinor, why, settled } | null` on `GET /payments` and `GET /payments/:id`, computed from
the audit row. No schema change.

**S1: one payable Stripe session per request.** Two taps at once used to find no open session each and
create two payable pages. `CheckoutService.open()` now first refuses a loop (10 opens in an hour, 429),
then **claims** the request in a short transaction: `pg_try_advisory_xact_lock` (never waits) and a
`chat.config` row `checkout.opening:<request id>` naming this opener until a time (150 s). A second tap
while the first is opening gets **409 `COMM.CHECKOUT_OPENING`** at once ("a payment page is already
opening; try again"); the app and the link page show their general "try again" message, and the next tap
works. No transaction is open and no pool connection is held while Stripe is asked, so a burst of taps on
one request (the link is public) cannot use up the API's small connection pool.

The claim is renewed before every Stripe call; if another opener took it over (ours ran past its time),
nothing more is asked of Stripe. The session Stripe returned is recorded in a short transaction that also
checks the claim is still ours; if it is not, that page is expired and never handed out, so at most one page
stays payable. The claim row is removed when the open ends (its time covers an API process that died). The
idempotency key stays `checkout:<request>:<attempts>`; if the `payment_checkout` insert hits a unique
violation (`P2002`, the same Stripe session already recorded, as when Stripe answers a replayed key), that is
a replay: the same page, not a 500.

**Fail closed on an earlier page (LR-46 P2-1).** Before a new page is created, each earlier `open` attempt is
looked up at Stripe and expired. An attempt is marked `expired` only on Stripe's word: the expire call
succeeded, or a fresh look-up shows it `expired` (or `complete`, which is recorded as paid). If Stripe cannot
be reached for the look-up, or the expire fails and the page still shows `open` (or cannot be looked up
again), the attempt stays `open` in Chat, no new page is created, and the parent gets the usual **503
`COMM.PAYMENTS_UNAVAILABLE`** ("pay by bank transfer"); the next tap tries again. Such a tap creates no
session, so the hourly cap (`MAX_CHECKOUTS_PER_HOUR`, 10 sessions per request) does not count it: during a
Stripe outage each tap costs one or two Stripe look-ups and nothing more. A transient Stripe error is never
turned into a local state change. The claim is released on every path.

**A page Stripe cannot be asked about (W76b).** Stripe never takes a payment on a Checkout Session after its
`expires_at`. So when the look-up fails (Stripe no longer has the session, for example after the key or mode
changed, or Stripe is down) **and** the attempt's own `expires_at` passed more than **1 hour** ago
(`UNCONFIRMED_CLOSE_MARGIN_MS`: room for clock skew and a payment submitted in the page's last seconds), the
attempt is marked `expired` and an audit row `payment.checkout_closed_unconfirmed` is written with the request,
the session, its expiry and the Stripe error category. The tap then goes on and opens one new page. Before that
point the tap is still refused (503): a failed look-up on a page that may still be payable never closes it.
The reconciler applies the same rule on every pass, so such an attempt is cleared without anyone tapping. If the
page was in fact paid, its webhook still records the payment (it finds the attempt by session id, whatever its
status).

**After a cancel.** Cancelling a request expires its open pages at Stripe. A row is marked `expired` only when
the expire call succeeded, a look-up after a failed expire shows the page `expired`, or (as above) Stripe cannot
be asked and the page's expiry is over an hour past. Otherwise the row stays `open` and an error is logged
(`a cancelled request's page …`): the page may still be payable, the reconciler keeps asking Stripe, and a
payment that does come is recorded and flagged as an overpayment (M3). The cancel itself never fails on this.

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
- **Disputes (chargebacks) change no money in Chat (W59, M2).** A dispute on one of Chat's card payments is
  recorded and flagged: the event's outcome (`dispute_opened`, `dispute_updated`, `dispute_closed_<status>`,
  `dispute_funds_withdrawn`, `dispute_funds_reinstated`), an audit row (`payment.dispute_opened`,
  `payment.dispute_updated`, `payment.dispute_closed`, `payment.dispute_funds_withdrawn`,
  `payment.dispute_funds_reinstated`) naming the payment, request, dispute, charge, amount, Stripe's status
  and reason code, and an error log for a new dispute and for money withdrawn. The payment, its refunds,
  the request and the lesson package stay as they were. Responding with evidence happens in the Stripe
  Dashboard, before Stripe's deadline. Whether a lost dispute should reduce what Chat shows as received (a
  forward-only adjustment entry) is a follow-up decision. A dispute that arrives before Chat recorded the
  payment (its webhook was lost) is flagged against the request.
- **Other systems on the same Stripe account (W59, S3).** Every Checkout Session Chat opens, and its payment
  intent, carry `metadata.system = jawwid-chat` (with `paymentRequestId` and `organizationId`), so another
  system, or a person in the Dashboard, can tell Chat's objects apart. Chat never acts on an object it did
  not create: refunds and disputes on other payments are `not_chat`. Recurring Stripe Billing events
  (`invoice.*`, `customer.subscription.*`, `subscription_schedule.*`) keep the outcome `ignored_not_chat`
  rather than a new `recurring_observed`. The outcome already means "Stripe Billing, not Chat's, recorded,
  not acted on". Renaming it would split the webhook log's history and filter in two with no change in
  behaviour. Because those events are expected when another system bills on the account, they are now
  logged at info level, not as a warning.
- **No child's name on Stripe (W59, S6).** The Checkout line item is the request's label only (or "Live
  one-to-one Quran lessons" if the label is blank). The child's name stays in Chat's own records.
- **A refund does not take lessons back (W61 S4).** A refund gives money back; the lesson package the
  payment credited stays credited. There is no automatic lesson reversal (product decision; out of
  scope). So staff are not misled, Admin marks every refunded payment:
  - **Transactions detail**, when the payment bought lessons (its request is a subscription, a renewal
    or an instalment, or it pays an instalment with no request): "Refunded <amount>; the lesson package
    stays credited" (Arabic: "تم استرداد <amount>، وتبقى حصص الباقة مضافة كما هي"). For a trial's
    payment (`trialId`), a balance or anything else: just "Refunded <amount>" ("تم استرداد <amount>").
    A subscription or renewal is taken to have bought lessons; the detail does not carry
    `lessonsIncluded`.
  - **Parent profile's payments**, whose payload has no purpose: "Refunded <amount>. Refunds do not
    remove lessons already credited." ("تم استرداد <amount>. لا يُلغي الاسترداد الحصص المضافة من قبل.").

  Removing lessons after a refund is a manual staff action.

## 4a. A card while a bank-transfer receipt is waiting (W61 S2)

A parent who has sent a transfer receipt and then pays by card may be charged twice. A receipt is not money
until the academy approves it, so it never lowers what a request still owes. Instead:

- **Notice.** When a request has receipts with status `pending` (in its currency), the app's pay sheet and
  the `/pay` page say: "A transfer receipt for this request is waiting for the academy to check. Paying by
  card too may charge you twice." (Arabic, the pay sheet: "يوجد إيصال تحويل لهذا الطلب بانتظار مراجعة
  الأكاديمية. إن دفعت بالبطاقة أيضًا فقد يُخصم المبلغ مرتين."; the `/pay` page addresses the family in
  the plural, as the rest of that page does.)
- **Part covered.** Card is still allowed, for the whole remaining amount, with the notice.
- **All covered** (pending receipts ≥ what is left). `CheckoutService.open` refuses with
  `409 COMM.BILLING_STATE` and `error.detail = { reason: "receipt_pending", pendingMinor, remainingMinor }`;
  no Stripe page is opened. The app's pay sheet disables the card option and adds "Card payment will be
  available again if the academy cannot confirm the transfer."; it also tells this refusal apart from "no
  longer open" when it arrives from the server, and then keeps the card disabled for that sheet. The
  `/pay` page shows no card button.
- **No card offered** (Stripe not configured): neither surface shows the notice, since it is about a card.
- **Known gap.** A receipt uploaded after `CheckoutService.open` checked, while a Stripe page is already
  open, is not caught. Accepted: a receipt is not money until the academy approves it, so staff see both.
- A rejected receipt stops counting at once; an approved one becomes a payment (and so lowers what is left).
- The app reads pending receipts from `GET /me/billing`'s `receipts` (no new field). The `/pay` page reads
  them per request (`pendingReceiptMinor`, `payments-read.service.ts`).

## 5. Operations: setup, deploy, verify, roll back

Nothing here has been done in staging or production. Every step below is for the owner (or whoever the
owner authorizes) to run.

### 5.1 Environment

| Variable | Where | |
|---|---|---|
| `STRIPE_SECRET_KEY` | API + worker, secret | Unchanged name. Use a **restricted** key (`rk_live_…` in production, `rk_test_…` in staging) with these scopes: Checkout Sessions **write**, Refunds **write**, Customers **write**, PaymentIntents **read**, Charges **read**. The last three are new. Without them, customers are not created and card details and reconciliation are not read, but payments still record. In production it must match `^(sk\|rk)_live_\S+$` (any non-whitespace after the prefix; the prefix is the check): a test key, a publishable `pk_` key or anything else is refused. |
| `STRIPE_WEBHOOK_SECRET` | API, secret | Unchanged: the endpoint's `whsec_…`. In production it must match `^whsec_\S+$`, and it is required whenever a key is set. |
| `PAYMENT_LINK_BASE_URL` | API | Unchanged. |
| `STRIPE_RECONCILE_MS` | worker, optional | Reconcile interval. The default is `300000` (5 minutes); `0` turns it off. |

No secret is ever logged, returned or stored by Chat. Configure the secrets only in the platform's secret
store (`infra/env/manifest.tsv` lists them).

**Production phase rule (Stripe M1).** Card payments must work at the first public launch; production is
deployed earlier, during store review:

| `LAUNCH_PHASE` (production Environment variable) | Stripe secrets |
|---|---|
| `review` | Optional. Unset means cards are off (bank transfer and cash work), so the first production deploy is not blocked. If set, they must be live and well formed. |
| `launch` | **Both required.** The deploy (`scripts/infra/check-env.sh production`) refuses to run without them. |

The formats are checked twice with the same rules: by the deploy before anything changes
(`check-env.sh`), and by the API and the worker at boot (`apps/api/src/billing/stripe-config.ts`). Neither
ever prints a value; the error names only the variable.

### 5.2 Stripe Dashboard

1. **Developers → Webhooks → Add endpoint**: `https://<api host>/api/v1/stripe/webhook`. Events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`,
   `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`,
   `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`.
   For an existing endpoint, **add** any that are missing, in particular the five `charge.dispute.*` events
   (W59) and `refund.failed`.
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
4. Before switching production to `LAUNCH_PHASE=launch`: the live `STRIPE_SECRET_KEY` and
   `STRIPE_WEBHOOK_SECRET` are set in the `production` GitHub Environment (the launch deploy refuses
   without them).
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
5. Stripe Dashboard → the webhook → **Resend** an old event. The Dashboard's delivery log shows a 200 with
   the body `{"received":true,"outcome":"duplicate"}`, and the API log prints `stripe webhook: <type> ->
   duplicate`. Admin → Stripe events does **not** gain a row (the table is keyed by event id; a redelivery
   is detected before anything is written), and nothing else changes.
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

### 5.6a Pausing card payments (W63 kill switch)

When card payments must stop at once (a suspected Stripe problem, a wrong price, a key that may be
exposed) and revoking the key in Stripe is too slow or too broad, pause them from Admin Web:
**Payments → Settings → Card payments → Pause card payments**, then confirm.

- **Who:** the super admin and the Operations Manager, the same people who may change any payment
  setting (`POST /billing/settings`, permission `billing.verify` plus the billing `canAssign` rule).
  Everyone else gets `BILLING_DENIED`. Read-only staff see the state but no switch.
- **Where it lives:** the global `chat.config` key `billing.card_paused` (`true` or `false`; no
  migration). Every switch writes one `chat.audit_log` row, action `billing.card_pause_set`, with the
  actor, the time, and `before`/`after` `{ cardPaused }`.
- **What stops:** every `cardAvailable` is `false` (the app's `/me/billing`, the `/pay` link page,
  Admin's settings and a family's billing), and a new Stripe Checkout is refused with
  `PAYMENTS_UNAVAILABLE` (503), so the app and the link page offer bank transfer instead. Admin's
  Payments page shows **Card payments paused** on every tab.
- **What keeps working:** Stripe webhooks, the reconciler and staff refunds of card payments. A parent
  already on Stripe's page when the pause was set can finish, and that payment is recorded; earlier
  payments, refunds and disputes are still recorded.
- **A malformed value** (anything but `true`/`false`, e.g. set by hand in SQL) is treated as
  **paused**, and the API logs `billing.card_paused is not true or false`. Card is a convenience and
  bank transfer always remains, so a switch meant to be on must never read as off. Fix it by pressing
  Resume (or Pause) in Admin, which writes a proper value.
- **Resume:** the same place, **Resume card payments**, then confirm. Takes effect on the next request
  (the value is read on every request, never cached).

Check the state read-only:
```sql
select value, updated_at from chat.config where key = 'billing.card_paused';
select actor_id, at, before, after from chat.audit_log where action = 'billing.card_pause_set' order by at desc limit 5;
```

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
| outcome `ignored_not_chat` (info) | Stripe Billing is in use on the account (another system's recurring charges) | Nothing in Chat |
| outcome `not_chat` | A refund or dispute on a payment Chat did not take | Nothing in Chat; it belongs to another system on the account |
| `stripe dispute … dispute_opened` / `dispute_funds_withdrawn` (error), audit `payment.dispute_*`, outcome `dispute_*` | A parent's bank disputed a Chat card payment | Respond in the Stripe Dashboard before the evidence deadline. Chat's ledger is unchanged. |
| outcome `refund_deferred` older than an hour | A refund on a Chat checkout whose payment Chat has not recorded, one Chat could not classify (Stripe unreachable), or one tagged `jawwid-chat` with no Chat checkout (warning log) | Admin → Stripe events; find the payment intent in Stripe |
| `payment.checkout_closed_unconfirmed` in `chat.audit_log` | Stripe could not be asked about a card page over an hour past its expiry; it was marked expired | Occasional (Stripe down): fine. Many: check the key and mode (`STRIPE_SECRET_KEY`) |
| `a cancelled request's page … left open` (error) | A cancelled request's Stripe page could not be expired | Check it in the Stripe Dashboard; a payment that comes is flagged as an overpayment |
| `stripe customer not created` / `paying as a guest` (warn) | Customers scope missing, or a customer was deleted | Fix the key scopes |

SQL for operations (read-only):
```sql
-- webhook outcomes in the last day
select outcome, type, count(*) from chat.stripe_event where received_at > now() - interval '1 day' group by 1, 2 order by 3 desc;
-- card attempts still open after their expiry (the reconciler should clear these within minutes)
select stripe_session_id, created_at from chat.payment_checkout where status = 'open' and expires_at < now() - interval '15 minutes';
```

## 6. Tests

All tests use the in-memory Stripe stand-in (`apps/api/test/integration/fake-stripe.ts`). Webhook
signatures are signed and verified by the real Stripe SDK. No network, no real payment.

| Scenario | Where |
|---|---|
| Successful payment (link and app); one customer, metadata only; server-side amount (a body `amountMinor` ignored); recorded once with charge, brand, last 4; lessons credited once | `pd027-stripe-lifecycle-http.spec.ts` › a successful card payment |
| Out of order: `payment_intent.succeeded` before `checkout.session.completed` | same |
| Duplicate delivery (same event, redelivered; a second confirming event) | same, and the existing `pd027-payments-http.spec.ts` |
| Renewal: a second paid package, credited once | same |
| Customer creation refused, or the customer deleted in the Dashboard: the parent still pays (guest) | same |
| Declined card: counted once per event, code only, parent told why (app and link page), staff see it | › a payment that fails |
| Cancelled and expired checkouts | same |
| Invalid signatures (wrong secret, forged header, tampered body): 400, no event row | same |
| Incorrect amount or currency, by either confirming event: never recorded, audited | same |
| Refund before its payment (deferred, then recorded); Dashboard refund via `charge.refunded`, once; failed refund; pending-then-failed refund audited | › refunds |
| Database failure mid-webhook: 500, nothing left, the retry records once | › recovery |
| Stripe unreachable (event lookup, card details, reconcile): retried or recorded without details, never lost | same |
| Lost webhook: the reconciler records once, marks expired, survives Stripe being down; per-payment reconcile | same |
| Stripe Billing events (`invoice.*`, `customer.subscription.*`): change nothing | › Stripe Billing events |
| W59: `system: jawwid-chat` on the session and its payment intent; no child's name on the line item | › S3 + S6, and `test/unit/billing/stripe-disputes-hygiene.spec.ts` |
| W59: each dispute event on a recorded payment (by payment intent or charge): outcome, one audit row, error log for opened and funds withdrawn, ledger unchanged; foreign dispute, refund and `charge.refunded` are `not_chat`; an unclassifiable refund stays deferred | › disputes (M2), and the unit spec above |
| Ledger filters, totals, paging, detail; family scope; parents, teachers, unauthenticated refused; another family's request refused; webhook-log tenancy | › the transaction ledger |
| Overpayment (M3): bank transfer then a late card webhook, and an instalment paid in cash while the card paid it, are recorded, flagged, staff told, the transaction marked; an owed payment is never flagged | `pd027-overpayment-checkout-lock.spec.ts` › M3 |
| One payable session (S1): two concurrent opens (service and HTTP) create one Stripe session, the other tap gets 409 `CHECKOUT_OPENING`; eight opens on a 3-connection pool leave an unrelated query fast; a claim lost before or during Stripe creates nothing or hands nothing out; an already-recorded session answers the same page, no 500 | same › S1 |
| Fail closed (LR-46 P2-1, W76b): an earlier page Stripe cannot confirm closed gives 503 and no new page; one Stripe cannot find and over an hour past its expiry is marked expired (audited) by a tap or the reconciler; after a cancel, a failed expire leaves the row open | same › LR-46 |
| Pure parts: id patterns, intent facts, decline wording, filters, cursors, rate-limit wiring | `test/unit/billing/pd027-stripe-lifecycle.spec.ts` |
| W63 card pause: who may switch it, `cardAvailable` false everywhere, Checkout refused, an in-flight payment still recorded by its webhook, resume, audit rows, malformed value fails safe | `pd027-payments-http.spec.ts` › W63; `test/unit/billing/card-pause.spec.ts`; Admin `Payments.test.tsx` › W63 |
| Admin Web tabs, filters, detail, reconcile, access | `apps/admin-web/src/features/payments/Ledger.test.tsx` |
| App: parsing (old and new server), banner wording per code, card label | `test/features/billing/pd027_card_failure_test.dart`, `test/core/data/http/billing_payments_over_http_test.dart` |
| W61 S2: card refused when pending receipts cover what is left (app and `/pay`), allowed when they cover part; rejected or other-currency receipts do not count | `apps/api/test/integration/w61-pending-receipt-http.spec.ts`, `test/unit/billing/w61-pay-page-receipt.spec.ts` |
| W61 S2: the pay sheet notice in English and Arabic; card disabled when covered; the server's receipt_pending refusal said in the sheet and the card then disabled; no notice when no card is offered | `test/features/billing/w61_pending_receipt_test.dart` |
| W61 S4: refund wording in the Transactions detail (lessons kept for a lesson purchase; plain for a trial or a balance) and the neutral line on the parent profile, English and Arabic | `Ledger.test.tsx`, `apps/admin-web/src/features/profiles/ProfilePayments.test.tsx` |
