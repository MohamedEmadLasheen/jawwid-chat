import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_sales_payments_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/features/sales_payments/domain/sales_billing.dart';
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

/// PD-20: Sales' Payments over a REAL HTTP socket -- the exact paths and bodies, and a
/// family billing parse that reads only what the screens show.
///
/// No widget binding here: `TestWidgetsFlutterBinding` answers real requests with 400.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpSalesPaymentsRepository repository() => HttpSalesPaymentsRepository(
        client: buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: _NoTokens()),
      );

  Map<String, Object?> billingBody({String status = 'overdue', Object? payment, Object? voided}) => {
        'familyId': 'f1',
        'today': '2026-10-22',
        'paymentMethod': 'bank_transfer',
        'currency': 'AED',
        'planMonths': 3,
        'canRecord': true,
        'instalments': [
          {
            'id': 'i1',
            'planId': 'p1',
            'label': 'Autumn term · 1/3',
            'child': {'id': 'k1', 'name': 'سارة'},
            'amountMinor': 125050,
            'currency': 'AED',
            'dueDate': '2026-10-01',
            'status': status,
            'days': 21,
            'createdAt': '2026-09-01T09:00:00.000Z',
            'createdBy': {'id': 's1', 'name': 'خديجة'},
            'payment': payment,
            'void': voided,
          },
          {'id': 'broken', 'label': 'no amount', 'currency': 'AED', 'dueDate': '2026-12-01'},
        ],
        'totals': [
          {'currency': 'AED', 'paidMinor': 0, 'outstandingMinor': 125050, 'overdueMinor': 125050},
        ],
        // Not the Sales screen's business, and never read.
        'notes': 'internal',
        'parents': [
          {'id': 'p1', 'name': 'حسن'},
        ],
      };

  test('GET /parent-profiles?q= -- names, family, children; nothing else', () async {
    server.on('GET', '/parent-profiles', [
      const Reply.ok({
        'items': [
          {
            'id': 'c1',
            'name': 'حسن',
            'avatarUrl': null,
            'family': {'id': 'f1', 'name': 'آل حسن'},
            'childrenCount': 2,
            'phone': 'never read',
            'email': 'never read',
          },
          {'id': 'c2', 'name': 'no family'}, // dropped: no family to open
        ],
        'truncated': true,
      }),
    ]);

    final result = await repository().searchParents('  حسن ');

    final request = server.lastRequestTo('GET', '/parent-profiles')!;
    expect(request.query, {'q': 'حسن'});
    expect(result.truncated, isTrue);
    expect(result.items.single.id, 'c1');
    expect(result.items.single.name, 'حسن');
    expect(result.items.single.familyId, 'f1');
    expect(result.items.single.familyName, 'آل حسن');
    expect(result.items.single.childrenCount, 2);
    // No request ever named a parent's detail record.
    expect(server.requests.where((r) => r.path.startsWith('/parent-profiles/')), isEmpty);
  });

  test('GET /families/:id/billing parses the timeline and ignores unknown fields', () async {
    server.on('GET', '/families/f1/billing', [
      Reply.ok(billingBody(
        status: 'voided',
        voided: {'at': '2026-10-05T10:00:00.000Z', 'by': {'id': 's2', 'name': 'خديجة'}, 'reason': 'duplicate'},
      )),
    ]);

    final billing = await repository().familyBilling('f1');

    expect(server.countOf('GET', '/families/f1/billing'), 1);
    expect(billing.familyId, 'f1');
    expect(billing.today, DateTime(2026, 10, 22));
    expect(billing.paymentMethod, BillingMethod.bankTransfer);
    expect(billing.currency, 'AED');
    expect(billing.planMonths, 3);
    expect(billing.canRecord, isTrue);
    expect(billing.instalments.map((i) => i.id), ['i1']);
    final i = billing.instalments.single;
    expect(i.label, 'Autumn term · 1/3');
    expect(i.childName, 'سارة');
    expect(i.amountMinor, 125050);
    expect(i.dueDate, DateTime(2026, 10, 1));
    expect(i.status, SalesInstalmentStatus.voided);
    expect(i.voided?.reason, 'duplicate');
    expect(i.voided?.byName, 'خديجة');
    expect(i.payment, isNull);
    expect(billing.totals.single.overdueMinor, 125050);
  });

  test('POST /instalments/:id/payment sends the day, the method and the reference; answers the body', () async {
    server.on('POST', '/instalments/i1/payment', [
      Reply.ok(billingBody(
        status: 'paid',
        payment: {
          'paidOn': '2026-10-20',
          'method': 'invoice',
          'reference': 'INV-7',
          'recordedAt': '2026-10-22T08:00:00.000Z',
          'recordedBy': {'id': 's1', 'name': 'خديجة'},
        },
      )),
    ]);

    final billing = await repository().recordPayment(
      'i1',
      paidOn: DateTime(2026, 10, 20, 23, 30),
      method: BillingMethod.invoice,
      reference: ' INV-7 ',
    );

    expect(server.lastRequestTo('POST', '/instalments/i1/payment')!.json, {
      'paidOn': '2026-10-20',
      'method': 'invoice',
      'reference': 'INV-7',
    });
    final p = billing.instalments.single.payment!;
    expect(p.paidOn, DateTime(2026, 10, 20));
    expect(p.method, BillingMethod.invoice);
    expect(p.reference, 'INV-7');
    expect(p.recordedByName, 'خديجة');
  });

  test('an empty reference is not sent; bank transfer is spelled the server\'s way', () async {
    server.on('POST', '/instalments/i1/payment', [Reply.ok(billingBody(status: 'paid'))]);

    await repository().recordPayment('i1', paidOn: DateTime(2026, 10, 22), method: BillingMethod.bankTransfer, reference: '  ');

    expect(server.lastRequestTo('POST', '/instalments/i1/payment')!.json, {'paidOn': '2026-10-22', 'method': 'bank_transfer'});
  });

  test('POST /instalments/:id/void sends the reason', () async {
    server.on('POST', '/instalments/i1/void', [Reply.ok(billingBody(status: 'voided', voided: {'reason': 'duplicate'}))]);

    final billing = await repository().voidInstalment('i1', reason: ' duplicate ');

    expect(server.lastRequestTo('POST', '/instalments/i1/void')!.json, {'reason': 'duplicate'});
    expect(billing.instalments.single.status, SalesInstalmentStatus.voided);
  });

  test('a 409 keeps COMM.BILLING_STATE; a 400 is a validation error', () async {
    server.on('POST', '/instalments/i1/payment', [Reply.commError(409, 'COMM.BILLING_STATE')]);
    server.on('POST', '/instalments/i1/void', [Reply.commError(400, 'VALIDATION')]);

    await expectLater(
      repository().recordPayment('i1', paidOn: DateTime(2026, 10, 22), method: BillingMethod.invoice),
      throwsA(isA<AppError>().having((e) => e.code, 'code', 'COMM.BILLING_STATE')),
    );
    await expectLater(
      repository().voidInstalment('i1', reason: 'x'),
      throwsA(isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.validation)),
    );
  });
}
