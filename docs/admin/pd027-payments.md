# PD-27: Payments — payment links, card (Stripe), bank transfers, cash, invoices, reminders

Record: `docs/product/JAWUID-CHAT-PRODUCT-BOUNDARY.md` §4 PD-27.
Migration: `supabase/migrations/20261022170000_chat_pd027_payments.sql`.
Code: `apps/api/src/billing` (payments, requests, receipts, invoices, Stripe),
`apps/api/src/new-students` (requests before Assign), `apps/admin-web/src/features/profiles`
+ `apps/admin-web/src/features/payments`, `lib/features/billing`.

PD-27 builds on PD-17. A family's **instalments** (`chat.family_instalment`) stay what the
family owes on a schedule. PD-27 adds how money arrives and what the parent gets back:

| Thing | Table | What it is |
|---|---|---|
| Payment request | `chat.payment_request` | "Please pay X for Y". Carries the unique **payment link**. Targets an enrolled family, or a trial before Assign. May pay one instalment. |
| Payment | `chat.payment` | Money that arrived: card (Stripe), bank transfer, cash, or the PD-17 `invoice` method. Append-only; a mistake is voided with a reason. |
| Refund | `chat.payment_refund` | Money given back on a payment. From Stripe (webhook) or recorded by staff. |
| Invoice | `chat.invoice` | One per payment, numbered `JW-<year>-<000001>` per organization, frozen at issue (a snapshot), downloadable as a PDF. |
| Bank-transfer receipt | `chat.payment_receipt` | Proof a parent uploaded. Pending until a verifier approves (creates the payment) or rejects (with a reason). |
| Checkout | `chat.payment_checkout` | Each Stripe Checkout Session we opened for a request. The webhook is matched against it. |
| Stripe event | `chat.stripe_event` | Every verified Stripe event id, once. A redelivery is a no-op. |

## The flows

**Subscription after a trial (the important one).**
1. Sales or Operations opens the trial's New Students card (before Assign) or the family's
   Parent Profile (after) and creates a **payment request**: purpose `subscription`, the
   package (`planMonths` 1/3/6/12), the billing period, the amount, the child.
