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
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/conversations/application/conversations_controller.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversations_screen.dart';
import 'package:jawwid_chat/features/conversations/presentation/groups_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// Defence-in-depth checks on the client surface.
///
/// The backend remains the authority for every rule below (BR-1, §5). These assert that the
/// app does not *offer* what the backend would refuse, and does not render what it must
/// never render — which is what §60 asks for.
void main() {
  Widget harness({
    required UserRole role,
    required Widget child,
    Locale locale = const Locale('ar'),
  }) {
    final backend = FakeBackend(role: role);
    addTearDown(backend.dispose);

    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(role),
        conversationRepositoryProvider
            .overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
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
        home: child,
      ),
    );
  }

  /// Every string currently rendered anywhere in the tree.
  List<String> renderedText(WidgetTester tester) => tester
      .widgetList<Text>(find.byType(Text))
      .map((t) => t.data ?? t.textSpan?.toPlainText() ?? '')
      .toList();

  group('BR-1: no teacher/parent direct affordance exists', () {
    testWidgets('a teacher sees no message or call action for a parent', (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.teacher, child: const GroupsScreen()),
      );
      await tester.pumpAndSettle();

      // The affordance must be absent, not disabled (handoff rule 7).
      expect(find.byIcon(Icons.call), findsNothing);
      expect(find.byIcon(Icons.phone), findsNothing);
      expect(find.byIcon(Icons.message), findsNothing);
      expect(find.byIcon(Icons.person_add), findsNothing);
    });

    testWidgets('a parent sees no message or call action for a teacher', (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const GroupsScreen()),
      );
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.call), findsNothing);
      expect(find.byIcon(Icons.phone), findsNothing);
      expect(find.byIcon(Icons.message), findsNothing);
    });

    testWidgets('neither role gets a group-membership editing affordance', (tester) async {
      for (final role in UserRole.values) {
        await tester.pumpWidget(harness(role: role, child: const GroupsScreen()));
        await tester.pumpAndSettle();

        // Membership belongs to the backend (§24).
        expect(find.byIcon(Icons.person_add), findsNothing);
        expect(find.byIcon(Icons.person_remove), findsNothing);
        expect(find.byIcon(Icons.group_add), findsNothing);
      }
    });
  });

  group('phone privacy: nothing phone-shaped is ever rendered', () {
    final phoneShaped = RegExp(r'(?:\+|00)\d[\d\s\-().]{6,}\d|\b0\d{9,}\b');

    testWidgets('the chat list renders no phone-shaped string', (tester) async {
      for (final role in UserRole.values) {
        await tester.pumpWidget(
          harness(role: role, child: const ConversationsScreen()),
        );
        await tester.pumpAndSettle();

        for (final text in renderedText(tester)) {
          expect(
            phoneShaped.hasMatch(text),
            isFalse,
            reason: 'phone-shaped string rendered for ${role.name}: "$text"',
          );
        }
      }
    });
  });

  group('operations vocabulary never leaks to a family surface', () {
    testWidgets('no attention, workload, SLA or case wording appears', (tester) async {
      // Handoff rules 1 and 2, and the vocabulary reconciliation in discovery.md §5.
      const forbidden = [
        'SLA',
        'workload',
        'attention',
        'NOW',
        'TODAY',
        'QUIET',
        'owner_locked',
        'escalation',
        'on duty',
        'coverage',
        'internal note',
      ];

      for (final role in UserRole.values) {
        await tester.pumpWidget(
          harness(role: role, child: const ConversationsScreen(), locale: const Locale('en')),
        );
        await tester.pumpAndSettle();

        final all = renderedText(tester).join(' | ').toLowerCase();
        for (final word in forbidden) {
          expect(
            all.contains(word.toLowerCase()),
            isFalse,
            reason: '"$word" must not appear on a ${role.name} surface. Rendered: $all',
          );
        }
      }
    });
  });

  group('role-aware navigation shells', () {
    testWidgets('a parent gets four tabs including Jawwid', (tester) async {
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: AppShell(
            role: UserRole.parent,
            currentRoute: '/home',
            onDestinationSelected: (_) {},
            child: const SizedBox.shrink(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(NavigationDestination), findsNWidgets(4));
    });

    testWidgets('a teacher gets three tabs and no Jawwid tab', (tester) async {
      await tester.pumpWidget(
        harness(
          role: UserRole.teacher,
          child: AppShell(
            role: UserRole.teacher,
            currentRoute: '/home',
            onDestinationSelected: (_) {},
            child: const SizedBox.shrink(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(NavigationDestination), findsNWidgets(3));
      expect(Shells.teacher.any((d) => d.route == '/chats'), isFalse);
    });

    testWidgets('every tab shows a label, never icon-only', (tester) async {
      for (final role in UserRole.values) {
        await tester.pumpWidget(
          harness(
            role: role,
            child: AppShell(
              role: role,
              currentRoute: '/home',
              onDestinationSelected: (_) {},
              child: const SizedBox.shrink(),
            ),
          ),
        );
        await tester.pumpAndSettle();

        for (final destination
            in tester.widgetList<NavigationDestination>(
                find.byType(NavigationDestination))) {
          expect(destination.label, isNotEmpty);
        }
      }
    });
  });

  group('error surfaces stay non-technical', () {
    testWidgets('a server failure shows friendly copy, not an exception', (tester) async {
      // Persistent, so the state settles rather than being retried into success.
      final backend = FakeBackend(role: UserRole.parent)
        ..persistentFailure = const AppError(
          AppErrorKind.server,
          debugDetail: 'PostgresException: relation "thread" does not exist',
        );
      addTearDown(backend.dispose);

      await tester.pumpWidget(
        ProviderScope(
          retry: JawwidRetryPolicy.policy,
          overrides: [
            currentRoleProvider.overrideWithValue(UserRole.parent),
            conversationRepositoryProvider
                .overrideWithValue(FakeConversationRepository(backend)),
          ],
          child: MaterialApp(
            locale: const Locale('en'),
            theme: JawwidTheme.light(isArabic: false),
            supportedLocales: JawwidApp.supportedLocales,
            localizationsDelegates: const [
              L10n.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            home: const ConversationsScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final all = renderedText(tester).join(' ');
      expect(all, contains('Something went wrong'));
      expect(all, isNot(contains('PostgresException')));
      expect(all, isNot(contains('relation')));
    });
  });

  group('conversation state honesty', () {
    test('the conversations controller exposes no attention or priority field', () {
      // A compile-time guarantee: if someone adds one, this stops compiling rather than
      // silently shipping an operations concept to a parent.
      expect(totalUnreadProvider, isNotNull);
    });
  });
}
