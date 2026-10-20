import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/conversations/presentation/chats_screen.dart';
import 'package:jawwid_chat/features/messages/data/message_search_repository.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';
import 'package:jawwid_chat/shared/utils/search_fold.dart';

import 'fake_voice_devices.dart';

/// Search inside a chat and across chats (group B, owner decision 2026-10-20).
void main() {
  // Code points, so the test source carries no invisible marks.
  String c(List<int> cps) => String.fromCharCodes(cps);

  group('search_fold mirrors chat.search_fold', () {
    test('case-insensitive, and every occurrence', () {
      expect(searchMatchRanges('Surah Al-Mulk, surah AL', 'surah al'), [(0, 8), (15, 23)]);
    });

    test('ignores harakat and spelling variants, marking the original letters with their marks', () {
      final vowelled = c([0x645, 0x64e, 0x62d, 0x645, 0x651, 0x64e, 0x62f]);
      expect(searchMatchRanges('$vowelled ${c([0x62c, 0x627, 0x621])}', c([0x645, 0x62d, 0x645, 0x62f])), [(0, vowelled.length)]);
      expect(searchMatchRanges(c([0x623, 0x62d, 0x633, 0x646]), c([0x627, 0x62d, 0x633, 0x646])), hasLength(1));
      expect(searchMatchRanges(c([0x62d, 0x635, 0x629]), c([0x62d, 0x635, 0x647])), hasLength(1));
    });

    test('a term needs two real characters; a long text is cut to its match', () {
      expect(isSearchable('a'), isFalse);
      expect(isSearchable(c([0x64e, 0x651])), isFalse);
      expect(isSearchable('ab'), isTrue);
      final cut = snippetAround('${'word ' * 30}the needle is here', 'needle');
      expect(cut.startsWith('…'), isTrue);
      expect(cut, contains('needle'));
    });
  });

  late FakeBackend backend;
  late FakeVoiceRecorder recorder;
  late FakeVoicePlayer player;

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    recorder = FakeVoiceRecorder();
    player = FakeVoicePlayer();
  });
  tearDown(() {
    recorder.dispose();
    player.dispose();
    backend.dispose();
  });

  Widget app(Widget home, {List<String>? searched, int? pageSize}) => ProviderScope(
        overrides: [
          currentRoleProvider.overrideWithValue(UserRole.parent),
          voiceRecorderProvider.overrideWithValue(recorder),
          voicePlayerProvider.overrideWithValue(player),
          conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
          messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
          groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
          callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
          messageSearchRepositoryProvider.overrideWithValue(_BackendSearch(backend, searched ?? <String>[], pageSize: pageSize)),
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
          home: home,
        ),
      );

  /// Whether some text on screen marks [term] (a highlighted span).
  bool marked(WidgetTester tester, String term) => tester.widgetList<RichText>(find.byType(RichText)).any((r) {
        var found = false;
        r.text.visitChildren((span) {
          if (span is TextSpan && span.text == term && span.style?.backgroundColor != null) found = true;
          return !found;
        });
        return found;
      });

  testWidgets('searching a chat marks the newest match, and Older loads history to reach an old one', (tester) async {
    final conversationId = backend.listConversations().first.id;
    backend.appendIncoming(conversationId, 'old fee notice');
    for (var i = 0; i < 70; i++) {
      backend.appendIncoming(conversationId, 'filler $i');
    }
    backend.appendIncoming(conversationId, 'the fee is due');
    final searched = <String>[];

    await tester.pumpWidget(app(ChatScreen(conversationId: conversationId, title: 'Jawwid'), searched: searched));
    await tester.pumpAndSettle();
    expect(find.text('old fee notice'), findsNothing); // not on the first page

    await tester.tap(find.byTooltip('Search in chat'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Search messages'), 'fee');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();

    expect(searched, ['fee']);
    expect(find.text('1 of 2'), findsOneWidget);
    expect(marked(tester, 'fee'), isTrue);

    await tester.tap(find.byTooltip('Older match'));
    await tester.pumpAndSettle();
    expect(find.text('2 of 2'), findsOneWidget);
    expect(find.text('old fee notice').hitTestable(), findsOneWidget);

    // Closing the search clears the marks.
    await tester.tap(find.byTooltip('Close search'));
    await tester.pumpAndSettle();
    expect(marked(tester, 'fee'), isFalse);
  });

  testWidgets('Older fetches the next page of matches past the last loaded one (review fix, PR #68)', (tester) async {
    final conversationId = backend.listConversations().first.id;
    backend.appendIncoming(conversationId, 'old fee notice');
    backend.appendIncoming(conversationId, 'the fee is due');
    final searched = <String>[];

    // One match per page, so the second match is only reachable by paging.
    await tester.pumpWidget(app(ChatScreen(conversationId: conversationId, title: 'Jawwid'), searched: searched, pageSize: 1));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Search in chat'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Search messages'), 'fee');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('1 of 1+'), findsOneWidget);

    await tester.tap(find.byTooltip('Older match'));
    await tester.pumpAndSettle();
    // The second request continues from the first page's cursor.
    expect(searched, hasLength(2));
    expect(searched.last, startsWith('fee before '));
    expect(find.text('2 of 2'), findsOneWidget);
    expect(find.text('old fee notice').hitTestable(), findsOneWidget);
  });

  testWidgets('the chats search lists messages only from three letters (review fix, PR #68)', (tester) async {
    backend.appendIncoming(backend.listConversations().first.id, 'the trip is on Thursday');
    final searched = <String>[];
    await tester.pumpWidget(app(const ChatsScreen(), searched: searched));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), 'tr');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('Messages'), findsNothing);
    expect(searched, isEmpty);

    await tester.enterText(find.byType(TextField), 'tri');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();
    expect(find.text('Messages'), findsOneWidget);
    expect(searched, ['all tri']);
  });

  testWidgets('the chats search also lists matching messages; a tap opens the chat at the message', (tester) async {
    final target = backend.listConversations().first;
    final hit = backend.appendIncoming(target.id, 'the trip is on Thursday');
    final opened = <(String, String)>[];

    await tester.pumpWidget(app(ChatsScreen(onOpenMessage: (cid, mid) => opened.add((cid, mid)))));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'trip');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();

    expect(find.text('Messages'), findsOneWidget);
    expect(marked(tester, 'trip'), isTrue);
    await tester.tap(find.byKey(ValueKey('hit-${hit.id}')));
    expect(opened, [(target.id, hit.id!)]);
  });
}

