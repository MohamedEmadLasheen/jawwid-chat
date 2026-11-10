import '../../../core/errors/app_error.dart';
import '../../../shared/models/parent_billing.dart';

/// OA-12 (owner, 2026-11-10): the App Review payment mode. The SERVER decides it
/// (apps/api/src/billing/review-mode.ts) and enforces it: card checkout answers a
/// demo page and never Stripe, and every receipt write is refused. The app only says
/// so and does not offer Send.
///
/// The server marks a review family's `GET /me/billing` with `reviewMode: true` and
/// lists exactly one synthetic amount due under this fixed id (it is never a row).
/// The shared [ParentBilling] model does not carry `reviewMode` yet, so this feature
/// reads the synthetic item's id, which is part of the same server contract
/// (REVIEW_DEMO_REQUEST_ID in review-mode.ts). A public family never has it.
const reviewDemoRequestId = '00000000-0000-4000-8000-0000000a99e1';

/// Whether this family is the App Review demo family.
bool isReviewMode(ParentBilling billing) => billing.requests.any((r) => r.id == reviewDemoRequestId);

/// The server's refusal of a payment write for a review account:
/// 403 `COMM.BILLING_DENIED` with `error.detail.reviewMode == true`.
bool isReviewModeRefusal(AppError error) => error.code == billingDeniedCode && error.detail?['reviewMode'] == true;

/// `COMM.BILLING_DENIED` (apps/api platform/errors.ts).
const billingDeniedCode = 'COMM.BILLING_DENIED';
