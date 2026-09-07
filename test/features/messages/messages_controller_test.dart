import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/realtime/realtime_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_events.dart';
import 'package:jawwid_chat/features/messages/application/messages_controller.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// A repository that records what it was asked to send and can be told to fail.
class _RecordingMessageRepository implements MessageRepository {
  final sent = <OutgoingMessage>[];
  final history_ = <Message>[];
  final edits = <(String, String)>[];
  final reactions = <(String, String?)>[];
  final deletedForMe = <String>[];
  final deletedForEveryone = <String>[];
  final forwarded = <(String, List<String>)>[];
  final markedDelivered = <String>[];
  int historyReads = 0;

  AppError? failWith;
  int failuresRemaining = 0;
  int _sequence = 0;

  @override
  Future<Page<Message>> history(
    String conversationId, {
    String? beforeCursor,
    int limit = 30,
  }) async {
    historyReads++;
    return Page(items: List.of(history_), hasMore: false);
  }

  @override
  Future<List<Message>> since(
    String conversationId, {
    required int afterSequence,
  }) async =>
      history_.where((m) => (m.sequence ?? 0) > afterSequence).toList();

  @override
  Future<Message> send(OutgoingMessage message) async {
    sent.add(message);

    if (failuresRemaining > 0) {
      failuresRemaining--;
      throw failWith ?? const AppError(AppErrorKind.network);
    }

    // Idempotent: the same client id yields the same server message.
    final existing =
        history_.where((m) => m.clientMessageId == message.clientMessageId);
    if (existing.isNotEmpty) return existing.first;

    final confirmed = Message(
      id: 'srv_${++_sequence}',
      clientMessageId: message.clientMessageId,
      conversationId: message.conversationId,
      sequence: _sequence,
      kind: message.kind,
      body: message.body,
      createdAt: DateTime.utc(2026, 9, 5, 12, _sequence),
      deliveryState: DeliveryState.sent,
      isMine: true,
    );
    history_.add(confirmed);
    return confirmed;
  }

  @override
  Future<Message> edit({
    required String conversationId,
    required String messageId,
    required String body,
  }) async {
    edits.add((messageId, body));
    if (failuresRemaining > 0) {
      failuresRemaining--;
      throw failWith ?? const AppError(AppErrorKind.forbidden);
    }
    final index = history_.indexWhere((m) => m.id == messageId);
    final updated =
        history_[index].copyWith(body: body, editedAt: DateTime.utc(2026, 9, 5, 13));
    history_[index] = updated;
    return updated;
  }

  @override
  Future<void> deleteForMe({
    required String conversationId,
    required String messageId,
  }) async {
    if (failuresRemaining > 0) {
      failuresRemaining--;
      throw failWith ?? const AppError(AppErrorKind.forbidden);
    }
    deletedForMe.add(messageId);
    history_.removeWhere((m) => m.id == messageId);
  }

  @override
  Future<void> deleteForEveryone({
    required String conversationId,
    required String messageId,
    required String reason,
  }) async {
    if (failuresRemaining > 0) {
      failuresRemaining--;
      throw failWith ?? const AppError(AppErrorKind.forbidden);
    }
    deletedForEveryone.add(messageId);
  }

  @override
  Future<List<Message>> forward({
    required String conversationId,
    required String messageId,
    required List<String> toConversationIds,
  }) async {
    forwarded.add((messageId, toConversationIds));
    return const [];
  }

  @override
  Future<void> react(String conversationId, String messageId, String emoji) async {
    if (failuresRemaining > 0) {
      failuresRemaining--;
      throw failWith ?? const AppError(AppErrorKind.forbidden);
    }
    reactions.add((messageId, emoji));
  }

  @override
  Future<void> removeReaction(String conversationId, String messageId) async {
    reactions.add((messageId, null));
  }

  @override
  Future<void> markDelivered({
    required String conversationId,
    required String messageId,
  }) async =>
      markedDelivered.add(messageId);

  @override
  Future<List<MessageSearchHit>> search(MessageSearchQuery query) async => const [];

  @override
  Future<void> setTyping(String conversationId, {required bool isTyping}) async {}
}