/// Search over the fake backend's messages, matched the way the server folds.
class _BackendSearch implements MessageSearchRepository {
  _BackendSearch(this.backend, this.searched, {this.pageSize});

  final FakeBackend backend;
  final List<String> searched;

  /// When set, answers [pageSize] matches at a time, paged by sequence like the server.
  final int? pageSize;

  @override
  bool get isAvailable => true;

  @override
  Future<MessageSearchPage> searchIn(String conversationId, String query, {String? before}) async {
    searched.add(before == null ? query : '$query before $before');
    final cutoff = before == null ? null : int.parse(before);
    final all = backend
        .since(conversationId, afterSequence: 0)
        .where((m) => searchMatchRanges(m.body, query).isNotEmpty && (cutoff == null || (m.sequence ?? 0) < cutoff))
        .toList()
      ..sort((a, b) => (b.sequence ?? 0).compareTo(a.sequence ?? 0));
    final size = pageSize;
    if (size == null || all.length <= size) return MessageSearchPage(hits: all);
    final page = all.take(size).toList();
    return MessageSearchPage(hits: page, nextBefore: '${page.last.sequence}');
  }

  @override
  Future<List<MessageSearchHit>> searchAll(String query) async => [
        ...(() {
          searched.add('all $query');
          return const <MessageSearchHit>[];
        })(),
        for (final conv in backend.listConversations())
          for (final m in backend.since(conv.id, afterSequence: 0))
            if (searchMatchRanges(m.body, query).isNotEmpty) MessageSearchHit(conversationId: conv.id, message: m),
      ];
}
