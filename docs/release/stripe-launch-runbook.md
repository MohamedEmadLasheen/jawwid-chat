# Stripe launch runbook: turning card payments on at the public launch (M4)

Status: written 2026-11-10 against `main` (`7cc7aab5`) and the open PRs #579 (config guard), #580
(disputes, system metadata) and #581 (overpayment flag). Nothing in it has been run. Every step is for the
owner, or whoever the owner authorizes, to execute by hand. LR-34.

What this runbook is **not**: a change to Jawwid Core. The Stripe account is **shared** with Jawwid Core.
Core's objects, webhooks and settings are never touched here; the runbook only says what to look at so Core
is confirmed unaffected.

Companion documents: `docs/admin/pd027-stripe-lifecycle.md` (design, events, reconciliation, §5
operations), `docs/admin/pd027-payments.md` (the PD-27 contract), `docs/infrastructure/production-runbook.md`
§1c (the launch cutover) and `docs/infrastructure/production-readiness.md` (the GitHub configuration).

**Labels.** Stripe changes its Dashboard navigation. A label marked **UNVERIFIED** is the name as best
known from Stripe's own documentation and from `pd027-stripe-lifecycle.md` §5.2; it was not checked against
a live Dashboard while writing this. Use the Dashboard's search box with the noun (Webhooks, API keys,
Radar) if a path differs. No label from the code is unverified: those are quoted from `main`.

**Order of merges this runbook assumes.** #579, #580 and #581 are merged and deployed to production before
the launch deploy. If #580 is not merged, skip the five `charge.dispute.*` events in §2 (they would be
recorded as `ignored` and nothing else; harmless) and ignore the `not_chat` outcome in §6. If #579 is not
merged, the `LAUNCH_PHASE=launch` deploy does **not** require the Stripe secrets, and a `pk_live_` key is
refused only by Stripe, not by the deploy. Nothing else in this runbook depends on #581.

