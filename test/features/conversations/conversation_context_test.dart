import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/conversations/application/conversations_controller.dart';
import 'package:jawwid_chat/features/conversations/domain/conversation_list.dart';
import 'package:jawwid_chat/features/conversations/presentation/chats_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// A repository holding raw `ConversationDto` JSON, mapped by the real mapper.
///
/// Not the in-memory fixture. The fixture hands the UI a `Conversation` that
/// already has a learner and an unread count, which is precisely why the
/// missing payload went unnoticed for so long — every list test passed against
/// data no server had sent. Here the only input is the wire format, so anything
/// the screen renders had to survive `WireMappers.conversation`.
///
/// A socket is not used: `TestWidgetsFlutterBinding` answers real requests with
/// a 400, so a widget test cannot also be a network test. The transport itself
/// is covered over a real socket in
/// `test/core/data/http/conversation_context_over_http_test.dart`.
class _DtoBackedRepository implements ConversationRepository {
  _DtoBackedRepository(this.payload);

  /// Raw DTO maps, exactly as the API sends them.
  List<Map<String, Object?>> payload;

  List<Conversation> get _mapped => [
        for (final row in payload)
          WireMappers.conversation(row, viewerRole: UserRole.parent),
      ];

  @override
  Future<List<Conversation>> list({bool includeArchived = false}) async =>
      _mapped.where((c) => includeArchived || !c.isArchived).toList();

  @override
  Future<Conversation> byId(String conversationId) async =>
      _mapped.firstWhere((c) => c.id == conversationId);

  @override
  Future<void> markRead(String conversationId, {required int throughSequence}) async {}
  @override
  Future<void> setPinned(String conversationId, bool pinned) async {}
  @override
  Future<void> setMuted(String conversationId, bool muted) async {}
  @override
  Future<void> setArchived(String conversationId, bool archived) async {}
  @override
  Future<List<Conversation>> search(String query) async => const [];
}

