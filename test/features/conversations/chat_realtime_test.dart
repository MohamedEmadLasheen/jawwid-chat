import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/fake_backend.dart';
import 'package:jawwid_chat/core/data/fake_repositories.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart' show TokenProvider;
import 'package:jawwid_chat/core/realtime/call_realtime_client.dart';
import 'package:jawwid_chat/core/realtime/realtime_socket.dart';
import 'package:jawwid_chat/features/conversations/application/chat_realtime.dart';
import 'package:jawwid_chat/features/conversations/application/conversations_controller.dart';
import 'package:jawwid_chat/features/messages/application/away_teachers.dart';
import 'package:jawwid_chat/features/messages/application/messages_controller.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/message.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The server side of the socket, as far as the coordinator can tell.
class _Socket implements RealtimeSocket {
  final _frames = StreamController<RealtimeFrame>.broadcast();
  final _states = StreamController<RealtimeSocketState>.broadcast();
  final subscribed = <String>[];
  final unsubscribed = <String>[];

  @override
  Stream<RealtimeFrame> get frames => _frames.stream;
  @override
  Stream<RealtimeSocketState> get states => _states.stream;
  @override
  Future<void> connect(String token) async =>
      _states.add(RealtimeSocketState.connected);
  @override
  Future<SubscriptionResult> subscribe(String conversationId) async {
    subscribed.add(conversationId);
    return const SubscriptionResult(ok: true);
  }

  @override
  Future<void> unsubscribe(String conversationId) async =>
      unsubscribed.add(conversationId);
  @override
  Future<void> dispose() async {}

  void emit(String event, Object? payload) => _frames.add(RealtimeFrame(event, payload));
  void drop() => _states.add(RealtimeSocketState.disconnected);
  void back() => _states.add(RealtimeSocketState.connected);

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

/// Counts what reached the "server", without changing what it answers.
class _CountingConversations implements ConversationRepository {
  _CountingConversations(this._inner);
  final ConversationRepository _inner;
  int lists = 0;

  @override
  Future<List<Conversation>> list({bool includeArchived = false}) {
    lists++;
    return _inner.list(includeArchived: includeArchived);
  }

  @override
  Future<Conversation> byId(String conversationId) => _inner.byId(conversationId);
  @override
  Future<void> markRead(String conversationId, {required int throughSequence}) =>
      _inner.markRead(conversationId, throughSequence: throughSequence);
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
  @override
  Future<Conversation> openDirect(String withActorId) => _inner.openDirect(withActorId);
}

/// The fixture, except that messages in [held] do not exist yet as far as any
/// reader is concerned -- a message waiting for approval.
class _GatedMessages extends FakeMessageRepository {
  _GatedMessages(super.backend);
  final held = <String>{};
  final sinceAfter = <int>[];

  /// PD-50: every history read, as (before, limit); messages that sit above the newest
  /// page (so a newest-page read never returns them); and the server's changed copies.
  final historyCalls = <(String?, int)>[];
  final farUp = <String>{};
  final changed = <String, Message>{};

  @override
  Future<Page<Message>> history(String conversationId, {String? beforeCursor, int limit = 30}) async {
    historyCalls.add((beforeCursor, limit));
    final page = await super.history(conversationId, beforeCursor: beforeCursor, limit: limit);
    return Page(
      items: [
        for (final m in page.items)
          if (!held.contains(m.id) && !(beforeCursor == null && farUp.contains(m.id))) changed[m.id] ?? m,
      ],
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    );
  }

  @override
  Future<List<Message>> since(String conversationId, {required int afterSequence}) async {
    sinceAfter.add(afterSequence);
    final all = await super.since(conversationId, afterSequence: afterSequence);
    return all.where((m) => !held.contains(m.id)).toList();
  }
}

/// Counts member-list reads (`GET /conversations/:id`), which is where a teacher's
/// "on leave until" comes from (PD-26).
class _CountingGroups implements GroupRepository {
  final reads = <String>[];

