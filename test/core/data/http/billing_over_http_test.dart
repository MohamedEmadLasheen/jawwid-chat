import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_billing_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/shared/models/parent_billing.dart';

import 'test_server.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-17: a parent's own payments, read off a REAL HTTP response from `GET /me/billing`.
///
/// No widget binding here: `TestWidgetsFlutterBinding` answers real requests with 400.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpBillingRepository repository() => HttpBillingRepository(
        client: buildApiClient(
          config: ApiConfig(baseUrl: server.baseUrl),
          tokens: _NoTokens(),
        ),
      );

  test('GET /me/billing maps the parent\'s view and ignores anything else', () async {
    server.on('GET', '/me/billing', [
      const Reply.ok({
        'today': '2026-10-21',
        'paymentMethod': 'bank_transfer',
        'currency': 'AED',
        'planMonths': 3,
        'instalments': [
          {
            'id': 'i1',
            'label': 'Autumn term · 1/3',
            'child': {'id': 'k1', 'name': 'سارة', 'birthDate': '2017-03-04'},
            'amountMinor': 125050,
            'currency': 'AED',
            'dueDate': '2026-10-01',
            'status': 'paid',
            'days': 0,
            'payment': {'paidOn': '2026-10-02', 'method': 'invoice', 'reference': 'INV-7', 'recordedBy': 'staff_x'},
            'note': 'internal note',
          },
          {
            'id': 'i2',
            'label': 'Autumn term · 2/3',
            'child': null,
            'amountMinor': 125050,
            'currency': 'AED',
            'dueDate': '2026-11-01',
            'status': 'upcoming',
            'days': 11,
            'payment': null,
          },
          {'id': 'broken', 'label': 'no amount', 'currency': 'AED', 'dueDate': '2026-12-01'}, // dropped
        ],
        'totals': [
          {'currency': 'AED', 'paidMinor': 125050, 'outstandingMinor': 125050, 'overdueMinor': 0},
        ],
        // Not part of the parent's contract: never read.
        'family': {'id': 'f1', 'name': 'حسن'},
        'supervisor': {'id': 's1', 'name': 'خديجة'},
      }),
    ]);

    final billing = await repository().myBilling();

    expect(server.countOf('GET', '/me/billing'), 1);
    expect(billing.today, DateTime(2026, 10, 21));
    expect(billing.paymentMethod, BillingMethod.bankTransfer);
    expect(billing.currency, 'AED');
    expect(billing.planMonths, 3);
    expect(billing.instalments.map((i) => i.id), ['i1', 'i2']);

    final paid = billing.instalments.first;
    expect(paid.label, 'Autumn term · 1/3');
    expect(paid.childName, 'سارة');
    expect(paid.amountMinor, 125050);
    expect(paid.dueDate, DateTime(2026, 10, 1));
    expect(paid.status, InstalmentStatus.paid);
    expect(paid.payment?.paidOn, DateTime(2026, 10, 2));
    expect(paid.payment?.method, BillingMethod.invoice);
    expect(paid.payment?.reference, 'INV-7');

    final upcoming = billing.instalments.last;
    expect(upcoming.childName, isNull);
    expect(upcoming.status, InstalmentStatus.upcoming);
    expect(upcoming.days, 11);
    expect(upcoming.payment, isNull);

    expect(billing.totals.single.currency, 'AED');
    expect(billing.totals.single.paidMinor, 125050);
    expect(billing.totals.single.outstandingMinor, 125050);
    expect(billing.totals.single.overdueMinor, 0);
  });

  test('nulls stay null; an unknown status or method is left unnamed', () async {
    server.on('GET', '/me/billing', [
      const Reply.ok({
        'today': '2026-10-21',
        'paymentMethod': null,
        'currency': null,
        'planMonths': null,
        'instalments': [
          {
            'id': 'i1',
            'label': 'x',
            'amountMinor': 100,
            'currency': 'KWD',
            'dueDate': '2026-10-01',
            'status': 'written_off',
            'payment': {'paidOn': '2026-10-02', 'method': 'cheque', 'reference': null},
          },
        ],
        'totals': <Object?>[],
      }),
    ]);

    final billing = await repository().myBilling();

    expect(billing.paymentMethod, isNull);
    expect(billing.currency, isNull);
    expect(billing.planMonths, isNull);
    expect(billing.instalments.single.status, isNull);
    expect(billing.instalments.single.payment?.method, isNull);
    expect(billing.instalments.single.payment?.reference, isNull);
    expect(billing.totals, isEmpty);
    // A PD-17 server: nothing of PD-27's, and no card offered.
    expect(billing.requests, isEmpty);
    expect(billing.invoices, isEmpty);
    expect(billing.receipts, isEmpty);
    expect(billing.bankAccount, isNull);
    expect(billing.cardAvailable, isFalse);
    expect(billing.instalments.single.paidMinor, isNull);
    expect(billing.instalments.single.partial, isFalse);
    expect(billing.instalments.single.owedMinor, 100);
  });

  test('a parent who does not hold billing gets 403 COMM.BILLING_DENIED, intact', () async {
    server.on('GET', '/me/billing', [Reply.commError(403, 'COMM.BILLING_DENIED')]);

    await expectLater(
      repository().myBilling(),
      throwsA(isA<AppError>()
          .having((e) => e.kind, 'kind', AppErrorKind.forbidden)
          .having((e) => e.code, 'code', 'COMM.BILLING_DENIED')),
    );
    expect(server.countOf('GET', '/me/billing'), 1);
  });
}