A fourth PR, **W63** (#584, "Pause card payments", an Admin switch that turns the card option off while
webhooks and the reconciler keep working), is merged ahead of this runbook. It is the preferred fast stop in
§6.9 (option A'). The pause wins everywhere, App Review mode included (owner, 2026-11-12).

---

## 1. Read-only pre-checks in the Stripe Dashboard (live mode)

Do these in **live mode** (the Dashboard's test-mode toggle off; UNVERIFIED label: "Test mode" switch,
top right). Change nothing in this section.

1. **Confirm the account.** Open the account picker (UNVERIFIED: top-left account name) and confirm the
   account is the one Jawwid Core already charges on. Record the account's display name in the password
   manager next to the Chat entries (§2 and §3) so the two systems are never configured on different
   accounts by mistake. Both systems MUST share this account: PR #580's design (`not_chat` outcomes,
   `metadata.system = jawwid-chat` on Chat's objects) exists because they do.
2. **List the existing webhook endpoints.** Developers → Webhooks (UNVERIFIED; in newer Dashboards:
   Workbench → Webhooks). For each endpoint already there, note its URL, status (enabled/disabled), API
   version and its list of events. These are Core's. **Do not edit, disable or delete any of them.** Chat
   gets its own endpoint in §2. Stripe delivers each event to **every** endpoint subscribed to it, so from
   the first smoke-test charge Core receives every event about Chat's objects that a Core endpoint is
   subscribed to. Write down every event in the §2 table that any Core endpoint also listens to. The ones
   that matter most are the payment events, not only the refund ones: `checkout.session.completed`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.succeeded` (Chat does not
   subscribe to it, but Core may) and `charge.refunded`, `refund.*`, `charge.dispute.*`. **Before the
   first live charge (§6.2), the owner confirms how Core handles an event about an object it did not
   create.** Chat's objects carry `metadata.paymentRequestId` and `organizationId`, and with #580
   `metadata.system = jawwid-chat`; Core can recognise them by that. This is a question for the owner
   about Core; nothing in Core is changed here, and if the answer is "Core would act on it", the launch
   waits for Core, not for a Chat change.
3. **List the existing API keys.** Developers → API keys (UNVERIFIED). Note the names of existing standard
   and restricted keys. **Do not roll, reveal or delete any of them**: rolling the standard secret key
   would break Core. Chat gets its own restricted key in §3.
4. **Account-wide settings that affect Core too.** The following are per account, not per key or endpoint.
   Read them and note their current values; do not change them for Chat without an explicit decision that
   also covers Core, because the same change applies to every Core charge:
   - Branding (UNVERIFIED: Settings → Business → Branding): the logo, icon and colours on the hosted
     Checkout page Chat's parents will see. Core's receipts and pages use the same.
   - Public business details and **statement descriptor** (UNVERIFIED: Settings → Business → Public
     details): the text on the cardholder's bank statement. Chat does not set a per-charge descriptor
     (`stripe.gateway.ts` `createCheckout` sends none), so the account default is what parents see.
   - **Customer e-mails** (UNVERIFIED: Settings → Business → Customer emails): "successful payments" and
     "refunds" e-mail switches. Chat creates its Customers with **metadata only, no e-mail**
     (`stripe.gateway.ts:141-147`), so Stripe cannot e-mail a Chat parent a receipt either way; Chat sends
     its own invoice and push. The switch still governs Core's customers.
   - **Radar** rules and **3-D Secure** settings (UNVERIFIED: Radar → Rules; Settings → Payments):
     `pd027-stripe-lifecycle.md` §5.2 step 5 says these stay at Stripe's defaults. Checkout applies
     whatever is configured; a stricter rule blocks Core's payments too.
   - **Payment methods** (UNVERIFIED: Settings → Payment methods): which card networks and wallets the
     hosted Checkout offers. Chat stores only the method type, brand, last 4 and wallet type
     (`toIntentFacts`, `stripe.gateway.ts:285-301`).
   - **Currency** settings: Chat charges in the request's currency, lower-cased
     (`stripe.gateway.ts:177`). Confirm the account can settle that currency.
5. **Existing Customers and Billing.** Note whether the account has Stripe Billing subscriptions, invoices
   or subscription schedules in use (Core's). Chat records their webhook events as `ignored_not_chat` and
   never acts on them (`checkout.service.ts:253-258`; #580 logs them at info level). Do not subscribe
   Chat's endpoint to them (§2).

Write down, with the date, what you found in steps 2 to 4. That note is the "before" picture for §6.7.

---

## 2. Create Chat's webhook endpoint

Still in live mode. Developers → Webhooks → **Add endpoint** (UNVERIFIED; newer: Workbench → Webhooks →
Add destination, type "Webhook endpoint").

- **Endpoint URL:** `https://api.chat.jawwid.com/api/v1/stripe/webhook`
  (the route is `POST /stripe/webhook` under the global prefix `api/v1`: `stripe-webhook.controller.ts:40,49`
  and `main.ts:82`; the host is `PRODUCTION_API_BASE_URL`, `scripts/infra/production-setup.py:45`).
- **Description:** something that names Chat (for example "Jawwid Chat API, production"), so nobody
  mistakes it for Core's.
- **API version:** **pin it** to the version the Stripe SDK pins; do not leave "account default". The
  account default belongs to the shared account, so if Core ever upgrades it, an unpinned Chat endpoint
  would start receiving payloads in the new shape. The API constructs its client with no `apiVersion`
  (`stripe.gateway.ts:125`), so every call and every verified event uses the version baked into the
  installed `stripe` package (`apps/api/package.json`: `^23.0.0`). Read the exact string from
  `apps/api/node_modules/stripe/cjs/apiVersion.js` on the deployed build (or the `Stripe-Version` header
  Stripe shows under Developers → Logs for any Chat request) and choose that version in the endpoint's
  "API version" picker (UNVERIFIED label). The string the review quoted is `2026-09-30.endive`; confirm it
  against the file rather than copying it from here. Pinning affects only Chat's endpoint, never Core's.
- **Events to send:** exactly these, and nothing else.

| Event | Handled where (on `main` unless noted) | Outcome recorded |
|---|---|---|
| `checkout.session.completed` | `checkout.service.ts:233-238` → `confirm` | `recorded`, `already_recorded`, `awaiting_payment`, `mismatch`, `unknown_session` |
| `checkout.session.async_payment_succeeded` | same | same |
| `checkout.session.async_payment_failed` | `:239-240` | `checkout_failed` |
| `checkout.session.expired` | `:241-242` | `checkout_expired` |
| `payment_intent.succeeded` | `:243-244` → `intentSucceeded` (second path to the same confirm) | as confirm, or `ignored`, `unknown_session` |
| `payment_intent.payment_failed` | `:245-246` → `intentFailed` | `payment_failed` |
| `refund.created` | `:247-250` → `refundEvent` | `refund_recorded`, `refund_deferred`, `refund_not_final`, `refund_failed_after_record`; #580 adds `not_chat` |
| `refund.updated` | same | same |
| `refund.failed` | same | same |
| `charge.refunded` | `:251-252` → `chargeRefunded` | `refund_recorded`, `refund_deferred`, `already_recorded`; #580 adds `not_chat` |
| `charge.dispute.created` | **#580** `DISPUTE_EVENTS` → `disputeEvent` | `dispute_opened`, or `not_chat` |
| `charge.dispute.updated` | #580 | `dispute_updated` |
| `charge.dispute.closed` | #580 | `dispute_closed_<status>` (`won`, `lost`, `warning_closed`, `unknown`) |
| `charge.dispute.funds_withdrawn` | #580 | `dispute_funds_withdrawn` |
| `charge.dispute.funds_reinstated` | #580 | `dispute_funds_reinstated` |

That is 10 events on `main` and 15 with #580. **Do not** select `invoice.*`, `customer.subscription.*`,
`subscription_schedule.*` or "all events": Chat records them as `ignored_not_chat` or `ignored` and does
nothing; on a shared account they are Core's traffic and only noise in Admin → Payments → Stripe events.

After **Add endpoint**:

1. Open the new endpoint and **Reveal** its signing secret (UNVERIFIED label: "Signing secret", `whsec_…`).
2. Store it in the password manager as a new entry named for Chat production (for example "Jawwid Chat
   production, Stripe webhook signing secret"), with the endpoint URL and the date. Never paste it into a
   chat, an issue, a commit, a brief or a file in the repository.
3. The endpoint will show failed deliveries (503) until §4 is deployed with the secret: the API answers 503
   while `STRIPE_WEBHOOK_SECRET` is unset (`stripe-webhook.controller.ts:52`). Stripe retries for three
   days. Nothing is lost if §4 happens within that window; create the endpoint no earlier than that.

The format rule enforced by #579: the value must match `^whsec_\S+$` (`stripe-config.ts`, `check-env.sh`).
Copy it without surrounding spaces.

---

## 3. Create a restricted live key

Developers → API keys → **Create restricted key** (UNVERIFIED). Name it for Chat (for example
"Jawwid Chat API, production"). Give it exactly the permissions below and leave every other resource at
**None**. Each row names the Stripe SDK call in `stripe.gateway.ts` that needs it and the caller on `main`.

| Stripe resource (UNVERIFIED Dashboard label) | Permission | SDK call in `stripe.gateway.ts` | Needed by |
|---|---|---|---|
| **Checkout Sessions** | Write | `checkout.sessions.create` (`:169`), `checkout.sessions.retrieve` (`:200`), `checkout.sessions.expire` (`:204`), `checkout.sessions.list` (`:150`) | open a payment page (`checkout.service.ts:158,166`), find and expire an earlier page (`:110,118`; `payments.service.ts:890`), confirm from `payment_intent.succeeded` (`checkout.service.ts:271,286`), the reconciler (`stripe-reconciler.service.ts:77`) |
| **Refunds** | Write | `refunds.create` (`:208`), `refunds.list` (`:163`) | a staff refund (`payments.service.ts:465`); syncing refunds after a payment or `charge.refunded` (`checkout.service.ts:350`) |
| **Customers** | Write | `customers.create` (`:142`) | one Customer per family, metadata only (`checkout.service.ts:204`) |
| **PaymentIntents** | Read | `paymentIntents.retrieve` with `expand: ['latest_charge']` (`:156`) | charge id, card brand, last 4, amounts received and refunded (`checkout.service.ts:486`, `stripe-reconciler.service.ts:153`) |
| **Charges** | Read | the `latest_charge` expansion of the call above (`:156-158`) | same; without it the payment records with no charge or card details |
| **Webhook Endpoints** | None | `webhooks.constructEvent` (`:221`) needs only the signing secret, not the key | — |
| Everything else (Balance, Payouts, Disputes, Invoices, Subscriptions, Products, Prices, Connect, …) | None | no call in the code | Disputes are read from the **webhook payload** only (#580 `toDisputeFacts`); no `disputes.*` API call exists |

Notes grounded in the code:

- There is no other Stripe call. `grep` for `this.stripe.` across `apps/api/src` finds only the gateway
  methods listed above: eight on `main` (`createCheckout`, `retrieveCheckout`, `expireCheckout`, `refund`,
  `createCustomer`, `findCheckoutByPaymentIntent`, `paymentIntentFacts`, `listRefunds`) and a ninth with
  #580 (`paymentIntentSystem`, another `paymentIntents.retrieve`, covered by the PaymentIntents row).
- Stripe may group Checkout Sessions under "Checkout" and may require **Products**/**Prices** read for
  `price_data` line items; the code uses inline `price_data` (`stripe.gateway.ts:176-184`), not stored
  Prices. If Stripe refuses a checkout with a permission error after deploy (API log line
  `stripe checkout refused: <category>`, `checkout.service.ts:172`), add the permission Stripe's error
  names and nothing more. UNVERIFIED which extra grants, if any, Stripe demands.
- **Rehearse the scopes in test mode before the launch window.** Do not let a missing scope show up for
  the first time as a failed live checkout. In the Dashboard with the test-mode toggle **on**, create a
  restricted **test** key (`rk_test_…`) with exactly the permissions in the table above, set it as
  `STRIPE_SECRET_KEY` in the **staging** Environment (with staging's test-mode webhook secret), deploy
  staging, and run `pd027-stripe-lifecycle.md` §5.5 steps 1, 4, 5 and 7 (a card payment, an Admin refund,
  a resent event, a Reconcile). If any step fails with a permission error, add the permission Stripe
  names to the test key, retest, and give the live key in this section the same permission. Only then
  create the live key with the proven set. The staging guard accepts a test key; production refuses one
  (`stripe-config.ts`), so the rehearsal cannot be confused with the live key.
- `rk_live_` is accepted by the boot guard (`stripe-config.ts`; #579 `LIVE_KEY`). A publishable
  `pk_live_` key, a test key, or the webhook secret pasted into the key slot is refused by the deploy and by
  the API at boot (#579). `stripe.gateway.ts:137-139` only reports `livemode` from the key's prefix.
- Missing **Customers** write: Chat logs `stripe customer not created` and the parent pays as a guest;
  payments still record (`checkout.service.ts:218`). Missing **PaymentIntents**/**Charges** read: payments
  record without card details, and Reconcile cannot compare. Neither loses money, but fix the key.

Store the key in the password manager as its own entry (for example "Jawwid Chat production, Stripe
restricted key"), with the key's name in Stripe and the date. Stripe shows it once.

---

## 4. GitHub `production` Environment

The Stripe secrets and the variables below come from the `production` GitHub Environment
(`deploy-production.yml:198, 287-295`). `PRODUCTION_API_BASE_URL`, which the payment-link default is built
on, is a **repository** variable, not an Environment one (`production-setup.py` `REPO_VARS`). Set values
with the repository's helper, which uses gh's hidden prompt and never prints a secret
(`docs/infrastructure/production-readiness.md`, "Filling the GitHub configuration"):

```
python3 -I scripts/infra/production-setup.py status
python3 -I scripts/infra/production-setup.py ask STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
```

| Name | Kind | Value | Notes |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | secret | the `rk_live_…` key from §3 | API and worker. Must match `^(sk\|rk)_live_\S+$` (#579). Setting it turns `cardAvailable` on everywhere unless card payments are paused (W63, `card-pause.ts`; a malformed `billing.card_paused` counts as paused) (`stripe.gateway.ts:129-131`; `billing.service.ts:632,710`, `payments.service.ts` `presentSettings`, `pay-link.controller.ts:102`). |
| `STRIPE_WEBHOOK_SECRET` | secret | the `whsec_…` from §2 | API. Required whenever the key is set (`stripe-config.ts`; `check-env.sh`). Must match `^whsec_\S+$` (#579). |
| `PAYMENT_LINK_BASE_URL` | variable | **leave unset** | The deploy defaults it to `PRODUCTION_API_BASE_URL` + `/api/v1`, i.e. `https://api.chat.jawwid.com/api/v1` (`deploy-production.yml:292`). Payment links are built on it (`payment-ledger.service.ts:123-125`). Set it only if the public API origin ever differs from `PRODUCTION_API_BASE_URL`. |
| `SUBSCRIPTION_LOCK_ENFORCED` | variable | **leave unset** (defaults to `false`, `deploy-production.yml:295`) | PD-30's payment lock stays **off** in production (owner, 2026-11-06, `docs/product/pd-registry/PD-30-amendment-chat-open.md`). Turning Stripe on does not change this. |
| `STRIPE_RECONCILE_MS` | variable | leave unset (default 5 minutes, `worker.ts:102`) | The reconciler starts with the worker; nothing to switch on. |
| `LAUNCH_PHASE` | variable | `review` until the launch window; `launch` **only** in the public-launch deploy | With #579, the deploy at `launch` **refuses to run** unless both Stripe secrets are set (`check-env.sh`: `MISSING STRIPE_SECRET_KEY`, `MISSING STRIPE_WEBHOOK_SECRET`). So §2 to §4 must be complete before the launch deploy. `launch` also drops the in-app Redis and requires managed Valkey and a measured `TRUSTED_PROXY_HOPS` (`production-runbook.md` §1c, `app-spec.py:458-476`); that is the same window. |

Both secrets may be set while `LAUNCH_PHASE=review`: then the next review-phase deploy already takes cards
(the guard accepts a live key in either phase, #579). Decide deliberately: if cards must stay off until the
public launch, set the two secrets in the launch window itself, immediately before switching
`LAUNCH_PHASE`.

After the deploy, the workflow summary table prints a `launch phase` row (`deploy-production.yml`, the
summary step near line 445). The API and
worker logs print the Stripe state at boot only through the payment-lock line
(`main.ts:124`, `worker.ts:330`); the Stripe check itself is silent on success and fails the boot on error
with a message naming the variable, never the value.

---

## 5. Admin settings in production (Admin Web)

Card payments produce Chat's own numbered invoices (`JW-<year>-<n>`, `invoice-pdf.ts`). The invoice prints
the issuer frozen at the moment of recording (`payment-ledger.service.ts:416`), so the issuer must be set
**before** the first real payment, or the first invoices print without it.

Open Admin Web → **Payments** → **Settings** tab (`copy.ts:38`). Only the **super admin** and the
**Operations Manager** may save this tab (`payments.service.ts:684-687`, `copy.ts:103-104,603`); everyone
else sees it read-only.

| Setting | `chat.config` key | Fields (`payments.service.ts:906-924`) | Needed for |
|---|---|---|---|
| **Invoice issuer** | `billing.invoice_issuer` | `name` (required, ≤120), `address` (≤300), `taxId` (≤64) | every invoice, card or not |
| **Bank account** | `billing.bank_account` | `accountName` (required, ≤120), `bankName`, `iban`, `accountNumber`, `swift`, `note` | the bank-transfer option on payment links and in the app; the fallback when card is unavailable |
| Reminders | not `chat.config`: `chat.notification_rule.enabled` per rule (`payments.service.ts:709`) | per-rule on/off | unchanged by this runbook |

The same tab shows two read-only badges from the server (`PaymentsPage.tsx:351-358`):
**"Stripe connected"** / **"Not configured: no card option anywhere."** (`cardAvailable`) and
**"Webhook configured"** (`webhookConfigured`). After §4 both must be green. Every save writes an audit row
`billing.settings_set` with before and after (`payments.service.ts`, the `setSettings` transaction near
line 710).

Nothing about Stripe is set through Admin Web. The one card switch on this tab is W63's **"Pause card
payments"** ("إيقاف الدفع بالبطاقة مؤقتًا"): `cardAvailable` is "a secret key is configured **and** card
payments are not paused" (§4, §6.9). While paused, the tab shows a **"Card payments paused"** badge instead
of "Stripe connected".

---

## 6. M4 live smoke test after the launch deploy

**Who pays.** Not a real customer, and not a family in the real academy's customer base. Use a **dedicated
internal test family** that the owner controls: its parent account is the owner's own (or a staff member's
own phone), the child is a test child, and the card is the owner's own real card. The payment is real money
on the live account; it is refunded in step 6.5. Create this family before the window through the normal
intake (`docs/admin/pd042-entering-families.md`), with a label that makes it unmistakable as internal.

**Who acts.** A staff account with `canVerify` (the super admin or the Operations Manager): refunds,
Reconcile and the Stripe events tab need it (`transactions.controller.ts:36-37,51-52,56-57`;
`payments.controller.ts:51`).

Keep the amount small but above Stripe's minimum for the currency.

### 6.1 Create the request

Admin Web → the test family's Parent Profile → create a payment request (`POST /families/:id/payment-requests`,
`payments.controller.ts:26`). The response carries the link `https://api.chat.jawwid.com/api/v1/pay/<token>`.

Expected: the parent app (Settings → Payments) shows the open request with a **card** option; the link page
shows "Pay by card" beside the bank transfer (`pay-page.ts:148`, `cardAvailable`).

### 6.2 Pay with a real card

Open the link (or the app's Pay) and pay. Chat opens a Stripe Checkout Session for exactly what is owed
(`checkout.service.ts:133,145`), with `metadata.paymentRequestId` and `organizationId` (and, with #580,
`metadata.system = jawwid-chat`). The hosted page is Stripe's; the line item is the request's label (with
#580, never the child's name).

Expected on Stripe's page: the account branding from §1.4, the amount and currency of the request, then a
redirect back with `?checkout=success` (`checkout.service.ts:149`).

### 6.3 Check what Chat recorded

Admin Web → Payments:

1. **Stripe events** tab: within seconds, rows for `checkout.session.completed` and
   `payment_intent.succeeded` (either order). One has outcome `recorded`, the other `already_recorded`
   (`pd027-stripe-lifecycle.md` §3.2, "Order does not matter"). Find the two rows by the smoke test's
   session id (`cs_live_…`) and payment intent (`pi_…`) from the Stripe Dashboard, not by time alone.
   Stop only if a row **about the smoke-test session or payment intent** shows `mismatch` or
   `unknown_session`, or the endpoint answered 400 for it: see §6.9 and `pd027-stripe-lifecycle.md` §5.7.
   Other rows with `unknown_session` or `ignored` in the same minutes are not an alarm on a shared
   account: Chat's endpoint receives every `checkout.session.*` and `payment_intent.*` event on the
   account, so a Core Checkout Session records as `unknown_session` and a Core payment intent (no
   `paymentRequestId` in its metadata) as `ignored`. #580's `not_chat` covers only refunds and disputes.
2. **Transactions** tab: exactly **one** payment, method card, with brand and last 4, the Stripe
   references (session, payment intent, charge, customer, `livemode: true`), and the invoice number.
   With #581 there is no "Overpaid" marker (the request was owed).
3. **Card attempts** tab: the attempt is `complete`.
4. The invoice: open it from the transaction (`GET /invoices/:id/link`) and confirm the issuer from §5 is
   printed.
5. The push: the test parent's phone receives "We received your payment" (`payment_received`,
   `payment-ledger.service.ts:365-389`), and the app's payment history shows the card and the invoice.
6. The package: the request's lessons are credited **once** (PD-30 trigger; the child's balance in the
   Parent Profile).

Stripe side (read-only): Payments → the payment shows the metadata above; Customers → one Customer with
`familyId` and `organizationId` metadata, no name, no e-mail. **Do not delete it** (`pd027-stripe-lifecycle.md`
§5.2 step 4).

### 6.4 Resend one event (idempotency)

Before resending, note the row count in Admin → Stripe events (or the count of rows for that event id: it
is one). Then Stripe Dashboard → the Chat endpoint → the `checkout.session.completed` delivery → **Resend**
(UNVERIFIED).

Expected: the redelivery is answered **200** and the response body shown in the Dashboard's delivery log
reads `{"received":true,"outcome":"duplicate"}` (`stripe-webhook.controller.ts:64`); the API log prints
`stripe webhook: checkout.session.completed -> duplicate`. Admin → Stripe events does **not** gain a row:
the `stripe_event` table is keyed by the event id, so a redelivered event is detected before anything is
written (`checkout.service.ts:230`) and never appears as a second row. Confirm the row count is unchanged
and the payment is still exactly one. A `duplicate` row in Admin would be a bug, not the expected result.

### 6.5 Refund from Admin

The Transactions ledger is read-only (its one action is Reconcile, `copy.ts:318-320`); the Refund button
lives on the **Parent Profile**. Admin Web → the test family's Parent Profile → the payments list → the
card payment → **Refund** (`ParentProfilePage.tsx:502` `canRefund`, `PaymentParts.tsx`, `RefundPaymentDialog`)
→ the full amount, with a reason. This calls `refunds.create` at Stripe inside one locked transaction
(`payments.service.ts:409-470`).

Expected:
- the transaction reads **Refunded** (`copy.ts:313`), one refund line "through Stripe";
- Stripe events: `refund.created` (and possibly `refund.updated`, `charge.refunded`) with outcomes
  `refund_recorded` / `already_recorded`, never a second refund row;
- the parent app shows the refund in the payment history.

Stripe side: the refund on the payment, with the same amount. Do **not** also refund from the Stripe
Dashboard on this payment: it is already fully refunded. A Dashboard-initiated refund is covered by the
staging rehearsal (`pd027-stripe-lifecycle.md` §5.5 step 4, run as part of §3's rehearsal above), not by
the live smoke test.

### 6.6 Reconcile

1. The payment → **Reconcile with Stripe** (`copy.ts:389`). Expected: "in sync", refunds recorded now: 0
   (`stripe-reconciler.service.ts:135-178`).
2. Stripe events tab → **Reconcile now** (`copy.ts:434`, `POST /stripe/reconcile`). Expected: checked ≥ 0,
   payments recorded 0, marked expired 0, refunds recorded 0, errors 0.
3. Optional, worker log within 5 minutes: no `stripe reconcile: … differs from Stripe` line.

Read-only SQL, if database access is at hand (`pd027-stripe-lifecycle.md` §5.7):

```sql
select outcome, type, count(*) from chat.stripe_event where received_at > now() - interval '1 day' group by 1, 2 order by 3 desc;
```

### 6.7 Confirm Core was not affected

There is no Core-side step and no Core change. Look only at Chat and at the Dashboard, read-only:

- Stripe Dashboard → Webhooks: Core's endpoints from §1.2 are unchanged (same URLs, same events, still
  enabled). Their delivery logs may now show Chat's events (any event from §1.2's overlap list, such as
  `checkout.session.completed`, `payment_intent.succeeded`, `refund.created`, `charge.refunded`); that is
  Stripe's fan-out, not a change, and the §1.2 confirmation covers what Core does with them.
- Stripe Dashboard → API keys: Core's keys are unchanged; only the new Chat restricted key was added.
- Settings from §1.4 are unchanged against the note taken then.
- Admin → Stripe events: every row has one of the outcomes from §2. Core's traffic during the window
  shows up in four ways, none of them a problem: a Core Checkout Session as `unknown_session` (the event
  row only; no payment, `checkout.service.ts:272,288`), a Core payment intent as `ignored` (no
  `paymentRequestId`), and with
  #580 a Core refund or dispute as `not_chat` and Core's Stripe Billing events as `ignored_not_chat`.
  What would be a problem is any of these outcomes on a row whose session or payment intent is the
  smoke test's (§6.3.1), or a `recorded` row whose payment is not the smoke test's.

### 6.8 Leave the test family

Keep the test family (and its Customer in Stripe) for future smoke tests. Chat has no "internal family"
flag or reporting exclusion; the only marking is the unmistakable label given at intake (§6, "Who pays")
and a note in the family's Parent Profile. Whoever reads revenue figures must know that family's one
small payment and its refund are a test; the refund leaves the net at zero.

### 6.9 Rollback: turning cards off fast

**What "off" means in the code.** `cardAvailable` is "`STRIPE_SECRET_KEY` is set (`stripe.gateway.ts:129-131`)
and card payments are not paused (W63, `card-pause.ts`; a malformed value counts as paused)". Option A' below
is the pause; the rest of this paragraph describes unsetting the key. Unset it and: no card option anywhere (app, link page, Admin), checkout
answers 503 `COMM.PAYMENTS_UNAVAILABLE` and the client offers the bank transfer (`checkout.service.ts:93-95`,
`docs/communication/error-codes.md`), the webhook still verifies and records with the secret alone
(`stripe.gateway.ts:215-222`; `confirm` records without the key because the card facts are best effort),
but no lookup, refund or reconcile can run until the key is back (`stripe-reconciler.service.ts:63`).

**Payments in flight.** A Checkout Session stays payable for 45 minutes after it was opened
(`CHECKOUT_MINUTES`, `checkout.service.ts:26`). Whatever is switched off, a parent already on Stripe's
page can still pay inside that window, and the money is taken. Chat records that payment only from a
verified webhook, or from the reconciler while a key is set. So every option below keeps
`STRIPE_WEBHOOK_SECRET` set, and every key-based option has a **deadline under 3 days** to restore a
working key: Stripe retries a failed delivery for 3 days and then gives up, and the reconciler only
looks back a fixed window (`LOOK_BACK_MS`, 30 days) once a key is back.

**The #579 constraint.** At `LAUNCH_PHASE=launch` the deploy refuses to run without both secrets
(`check-env.sh`, `MISSING STRIPE_SECRET_KEY`). So after the public launch, "unset the key and redeploy"
is not available as is. Options, from least to most disruptive:

| Option | How | Effect | When |
|---|---|---|---|
| **A'. Pause card payments in Admin** (W63, #584: Admin → Payments → Settings → "Pause card payments" / "إيقاف الدفع بالبطاقة مؤقتًا") | no deploy, no Stripe change | The card option disappears everywhere and new checkouts are refused, while the key stays set: webhooks keep recording, refunds and Reconcile keep working, in-flight payments from the 45-minute window are recorded normally. Nothing to restore in Stripe or GitHub; switch it back off in Admin to resume. | **Preferred fast stop once W63 is merged and deployed.** Seconds. Until W63 is on production, use A. |
| **A. Revoke the restricted key in Stripe** (UNVERIFIED label: API keys → the key → Delete/Revoke) | no deploy | Every Stripe API call fails. Checkout: `stripe checkout refused` in the log and 503 to the client, which offers the bank transfer (`checkout.service.ts:168-174`). The card button is still shown (`cardAvailable` is still true) until the parent taps it. **Webhooks only partly record.** `checkout.session.completed` and `refund.*` on an already recorded payment still record (without card details). But `payment_intent.succeeded` and `payment_intent.payment_failed` call `findCheckoutByPaymentIntent` (`checkout.service.ts:271,286`) and `charge.refunded` calls `listRefunds` (`:339,350`); with #580, disputes on an unrecorded payment also look up Stripe. Those throw, the endpoint answers 500, and Stripe retries them for 3 days. Refunds and Reconcile fail until a new key is set. | Minutes. The fast stop for a suspected key leak or a run of bad charges before W63. **Deadline: a new key within 3 days, sooner is better.** Re-enable: §3 with a new key, §4, redeploy; then Admin → Stripe events → **Reconcile now** and check the Dashboard's failed deliveries have been retried as 200. |
| **B. Disable Chat's webhook endpoint** (UNVERIFIED: the endpoint → Disable) | no deploy | Stops recording, not charging: a parent can still pay and Chat does not record it until the endpoint is re-enabled (Stripe retries 3 days) or the reconciler finds the paid session (`stripe-reconciler.service.ts:61-125`). **Not a card-off switch.** Use only while fixing the secret. | Rarely. Re-enable within 3 days. |
| **C. Swap in a dummy live-shaped key** | set `STRIPE_SECRET_KEY` to a value Stripe rejects but the guard accepts, redeploy; keep `STRIPE_WEBHOOK_SECRET` | Same as A, through the deploy, with the same partial webhook recording and the same 3-day deadline. The guard checks only the prefix (#579: "any non-whitespace after the prefix"). | If the Dashboard is unavailable. Not preferred: a fake secret in the Environment is confusing. |
| **D. Back to `LAUNCH_PHASE=review`, key unset, webhook secret kept** | set `LAUNCH_PHASE=review` **and** `REDIS_URL=redis://redis:6379`, delete **only** `STRIPE_SECRET_KEY` (`gh secret delete STRIPE_SECRET_KEY --env production`; `production-setup.py` has no unset mode), **keep `STRIPE_WEBHOOK_SECRET` set**, redeploy the same image | Cards off cleanly (`cardAvailable` false) and in-flight payments are still recorded: #579 accepts the signing secret alone at `review`, and the webhook records with it. Do **not** also delete the signing secret: with it gone every delivery gets a 503, and once cards stay off past Stripe's 3-day retry those payments are taken and never recorded in Chat. The resolver re-adds the review-period in-app Redis and refuses a managed `REDIS_URL` at `review` (`app-spec.py:461-464`), and `production-runbook.md` §1c says: **only before the store release is public**. | Only in the launch window itself, before the store release is switched to public. Never after. |

Recommendation: before the store release is public, D is the clean rollback (it is the same rollback as
the Redis cutover's). After it: A' once W63 is merged and deployed, otherwise A with a new key within
3 days, then fix forward. Whichever option is used, `STRIPE_WEBHOOK_SECRET` stays set the whole time.

**Rolling the webhook secret** (wrong value, or leaked): Dashboard → the endpoint → roll the signing secret
(UNVERIFIED), set the new `STRIPE_WEBHOOK_SECRET`, redeploy. Between the two, deliveries fail verification
(400, log `stripe webhook: rejected, signature did not verify`) and Stripe retries them; nothing is lost
within three days.

---

## 7. Checklist

| # | Step | Where | Done by | Evidence to keep | Done |
|---|---|---|---|---|---|
| 1 | Live mode on; account confirmed as the shared Core account | Stripe Dashboard | owner | account name in the password manager | ☐ |
| 2 | Core's webhook endpoints listed (URL, events, status); none changed; every §2 event a Core endpoint also listens to written down, and how Core treats a foreign object confirmed before the first live charge | Dashboard → Webhooks (UNVERIFIED) | owner | dated note | ☐ |
| 3 | Core's API keys listed; none rolled or deleted | Dashboard → API keys (UNVERIFIED) | owner | dated note | ☐ |
| 4 | Branding, statement descriptor, customer e-mails, Radar, payment methods, currency noted; unchanged | Dashboard → Settings (UNVERIFIED) | owner | dated note | ☐ |
| 5 | Chat endpoint created at `https://api.chat.jawwid.com/api/v1/stripe/webhook` with exactly the §2 events (10 on `main`, 15 with #580), API version pinned to the SDK's | Dashboard → Webhooks (UNVERIFIED) | owner | endpoint description names Chat; pinned version noted | ☐ |
| 6 | Signing secret stored in the password manager; never pasted elsewhere | password manager | owner | entry exists | ☐ |
| 6a | Scopes rehearsed in staging with an `rk_test_` key of the same permissions (§3; lifecycle §5.5 steps 1, 4, 5, 7 pass) | Dashboard (test mode) + staging | owner + staff | staging transaction id; any extra permission Stripe demanded | ☐ |
| 7 | Restricted live key created with Checkout Sessions W, Refunds W, Customers W, PaymentIntents R, Charges R (plus anything 6a proved necessary); all else None | Dashboard → API keys (UNVERIFIED) | owner | key name; password-manager entry | ☐ |
| 8 | Invoice issuer and bank account saved in Admin → Payments → Settings | Admin Web | super admin or Operations Manager | audit `billing.settings_set` | ☐ |
| 9 | Internal test family created and labelled | Admin Web | owner | family id | ☐ |
| 10 | #579, #580, #581 merged and deployed | GitHub | lead | PR merges | ☐ |
| 11 | Launch-window prerequisites done: managed Valkey, `TRUSTED_PROXY_HOPS`, database cutover | `production-runbook.md` §1c | owner | that runbook's evidence | ☐ |
| 12 | `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` set in the `production` Environment via `production-setup.py ask` | GitHub | owner | `production-setup.py status` shows both set | ☐ |
| 13 | `PAYMENT_LINK_BASE_URL` unset (default), `SUBSCRIPTION_LOCK_ENFORCED` unset/false | GitHub | owner | `gh variable list --env production` | ☐ |
| 14 | `LAUNCH_PHASE=launch`; Deploy production run passes `check-env.sh` and the smoke test | GitHub Actions | owner | run summary (`launch phase | launch`) | ☐ |
| 14a | Admin → Payments → Settings shows **no** "Card payments paused" badge (W63 pause off) | Admin Web | staff | screenshot | ☐ |
| 15 | Admin → Payments → Settings shows "Stripe connected" and "Webhook configured" | Admin Web | staff | screenshot | ☐ |
| 16 | 6.1 request created; card option visible on link and in app | Admin + phone | owner | request id | ☐ |
| 17 | 6.2 paid with a real card; redirect `checkout=success` | phone | owner | — | ☐ |
| 18 | 6.3 one payment, card details, invoice with issuer, push received, lessons credited once; events `recorded` + `already_recorded` | Admin + phone | staff | transaction id, invoice number | ☐ |
| 19 | 6.4 resent event → delivery response `{"received":true,"outcome":"duplicate"}`; no new row in Admin → Stripe events | Dashboard + Admin | owner | event id; row count before and after | ☐ |
| 20 | 6.5 refunded from the Parent Profile → "Refunded", one refund row, `refund_recorded` | Admin → Parent Profile | staff with `canVerify` | refund id | ☐ |
| 21 | 6.6 Reconcile with Stripe → in sync; Reconcile now → 0 errors | Admin | staff with `canVerify` | — | ☐ |
| 22 | 6.7 Core's endpoints, keys and settings unchanged against the notes from 2 to 4 | Dashboard | owner | dated note | ☐ |
| 23 | Rollback path chosen and written down for the window (D before public release; after it A' if W63 is deployed, else A with a key deadline under 3 days); `STRIPE_WEBHOOK_SECRET` stays set in every case | this runbook §6.9 | owner | — | ☐ |
| 24 | Store release switched to public only after 14 to 22 pass | App Store Connect / Play Console | owner | — | ☐ |
