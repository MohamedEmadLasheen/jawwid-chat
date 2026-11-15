import '../../../shared/models/parent_billing.dart';

/// PD-27: one thing the parent can pay now -- an open payment request, or an open
/// instalment (merged with its own request when it has one, so it is listed once).
class DueItem {
  const DueItem({
    required this.key,
    required this.label,
    required this.amountMinor,
    required this.paidMinor,
    required this.remainingMinor,
    required this.currency,
    this.childName,
    this.dueDate,
    this.status,
    this.days,
    this.planMonths,
    this.lessonsIncluded,
    this.periodStart,
    this.periodEnd,
    this.requestId,
    this.instalmentId,
    this.lastCardFailure,
    this.pendingReceiptMinor = 0,
  });

  /// Stable across reloads: `i:<instalmentId>` or `r:<requestId>`.
  final String key;
  final String label;
  final String? childName;
  final int amountMinor;
  final int paidMinor;
  final int remainingMinor;
  final String currency;
  final DateTime? dueDate;
  final InstalmentStatus? status;
  final int? days;
  final int? planMonths;

  /// PD-30: the lessons the package buys, shown beside its length.
  final int? lessonsIncluded;
  final DateTime? periodStart;
  final DateTime? periodEnd;

  /// What a payment names. An instalment is paid by its id -- the server makes or
  /// reuses its request -- so [requestId] is set only on a request of its own.
  final String? requestId;
  final String? instalmentId;

  /// PD-27 completion: its request's latest card attempt failed, and why.
  final CardFailure? lastCardFailure;

  /// W61 S2: bank-transfer receipts the family sent for its request that the academy has
  /// not checked yet (in its currency). Not money until approved, so [remainingMinor] is
  /// unchanged; a card on top of them may charge twice.
  final int pendingReceiptMinor;

  bool get partial => paidMinor > 0 && remainingMinor > 0;

  /// W61 S2: a receipt is waiting -- the pay sheet says a card too may charge twice.
  bool get receiptPending => pendingReceiptMinor > 0;

  /// W61 S2: the waiting receipts cover what is left; the server refuses a card
  /// (`409 COMM.BILLING_STATE`, `detail.reason` receipt_pending) until they are decided.
  bool get receiptCoversRemaining => receiptPending && pendingReceiptMinor >= remainingMinor;
}

/// W61 S2: `error.detail.reason` of the card refusal while receipts cover what is left.
const receiptPendingReason = 'receipt_pending';

/// W61 S2: what [billing]'s receipts still pending on [requestId] add up to, in [currency].
int pendingReceiptsFor(ParentBilling billing, String? requestId, String currency) {
  if (requestId == null) return 0;
  var sum = 0;
  for (final r in billing.receipts) {
    if (r.status == ReceiptStatus.pending && r.requestId == requestId && r.currency == currency) sum += r.amountMinor;
  }
  return sum;
}

/// Everything open, in the order a parent should see it: requests that stand alone
/// (a subscription, a balance) first, newest first as the server sends them, then the
/// open instalments in due-date order.
List<DueItem> amountsDue(ParentBilling billing) {
  final openInstalments = {
    for (final i in billing.instalments)
      // Store payments policy: only an instalment of a verified lesson package.
      if (i.status != InstalmentStatus.paid && i.owedMinor > 0 && i.payableInApp) i.id: i,
  };
  final requestOf = <String, PaymentRequest>{};
  final standalone = <DueItem>[];

  for (final r in billing.requests) {
    if (!r.isOpen) continue;
    // Store payments policy: only live one-to-one lessons are paid in the app.
    // Anything else is not listed here at all: no Pay, and no pointer elsewhere.
    if (!r.payableInApp || !(r.purpose?.canPayForLessons ?? false)) continue;
    final instalmentId = r.instalmentId;
    if (instalmentId != null) {
      if (openInstalments.containsKey(instalmentId)) requestOf[instalmentId] = r;
      // A request for an instalment that is already paid is the server's to close.
      if (billing.instalments.any((i) => i.id == instalmentId)) continue;
    }
    standalone.add(DueItem(
      key: 'r:${r.id}',
      label: r.label,
      childName: r.childName,
      amountMinor: r.amountMinor,
      paidMinor: r.paidMinor,
      remainingMinor: r.remainingMinor,
      currency: r.currency,
      planMonths: r.planMonths,
      lessonsIncluded: r.lessonsIncluded,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      requestId: r.id,
      lastCardFailure: r.lastCardFailure,
      pendingReceiptMinor: pendingReceiptsFor(billing, r.id, r.currency),
    ));
  }

  for (final i in openInstalments.values) {
    final r = requestOf[i.id] ??
        billing.requests.where((r) => r.id == i.requestId && r.isOpen).firstOrNull;
    final owed = i.owedMinor;
    standalone.add(DueItem(
      key: 'i:${i.id}',
      label: i.label,
      childName: i.childName ?? r?.childName,
      amountMinor: i.amountMinor,
      paidMinor: i.paidMinor ?? (i.amountMinor - owed),
      remainingMinor: owed,
      currency: i.currency,
      dueDate: i.dueDate,
      status: i.status,
      days: i.days,
      planMonths: r?.planMonths,
      lessonsIncluded: r?.lessonsIncluded,
      periodStart: r?.periodStart,
      periodEnd: r?.periodEnd,
      instalmentId: i.id,
      lastCardFailure: r?.lastCardFailure,
      pendingReceiptMinor: pendingReceiptsFor(billing, r?.id ?? i.requestId, i.currency),
    ));
  }
  return standalone;
}
