import '../../../shared/models/parent_billing.dart';

/// PD-20: what Sales' Payments tab reads. Two shapes only -- a parent found by name, and
/// one family's instalments -- and neither has a field for a phone number or an e-mail
/// address: the app never holds either (G-07), so the parent DETAIL record, which carries
/// both, is never asked for.

/// One parent from a name search: who, which family, how many children.
class ParentSearchHit {
  const ParentSearchHit({
    required this.id,
    required this.name,
    required this.familyId,
    required this.familyName,
    this.avatarUrl,
    this.childrenCount = 0,
  });

  final String id;
  final String name;
  final String? avatarUrl;
  final String familyId;
  final String familyName;
  final int childrenCount;
}

class ParentSearchResult {
  const ParentSearchResult({this.items = const [], this.truncated = false});

  final List<ParentSearchHit> items;

  /// The server stopped at its limit: there are more; narrow the search.
  final bool truncated;
}

/// Where an instalment stands, as the server decided on [FamilyBilling.today].
enum SalesInstalmentStatus {
  overdue,
  due,
  upcoming,
  paid,
  voided;

  static SalesInstalmentStatus? tryParse(Object? raw) => switch (raw) {
        'overdue' => SalesInstalmentStatus.overdue,
        'due' => SalesInstalmentStatus.due,
        'upcoming' => SalesInstalmentStatus.upcoming,
        'paid' => SalesInstalmentStatus.paid,
        'voided' => SalesInstalmentStatus.voided,
        _ => null,
      };

  /// Still owed: a payment may be recorded against it.
  bool get isOpen => this == overdue || this == due || this == upcoming;
}

class SalesPayment {
  const SalesPayment({required this.paidOn, this.method, this.reference, this.recordedByName});

  final DateTime paidOn;
  final BillingMethod? method;
  final String? reference;

  /// Who on staff recorded it.
  final String? recordedByName;
}

class SalesVoid {
  const SalesVoid({required this.reason, this.at, this.byName});

  final DateTime? at;
  final String? byName;
  final String reason;
}

class SalesInstalment {
  const SalesInstalment({
    required this.id,
    required this.label,
    required this.amountMinor,
    required this.currency,
    required this.dueDate,
    this.childName,
    this.status,
    this.days,
    this.payment,
    this.voided,
  });

  final String id;
  final String label;

  /// The child it is for; null for the whole family.
  final String? childName;
  final int amountMinor;
  final String currency;
  final DateTime dueDate;

  /// Null when the server sent a status this build does not know: shown without a chip
  /// and offered no action.
  final SalesInstalmentStatus? status;
  final int? days;
  final SalesPayment? payment;
  final SalesVoid? voided;
}

/// One family's billing, as `GET /families/:id/billing` (and every write) answers it.
class FamilyBilling {
  const FamilyBilling({
    required this.familyId,
    this.today,
    this.paymentMethod,
    this.currency,
    this.planMonths,
    this.instalments = const [],
    this.totals = const [],
    this.canRecord = false,
  });

  final String familyId;

  /// The academy's calendar day. A payment can be dated no later than this.
  final DateTime? today;
  final BillingMethod? paymentMethod;
  final String? currency;
  final int? planMonths;

  /// In the server's order (due date).
  final List<SalesInstalment> instalments;
  final List<BillingTotal> totals;

  /// Whether this viewer may record a payment or void an instalment. Advisory: the server
  /// decides again on every write.
  final bool canRecord;
}
