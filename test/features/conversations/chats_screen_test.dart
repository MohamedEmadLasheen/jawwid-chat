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
import 'package:jawwid_chat/features/calls/presentation/calls_screen.dart';
import 'package:jawwid_chat/features/conversations/domain/chat_feed.dart';
import 'package:jawwid_chat/features/conversations/presentation/chat_filter_bar.dart';
import 'package:jawwid_chat/features/conversations/presentation/chat_search_field.dart';
import 'package:jawwid_chat/features/conversations/presentation/chats_screen.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/features/stories/application/stories_controller.dart';
import 'package:jawwid_chat/features/stories/domain/story.dart';
import 'package:jawwid_chat/features/stories/presentation/stories_rail.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The rendered Chats screen, in both languages.
///
/// These are the checks that the information architecture actually reached the screen:
/// search is present without a tap, the filters are present, the conversations are rows,
/// and nothing on the screen is invented.
void main() {
  Widget harness({
    required UserRole role,
    required Widget child,
    Locale locale = const Locale('ar'),
    List<Override> extra = const [],
  }) {
    final backend = FakeBackend(role: role);
    addTearDown(backend.dispose);

    return ProviderScope(
      overrides: [
        currentRoleProvider.overrideWithValue(role),
        conversationRepositoryProvider
            .overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider
            .overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
        ...extra,
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

  group('search is visible, not hidden behind a tap', () {
    testWidgets('the field is on screen the moment Chats opens', (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const ChatsScreen()),
      );
      await tester.pumpAndSettle();

      // A real, editable field — not an icon that opens a search page.
      expect(find.byType(ChatSearchField), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(find.byIcon(Icons.search), findsOneWidget);
    });

    testWidgets('typing narrows the list to real conversations', (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const ChatsScreen()),
      );
      await tester.pumpAndSettle();

      final before = tester.widgetList(find.byType(ConversationTile)).length;
      expect(before, greaterThan(1));

      // Typed without the hamza the fixture stores.
      await tester.enterText(find.byType(TextField), 'احمد');
      await tester.pumpAndSettle();

      final tiles = tester
          .widgetList<ConversationTile>(find.byType(ConversationTile))
          .toList();
      expect(tiles, hasLength(1));
      expect(tiles.single.conversation.title, contains('أحمد'));
    });

    testWidgets('a query with no match says so, and says what search covers',
        (tester) async {
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: const ChatsScreen(),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'zzzzz');
      await tester.pumpAndSettle();

      expect(find.byType(ConversationTile), findsNothing);
      expect(find.text('Nothing matched your search'), findsOneWidget);
      expect(
        find.text('Search covers conversation and group names.'),
        findsOneWidget,
      );
    });

    testWidgets('clearing the field restores the whole list', (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const ChatsScreen()),
      );
      await tester.pumpAndSettle();
      final before = tester.widgetList(find.byType(ConversationTile)).length;

      await tester.enterText(find.byType(TextField), 'احمد');
      await tester.pumpAndSettle();
      await tester.tap(find.byIcon(Icons.close));
      await tester.pumpAndSettle();

      expect(tester.widgetList(find.byType(ConversationTile)), hasLength(before));
    });
  });

  group('the filter chips filter one feed', () {
    testWidgets('all four chips are on screen', (tester) async {
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: const ChatsScreen(),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('All'), findsOneWidget);
      expect(find.textContaining('Unread'), findsOneWidget);
      expect(find.text('Groups'), findsOneWidget);
      expect(find.text('Favourites'), findsOneWidget);
    });

    testWidgets('tapping Groups shows the student groups, on the same screen',
        (tester) async {
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: const ChatsScreen(),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Groups'));
      await tester.pumpAndSettle();

      // Still Chats — no navigation happened.
      expect(find.byType(ChatsScreen), findsOneWidget);
      expect(find.byType(ChatSearchField), findsOneWidget);

      final tiles = tester
          .widgetList<ConversationTile>(find.byType(ConversationTile))
          .toList();
      expect(tiles, isNotEmpty);
      expect(
        tiles.every((t) => t.conversation.learner != null),
        isTrue,
        reason: 'the Groups chip must show only student groups',
      );
    });

    testWidgets('an empty result sits near the search box, not adrift mid-screen',
        (tester) async {
      // Regression guard. The first attempt at this wrapped JawwidEmptyView — which is a
      // Center, and fills whatever box it is given — in an Align, so the alignment did
      // nothing and the message still hung two-thirds of the way down the screen, a long
      // way from the field the user had just typed into.
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: const ChatsScreen(),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      await tester.enterText(find.byType(TextField), 'zzzzz');
      await tester.pumpAndSettle();

      // Measured against the list region rather than the whole screen, so the assertion
      // holds on any viewport: the gap above the message must be smaller than the gap
      // below it, which is exactly what "biased towards the search field" means.
      final title = tester.getCenter(find.text('Nothing matched your search')).dy;
      final listTop = tester.getBottomLeft(find.byType(ChatFilterBar)).dy;
      final listBottom = tester.getBottomLeft(find.byType(ChatsScreen)).dy;

      expect(
        title - listTop,
        lessThan(listBottom - title),
        reason: 'the explanation belongs near the search field the user just used, '
            'not adrift in the middle of an empty screen',
      );
    });

    testWidgets('an empty filter explains itself rather than saying "no chats"',
        (tester) async {
      // Nothing in the fixtures is favourited except the pinned support thread, so
      // Favourites is a real, reachable empty state for a teacher.
      await tester.pumpWidget(
        harness(
          role: UserRole.teacher,
          child: const ChatsScreen(initialFilter: ChatFilter.favorites),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('No favourites yet'), findsOneWidget);
      expect(find.text('No conversations yet'), findsNothing);
    });
  });

  group('nothing on this screen is fabricated', () {
    testWidgets('no stories rail renders while no story feature exists',
        (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const ChatsScreen()),
      );
      await tester.pumpAndSettle();

      // Nothing of it is visible — no placeholder circles, no "Your story" button, no
      // skeleton implying data is on the way.
      expect(find.byType(StoriesRail), findsNothing);

      // It is still mounted (offstage, at zero height), which is what lets it appear the
      // moment a real source supplies rings without any change to this screen.
      final offstage = find.byType(StoriesRail, skipOffstage: false);
      expect(offstage, findsOneWidget);
      expect(
        tester.getSize(offstage).height,
        0,
        reason: 'an empty rail must cost no vertical space at all',
      );
    });

    testWidgets('the rail renders properly the moment real rings exist',
        (tester) async {
      // Proves the seam works, without any fixture reaching the shipped app.
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: const ChatsScreen(),
          extra: [
            storyRingsProvider.overrideWithValue([
              StoryRing(
                id: 's1',
                authorName: 'أحمد',
                postedAt: DateTime.utc(2026, 9, 5, 9),
              ),
            ]),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.getSize(find.byType(StoriesRail)).height, greaterThan(0));
      expect(find.text('أحمد'), findsWidgets);
    });

    testWidgets('there is no compose or new-chat affordance', (tester) async {
      // A parent or teacher cannot create a conversation (§24). Offering it would be a
      // button that only fails when tapped.
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const ChatsScreen()),
      );
      await tester.pumpAndSettle();

      expect(find.byType(FloatingActionButton), findsNothing);
      for (final icon in [
        Icons.add,
        Icons.edit,
        Icons.person_add,
        Icons.group_add,
        Icons.call,
        Icons.phone,
      ]) {
        expect(find.byIcon(icon), findsNothing, reason: '$icon must not appear');
      }
    });
  });

  group('Calls tells the truth about itself', () {
    testWidgets('with no global history endpoint, it says calling is not on yet',
        (tester) async {
      // Reconciled 2026-09-24. This used to assert "No calls yet", on the
      // strength of FakeCallRepository answering a global `history()` with an
      // empty page. That method described a route the server does not have:
      // `GET /calls/history/:conversationId` is per-conversation, and this
      // screen is the account's list. An empty answer was the fixture agreeing
      // with a contract nobody had checked.
      //
      // "You have no calls" and "this cannot be asked yet" are different
      // things to tell a parent, and only the second is true.
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: const CallsScreen(),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('No calls yet'), findsNothing);
      expect(find.byIcon(Icons.phone_disabled_outlined), findsOneWidget);
    });

    testWidgets('with no call repository at all, it says calling is not on yet',
        (tester) async {
      // The HTTP composition root registers no CallRepository, because no call endpoint
      // has been published. That must not read as "you have no calls".
      final backend = FakeBackend(role: UserRole.parent);
      addTearDown(backend.dispose);

      await tester.pumpWidget(
        ProviderScope(
          overrides: [currentRoleProvider.overrideWithValue(UserRole.parent)],
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
            home: const CallsScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Calls are not available yet'), findsOneWidget);
      expect(find.text('No calls yet'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  group('Arabic and English both lay out correctly', () {
    testWidgets('Arabic renders the screen right-to-left', (tester) async {
      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const ChatsScreen()),
      );
      await tester.pumpAndSettle();

      expect(
        Directionality.of(tester.element(find.byType(ChatSearchField))),
        TextDirection.rtl,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('English renders the screen left-to-right', (tester) async {
      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: const ChatsScreen(),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        Directionality.of(tester.element(find.byType(ChatSearchField))),
        TextDirection.ltr,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('the search magnifier sits at the leading edge in both', (tester) async {
      double magnifierX(WidgetTester tester) =>
          tester.getCenter(find.byIcon(Icons.search)).dx;

      await tester.pumpWidget(
        harness(
          role: UserRole.parent,
          child: const ChatsScreen(),
          locale: const Locale('en'),
        ),
      );
      await tester.pumpAndSettle();
      final ltr = magnifierX(tester);

      await tester.pumpWidget(
        harness(role: UserRole.parent, child: const ChatsScreen()),
      );
      await tester.pumpAndSettle();
      final rtl = magnifierX(tester);

      final width = tester.getSize(find.byType(ChatSearchField)).width;
      expect(ltr, lessThan(width / 2), reason: 'left in English');
      expect(rtl, greaterThan(width / 2), reason: 'right in Arabic');
    });
  });
}
