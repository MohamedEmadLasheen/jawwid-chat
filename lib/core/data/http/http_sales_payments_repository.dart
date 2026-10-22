import '../../../features/sales_payments/data/sales_payments_repository.dart';
import '../../../features/sales_payments/domain/sales_billing.dart';
import '../../../shared/models/parent_billing.dart';
import '../../network/api_client.dart';

/// `SalesPaymentsRepository` over the PD-17 administration endpoints (PD-20: Sales in
/// the app).
///
/// | Method | Path |
/// |---|---|
/// | GET | `/parent-profiles?q=` -- the list; never a parent's detail record |
/// | GET | `/families/:id/billing` |
/// | POST | `/instalments/:id/payment` |
/// | POST | `/instalments/:id/void` |
///
/// THE ONLY FILE OUTSIDE `lib/features/sales_payments/` allowed to name these paths (a
/// guard test confines them). The parent detail route, `/parent-profiles/<id>`, is never
/// called from anywhere: it answers a phone number and an e-mail address, and the app must
/// never hold either (G-07).
///
/// Every method is one request, parsed by hand, reading only what the screens show.
class HttpSalesPaymentsRepository implements SalesPaymentsRepository {
  HttpSalesPaymentsRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<ParentSearchResult> searchParents(String query) async {
    final q = query.trim();
    final d = (await _client.get<Map<String, Object?>>('/parent-profiles', query: {'q': q})).data ?? const {};
    return ParentSearchResult(
      truncated: d['truncated'] == true,
      items: [
        for (final raw in (d['items'] as List?) ?? const [])
          if (raw is Map && _text(raw['id']) != null && raw['family'] is Map && _text((raw['family'] as Map)['id']) != null)
            ParentSearchHit(
              id: raw['id'] as String,
              name: _text(raw['name']) ?? '',
              avatarUrl: _text(raw['avatarUrl']),
              familyId: (raw['family'] as Map)['id'] as String,
              familyName: _text((raw['family'] as Map)['name']) ?? '',
              childrenCount: (raw['childrenCount'] as num?)?.toInt() ?? 0,
            ),
      ],
    );
  }

  @override
  Future<FamilyBilling> familyBilling(String familyId) async {
    final d = (await _client.get<Map<String, Object?>>('/families/$familyId/billing')).data ?? const {};
    return parseFamilyBilling(d, fallbackFamilyId: familyId);
  }

  @override
  Future<FamilyBilling> recordPayment(
    String instalmentId, {
    required DateTime paidOn,
    required BillingMethod method,
    String? reference,
  }) async {
    final ref = reference?.trim();
    final d = (await _client.post<Map<String, Object?>>('/instalments/$instalmentId/payment', data: {
      'paidOn': calendarDay(paidOn),
      'method': switch (method) {
        BillingMethod.invoice => 'invoice',
        BillingMethod.bankTransfer => 'bank_transfer',
      },
      if (ref != null && ref.isNotEmpty) 'reference': ref,
    })).data ?? const {};
    return parseFamilyBilling(d);
  }

  @override
  Future<FamilyBilling> voidInstalment(String instalmentId, {required String reason}) async {
    final d = (await _client.post<Map<String, Object?>>('/instalments/$instalmentId/void', data: {
      'reason': reason.trim(),
    })).data ?? const {};
    return parseFamilyBilling(d);
  }

  /// `YYYY-MM-DD`, the calendar day as the person chose it -- never shifted by a zone.
  static String calendarDay(DateTime day) =>
      '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';

  static String? _text(Object? v) => v is String && v.trim().isNotEmpty ? v : null;
  static int? _whole(Object? v) => v is num ? v.toInt() : null;
  static String? _nameOf(Object? who) => who is Map ? _text(who['name']) : null;

  /// The family billing body (the same from the read and from every write). Anything
  /// else it carries -- plan ids, who created a row and when -- is never read.
  static FamilyBilling parseFamilyBilling(Map<String, Object?> d, {String fallbackFamilyId = ''}) {
    final instalments = <SalesInstalment>[];
    for (final raw in (d['instalments'] as List?) ?? const []) {
      if (raw is! Map) continue;
      final id = _text(raw['id']);
      final amount = _whole(raw['amountMinor']);
      final currency = _text(raw['currency']);
      final due = parseCalendarDay(raw['dueDate']);
      // A malformed row is dropped rather than shown with an invented value.
      if (id == null || amount == null || currency == null || due == null) continue;
      final child = raw['child'] is Map ? raw['child'] as Map : null;
      final payment = raw['payment'] is Map ? raw['payment'] as Map : null;
      final paidOn = parseCalendarDay(payment?['paidOn']);
      final voided = raw['void'] is Map ? raw['void'] as Map : null;
      instalments.add(SalesInstalment(
        id: id,
        label: _text(raw['label']) ?? '',
        childName: _text(child?['name']),
        amountMinor: amount,
        currency: currency,
        dueDate: due,
        status: SalesInstalmentStatus.tryParse(raw['status']),
        days: _whole(raw['days']),
        payment: paidOn == null
            ? null
            : SalesPayment(
                paidOn: paidOn,
                method: BillingMethod.tryParse(payment?['method']),
                reference: _text(payment?['reference']),
                recordedByName: _nameOf(payment?['recordedBy']),
              ),
        voided: voided == null
            ? null
            : SalesVoid(
                reason: _text(voided['reason']) ?? '',
                at: voided['at'] is String ? DateTime.tryParse(voided['at'] as String)?.toLocal() : null,
                byName: _nameOf(voided['by']),
              ),
      ));
    }

    return FamilyBilling(
      familyId: _text(d['familyId']) ?? fallbackFamilyId,
      today: parseCalendarDay(d['today']),
      paymentMethod: BillingMethod.tryParse(d['paymentMethod']),
      currency: _text(d['currency']),
      planMonths: _whole(d['planMonths']),
      canRecord: d['canRecord'] == true,
      instalments: instalments,
      totals: [
        for (final t in (d['totals'] as List?) ?? const [])
          if (t is Map && _text(t['currency']) != null)
            BillingTotal(
              currency: t['currency'] as String,
              paidMinor: _whole(t['paidMinor']) ?? 0,
              outstandingMinor: _whole(t['outstandingMinor']) ?? 0,
              overdueMinor: _whole(t['overdueMinor']) ?? 0,
            ),
      ],
    );
  }
}