2. The response carries `link` — `PAYMENT_LINK_BASE_URL/pay/<token>` (32 random bytes,
   base64url). Staff copy it or press "Send on WhatsApp" (a `https://wa.me/?text=` link the
   staff member's own WhatsApp opens; nothing is sent by the server).
3. The parent opens the link — **no sign-in** — sees who it is for, the amount, the package
   and period, and taps **Pay by card**. The server opens a Stripe Checkout Session for the
   amount still owed and redirects (303).
4. Stripe calls `POST /stripe/webhook`. Only a **verified** `checkout.session.completed`
   (or `async_payment_succeeded`) with `payment_status = paid`, for a session we opened, for
   exactly the amount and currency we asked, records the payment. The success page records
   nothing.
5. In the same transaction: the payment, its invoice, the request marked paid, the
   instalment marked paid when covered, the audit row. Then the family's parents get a push.
6. **Before Assign**: the request, its payment and its invoice carry the trial id and no
   family. Assign (PD-16) attaches every one of them to the new family (and to the child,
   when the trial had one child) in Assign's own transaction. The parent signs up with the
   e-mail on the subscription form — the same e-mail Assign made the account's subject — and
   finds the invoice under Settings > Payments. Nothing is matched on an e-mail Stripe
   collected: the link itself says whose payment it is.

**Bank transfer.** The parent (in the app) picks an amount due, sees the academy's bank
details (`billing.bank_account`) and the amount, transfers, and uploads a screenshot or PDF
(JPEG/PNG/WebP/PDF, ≤ 10 MB). The receipt is **pending verification**. A verifier sees it in
**Payments > Receipts**, opens the file (a signed, per-viewer link), and approves (optionally
correcting the amount and date) or rejects with a reason the parent sees. Approval creates
the payment and its invoice exactly like a card payment. A verifier can also record a bank
transfer directly (a parent who sent the receipt to their supervisor).

**Cash.** Operations or Sales records `{method: cash, amountMinor, paidOn, requestId? |
instalmentId?, learnerId?, reference?}` on the Parent Profile. The recorder's name is on the
payment. An invoice (receipt) is issued.

**Instalments.** PD-17's plans gain a custom schedule (`items: [{amountMinor, dueDate}]`)
alongside the equal-split form. Payments may be **partial**: an instalment is paid when its
payments cover it; until then it shows `paidMinor` / `remainingMinor` and `partial: true`.
Each open instalment can have its own link (a request with `instalmentId`); in the app the
parent pays any open instalment directly (the server makes or reuses its request).

**Reminders.** The rules seeded in 2026-09 (`payment_d7`, `payment_d3`, `payment_d0`,
`payment_p3`, `payment_p7`, event `payment_due`, template `payment_reminder`) now fire: every
open instalment schedules them for each active parent of its family (at creation and by the
worker's billing sweep, so a parent added later is included), skipping any already in the
past; a full payment or a void cancels the rest. The policy is configurable: each rule can
be switched on or off in **Payments > Settings**.

## Who may do what

`billingAccessOf` (PD-17) gains `canVerify`.

| | Super admin | Operations Manager | Ops supervisor / coverage | Sales department | Parents of the family | Anyone else |
|---|---|---|---|---|---|---|
| Read requests, payments, invoices, receipts | every family | every family | families they reach | every family | own family (no voided rows, no staff names) | never |
| Create / cancel a payment request | ✓ | ✓ | families they reach | every family (and trials) | — | — |
| Record cash | ✓ | ✓ | families they reach | every family | — | — |
| **Approve / reject a receipt, record a bank transfer, void a payment, refund** (`canVerify`) | ✓ | ✓ | **no** | **no** | — | — |
| Bank details, invoice issuer, reminder policy (`/billing/settings` write) | ✓ | ✓ | no | no | — | — |
| Pay (card), upload a receipt | — | — | — | — | every active parent | the link holder may pay by card only |

Refusals: `COMM.BILLING_DENIED` (403), `COMM.BILLING_NOT_FOUND` (404: unknown or out of reach),
`COMM.BILLING_STATE` (409: already paid / cancelled / expired / decided), `COMM.VALIDATION`
(400), `COMM.PAYMENTS_UNAVAILABLE` (503: Stripe is not configured on this deployment).

## Contract

Money is always `amountMinor` (integer, minor units) + `currency` (ISO 4217, upper case).
Dates are `YYYY-MM-DD` in the academy's time zone; instants are ISO-8601.

```ts
type PaymentMethod = 'card' | 'bank_transfer' | 'cash' | 'invoice'; // 'invoice' = PD-17 records
type RequestPurpose = 'subscription' | 'renewal' | 'instalment' | 'balance' | 'other';
type RequestStatus = 'open' | 'paid' | 'cancelled' | 'expired';
type ReceiptStatus = 'pending' | 'approved' | 'rejected';
type InvoiceStatus = 'paid' | 'partially_refunded' | 'refunded' | 'void';
type Person = { id: string; name: string };
type Child = { id: string | null; name: string };   // id null: a trial's child before Assign

interface PaymentRequest {
  id: string;
  purpose: RequestPurpose;
  label: string;
  status: RequestStatus;
  amountMinor: number;       // asked for
  paidMinor: number;         // sum of standing payments
  remainingMinor: number;    // max(0, amount - paid)
  currency: string;
  child: Child | null;
  instalmentId: string | null;
  planMonths: 1 | 3 | 6 | 12 | null;
  periodStart: string | null;
  periodEnd: string | null;
  expiresAt: string;
  createdAt: string;
  // staff only:
  link?: string;             // the full payment link
  createdBy?: Person;
  cancelled?: { at: string; by: Person; reason: string } | null;
  trialId?: string | null;   // set while the request belongs to a trial not yet assigned
}

interface Payment {
  id: string;
  method: PaymentMethod;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  paidOn: string;
  recordedAt: string;
  requestId: string | null;
  instalmentId: string | null;
  child: Child | null;
  reference: string | null;
  invoice: { id: string; number: string } | null;
  // staff only:
  recordedBy?: Person | null;          // null = Stripe
  voided?: { at: string; by: Person; reason: string } | null;
  refunds?: { id: string; amountMinor: number; reason: string; at: string; source: 'stripe' | 'staff' }[];
}

interface Invoice {
  id: string;
  number: string;            // JW-2026-000123
  issuedAt: string;
  status: InvoiceStatus;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  method: PaymentMethod;
  paidOn: string;
  label: string;
  child: Child | null;
  planMonths: 1 | 3 | 6 | 12 | null;
  periodStart: string | null;
  periodEnd: string | null;
}

interface Receipt {
  id: string;
  status: ReceiptStatus;
  requestId: string;
  label: string;             // the request's label
  amountMinor: number;       // what the parent says they sent
  currency: string;
  transferredOn: string;
  note: string | null;
  uploadedAt: string;
  fileUrl: string;           // signed, bound to the viewer, short-lived; re-read the list for a fresh one
  mimeType: string;
  rejectReason: string | null;
  paymentId: string | null;
  // staff only:
  family?: { id: string; name: string } | null;
  uploadedBy?: Person;       // the parent
  reviewedBy?: Person | null;
  reviewedAt?: string | null;
}

interface BankAccount {      // every field optional except accountName
  bankName: string | null;
  accountName: string;
  iban: string | null;
  accountNumber: string | null;
  swift: string | null;
  note: string | null;       // e.g. "write the child's name in the transfer reference"
}
```

### Staff (bearer token, `billingAccessOf`)

| Route | Body / query | Answer |
|---|---|---|
| `GET /instalments/access` | | PD-17 fields **+ `canVerifyPayments`** |
| `GET /families/:id/billing` | | PD-17 shape **+** `requests: PaymentRequest[]`, `payments: Payment[]`, `invoices: Invoice[]`, `receipts: Receipt[]`, `canVerify`, `cardAvailable`. Each `instalments[]` row gains `paidMinor`, `remainingMinor`, `partial`, `requestId` (its open request, if any). Every POST below that names a family answers this shape. |
| `POST /families/:id/instalments` | PD-17 body, **or** `{label, currency?, learnerId?, items: [{amountMinor, dueDate}] (1–24)}` | family billing |
| `POST /families/:id/payment-requests` | `{purpose, label, amountMinor?, currency?, learnerId?, instalmentId?, planMonths?, periodStart?, periodEnd?, expiresInDays? (1–90, default 14)}` — with `instalmentId`, amount defaults to what it still owes and purpose to `instalment` | `{ request: PaymentRequest, billing }` |
| `POST /payment-requests/:id/cancel` | `{reason}` | family billing (or `{request}` for a trial's) |
| `POST /families/:id/payments` | `{method: 'cash' \| 'bank_transfer', amountMinor, paidOn (≤ today), requestId? \| instalmentId?, learnerId?, reference?}` — `bank_transfer` needs `canVerify` | family billing |
| `POST /instalments/:id/payment` | PD-17 `{paidOn, method?, reference?}` — now records a payment for the whole remaining amount (method `invoice` \| `bank_transfer` \| `cash`) | family billing |
| `POST /payments/:id/void` | `{reason}` — `canVerify`; card payments are refunded, never voided; a payment whose instalment is already fully paid is corrected by voiding the instalment | family billing |
| `POST /payments/:id/refunds` | `{amountMinor, reason}` — `canVerify`; a card payment is refunded through Stripe | family billing |
| `POST /instalments/:id/void` | PD-17 `{reason}` — also voids its non-card payments and their invoices; refused (409) while it has a card payment | family billing |
| `GET /payment-receipts` | `?status=pending\|approved\|rejected` (default pending) | `{ items: Receipt[], counts: {pending, approved, rejected} }` in scope |
| `POST /payment-receipts/:id/approve` | `{amountMinor?, paidOn?}` — `canVerify` | `{ receipt: Receipt }` |
| `POST /payment-receipts/:id/reject` | `{reason}` — `canVerify` | `{ receipt: Receipt }` |
| `GET /invoices/:id/link` | | `{ url }` — a signed PDF link for this viewer (5 minutes) |
| `GET /billing/settings` | | `{ bankAccount: BankAccount \| null, issuer: {name, address \| null, taxId \| null} \| null, cardAvailable, reminders: [{key, offsetDays, enabled}], canEdit }` |
| `POST /billing/settings` | `{ bankAccount?: BankAccount \| null, issuer?: {...} \| null, reminders?: [{key, enabled}] }` — super admin / Operations Manager | the same |
| `GET /trials/new-students/:trialId/payment-requests` | | `{ items: PaymentRequest[], payments: Payment[], suggestedAmountMinor: number \| null, currency }` — before Assign (suggested = the form's package prices) |
| `POST /trials/new-students/:trialId/payment-requests` | `{purpose?: 'subscription', label, amountMinor, currency?, planMonths?, periodStart?, periodEnd?, expiresInDays?}` | `{ request: PaymentRequest }` |

### Parent (bearer token, an active contact of the family)

| Route | Body | Answer |
|---|---|---|
| `GET /me/billing` | | PD-17 shape **+** `requests: PaymentRequest[]` (open and paid; not cancelled/expired), `invoices: Invoice[]` (not void), `receipts: Receipt[]`, `bankAccount: BankAccount \| null`, `cardAvailable: boolean`. Instalments gain `paidMinor`, `remainingMinor`, `partial`, `requestId`. |
| `POST /me/billing/checkout` | `{requestId} \| {instalmentId}` | `{ url }` — open it in the browser (Stripe Checkout). 503 `PAYMENTS_UNAVAILABLE` without Stripe. |
| `POST /me/billing/receipts/upload` | `{mimeType, byteSize}` | `{objectKey, uploadUrl, method: 'PUT', headers, expiresAt}` — PUT the bytes with exactly these headers |
| `POST /me/billing/receipts` | `{objectKey, requestId \| instalmentId, amountMinor, transferredOn, note?}` | `GET /me/billing`'s shape |
| `GET /me/billing/invoices/:id/link` | | `{ url }` — open it (PDF) |

### Public

| Route | |
|---|---|
| `GET /pay/:token` | The payment page (HTML, Arabic, `?lang=en`). Shows the family's display name, the child's first name, the label, package, period, amount and what remains, the status, bank details, and **Pay by card** when Stripe is configured. Nothing else about the family. |
| `POST /pay/:token/checkout` | 303 to Stripe Checkout (the page's form). Throttled. |
| `POST /stripe/webhook` | Stripe only: `Stripe-Signature` over the raw body, `STRIPE_WEBHOOK_SECRET`. 400 unverified; 200 for every verified event (handled or ignored); 503 without the secret. |

Stripe Dashboard → Developers → Webhooks → endpoint `https://<api>/api/v1/stripe/webhook`,
events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`, `refund.created`,
`refund.updated`.

## Environment

| Variable | |
|---|---|
| `STRIPE_SECRET_KEY` | secret, optional. Unset: no card option anywhere; checkout answers 503. |
| `STRIPE_WEBHOOK_SECRET` | secret, optional. Unset: the webhook answers 503 (Stripe retries for 3 days). |
| `PAYMENT_LINK_BASE_URL` | optional. The public origin + `/api/v1` that links are built on (e.g. `https://api.jawwid.com/api/v1`). Unset: the request's own origin. |

## Security and reliability

* **Server-side confirmation only.** A payment exists only after a verified webhook (or a
  verifier's approval, or staff recording cash). The Checkout success page just shows "we
  are confirming your payment" and re-reads.
* **Exactly once.** `chat.stripe_event.id` is the primary key (a redelivered event is
  skipped), and `chat.payment.stripe_checkout_session_id` / `stripe_payment_intent_id` are
  unique (two different events for one session cannot record it twice). Refunds are unique
  on `stripe_refund_id`.
* **Amount and currency are checked** against the checkout we opened; a mismatch is not
  recorded and is audited (`payment.stripe_mismatch`).
* **No double charge.** Opening a new checkout first looks at the request's earlier open
  sessions: a completed one is recorded instead of opening another, an open one is expired.
  If money still arrives twice it is recorded (never lost) and shows as an overpayment.
* **Links** are 256-bit random tokens, unique, expiring (default 14 days), cancellable, and
  the page shows only the family's display name, the child's first name and the amounts.
* **Receipts** live under `payment-receipts/<familyId>/…`; the bytes are judged on commit
  (`readHead`, magic bytes). They are served only through `/media/payment-receipts/:id`,
  signed for one viewer and re-authorized on every request (the family's parents and staff
  who read that family).
* **Append-only.** Payments, refunds, invoices and decided receipts are never deleted or
  edited; corrections are voids and refunds with reasons. Enforced by triggers.
* **Audit.** `payment_request.created|cancelled`, `payment.recorded|voided|refunded|
  stripe_mismatch`, `receipt.uploaded|approved|rejected`, `billing.settings_set`, and
  PD-17's `instalment.*`, all in `chat.audit_log`.
