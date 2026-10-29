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
import 'package:jawwid_chat/features/messages/application/chat_typing_channel.dart';
import 'package:jawwid_chat/features/messages/data/receipt_repository.dart';
import 'package:jawwid_chat/features/messages/data/typing_repository.dart';
import 'package:jawwid_chat/features/messages/domain/typing_sender.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen.dart';
import 'package:jawwid_chat/features/messages/presentation/message_actions.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'fake_voice_devices.dart';

/// The server side of the socket: frames in, nothing out.
class _Socket implements RealtimeSocket {
  final _frames = StreamController<RealtimeFrame>.broadcast();
  final _states = StreamController<RealtimeSocketState>.broadcast();

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

  /// The server publishes a frame to this socket.
  void serverSends(String event, Object? payload) => _frames.add(RealtimeFrame(event, payload));

  Future<void> close() async {
    await _frames.close();
    await _states.close();
  }
}

class _Tokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => 'token';
  @override
  Future<String?> refresh() async => 'token';
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// Records delivery cursors; no Message info.
class _Receipts implements ReceiptRepository {
  final cursors = <(String, int)>[];

  @override
  bool get isAvailable => true;
  @override
  Future<MessageInfo> info(String conversationId, String messageId) async => const MessageInfo();
  @override
  Future<void> delivered(String conversationId, int upToSeq) async => cursors.add((conversationId, upToSeq));
}

/// Records what this person said about typing.
class _TypingOut implements TypingRepository {
  final said = <(String, bool)>[];

  @override
  bool get isAvailable => true;
  @override
  Future<void> typing(String conversationId, bool typing) async => said.add((conversationId, typing));
}

Message _message({ApprovalState approval = ApprovalState.notRequired, bool mine = true}) => Message(
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

  group('PD-37 ChatTypingChannel', () {
    test('passes typing frames on, ignores every other frame, and stops when disposed', () async {
      final socket = _Socket();
      final channel = ChatTypingChannel(socket);
      final heard = <String>[];
      final sub = channel.signals.listen((s) => heard.add('${s.actorId}:${s.typing}'));

      socket.serverSends('typing.started', {'conversationId': 'c', 'actorId': 'a', 'displayName': 'Omar'});
      socket.serverSends('message.created', {'conversationId': 'c', 'seq': '1'});
      socket.serverSends('typing.stopped', {'conversationId': 'c', 'actorId': 'a'});
      await pumpEventQueue();
      expect(heard, ['a:true', 'a:false']);

      channel.dispose();
      socket.serverSends('typing.started', {'conversationId': 'c', 'actorId': 'b'});
      await pumpEventQueue();
      expect(heard, ['a:true', 'a:false']);
      unawaited(sub.cancel());
      await socket.close();
    });
  });

  group('PD-37 delivery cursor', () {
    test('an arriving message is acknowledged as delivered, as a cursor', () async {
      final backend = FakeBackend(role: UserRole.parent);
      final socket = _Socket();
      final client = CallRealtimeClient(socket: socket, tokens: _Tokens());
      final receipts = _Receipts();
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
        receiptRepositoryProvider.overrideWithValue(receipts),
      ]);
      await client.connect();
      container.read(coordinator);
      await container.read(conversationsControllerProvider.future);

      socket.serverSends('message.created', {'conversationId': 'conv-9', 'seq': '42'});
      await pumpEventQueue();
      expect(receipts.cursors, [('conv-9', 42)]);

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

  group('PD-37 the composer says "typing" only when the TEXT changes', () {
    testWidgets('a caret move or a selection -- a tap in the field -- is not typing', (tester) async {
      final said = <String>[];
      await tester.pumpWidget(MaterialApp(
        locale: const Locale('en'),
        theme: JawwidTheme.light(isArabic: false),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Scaffold(body: MessageComposer(onSend: (_) {}, onDraftChanged: said.add)),
      ));
      await tester.enterText(find.byType(TextField), 'hello');
      expect(said, ['hello']);

      final field = tester.widget<TextField>(find.byType(TextField)).controller!;
      field.selection = const TextSelection.collapsed(offset: 2);
      field.selection = const TextSelection(baseOffset: 0, extentOffset: 5);
      await tester.pump();
      expect(said, ['hello'], reason: 'the text did not change');

      await tester.enterText(find.byType(TextField), 'hello!');
      expect(said, ['hello', 'hello!']);
    });
  });

  group('PD-37 Message info action', () {
    test("only on one's own published message, and only where the route exists", () {
      expect(actionsFor(_message(), withInfo: true), contains(MessageAction.info));
      expect(actionsFor(_message(), withInfo: false), isNot(contains(MessageAction.info)));
      expect(actionsFor(_message(mine: false), withInfo: true), isNot(contains(MessageAction.info)));
      expect(actionsFor(_message(approval: ApprovalState.pending), withInfo: true), isNot(contains(MessageAction.info)));
    });
  });

  group('PD-37 the chat screen', () {
    testWidgets("shows someone else's typing above the composer (never this account's own other device, never another chat), and says when this person types",
        (tester) async {
      final backend = FakeBackend(role: UserRole.parent);
      final socket = _Socket();
      final channel = ChatTypingChannel(socket);
      final recorder = FakeVoiceRecorder();
      final player = FakeVoicePlayer();
      final typingOut = _TypingOut();
      final conversationId = backend.listConversations().first.id;

      await tester.pumpWidget(ProviderScope(
        overrides: [
          currentRoleProvider.overrideWithValue(UserRole.parent),
          voiceRecorderProvider.overrideWithValue(recorder),
          voicePlayerProvider.overrideWithValue(player),
          conversationRepositoryProvider.overrideWithValue(FakeConversationRepository(backend)),
          messageRepositoryProvider.overrideWithValue(FakeMessageRepository(backend)),
          chatTypingChannelProvider.overrideWithValue(channel),
          typingRepositoryProvider.overrideWithValue(typingOut),
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

      socket.serverSends('typing.started', {'conversationId': conversationId, 'actorId': 'me-id', 'displayName': 'Me'});
      socket.serverSends('typing.started', {'conversationId': 'elsewhere', 'actorId': 't9', 'displayName': 'Elsewhere'});
      await deliver();
      expect(find.textContaining('is typing'), findsNothing);

      socket.serverSends('typing.started', {'conversationId': conversationId, 'actorId': 't1', 'displayName': 'Omar'});
      await deliver();
      expect(find.text('Omar is typing…'), findsOneWidget);
      socket.serverSends('typing.stopped', {'conversationId': conversationId, 'actorId': 't1', 'displayName': 'Omar'});
      await deliver();
      expect(find.text('Omar is typing…'), findsNothing);

      // This person types: one "typing" for this chat over HTTP, throttled.
      await tester.enterText(find.byType(TextField).last, 'hel');
      await tester.enterText(find.byType(TextField).last, 'hello');
      await tester.pump();
      expect(typingOut.said, [(conversationId, true)]);

      await tester.pumpWidget(const SizedBox()); // leaving the chat is a stop
      expect(typingOut.said.last, (conversationId, false));
      // Torn down without waiting: inside a widget test's fake clock, awaiting
      // a broadcast subscription's cancel can wait for good.
      unawaited(recorder.dispose());
      unawaited(player.dispose());
      channel.dispose();
      unawaited(socket.close());
      backend.dispose();
    }, timeout: const Timeout(Duration(seconds: 60)));
  });
}
