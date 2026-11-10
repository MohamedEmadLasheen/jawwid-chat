import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/media/attachment_opener.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/billing/domain/amount_due.dart';
import 'package:jawwid_chat/features/billing/presentation/my_payments_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/parent_billing.dart';

/// W61 S2: a card while a bank-transfer receipt is waiting for the academy. The pay sheet
/// says a card too may charge twice; when the waiting receipts cover what is left, the
/// card waits for the academy's decision (the server refuses it, 409 receipt_pending).
void main() {
  const enNotice = 'A transfer receipt for this request is waiting for the academy to check. Paying by card too may charge you twice.';
  const enPaused = 'Card payment will be available again if the academy cannot confirm the transfer.';
  const arNotice = 'يوجد إيصال تحويل لهذا الطلب بانتظار مراجعة الأكاديمية. إن دفعت بالبطاقة أيضًا فقد يُخصم المبلغ مرتين.';
  const arPaused = 'سيُتاح الدفع بالبطاقة مجددًا إذا تعذّر على الأكاديمية تأكيد التحويل.';

  group('the wording', () {
    test('English and Arabic, as the API\'s /pay page words it', () {
      final en = lookupL10n(const Locale('en'));
      final ar = lookupL10n(const Locale('ar'));
      expect(en.billingReceiptPendingNotice, enNotice);
      expect(en.billingReceiptPendingCardPaused, enPaused);
      expect(ar.billingReceiptPendingNotice, arNotice);
      expect(ar.billingReceiptPendingCardPaused, arPaused);
    });
  });

  group('what is pending on a due item', () {
    test('only pending receipts of its own request, in its currency; an instalment counts its request\'s', () {
      final due = {
        for (final d in amountsDue(billing(receipts: [
          receipt('a', 'r1', 100000),
          receipt('b', 'r1', 50000),
          receipt('c', 'r1', 300000, status: ReceiptStatus.rejected),
          receipt('d', 'r1', 300000, status: ReceiptStatus.approved),
          receipt('e', 'r1', 300000, currency: 'USD'),
          receipt('f', 'r2', 75050),
        ])))
          d.key: d,
      };
      expect(due['r:r1']!.pendingReceiptMinor, 150000);
      expect(due['r:r1']!.receiptPending, isTrue);
      expect(due['r:r1']!.receiptCoversRemaining, isFalse);
      expect(due['i:i2']!.pendingReceiptMinor, 75050);
      expect(due['i:i2']!.receiptCoversRemaining, isTrue);
    });

    test('none waiting: nothing pending', () {
      final d = amountsDue(billing()).firstWhere((d) => d.key == 'r:r1');
      expect(d.pendingReceiptMinor, 0);
      expect(d.receiptPending, isFalse);
      expect(d.receiptCoversRemaining, isFalse);
    });
  });

  late _Repo repo;

  setUp(() => repo = _Repo(billing()));

  Widget app(Locale locale) => ProviderScope(
        retry: JawwidRetryPolicy.policy,
        overrides: [
          billingRepositoryProvider.overrideWithValue(repo),
          principalIdProvider.overrideWithValue('p1'),
          attachmentOpenerProvider.overrideWithValue(_Opener()),
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

  Future<void> openSheet(WidgetTester tester, String itemKey, {Locale locale = const Locale('en')}) async {
    tester.view.physicalSize = const Size(1200, 6000);
    tester.view.devicePixelRatio = 1.5;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(app(locale));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(ValueKey('billing-pay-$itemKey')));
    await tester.pumpAndSettle();
  }

  ListTile cardOption(WidgetTester tester) => tester.widget<ListTile>(find.byKey(const ValueKey('pay-by-card')));

  group('the pay sheet', () {
    testWidgets('a receipt covering part: the notice, and the card still offered', (tester) async {
      repo.answer = billing(receipts: [receipt('a', 'r1', 100000)]);
      await openSheet(tester, 'r:r1');
      expect(within('pay-sheet-receipt-pending', find.text(enNotice)), findsOneWidget);
      expect(find.textContaining(enPaused), findsNothing);
      expect(cardOption(tester).onTap, isNotNull);

      await tester.tap(find.byKey(const ValueKey('pay-by-card')));
      await tester.pumpAndSettle();
      expect(repo.checkouts, 1);
    });

    testWidgets('in Arabic', (tester) async {
      repo.answer = billing(receipts: [receipt('a', 'r1', 100000)]);
      await openSheet(tester, 'r:r1', locale: const Locale('ar'));
      expect(within('pay-sheet-receipt-pending', find.text(arNotice)), findsOneWidget);
      expect(cardOption(tester).onTap, isNotNull);
    });

    testWidgets('receipts covering what is left: the notice says the card waits, and the card cannot be tapped', (tester) async {
      repo.answer = billing(receipts: [receipt('a', 'r1', 200000), receipt('b', 'r1', 100000)]);
      await openSheet(tester, 'r:r1');
      expect(within('pay-sheet-receipt-pending', find.text('$enNotice $enPaused')), findsOneWidget);
      expect(cardOption(tester).onTap, isNull);
      expect(find.byKey(const ValueKey('pay-by-bank-transfer')), findsOneWidget);
    });

    testWidgets('covering, in Arabic; an instalment reads its own request\'s receipts', (tester) async {
      repo.answer = billing(receipts: [receipt('f', 'r2', 75050)]);
      await openSheet(tester, 'i:i2', locale: const Locale('ar'));
      expect(within('pay-sheet-receipt-pending', find.text('$arNotice $arPaused')), findsOneWidget);
      expect(cardOption(tester).onTap, isNull);
    });

    testWidgets('no receipt waiting: no notice', (tester) async {
      await openSheet(tester, 'r:r1');
      expect(find.byKey(const ValueKey('pay-sheet-receipt-pending')), findsNothing);
      expect(find.textContaining(enNotice), findsNothing);
    });

    testWidgets('the server refuses with receipt_pending (a receipt sent since the list was read): said in the sheet, not "no longer open"', (tester) async {
      repo.refusal = const AppError(
        AppErrorKind.validation,
        code: BillingErrors.state,
        detail: {'reason': 'receipt_pending', 'pendingMinor': 300000, 'remainingMinor': 300000},
      );
      await openSheet(tester, 'r:r1');
      await tester.tap(find.byKey(const ValueKey('pay-by-card')));
      await tester.pumpAndSettle();
      expect(within('pay-sheet-error', find.text('$enNotice $enPaused')), findsOneWidget);
      expect(find.byKey(const ValueKey('pay-by-card')), findsOneWidget, reason: 'the sheet stays open');
      expect(find.text(lookupL10n(const Locale('en')).billingNoLongerOpen), findsNothing);
      // After the refusal the card cannot be tapped again (no repeat refused requests).
      expect(cardOption(tester).onTap, isNull);
      expect(repo.checkouts, 1);
    });

    testWidgets('no card offered (Stripe off): no notice about a card', (tester) async {
      repo.answer = billing(receipts: [receipt('a', 'r1', 300000)], cardAvailable: false);
      await openSheet(tester, 'r:r1');
      expect(find.byKey(const ValueKey('pay-by-card')), findsNothing);
      expect(find.byKey(const ValueKey('pay-sheet-receipt-pending')), findsNothing);
      expect(find.textContaining(enNotice), findsNothing);
      expect(find.byKey(const ValueKey('pay-by-bank-transfer')), findsOneWidget);
    });
  });
}

PaymentReceipt receipt(String id, String requestId, int amountMinor, {ReceiptStatus status = ReceiptStatus.pending, String currency = 'AED'}) =>
    PaymentReceipt(
      id: id,
      status: status,
      requestId: requestId,
      label: 'Receipt $id',
      amountMinor: amountMinor,
      currency: currency,
      transferredOn: DateTime(2026, 10, 20),
    );

ParentBilling billing({List<PaymentReceipt> receipts = const [], bool cardAvailable = true}) => ParentBilling(
      today: DateTime(2026, 11, 2),
      currency: 'AED',
      cardAvailable: cardAvailable,
      instalments: [
        BillingInstalment(
          id: 'i2',
          label: 'Autumn · i2',
          amountMinor: 75050,
          currency: 'AED',
          dueDate: DateTime(2026, 11, 1),
          status: InstalmentStatus.overdue,
          days: 1,
          remainingMinor: 75050,
          requestId: 'r2',
          payableInApp: true,
        ),
      ],
      requests: const [
        PaymentRequest(
          id: 'r1',
          purpose: RequestPurpose.subscription,
          payableInApp: true,
          status: RequestStatus.open,
          label: 'Subscription · 3 months',
          amountMinor: 300000,
          paidMinor: 0,
          remainingMinor: 300000,
          currency: 'AED',
        ),
        PaymentRequest(
          id: 'r2',
          purpose: RequestPurpose.instalment,
          payableInApp: true,
          status: RequestStatus.open,
          label: 'Autumn · i2',
          amountMinor: 75050,
          paidMinor: 0,
          remainingMinor: 75050,
          currency: 'AED',
          instalmentId: 'i2',
        ),
      ],
      receipts: receipts,
    );

class _Repo implements BillingRepository {
  _Repo(this.answer);

  ParentBilling answer;
  AppError? refusal;
  var checkouts = 0;

  @override
  Future<ParentBilling> myBilling() async => answer;

  @override
  Future<String> checkout({String? requestId, String? instalmentId}) async {
    checkouts++;
    final r = refusal;
    if (r != null) throw r;
    return 'https://checkout.stripe.com/c/pay/cs_1';
  }

  @override
  Future<ParentBilling> submitReceipt(ReceiptDraft draft) async => answer;

  @override
  Future<String> invoiceLink(String invoiceId) async => 'https://api.example/invoices/$invoiceId.pdf';

  @override
  Future<void> requestRenewal(String learnerId) async {}
}

class _Opener implements AttachmentOpener {
  @override
  Future<bool> open(String url) async => true;
}
