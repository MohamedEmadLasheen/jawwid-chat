import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/media/attachment_opener.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/billing/domain/amount_due.dart';
import 'package:jawwid_chat/features/billing/domain/card_failure.dart';
import 'package:jawwid_chat/features/billing/presentation/my_payments_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/parent_billing.dart';

/// PD-27 completion on the parent's Payments screen: why the last card attempt on an
/// open payment failed (Stripe's code, worded as apps/api card-failure.ts words it), and
/// the card an invoice was paid with. The server is a fake; the client is held to the
/// API's wording, and to never repeating an alarming bank reason.
void main() {
  final en = lookupL10n(const Locale('en'));
  final ar = lookupL10n(const Locale('ar'));

  const enLead = 'Your last card payment did not go through:';
  const enNext = 'Try another card, or pay by bank transfer.';
  const arLead = 'لم تنجح آخر محاولة للدفع بالبطاقة:';
  const arNext = 'جرّبوا بطاقة أخرى أو ادفعوا بالتحويل البنكي.';

  // Exactly the API's table (apps/api/src/billing/card-failure.ts), code by code.
  const enReason = {
    'insufficient_funds': 'your bank declined it for insufficient funds.',
    'expired_card': 'the card has expired.',
    'incorrect_cvc': 'the security code (CVC) was incorrect.',
    'invalid_cvc': 'the security code (CVC) was incorrect.',
    'incorrect_number': 'the card number was incorrect.',
    'invalid_number': 'the card number was incorrect.',
    'authentication_required': "your bank's verification (3D Secure) was not completed.",
    'payment_intent_authentication_failure': "your bank's verification (3D Secure) was not completed.",
    'processing_error': 'there was an error processing the card.',
    'generic_decline': 'your bank declined the card.',
    'stolen_card': 'your bank declined the card.',
    'lost_card': 'your bank declined the card.',
    'fraudulent': 'your bank declined the card.',
    'pickup_card': 'your bank declined the card.',
    'something_new': 'your bank declined the card.',
  };
  const arReason = {
    'insufficient_funds': 'رفض البنك الدفع لعدم كفاية الرصيد.',
    'expired_card': 'البطاقة منتهية الصلاحية.',
    'incorrect_cvc': 'رمز التحقق (CVC) غير صحيح.',
    'invalid_cvc': 'رمز التحقق (CVC) غير صحيح.',
    'incorrect_number': 'رقم البطاقة غير صحيح.',
    'invalid_number': 'رقم البطاقة غير صحيح.',
    'authentication_required': 'لم يكتمل تحقق البنك (3D Secure).',
    'payment_intent_authentication_failure': 'لم يكتمل تحقق البنك (3D Secure).',
    'processing_error': 'حدث خطأ أثناء معالجة البطاقة.',
    'generic_decline': 'رفض البنك الدفع بالبطاقة.',
    'stolen_card': 'رفض البنك الدفع بالبطاقة.',
    'lost_card': 'رفض البنك الدفع بالبطاقة.',
    'fraudulent': 'رفض البنك الدفع بالبطاقة.',
    'pickup_card': 'رفض البنك الدفع بالبطاقة.',
    'something_new': 'رفض البنك الدفع بالبطاقة.',
  };

  group('the wording', () {
    test('each code reads as the API words it: lead, reason, next step -- in English and Arabic', () {
      for (final code in enReason.keys) {
        expect(cardFailureText(code, en), '$enLead ${enReason[code]} $enNext', reason: code);
        expect(cardFailureText(code, ar), '$arLead ${arReason[code]} $arNext', reason: code);
      }
    });

    test('an alarming bank reason is a plain decline: never stolen, lost or fraud', () {
      for (final code in ['stolen_card', 'lost_card', 'fraudulent', 'merchant_blacklist', 'pickup_card']) {
        expect(cardFailureKind(code), CardFailureKind.declined, reason: code);
        for (final l10n in [en, ar]) {
          final text = cardFailureText(code, l10n).toLowerCase();
          for (final word in ['stolen', 'lost', 'fraud', 'مسروق', 'مفقود', 'احتيال']) {
            expect(text, isNot(contains(word)), reason: '$code: $word');
          }
        }
      }
    });

    test('the card: brand, last four and wallet; an unknown brand is "Card"', () {
      expect(cardLabel(const PaymentCard(brand: 'visa', last4: '4242'), en), 'Visa •••• 4242');
      expect(cardLabel(const PaymentCard(brand: 'mastercard', last4: '4444', wallet: 'apple_pay'), en), 'Mastercard •••• 4444 · Apple Pay');
      expect(cardLabel(const PaymentCard(brand: 'amex', wallet: 'google_pay'), en), 'American Express · Google Pay');
      expect(cardLabel(const PaymentCard(brand: 'visa'), en), 'Visa');
      expect(cardLabel(const PaymentCard(brand: 'something_new', last4: '0005'), en), 'Card •••• 0005');
      expect(cardLabel(const PaymentCard(brand: 'something_new', last4: '0005'), ar), 'بطاقة •••• 0005');
      expect(cardLabel(const PaymentCard(brand: 'visa', last4: '4242', wallet: 'apple_pay'), ar), 'Visa •••• 4242 · Apple Pay');
      expect(cardLabel(const PaymentCard(last4: '4242', wallet: 'masterpass'), en), 'Card •••• 4242', reason: 'an unnamed wallet is left out');
      expect(cardLabel(const PaymentCard(brand: 'unknown'), en), isNull, reason: 'nothing worth showing');
      expect(cardLabel(null, en), isNull);
    });

    test('a due item carries its request\'s failure, standalone or merged into its instalment', () {
      final due = amountsDue(billing(r1: 'insufficient_funds', r2: 'expired_card'));
      expect({for (final d in due) d.key: d.lastCardFailure?.code}, {'r:r1': 'insufficient_funds', 'i:i2': 'expired_card'});
    });
  });

  late _Repo repo;
  late _Opener opener;

  setUp(() {
    repo = _Repo(billing(r1: 'insufficient_funds'));
    opener = _Opener();
  });

  Widget app(Locale locale) => ProviderScope(
        retry: JawwidRetryPolicy.policy,
        overrides: [
          billingRepositoryProvider.overrideWithValue(repo),
          principalIdProvider.overrideWithValue('p1'),
          attachmentOpenerProvider.overrideWithValue(opener),
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
    await tester.pumpWidget(app(locale));
    await tester.pumpAndSettle();
  }

  group('the banner', () {
    testWidgets('on the open payment whose card attempt failed, with the reason and the next step', (tester) async {
      await open(tester);
      expect(within('billing-card-failure-r:r1', find.text('$enLead ${enReason['insufficient_funds']} $enNext')), findsOneWidget);
      expect(find.byKey(const ValueKey('billing-card-failure-i:i2')), findsNothing, reason: 'its request has no failure');
    });

    testWidgets('in Arabic', (tester) async {
      repo.answer = billing(r1: 'expired_card', r2: 'incorrect_cvc');
      await open(tester, locale: const Locale('ar'));
      expect(within('billing-card-failure-r:r1', find.text('$arLead ${arReason['expired_card']} $arNext')), findsOneWidget);
      expect(within('billing-card-failure-i:i2', find.text('$arLead ${arReason['incorrect_cvc']} $arNext')), findsOneWidget,
          reason: 'an instalment shows its own request\'s failure');
    });

    testWidgets('a stolen_card code reads as a plain decline, in both languages', (tester) async {
      repo.answer = billing(r1: 'stolen_card');
      await open(tester);
      expect(within('billing-card-failure-r:r1', find.text('$enLead ${enReason['generic_decline']} $enNext')), findsOneWidget);
      expect(find.textContaining('stolen'), findsNothing);

      await open(tester, locale: const Locale('ar'));
      expect(within('billing-card-failure-r:r1', find.text('$arLead ${arReason['generic_decline']} $arNext')), findsOneWidget);
    });

    testWidgets('no failure: no banner anywhere', (tester) async {
      repo.answer = billing();
      await open(tester);
      expect(find.byKey(const ValueKey('billing-card-failure-r:r1')), findsNothing);
      expect(find.byKey(const ValueKey('billing-card-failure-i:i2')), findsNothing);
      expect(find.textContaining(enLead), findsNothing);
    });

    testWidgets('said again in the pay sheet, where the parent picks how to pay next', (tester) async {
      await open(tester);
      await tester.tap(find.byKey(const ValueKey('billing-pay-r:r1')));
      await tester.pumpAndSettle();
      expect(within('pay-sheet-card-failure', find.text('$enLead ${enReason['insufficient_funds']} $enNext')), findsOneWidget);
    });

    testWidgets('while a new checkout is confirming it is hidden; a new failure ends confirming and says why', (tester) async {
      await open(tester);
      await tester.tap(find.byKey(const ValueKey('billing-pay-r:r1')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('pay-by-card')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('billing-confirming-r:r1')), findsOneWidget);
      expect(find.byKey(const ValueKey('billing-card-failure-r:r1')), findsNothing, reason: 'about the attempt before this one');

      // Re-read with the same old failure: still confirming.
      await _resume(tester);
      expect(find.byKey(const ValueKey('billing-confirming-r:r1')), findsOneWidget);

      // The new attempt is declined.
      repo.answer = billing(r1: 'expired_card', r1At: DateTime.utc(2026, 11, 2, 10, 5));
      await tester.pump(MyPaymentsScreen.confirmPollEvery);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('billing-confirming-r:r1')), findsNothing);
      expect(within('billing-card-failure-r:r1', find.text('$enLead ${enReason['expired_card']} $enNext')), findsOneWidget);

      // Nothing left to confirm: the polling stops.
      await tester.pump(MyPaymentsScreen.confirmPollEvery * 2);
      await tester.pumpAndSettle();
    });
  });

  group('the card on an invoice', () {
    testWidgets('brand, last four and wallet; nothing for an invoice without a card', (tester) async {
      await open(tester);
      expect(within('billing-invoice-card-v1', find.text('Visa •••• 4242 · Apple Pay')), findsOneWidget);
      expect(find.byKey(const ValueKey('billing-invoice-card-v2')), findsNothing);
    });

    testWidgets('in Arabic, laid out left to right as it is written', (tester) async {
      await open(tester, locale: const Locale('ar'));
      final label = tester.widget<Text>(within('billing-invoice-card-v1', find.text('Visa •••• 4242 · Apple Pay')));
      expect(label.textDirection, TextDirection.ltr);
    });
  });
}