/// A conversation repository that records the read cursors it was given.
class _RecordingConversationRepository implements ConversationRepository {
  final readCursors = <int>[];

  @override
  Future<List<Conversation>> list({bool includeArchived = false}) async => const [];

  @override
  Future<Conversation> byId(String conversationId) async =>
      throw const AppError(AppErrorKind.notFound);

  @override
  Future<void> setPinned(String conversationId, bool pinned) async {}

  @override
  Future<void> setMuted(String conversationId, bool muted) async {}

  @override
  Future<void> setArchived(String conversationId, bool archived) async {}

  @override
  Future<void> markRead(String conversationId, {required int throughSequence}) async =>
      readCursors.add(throughSequence);

  @override
  Future<List<Conversation>> search(String query) async => const [];
}

void main() {
  late _RecordingMessageRepository repository;
  late _RecordingConversationRepository conversations;
  late FakeRealtimeClient realtime;
  late ProviderContainer container;

  setUp(() {
    repository = _RecordingMessageRepository();
    conversations = _RecordingConversationRepository();
    realtime = FakeRealtimeClient();
    container = ProviderContainer(
      overrides: [
        messageRepositoryProvider.overrideWithValue(repository),
        conversationRepositoryProvider.overrideWithValue(conversations),
        realtimeClientProvider.overrideWithValue(realtime),
      ],
    );
  });

  tearDown(() => container.dispose());

  MessagesController controller() =>
      container.read(messagesControllerProvider('c1').notifier);

  MessagesState read() => container.read(messagesControllerProvider('c1'));

  /// Let the microtask queue and any zero-length timers run.
  Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 10));

  group('sending', () {
    test('echoes the message immediately as queued, never as sent', () async {
      final c = controller();
      await settle();

      c.send('السلام عليكم');

      final echo = read().log.messages.single;
      expect(echo.deliveryState.isLocal, isTrue);
      expect(
        echo.deliveryState,
        anyOf(DeliveryState.queued, DeliveryState.sending),
        reason: 'the client may only author queued/sending/failed',
      );
      expect(echo.sequence, isNull, reason: 'ordering is the server\'s to assign');
    });

    test('the confirmed message replaces the echo rather than duplicating it', () async {
      final c = controller();
      await settle();

      c.send('مرحبا');
      await settle();

      expect(read().log.length, 1);
      expect(read().log.messages.single.deliveryState, DeliveryState.sent);
      expect(read().log.messages.single.sequence, 1);
    });

    test('a retry reuses the same client message id', () async {
      final c = controller();
      await settle();

      repository.failuresRemaining = 1;
      final clientId = c.send('مرحبا');
      await settle();

      expect(read().log.byClientId(clientId)?.deliveryState, DeliveryState.failed);

      await c.retry(clientId);
      await settle();

      expect(repository.sent, hasLength(2));
      expect(
        repository.sent.map((m) => m.clientMessageId).toSet(),
        {clientId},
        reason: 'the server must see one id so it can deduplicate',
      );
      expect(read().log.length, 1, reason: 'no duplicate message may appear');
    });

    test('each composed message gets its own id', () async {
      final c = controller();
      await settle();

      final first = c.send('one');
      await settle();
      final second = c.send('two');
      await settle();

      expect(first, isNot(second));
      expect(read().log.length, 2);
    });
  });

  group('failure handling', () {
    test('a network failure marks the message failed and flags offline', () async {
      final c = controller();
      await settle();

      repository.failuresRemaining = 1;
      final clientId = c.send('مرحبا');
      await settle();

      expect(read().log.byClientId(clientId)?.deliveryState, DeliveryState.failed);
      expect(read().isOffline, isTrue);
      expect(read().log.byClientId(clientId)?.canRetry, isTrue);
    });

    test('a policy refusal is not retried automatically', () async {
      final c = controller();
      await settle();

      repository.failWith =
          const AppError(AppErrorKind.forbidden, code: 'not_allowed');
      repository.failuresRemaining = 1;

      c.send('مرحبا');
      await settle();
      await settle();

      expect(
        repository.sent,
        hasLength(1),
        reason: 'a forbidden send would fail identically forever',
      );
      expect(read().isOffline, isFalse);
    });

    test('a discarded message is dropped from the queue', () async {
      final c = controller();
      await settle();

      repository.failuresRemaining = 1;
      final clientId = c.send('مرحبا');
      await settle();

      c.discard(clientId);
      expect(read().log.byClientId(clientId)?.isDeleted, isTrue);
    });
  });

  group('history and resync', () {
    test('loads the first page into the log', () async {
      repository.history_.add(
        Message(
          id: 'srv_seed',
          clientMessageId: 'seed',
          conversationId: 'c1',
          sequence: 1,
          kind: MessageKind.text,
          body: 'أهلا',
          createdAt: DateTime.utc(2026, 9, 5),
          deliveryState: DeliveryState.delivered,
        ),
      );

      controller();
      await settle();

      expect(read().log.length, 1);
      expect(read().isLoadingInitial, isFalse);
    });

    test('resync fetches only what came after the highest known sequence', () async {
      final c = controller();
      await settle();

      c.send('first');
      await settle();

      repository.history_.add(
        Message(
          id: 'srv_new',
          clientMessageId: 'from_other_device',
          conversationId: 'c1',
          sequence: 99,
          kind: MessageKind.text,
          body: 'رسالة جديدة',
          createdAt: DateTime.utc(2026, 9, 5, 13),
          deliveryState: DeliveryState.delivered,
        ),
      );

      await c.resync();

      expect(read().log.length, 2);
      expect(read().log.highestSequence, 99);
    });

    test('a realtime arrival for another conversation is ignored', () async {
      final c = controller();
      await settle();

      c.onRealtimeMessage(
        Message(
          id: 'srv_x',
          clientMessageId: 'elsewhere',
          conversationId: 'OTHER',
          sequence: 5,
          kind: MessageKind.text,
          createdAt: DateTime.utc(2026, 9, 5),
          deliveryState: DeliveryState.delivered,
        ),
      );

      expect(read().log.isEmpty, isTrue);
    });
  });

  // =======================================================================
  // Phase 2: realtime, receipts, and acting on an existing message.
  // =======================================================================

  /// A confirmed message already in the log, as though it had been fetched.
  Message inbound(int seq, {String? id, bool isMine = false, String body = 'أهلا'}) => Message(
        id: id ?? 'srv_$seq',
        clientMessageId: 'from_server_$seq',
        conversationId: 'c1',
        sequence: seq,
        kind: MessageKind.text,
        body: body,
        createdAt: DateTime.utc(2026, 9, 5, 12, seq),
        deliveryState: DeliveryState.sent,
        isMine: isMine,
      );

  group('receiving over realtime', () {
    test('an arrival triggers a fetch, and the message appears exactly once', () async {
      controller();
      await settle();

      repository.history_.add(inbound(7));
      realtime.emit('message.created', {
        'conversationId': 'c1',
        'messageId': 'srv_7',
        'seq': '7',
      });
      await settle();

      expect(read().log.length, 1);
      expect(read().log.byId('srv_7')?.body, 'أهلا');
    });

    test('a DUPLICATE arrival for a message already held adds nothing', () async {
      controller();
      await settle();

      repository.history_.add(inbound(7));
      for (var i = 0; i < 3; i++) {
        realtime.emit('message.created', {
          'conversationId': 'c1',
          'messageId': 'srv_7',
          'seq': '7',
        });
      }
      await settle();

      // Merged by identity, so the same message arriving through three events —
      // or through an event and a page fetch — is still one bubble.
      expect(read().log.length, 1);
    });

    test('an arrival for ANOTHER conversation is ignored entirely', () async {
      controller();
      await settle();

      repository.history_.add(inbound(7));
      realtime.emit('message.created', {
        'conversationId': 'somewhere-else',
        'messageId': 'srv_7',
      });
      await settle();

      expect(read().log.isEmpty, isTrue, reason: 'no fetch should have been triggered');
    });

    test('our own send is not duplicated by the event it causes', () async {
      final c = controller();
      await settle();

      c.send('مرحبا');
      await settle();
      final serverId = read().log.messages.single.id!;

      // The server echoes the message back over realtime too. Keyed by client
      // id, the echo reconciles into the message that is already there.
      realtime.emit('message.created', {
        'conversationId': 'c1',
        'messageId': serverId,
        'seq': '1',
      });
      await settle();

      expect(read().log.length, 1);
    });

    test('a reconnect re-subscribes and catches up without duplicating', () async {
      final c = controller();
      await settle();

      repository.history_.add(inbound(1));
      await c.loadInitial();
      await settle();
      expect(read().log.length, 1);

      // The socket drops and returns. Everything held must survive, and the
      // catch-up must not re-add it.
      realtime.moveTo(RealtimeStatus.reconnecting);
      repository.history_.add(inbound(2));
      realtime.moveTo(RealtimeStatus.connected);
      await settle();

      expect(read().log.length, 2);
      expect(realtime.subscriptions.where((id) => id == 'c1'), isNotEmpty);
    });
  });

  group('message status', () {
    test('acknowledges delivery for messages from somebody else, once each', () async {
      final c = controller();
      await settle();
      await realtime.connect();

      repository.history_.add(inbound(1));
      repository.history_.add(inbound(2));
      await c.loadInitial();
      await settle();

      expect(realtime.acknowledged, containsAll(['srv_1', 'srv_2']));

      // Re-reading the same page must not re-acknowledge every message on it.
      final countAfterFirst = realtime.acknowledged.length;
      await c.loadInitial();
      await settle();
      expect(realtime.acknowledged.length, countAfterFirst);
    });

    test('never acknowledges its OWN messages', () async {
      final c = controller();
      await settle();
      await realtime.connect();

      c.send('mine');
      await settle();

      // A sender does not "receive": there is no receipt row for them, and
      // acknowledging would be asserting delivery to oneself.
      expect(realtime.acknowledged, isEmpty);
    });

    test('a receipt advances the sender\'s ticks, and never moves them backwards', () async {
      final c = controller();
      await settle();

      c.send('مرحبا');
      await settle();
      final id = read().log.messages.single.id!;

      realtime.emit('message.receipt.updated', {
        'conversationId': 'c1',
        'messageId': id,
        'actorId': 'other',
        'state': 'read',
      });
      await settle();
      expect(read().log.byId(id)!.deliveryState, DeliveryState.read);

      // A DELIVERED replayed after a READ — which every reconnect will do —
      // must not drag the ticks back.
      realtime.emit('message.receipt.updated', {
        'conversationId': 'c1',
        'messageId': id,
        'actorId': 'other',
        'state': 'delivered',
      });
      await settle();
      expect(read().log.byId(id)!.deliveryState, DeliveryState.read);
    });

    test('reports the read cursor once, and only when it advances', () async {
      final c = controller();
      await settle();

      repository.history_.add(inbound(5));
      await c.loadInitial();
      await settle();

      await c.markReadThroughLatest();
      await c.markReadThroughLatest();
      expect(conversations.readCursors, [5]);

      repository.history_.add(inbound(6));
      await c.loadInitial();
      await c.markReadThroughLatest();
      expect(conversations.readCursors, [5, 6]);
    });
  });

  group('editing', () {
    test('applies the edit and keeps the server\'s copy', () async {
      final c = controller();
      await settle();

      c.send('tomorow');
      await settle();
      final id = read().log.messages.single.id!;

      await c.edit(id, 'tomorrow');
      expect(read().log.byId(id)!.body, 'tomorrow');
      expect(read().log.byId(id)!.isEdited, isTrue);
      expect(repository.edits, [(id, 'tomorrow')]);
    });

    test('a refusal rolls the body back rather than leaving a lie on screen', () async {
      final c = controller();
      await settle();

      c.send('original');
      await settle();
      final id = read().log.messages.single.id!;

      repository.failuresRemaining = 1;
      repository.failWith = const AppError(AppErrorKind.forbidden, code: 'COMM.EDIT_WINDOW_EXPIRED');

      await expectLater(c.edit(id, 'changed'), throwsA(isA<AppError>()));
      expect(read().log.byId(id)!.body, 'original');
    });

    test('an edit that changes nothing is not sent', () async {
      final c = controller();
      await settle();

      c.send('same');
      await settle();
      final id = read().log.messages.single.id!;

      await c.edit(id, '  same  ');
      expect(repository.edits, isEmpty);
    });

    test('a realtime edit from another device is applied to the held copy', () async {
      final c = controller();
      await settle();

      repository.history_.add(inbound(3, body: 'before'));
      await c.loadInitial();
      await settle();

      realtime.emit('message.updated', {
        'conversationId': 'c1',
        'messageId': 'srv_3',
        'body': 'after',
        'editedAt': '2026-09-05T12:30:00.000Z',
      });
      await settle();

      expect(read().log.byId('srv_3')!.body, 'after');
      expect(read().log.byId('srv_3')!.isEdited, isTrue);
    });
  });

  group('deleting', () {
    test('delete for me removes it from THIS view and calls the per-user route', () async {
      final c = controller();
      await settle();

      repository.history_.add(inbound(4));
      await c.loadInitial();
      await settle();

      await c.deleteForMe('srv_4');
      expect(read().log.byId('srv_4'), isNull);
      expect(repository.deletedForMe, ['srv_4']);
      // NOT the global route: these mean different things, and using the wrong
      // one deletes a message for everybody.
      expect(repository.deletedForEveryone, isEmpty);
    });

    test('a refused delete for me puts the message back', () async {
      final c = controller();
      await settle();

      repository.history_.add(inbound(4));
      await c.loadInitial();
      await settle();

      repository.failuresRemaining = 1;
      await expectLater(c.deleteForMe('srv_4'), throwsA(isA<AppError>()));
      expect(read().log.byId('srv_4'), isNotNull);
    });

    test('delete for everyone leaves a tombstone rather than removing the bubble', () async {
      final c = controller();
      await settle();

      c.send('said in haste');
      await settle();
      final id = read().log.messages.single.id!;

      await c.deleteForEveryone(id, reason: 'sent in error');

      final tombstone = read().log.byId(id)!;
      expect(tombstone.isDeleted, isTrue);
      expect(tombstone.body, isEmpty);
      expect(repository.deletedForEveryone, [id]);
    });

    test('a realtime deletion withdraws the body from the held copy', () async {
      final c = controller();
      await settle();

      repository.history_.add(inbound(5, body: 'secret'));
      await c.loadInitial();
      await settle();

      realtime.emit('message.deleted', {
        'conversationId': 'c1',
        'messageId': 'srv_5',
        'deletedForAll': true,
      });
      await settle();

      expect(read().log.byId('srv_5')!.isDeleted, isTrue);
      expect(read().log.byId('srv_5')!.body, isEmpty);
    });
  });

  group('reactions', () {
    test('adds one, and tapping the same emoji removes it', () async {
      final c = controller();
      await settle();

      repository.history_.add(inbound(6));
      await c.loadInitial();
      await settle();

      await c.toggleReaction('srv_6', '👍');
      expect(read().log.byId('srv_6')!.reactions.single.emoji, '👍');
      expect(read().log.byId('srv_6')!.reactions.single.mine, isTrue);

      await c.toggleReaction('srv_6', '👍');
      expect(read().log.byId('srv_6')!.reactions, isEmpty);
      expect(repository.reactions, [('srv_6', '👍'), ('srv_6', null)]);
    });

    test('a second reaction REPLACES the first — one per person', () async {
      final c = controller();
      await settle();

      repository.history_.add(inbound(6));
      await c.loadInitial();
      await settle();

      await c.toggleReaction('srv_6', '👍');
      await c.toggleReaction('srv_6', '❤️');

      final reactions = read().log.byId('srv_6')!.reactions;
      expect(reactions, hasLength(1));
      expect(reactions.single.emoji, '❤️');
    });

    test('somebody else\'s reaction is applied as a delta, without a refetch', () async {
      final c = controller();
      await settle();

      repository.history_.add(inbound(6));
      await c.loadInitial();
      await settle();
      final historyReadsBefore = repository.historyReads;

      realtime.emit('reaction.added', {
        'conversationId': 'c1',
        'messageId': 'srv_6',
        'actorId': 'somebody-else',
        'emoji': '❤️',
      });
      await settle();

      final reaction = read().log.byId('srv_6')!.reactions.single;
      expect(reaction.emoji, '❤️');
      expect(reaction.count, 1);
      expect(reaction.mine, isFalse);
      // A refetch of the newest page could not have updated a reaction on an
      // older message the user had scrolled back to.
      expect(repository.historyReads, historyReadsBefore);

      realtime.emit('reaction.removed', {
        'conversationId': 'c1',
        'messageId': 'srv_6',
        'actorId': 'somebody-else',
        'emoji': '❤️',
      });
      await settle();
      expect(read().log.byId('srv_6')!.reactions, isEmpty);
    });

    test('a refusal restores the reactions that were there', () async {
      final c = controller();
      await settle();

      repository.history_.add(inbound(6));
      await c.loadInitial();
      await settle();

      repository.failuresRemaining = 1;
      await expectLater(c.toggleReaction('srv_6', '👍'), throwsA(isA<AppError>()));
      expect(read().log.byId('srv_6')!.reactions, isEmpty);
    });
  });

  group('forwarding', () {
    test('names the source and the destinations', () async {
      final c = controller();
      await settle();

      repository.history_.add(inbound(8));
      await c.loadInitial();
      await settle();

      await c.forward('srv_8', ['c2', 'c3']);
      // Compared field by field: a record holding a List compares that List by
      // identity, so the whole-tuple form would never match.
      expect(repository.forwarded, hasLength(1));
      expect(repository.forwarded.single.$1, 'srv_8');
      expect(repository.forwarded.single.$2, ['c2', 'c3']);
    });

    test('forwarding nowhere does nothing', () async {
      final c = controller();
      await settle();

      await c.forward('srv_8', const []);
      expect(repository.forwarded, isEmpty);
    });
  });

  group('typing', () {
    test('reports typing once for a run of keystrokes, then stops', () async {
      final c = controller();
      await settle();

      for (var i = 0; i < 20; i++) {
        c.onComposerChanged();
      }
      // A frame per keystroke would fan out twenty frames to say one thing.
      expect(realtime.typingFrames.where((f) => f.$2), hasLength(1));

      c.stopTyping();
      expect(realtime.typingFrames.last, ('c1', false));
    });

    test('shows who is typing, and clears them when they stop', () async {
      controller();
      await settle();

      realtime.emit('typing.started', {
        'conversationId': 'c1',
        'actorId': 'a1',
        'displayName': 'أحمد',
      });
      await settle();
      expect(read().typingNames, ['أحمد']);

      realtime.emit('typing.stopped', {
        'conversationId': 'c1',
        'actorId': 'a1',
        'displayName': 'أحمد',
      });
      await settle();
      expect(read().typingNames, isEmpty);
    });

    test('a dropped connection clears every indicator', () async {
      controller();
      await settle();

      realtime.emit('typing.started', {
        'conversationId': 'c1',
        'actorId': 'a1',
        'displayName': 'أحمد',
      });
      await settle();
      expect(read().typingNames, isNotEmpty);

      realtime.moveTo(RealtimeStatus.reconnecting);
      await settle();
      // A connection that has gone cannot vouch for anybody still typing.
      expect(read().typingNames, isEmpty);
    });
  });

  group('unread', () {
    test('places the divider from the count the server had on open', () async {
      final c = controller();
      await settle();

      for (var seq = 1; seq <= 5; seq++) {
        repository.history_.add(inbound(seq));
      }
      c.adoptUnreadCount(2);
      await c.loadInitial();
      await settle();

      expect(read().unread.count, 2);
      expect(read().unread.firstUnreadSequence, 4);
    });

    test('the divider does NOT move as more messages arrive', () async {
      final c = controller();
      await settle();

      for (var seq = 1; seq <= 5; seq++) {
        repository.history_.add(inbound(seq));
      }
      c.adoptUnreadCount(2);
      await c.loadInitial();
      await settle();
      final fixed = read().unread.firstUnreadSequence;

      repository.history_.add(inbound(6));
      await c.resync();
      await settle();

      // It marks where the user LEFT OFF. Recomputing it would walk it to the
      // bottom, where it marks nothing.
      expect(read().unread.firstUnreadSequence, fixed);
    });
  });
}