import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/bootstrap.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/features/messages/application/drafts_controller.dart';
import 'package:jawwid_chat/features/messages/data/draft_store.dart';
import 'package:jawwid_chat/features/messages/data/mention_repository.dart';
import 'package:jawwid_chat/features/messages/domain/mentions.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'fake_voice_devices.dart';

class _Who extends Notifier<String?> {
  @override
  String? build() => 'parent-1';
  void become(String? id) => state = id;
}

final _who = NotifierProvider<_Who, String?>(_Who.new);

/// The phone's keychain, in memory: every key, so a test can see what else is in it.
class _Keychain extends FlutterSecureStorage {
  final Map<String, String> values = {};

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async =>
      values[key];

  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async =>
      values.remove(key);

  @override
  Future<Map<String, String>> readAll({
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async =>
      Map.of(values);
}

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

Draft _d(String text) => Draft(text);

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
      store.saved['parent-1'] = {'c1': _d('see you at')};
      expect(await container.read(draftsProvider.future), {'c1': _d('see you at')});

      drafts().set('c2', _d('hel'));
      drafts().set('c2', _d('hello'));
      expect(container.read(draftsProvider).value, {'c1': _d('see you at'), 'c2': _d('hello')});
      expect(store.saved['parent-1'], {'c1': _d('see you at')}, reason: 'not on every keystroke');

      await Future<void>.delayed(DraftsController.saveAfter * 2);
      expect(store.saved['parent-1'], {'c1': _d('see you at'), 'c2': _d('hello')});
    });

    test('blank text (or a sent message) removes the draft', () async {
      store.saved['parent-1'] = {'c1': _d('x')};
      await container.read(draftsProvider.future);
      drafts().set('c1', _d('   '));
      expect(container.read(draftsProvider).value, isEmpty);
      await Future<void>.delayed(DraftsController.saveAfter * 2);
      expect(store.saved['parent-1'], isEmpty);
    });

    test("another account never sees, nor overwrites, the first one's drafts", () async {
      store.saved['parent-1'] = {'c1': _d('mine')};
      store.saved['teacher-2'] = {'c9': _d('theirs')};
      await container.read(draftsProvider.future);

      container.read(_who.notifier).become('teacher-2');
      expect(await container.read(draftsProvider.future), {'c9': _d('theirs')});
      drafts().set('c1', _d('typed by teacher'));
      await Future<void>.delayed(DraftsController.saveAfter * 2);
      expect(store.saved['parent-1'], {'c1': _d('mine')});
      expect(store.saved['teacher-2'], {'c9': _d('theirs'), 'c1': _d('typed by teacher')});
    });

    test('a keystroke before the drafts load is not written over the saved ones', () async {
      store.saved['parent-1'] = {'c1': _d('saved')};
      container.read(draftsProvider); // loading
      drafts().set('c1', _d(''));
      expect(await container.read(draftsProvider.future), {'c1': _d('saved')});
    });

    test('nobody signed in: drafts work in memory and nothing is stored', () async {
      container.read(_who.notifier).become(null);
      await container.read(draftsProvider.future);
      drafts().set('c1', _d('hi'));
      expect(container.read(draftsProvider).value, {'c1': _d('hi')});
      await Future<void>.delayed(DraftsController.saveAfter * 2);
      expect(store.saved, isEmpty);
    });

    test('THE SIGN-OUT RACE: a save still waiting when the drafts are cleared never writes them back', () async {
      await container.read(draftsProvider.future);
      drafts().set('c1', _d('typed just before signing out'));
      await store.clearAll(); // sign-out, inside the 400 ms
      expect(container.read(draftsProvider).value, isEmpty, reason: 'dropped from memory at once');
      await Future<void>.delayed(DraftsController.saveAfter * 2);
      expect(store.saved, isEmpty);
    });

    test('...nor does a save that had already started when the clear came', () async {
      final generation = store.generation;
      await store.clearAll();
      await store.save('parent-1', {'c1': _d('late')}, generation: generation);
      expect(store.saved, isEmpty);
    });
  });

  group('PD-37 SecureDraftStore', () {
    test('one entry per account in the secure store; sign-out deletes every draft and nothing else', () async {
      final keychain = _Keychain()..values['jawwid.refresh_token'] = 'stays';
      final store = SecureDraftStore(storage: keychain);
      final g = store.generation;
      await store.save('a', {'c1': _d('one'), 'c2': _d('اثنان')}, generation: g);
      await store.save('b', {'c3': _d('three')}, generation: g);
      expect(await store.load('a'), {'c1': _d('one'), 'c2': _d('اثنان')});
      expect(await store.load('b'), {'c3': _d('three')});

      await store.save('b', const {}, generation: g);
      expect(keychain.values.containsKey('jawwid.drafts.b'), isFalse);

      await store.clearAll();
      expect(await store.load('a'), isEmpty);
      expect(keychain.values, {'jawwid.refresh_token': 'stays'});
    });

    test('a damaged entry is dropped, never shown', () async {
      final keychain = _Keychain()
        ..values['jawwid.drafts.a'] = '{not json'
        ..values['jawwid.drafts.b'] = '{"c1": 3, "c2": {"text": "ok"}, "c3": {"nope": 1}}';
      final store = SecureDraftStore(storage: keychain);
      expect(await store.load('a'), isEmpty);
      expect(await store.load('b'), {'c2': _d('ok')});
    });

    test('a draft keeps its picked mentions', () async {
      final store = SecureDraftStore(storage: _Keychain());
      const draft = Draft('@Omar and @Teachers, hi', mentions: [
        PickedMention.person('Omar', 'actor-1'),
        PickedMention.role('Teachers', 'teacher'),
      ]);
      await store.save('a', {'c1': draft}, generation: store.generation);
      final back = (await store.load('a'))['c1']!;
      expect(back, draft);
      expect(back.mentions.first.actorId, 'actor-1');
      expect(back.mentions.last.role, 'teacher');
    });
  });

  group('PD-37 sign-out deletes the drafts (the composition root)', () {
    test('a forced sign-out mid-typing leaves no draft, in memory or on the device', () async {
      final container = ProviderContainer(overrides: await bootstrap());
      addTearDown(container.dispose);
      await container.read(authControllerProvider.notifier).signIn(username: 'parent', password: 'pw');
      expect(container.read(principalIdProvider), isNotNull);
      await container.read(draftsProvider.future);
      final store = container.read(draftStoreProvider) as InMemoryDraftStore;

      container.read(draftsProvider.notifier).set('c1', _d('saved before'));
      await Future<void>.delayed(DraftsController.saveAfter * 2);
      expect(store.saved.values.single, {'c1': _d('saved before')});

      container.read(draftsProvider.notifier).set('c1', _d('mid-typing'));
      await container.read(authControllerProvider.notifier).signOut(serverAlreadyEnded: true);
      await Future<void>.delayed(DraftsController.saveAfter * 2);
      expect(store.saved, isEmpty);
      expect(container.read(draftsProvider).value ?? const {}, isEmpty);
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
    testWidgets('puts the saved draft back without saying "typing" -- not even at the first tap -- and a send clears it',
        (tester) async {
      final said = <String>[];
      final kept = <Draft>[];
      final sent = <String>[];
      Widget composer(Draft? draft) => _app(MessageComposer(
            onSend: sent.add,
            onDraftChanged: said.add,
            onDraft: kept.add,
            initialDraft: draft,
          ));

      await tester.pumpWidget(composer(_d('see you')));
      expect(find.text('see you'), findsOneWidget);
      expect(said, isEmpty, reason: 'restoring a draft is not typing');

      // A tap in the field moves the caret; the text is the restored one.
      tester.widget<TextField>(find.byType(TextField)).controller!.selection = const TextSelection.collapsed(offset: 3);
      await tester.pump();
      expect(said, isEmpty, reason: 'nor is tapping into it');
      expect(kept, isEmpty);

      await tester.enterText(find.byType(TextField), 'see you at five');
      expect(said.last, 'see you at five');
      expect(kept.last, _d('see you at five'));
      await tester.tap(find.byTooltip(lookupL10n(const Locale('en')).composerSend));
      await tester.pump();
      expect(sent, ['see you at five']);
      expect(said.last, '', reason: 'a sent message leaves no draft');
      expect(kept.last.isBlank, isTrue);
    });

    testWidgets('a restored draft is sent with its mentions', (tester) async {
      final sent = <(String, int)>[];
      await tester.pumpWidget(_app(MessageComposer(
        onSend: (_) {},
        onSendWithMentions: (body, mentions) => sent.add((body, mentions.length)),
        mentionCandidates: (_) async => const MentionCandidates(),
        initialDraft: const Draft('@Omar see you', mentions: [PickedMention.person('Omar', 'actor-1')]),
      )));
      await tester.tap(find.byTooltip(lookupL10n(const Locale('en')).composerSend));
      await tester.pump();
      expect(sent, [('@Omar see you', 1)]);
    });

    testWidgets('a draft that loads after the screen opens is adopted -- never over typed text', (tester) async {
      final said = <String>[];
      Widget composer(Draft? draft) => _app(MessageComposer(onSend: (_) {}, onDraftChanged: said.add, initialDraft: draft));

      await tester.pumpWidget(composer(null));
      await tester.pumpWidget(composer(_d('loaded late')));
      expect(find.text('loaded late'), findsOneWidget);
      expect(said, isEmpty, reason: 'a late draft is not typing either');

      await tester.pumpWidget(_app(const SizedBox()));
      await tester.pumpWidget(composer(null));
      await tester.enterText(find.byType(TextField), 'typed first');
      await tester.pumpWidget(composer(_d('loaded late')));
      expect(find.text('typed first'), findsOneWidget);
    });
  });

  group('PD-37 the chat screen', () {
    late FakeBackend backend;
    late FakeVoiceRecorder recorder;
    late FakeVoicePlayer player;
    late InMemoryDraftStore store;
    late String conversationId;

    setUp(() {
      backend = FakeBackend(role: UserRole.parent);
      recorder = FakeVoiceRecorder();
      player = FakeVoicePlayer();
      store = InMemoryDraftStore();
      conversationId = backend.listConversations().first.id;
    });
    tearDown(() {
      unawaited(recorder.dispose());
      unawaited(player.dispose());
      backend.dispose();
    });

    ProviderContainer containerFor() => ProviderContainer(overrides: [
          currentRoleProvider.overrideWithValue(UserRole.parent),
          voiceRecorderProvider.overrideWithValue(recorder),
          voicePlayerProvider.overrideWithValue(player),
          conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
          messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
          draftStoreProvider.overrideWithValue(store),
          principalIdProvider.overrideWith((ref) => ref.watch(_who)),
        ]);

    testWidgets("opens with this chat's draft, and keeps what is typed as the draft", (tester) async {
      store.saved['parent-1'] = {conversationId: _d('half a sentence')};
      final container = containerFor();
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: _app(ChatScreen(conversationId: conversationId, title: 'Jawwid')),
      ));
      await tester.pumpAndSettle();
      expect(find.text('half a sentence'), findsOneWidget);

      await tester.enterText(find.byType(TextField).last, 'half a sentence, finished');
      await tester.pump();
      expect(container.read(draftsProvider).value?[conversationId], _d('half a sentence, finished'));

      await tester.pumpWidget(const SizedBox());
      container.dispose();
    }, timeout: const Timeout(Duration(seconds: 60)));

    testWidgets("an account switch with the chat open: the new account sees its own draft, never the last one's text",
        (tester) async {
      store.saved['parent-1'] = {conversationId: _d('first account, private')};
      store.saved['parent-2'] = {conversationId: _d('second account')};
      final container = containerFor();
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: _app(ChatScreen(conversationId: conversationId, title: 'Jawwid')),
      ));
      await tester.pumpAndSettle();
      expect(find.text('first account, private'), findsOneWidget);

      container.read(_who.notifier).become('parent-2');
      await tester.pumpAndSettle();
      expect(find.text('first account, private'), findsNothing);
      expect(find.text('second account'), findsOneWidget);

      await tester.enterText(find.byType(TextField).last, 'second account, edited');
      await tester.pump(DraftsController.saveAfter * 2);
      expect(store.saved['parent-2'], {conversationId: _d('second account, edited')});
      expect(store.saved['parent-1'], {conversationId: _d('first account, private')});

      await tester.pumpWidget(const SizedBox());
      container.dispose();
    }, timeout: const Timeout(Duration(seconds: 60)));
  });
}
