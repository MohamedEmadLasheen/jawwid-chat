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
import 'package:jawwid_chat/core/media/media_picker.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/billing/domain/amount_due.dart';
import 'package:jawwid_chat/features/billing/domain/review_mode.dart';
import 'package:jawwid_chat/features/billing/presentation/bank_transfer_screen.dart';
import 'package:jawwid_chat/features/billing/presentation/my_payments_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/parent_billing.dart';

/// OA-12 (owner, 2026-11-10): the App Review payment mode, as the app shows it. The
/// server decides and enforces it (apps/api/src/billing/review-mode.ts); the app says
/// so on the pay sheet and the bank-transfer page, and never offers Send there.
void main() {
  const demoBank = BankAccount(
    accountName: 'Demo bank details for App Review: no transfer is possible',
    bankName: 'Demo bank (App Review)',
    accountNumber: 'DEMO-0000-0000',
  );

  PaymentRequest demo() => const PaymentRequest(
        id: reviewDemoRequestId,
        purpose: RequestPurpose.subscription,
        payableInApp: true,
        status: RequestStatus.open,
        label: 'Lesson package (demo): 8 live one-to-one lessons',
        amountMinor: 8000,
        paidMinor: 0,
        remainingMinor: 8000,
        currency: 'USD',
        childName: 'Yahya',
        planMonths: 1,
        lessonsIncluded: 8,
      );

  PaymentRequest real() => const PaymentRequest(
        id: 'r1',
        purpose: RequestPurpose.subscription,
        payableInApp: true,
        status: RequestStatus.open,
        label: 'Subscription · 3 months',
        amountMinor: 300000,
        paidMinor: 0,
        remainingMinor: 300000,
        currency: 'AED',
        childName: 'حسن',
        planMonths: 3,
      );

  ParentBilling reviewBilling() => ParentBilling(
        today: DateTime(2026, 11, 10),
        cardAvailable: true,
        bankAccount: demoBank,
        requests: [demo()],
      );

  ParentBilling publicBilling() => ParentBilling(
        today: DateTime(2026, 11, 10),
        cardAvailable: true,
        bankAccount: const BankAccount(accountName: 'Jawwid Academy', iban: 'AE070331234567890123456'),
        requests: [real()],
      );

  late _Repo repo;
  late _Opener opener;
  late _Picker picker;

  setUp(() {
    repo = _Repo(reviewBilling());
    opener = _Opener();
    picker = _Picker();
  });

  Widget app({Locale locale = const Locale('en'), Widget home = const MyPaymentsScreen()}) => ProviderScope(
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
          home: home,
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

  Future<void> openPaySheet(WidgetTester tester, String key) async {
    await tester.tap(find.byKey(ValueKey('billing-pay-$key')));
    await tester.pumpAndSettle();
  }

  Future<void> openTransfer(WidgetTester tester, String key, {Locale locale = const Locale('en')}) async {
    await open(tester, locale: locale);
    await openPaySheet(tester, key);
    await tester.tap(find.byKey(const ValueKey('pay-by-bank-transfer')));
    await tester.pumpAndSettle();
  }

  FilledButton send(WidgetTester tester) => tester.widget<FilledButton>(find.byKey(const ValueKey('receipt-send')));

  const enPayNotice =
      'App Review demo account: no real payment can be made. Card opens a page that explains the live card checkout, and bank transfer shows demo details only.';
  const enTransferNotice =
      'App Review demo account: these bank details are not real. No transfer can be made and no receipt can be sent from this account.';
  const arPayNotice =
      'حساب تجريبي لمراجعة المتجر: لا يمكن إجراء أي دفع حقيقي. خيار البطاقة يفتح صفحة تشرح الدفع الفعلي بالبطاقة، والتحويل البنكي يعرض بيانات تجريبية فقط.';
  const arTransferNotice =
      'حساب تجريبي لمراجعة المتجر: هذه البيانات البنكية ليست حقيقية. لا يمكن إجراء أي تحويل ولا إرسال أي إيصال من هذا الحساب.';

  group('detection', () {
    test('review mode only with the server\'s synthetic demo item', () {
      expect(isReviewMode(reviewBilling()), isTrue);
      expect(isReviewMode(publicBilling()), isFalse);
      expect(isReviewMode(ParentBilling.empty), isFalse);
    });

    test('the server\'s refusal is recognised by its code AND its reviewMode detail', () {
      expect(isReviewModeRefusal(const AppError(AppErrorKind.forbidden, code: 'COMM.BILLING_DENIED', detail: {'reviewMode': true})), isTrue);
      expect(isReviewModeRefusal(const AppError(AppErrorKind.forbidden, code: 'COMM.BILLING_DENIED')), isFalse);
      expect(isReviewModeRefusal(const AppError(AppErrorKind.unknown, code: 'COMM.BILLING_STATE', detail: {'reviewMode': true})), isFalse);
    });
  });

  group('the App Review demo family', () {
    testWidgets('the demo amount due can be opened; the pay sheet says it is a demo (EN)', (tester) async {
      await open(tester);
      expect(find.byKey(const ValueKey('billing-due-r:$reviewDemoRequestId')), findsOneWidget);
      await openPaySheet(tester, 'r:$reviewDemoRequestId');
      expect(within('pay-sheet-review-mode', find.text(enPayNotice)), findsOneWidget);
      expect(find.byKey(const ValueKey('pay-by-card')), findsOneWidget, reason: 'card opens the server\'s demo page');
      expect(find.byKey(const ValueKey('pay-by-bank-transfer')), findsOneWidget);
    });

    testWidgets('card opens what the server answers, and is not left "confirming"', (tester) async {
      repo.checkoutUrl = 'https://api.example/api/v1/pay/review-demo?lang=en';
      await open(tester);
      await openPaySheet(tester, 'r:$reviewDemoRequestId');
      await tester.tap(find.byKey(const ValueKey('pay-by-card')));
      await tester.pumpAndSettle();
      expect(opener.opened, ['https://api.example/api/v1/pay/review-demo?lang=en']);
      expect(repo.checkouts, [(reviewDemoRequestId, null)]);
      expect(find.text("We're confirming your payment. This can take a minute."), findsNothing);
    });

    testWidgets('bank transfer: the notice, the demo details, and Send is off (EN)', (tester) async {
      picker.image = const PendingAttachment(filePath: '/tmp/r.png', kind: MessageKind.image, mimeType: 'image/png', byteSize: 2048);
      await openTransfer(tester, 'r:$reviewDemoRequestId');

      expect(within('review-mode-notice', find.text(enTransferNotice)), findsOneWidget);
      expect(within('bank-name', find.text('Demo bank details for App Review: no transfer is possible')), findsOneWidget);
      expect(send(tester).onPressed, isNull);

      // Even with a file attached, nothing can be sent.
      await tester.tap(find.byKey(const ValueKey('receipt-photo')));
      await tester.pumpAndSettle();
      expect(send(tester).onPressed, isNull);
      await tester.tap(find.byKey(const ValueKey('receipt-send')), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(repo.receipts, isEmpty);
    });

    testWidgets('the notices in Arabic', (tester) async {
      await open(tester, locale: const Locale('ar'));
      await openPaySheet(tester, 'r:$reviewDemoRequestId');
      expect(within('pay-sheet-review-mode', find.text(arPayNotice)), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('pay-by-bank-transfer')));
      await tester.pumpAndSettle();
      expect(within('review-mode-notice', find.text(arTransferNotice)), findsOneWidget);
      expect(send(tester).onPressed, isNull);
    });

    testWidgets('the server\'s refusal is said as the demo notice, not as a generic error', (tester) async {
      tester.view.physicalSize = const Size(1200, 6000);
      tester.view.devicePixelRatio = 1.5;
      addTearDown(tester.view.reset);
      picker.image = const PendingAttachment(filePath: '/tmp/r.png', kind: MessageKind.image, mimeType: 'image/png', byteSize: 2048);
      repo.receiptError = const AppError(AppErrorKind.forbidden, code: 'COMM.BILLING_DENIED', detail: {'reviewMode': true});
      // A build that did not know it was a demo (reviewMode false) still says the right thing.
      final item = amountsDue(reviewBilling()).single;
      await tester.pumpWidget(app(home: BankTransferScreen(item: item, bankAccount: demoBank, today: DateTime(2026, 11, 10))));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('receipt-photo')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('receipt-send')));
      await tester.pumpAndSettle();
      expect(within('receipt-error', find.text(enTransferNotice)), findsOneWidget);
    });
  });

  group('a public family is unchanged', () {
    testWidgets('no notice anywhere, and Send is offered', (tester) async {
      repo.answer = publicBilling();
      await open(tester);
      await openPaySheet(tester, 'r:r1');
      expect(find.byKey(const ValueKey('pay-sheet-review-mode')), findsNothing);
      expect(find.text(enPayNotice), findsNothing);
      await tester.tap(find.byKey(const ValueKey('pay-by-bank-transfer')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('review-mode-notice')), findsNothing);
      expect(find.text(enTransferNotice), findsNothing);
      expect(send(tester).onPressed, isNotNull);
    });
  });
}

