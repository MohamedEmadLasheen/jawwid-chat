import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/conversations/application/conversations_controller.dart';
import 'package:jawwid_chat/features/messages/application/messages_controller.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'fake_voice_devices.dart';

/// A conversation repository that records every read watermark it was given.
///
/// Wrapped around the fixture rather than replacing it, so the messages and the
/// unread count stay consistent with what the screen is actually rendering.
class _ReadRecordingRepository implements ConversationRepository {
  _ReadRecordingRepository(this._inner);

  final ConversationRepository _inner;

  /// (conversationId, throughSequence) for every call that reached the server.
  final reads = <(String, int)>[];

  @override
  Future<void> markRead(String conversationId, {required int throughSequence}) {
    reads.add((conversationId, throughSequence));
    return _inner.markRead(conversationId, throughSequence: throughSequence);
  }

  @override
  Future<List<Conversation>> list({bool includeArchived = false}) =>
      _inner.list(includeArchived: includeArchived);

  @override
  Future<Conversation> byId(String conversationId) => _inner.byId(conversationId);

  @override
  Future<void> setPinned(String conversationId, bool pinned) =>
      _inner.setPinned(conversationId, pinned);

  @override
  Future<void> setMuted(String conversationId, bool muted) =>
      _inner.setMuted(conversationId, muted);

  @override
  Future<void> setArchived(String conversationId, bool archived) =>
      _inner.setArchived(conversationId, archived);

  @override
  Future<List<Conversation>> search(String query) => _inner.search(query);
}

/// When unread clears, and — more importantly — when it does not.
///
/// The rule the product wants: a parent who opens a conversation and is looking
/// at the newest message has read it; a parent who has scrolled back through
/// history has **not** read what arrived above them, and clearing the badge
/// there would hide the very message they came back for.
///
/// The list is reversed, so "at the bottom" means offset 0 — the newest
/// message — which is where opening a conversation lands.
void main() {
  late FakeBackend backend;
  late FakeVoiceRecorder recorder;
  late FakeVoicePlayer player;
  late _ReadRecordingRepository conversations;

  const conversationId = 'c_support';

  setUp(() {
    backend = FakeBackend(role: UserRole.parent);
    recorder = FakeVoiceRecorder();
    player = FakeVoicePlayer();
    conversations = _ReadRecordingRepository(FakeConversationRepository(backend));
  });

  tearDown(() {
    recorder.dispose();
    player.dispose();
    backend.dispose();
  });

  /// The chat screen's own scroll controller — the one `_onScroll` listens to.
  ///
  /// Not `find.byType(Scrollable).last`: there is more than one scrollable in
  /// this tree, and driving the wrong one moves nothing the screen is watching.
  ScrollController messageList(WidgetTester tester) =>
      tester.widget<ListView>(find.byType(ListView)).controller!;

  /// Enough history that the list actually scrolls.
  void seedHistory({int count = 40}) {
    for (var i = 0; i < count; i++) {
      backend.appendIncoming(conversationId, 'رسالة رقم $i');
    }
  }

  late ProviderContainer container;

  Widget harness() {
    return UncontrolledProviderScope(
      container: container = ProviderContainer(
        overrides: [
          currentRoleProvider.overrideWithValue(UserRole.parent),
          voiceRecorderProvider.overrideWithValue(recorder),
          voicePlayerProvider.overrideWithValue(player),
          conversationRepositoryProvider.overrideWithValue(conversations),
          messageRepositoryProvider
              .overrideWithValue(FakeMessageRepository(backend)),
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
        home: const ChatScreen(
          conversationId: conversationId,
          title: 'جَوِّد',
        ),
      ),
    );
  }

  tearDown(() => container.dispose());

  testWidgets('opening a conversation marks it read through the newest message',
      (tester) async {
    seedHistory();
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    expect(conversations.reads, hasLength(1));
    expect(
      conversations.reads.single.$2,
      backend.highestSequence(conversationId),
      reason: 'the watermark is the newest message, not a guess',
    );
  });

  testWidgets('the conversation list unread count drops to zero', (tester) async {
    seedHistory();
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    await container.read(conversationsControllerProvider.future);
    expect(container.read(totalUnreadProvider), 0);
  });

  testWidgets('scrolling back through history does NOT mark later arrivals read',
      (tester) async {
    seedHistory();
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    final readsOnOpen = conversations.reads.length;

    // Reach back in time. The list is reversed, so older content is a *larger*
    // offset; driven through the position rather than by a drag whose required
    // distance depends on how much history happens to be loaded.
    messageList(tester).jumpTo(600);
    await tester.pumpAndSettle();

    // Something arrives while the parent is reading older messages.
    backend.appendIncoming(conversationId, 'رسالة جديدة أثناء القراءة');
    await container
        .read(messagesControllerProvider(conversationId).notifier)
        .resync();
    await tester.pumpAndSettle();

    expect(
      conversations.reads.length,
      readsOnOpen,
      reason: 'a message that arrived above the reader has not been read',
    );
  });

  testWidgets('returning to the newest message then clears it', (tester) async {
    seedHistory();
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    messageList(tester).jumpTo(600);
    await tester.pumpAndSettle();

    backend.appendIncoming(conversationId, 'رسالة جديدة');
    await container
        .read(messagesControllerProvider(conversationId).notifier)
        .resync();
    await tester.pumpAndSettle();

    final whileAway = conversations.reads.length;

    // Back to the newest message. Driven through the screen's own controller
    // rather than by a drag: the distance a drag has to cover depends on how
    // much history happens to be loaded, and a test that scrolls "probably far
    // enough" is a test that passes for the wrong reason.
    messageList(tester).jumpTo(0);
    await tester.pumpAndSettle();
    expect(
      conversations.reads.length,
      greaterThan(whileAway),
      reason: 'once the parent is looking at the latest message it is read',
    );
    expect(
      conversations.reads.last.$2,
      backend.highestSequence(conversationId),
    );
  });

  testWidgets('a message read after the first read still reaches the server',
      (tester) async {
    // The badge is already clear at this point. Dedupe is by watermark, not by
    // badge: skipping this call is how a server-side unread survives a read and
    // comes back on the next load.
    seedHistory();
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    backend.appendIncoming(conversationId, 'رسالة لاحقة');
    await container
        .read(messagesControllerProvider(conversationId).notifier)
        .resync();
    await tester.pumpAndSettle();

    expect(conversations.reads, hasLength(2));
    expect(
      conversations.reads.last.$2,
      backend.highestSequence(conversationId),
    );
  });

  testWidgets('the same watermark is never reported twice', (tester) async {
    seedHistory();
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();

    // Rebuilds with nothing new must not chatter at the server.
    await tester.pump();
    await tester.pump();
    await tester.pumpAndSettle();

    expect(conversations.reads, hasLength(1));
  });
}