void main() {
  Map<String, Object?> dto({
    required String id,
    required String title,
    String type = 'student_group',
    Map<String, Object?>? learner,
    int unreadCount = 0,
    String lastActivityAt = '2026-09-05T12:00:00.000Z',
  }) =>
      {
        'id': id,
        'type': type,
        'familyId': 'f_1',
        'learnerId': learner?['id'],
        'title': title,
        'state': 'open',
        'needsReply': false,
        'lastSeq': '10',
        'lastActivityAt': lastActivityAt,
        'archivedAt': null,
        'teacherRequiresApproval': true,
        'parentRequiresApproval': false,
        'learner': learner,
        'unreadCount': unreadCount,
      };

  ProviderContainer? container;
  tearDown(() {
    container?.dispose();
    container = null;
  });

  Widget harness(
    List<Map<String, Object?>> payload, {
    Locale locale = const Locale('en'),
  }) {
    return UncontrolledProviderScope(
      container: container = ProviderContainer(
        overrides: [
          currentRoleProvider.overrideWithValue(UserRole.parent),
          conversationRepositoryProvider
              .overrideWithValue(_DtoBackedRepository(payload)),
        ],
      ),
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
        home: const ChatsScreen(),
      ),
    );
  }

  group('the unread badge is the server\'s number', () {
    testWidgets('a count from the payload appears on its row', (tester) async {
      await tester.pumpWidget(harness([
        dto(id: 'c_1', title: 'Jawwid', type: 'direct', unreadCount: 2),
        dto(
          id: 'c_2',
          title: 'Ahmed group',
          learner: {'id': 'l_1', 'name': 'Ahmed'},
          unreadCount: 1,
        ),
      ]));
      await tester.pumpAndSettle();

      expect(find.text('2'), findsOneWidget);
      expect(find.text('1'), findsOneWidget);
    });

    testWidgets('zero renders no badge, not a "0"', (tester) async {
      await tester.pumpWidget(harness([
        dto(id: 'c_1', title: 'Jawwid', type: 'direct'),
      ]));
      await tester.pumpAndSettle();

      expect(find.text('Jawwid'), findsOneWidget);
      expect(find.text('0'), findsNothing);
    });

    testWidgets('the tab total is the sum of the payload', (tester) async {
      await tester.pumpWidget(harness([
        dto(id: 'c_1', title: 'Jawwid', type: 'direct', unreadCount: 2),
        dto(id: 'c_2', title: 'Ahmed', learner: {'id': 'l_1', 'name': 'Ahmed'}, unreadCount: 5),
      ]));
      await tester.pumpAndSettle();

      expect(container!.read(totalUnreadProvider), 7);
    });

    testWidgets('a refetch moves the badge, because the server moved it',
        (tester) async {
      // The whole lifecycle without realtime. Nothing here counts messages;
      // the number changes because the list was fetched again.
      final repository = _DtoBackedRepository([
        dto(id: 'c_1', title: 'Jawwid', type: 'direct', unreadCount: 3),
      ]);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container = ProviderContainer(
            overrides: [
              currentRoleProvider.overrideWithValue(UserRole.parent),
              conversationRepositoryProvider.overrideWithValue(repository),
            ],
          ),
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
            home: const ChatsScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('3'), findsOneWidget);

      // The parent read them; the server now says zero.
      repository.payload = [
        dto(id: 'c_1', title: 'Jawwid', type: 'direct'),
      ];
      await container!.read(conversationsControllerProvider.notifier).refresh();
      await tester.pumpAndSettle();

      expect(find.text('3'), findsNothing);

      // Something new arrives; the next fetch brings the badge back.
      repository.payload = [
        dto(id: 'c_1', title: 'Jawwid', type: 'direct', unreadCount: 1),
      ];
      await container!.read(conversationsControllerProvider.notifier).refresh();
      await tester.pumpAndSettle();

      expect(find.text('1'), findsOneWidget);
    });

    testWidgets('the Unread filter uses the payload\'s counts', (tester) async {
      await tester.pumpWidget(harness([
        dto(id: 'c_1', title: 'Has unread', type: 'direct', unreadCount: 2),
        dto(id: 'c_2', title: 'All read', type: 'direct'),
      ]));
      await tester.pumpAndSettle();

      // The chip counts CONVERSATIONS with something unread, and that count is
      // itself derived from the payload.
      expect(find.text('Unread 1'), findsOneWidget);

      await tester.tap(find.text('Unread 1'));
      await tester.pumpAndSettle();

      expect(find.text('Has unread'), findsOneWidget);
      expect(find.text('All read'), findsNothing);
    });
  });

  group('child context is the server\'s, not the title\'s', () {
    testWidgets('rows are ordered by child, from the learner field',
        (tester) async {
      // Sara's group is the most recent, so Sara's conversations come first —
      // and the grouping key is the learner id off the DTO, not anything
      // parsed out of the titles.
      await tester.pumpWidget(harness([
        dto(
          id: 'c_ahmed',
          title: 'Group one',
          learner: {'id': 'l_ahmed', 'name': 'Ahmed'},
          lastActivityAt: '2026-09-05T09:00:00.000Z',
        ),
        dto(
          id: 'c_sara',
          title: 'Group two',
          learner: {'id': 'l_sara', 'name': 'Sara'},
          lastActivityAt: '2026-09-05T18:00:00.000Z',
        ),
      ]));
      await tester.pumpAndSettle();

      final rows = tester.widgetList<Text>(find.byType(Text)).map((t) => t.data);
      expect(rows, containsAllInOrder(['Group two', 'Group one']));
    });

    test('the section key is the learner id from the payload', () {
      // Asserted on the domain rather than through a pumped screen, because
      // the screen flattens sections for rendering — the grouping is real and
      // is what orders the list.
      final conversations = [
        for (final row in [
          dto(id: 'c_1', title: 'Ahmed · Jawwid',
              learner: {'id': 'l_real', 'name': 'Mohamed Junior'}),
        ])
          WireMappers.conversation(row, viewerRole: UserRole.parent),
      ];

      final sections = ConversationListBuilder.build(
        role: UserRole.parent,
        conversations: conversations,
      );

      // "Ahmed" is in the title and is NOT the child. Grouping by anything
      // parsed from the title would key this section on the wrong person.
      expect(sections.single.key, 'learner:l_real');
      expect(sections.single.learner?.displayName, 'Mohamed Junior');
    });

    testWidgets('a conversation with no learner still renders', (tester) async {
      await tester.pumpWidget(harness([
        dto(id: 'c_family', title: 'جَوِّد', type: 'direct'),
      ], locale: const Locale('ar')));
      await tester.pumpAndSettle();

      expect(find.text('جَوِّد'), findsOneWidget);
    });
  });

  group('both directions', () {
    for (final locale in [const Locale('ar'), const Locale('en')]) {
      testWidgets('${locale.languageCode}: the badge renders and mirrors',
          (tester) async {
        await tester.pumpWidget(harness([
          dto(
            id: 'c_1',
            title: locale.languageCode == 'ar' ? 'مجموعة أحمد' : 'Ahmed group',
            learner: {
              'id': 'l_1',
              'name': locale.languageCode == 'ar' ? 'أحمد' : 'Ahmed',
            },
            unreadCount: 5,
          ),
        ], locale: locale));
        await tester.pumpAndSettle();

        expect(find.text('5'), findsOneWidget);
        expect(
          Directionality.of(tester.element(find.text('5'))),
          locale.languageCode == 'ar' ? TextDirection.rtl : TextDirection.ltr,
        );
      });
    }
  });
}
