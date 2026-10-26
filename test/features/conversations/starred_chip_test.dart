import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/conversations/presentation/chats_screen.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/features/messages/data/message_marks_repository.dart';
import 'package:jawwid_chat/features/settings/application/theme_mode_controller.dart';
import 'package:jawwid_chat/features/settings/presentation/settings_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../app_lock/app_lock_fakes.dart';

/// PD-32: Starred messages moved from Settings into Chats, as a chip after Favourites,
/// for every role -- and only where the build reaches the star routes.
void main() {
  StarredMessage starred(String id, String body, String conversationId) => StarredMessage(
        conversationId: conversationId,
        starredAt: DateTime.utc(2026, 10, 25, 9),
        message: Message(
          id: id,
          clientMessageId: 'c-$id',
          conversationId: conversationId,
          sequence: 1,
          kind: MessageKind.text,
          body: body,
          authorName: 'Ustadh Yusuf',
          createdAt: DateTime.utc(2026, 10, 25, 8),
          deliveryState: DeliveryState.delivered,
        ),
      );

  Widget harness({required UserRole role, required Widget child, List<Override> extra = const []}) {
    final backend = FakeBackend(role: role);
    addTearDown(backend.dispose);
    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(role),
        principalIdProvider.overrideWithValue('me'),
        conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
        ...extra,
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
        home: child,
      ),
    );
  }

  for (final role in [UserRole.parent, UserRole.teacher]) {
    testWidgets('${role.name}: the Starred chip follows Favourites and shows the starred messages in place', (tester) async {
      final opened = <String>[];
      final marks = _Starred([starred('m1', 'Revise surah al-Mulk', 'conv_a')]);
      await tester.pumpWidget(harness(
        role: role,
        child: ChatsScreen(onOpenConversation: opened.add),
        extra: [messageMarksRepositoryProvider.overrideWithValue(marks)],
      ));
      await tester.pumpAndSettle();

      final favourites = find.byKey(const ValueKey('chat-filter-favorites'));
      final chip = find.byKey(const ValueKey('chat-filter-starred'));
      expect(find.text('Starred'), findsOneWidget);
      // After Favourites, in reading order (English here, so to the right).
      expect(tester.getCenter(chip).dx, greaterThan(tester.getCenter(favourites).dx));
      expect(find.byType(ConversationTile), findsWidgets);

      await tester.tap(chip);
      await tester.pumpAndSettle();

      // Still Chats; the conversations gave way to the starred list.
      expect(find.byType(ChatsScreen), findsOneWidget);
      expect(find.byType(ConversationTile), findsNothing);
      expect(find.text('Revise surah al-Mulk'), findsOneWidget);

      await tester.tap(find.text('Revise surah al-Mulk'));
      await tester.pumpAndSettle();
      expect(opened, ['conv_a']);
    });
  }

  testWidgets('with nothing starred, the chip says how to star', (tester) async {
    await tester.pumpWidget(harness(
      role: UserRole.parent,
      child: const ChatsScreen(),
      extra: [messageMarksRepositoryProvider.overrideWithValue(_Starred(const []))],
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('chat-filter-starred')));
    await tester.pumpAndSettle();
    expect(find.text('No starred messages yet. Long-press a message and choose Star.'), findsOneWidget);
  });

  testWidgets('a build without the star routes offers no Starred chip', (tester) async {
    await tester.pumpWidget(harness(role: UserRole.parent, child: const ChatsScreen()));
    await tester.pumpAndSettle();
    expect(find.text('Favourites'), findsOneWidget);
    expect(find.byKey(const ValueKey('chat-filter-starred')), findsNothing);
  });

  testWidgets('Settings no longer has a Starred messages row', (tester) async {
    final world = LockWorld(role: UserRole.parent, storedSession: true);
    final container = ProviderContainer(overrides: [
      ...world.overrides(),
      themeModeStoreProvider.overrideWithValue(FakeThemeModeStore()),
      messageMarksRepositoryProvider.overrideWithValue(_Starred(const [])),
    ]);
    addTearDown(() {
      container.dispose();
      world.dispose();
    });
    container.listen(appLockControllerProvider, (_, _) {});
    await container.read(authControllerProvider.notifier).restore();

    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
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
        home: const SettingsScreen(),
      ),
    ));
    await tester.pumpAndSettle();
    // The list is lazy: walk it to the end so every row has been built once.
    await tester.scrollUntilVisible(find.byKey(const ValueKey('settings-devices')), 200);
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('settings-devices')), findsOneWidget);
    expect(find.byKey(const ValueKey('settings-starred')), findsNothing);
    expect(find.text('Starred messages'), findsNothing);
  });
}

class _Starred extends NoMessageMarksRepository {
  _Starred(this.items);

  final List<StarredMessage> items;

  @override
  bool get isAvailable => true;

  @override
  Future<StarredPage> starred({String? before}) async => StarredPage(items: items);
}
