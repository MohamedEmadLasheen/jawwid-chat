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
    this.periodStart,
    this.periodEnd,
    this.requestId,
    this.instalmentId,
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
  final DateTime? periodStart;
  final DateTime? periodEnd;

  /// What a payment names. An instalment is paid by its id -- the server makes or
  /// reuses its request -- so [requestId] is set only on a request of its own.
  final String? requestId;
  final String? instalmentId;

  bool get partial => paidMinor > 0 && remainingMinor > 0;
}

/// Everything open, in the order a parent should see it: requests that stand alone
/// (a subscription, a balance) first, newest first as the server sends them, then the
/// open instalments in due-date order.
List<DueItem> amountsDue(ParentBilling billing) {
  final openInstalments = {
    for (final i in billing.instalments)
      if (i.status != InstalmentStatus.paid && i.owedMinor > 0) i.id: i,
  };
  final requestOf = <String, PaymentRequest>{};
  final standalone = <DueItem>[];

  for (final r in billing.requests) {
    if (!r.isOpen) continue;
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
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      requestId: r.id,
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
      periodStart: r?.periodStart,
      periodEnd: r?.periodEnd,
      instalmentId: i.id,
    ));
  }
  return standalone;
}