class _Repo implements BillingRepository {
  _Repo(this.answer);

  ParentBilling answer;
  final checkouts = <(String?, String?)>[];
  String checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_1';
  final receipts = <ReceiptDraft>[];
  AppError? receiptError;

  @override
  Future<ParentBilling> myBilling() async => answer;

  @override
  Future<String> checkout({String? requestId, String? instalmentId}) async {
    checkouts.add((requestId, instalmentId));
    return checkoutUrl;
  }

  @override
  Future<ParentBilling> submitReceipt(ReceiptDraft draft) async {
    if (receiptError != null) throw receiptError!;
    receipts.add(draft);
    return answer;
  }

  @override
  Future<String> invoiceLink(String invoiceId) async => 'https://api.example/invoices/$invoiceId.pdf';

  @override
  Future<void> requestRenewal(String learnerId) async {}
}

class _Opener implements AttachmentOpener {
  final opened = <String>[];

  @override
  Future<bool> open(String url) async {
    opened.add(url);
    return true;
  }
}

class _Picker implements MediaPicker {
  PendingAttachment? image;

  @override
  Future<PendingAttachment?> pickVideo() async => null;

  @override
  Future<PendingAttachment?> recordVideo() async => null;

  @override
  Future<PendingAttachment?> pickImage() async => image;

  @override
  Future<PendingAttachment?> captureImage() async => image;

  @override
  Future<PendingAttachment?> pickFile() async => null;
}
