# Payments in the store builds: App Review notes and policy check

**Owner decision (2026-11-05).** Jawwid sells only live one-to-one Quran lessons, between one
teacher and one student, in the app. Stripe card checkout and bank transfer (with a receipt
upload) stay in the production iOS and Android builds. The app relies on:

- App Store Review Guideline **3.1.3(d) Person-to-Person Services**;
- Google Play's **1:1 online paid services** rule (Payments policy, explained in
  "Understanding Google Play's Payments policy").

No group class and no standalone digital material is sold in the app. Payment methods are not
hidden in store builds unless a store policy or review requirement makes it necessary.

This answers questions 1 and 3 of the roadmap's N-5 (`google-play-blocker-roadmap-2026-11-03.md`
§8.4) and supersedes option (a) of `google-play-readiness-2026-11-03.md` P-4.

## 1. What the policies say (official pages, read 2026-11-05)

| Store | Rule | Conditions |
|---|---|---|
| Apple | 3.1.3(d) | "real-time person-to-person services between two individuals (for example tutoring students …), you may use purchase methods other than in-app purchase". One-to-few and one-to-many real-time services must use in-app purchase. |
| Apple | 3.1.1 | Unlocking features, functionality or content in the app must use in-app purchase. |
| Google Play | 1:1 online paid services | Play Billing is not required if the paid service is between two individuals **and** is not available for replay afterwards (the session is not recorded and cannot be accessed or used again) in any Play-distributed app. Examples include education classes. |
| Google Play | Mixed SKUs | Play Billing is required for a SKU that includes more digital goods or services than the service itself, or is marketed as digital. |
| Google Play | Anti-steering (Payments §4) | An app may not lead users to a non-Play payment method, **unless an exemption applies**. The 1:1 rule is that exemption. |

Sources: <https://developer.apple.com/app-store/review/guidelines/#other-purchase-methods>,
<https://support.google.com/googleplay/android-developer/answer/9858738>,
<https://support.google.com/googleplay/android-developer/answer/10281818>.

## 2. What the app sells, and how this is enforced

| Item | What it is | In the app? | Enforced by |
|---|---|---|---|
| Subscription / renewal | A package of live lessons for **one** learner | Yes, **only when it names the child and the lessons it buys**; otherwise no | `apps/api/src/billing/in-app-payability.ts` |
| Instalment | Part of a lesson package's price | Yes, **only when it names a lesson package that stands** (`family_instalment.lesson_subscription_id`). A plan made with its lessons names the package it creates; a plan can also name the child's existing package. Otherwise no. | the same; migration `20261106100000_chat_pd027_lesson_package_link` |
| Balance | What is still owed for a lesson package | Yes, **only when it names that package** (`payment_request.lesson_subscription_id`, balance requests only). Otherwise no. | the same |
| `other` (any other charge) | Not classified as a lesson | **No.** | the same |
| Anything refused above | — | The app shows no Pay for it. Card checkout and bank-transfer receipts refuse it with `409 COMM.PAYMENT_NOT_IN_APP`, checked before anything is written; a refused receipt's file is deleted. Staff can still collect it outside the app (web pay link, cash). Admin Web marks it "Not payable in the app", and its forms explain why. | `assertPayableInApp` and `assertInstalmentPayableInApp` in `parent-payments.service.ts`; `amountsDue` in `lib/features/billing/domain/amount_due.dart` |
| Any purpose added later | — | **No**, until classified in `in-app-payability.ts` (fails closed, server and app) | the same |
| Group classes | — | Not sold. A `Lesson` has exactly one `learner_id` and one `teacher_id` (`schema.prisma`), so a paid lesson cannot have two learners. Group chats (`class_group`, `student_group`) are chats, never priced. | the schema |
| Materials, games, lesson audio | Free | Not sold, not part of any package | (no price or SKU exists) |
| Lesson recording | None | No LiveKit egress or call recording exists | `test/app/store_payments_policy_test.dart`, `in-app-payability.spec.ts` |

**What the parent reads.** The pay sheet and the Stripe Checkout page both say, in the family's
language:

- EN: "Live one-to-one Quran lessons: one teacher and one student, in real time. Lessons are not recorded."
- AR (owner wording, 2026-11-06): "دروس قرآن فردية مباشرة، تجمع بين معلّم واحد وطالب واحد عبر اتصال مباشر. لا يتم تسجيل الدروس."

