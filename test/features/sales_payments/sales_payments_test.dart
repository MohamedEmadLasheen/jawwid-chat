import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/app/router.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/billing/domain/money_format.dart';
import 'package:jawwid_chat/features/sales_payments/data/sales_payments_repository.dart';
import 'package:jawwid_chat/features/sales_payments/domain/sales_billing.dart';
import 'package:jawwid_chat/features/sales_payments/presentation/family_billing_screen.dart';
import 'package:jawwid_chat/features/sales_payments/presentation/sales_payments_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/parent_billing.dart';

/// PD-20 on the client: Sales' Payments tab. The server's answers are stubbed by a
/// recording repository; the client is held to drawing exactly what it is given, sending
/// exactly what was entered, and showing the server's answer after every write.
void main() {
  final today = DateTime(2026, 10, 22);

  SalesInstalment instalment(String id, SalesInstalmentStatus status, {String? child, SalesPayment? payment, SalesVoid? voided, int? days}) =>
      SalesInstalment(
        id: id,
        label: 'Autumn term · $id',
        childName: child,
        amountMinor: 125050,
        currency: 'AED',
        dueDate: DateTime(2026, 10, 1),
        status: status,
        days: days,
        payment: payment,
        voided: voided,
      );

  FamilyBilling family({bool canRecord = true, List<SalesInstalment>? instalments}) => FamilyBilling(
        familyId: 'f1',
        today: today,
        paymentMethod: BillingMethod.bankTransfer,
        currency: 'AED',
        planMonths: 3,
        canRecord: canRecord,
        instalments: instalments ??
            [
              instalment('i1', SalesInstalmentStatus.paid,
                  child: 'سارة',
                  payment: SalesPayment(paidOn: DateTime(2026, 10, 20), method: BillingMethod.invoice, reference: 'INV-7', recordedByName: 'خديجة')),
              instalment('i2', SalesInstalmentStatus.overdue, child: 'سارة', days: 21),
              instalment('i3', SalesInstalmentStatus.voided, voided: const SalesVoid(reason: 'duplicate', byName: 'حسن')),
              instalment('i4', SalesInstalmentStatus.upcoming, child: 'حسن', days: 10),
            ],
        totals: const [BillingTotal(currency: 'AED', paidMinor: 125050, outstandingMinor: 250100, overdueMinor: 125050)],
      );

  Widget app(Widget home, _Payments repo, {Locale locale = const Locale('en')}) => ProviderScope(
        retry: JawwidRetryPolicy.policy,
        overrides: [
          salesPaymentsRepositoryProvider.overrideWithValue(repo),
          principalIdProvider.overrideWithValue('u_sales'),
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

  void tall(WidgetTester tester) {
    tester.view.physicalSize = const Size(1200, 5000);
    addTearDown(tester.view.resetPhysicalSize);
  }

  group('search', () {
    const hits = ParentSearchResult(items: [
      ParentSearchHit(id: 'c1', name: 'حسن', familyId: 'f1', familyName: 'آل حسن', childrenCount: 2),
      ParentSearchHit(id: 'c2', name: 'سارة', familyId: 'f2', familyName: 'آل سارة', childrenCount: 1),
    ], truncated: true);

    testWidgets('lists parents with their family and children; typing is debounced into one search', (tester) async {
      final repo = _Payments()..search = hits;
      await tester.pumpWidget(app(const SalesPaymentsScreen(), repo));
      await tester.pumpAndSettle();

      expect(repo.queries, [''], reason: 'the first page, before anything is typed');
      expect(find.text('حسن'), findsOneWidget);
      expect(find.text('آل حسن · 2 children'), findsOneWidget);
      expect(find.text('آل سارة · 1 child'), findsOneWidget);
      expect(find.text('Showing the first results. Type more to narrow the search.'), findsOneWidget);

      final field = find.byKey(const ValueKey('sales-payments-search'));
      await tester.enterText(field, 'ح');
      await tester.pump(const Duration(milliseconds: 100));
      await tester.enterText(field, 'حس');
      await tester.pump(const Duration(milliseconds: 100));
      await tester.enterText(field, 'حسن ');
      await tester.pump(SalesPaymentsScreen.debounce);
      await tester.pumpAndSettle();

      expect(repo.queries, ['', 'حسن']);
    });

    testWidgets('nothing found says so; Arabic too', (tester) async {
      await tester.pumpWidget(app(const SalesPaymentsScreen(), _Payments()));
      await tester.pumpAndSettle();
      expect(find.text('No parents found'), findsOneWidget);

      await tester.pumpWidget(app(const SalesPaymentsScreen(), _Payments()..search = hits, locale: const Locale('ar')));
      await tester.pumpAndSettle();
      expect(find.text('المدفوعات'), findsOneWidget);
      expect(find.text('آل حسن · ابنان'), findsOneWidget);
      expect(find.text('آل سارة · ابن واحد'), findsOneWidget);
    });

    testWidgets('a refusal is a sentence, asked once', (tester) async {
      final repo = _Payments()..searchError = const AppError(AppErrorKind.forbidden, code: 'COMM.PARENT_RECORD_DENIED');
      await tester.pumpWidget(app(const SalesPaymentsScreen(), repo));
      await tester.pumpAndSettle();
      expect(find.text('Payments are not available for your account.'), findsOneWidget);
      expect(repo.queries.length, 1);
    });

    testWidgets("tapping a parent opens that family's billing", (tester) async {
      final repo = _Payments()
        ..search = hits
        ..billing = family();
      final router = GoRouter(routes: [
        GoRoute(path: '/', builder: (context, state) => const SalesPaymentsScreen()),
        GoRoute(
          path: '${Routes.salesPayments}/families/:familyId',
          builder: (context, state) => FamilyBillingScreen(familyId: state.pathParameters['familyId']!, familyName: state.extra as String?),
        ),
      ]);
      addTearDown(router.dispose);
      await tester.pumpWidget(ProviderScope(
        retry: JawwidRetryPolicy.policy,
        overrides: [salesPaymentsRepositoryProvider.overrideWithValue(repo), principalIdProvider.overrideWithValue('u_sales')],
        child: MaterialApp.router(
          routerConfig: router,
          locale: const Locale('en'),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        ),
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('حسن'));
      await tester.pumpAndSettle();

      expect(router.state.uri.path, '/payments/families/f1');
      expect(repo.familiesRead, ['f1']);
      expect(find.text('آل حسن'), findsOneWidget, reason: 'the family is the title');
      expect(find.text('3-month plan'), findsOneWidget);
    });
  });

  group("a family's billing", () {
    testWidgets('summary and the timeline, in the server\'s order (English)', (tester) async {
      tall(tester);
      await tester.pumpWidget(app(const FamilyBillingScreen(familyId: 'f1', familyName: 'آل حسن'), _Payments()..billing = family()));
      await tester.pumpAndSettle();

      expect(within('sales-billing-plan', find.text('3-month plan')), findsOneWidget);
      expect(within('sales-billing-method', find.text('Bank transfer')), findsOneWidget);
      expect(within('sales-billing-currency', find.text('AED')), findsOneWidget);
      expect(within('sales-billing-paid-AED', find.text('AED 1,250.50')), findsOneWidget);
      expect(within('sales-billing-outstanding-AED', find.text('AED 2,501.00')), findsOneWidget);
      expect(within('sales-billing-overdue-AED', find.text('AED 1,250.50')), findsOneWidget);

      final tops = [for (final id in ['i1', 'i2', 'i3', 'i4']) tester.getTopLeft(find.byKey(ValueKey('sales-instalment-$id'))).dy];
      expect(tops, orderedEquals([...tops]..sort()));

      expect(within('sales-instalment-i1', find.text('Paid')), findsOneWidget);
      expect(within('sales-instalment-i1', find.text('Paid Oct 20, 2026 · Invoice · recorded by خديجة · INV-7')), findsOneWidget);
      expect(within('sales-instalment-i2', find.text('Overdue')), findsOneWidget);
      expect(within('sales-instalment-i2', find.text('Due Oct 1, 2026 · 21 days late')), findsOneWidget);
      expect(within('sales-instalment-i3', find.text('Voided')), findsOneWidget);
      expect(within('sales-instalment-i3', find.text('Voided by حسن: duplicate')), findsOneWidget);
      expect(within('sales-instalment-i3', find.text('Family')), findsOneWidget);
      expect(within('sales-instalment-i4', find.text('Upcoming')), findsOneWidget);

      // A voided amount is struck through, not hidden; a live one is not.
      final voided = tester.widget<Text>(find.byKey(const ValueKey('sales-instalment-amount-i3')));
      expect(voided.style?.decoration, TextDecoration.lineThrough);
      final open = tester.widget<Text>(find.byKey(const ValueKey('sales-instalment-amount-i2')));
      expect(open.style?.decoration, isNot(TextDecoration.lineThrough));

      // Record on OPEN rows only; Void on every row not yet voided.
      expect(find.byKey(const ValueKey('sales-record-i1')), findsNothing);
      expect(find.byKey(const ValueKey('sales-record-i2')), findsOneWidget);
      expect(find.byKey(const ValueKey('sales-record-i3')), findsNothing);
      expect(find.byKey(const ValueKey('sales-record-i4')), findsOneWidget);
      expect(find.byKey(const ValueKey('sales-void-i1')), findsOneWidget);
      expect(find.byKey(const ValueKey('sales-void-i3')), findsNothing);
    });

    testWidgets('no write affordance when the server says canRecord: false', (tester) async {
      tall(tester);
      await tester.pumpWidget(app(const FamilyBillingScreen(familyId: 'f1'), _Payments()..billing = family(canRecord: false)));
      await tester.pumpAndSettle();
      expect(find.text('Record payment'), findsNothing);
      expect(find.text('Void'), findsNothing);
    });

    testWidgets('the same in Arabic', (tester) async {
      tall(tester);
      await tester.pumpWidget(app(const FamilyBillingScreen(familyId: 'f1'), _Payments()..billing = family(), locale: const Locale('ar')));
      await tester.pumpAndSettle();

      expect(within('sales-billing-plan', find.text('خطة 3 أشهر')), findsOneWidget);
      expect(within('sales-billing-method', find.text('تحويل بنكي')), findsOneWidget);
      expect(within('sales-billing-paid-AED', find.text(formatMoney(125050, 'AED', 'ar'))), findsOneWidget);
      expect(within('sales-instalment-i3', find.text('ملغى')), findsOneWidget);
      expect(within('sales-instalment-i3', find.text('ألغاه حسن: duplicate')), findsOneWidget);
      expect(within('sales-instalment-i1', find.textContaining('سجّله خديجة')), findsOneWidget);
      expect(within('sales-instalment-i2', find.text('تسجيل دفعة')), findsOneWidget);
    });

    testWidgets('record a payment: today and the family\'s method by default; the answer replaces the list', (tester) async {
      tall(tester);
      final paid = family(instalments: [
        instalment('i2', SalesInstalmentStatus.paid,
            payment: SalesPayment(paidOn: today, method: BillingMethod.bankTransfer, reference: 'TR-9', recordedByName: 'فريق المبيعات')),
      ]);
      final repo = _Payments()
        ..billing = family()
        ..answer = paid;
      await tester.pumpWidget(app(const FamilyBillingScreen(familyId: 'f1'), repo));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('sales-record-i2')));
      await tester.pumpAndSettle();

      expect(within('sales-record-date', find.text('Oct 22, 2026')), findsOneWidget);
      final method = tester.widget<SegmentedButton<BillingMethod>>(find.byKey(const ValueKey('sales-record-method')));
      expect(method.selected, {BillingMethod.bankTransfer});

      // The date can be no later than the academy's today.
      await tester.tap(find.byKey(const ValueKey('sales-record-date')));
      await tester.pumpAndSettle();
      expect(tester.widget<DatePickerDialog>(find.byType(DatePickerDialog)).lastDate, today);
      await tester.tap(find.text('Cancel').last);
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const ValueKey('sales-record-reference')), 'TR-9');
      await tester.tap(find.byKey(const ValueKey('sales-record-save')));
      await tester.pumpAndSettle();

      expect(repo.recorded, [('i2', today, BillingMethod.bankTransfer, 'TR-9')]);
      expect(find.text('Paid Oct 22, 2026 · Bank transfer · recorded by فريق المبيعات · TR-9'), findsOneWidget);
      expect(find.byKey(const ValueKey('sales-instalment-i4')), findsNothing, reason: "the server's answer, not a local patch");
      expect(repo.familiesRead, ['f1'], reason: 'the write answered the body; no second read');
    });

    testWidgets('void: a reason is required, the sheet says it is final, the answer replaces the list', (tester) async {
      tall(tester);
      final repo = _Payments()
        ..billing = family()
        ..answer = family(instalments: [instalment('i2', SalesInstalmentStatus.voided, voided: const SalesVoid(reason: 'wrong plan', byName: 'فريق المبيعات'))]);
      await tester.pumpWidget(app(const FamilyBillingScreen(familyId: 'f1'), repo));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('sales-void-i2')));
      await tester.pumpAndSettle();

      expect(find.text('Voiding is final: the instalment can no longer be paid.'), findsOneWidget);
      final confirm = find.byKey(const ValueKey('sales-void-confirm'));
      expect(tester.widget<FilledButton>(confirm).onPressed, isNull, reason: 'no reason, no void');

      await tester.enterText(find.byKey(const ValueKey('sales-void-reason')), 'wrong plan');
      await tester.pump();
      expect(tester.widget<FilledButton>(confirm).onPressed, isNotNull);
      await tester.tap(confirm);
      await tester.pumpAndSettle();

      expect(repo.voided, [('i2', 'wrong plan')]);
      expect(find.text('Voided by فريق المبيعات: wrong plan'), findsOneWidget);
    });

    testWidgets('409: already paid or voided -- said so, and the list is read again', (tester) async {
      tall(tester);
      final repo = _Payments()
        ..billing = family()
        ..writeError = const AppError(AppErrorKind.unknown, code: 'COMM.BILLING_STATE');
      await tester.pumpWidget(app(const FamilyBillingScreen(familyId: 'f1'), repo));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('sales-record-i2')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('sales-record-save')));
      await tester.pumpAndSettle();

      expect(find.text('This instalment was already paid or voided. The list has been refreshed.'), findsOneWidget);
      expect(repo.familiesRead, ['f1', 'f1']);
    });

    testWidgets('400: the sheet stays open and says what to check', (tester) async {
      tall(tester);
      final repo = _Payments()
        ..billing = family()
        ..writeError = const AppError(AppErrorKind.validation, code: 'VALIDATION');
      await tester.pumpWidget(app(const FamilyBillingScreen(familyId: 'f1'), repo));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('sales-record-i2')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('sales-record-save')));
      await tester.pumpAndSettle();

      expect(find.text('Check the date and the reference, then try again.'), findsOneWidget);
      expect(find.byKey(const ValueKey('sales-record-save')), findsOneWidget);
    });
  });
}

/// Records every call; answers what it is given.
class _Payments implements SalesPaymentsRepository {
  ParentSearchResult search = const ParentSearchResult();
  AppError? searchError;
  FamilyBilling? billing;
  FamilyBilling? answer;
  AppError? writeError;

  final queries = <String>[];
  final familiesRead = <String>[];
  final recorded = <(String, DateTime, BillingMethod, String?)>[];
  final voided = <(String, String)>[];

  @override
  Future<ParentSearchResult> searchParents(String query) async {
    queries.add(query);
    if (searchError != null) throw searchError!;
    return search;
  }

  @override
  Future<FamilyBilling> familyBilling(String familyId) async {
    familiesRead.add(familyId);
    return billing!;
  }

  @override
  Future<FamilyBilling> recordPayment(String instalmentId, {required DateTime paidOn, required BillingMethod method, String? reference}) async {
    if (writeError != null) throw writeError!;
    recorded.add((instalmentId, paidOn, method, reference));
    return answer!;
  }

  @override
  Future<FamilyBilling> voidInstalment(String instalmentId, {required String reason}) async {
    if (writeError != null) throw writeError!;
    voided.add((instalmentId, reason));
    return answer!;
  }
}
