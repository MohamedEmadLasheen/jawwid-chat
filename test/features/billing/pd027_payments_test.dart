import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/media/attachment_opener.dart';
import 'package:jawwid_chat/core/media/media_picker.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/billing/domain/amount_due.dart';
import 'package:jawwid_chat/features/billing/domain/money_format.dart';
import 'package:jawwid_chat/features/billing/presentation/my_payments_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/parent_billing.dart';

/// PD-27 on the parent's Payments screen: what is due and Pay, the pay sheet (card only
/// where the academy takes cards), the bank-transfer receipt, the receipts' verdicts and
/// the invoices. The server is a fake; the client is held to drawing what it is given and
/// to sending exactly what the parent chose -- and to never calling anything paid itself.
void main() {
  BillingInstalment instalment(String id, {required InstalmentStatus status, int paid = 0, String? requestId, int? days}) =>
      BillingInstalment(
        id: id,
        label: 'Autumn · $id',
        childName: 'سارة',
        amountMinor: 125050,
        currency: 'AED',
        dueDate: id == 'i2' ? DateTime(2026, 10, 1) : DateTime(2026, 11, 1),
        status: status,
        days: days,
        paidMinor: status == InstalmentStatus.paid ? 125050 : paid,
        remainingMinor: status == InstalmentStatus.paid ? 0 : 125050 - paid,
        partial: paid > 0 && status != InstalmentStatus.paid,
        requestId: requestId,
        payment: status == InstalmentStatus.paid ? BillingPayment(paidOn: DateTime(2026, 9, 2), method: BillingMethod.card) : null,
      );

  ParentBilling billing({
    bool cardAvailable = true,
    BankAccount? bank = const BankAccount(
      accountName: 'Jawwid Academy',
      bankName: 'Emirates NBD',
      iban: 'AE070331234567890123456',
      swift: 'EBILAEAD',
      note: "Write the child's name in the reference",
    ),
    bool i2Paid = false,
  }) =>
      ParentBilling(
        today: DateTime(2026, 10, 22),
        paymentMethod: BillingMethod.bankTransfer,
        currency: 'AED',
        planMonths: 3,
        cardAvailable: cardAvailable,
        bankAccount: bank,
        instalments: [
          instalment('i1', status: InstalmentStatus.paid),
          i2Paid
              ? instalment('i2', status: InstalmentStatus.paid)
              : instalment('i2', status: InstalmentStatus.overdue, paid: 50000, requestId: 'r2', days: 21),
          instalment('i3', status: InstalmentStatus.upcoming, days: 10),
        ],
        totals: const [BillingTotal(currency: 'AED', paidMinor: 175050, outstandingMinor: 200100, overdueMinor: 75050)],
        requests: [
          PaymentRequest(
            id: 'r1',
            purpose: RequestPurpose.subscription,
            status: RequestStatus.open,
            label: 'Subscription · 3 months',
            amountMinor: 300000,
            paidMinor: 0,
            remainingMinor: 300000,
            currency: 'AED',
            childName: 'حسن',
            planMonths: 3,
            periodStart: DateTime(2026, 11, 1),
            periodEnd: DateTime(2027, 1, 31),
          ),
          PaymentRequest(
            id: 'r2',
            purpose: RequestPurpose.instalment,
            status: i2Paid ? RequestStatus.paid : RequestStatus.open,
            label: 'Autumn · i2',
            amountMinor: 75050,
            paidMinor: i2Paid ? 75050 : 0,
            remainingMinor: i2Paid ? 0 : 75050,
            currency: 'AED',
            instalmentId: 'i2',
          ),
          const PaymentRequest(
            id: 'r5',
            status: RequestStatus.paid,
            label: 'Registration',
            amountMinor: 20000,
            paidMinor: 20000,
            remainingMinor: 0,
            currency: 'AED',
          ),
        ],
        receipts: [
          PaymentReceipt(
            id: 'rc1',
            status: ReceiptStatus.pending,
            label: 'Autumn · i2',
            amountMinor: 50000,
            currency: 'AED',
            transferredOn: DateTime(2026, 10, 20),
            fileUrl: 'https://api.example/media/payment-receipts/rc1',
          ),
          PaymentReceipt(id: 'rc2', status: ReceiptStatus.approved, label: 'Registration', amountMinor: 20000, currency: 'AED', transferredOn: DateTime(2026, 9, 1)),
          PaymentReceipt(
            id: 'rc3',
            status: ReceiptStatus.rejected,
            label: 'Autumn · i2',
            amountMinor: 75050,
            currency: 'AED',
            transferredOn: DateTime(2026, 10, 19),
            rejectReason: 'The amount does not match',
          ),
        ],
        invoices: [
          BillingInvoice(
            id: 'v1',
            number: 'JW-2026-000101',
            issuedAt: DateTime(2026, 10, 2, 10),
            status: InvoiceStatus.paid,
            amountMinor: 125050,
            currency: 'AED',
            method: BillingMethod.card,
            paidOn: DateTime(2026, 10, 2),
            label: 'Autumn · i1',
            childName: 'سارة',
            planMonths: 3,
          ),
          BillingInvoice(
            id: 'v2',
            number: 'JW-2026-000102',
            issuedAt: DateTime(2026, 9, 1, 10),
            status: InvoiceStatus.refunded,
            amountMinor: 20000,
            refundedMinor: 20000,
            currency: 'AED',
            method: BillingMethod.cash,
            label: 'Registration',
          ),
          BillingInvoice(
            id: 'v3',
            number: 'JW-2026-000103',
            issuedAt: DateTime(2026, 9, 15, 10),
            status: InvoiceStatus.partiallyRefunded,
            amountMinor: 50000,
            refundedMinor: 10000,
            currency: 'AED',
            method: BillingMethod.bankTransfer,
            label: 'Autumn · i2',
          ),
        ],
      );

  late _Repo repo;
  late _Opener opener;
  late _Picker picker;

  setUp(() {
    repo = _Repo(billing());
    opener = _Opener();
    picker = _Picker();
  });

  Widget app({Locale locale = const Locale('en')}) => ProviderScope(
        retry: JawwidRetryPolicy.policy,
        overrides: [
          billingRepositoryProvider.overrideWithValue(repo),
          principalIdProvider.overrideWithValue('p1'),
          attachmentOpenerProvider.overrideWithValue(opener),
          mediaPickerProvider.overrideWithValue(picker),
        ],
        child: MaterialApp(
          locale: locale,
          theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: const MyPaymentsScreen(),
        ),
      );

  Finder within(String key, Finder matching) => find.descendant(of: find.byKey(ValueKey(key)), matching: matching, matchRoot: true);

  Future<void> open(WidgetTester tester, {Locale locale = const Locale('en')}) async {
    tester.view.physicalSize = const Size(1200, 6000);
    tester.view.devicePixelRatio = 1.5;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(app(locale: locale));
    await tester.pumpAndSettle();
  }

  Future<void> tapPay(WidgetTester tester, String key) async {
    await tester.tap(find.byKey(ValueKey('billing-pay-$key')));
    await tester.pumpAndSettle();
  }

  /// The app goes to the browser and comes back.
  Future<void> leaveAndReturn(WidgetTester tester) async {
    for (final s in [
      AppLifecycleState.inactive,
      AppLifecycleState.hidden,
      AppLifecycleState.paused,
      AppLifecycleState.hidden,
      AppLifecycleState.inactive,
      AppLifecycleState.resumed,
    ]) {
      tester.binding.handleAppLifecycleStateChanged(s);
    }
    await tester.pumpAndSettle();
  }

  group('Amount due', () {
    testWidgets('open requests first, then open instalments -- each once, paid ones never', (tester) async {
      await open(tester);

      expect(find.text('Amount due'), findsOneWidget);
      final keys = ['r:r1', 'i:i2', 'i:i3'];
      for (final k in keys) {
        expect(find.byKey(ValueKey('billing-due-$k')), findsOneWidget, reason: k);
      }
      final tops = [for (final k in keys) tester.getTopLeft(find.byKey(ValueKey('billing-due-$k'))).dy];
      expect(tops, orderedEquals([...tops]..sort()));
      // r2 IS instalment i2's request: listed once, as the instalment. r5 and i1 are paid.
      expect(find.byKey(const ValueKey('billing-due-r:r2')), findsNothing);
      expect(find.byKey(const ValueKey('billing-due-r:r5')), findsNothing);
      expect(find.byKey(const ValueKey('billing-due-i:i1')), findsNothing);
    });

    testWidgets('what is left, for whom, for which package and period, and "paid X of Y"', (tester) async {
      await open(tester);

      expect(within('billing-due-r:r1', find.text('Subscription · 3 months')), findsOneWidget);
      expect(within('billing-due-r:r1', find.text('حسن')), findsOneWidget);
      expect(within('billing-due-r:r1', find.text('3-month plan · Nov 1, 2026 – Jan 31, 2027')), findsOneWidget);
      expect(within('billing-due-r:r1', find.text('AED 3,000.00')), findsOneWidget);

      expect(within('billing-due-i:i2', find.text('AED 750.50')), findsOneWidget, reason: 'the remaining amount');
      expect(within('billing-due-i:i2', find.text('Paid AED 500.00 of AED 1,250.50')), findsOneWidget);
      expect(within('billing-due-i:i2', find.text('Due Oct 1, 2026 · 21 days late')), findsOneWidget);
      expect(within('billing-due-i:i3', find.textContaining('Paid ')), findsNothing);
      // The timeline below keeps every instalment, and says the partial too.
      expect(within('billing-instalment-i2', find.text('Paid AED 500.00 of AED 1,250.50')), findsOneWidget);
      expect(within('billing-instalment-i1', find.text('Paid Sep 2, 2026 · Card')), findsOneWidget);
    });

    testWidgets('nothing open: no Amount due section at all', (tester) async {
      repo.answer = ParentBilling(
        cardAvailable: true,
        instalments: [instalment('i1', status: InstalmentStatus.paid)],
      );
      await open(tester);
      expect(find.byKey(const ValueKey('billing-due-section')), findsNothing);
      expect(find.byKey(const ValueKey('billing-receipts-section')), findsNothing);
      expect(find.byKey(const ValueKey('billing-invoices-section')), findsNothing);
    });
  });

  group('the pay sheet', () {
    testWidgets('card is offered only where the academy takes cards', (tester) async {
      repo.answer = billing(cardAvailable: false);
      await open(tester);
      await tapPay(tester, 'r:r1');

      expect(find.text('How would you like to pay?'), findsOneWidget);
      expect(find.byKey(const ValueKey('pay-sheet-amount')), findsOneWidget);
      expect(within('pay-sheet-amount', find.text('AED 3,000.00')), findsOneWidget);
      expect(find.byKey(const ValueKey('pay-by-card')), findsNothing);
      expect(find.text('Pay by card'), findsNothing);
      expect(find.byKey(const ValueKey('pay-by-bank-transfer')), findsOneWidget);
    });

    testWidgets('card: checkout for the request, opened in the browser, then "confirming" until paid', (tester) async {
      await open(tester);
      await tapPay(tester, 'r:r1');
      expect(find.text('Pay by card'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('pay-by-card')));
      await tester.pumpAndSettle();

      expect(repo.checkouts, [('r1', null)]);
      expect(opener.opened, ['https://checkout.stripe.com/c/pay/cs_1']);
      expect(find.text('How would you like to pay?'), findsNothing, reason: 'the sheet closes');
      expect(find.byKey(const ValueKey('billing-confirming-r:r1')), findsOneWidget);
      expect(find.text("We're confirming your payment. This can take a minute."), findsOneWidget);
    });

    testWidgets('an instalment is paid by its id; back from the browser the screen re-reads until it is paid', (tester) async {
      await open(tester);
      await tapPay(tester, 'i:i2');
      await tester.tap(find.byKey(const ValueKey('pay-by-card')));
      await tester.pumpAndSettle();
      expect(repo.checkouts, [(null, 'i2')]);
      expect(find.byKey(const ValueKey('billing-confirming-i:i2')), findsOneWidget);
      final loads = repo.loads;

      // The webhook has not landed yet: still confirming.
      await leaveAndReturn(tester);
      expect(repo.loads, loads + 1);
      expect(find.byKey(const ValueKey('billing-confirming-i:i2')), findsOneWidget);

      // It lands; the next re-read (a few seconds later) finds it paid.
      repo.answer = billing(i2Paid: true);
      await tester.pump(MyPaymentsScreen.confirmPollEvery);
      await tester.pumpAndSettle();
      expect(repo.loads, loads + 2);
      expect(find.byKey(const ValueKey('billing-confirming-i:i2')), findsNothing);
      expect(find.byKey(const ValueKey('billing-due-i:i2')), findsNothing);
      expect(within('billing-instalment-i2', find.text('Paid')), findsOneWidget);

      // Nothing left to confirm: the polling stops.
      await tester.pump(MyPaymentsScreen.confirmPollEvery * 3);
      await tester.pumpAndSettle();
      expect(repo.loads, loads + 2);
    });

    testWidgets('503 COMM.PAYMENTS_UNAVAILABLE is a friendly sentence pointing to bank transfer', (tester) async {
      repo.checkoutError = const AppError(AppErrorKind.server, code: 'COMM.PAYMENTS_UNAVAILABLE');
      await open(tester);
      await tapPay(tester, 'r:r1');
      await tester.tap(find.byKey(const ValueKey('pay-by-card')));
      await tester.pumpAndSettle();

      expect(find.text("Card payment isn't available right now. You can pay by bank transfer."), findsOneWidget);
      expect(find.byKey(const ValueKey('pay-by-bank-transfer')), findsOneWidget, reason: 'the sheet stays open');
      expect(opener.opened, isEmpty);
    });

    testWidgets('409 COMM.BILLING_STATE: already paid -- said so, and the list is re-read', (tester) async {
      repo.checkoutError = const AppError(AppErrorKind.unknown, code: 'COMM.BILLING_STATE');
      await open(tester);
      final loads = repo.loads;
      await tapPay(tester, 'r:r1');
      await tester.tap(find.byKey(const ValueKey('pay-by-card')));
      await tester.pumpAndSettle();

      expect(find.text('This has already been paid or is no longer open. The list has been refreshed.'), findsOneWidget);
      expect(find.text('How would you like to pay?'), findsNothing);
      expect(repo.loads, loads + 1);
    });

    testWidgets('429 (ten checkouts in an hour, COMM.BILLING_STATE) is "too many attempts", not "paid"', (tester) async {
      repo.checkoutError = const AppError(AppErrorKind.rateLimited, code: 'COMM.BILLING_STATE');
      await open(tester);
      final loads = repo.loads;
      await tapPay(tester, 'r:r1');
      await tester.tap(find.byKey(const ValueKey('pay-by-card')));
      await tester.pumpAndSettle();

      expect(within('pay-sheet-error', find.text('Too many attempts. Wait a while, then try again.')), findsOneWidget);
      expect(find.byKey(const ValueKey('pay-by-bank-transfer')), findsOneWidget, reason: 'the sheet stays open');
      expect(repo.loads, loads);
    });

    testWidgets('a browser that would not open is said, not swallowed', (tester) async {
      opener.result = false;
      await open(tester);
      await tapPay(tester, 'r:r1');
      await tester.tap(find.byKey(const ValueKey('pay-by-card')));
      await tester.pumpAndSettle();

      expect(find.text("Couldn't open the page. Try again."), findsOneWidget);
      expect(find.byKey(const ValueKey('billing-confirming-r:r1')), findsNothing);
    });
  });

  group('bank transfer', () {
    Future<void> openTransfer(WidgetTester tester, String key) async {
      await open(tester);
      await tapPay(tester, key);
      await tester.tap(find.byKey(const ValueKey('pay-by-bank-transfer')));
      await tester.pumpAndSettle();
    }

    testWidgets('bank details with Copy, and the amount', (tester) async {
      final copied = <String>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') copied.add((call.arguments as Map)['text'] as String);
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));

      await openTransfer(tester, 'i:i2');

      expect(within('bank-transfer-amount', find.text('AED 750.50')), findsOneWidget);
      expect(within('bank-iban', find.text('AE070331234567890123456')), findsOneWidget);
      expect(within('bank-name', find.text('Jawwid Academy')), findsOneWidget);
      expect(within('bank-bank', find.text('Emirates NBD')), findsOneWidget);
      expect(within('bank-swift', find.text('EBILAEAD')), findsOneWidget);
      expect(find.byKey(const ValueKey('bank-number')), findsNothing, reason: 'not set: not shown');
      expect(find.text("Write the child's name in the reference"), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('bank-copy-iban')));
      await tester.pump();
      expect(copied, ['AE070331234567890123456']);
      expect(find.text('Copied'), findsOneWidget);
    });

    testWidgets('upload: a photo, the amount (prefilled), today, a note -- for the instalment', (tester) async {
      picker.image = const PendingAttachment(filePath: '/tmp/r.png', kind: MessageKind.image, mimeType: 'image/png', byteSize: 2048);
      await openTransfer(tester, 'i:i2');

      final amount = tester.widget<TextField>(find.byKey(const ValueKey('receipt-amount')));
      expect(amount.controller!.text, '750.50', reason: 'prefilled with what is still owed');
      expect(within('receipt-date', find.text('Oct 22, 2026')), findsOneWidget, reason: "the academy's today");

      // Nothing attached yet.
      await tester.tap(find.byKey(const ValueKey('receipt-send')));
      await tester.pumpAndSettle();
      expect(find.text('Attach the receipt first.'), findsOneWidget);
      expect(repo.receipts, isEmpty);

      await tester.tap(find.byKey(const ValueKey('receipt-photo')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('receipt-attached')), findsOneWidget);
      expect(find.text('Photo attached'), findsOneWidget);

      await tester.enterText(find.byKey(const ValueKey('receipt-amount')), '700');
      await tester.enterText(find.byKey(const ValueKey('receipt-note')), 'من حساب الأب');
      final loads = repo.loads;
      await tester.tap(find.byKey(const ValueKey('receipt-send')));
      await tester.pumpAndSettle();

      final sent = repo.receipts.single;
      expect(sent.instalmentId, 'i2');
      expect(sent.requestId, isNull);
      expect(sent.amountMinor, 70000);
      expect(sent.transferredOn, DateTime(2026, 10, 22));
      expect(sent.note, 'من حساب الأب');
      expect(sent.file.mimeType, 'image/png');

      expect(find.byKey(const ValueKey('receipt-send')), findsNothing, reason: 'back on Payments');
      expect(find.text('Receipt sent. The academy will confirm it soon.'), findsOneWidget);
      expect(repo.loads, loads + 1, reason: 'the list is read again');
    });

    testWidgets('a request is named by its id; a PDF is accepted', (tester) async {
      picker.file = const PendingAttachment(
          filePath: '/tmp/r.pdf', kind: MessageKind.file, mimeType: 'application/pdf', byteSize: 4096, fileName: 'transfer.pdf');
      await openTransfer(tester, 'r:r1');

      await tester.tap(find.byKey(const ValueKey('receipt-pdf')));
      await tester.pumpAndSettle();
      expect(find.text('transfer.pdf'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('receipt-send')));
      await tester.pumpAndSettle();

      final sent = repo.receipts.single;
      expect(sent.requestId, 'r1');
      expect(sent.instalmentId, isNull);
      expect(sent.amountMinor, 300000);
      expect(sent.note, isEmpty);
    });

    testWidgets('only JPEG/PNG/WebP/PDF up to 10 MB, checked before any upload', (tester) async {
      picker
        ..image = const PendingAttachment(filePath: '/tmp/r.heic', kind: MessageKind.image, mimeType: 'image/heic', byteSize: 2048)
        ..file = const PendingAttachment(
            filePath: '/tmp/r.pdf', kind: MessageKind.file, mimeType: 'application/pdf', byteSize: 10 * 1024 * 1024 + 1)
        ..cameraError = const MediaPickException(MediaPickFailure.permissionDenied);
      await openTransfer(tester, 'i:i2');

      await tester.tap(find.byKey(const ValueKey('receipt-photo')));
      await tester.pumpAndSettle();
      expect(find.text('Use a JPEG, PNG or WebP image, or a PDF.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('receipt-pdf')));
      await tester.pumpAndSettle();
      expect(find.text('The file is larger than 10 MB.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('receipt-camera')));
      await tester.pumpAndSettle();
      expect(find.text('Allow access in Settings, then try again.'), findsOneWidget);

      picker.file = const PendingAttachment(
          filePath: '/tmp/r.docx', kind: MessageKind.file, mimeType: 'application/msword', byteSize: 100);
      await tester.tap(find.byKey(const ValueKey('receipt-pdf')));
      await tester.pumpAndSettle();
      expect(find.text('Use a JPEG, PNG or WebP image, or a PDF.'), findsOneWidget);
      expect(find.byKey(const ValueKey('receipt-attached')), findsNothing);
      expect(repo.receipts, isEmpty);
    });

    testWidgets('an amount that is not one is refused before sending', (tester) async {
      picker.image = const PendingAttachment(filePath: '/tmp/r.png', kind: MessageKind.image, mimeType: 'image/png', byteSize: 2048);
      await openTransfer(tester, 'i:i2');
      await tester.tap(find.byKey(const ValueKey('receipt-photo')));
      await tester.pumpAndSettle();

      for (final bad in ['', '0', 'abc', '10.505']) {
        await tester.enterText(find.byKey(const ValueKey('receipt-amount')), bad);
        await tester.tap(find.byKey(const ValueKey('receipt-send')));
        await tester.pumpAndSettle();
        expect(find.text('Enter the amount you transferred.'), findsOneWidget, reason: bad);
      }
      expect(repo.receipts, isEmpty);
    });

    testWidgets('409 on send: already paid, or five receipts already waiting -- said in the parent\'s words', (tester) async {
      picker.image = const PendingAttachment(filePath: '/tmp/r.png', kind: MessageKind.image, mimeType: 'image/png', byteSize: 2048);
      repo.receiptError = const AppError(AppErrorKind.unknown, code: 'COMM.BILLING_STATE');
      await openTransfer(tester, 'i:i2');
      await tester.tap(find.byKey(const ValueKey('receipt-photo')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('receipt-send')));
      await tester.pumpAndSettle();

      expect(
          within(
              'receipt-error',
              find.text("This receipt can't be added: the amount is already paid or closed, "
                  'or other receipts are still waiting to be checked.')),
          findsOneWidget);
      expect(find.byKey(const ValueKey('receipt-send')), findsOneWidget, reason: 'the page stays');
    });

    testWidgets('429 on the upload: too many attempts, not "already paid"', (tester) async {
      picker.image = const PendingAttachment(filePath: '/tmp/r.png', kind: MessageKind.image, mimeType: 'image/png', byteSize: 2048);
      repo.receiptError = const AppError(AppErrorKind.rateLimited, code: 'COMMON.RATE_LIMITED');
      await openTransfer(tester, 'i:i2');
      await tester.tap(find.byKey(const ValueKey('receipt-photo')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('receipt-send')));
      await tester.pumpAndSettle();

      expect(within('receipt-error', find.text('Too many attempts. Wait a while, then try again.')), findsOneWidget);
    });

    testWidgets('no bank details yet: told to ask, and may still upload', (tester) async {
      repo.answer = billing(bank: null);
      await openTransfer(tester, 'i:i2');
      expect(find.byKey(const ValueKey('bank-account')), findsNothing);
      expect(find.text("The academy hasn't added its bank details yet. Ask your supervisor for them."), findsOneWidget);
      expect(find.byKey(const ValueKey('receipt-photo')), findsOneWidget);
    });
  });

  group('receipts and invoices', () {
    testWidgets('each receipt with its verdict, and a rejection with its reason', (tester) async {
      await open(tester);

      expect(find.text('Transfer receipts'), findsOneWidget);
      expect(within('billing-receipt-rc1', find.text('Pending verification')), findsOneWidget);
      expect(within('billing-receipt-rc1', find.text('AED 500.00')), findsOneWidget);
      expect(within('billing-receipt-rc1', find.text('Transferred Oct 20, 2026')), findsOneWidget);
      expect(within('billing-receipt-rc2', find.text('Approved')), findsOneWidget);
      expect(within('billing-receipt-rc3', find.text('Rejected')), findsOneWidget);
      expect(within('billing-receipt-rc3', find.text('Reason: The amount does not match')), findsOneWidget);
      expect(within('billing-receipt-rc1', find.textContaining('Reason')), findsNothing);

      await tester.tap(find.byKey(const ValueKey('billing-receipt-rc1')));
      await tester.pumpAndSettle();
      expect(opener.opened, ['https://api.example/media/payment-receipts/rc1']);
    });

    testWidgets('each invoice: number, date, method, status, child and package; Download opens the PDF', (tester) async {
      await open(tester);

      expect(find.text('Invoices'), findsOneWidget);
      expect(within('billing-invoice-v1', find.text('JW-2026-000101')), findsOneWidget);
      expect(within('billing-invoice-v1', find.text('Issued Oct 2, 2026 · Card')), findsOneWidget);
      expect(within('billing-invoice-v1', find.text('Autumn · i1 · سارة')), findsOneWidget);
      expect(within('billing-invoice-v1', find.text('3-month plan')), findsOneWidget);
      expect(within('billing-invoice-v1', find.text('Paid')), findsOneWidget);
      expect(within('billing-invoice-v1', find.text('AED 1,250.50')), findsOneWidget);
      expect(within('billing-invoice-v2', find.text('Refunded')), findsOneWidget);
      expect(within('billing-invoice-v2', find.text('Issued Sep 1, 2026 · Cash')), findsOneWidget);
      expect(within('billing-invoice-v3', find.text('Partially refunded')), findsOneWidget);
      expect(within('billing-invoice-v3', find.text('Refunded AED 100.00')), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('billing-invoice-download-v1')));
      await tester.pumpAndSettle();
      expect(repo.links, ['v1']);
      expect(opener.opened, ['https://api.example/invoices/v1.pdf']);
    });

    testWidgets('a link that cannot be fetched is said', (tester) async {
      repo.linkError = const AppError(AppErrorKind.network);
      await open(tester);
      await tester.tap(find.byKey(const ValueKey('billing-invoice-download-v1')));
      await tester.pumpAndSettle();
      expect(find.byType(SnackBar), findsOneWidget);
      expect(opener.opened, isEmpty);
    });
  });

  group('Arabic', () {
    const ar = Locale('ar');

    testWidgets('the sections, chips and pay sheet, in Arabic', (tester) async {
      await open(tester, locale: ar);

      expect(find.text('المبلغ المستحق'), findsOneWidget);
      expect(find.text('إيصالات التحويل'), findsOneWidget);
      expect(find.text('الفواتير'), findsOneWidget);
      expect(within('billing-due-r:r1', find.text('ادفع')), findsOneWidget);
      expect(within('billing-due-r:r1', find.textContaining('خطة 3 أشهر')), findsOneWidget);
      expect(within('billing-due-i:i2', find.text('دُفع ${formatMoney(50000, 'AED', 'ar')} من ${formatMoney(125050, 'AED', 'ar')}')),
          findsOneWidget);
      expect(within('billing-receipt-rc1', find.text('قيد التحقق')), findsOneWidget);
      expect(within('billing-receipt-rc2', find.text('مقبول')), findsOneWidget);
      expect(within('billing-receipt-rc3', find.text('مرفوض')), findsOneWidget);
      expect(within('billing-receipt-rc3', find.text('السبب: The amount does not match')), findsOneWidget);
      expect(within('billing-invoice-v1', find.text('مدفوع')), findsOneWidget);
      expect(within('billing-invoice-v1', find.textContaining('بطاقة')), findsOneWidget);
      expect(within('billing-invoice-v2', find.text('مُستردّة')), findsOneWidget);
      expect(within('billing-invoice-v3', find.text('مُستردّة جزئيًا')), findsOneWidget);
      expect(tester.widget<Text>(within('billing-invoice-v1', find.text('JW-2026-000101'))).textDirection, TextDirection.ltr);

      await tapPay(tester, 'r:r1');
      expect(find.text('كيف تريد أن تدفع؟'), findsOneWidget);
      expect(find.text('الدفع بالبطاقة'), findsOneWidget);
      expect(within('pay-by-bank-transfer', find.text('تحويل بنكي')), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('pay-by-bank-transfer')));
      await tester.pumpAndSettle();
      expect(find.text('رفع إيصال التحويل'), findsOneWidget);
      expect(find.text('إرسال الإيصال'), findsOneWidget);
      expect(within('bank-iban', find.text('رقم الآيبان (IBAN)')), findsOneWidget);
    });
  });

  group('amounts', () {
    test('typed amounts become exact minor units, in either script', () {
      expect(parseAmountMinor('750.50', 'AED'), 75050);
      expect(parseAmountMinor('1,250.10', 'AED'), 125010);
      expect(parseAmountMinor('٧٥٠٫٥', 'AED'), 75050);
      expect(parseAmountMinor('12.345', 'KWD'), 12345);
      expect(parseAmountMinor('12.3', 'JPY'), isNull);
      expect(parseAmountMinor('0.00', 'AED'), isNull);
      expect(parseAmountMinor('-5', 'AED'), isNull);
      expect(plainAmount(75050, 'AED'), '750.50');
      expect(plainAmount(5, 'AED'), '0.05');
      expect(plainAmount(12345, 'KWD'), '12.345');
      expect(plainAmount(500, 'JPY'), '500');
    });

    test('an instalment with its own open request is one due item, paid by instalment id', () {
      final due = amountsDue(billing());
      expect(due.map((d) => d.key), ['r:r1', 'i:i2', 'i:i3']);
      final i2 = due[1];
      expect(i2.instalmentId, 'i2');
      expect(i2.requestId, isNull);
      expect(i2.remainingMinor, 75050);
      expect(i2.partial, isTrue);
    });
  });
}