  @override
  Future<StudentGroup> group(String conversationId) async {
    reads.add(conversationId);
    return StudentGroup(conversationId: conversationId, learner: const LearnerRef(id: 'l1', displayName: 'l'), members: const []);
  }
}

/// Live chat: the list and open threads follow the server on signals, without
/// a refresh, without duplicates, and without loading threads nobody opened.
void main() {
  late FakeBackend backend;
  late _Socket socket;
  late CallRealtimeClient client;
  late _CountingConversations conversations;
  late _GatedMessages messages;
  late _CountingGroups groups;
  late ProviderContainer container;
  late Provider<ChatRealtimeCoordinator> coordinatorProvider;

  const debounce = Duration(milliseconds: 5);
  var safety = const Duration(hours: 1);

  setUp(() async {
    safety = const Duration(hours: 1);
    backend = FakeBackend(role: UserRole.parent);
    socket = _Socket();
    client = CallRealtimeClient(socket: socket, tokens: _Tokens());
    conversations = _CountingConversations(FakeConversationRepository(backend));
    messages = _GatedMessages(backend);
    groups = _CountingGroups();

    coordinatorProvider = Provider<ChatRealtimeCoordinator>((ref) {
      final c = ChatRealtimeCoordinator(
        ref,
        client,
        listRefreshDebounce: debounce,
        safetyResyncInterval: safety,
      );
      ref.onDispose(c.dispose);
      c.start();
      return c;
    });

    container = ProviderContainer(
      overrides: [
        currentRoleProvider.overrideWithValue(UserRole.parent),
        conversationRepositoryProvider.overrideWithValue(conversations),
        messageRepositoryProvider.overrideWithValue(messages),
        groupRepositoryProvider.overrideWithValue(groups),
      ],
    );
    await client.connect();
  });

  tearDown(() async {
    container.dispose();
    await client.dispose();
    await socket.close();
    backend.dispose();
  });

  Future<void> settle() async {
    await pumpEventQueue();
    await Future<void>.delayed(debounce * 4);
    await pumpEventQueue();
  }

  List<String> listedIds() => [
        for (final section in container.read(conversationsControllerProvider).value!)
          for (final c in section.conversations) c.id,
      ];

  test('subscribes to EVERY conversation in the list, once each', () async {
    container.read(coordinatorProvider);
    await container.read(conversationsControllerProvider.future);
    await settle();

    final ids = listedIds();
    expect(ids, isNotEmpty);
    expect(socket.subscribed.toSet(), ids.toSet());
    expect(socket.subscribed.length, ids.length, reason: 'no duplicate subscribe');
  });

  test('a message in a conversation that is NOT open refreshes the list and loads no thread', () async {
    container.read(coordinatorProvider);
    await container.read(conversationsControllerProvider.future);
    await settle();
    final id = listedIds().first;
    final before = conversations.lists;

    backend.appendIncoming(id, 'new');
    socket.emit('message.created', {'conversationId': id, 'seq': '${backend.highestSequence(id)}'});
    await settle();

    expect(conversations.lists, before + 1);
    expect(container.exists(messagesControllerProvider(id)), isFalse);
  });

  test('a burst of events becomes ONE list read (debounced)', () async {
    container.read(coordinatorProvider);
    await container.read(conversationsControllerProvider.future);
    await settle();
    final id = listedIds().first;
    final before = conversations.lists;

    for (var i = 0; i < 5; i++) {
      socket.emit('conversation.updated', {'conversationId': id});
    }
    await settle();

    expect(conversations.lists, before + 1);
  });

  test('an OPEN thread gets the new message from the server, exactly once even if the event repeats', () async {
    container.read(coordinatorProvider);
    await container.read(conversationsControllerProvider.future);
    final id = listedIds().first;
    final sub = container.listen(messagesControllerProvider(id), (_, _) {});
    addTearDown(sub.close);
    await settle();
    final countBefore = container.read(messagesControllerProvider(id)).log.length;

    final arrived = backend.appendIncoming(id, 'hello from the admin');
    final payload = {'conversationId': id, 'seq': '${arrived.sequence}'};
    socket.emit('message.created', payload);
    socket.emit('message.created', payload); // at-least-once delivery
    await settle();

    final log = container.read(messagesControllerProvider(id)).log;
    expect(log.length, countBefore + 1);
    expect(log.messages.where((m) => m.id == arrived.id).length, 1);
  });

  test('a late-APPROVED message below the watermark is still fetched', () async {
    container.read(coordinatorProvider);
    await container.read(conversationsControllerProvider.future);
    final id = listedIds().first;
    final sub = container.listen(messagesControllerProvider(id), (_, _) {});
    addTearDown(sub.close);
    await settle();

    // Held at send time with seq n; a newer message n+1 is published and read
    // first. The held one is invisible until approved.
    final held = backend.appendIncoming(id, 'held for approval');
    messages.held.add(held.id!);
    final newer = backend.appendIncoming(id, 'newer');
    socket.emit('message.created', {'conversationId': id, 'seq': '${newer.sequence}'});
    await settle();
    bool has(String messageId) =>
        container.read(messagesControllerProvider(id)).log.messages.any((m) => m.id == messageId);
    expect(has(newer.id!), isTrue);
    expect(has(held.id!), isFalse);

    // Approved: published with its ORIGINAL seq, below the watermark.
    messages.held.remove(held.id!);
    messages.sinceAfter.clear();
    socket.emit('message.created', {'conversationId': id, 'seq': '${held.sequence}'});
    await settle();

    expect(has(held.id!), isTrue);
    expect(messages.sinceAfter, [held.sequence! - 1],
        reason: 'fetched from just below its own seq, not after the watermark');
  });

  group('PD-50: message.updated naming a seq', () {
    Future<(String, Message)> openThreadWithCardFarUp() async {
      container.read(coordinatorProvider);
      await container.read(conversationsControllerProvider.future);
      final id = listedIds().first;
      final sub = container.listen(messagesControllerProvider(id), (_, _) {});
      addTearDown(sub.close);
      await settle();
      // The oldest message held: by now outside the newest page, and changed on the server.
      final card = container.read(messagesControllerProvider(id)).log.messages.firstWhere((m) => m.sequence != null);
      messages.farUp.add(card.id!);
      messages.changed[card.id!] = card.copyWith(isPinned: !card.isPinned);
      messages.historyCalls.clear();
      return (id, card);
    }

    Message held(String id, Message card) =>
        container.read(messagesControllerProvider(id)).log.messages.singleWhere((m) => m.id == card.id);

    test('re-reads exactly that message (before=seq+1, limit=1) and merges it, besides the newest page', () async {
      final (id, card) = await openThreadWithCardFarUp();

      socket.emit('message.updated', {
        'conversationId': id,
        'messageId': card.id,
        'visibility': 'customer',
        'editedAt': '2026-10-29T12:00:00.000Z',
        'seq': '${card.sequence}',
      });
      await settle();

      expect(messages.historyCalls, containsAll([('${card.sequence! + 1}', 1), (null, 30)]));
      expect(held(id, card).isPinned, !card.isPinned, reason: "the server's copy of the far-up card won");
    });

    test('without a seq only the newest page is re-read, so a far-up card stays as it was', () async {
      final (id, card) = await openThreadWithCardFarUp();

      socket.emit('message.updated', {'conversationId': id, 'messageId': card.id, 'visibility': 'customer', 'editedAt': 'x'});
      await settle();

      expect(messages.historyCalls, [(null, 30)]);
      expect(held(id, card).isPinned, card.isPinned);
    });

    test('a seq for a message this thread does not hold reads nothing extra', () async {
      final (id, _) = await openThreadWithCardFarUp();

      socket.emit('message.updated', {'conversationId': id, 'messageId': 'nope', 'visibility': 'customer', 'editedAt': 'x', 'seq': '999999'});
      await settle();

      expect(messages.historyCalls, [(null, 30)]);
    });
  });

  test('a reconnect catches open threads up and re-reads the list', () async {
    container.read(coordinatorProvider);
    await container.read(conversationsControllerProvider.future);
    final id = listedIds().first;
    final sub = container.listen(messagesControllerProvider(id), (_, _) {});
    addTearDown(sub.close);
    await settle();
    final listsBefore = conversations.lists;

    socket.drop();
    final missed = backend.appendIncoming(id, 'sent while you were offline');
    socket.back();
    await settle();

    expect(
      container.read(messagesControllerProvider(id)).log.messages.any((m) => m.id == missed.id),
      isTrue,
    );
    expect(conversations.lists, greaterThan(listsBefore));
  });

  test('PD-26: an open chat\'s "on leave" notice re-reads on its signals and on a reconnect -- never by polling', () async {
    container.read(coordinatorProvider);
    await container.read(conversationsControllerProvider.future);
    final ids = listedIds();
    final open = ids.first;
    final sub = container.listen(awayTeachersProvider(open), (_, _) {});
    addTearDown(sub.close);
    await container.read(awayTeachersProvider(open).future);
    await settle();
    expect(groups.reads, [open]);

    socket.emit('conversation.updated', {'conversationId': open});
    await settle();
    await container.read(awayTeachersProvider(open).future);
    expect(groups.reads, [open, open]);

    socket.emit('conversation.membership_changed', {'conversationId': open, 'added': <String>[], 'removed': <String>[]});
    await settle();
    await container.read(awayTeachersProvider(open).future);
    expect(groups.reads, [open, open, open]);

    socket.drop();
    socket.back();
    await settle();
    await container.read(awayTeachersProvider(open).future);
    expect(groups.reads, [open, open, open, open]);

    // A signal for a chat nobody has open loads nothing.
    if (ids.length > 1) {
      socket.emit('conversation.updated', {'conversationId': ids[1]});
      await settle();
      expect(groups.reads.where((r) => r == ids[1]), isEmpty);
    }
  });

  test('a conversation that leaves the list is unsubscribed', () async {
    container.read(coordinatorProvider);
    await container.read(conversationsControllerProvider.future);
    await settle();
    final id = listedIds().first;

    await container.read(conversationsControllerProvider.notifier).setArchived(id, true);
    await settle();

    expect(socket.unsubscribed, contains(id));
  });

  test('disposal stops everything: a later signal reaches nothing', () async {
    container.read(coordinatorProvider);
    await container.read(conversationsControllerProvider.future);
    await settle();
    final id = listedIds().first;
    final before = conversations.lists;

    container.invalidate(coordinatorProvider);
    await settle();
    socket.emit('message.created', {'conversationId': id, 'seq': '999'});
    await settle();

    expect(conversations.lists, before);
  });

  test('message events carry no body; nothing is rendered from a payload', () async {
    container.read(coordinatorProvider);
    await container.read(conversationsControllerProvider.future);
    final id = listedIds().first;
    final sub = container.listen(messagesControllerProvider(id), (_, _) {});
    addTearDown(sub.close);
    await settle();
    final before = container.read(messagesControllerProvider(id)).log.length;

    // A forged frame claiming a message the server does not have.
    socket.emit('message.created', {
      'conversationId': id,
      'seq': '99999',
      'body': 'forged text',
    });
    await settle();

    final log = container.read(messagesControllerProvider(id)).log;
    expect(log.length, before);
    expect(log.messages.any((Message m) => m.body == 'forged text'), isFalse);
  });

  test('a LOST event is healed by the safety resync: the open thread and the list catch up with no event at all', () async {
    safety = const Duration(milliseconds: 40);
    container.read(coordinatorProvider);
    await container.read(conversationsControllerProvider.future);
    final id = listedIds().first;
    final sub = container.listen(messagesControllerProvider(id), (_, _) {});
    addTearDown(sub.close);
    await settle();
    final lists = conversations.lists;

    // The server has the message; the event that would have announced it never arrives.
    final lost = backend.appendIncoming(id, 'its event was lost');
    await Future<void>.delayed(const Duration(milliseconds: 150));
    await settle();

    expect(container.read(messagesControllerProvider(id)).log.messages.any((m) => m.id == lost.id), isTrue);
    expect(conversations.lists, greaterThan(lists));
  });
}
