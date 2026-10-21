import '../../../shared/models/parent_billing.dart';
import '../../network/api_client.dart';
import '../repositories.dart';

/// `BillingRepository` over `GET /me/billing` (PD-17).
///
/// One request, parsed by hand, reading only the fields the parent's screen shows.
/// A row the server sends malformed (no id, no amount, no due date) is dropped rather
/// than shown with an invented value; a refusal reaches the caller with its
/// `COMM.BILLING_DENIED` code intact (via [ApiClient]).
class HttpBillingRepository implements BillingRepository {
  HttpBillingRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<ParentBilling> myBilling() async {
    final d = (await _client.get<Map<String, Object?>>('/me/billing')).data ?? const {};
    String? text(Object? v) => v is String && v.trim().isNotEmpty ? v : null;
    int? whole(Object? v) => v is num ? v.toInt() : null;

    final instalments = <BillingInstalment>[];
    for (final raw in (d['instalments'] as List?) ?? const []) {
      if (raw is! Map) continue;
      final id = text(raw['id']);
      final amount = whole(raw['amountMinor']);
      final currency = text(raw['currency']);
      final due = parseCalendarDay(raw['dueDate']);
      if (id == null || amount == null || currency == null || due == null) continue;
      final child = raw['child'] is Map ? raw['child'] as Map : null;
      final payment = raw['payment'] is Map ? raw['payment'] as Map : null;
      final paidOn = parseCalendarDay(payment?['paidOn']);
      instalments.add(BillingInstalment(
        id: id,
        label: text(raw['label']) ?? '',
        childName: text(child?['name']),
        amountMinor: amount,
        currency: currency,
        dueDate: due,
        status: InstalmentStatus.tryParse(raw['status']),
        days: whole(raw['days']),
        payment: paidOn == null
            ? null
            : BillingPayment(
                paidOn: paidOn,
                method: BillingMethod.tryParse(payment?['method']),
                reference: text(payment?['reference']),
              ),
      ));
    }

    return ParentBilling(
      today: parseCalendarDay(d['today']),
      paymentMethod: BillingMethod.tryParse(d['paymentMethod']),
      currency: text(d['currency']),
      planMonths: whole(d['planMonths']),
      instalments: instalments,
      totals: [
        for (final t in (d['totals'] as List?) ?? const [])
          if (t is Map && text(t['currency']) != null)
            BillingTotal(
              currency: t['currency'] as String,
              paidMinor: whole(t['paidMinor']) ?? 0,
              outstandingMinor: whole(t['outstandingMinor']) ?? 0,
              overdueMinor: whole(t['overdueMinor']) ?? 0,
            ),
      ],
    );
  }
}