ParentBilling billing({String? r1, DateTime? r1At, String? r2}) => ParentBilling(
      today: DateTime(2026, 11, 2),
      currency: 'AED',
      cardAvailable: true,
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
      requests: [
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
          lastCardFailure: r1 == null ? null : CardFailure(code: r1, at: r1At ?? DateTime.utc(2026, 11, 2, 9, 30)),
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
          lastCardFailure: r2 == null ? null : CardFailure(code: r2, at: DateTime.utc(2026, 11, 2, 9, 40)),
        ),
      ],
      invoices: [
        BillingInvoice(
          id: 'v1',
          number: 'JW-2026-000201',
          issuedAt: DateTime(2026, 10, 2, 10),
          status: InvoiceStatus.paid,
          amountMinor: 125050,
          currency: 'AED',
          method: BillingMethod.card,
          label: 'Autumn · i1',
          card: const PaymentCard(brand: 'visa', last4: '4242', wallet: 'apple_pay'),
        ),
        BillingInvoice(
          id: 'v2',
          number: 'JW-2026-000202',
          issuedAt: DateTime(2026, 9, 1, 10),
          status: InvoiceStatus.paid,
          amountMinor: 20000,
          currency: 'AED',
          method: BillingMethod.bankTransfer,
          label: 'Registration',
        ),
      ],
    );

/// The app goes to the browser and comes back.
Future<void> _resume(WidgetTester tester) async {
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

class _Repo implements BillingRepository {
  _Repo(this.answer);

  ParentBilling answer;

  @override
  Future<ParentBilling> myBilling() async => answer;

  @override
  Future<String> checkout({String? requestId, String? instalmentId}) async => 'https://checkout.stripe.com/c/pay/cs_1';

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
