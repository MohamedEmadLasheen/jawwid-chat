import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart' show TokenProvider;
import 'package:jawwid_chat/core/realtime/call_realtime_client.dart';
import 'package:jawwid_chat/core/realtime/chat_signal.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/conversations/application/chat_realtime.dart';
import 'package:jawwid_chat/features/conversations/application/conversations_controller.dart';
import 'package:jawwid_chat/features/messages/domain/typing_sender.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/message_actions.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'fake_voice_devices.dart';

/// A transport that receives AND sends -- what the real socket.io one is.
class _SendingSocket implements RealtimeSocket, RealtimeEmitter {
  final _frames = StreamController<RealtimeFrame>.broadcast();
  final _states = StreamController<RealtimeSocketState>.broadcast();
  final sent = <({String event, Map<String, Object?> payload})>[];

  @override
  Stream<RealtimeFrame> get frames => _frames.stream;
  @override
  Stream<RealtimeSocketState> get states => _states.stream;
  @override
  Future<void> connect(String token) async => _states.add(RealtimeSocketState.connected);
  @override
  Future<SubscriptionResult> subscribe(String conversationId) async => const SubscriptionResult(ok: true);
  @override
  Future<void> unsubscribe(String conversationId) async {}
  @override
  Future<void> dispose() async {}
  @override
  void emit(String event, Map<String, Object?> payload) => sent.add((event: event, payload: payload));

  /// The server publishes a frame to this socket.
  void serverSends(String event, Object? payload) => _frames.add(RealtimeFrame(event, payload));

  Future<void> close() async {
    await _frames.close();
    await _states.close();
  }
}

/// A transport that only receives: the client must never try to send through it.
class _ReceiveOnlySocket implements RealtimeSocket {
  @override
  Stream<RealtimeFrame> get frames => const Stream.empty();
  @override
  Stream<RealtimeSocketState> get states => const Stream.empty();
  @override
  Future<void> connect(String token) async {}
  @override
  Future<SubscriptionResult> subscribe(String conversationId) async => const SubscriptionResult(ok: true);
  @override
  Future<void> unsubscribe(String conversationId) async {}
  @override
  Future<void> dispose() async {}
}

class _Tokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'token';
  @override
  Future<String?> refresh() async => 'token';
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

Message _mine({ApprovalState approval = ApprovalState.notRequired, bool mine = true}) => Message(
      id: 'm1',
      clientMessageId: 'c1',
      conversationId: 'conv',
      sequence: 1,
      authorId: mine ? 'me' : 'them',
      authorName: 'x',
      authorRole: ParticipantRole.parent,
      kind: MessageKind.text,
      body: 'hello',
      deliveryState: DeliveryState.sent,
      approvalState: approval,
      createdAt: DateTime.utc(2026, 10, 27),
      isMine: mine,
    );

