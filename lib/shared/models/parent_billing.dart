/// PD-17 (2026-10-21): a parent's own payments, from `GET /me/billing`.
///
/// Only the parent who holds billing for their family gets an answer; everyone else --
/// a teacher, staff, another parent of the same family -- is refused with
/// `COMM.BILLING_DENIED`. Nothing here decides that, and nothing here is the
/// administration's view: no other family, no notes, no supervisor.
class ParentBilling {
  const ParentBilling({
    this.today,
    this.paymentMethod,
    this.currency,
    this.planMonths,
    this.instalments = const [],
    this.totals = const [],
  });

  /// The empty answer: no plan, nothing billed yet.
  static const empty = ParentBilling();

  /// The academy's calendar day, as the server computed [BillingInstalment.status].
  final DateTime? today;
  final BillingMethod? paymentMethod;
  final String? currency;
  final int? planMonths;

  /// In due-date order, as the server sends them.
  final List<BillingInstalment> instalments;

  /// One row per currency.
  final List<BillingTotal> totals;
}

/// How the family pays. A value this build does not know is left unnamed (null).
enum BillingMethod {
  invoice,
  bankTransfer;

  static BillingMethod? tryParse(Object? raw) => switch (raw) {
        'invoice' => BillingMethod.invoice,
        'bank_transfer' => BillingMethod.bankTransfer,
        _ => null,
      };
}

/// Where an instalment stands on [ParentBilling.today]; the server decides it.
enum InstalmentStatus {
  overdue,
  due,
  upcoming,
  paid;

  static InstalmentStatus? tryParse(Object? raw) => switch (raw) {
        'overdue' => InstalmentStatus.overdue,
        'due' => InstalmentStatus.due,
        'upcoming' => InstalmentStatus.upcoming,
        'paid' => InstalmentStatus.paid,
        _ => null,
      };
}

class BillingInstalment {
  const BillingInstalment({
    required this.id,
    required this.label,
    required this.amountMinor,
    required this.currency,
    required this.dueDate,
    this.childName,
    this.status,
    this.days,
    this.payment,
  });

  final String id;
  final String label;

  /// The child this instalment is for; null when it is the whole family's.
  final String? childName;

  /// In the currency's minor units (fils, piastres, cents...): see [minorDigits].
  final int amountMinor;
  final String currency;
  final DateTime dueDate;

  /// Null when the server sent a status this build does not know: shown without a chip.
  final InstalmentStatus? status;

  /// Days late for an overdue instalment, days until due for an upcoming one.
  final int? days;
  final BillingPayment? payment;
}

class BillingPayment {
  const BillingPayment({required this.paidOn, this.method, this.reference});

  final DateTime paidOn;
  final BillingMethod? method;
  final String? reference;
}

class BillingTotal {
  const BillingTotal({
    required this.currency,
    required this.paidMinor,
    required this.outstandingMinor,
    required this.overdueMinor,
  });

  final String currency;
  final int paidMinor;
  final int outstandingMinor;

  /// The part of [outstandingMinor] already past its due date.
  final int overdueMinor;
}

/// How many decimals a currency's minor unit has (ISO 4217). Two unless known otherwise.
int minorDigits(String currency) => switch (currency.toUpperCase()) {
      'KWD' || 'BHD' || 'OMR' || 'JOD' => 3,
      'JPY' => 0,
      _ => 2,
    };

/// A calendar day `YYYY-MM-DD`, as a local date at midnight -- never shifted by a zone,
/// because a due date is a day, not an instant.
DateTime? parseCalendarDay(Object? raw) {
  if (raw is! String) return null;
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})').firstMatch(raw);
  if (m == null) return null;
  return DateTime(int.parse(m[1]!), int.parse(m[2]!), int.parse(m[3]!));
}
