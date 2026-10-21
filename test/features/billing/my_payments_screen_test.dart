import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/billing/domain/money_format.dart';
import 'package:jawwid_chat/features/billing/presentation/my_payments_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/parent_billing.dart';

/// PD-17 on the client: a parent's own Payments. The server's answer is stubbed; the
/// client is held to drawing exactly what it is given, in the order it is given, and
/// to a calm sentence -- not a retry loop -- for a parent who does not hold billing.
void main() {
  final billing = ParentBilling(
    today: DateTime(2026, 10, 21),
    paymentMethod: BillingMethod.bankTransfer,
    currency: 'AED',
    planMonths: 3,
    instalments: [
      BillingInstalment(
        id: 'i1',
        label: 'Autumn term · 1/3',
        childName: 'سارة',
        amountMinor: 125050,
        currency: 'AED',
        dueDate: DateTime(2026, 9, 1),
        status: InstalmentStatus.paid,
        payment: BillingPayment(paidOn: DateTime(2026, 9, 2), method: BillingMethod.invoice, reference: 'INV-7'),
      ),
      BillingInstalment(
        id: 'i2',
        label: 'Autumn term · 2/3',
        childName: 'سارة',
        amountMinor: 125050,
        currency: 'AED',
        dueDate: DateTime(2026, 10, 1),
        status: InstalmentStatus.overdue,
        days: 20,
      ),
      BillingInstalment(
        id: 'i3',
        label: 'Registration',
        amountMinor: 50000,
        currency: 'AED',
        dueDate: DateTime(2026, 10, 21),
        status: InstalmentStatus.due,
        days: 0,
      ),
      BillingInstalment(
        id: 'i4',
        label: 'Autumn term · 3/3',
        childName: 'حسن',
        amountMinor: 125050,
        currency: 'AED',
        dueDate: DateTime(2026, 11, 1),
        status: InstalmentStatus.upcoming,
        days: 11,
      ),
    ],
    totals: const [BillingTotal(currency: 'AED', paidMinor: 125050, outstandingMinor: 300100, overdueMinor: 125050)],
  );

  Widget app(_Billing repo, {Locale locale = const Locale('en'), Duration? Function(int, Object)? retry}) {
    return ProviderScope(
      // The app's own policy: a refusal is terminal, so a 403 is asked exactly once.
      retry: retry ?? JawwidRetryPolicy.policy,
      overrides: [
        billingRepositoryProvider.overrideWithValue(repo),
        principalIdProvider.overrideWithValue('p1'),
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
  }

  Finder within(String key, Finder matching) => find.descendant(of: find.byKey(ValueKey(key)), matching: matching, matchRoot: true);

  group('Payments (English)', () {
    testWidgets('the summary: plan, method, and paid / outstanding / overdue', (tester) async {
      await tester.pumpWidget(app(_Billing()..answer = billing));
      await tester.pumpAndSettle();

      expect(find.text('Payments'), findsOneWidget);
      expect(within('billing-plan', find.text('3-month plan')), findsOneWidget);
      expect(within('billing-method', find.text('Bank transfer')), findsOneWidget);
      expect(within('billing-paid-AED', find.text('AED 1,250.50')), findsOneWidget);
      expect(within('billing-outstanding-AED', find.text('AED 3,001.00')), findsOneWidget);
      expect(within('billing-overdue-AED', find.text('of which overdue')), findsOneWidget);
      expect(within('billing-overdue-AED', find.text('AED 1,250.50')), findsOneWidget);
    });

    testWidgets('every instalment, in the order the server sent them', (tester) async {
      tester.view.physicalSize = const Size(1080, 4000);
      addTearDown(tester.view.resetPhysicalSize);
      await tester.pumpWidget(app(_Billing()..answer = billing));
      await tester.pumpAndSettle();

      final tops = [
        for (final id in ['i1', 'i2', 'i3', 'i4']) tester.getTopLeft(find.byKey(ValueKey('billing-instalment-$id'))).dy,
      ];
      expect(tops, orderedEquals([...tops]..sort()));

      expect(within('billing-instalment-i1', find.text('Paid')), findsOneWidget);
      expect(within('billing-instalment-i2', find.text('Overdue')), findsOneWidget);
      expect(within('billing-instalment-i3', find.text('Due today')), findsOneWidget);
      expect(within('billing-instalment-i4', find.text('Upcoming')), findsOneWidget);

      expect(within('billing-instalment-i2', find.text('Autumn term · 2/3')), findsOneWidget);
      expect(within('billing-instalment-i2', find.text('سارة')), findsOneWidget);
      expect(within('billing-instalment-i2', find.text('AED 1,250.50')), findsOneWidget);
      expect(within('billing-instalment-i2', find.text('Due Oct 1, 2026 · 20 days late')), findsOneWidget);
      expect(within('billing-instalment-i3', find.text('Family')), findsOneWidget);
      expect(within('billing-instalment-i3', find.text('Due Oct 21, 2026')), findsOneWidget);
      expect(within('billing-instalment-i4', find.text('Due Nov 1, 2026 · in 11 days')), findsOneWidget);
    });

    testWidgets('a paid instalment says when and how, with its reference', (tester) async {
      await tester.pumpWidget(app(_Billing()..answer = billing));
      await tester.pumpAndSettle();

      expect(within('billing-instalment-i1', find.text('Paid Sep 2, 2026 · Invoice · INV-7')), findsOneWidget);
      expect(within('billing-instalment-i2', find.textContaining('Paid ')), findsNothing);
    });

    testWidgets('nothing billed yet: "No plan" and "No payments yet"', (tester) async {
      await tester.pumpWidget(app(_Billing()..answer = ParentBilling.empty));
      await tester.pumpAndSettle();

      expect(within('billing-plan', find.text('No plan')), findsOneWidget);
      expect(within('billing-method', find.text('Not set')), findsOneWidget);
      expect(find.text('No payments yet'), findsOneWidget);
    });

    testWidgets('a parent who does not hold billing (403) gets a sentence, asked once', (tester) async {
      final repo = _Billing(); // no answer: 403 COMM.BILLING_DENIED
      await tester.pumpWidget(app(repo));
      await tester.pumpAndSettle();

      expect(find.text('Payments are managed by the parent responsible for billing'), findsOneWidget);
      expect(find.byIcon(Icons.refresh), findsNothing);
      expect(repo.calls, 1, reason: 'a refusal is never retried');
    });

    testWidgets('pull to refresh asks again and keeps the list on screen', (tester) async {
      final repo = _Billing()..answer = ParentBilling.empty;
      await tester.pumpWidget(app(repo));
      await tester.pumpAndSettle();
      expect(find.text('No payments yet'), findsOneWidget);

      repo.answer = billing;
      await tester.fling(find.byType(ListView), const Offset(0, 400), 1000);
      await tester.pumpAndSettle();

      expect(repo.calls, 2);
      expect(find.text('3-month plan'), findsOneWidget);
    });

    testWidgets('a network failure offers a retry', (tester) async {
      final repo = _Billing()..failWith = const AppError(AppErrorKind.network);
      await tester.pumpWidget(app(repo, retry: (_, _) => null));
      await tester.pumpAndSettle();
      expect(find.byIcon(Icons.refresh), findsOneWidget);

      repo
        ..failWith = null
        ..answer = billing;
      await tester.tap(find.byIcon(Icons.refresh));
      await tester.pumpAndSettle();
      expect(find.text('3-month plan'), findsOneWidget);
    });
  });

  group('Payments (Arabic)', () {
    const ar = Locale('ar');

    testWidgets('the summary and the rows, in Arabic', (tester) async {
      tester.view.physicalSize = const Size(1080, 4000);
      addTearDown(tester.view.resetPhysicalSize);
      await tester.pumpWidget(app(_Billing()..answer = billing, locale: ar));
      await tester.pumpAndSettle();

      expect(find.text('المدفوعات'), findsOneWidget);
      expect(within('billing-plan', find.text('خطة 3 أشهر')), findsOneWidget);
      expect(within('billing-method', find.text('تحويل بنكي')), findsOneWidget);
      expect(within('billing-paid-AED', find.text(formatMoney(125050, 'AED', 'ar'))), findsOneWidget);
      expect(within('billing-instalment-i1', find.text('مدفوع')), findsOneWidget);
      expect(within('billing-instalment-i2', find.text('متأخر')), findsOneWidget);
      expect(within('billing-instalment-i2', find.textContaining('متأخر 20 يومًا')), findsOneWidget);
      expect(within('billing-instalment-i3', find.text('مستحق اليوم')), findsOneWidget);
      expect(within('billing-instalment-i3', find.text('العائلة')), findsOneWidget);
      expect(within('billing-instalment-i4', find.text('قادم')), findsOneWidget);
      expect(within('billing-instalment-i1', find.textContaining('دُفع في')), findsOneWidget);
      expect(within('billing-instalment-i1', find.textContaining('فاتورة · INV-7')), findsOneWidget);
    });

    testWidgets('empty and refused, in Arabic', (tester) async {
      await tester.pumpWidget(app(_Billing()..answer = ParentBilling.empty, locale: ar));
      await tester.pumpAndSettle();
      expect(find.text('لا توجد مدفوعات بعد'), findsOneWidget);
      expect(find.text('لا توجد خطة'), findsOneWidget);

      await tester.pumpWidget(app(_Billing(), locale: ar));
      await tester.pumpAndSettle();
      expect(find.text('يتابع المدفوعات وليّ الأمر المسؤول عن الدفع'), findsOneWidget);
    });
  });

  group('money', () {
    test("decimals follow the currency's minor unit, not the locale", () {
      expect(formatMoney(125050, 'AED', 'en'), 'AED 1,250.50');
      expect(formatMoney(125050, 'KWD', 'en'), 'KWD 125.050');
      expect(formatMoney(125050, 'JPY', 'en'), 'JPY 125,050');
      expect(formatMoney(5, 'USD', 'en'), 'USD 0.05');
      expect(formatMoney(125050, 'AED', 'ar'), contains('1,250.50'));
      expect(formatMoney(125050, 'AED', 'ar'), contains('AED'));
    });

    test('Western digits in Arabic, per DD-09', () {
      expect(RegExp(r'[٠-٩]').hasMatch(formatMoney(125050, 'AED', 'ar')), isFalse);
    });
  });
}

/// Only `myBilling`; a null [answer] refuses as the server does (403 COMM.BILLING_DENIED).
class _Billing implements BillingRepository {
  ParentBilling? answer;
  AppError? failWith;
  int calls = 0;

  @override
  Future<ParentBilling> myBilling() async {
    calls++;
    if (failWith != null) throw failWith!;
    return answer ?? (throw const AppError(AppErrorKind.forbidden, code: 'COMM.BILLING_DENIED'));
  }
}