void main() {
  group('PD-37 signals', () {
    test('message.status is a "message changed" signal: the open thread re-reads its ticks', () {
      final s = decodeChatSignal('message.status', {'conversationId': 'c', 'items': <Object?>[]});
      expect(s?.kind, ChatSignalKind.messageChanged);
      expect(s?.conversationId, 'c');
    });

    test('typing frames decode to typing signals, and nothing incomplete does', () {
      final on = decodeTypingSignal('typing.started', {'conversationId': 'c', 'actorId': 'a', 'displayName': 'Omar'});
      expect(on?.typing, isTrue);
      expect(on?.displayName, 'Omar');
      expect(decodeTypingSignal('typing.stopped', {'conversationId': 'c', 'actorId': 'a'})?.typing, isFalse);
      expect(decodeTypingSignal('typing.started', {'conversationId': 'c'}), isNull);
      expect(decodeTypingSignal('typing.started', {'actorId': 'a'}), isNull);
      expect(decodeTypingSignal('message.created', {'conversationId': 'c', 'actorId': 'a'}), isNull);
      // ...and a typing frame is never a chat (refetch) signal.
      expect(decodeChatSignal('typing.started', {'conversationId': 'c', 'actorId': 'a'}), isNull);
    });
  });

  group('PD-37 client', () {
    test('typing frames reach typingSignals; send goes out only through a transport that can send', () async {
      final socket = _SendingSocket();
      final client = CallRealtimeClient(socket: socket, tokens: _Tokens());
      await client.connect();
      final heard = <TypingSignal>[];
      final sub = client.typingSignals.listen(heard.add);

      socket.serverSends('typing.started', {'conversationId': 'c', 'actorId': 'a', 'displayName': 'Omar'});
      await pumpEventQueue();
      expect(heard.single.actorId, 'a');

      client.send('typing.start', {'conversationId': 'c'});
      expect(socket.sent.single.event, 'typing.start');

      unawaited(sub.cancel());
      await client.dispose();
      client.send('typing.stop', {'conversationId': 'c'});
      expect(socket.sent, hasLength(1), reason: 'nothing is sent once disposed');
      await socket.close();

      final silent = CallRealtimeClient(socket: _ReceiveOnlySocket(), tokens: _Tokens());
      silent.send('typing.start', {'conversationId': 'c'}); // a no-op, not a crash
      await silent.dispose();
    });

    test('an arriving message is acknowledged as delivered, as a cursor', () async {
      final backend = FakeBackend(role: UserRole.parent);
      final socket = _SendingSocket();
      final client = CallRealtimeClient(socket: socket, tokens: _Tokens());
      final coordinator = Provider<ChatRealtimeCoordinator>((ref) {
        final c = ChatRealtimeCoordinator(ref, client, listRefreshDebounce: const Duration(milliseconds: 5));
        ref.onDispose(c.dispose);
        c.start();
        return c;
      });
      final container = ProviderContainer(overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
        messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
      ]);
      await client.connect();
      container.read(coordinator);
      await container.read(conversationsControllerProvider.future);

      socket.serverSends('message.created', {'conversationId': 'conv-9', 'seq': '42'});
      await pumpEventQueue();
      expect(
        socket.sent.where((s) => s.event == 'message.delivered').map((s) => s.payload),
        [
          {'conversationId': 'conv-9', 'upToSeq': '42'},
        ],
      );

      container.dispose();
      await client.dispose();
      await socket.close();
      backend.dispose();
    });
  });

  group('PD-37 TypingSender', () {
    test('one start per ping interval while typing; a pause, an empty draft or dispose is a stop', () async {
      final sent = <bool>[];
      var clock = DateTime.utc(2026, 10, 27);
      // The real intervals are 3 s and 5 s; the clock is injected and the pause shortened.
      final sender = TypingSender(send: sent.add, now: () => clock, stopAfter: const Duration(milliseconds: 40));

      sender.typed('h');
      sender.typed('he');
      expect(sent, [true]);

      clock = clock.add(const Duration(seconds: 3));
      sender.typed('hel');
      expect(sent, [true, true]);

      await Future<void>.delayed(const Duration(milliseconds: 80)); // a pause
      expect(sent, [true, true, false]);

      sender.typed('again');
      sender.typed(''); // cleared, or sent
      expect(sent, [true, true, false, true, false]);

      sender.dispose(); // nothing active: no second stop
      expect(sent, [true, true, false, true, false]);
    });
  });

  group('PD-37 Message info action', () {
    test("only on one's own published message, and only where the route exists", () {
      expect(actionsFor(_mine(), withInfo: true), contains(MessageAction.info));
      expect(actionsFor(_mine(), withInfo: false), isNot(contains(MessageAction.info)));
      expect(actionsFor(_mine(mine: false), withInfo: true), isNot(contains(MessageAction.info)));
      expect(actionsFor(_mine(approval: ApprovalState.pending), withInfo: true), isNot(contains(MessageAction.info)));
    });
  });

  group('PD-37 the chat screen', () {
    testWidgets("shows someone else's typing above the composer, never this account's own, and says when this person types",
        (tester) async {
      final backend = FakeBackend(role: UserRole.parent);
      final socket = _SendingSocket();
      final client = CallRealtimeClient(socket: socket, tokens: _Tokens());
      final recorder = FakeVoiceRecorder();
      final player = FakeVoicePlayer();
      final conversationId = backend.listConversations().first.id;
      // Connected in the test's own zone, so its frames reach the screen as the
      // test pumps (a connect inside runAsync would listen in another zone).
      unawaited(client.connect());
      await tester.pump();

      await tester.pumpWidget(ProviderScope(
        overrides: [
          currentRoleProvider.overrideWithValue(UserRole.parent),
          voiceRecorderProvider.overrideWithValue(recorder),
          voicePlayerProvider.overrideWithValue(player),
          conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
          messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
          chatRealtimeClientProvider.overrideWithValue(client),
          viewerActorIdProvider.overrideWithValue(() => 'me-id'),
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
          home: ChatScreen(conversationId: conversationId, title: 'Jawwid'),
        ),
      ));
      await tester.pumpAndSettle();
      // One frame delivers a signal (setState), the next draws it.
      Future<void> deliver() async {
        await tester.pump();
        await tester.pump();
      }

      // Another device of this same account: not "someone else".
      socket.serverSends('typing.started', {'conversationId': conversationId, 'actorId': 'me-id', 'displayName': 'Me'});
      // Another chat entirely.
      socket.serverSends('typing.started', {'conversationId': 'elsewhere', 'actorId': 't9', 'displayName': 'Elsewhere'});
      await deliver();
      expect(find.textContaining('is typing'), findsNothing);

      socket.serverSends('typing.started', {'conversationId': conversationId, 'actorId': 't1', 'displayName': 'Omar'});
      await deliver();
      expect(find.text('Omar is typing…'), findsOneWidget);
      socket.serverSends('typing.stopped', {'conversationId': conversationId, 'actorId': 't1', 'displayName': 'Omar'});
      await deliver();
      expect(find.text('Omar is typing…'), findsNothing);

      // This person types: one typing.start for this chat, throttled.
      await tester.enterText(find.byType(TextField).last, 'hel');
      await tester.enterText(find.byType(TextField).last, 'hello');
      await tester.pump();
      expect(
        socket.sent.where((x) => x.event == 'typing.start').map((x) => x.payload),
        [
          {'conversationId': conversationId},
        ],
      );

      await tester.pumpWidget(const SizedBox()); // leaving the chat is a stop
      expect(socket.sent.last.event, 'typing.stop');
      // Torn down without waiting: inside a widget test's fake clock, awaiting
      // a broadcast subscription's cancel can wait for good.
      unawaited(recorder.dispose());
      unawaited(player.dispose());
      unawaited(client.dispose());
      unawaited(socket.close());
      backend.dispose();
    }, timeout: const Timeout(Duration(seconds: 60)));
  });
}