class _Repo implements BillingRepository {
  _Repo(this.answer);

  ParentBilling answer;
  int loads = 0;
  final checkouts = <(String?, String?)>[];
  AppError? checkoutError;
  final receipts = <ReceiptDraft>[];
  AppError? receiptError;
  final links = <String>[];
  AppError? linkError;

  @override
  Future<ParentBilling> myBilling() async {
    loads++;
    return answer;
  }

  @override
  Future<String> checkout({String? requestId, String? instalmentId}) async {
    if (checkoutError != null) throw checkoutError!;
    checkouts.add((requestId, instalmentId));
    return 'https://checkout.stripe.com/c/pay/cs_1';
  }

  @override
  Future<ParentBilling> submitReceipt(ReceiptDraft draft) async {
    if (receiptError != null) throw receiptError!;
    receipts.add(draft);
    return answer;
  }

  @override
  Future<String> invoiceLink(String invoiceId) async {
    if (linkError != null) throw linkError!;
    links.add(invoiceId);
    return 'https://api.example/invoices/$invoiceId.pdf';
  }

  @override
  Future<void> requestRenewal(String learnerId) async {}
}

class _Opener implements AttachmentOpener {
  final opened = <String>[];
  bool result = true;

  @override
  Future<bool> open(String url) async {
    if (result) opened.add(url);
    return result;
  }
}

class _Picker implements MediaPicker {
  PendingAttachment? image;
  PendingAttachment? file;
  MediaPickException? cameraError;

  @override
  Future<PendingAttachment?> pickImage() async => image;

  @override
  Future<PendingAttachment?> captureImage() async {
    if (cameraError != null) throw cameraError!;
    return image;
  }

  @override
  Future<PendingAttachment?> pickFile() async => file;
}
