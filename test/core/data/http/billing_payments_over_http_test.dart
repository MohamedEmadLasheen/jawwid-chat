import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_billing_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/parent_billing.dart';

import 'test_server.dart';

class _Tokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'parent-access-token';
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-27 on the wire: the parent's payment requests, invoices and receipts read off
/// `GET /me/billing`, the card checkout, the bank-transfer receipt (authorize, bare PUT,
/// commit) and the invoice link -- against a REAL HTTP server on loopback, with the
/// production uploader. Proves the client speaks `docs/admin/pd027-payments.md`
/// ("Parent"); proves nothing about the server.
void main() {
  late TestServer server;
  late Directory files;

  setUp(() async {
    server = await TestServer.start();
    files = Directory.systemTemp.createTempSync('pd027_receipt');
  });
  tearDown(() async {
    if (files.existsSync()) files.deleteSync(recursive: true);
    await server.stop();
  });

  HttpBillingRepository repository() => HttpBillingRepository(
        client: buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: _Tokens()),
        // No `uploads:` -- the production DioAttachmentUploader is under test.
      );

  const billingBody = <String, Object?>{
    'today': '2026-10-22',
    'paymentMethod': 'bank_transfer',
    'currency': 'AED',
    'planMonths': 3,
    'instalments': [
      {
        'id': 'i1',
        'label': 'Autumn · 1/3',
        'child': {'id': 'k1', 'name': 'سارة'},
        'amountMinor': 125050,
        'currency': 'AED',
        'dueDate': '2026-10-01',
        'status': 'overdue',
        'days': 21,
        'payment': null,
        'paidMinor': 50000,
        'remainingMinor': 75050,
        'partial': true,
        'requestId': 'r2',
      },
    ],
    'totals': [
      {'currency': 'AED', 'paidMinor': 50000, 'outstandingMinor': 75050, 'overdueMinor': 75050},
    ],
    'requests': [
      {
        'id': 'r1',
        'purpose': 'subscription',
        'label': 'Subscription · 3 months',
        'status': 'open',
        'amountMinor': 300000,
        'paidMinor': 0,
        'remainingMinor': 300000,
        'currency': 'AED',
        'child': {'id': null, 'name': 'حسن'},
        'instalmentId': null,
        'planMonths': 3,
        'periodStart': '2026-11-01',
        'periodEnd': '2027-01-31',
        'expiresAt': '2026-11-05T09:00:00.000Z',
        'createdAt': '2026-10-22T09:00:00.000Z',
        // Staff-only fields are never read on the parent's side.
        'link': 'https://api.example/pay/secret',
      },
      {
        'id': 'r2',
        'purpose': 'instalment',
        'label': 'Autumn · 1/3',
        'status': 'open',
        'amountMinor': 75050,
        'paidMinor': 0,
        'remainingMinor': 75050,
        'currency': 'AED',
        'child': null,
        'instalmentId': 'i1',
        'planMonths': null,
        'periodStart': null,
        'periodEnd': null,
        'expiresAt': '2026-11-05T09:00:00.000Z',
        'createdAt': '2026-10-22T09:00:00.000Z',
      },
      {'id': 'r3', 'purpose': 'balance', 'status': 'open', 'currency': 'AED'}, // no amount: dropped
      {
        'id': 'r4',
        'purpose': 'gift',
        'label': 'x',
        'status': 'on_hold',
        'amountMinor': 100,
        'paidMinor': 0,
        'remainingMinor': 100,
        'currency': 'AED',
      },
    ],
    'invoices': [
      {
        'id': 'v1',
        'number': 'JW-2026-000123',
        'issuedAt': '2026-10-02T10:00:00.000Z',
        'status': 'partially_refunded',
        'amountMinor': 50000,
        'refundedMinor': 10000,
        'currency': 'AED',
        'method': 'card',
        'paidOn': '2026-10-02',
        'label': 'Autumn · 1/3',
        'child': {'id': 'k1', 'name': 'سارة'},
        'planMonths': 3,
        'periodStart': '2026-09-01',
        'periodEnd': '2026-11-30',
      },
      {'id': 'v2', 'number': 'JW-2026-000124', 'status': 'void', 'amountMinor': 1, 'currency': 'AED'}, // void: dropped
      {'id': 'v3', 'status': 'paid', 'amountMinor': 1, 'currency': 'AED'}, // no number: dropped
    ],
    'receipts': [
      {
        'id': 'rc1',
        'status': 'rejected',
        'requestId': 'r2',
        'label': 'Autumn · 1/3',
        'amountMinor': 75050,
        'currency': 'AED',
        'transferredOn': '2026-10-20',
        'note': 'من حساب الأب',
        'uploadedAt': '2026-10-20T12:00:00.000Z',
        'fileUrl': 'https://api.example/media/payment-receipts/rc1?sig=x',
        'mimeType': 'image/png',
        'rejectReason': 'The amount does not match',
        'paymentId': null,
      },
    ],
    'bankAccount': {
      'bankName': 'Emirates NBD',
      'accountName': 'Jawwid Academy',
      'iban': 'AE070331234567890123456',
      'accountNumber': null,
      'swift': 'EBILAEAD',
      'note': "Write the child's name in the reference",
    },
    'cardAvailable': true,
  };

  test('GET /me/billing maps requests, invoices, receipts, the bank account and the card switch', () async {
    server.on('GET', '/me/billing', [const Reply.ok(billingBody)]);

    final b = await repository().myBilling();

    final i = b.instalments.single;
    expect(i.paidMinor, 50000);
    expect(i.remainingMinor, 75050);
    expect(i.partial, isTrue);
    expect(i.requestId, 'r2');
    expect(i.owedMinor, 75050);

    expect(b.requests.map((r) => r.id), ['r1', 'r2', 'r4']);
    final r1 = b.requests.first;
    expect(r1.purpose, RequestPurpose.subscription);
    expect(r1.status, RequestStatus.open);
    expect(r1.isOpen, isTrue);
    expect(r1.label, 'Subscription · 3 months');
    expect(r1.amountMinor, 300000);
    expect(r1.remainingMinor, 300000);
    expect(r1.childName, 'حسن');
    expect(r1.planMonths, 3);
    expect(r1.periodStart, DateTime(2026, 11, 1));
    expect(r1.periodEnd, DateTime(2027, 1, 31));
    expect(r1.expiresAt?.toUtc(), DateTime.utc(2026, 11, 5, 9));
    expect(b.requests[1].instalmentId, 'i1');
    // Unknown purpose and status: kept, unnamed, and never offered for payment.
    expect(b.requests.last.purpose, isNull);
    expect(b.requests.last.status, isNull);
    expect(b.requests.last.isOpen, isFalse);

    final v = b.invoices.single;
    expect(v.number, 'JW-2026-000123');
    expect(v.status, InvoiceStatus.partiallyRefunded);
    expect(v.refundedMinor, 10000);
    expect(v.method, BillingMethod.card);
    expect(v.paidOn, DateTime(2026, 10, 2));
    expect(v.childName, 'سارة');
    expect(v.planMonths, 3);

    final rc = b.receipts.single;
    expect(rc.status, ReceiptStatus.rejected);
    expect(rc.requestId, 'r2');
    expect(rc.amountMinor, 75050);
    expect(rc.transferredOn, DateTime(2026, 10, 20));
    expect(rc.note, 'من حساب الأب');
    expect(rc.rejectReason, 'The amount does not match');
    expect(rc.fileUrl, startsWith('https://'));

    expect(b.bankAccount?.accountName, 'Jawwid Academy');
    expect(b.bankAccount?.iban, 'AE070331234567890123456');
    expect(b.bankAccount?.accountNumber, isNull);
    expect(b.bankAccount?.swift, 'EBILAEAD');
    expect(b.cardAvailable, isTrue);
  });

  test('a bank account without its one required field is no bank account', () async {
    server.on('GET', '/me/billing', [
      const Reply.ok({
        'instalments': <Object?>[],
        'bankAccount': {'iban': 'AE07', 'accountName': '  '},
        'cardAvailable': 'yes',
      }),
    ]);
    final b = await repository().myBilling();
    expect(b.bankAccount, isNull);
    expect(b.cardAvailable, isFalse, reason: 'only a literal true offers a card');
  });

  group('POST /me/billing/checkout', () {
    test('a request is named by requestId; the answer is the Checkout URL', () async {
      server.on('POST', '/me/billing/checkout', [const Reply.ok({'url': 'https://checkout.stripe.com/c/pay/cs_1'})]);

      final url = await repository().checkout(requestId: 'r1');

      expect(url, 'https://checkout.stripe.com/c/pay/cs_1');
      expect(server.lastRequestTo('POST', '/me/billing/checkout')!.json, {'requestId': 'r1'});
    });

    test('an instalment is named by instalmentId alone', () async {
      server.on('POST', '/me/billing/checkout', [const Reply.ok({'url': 'https://checkout.stripe.com/c/pay/cs_2'})]);

      await repository().checkout(instalmentId: 'i1');

      expect(server.lastRequestTo('POST', '/me/billing/checkout')!.json, {'instalmentId': 'i1'});
    });

    test('503 COMM.PAYMENTS_UNAVAILABLE reaches the caller intact, asked once', () async {
      server.on('POST', '/me/billing/checkout', [Reply.commError(503, BillingErrors.paymentsUnavailable)]);

      await expectLater(
        repository().checkout(requestId: 'r1'),
        throwsA(isA<AppError>().having((e) => e.code, 'code', BillingErrors.paymentsUnavailable)),
      );
      expect(server.countOf('POST', '/me/billing/checkout'), 1, reason: 'a POST is never retried');
    });

    test('409 COMM.BILLING_STATE reaches the caller intact', () async {
      server.on('POST', '/me/billing/checkout', [Reply.commError(409, BillingErrors.state)]);

      await expectLater(
        repository().checkout(instalmentId: 'i1'),
        throwsA(isA<AppError>().having((e) => e.code, 'code', BillingErrors.state)),
      );
    });

    test('429 after ten attempts carries COMM.BILLING_STATE but reads as rate-limited, asked once', () async {
      server.on('POST', '/me/billing/checkout', [Reply.commError(429, BillingErrors.state)]);

      await expectLater(
        repository().checkout(requestId: 'r1'),
        throwsA(isA<AppError>()
            .having((e) => e.kind, 'kind', AppErrorKind.rateLimited)
            .having((e) => e.code, 'code', BillingErrors.state)),
      );
      expect(server.countOf('POST', '/me/billing/checkout'), 1);
    });

    test('an answer without a url is a server fault, not an empty link', () async {
      server.on('POST', '/me/billing/checkout', [const Reply.ok({'url': ''})]);
      await expectLater(
        repository().checkout(requestId: 'r1'),
        throwsA(isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.server)),
      );
    });
  });

  group('a bank-transfer receipt', () {
    const objectKey = 'payment-receipts/f1/0b5c2f1e-0000-4000-8000-00000000cafe';
    const storagePath = '/storage/$objectKey';
    final bytes = Uint8List.fromList(List<int>.generate(700, (i) => (i * 11 + 3) % 256));

    PendingAttachment file({int? byteSize}) {
      final f = File('${files.path}${Platform.pathSeparator}receipt.png')..writeAsBytesSync(bytes);
      return PendingAttachment(
        filePath: f.path,
        kind: MessageKind.image,
        mimeType: 'image/png',
        byteSize: byteSize ?? bytes.length,
      );
    }

    Map<String, Object?> grant() => {
          'objectKey': objectKey,
          'uploadUrl': '${server.baseUrl}$storagePath?expires=1789000000&sig=beef',
          'method': 'PUT',
          'headers': const {'content-type': 'image/png'},
          'expiresAt': '2026-10-22T12:00:00.000Z',
        };

    test('authorize, PUT the bytes with exactly the grant\'s headers, then commit', () async {
      server.on('POST', '/me/billing/receipts/upload', [Reply.ok(grant())]);
      server.on('PUT', storagePath, [const Reply(200, null)]);
      server.on('POST', '/me/billing/receipts', [const Reply.ok(billingBody)]);

      final billing = await repository().submitReceipt(ReceiptDraft(
        file: file(),
        instalmentId: 'i1',
        amountMinor: 75050,
        transferredOn: DateTime(2026, 10, 21),
        note: '  من حساب الأب  ',
      ));

      expect(server.requests.map((r) => '${r.method} ${r.path}'), [
        'POST /me/billing/receipts/upload',
        'PUT $storagePath',
        'POST /me/billing/receipts',
      ]);

      final authorize = server.lastRequestTo('POST', '/me/billing/receipts/upload')!;
      expect(authorize.json, {'mimeType': 'image/png', 'byteSize': 700});
      expect(authorize.headers['authorization'], 'Bearer parent-access-token');

      final put = server.lastRequestTo('PUT', storagePath)!;
      expect(put.bodyBytes, bytes, reason: 'the bytes arrive unchanged');
      expect(put.headers['content-type'], 'image/png');
      expect(put.headers.containsKey('authorization'), isFalse, reason: 'the signed URL never sees the session');

      expect(server.lastRequestTo('POST', '/me/billing/receipts')!.json, {
        'objectKey': objectKey,
        'instalmentId': 'i1',
        'amountMinor': 75050,
        'transferredOn': '2026-10-21',
        'note': 'من حساب الأب',
      });
      expect(billing.receipts.single.id, 'rc1', reason: "the commit answers GET /me/billing's shape");
    });

    test('a request is named by requestId; a blank note is left out', () async {
      server.on('POST', '/me/billing/receipts/upload', [Reply.ok(grant())]);
      server.on('PUT', storagePath, [const Reply(200, null)]);
      server.on('POST', '/me/billing/receipts', [const Reply.ok(billingBody)]);

      await repository().submitReceipt(ReceiptDraft(
        file: file(),
        requestId: 'r1',
        amountMinor: 300000,
        transferredOn: DateTime(2026, 10, 2),
        note: '   ',
      ));

      expect(server.lastRequestTo('POST', '/me/billing/receipts')!.json, {
        'objectKey': objectKey,
        'requestId': 'r1',
        'amountMinor': 300000,
        'transferredOn': '2026-10-02',
      });
    });

    test('409 COMM.BILLING_STATE on commit reaches the caller intact', () async {
      server.on('POST', '/me/billing/receipts/upload', [Reply.ok(grant())]);
      server.on('PUT', storagePath, [const Reply(200, null)]);
      server.on('POST', '/me/billing/receipts', [Reply.commError(409, BillingErrors.state)]);

      await expectLater(
        repository().submitReceipt(ReceiptDraft(file: file(), requestId: 'r1', amountMinor: 1, transferredOn: DateTime(2026, 10, 2))),
        throwsA(isA<AppError>().having((e) => e.code, 'code', BillingErrors.state)),
      );
    });

    test('a rate-limited authorize (429) uploads and commits nothing', () async {
      server.on('POST', '/me/billing/receipts/upload', [Reply.commError(429, 'COMMON.RATE_LIMITED')]);

      await expectLater(
        repository().submitReceipt(ReceiptDraft(file: file(), requestId: 'r1', amountMinor: 1, transferredOn: DateTime(2026, 10, 2))),
        throwsA(isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.rateLimited)),
      );
      expect(server.countOf('POST', '/me/billing/receipts/upload'), 1);
      expect(server.countOf('PUT', storagePath), 0);
      expect(server.countOf('POST', '/me/billing/receipts'), 0);
    });

    test('a refused upload stops before any commit', () async {
      server.on('POST', '/me/billing/receipts/upload', [Reply.ok(grant())]);
      server.on('PUT', storagePath, [const Reply(403, null)]);

      await expectLater(
        repository().submitReceipt(ReceiptDraft(file: file(), requestId: 'r1', amountMinor: 1, transferredOn: DateTime(2026, 10, 2))),
        throwsA(isA<AppError>()),
      );
      expect(server.countOf('POST', '/me/billing/receipts'), 0);
    });

    test('a grant without a key or URL, or a file that changed size, uploads nothing', () async {
      server.on('POST', '/me/billing/receipts/upload', [
        const Reply.ok({'uploadUrl': 'x'}),
        Reply.ok(grant()),
      ]);

      await expectLater(
        repository().submitReceipt(ReceiptDraft(file: file(), requestId: 'r1', amountMinor: 1, transferredOn: DateTime(2026, 10, 2))),
        throwsA(isA<AppError>().having((e) => e.code, 'code', 'malformed_upload_authorization')),
      );
      await expectLater(
        repository().submitReceipt(
            ReceiptDraft(file: file(byteSize: 699), requestId: 'r1', amountMinor: 1, transferredOn: DateTime(2026, 10, 2))),
        throwsA(isA<AppError>().having((e) => e.code, 'code', 'receipt_size_changed')),
      );
      expect(server.countOf('PUT', storagePath), 0);
      expect(server.countOf('POST', '/me/billing/receipts'), 0);
    });
  });

  test('GET /me/billing/invoices/:id/link answers the signed PDF link', () async {
    server.on('GET', '/me/billing/invoices/v1/link', [const Reply.ok({'url': 'https://api.example/media/invoices/v1.pdf?sig=x'})]);

    expect(await repository().invoiceLink('v1'), 'https://api.example/media/invoices/v1.pdf?sig=x');
    expect(server.countOf('GET', '/me/billing/invoices/v1/link'), 1);
  });
}
