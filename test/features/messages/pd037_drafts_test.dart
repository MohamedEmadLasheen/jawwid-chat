import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/features/messages/application/drafts_controller.dart';
import 'package:jawwid_chat/features/messages/data/draft_store.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_voice_devices.dart';

class _Who extends Notifier<String?> {
  @override
  String? build() => 'parent-1';
  void become(String? id) => state = id;
}

final _who = NotifierProvider<_Who, String?>(_Who.new);

Widget _app(Widget home, {Locale locale = const Locale('en')}) => MaterialApp(
      locale: locale,
      theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
      supportedLocales: JawwidApp.supportedLocales,
      localizationsDelegates: const [
        L10n.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: Scaffold(body: home),
    );

void main() {
  group('PD-37 DraftsController', () {
    late InMemoryDraftStore store;
    late ProviderContainer container;

    setUp(() {
      store = InMemoryDraftStore();
      container = ProviderContainer(overrides: [
        draftStoreProvider.overrideWithValue(store),
        principalIdProvider.overrideWith((ref) => ref.watch(_who)),
      ]);
    });
    tearDown(() => container.dispose());

    DraftsController drafts() => container.read(draftsProvider.notifier);

    test("loads this account's saved drafts, and saves a moment after typing stops", () async {
      store.saved['parent-1'] = {'c1': 'see you at'};
      expect(await container.read(draftsProvider.future), {'c1': 'see you at'});

      drafts().set('c2', 'hel');
      drafts().set('c2', 'hello');
      expect(container.read(draftsProvider).value, {'c1': 'see you at', 'c2': 'hello'});
      expect(store.saved['parent-1'], {'c1': 'see you at'}, reason: 'not on every keystroke');

      await Future<void>.delayed(DraftsController.saveAfter * 2);
      expect(store.saved['parent-1'], {'c1': 'see you at', 'c2': 'hello'});
    });

    test('blank text (or a sent message) removes the draft', () async {
      store.saved['parent-1'] = {'c1': 'x'};
      await container.read(draftsProvider.future);
      drafts().set('c1', '   ');
      expect(container.read(draftsProvider).value, isEmpty);
      await Future<void>.delayed(DraftsController.saveAfter * 2);
      expect(store.saved['parent-1'], isEmpty);
    });

    test("another account never sees, nor overwrites, the first one's drafts", () async {
      store.saved['parent-1'] = {'c1': 'mine'};
      store.saved['teacher-2'] = {'c9': 'theirs'};
      await container.read(draftsProvider.future);

      container.read(_who.notifier).become('teacher-2');
      expect(await container.read(draftsProvider.future), {'c9': 'theirs'});
      drafts().set('c1', 'typed by teacher');
      await Future<void>.delayed(DraftsController.saveAfter * 2);
      expect(store.saved['parent-1'], {'c1': 'mine'});
      expect(store.saved['teacher-2'], {'c9': 'theirs', 'c1': 'typed by teacher'});
    });

    test('a keystroke before the drafts load is not written over the saved ones', () async {
      store.saved['parent-1'] = {'c1': 'saved'};
      container.read(draftsProvider); // loading
      drafts().set('c1', '');
      expect(await container.read(draftsProvider.future), {'c1': 'saved'});
    });

    test('nobody signed in: drafts work in memory and nothing is stored', () async {
      container.read(_who.notifier).become(null);
      await container.read(draftsProvider.future);
      drafts().set('c1', 'hi');
      expect(container.read(draftsProvider).value, {'c1': 'hi'});
      await Future<void>.delayed(DraftsController.saveAfter * 2);
      expect(store.saved, isEmpty);
    });
  });

  group('PD-37 SharedPreferencesDraftStore', () {
    test('one entry per account; sign-out deletes every draft and nothing else', () async {
      SharedPreferences.setMockInitialValues({'jawwid.language': 'ar'});
      const store = SharedPreferencesDraftStore();
      await store.save('a', {'c1': 'one', 'c2': 'اثنان'});
      await store.save('b', {'c3': 'three'});
      expect(await store.load('a'), {'c1': 'one', 'c2': 'اثنان'});
      expect(await store.load('b'), {'c3': 'three'});

      await store.save('b', const {});
      expect(await store.load('b'), isEmpty);

      await store.clearAll();
      expect(await store.load('a'), isEmpty);
      expect((await SharedPreferences.getInstance()).getString('jawwid.language'), 'ar');
    });

    test('a damaged entry is dropped, never shown', () async {
      SharedPreferences.setMockInitialValues({'jawwid.drafts.a': '{not json', 'jawwid.drafts.b': '{"c1": 3, "c2": "ok"}'});
      const store = SharedPreferencesDraftStore();
      expect(await store.load('a'), isEmpty);
      expect(await store.load('b'), {'c2': 'ok'});
    });
  });

  group('PD-37 the Chats row', () {
    final conversation = Conversation(
      id: 'c1',
      kind: ConversationKind.adminDirect,
      title: 'Jawwid',
      updatedAt: DateTime.utc(2026, 10, 27),
      lastMessagePreview: 'last message',
    );
    final now = DateTime.utc(2026, 10, 27, 12);

    testWidgets('a draft shows as "Draft: ..." on one line, instead of the last message', (tester) async {
      await tester.pumpWidget(_app(ConversationTile(conversation: conversation, now: now, draft: 'see you\nat   five')));
      expect(find.text('Draft: '), findsOneWidget);
      expect(find.text('see you at five'), findsOneWidget);
      expect(find.text('last message'), findsNothing);
    });

    testWidgets('in Arabic', (tester) async {
      await tester.pumpWidget(_app(ConversationTile(conversation: conversation, now: now, draft: 'أراك'), locale: const Locale('ar')));
      expect(find.text('مسودة: '), findsOneWidget);
      expect(find.text('أراك'), findsOneWidget);
    });

    testWidgets('no draft, or a blank one: the last message as before', (tester) async {
      await tester.pumpWidget(_app(ConversationTile(conversation: conversation, now: now, draft: '  ')));
      expect(find.text('last message'), findsOneWidget);
      expect(find.textContaining('Draft'), findsNothing);
    });
  });

  group('PD-37 the composer', () {
    testWidgets('puts the saved draft back without saying "typing", and a send clears it', (tester) async {
      final said = <String>[];
      final sent = <String>[];
      Widget composer(String? draft) => _app(MessageComposer(
            onSend: sent.add,
            onDraftChanged: said.add,
            initialText: draft,
          ));

      await tester.pumpWidget(composer('see you'));
      expect(find.text('see you'), findsOneWidget);
      expect(said, isEmpty, reason: 'restoring a draft is not typing');

      await tester.enterText(find.byType(TextField), 'see you at five');
      expect(said.last, 'see you at five');
      await tester.tap(find.byTooltip(lookupL10n(const Locale('en')).composerSend));
      await tester.pump();
      expect(sent, ['see you at five']);
      expect(said.last, '', reason: 'a sent message leaves no draft');
    });

    testWidgets('a draft that loads after the screen opens is adopted -- never over typed text', (tester) async {
      final said = <String>[];
      Widget composer(String? draft) => _app(MessageComposer(onSend: (_) {}, onDraftChanged: said.add, initialText: draft));

      await tester.pumpWidget(composer(null));
      await tester.pumpWidget(composer('loaded late'));
      expect(find.text('loaded late'), findsOneWidget);
      expect(said, isEmpty, reason: 'a late draft is not typing either');

      await tester.pumpWidget(_app(const SizedBox()));
      await tester.pumpWidget(composer(null));
      await tester.enterText(find.byType(TextField), 'typed first');
      await tester.pumpWidget(composer('loaded late'));
      expect(find.text('typed first'), findsOneWidget);
    });
  });

  group('PD-37 the chat screen', () {
    testWidgets("opens with this chat's draft, and keeps what is typed as the draft", (tester) async {
      final backend = FakeBackend(role: UserRole.parent);
      final recorder = FakeVoiceRecorder();
      final player = FakeVoicePlayer();
      final store = InMemoryDraftStore();
      final conversationId = backend.listConversations().first.id;
      store.saved['parent-1'] = {conversationId: 'half a sentence'};
      final container = ProviderContainer(overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        voiceRecorderProvider.overrideWithValue(recorder),
        voicePlayerProvider.overrideWithValue(player),
        conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
        draftStoreProvider.overrideWithValue(store),
        principalIdProvider.overrideWithValue('parent-1'),
      ]);

      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: _app(ChatScreen(conversationId: conversationId, title: 'Jawwid')),
      ));
      await tester.pumpAndSettle();
      expect(find.text('half a sentence'), findsOneWidget);

      await tester.enterText(find.byType(TextField).last, 'half a sentence, finished');
      await tester.pump();
      expect(container.read(draftsProvider).value?[conversationId], 'half a sentence, finished');

      await tester.pumpWidget(const SizedBox());
      container.dispose();
      unawaited(recorder.dispose());
      unawaited(player.dispose());
      backend.dispose();
    }, timeout: const Timeout(Duration(seconds: 60)));
  });
}