A non-lesson charge paid by web link is never described as a lesson.

**Store builds keep both methods.** No billing screen has a platform, release-mode or build-flag
gate, and `scripts/mobile/build-store.sh` defines nothing that could switch payments off
(`test/app/store_payments_policy_test.dart`). "Pay by card" appears wherever the deployment has
Stripe configured (`cardAvailable`); bank transfer always does.

## 3. Check against each policy

| Condition | Apple | Google Play | Status |
|---|---|---|---|
| Live, real time | 3.1.3(d) "real-time" | — | PASS: lessons are live LiveKit audio calls |
| Between two individuals | "between two individuals"; one-to-few needs IAP | "between two individuals" | PASS: one teacher, one learner per lesson (schema). A parent listening in does not add a learner. |
| Not recorded, no replay | — | "not available for replay afterwards" | PASS for the call (no egress, guarded). **Risk:** see R-2 below. |
| Only lesson items paid outside store billing | — | Mixed SKUs | PASS: non-lesson items refused in the app (tested) |
| Marketed as live 1:1 lessons, never content or features | 3.1.1 | "marketed to users as digital" | PASS in the app (pay sheet, Stripe page). The **store listings** must say the same (owner, at submission). |
| Nothing digital unlocked by paying | 3.1.1 | Payments §2 | PASS: the chat is never locked for payment; an unpaid package pauses only new lesson bookings (R-3 below) |
| In-app links to the non-store payment | 3.1.3 intro | §4, unless exempt | Permitted under the exemption on Google Play. **Risk on Apple:** see R-1 below. |

### Residual risks (the owner accepted the approach; these are what a reviewer may raise)

- **R-1 Apple, in-app buttons.** The 3.1.3 introduction says apps in that section cannot, within
  the app, encourage users to use a purchase method other than in-app purchase. 3.1.3(d) itself
  permits other purchase methods. Tutoring apps commonly take card payments in the app under
  (d); the guideline does not say explicitly that a button is allowed. If App Review objects,
  the smallest change is to remove the in-app "Pay by card" button on iOS only and keep
  bank transfer and the receipt upload. That is the "specific review requirement" the owner's
  decision allows for. Nothing is hidden pre-emptively.
- **R-2 Google, persistent lesson artefacts.** Whiteboard pages persist after a lesson and can be
  exported; lesson reports are written by the teacher. Neither is a recording of the session.
  Describe them in review as the teacher's notes, not a replay.
