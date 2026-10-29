import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/app/shells/app_shell.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/http/http_billing_repository.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/billing/presentation/my_payments_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/parent_billing.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-30 on the parent's side: the Subscriptions tab, and a card per child above the
/// family's payments -- the plan with its lessons, what is left, the grace lessons, and
/// a locked child's reason with Pay or Request renewal. Never an exception.
void main() {
  Widget localized(Widget home, {Locale locale = const Locale('en')}) => MaterialApp(
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
      );

  group('the parent shell', () {
    Widget shell(UserRole role, FakeBackend backend) => ProviderScope(
          overrides: [
            currentRoleProvider.overrideWithValue(role),
            conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
            messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
          ],
          child: localized(
            AppShell(role: role, currentRoute: '/subscriptions', onDestinationSelected: (_) {}, child: const SizedBox.shrink()),
          ),
        );

    testWidgets('a parent gets Chats · Calls · Subscriptions · Settings, Subscriptions selected', (tester) async {
      final backend = FakeBackend(role: UserRole.parent);
      addTearDown(backend.dispose);
      await tester.pumpWidget(shell(UserRole.parent, backend));
      await tester.pumpAndSettle();

      expect(Shells.forRole(UserRole.parent).map((d) => d.route), ['/chats', '/calls', '/subscriptions', '/settings']);
      expect(find.text('Subscriptions'), findsOneWidget);
      expect(find.text('Payments'), findsNothing);
      expect(tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex, 2);
    });

    testWidgets('in Arabic it is الاشتراكات', (tester) async {
      final backend = FakeBackend(role: UserRole.parent);
      addTearDown(backend.dispose);
      await tester.pumpWidget(ProviderScope(
        overrides: [
          currentRoleProvider.overrideWithValue(UserRole.parent),
          conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
          messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        ],
        child: localized(
          AppShell(role: UserRole.parent, currentRoute: '/chats', onDestinationSelected: (_) {}, child: const SizedBox.shrink()),
          locale: const Locale('ar'),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.text('الاشتراكات'), findsOneWidget);
    });

    testWidgets('a teacher gets no Subscriptions tab, and Sales keeps its Payments', (tester) async {
      // PD-39 (2026-10-29) gave a teacher Boards; never Subscriptions.
      expect(Shells.forRole(UserRole.teacher).map((d) => d.route), ['/chats', '/schedule', '/boards', '/calls', '/settings']);
      expect(Shells.forRole(UserRole.sales).map((d) => d.route), ['/chats', '/calls', '/payments', '/settings']);

      for (final role in [UserRole.teacher, UserRole.sales]) {
        final backend = FakeBackend(role: role);
        addTearDown(backend.dispose);
        await tester.pumpWidget(shell(role, backend));
        await tester.pumpAndSettle();
        expect(find.text('Subscriptions'), findsNothing, reason: role.name);
      }
      expect(find.text('Payments'), findsOneWidget);
    });
  });

  group('GET /me/billing -> subscriptions[]', () {
    test('every field read, and a request carries its lessons', () {
      final b = parseParentBilling({
        'requests': [
          {'id': 'r1', 'amountMinor': 100, 'currency': 'AED', 'status': 'open', 'planMonths': 3, 'lessonsIncluded': 24},
        ],
        'subscriptions': [
          {
            'child': {'id': 'k1', 'name': 'Adam'},
            'current': {'id': 's1', 'planMonths': 3, 'lessonsIncluded': 24, 'startsOn': '2026-09-01'},
            'lessonsIncluded': 24,
            'lessonsUsed': 24,
            'lessonsLeft': 0,
            'graceLeft': 0,
            'state': 'locked',
            'lockReasons': ['balance', 'overdue', 'something_new'],
            'overdue': {'instalmentId': 'i2', 'label': '2/3', 'dueDate': '2026-10-01'},
            'hasOpenPayment': true,
            'renewalRequestedToday': false,
          },
          {'child': {'name': 'no id'}},
        ],
      });

      expect(b.requests.single.lessonsIncluded, 24);
      final s = b.subscriptions.single;
      expect(s.childId, 'k1');
      expect(s.childName, 'Adam');
      expect(s.current!.planMonths, 3);
      expect(s.current!.lessonsIncluded, 24);
      expect(s.current!.startsOn, DateTime(2026, 9, 1));
      expect(s.lessonsLeft, 0);
      expect(s.graceLeft, 0);
      expect(s.state, SubscriptionState.locked);
      expect(s.lockReasons, [LockReason.balance, LockReason.overdue]);
      expect(s.overdue!.label, '2/3');
      expect(s.overdue!.dueDate, DateTime(2026, 10, 1));
      expect(s.hasOpenPayment, isTrue);
    });

    test('an older server sends none: nothing invented', () {
      final b = parseParentBilling({
        'requests': [
          {'id': 'r1', 'amountMinor': 100, 'currency': 'AED', 'status': 'open', 'planMonths': 3},
        ],
      });
      expect(b.subscriptions, isEmpty);
      expect(b.requests.single.lessonsIncluded, isNull);

      final bare = parseParentBilling({
        'subscriptions': [
          {'child': {'id': 'k1', 'name': 'Adam'}, 'current': null, 'state': 'unheard_of'},
        ],
      }).subscriptions.single;
      expect(bare.current, isNull);
      expect(bare.lessonsLeft, isNull);
      expect(bare.state, SubscriptionState.open);
      expect(bare.lockReasons, isEmpty);
      expect(bare.hasOpenPayment, isFalse);
    });
  });

  group('a card per child', () {
    const open = ChildSubscription(
      childId: 'k1',
      childName: 'Adam',
      current: CurrentSubscription(planMonths: 3, lessonsIncluded: 24),
      lessonsIncluded: 24,
      lessonsUsed: 19,
      lessonsLeft: 5,
    );
    const grace2 = ChildSubscription(
      childId: 'k2',
      childName: 'Sara',
      current: CurrentSubscription(planMonths: 1, lessonsIncluded: 8),
      lessonsIncluded: 8,
      lessonsLeft: 0,
      graceLeft: 2,
      state: SubscriptionState.grace,
    );
    const grace1 = ChildSubscription(
      childId: 'k3',
      childName: 'Omar',
      current: CurrentSubscription(planMonths: 1, lessonsIncluded: 8),
      lessonsIncluded: 8,
      lessonsLeft: 0,
      graceLeft: 1,
      state: SubscriptionState.grace,
    );
    const lockedPay = ChildSubscription(
      childId: 'k4',
      childName: 'Huda',
      current: CurrentSubscription(planMonths: 3, lessonsIncluded: 24),
      lessonsIncluded: 24,
      lessonsLeft: 0,
      graceLeft: 0,
      state: SubscriptionState.locked,
      lockReasons: [LockReason.balance],
      hasOpenPayment: true,
    );
    final lockedRenew = ChildSubscription(
      childId: 'k5',
      childName: 'Ali',
      current: const CurrentSubscription(planMonths: 6, lessonsIncluded: 48),
      lessonsIncluded: 48,
      lessonsLeft: 10,
      state: SubscriptionState.locked,
      lockReasons: const [LockReason.overdue],
      overdue: OverdueInstalment(label: '2/3', dueDate: DateTime(2026, 10, 1)),
    );

    final billing = ParentBilling(
      today: DateTime(2026, 10, 26),
      planMonths: 3,
      subscriptions: [open, grace2, grace1, lockedPay, lockedRenew],
      requests: const [
        PaymentRequest(
          id: 'r1',
          label: 'Renewal',
          amountMinor: 90000,
          paidMinor: 0,
          remainingMinor: 90000,
          currency: 'AED',
          status: RequestStatus.open,
          purpose: RequestPurpose.renewal,
          childName: 'Huda',
          planMonths: 3,
          lessonsIncluded: 24,
        ),
      ],
    );

    Widget app(_Billing repo, {Locale locale = const Locale('en'), String? focus}) => ProviderScope(
          retry: JawwidRetryPolicy.policy,
          overrides: [
            billingRepositoryProvider.overrideWithValue(repo),
            principalIdProvider.overrideWithValue('p1'),
          ],
          child: localized(MyPaymentsScreen(focusChildId: focus), locale: locale),
        );

    Finder within(String key, Finder matching) =>
        find.descendant(of: find.byKey(ValueKey(key)), matching: matching, matchRoot: true);

    void tall(WidgetTester tester) {
      tester.view.physicalSize = const Size(1080, 9000);
      addTearDown(tester.view.resetPhysicalSize);
    }

    testWidgets('open: the plan with its lessons, and the lessons left', (tester) async {
      tall(tester);
      await tester.pumpWidget(app(_Billing(billing)));
      await tester.pumpAndSettle();

      expect(find.text('Subscriptions'), findsOneWidget);
      expect(within('subscription-card-k1', find.text('Adam')), findsOneWidget);
      expect(within('subscription-plan-k1', find.text('3 Months — 24 Lessons')), findsOneWidget);
      expect(within('subscription-left-k1', find.text('5 lessons left')), findsOneWidget);
      expect(within('subscription-state-k1', find.text('Active')), findsOneWidget);
      expect(within('subscription-card-k1', find.byType(FilledButton)), findsNothing);
      expect(within('subscription-card-k1', find.byType(OutlinedButton)), findsNothing);
    });

    testWidgets('grace: 2 grace lessons left, then 1 grace lesson left', (tester) async {
      tall(tester);
      await tester.pumpWidget(app(_Billing(billing)));
      await tester.pumpAndSettle();

      expect(within('subscription-plan-k2', find.text('1 Month — 8 Lessons')), findsOneWidget);
      expect(within('subscription-grace-k2', find.text('2 grace lessons left')), findsOneWidget);
      expect(within('subscription-grace-k3', find.text('1 grace lesson left')), findsOneWidget);
      expect(within('subscription-state-k2', find.text('Renewal due')), findsOneWidget);
      // Grace is not locked: nothing to pay or renew from the card yet.
      expect(find.byKey(const ValueKey('subscription-pay-k2')), findsNothing);
      expect(find.byKey(const ValueKey('subscription-renew-k2')), findsNothing);
    });

    testWidgets('locked with something to pay: the reason and Pay, which goes to Amount due', (tester) async {
      await tester.pumpWidget(app(_Billing(billing)));
      await tester.pumpAndSettle();

      expect(within('subscription-card-k4', find.text('Lessons used up')), findsOneWidget);
      expect(within('subscription-state-k4', find.text('Paused')), findsOneWidget);
      expect(find.byKey(const ValueKey('subscription-renew-k4')), findsNothing);

      final pay = find.byKey(const ValueKey('subscription-pay-k4'));
      await tester.ensureVisible(pay);
      await tester.pumpAndSettle();
      await tester.tap(pay);
      await tester.pumpAndSettle();

      // The open renewal, with its lessons beside its length.
      final due = find.byKey(const ValueKey('billing-due-section'));
      expect(due, findsOneWidget);
      expect(due.hitTestable(), findsOneWidget);
      expect(within('billing-due-r:r1', find.text('3 Months — 24 Lessons')), findsOneWidget);
    });

    testWidgets('locked with nothing to pay: why, and Request renewal (201)', (tester) async {
      tall(tester);
      final repo = _Billing(billing);
      await tester.pumpWidget(app(repo));
      await tester.pumpAndSettle();

      // Overdue from the day after the due date.
      expect(within('subscription-card-k5', find.text('Instalment 2/3 overdue since Oct 2, 2026')), findsOneWidget);
      expect(find.byKey(const ValueKey('subscription-pay-k5')), findsNothing);

      await tester.tap(find.byKey(const ValueKey('subscription-renew-k5')));
      await tester.pumpAndSettle();

      expect(repo.renewals, ['k5']);
      expect(find.byKey(const ValueKey('subscription-renew-k5')), findsNothing);
      expect(within('subscription-renewal-requested-k5', find.text('Renewal requested')), findsOneWidget);
    });

    testWidgets('a second request the same day (409 SUBSCRIPTION_STATE) reads as requested', (tester) async {
      tall(tester);
      final repo = _Billing(billing)
        ..renewError = const AppError(AppErrorKind.validation, code: BillingErrors.subscriptionState);
      await tester.pumpWidget(app(repo));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('subscription-renew-k5')));
      await tester.pumpAndSettle();

      expect(find.byType(SnackBar), findsNothing);
      expect(within('subscription-renewal-requested-k5', find.text('Renewal requested')), findsOneWidget);
    });

    testWidgets('already requested today: said from the start, nothing to tap', (tester) async {
      tall(tester);
      final asked = ParentBilling(subscriptions: [
        ChildSubscription(
          childId: 'k5',
          childName: 'Ali',
          state: SubscriptionState.locked,
          lockReasons: const [LockReason.overdue],
          overdue: OverdueInstalment(label: '2/3', dueDate: DateTime(2026, 10, 1)),
          renewalRequestedToday: true,
        ),
      ]);
      await tester.pumpWidget(app(_Billing(asked)));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('subscription-renew-k5')), findsNothing);
      final requested = tester.widget<ButtonStyleButton>(
        find.descendant(of: find.byKey(const ValueKey('subscription-renewal-requested-k5')), matching: find.byWidgetPredicate((w) => w is ButtonStyleButton), matchRoot: true),
      );
      expect(requested.onPressed, isNull);
      expect(find.text('Renewal requested'), findsOneWidget);
      // No subscription on record.
      expect(within('subscription-plan-k5', find.text('No subscription yet')), findsOneWidget);
    });

    testWidgets('nothing about an exception is ever drawn', (tester) async {
      tall(tester);
      await tester.pumpWidget(app(_Billing(billing)));
      await tester.pumpAndSettle();
      expect(find.textContaining(RegExp('xception|استثناء')), findsNothing);
    });

    testWidgets('in Arabic: plural agreement', (tester) async {
      tall(tester);
      await tester.pumpWidget(app(_Billing(billing), locale: const Locale('ar')));
      await tester.pumpAndSettle();

      expect(find.text('الاشتراكات'), findsOneWidget);
      expect(within('subscription-plan-k1', find.text('3 أشهر — 24 حصة')), findsOneWidget);
      expect(within('subscription-left-k1', find.text('بقيت 5 حصص')), findsOneWidget);
      expect(within('subscription-plan-k2', find.text('شهر واحد — 8 حصص')), findsOneWidget);
      expect(within('subscription-grace-k2', find.text('تبقّت حصتا سماح')), findsOneWidget);
      expect(within('subscription-grace-k3', find.text('تبقّت حصة سماح واحدة')), findsOneWidget);
      expect(within('subscription-card-k4', find.text('انتهت الحصص')), findsOneWidget);
      expect(within('subscription-card-k5', find.text('طلب التجديد')), findsOneWidget);
    });

    testWidgets('opened at a child (the locked banner): that card is outlined', (tester) async {
      await tester.pumpWidget(app(_Billing(billing), focus: 'k5'));
      await tester.pumpAndSettle();

      final card = tester.widget<Card>(find.byKey(const ValueKey('subscription-card-k5')));
      expect(card.shape, isA<RoundedRectangleBorder>());
      // Scrolled to: the last card is on screen, well below the first page.
      expect(find.byKey(const ValueKey('subscription-card-k5')).hitTestable(), findsOneWidget);
      // Only that one is outlined.
      expect(tester.widget<Card>(find.byKey(const ValueKey('subscription-card-k4'))).shape, isNull);
    });
  });
}

class _Billing implements BillingRepository {
  _Billing(this.answer);

  final ParentBilling answer;
  final renewals = <String>[];
  AppError? renewError;

  @override
  Future<ParentBilling> myBilling() async => answer;

  @override
  Future<String> checkout({String? requestId, String? instalmentId}) => throw UnimplementedError();

  @override
  Future<ParentBilling> submitReceipt(ReceiptDraft draft) => throw UnimplementedError();

  @override
  Future<String> invoiceLink(String invoiceId) => throw UnimplementedError();

  @override
  Future<void> requestRenewal(String learnerId) async {
    if (renewError != null) throw renewError!;
    renewals.add(learnerId);
  }
}
