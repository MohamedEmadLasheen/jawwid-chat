import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen_route.dart';
import 'package:jawwid_chat/features/messages/presentation/system_message_text.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// PD-33 in the app: a parent (or teacher) in a group or 1:1 whose supervisor is
/// away is told who answers, and until when -- the `cover` the server sends is
/// shown under the chat's name, and the cover's system lines read as words in
/// both languages. The app never works the cover out for itself.
void main() {
  setUpAll(() async => initializeDateFormatting());

  final en = lookupL10n(const Locale('en'));
  final ar = lookupL10n(const Locale('ar'));
  const until = '2026-11-03T12:00:00.000Z';

  group('the cover system lines', () {
    const started = '{"kind":"cover.started","supervisor":"QA Noor","cover":"QA Amira","until":"$until"}';

    test('started and extended name both people and the end day', () {
      expect(systemMessageText(started, en), 'QA Amira is covering for QA Noor until Nov 3');
      expect(systemMessageText(started, ar), startsWith('التغطية: QA Amira بدلًا من QA Noor حتى '));
      expect(
        systemMessageText(started.replaceFirst('cover.started', 'cover.extended'), en),
        "QA Amira's cover for QA Noor is extended until Nov 3",
      );
    });

    test('ended says the supervisor is back', () {
      const ended = '{"kind":"cover.ended","supervisor":"QA Noor","cover":"QA Amira"}';
      expect(systemMessageText(ended, en), 'QA Noor is back; the cover has ended');
      expect(systemMessageText(ended, ar), 'انتهت التغطية؛ عادت المتابعة إلى QA Noor');
    });

    test('a line missing its facts still reads as words, never JSON', () {
      expect(systemMessageText('{"kind":"cover.started"}', en), 'A backup supervisor is covering');
      expect(systemMessageText('{"kind":"cover.ended"}', en), 'The cover has ended');
    });

    test('the chat list previews them by kind', () {
      final c = Conversation(
        id: 'c1',
        kind: ConversationKind.studentGroup,
        title: 'g',
        updatedAt: DateTime.utc(2026, 10, 26),
        lastMessageKind: 'system:cover.started',
      );
      expect(previewText(c, en), 'A backup supervisor is covering');
    });
  });

  group('the wire', () {
    Map<String, Object?> wire(Object? cover) => {
          'id': 'c1',
          'type': 'student_group',
          'title': 'QA Learner',
          'lastActivityAt': '2026-10-26T10:00:00Z',
          'cover': cover,
        };

    test('carries the server\'s cover', () {
      final c = WireMappers.conversation(
        wire({'supervisorId': 's1', 'supervisorName': 'QA Noor', 'coverId': 'b1', 'coverName': 'QA Amira', 'until': until}),
        viewerRole: UserRole.parent,
      );
      expect(c.cover?.supervisorName, 'QA Noor');
      expect(c.cover?.coverName, 'QA Amira');
      expect(c.cover!.until.isAtSameMomentAs(DateTime.parse(until)), isTrue);
    });

    test('null, absent or malformed is no cover', () {
      expect(WireMappers.conversation(wire(null), viewerRole: UserRole.parent).cover, isNull);
      expect(WireMappers.conversation(wire({'coverName': 'QA Amira'}), viewerRole: UserRole.parent).cover, isNull);
      expect(WireMappers.conversation(wire('x'), viewerRole: UserRole.parent).cover, isNull);
    });
  });

  testWidgets("the parent reads the cover under the group's name", (tester) async {
    final backend = FakeBackend(role: UserRole.parent);
    addTearDown(backend.dispose);
    final group = backend.listConversations().firstWhere((c) => c.kind == ConversationKind.studentGroup);
    await tester.pumpWidget(ProviderScope(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        conversationRepositoryProvider.overrideWithValue(_CoveredRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        groupRepositoryProvider.overrideWithValue(FakeGroupRepository(backend)),
        callRepositoryProvider.overrideWithValue(FakeCallRepository(backend)),
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
        home: Scaffold(body: ChatScreenRoute(conversationId: group.id)),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('QA Amira is covering for QA Noor until Nov 3'), findsOneWidget);
  });
}

/// The fake backend's conversation, with the cover a server would send.
class _CoveredRepository extends FakeConversationRepository {
  _CoveredRepository(super.backend);

  @override
  Future<Conversation> byId(String conversationId) async {
    final c = backend.conversationById(conversationId);
    return Conversation(
      id: c.id,
      kind: c.kind,
      title: c.title,
      updatedAt: c.updatedAt,
      learner: c.learner,
      cover: ConversationCover(
        supervisorName: 'QA Noor',
        coverName: 'QA Amira',
        until: DateTime.parse('2026-11-03T12:00:00.000Z'),
      ),
    );
  }
}