- **R-3 Both, the PD-30 chat lock (resolved on the server, 2026-11-06).** Under PD-30 as first
  built, when a package's lessons ran out (after the grace lessons) or an instalment was overdue, the
  child's group chat became read-only for the parent and teacher. A reviewer could read that as
  paying to unlock an app feature (Apple 3.1.1, Google Payments §2). Now only new lesson bookings
  pause; the chat is never locked for payment.
  - **Owner decision (2026-11-06):** the group chat stays fully accessible, and only new lesson
    bookings pause.
  - The plan is `docs/product/pd030-chat-stays-open-plan.md`. The server part is done
    (2026-11-06, `docs/product/pd-registry/PD-30-amendment-chat-open.md`): the group chat and its
    calls are never refused for payment, in every app build; only new bookings pause. Only an
    instalment the family can pay in the app (a lesson package's) can start the lock.
  - The owner's wording (D-3, 2026-11-06, `docs/product/pd030-d3-wording.md`): every card, push and
    banner says only new lessons pause, and lessons already booked go ahead. None says the chat is
    paused, and payment is described as booking new lessons, never as opening the chat.
  - Production enforcement (`SUBSCRIPTION_LOCK_ENFORCED`) is off, so nothing locks there today.
    The owner keeps it off until the app update with the D-3 banner is released and the owner
    approves production activation.

- **R-4 Instalments and balances: resolved (2026-11-06).** Each now names the lesson package it
  pays for, and the server refuses an in-app payment for one that names none (table in §2).
  - The database keeps the link to the same family and child, and to a package that stands. The
    link never changes after it is written.
  - Existing plans that were made with their lessons were linked by the migration.
  - **Any other existing open instalment or balance is no longer payable in the app.** Staff
    collect it outside the app, or re-create it naming the child's package.
- **R-5 Both, the review accounts cannot pay (OA-12, owner decision 2026-11-10).** The review
  accounts run in the server-enforced review payment mode (§3a). A reviewer sees the pay sheet,
  what is bought and both payment methods, but cannot complete a payment. App Review may ask to
  see a real card payment. If it does, answer with the screen recording of §6 item 3, made on a
  real (non-review) account. **UNVERIFIED:** whether either store objects to a demo-only payment
  flow; no policy page was re-read for this change.

## 3a. The review payment mode (OA-12)

**Owner decision (2026-11-10).** Reviewers never see Jawwid's real bank details, cannot make a
real bank transfer, and cannot upload or store a real receipt. No real charge, invoice, payment
request, payment obligation or staff task is created for a review account. Public families are
unaffected. The server enforces it, not the app's UI.

- The switch, its value and what each route does: `docs/release/review-accounts.md`, "Review
  payment mode". The code: `apps/api/src/billing/review-mode.ts`.
- What the reviewer sees: Subscriptions tab → Amount due → "Lesson package (demo): 8 live
  one-to-one lessons" → Pay. The pay sheet says it is a demo account and still shows the
  live one-to-one description. **Card** opens, in the browser, a page that says (in Arabic and
  English): "In the live app this opens Stripe's secure checkout page in the browser to pay this
  lesson package by card. The review account cannot make a payment." **Bank transfer** shows
  demo bank details, a notice that no transfer or receipt is possible, and Send is off.
- How real parents pay: by card, on Stripe Checkout opened in the browser, or by bank transfer,
  uploading the receipt for the academy to confirm (§2).
- The notes to paste are §4 and §5 below, and Option C of `store-console/review-notes.md` §2.1.

## 4. App Store Connect: App Review Information → Notes (paste)

**With the review payment mode on (OA-12), use Option C of `store-console/review-notes.md` §2.1
instead of the text below**: it says that payment is disabled for the review account. The text
below describes a review account that can pay, which is no longer the case.

> Jawwid is a Quran academy. In the app, families buy only **live one-to-one Quran lessons**:
> each lesson is a real-time audio call between one teacher and one student. There are no group
> classes, and no digital content, materials or app features are sold; everything else in the
> app is free.
>
> Payments use methods other than in-app purchase under **Guideline 3.1.3(d) Person-to-Person
> Services** (real-time tutoring between two individuals). A parent can pay a lesson package by
> card (Stripe Checkout, opened in the browser) or by bank transfer, uploading the transfer
> receipt for the academy to confirm. Lessons are not recorded.
>
> Where to see it: sign in with the parent demo account below → Settings → Payments → Amount due
> → Pay. The pay sheet states what is bought ("Live one-to-one Quran lessons: one teacher and one
> student, in real time. Lessons are not recorded.").
>
> Demo accounts: [parent], [teacher] (supplied in the Sign-In Information fields).

## 5. Google Play Console (paste where asked: App access instructions, or a policy appeal)

With the review payment mode on (OA-12), add this sentence to the text below:

> For the review account, payment is disabled on our server: Amount due shows a demo lesson
> package, card opens a page that explains the live Stripe checkout, and bank transfer shows demo
> bank details and cannot send a receipt. No charge is possible.

**UNVERIFIED for this change:** the Payments policy pages were not re-read; the wording relies on
§1 (read 2026-11-05).

> Jawwid sells only live one-to-one Quran lessons, each between one teacher and one student, as
> real-time audio calls. Lessons are not recorded and cannot be replayed or accessed again in the
> app. Under the Payments policy's 1:1 online paid services rule (education classes), these are
> paid by card (Stripe) or bank transfer rather than Google Play Billing. No group class, digital
> content or app feature is sold; any other charge cannot be paid in the app. To see it: parent
> demo account → Settings → Payments → Amount due → Pay.

## 6. Before submission (owner, in the consoles)

1. The store listings (both stores) describe the service as live one-to-one lessons, never as
   access to content or the app.
2. Demo parent and teacher accounts on the production backend, with the review payment mode
   switched on for their organization (§3a, OA-12), so the reviewer reaches the pay sheet through
   the demo amount due. No real lesson-package request is created for the review family.
3. A short screen recording of a lesson call and of the pay sheet, kept ready for an appeal.
4. Re-read the three policy pages above on the day of submission; they change.
