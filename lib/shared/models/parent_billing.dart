/// PD-17 (2026-10-21): a parent's own payments, from `GET /me/billing`.
///
/// PD-27 (2026-10-22) adds how money arrives and what the parent gets back: payment
/// [requests], [invoices], uploaded bank-transfer [receipts], the academy's
/// [bankAccount], and whether card payment is offered at all ([cardAvailable]).
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
    this.requests = const [],
    this.invoices = const [],
    this.receipts = const [],
    this.bankAccount,
    this.cardAvailable = false,
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

  /// PD-27: open and paid requests (never cancelled or expired), as the server sends them.
  final List<PaymentRequest> requests;

  /// PD-27: one per payment, never a voided one.
  final List<BillingInvoice> invoices;

  /// PD-27: bank-transfer proofs this family uploaded, whatever their verdict.
  final List<PaymentReceipt> receipts;

  /// Where a bank transfer goes; null when the academy has not set it.
  final BankAccount? bankAccount;

  /// False on a deployment without Stripe: no card option anywhere.
  final bool cardAvailable;
}

/// How the family pays, or how one payment arrived. A value this build does not know is
/// left unnamed (null). `invoice` is PD-17's record of a payment made outside the app.
enum BillingMethod {
  invoice,
  bankTransfer,
  card,
  cash;

  static BillingMethod? tryParse(Object? raw) => switch (raw) {
        'invoice' => BillingMethod.invoice,
        'bank_transfer' => BillingMethod.bankTransfer,
        'card' => BillingMethod.card,
        'cash' => BillingMethod.cash,
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
    this.paidMinor,
    this.remainingMinor,
    this.partial = false,
    this.requestId,
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

  /// PD-27: what its payments cover so far. Null from a server that predates partial
  /// payments.
  final int? paidMinor;

  /// PD-27: what is still owed. Null from a server that predates partial payments.
  final int? remainingMinor;

  /// PD-27: some, not all, of it is paid.
  final bool partial;

  /// PD-27: its open payment request, when one exists.
  final String? requestId;

  /// What is still owed, whichever server answered: a paid instalment owes nothing,
  /// and without [remainingMinor] the whole amount less what is known to be paid.
  int get owedMinor {
    if (status == InstalmentStatus.paid) return 0;
    final remaining = remainingMinor ?? amountMinor - (paidMinor ?? 0);
    return remaining < 0 ? 0 : remaining;
  }
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

/// PD-27: what a payment request is for.
enum RequestPurpose {
  subscription,
  renewal,
  instalment,
  balance,
  other;

  static RequestPurpose? tryParse(Object? raw) => switch (raw) {
        'subscription' => RequestPurpose.subscription,
        'renewal' => RequestPurpose.renewal,
        'instalment' => RequestPurpose.instalment,
        'balance' => RequestPurpose.balance,
        'other' => RequestPurpose.other,
        _ => null,
      };
}

enum RequestStatus {
  open,
  paid,
  cancelled,
  expired;

  static RequestStatus? tryParse(Object? raw) => switch (raw) {
        'open' => RequestStatus.open,
        'paid' => RequestStatus.paid,
        'cancelled' => RequestStatus.cancelled,
        'expired' => RequestStatus.expired,
        _ => null,
      };
}

/// PD-27: "please pay X for Y". The parent pays it by card or by uploading a transfer
/// receipt; the server alone decides when it is paid.
class PaymentRequest {
  const PaymentRequest({
    required this.id,
    required this.label,
    required this.amountMinor,
    required this.paidMinor,
    required this.remainingMinor,
    required this.currency,
    this.purpose,
    this.status,
    this.childName,
    this.instalmentId,
    this.planMonths,
    this.periodStart,
    this.periodEnd,
    this.expiresAt,
    this.createdAt,
  });

  final String id;
  final String label;

  /// Null for a purpose this build does not know.
  final RequestPurpose? purpose;

  /// Null for a status this build does not know: never offered for payment.
  final RequestStatus? status;
  final int amountMinor;
  final int paidMinor;
  final int remainingMinor;
  final String currency;
  final String? childName;

  /// The instalment it pays, when it pays one.
  final String? instalmentId;

  /// The package: 1, 3, 6 or 12 months.
  final int? planMonths;
  final DateTime? periodStart;
  final DateTime? periodEnd;
  final DateTime? expiresAt;
  final DateTime? createdAt;

  bool get isOpen => status == RequestStatus.open && remainingMinor > 0;
}

enum InvoiceStatus {
  paid,
  partiallyRefunded,
  refunded,
  voided;

  static InvoiceStatus? tryParse(Object? raw) => switch (raw) {
        'paid' => InvoiceStatus.paid,
        'partially_refunded' => InvoiceStatus.partiallyRefunded,
        'refunded' => InvoiceStatus.refunded,
        'void' => InvoiceStatus.voided,
        _ => null,
      };
}

/// PD-27: one payment's invoice, numbered `JW-<year>-<000001>` and frozen at issue. The
/// PDF is fetched through a short-lived link, never stored here.
class BillingInvoice {
  const BillingInvoice({
    required this.id,
    required this.number,
    required this.amountMinor,
    required this.currency,
    this.issuedAt,
    this.status,
    this.refundedMinor = 0,
    this.method,
    this.paidOn,
    this.label = '',
    this.childName,
    this.planMonths,
    this.periodStart,
    this.periodEnd,
  });

  final String id;
  final String number;
  final DateTime? issuedAt;
  final InvoiceStatus? status;
  final int amountMinor;
  final int refundedMinor;
  final String currency;
  final BillingMethod? method;
  final DateTime? paidOn;
  final String label;
  final String? childName;
  final int? planMonths;
  final DateTime? periodStart;
  final DateTime? periodEnd;
}

enum ReceiptStatus {
  pending,
  approved,
  rejected;

  static ReceiptStatus? tryParse(Object? raw) => switch (raw) {
        'pending' => ReceiptStatus.pending,
        'approved' => ReceiptStatus.approved,
        'rejected' => ReceiptStatus.rejected,
        _ => null,
      };
}

/// PD-27: a bank-transfer proof the family uploaded. Pending until the academy approves
/// it (which records the payment) or rejects it with a reason the parent sees.
class PaymentReceipt {
  const PaymentReceipt({
    required this.id,
    required this.amountMinor,
    required this.currency,
    this.status,
    this.requestId,
    this.label = '',
    this.transferredOn,
    this.note,
    this.uploadedAt,
    this.fileUrl,
    this.mimeType,
    this.rejectReason,
  });

  final String id;
  final ReceiptStatus? status;
  final String? requestId;
  final String label;

  /// What the parent says they sent.
  final int amountMinor;
  final String currency;
  final DateTime? transferredOn;
  final String? note;
  final DateTime? uploadedAt;

  /// Signed for this viewer and short-lived; re-read the list for a fresh one.
  final String? fileUrl;
  final String? mimeType;
  final String? rejectReason;
}

/// PD-27: where a bank transfer goes. Only [accountName] is always present.
class BankAccount {
  const BankAccount({
    required this.accountName,
    this.bankName,
    this.iban,
    this.accountNumber,
    this.swift,
    this.note,
  });

  final String accountName;
  final String? bankName;
  final String? iban;
  final String? accountNumber;
  final String? swift;

  /// The academy's instruction, e.g. "write the child's name in the transfer reference".
  final String? note;
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
