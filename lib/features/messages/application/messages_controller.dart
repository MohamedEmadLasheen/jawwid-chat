import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/network/error_mapper.dart';
import '../../../core/realtime/realtime_client.dart';
import '../../../core/realtime/realtime_events.dart';
import '../../../shared/models/message.dart';
import '../domain/message_log.dart';
import '../domain/outbox.dart';
import 'conversation_realtime.dart';

/// Everything the chat screen renders for one conversation.
class MessagesState {
  const MessagesState({
    required this.log,
    this.isLoadingInitial = false,
    this.isLoadingOlder = false,
    this.initialError,
    this.olderError,
    this.isOffline = false,
    this.typingNames = const [],
    this.unread = const UnreadMarker(),
    this.realtime = RealtimeStatus.idle,
  });

  final MessageLog log;
  final bool isLoadingInitial;
  final bool isLoadingOlder;

  /// Failure of the *first* page — the screen shows a full error state.
  final AppError? initialError;

  /// Failure of an *older* page — the screen keeps the messages it has and offers a retry
  /// row at the top, rather than throwing away what the user is reading (§19).
  final AppError? olderError;

  final bool isOffline;

  /// Display names of everybody else currently typing.
  final List<String> typingNames;

  /// Where the "unread messages" divider goes, fixed at open.
  final UnreadMarker unread;

  final RealtimeStatus realtime;

  bool get isEmpty => log.isEmpty && !isLoadingInitial && initialError == null;

  MessagesState copyWith({
    MessageLog? log,
    bool? isLoadingInitial,
    bool? isLoadingOlder,
    AppError? initialError,
    AppError? olderError,
    bool clearInitialError = false,
    bool clearOlderError = false,
    bool? isOffline,
    List<String>? typingNames,
    UnreadMarker? unread,
    RealtimeStatus? realtime,
  }) {
    return MessagesState(
      log: log ?? this.log,
      isLoadingInitial: isLoadingInitial ?? this.isLoadingInitial,
      isLoadingOlder: isLoadingOlder ?? this.isLoadingOlder,
      initialError: clearInitialError ? null : (initialError ?? this.initialError),
      olderError: clearOlderError ? null : (olderError ?? this.olderError),
      isOffline: isOffline ?? this.isOffline,
      typingNames: typingNames ?? this.typingNames,
      unread: unread ?? this.unread,
      realtime: realtime ?? this.realtime,
    );
  }
}

/// Drives one conversation.
///
/// The send path is the important part. A composed message is:
///
/// 1. given a UUID v4 **once**, which becomes its `client_message_id` forever;
/// 2. echoed into the log immediately as `queued`, so the user sees it without waiting;
/// 3. queued in the [Outbox], which releases only the head of each conversation, preserving
///    order even when the network is flapping;
/// 4. on success, reconciled by client id — the server's copy replaces the echo rather than
///    appearing beside it.
///
/// A retry re-sends the *same* entry, so the server deduplicates rather than creating a
/// second message.
class MessagesController extends Notifier<MessagesState> {
  MessagesController(this.conversationId);

  static const _uuid = Uuid();

  final String conversationId;

  final _outbox = Outbox();

  /// The payload for each queued client id. Held beside the outbox so a retry re-sends the
  /// original body rather than reconstructing it.
  final _pendingBodies = <String, OutgoingMessage>{};

  Timer? _drainTimer;

  late final MessageRepository _messages;
  late final RealtimeClient _realtime;

  StreamSubscription<RealtimeEnvelope>? _events;
  StreamSubscription<RealtimeStatus>? _connection;

  late final TypingRegistry _typing;
  TypingSignaller? _signaller;

  /// Server ids already acknowledged as delivered, so a re-read of the same
  /// page does not re-acknowledge every message on it.
  final _acknowledged = <String>{};

  /// The highest seq this client has told the server it read. Prevents a scroll
  /// that re-crosses the same messages from re-posting the same cursor.
  int _reportedReadSeq = 0;

  /// Unread count as of open. Fixes the divider, which must NOT creep downwards
  /// as the user reads or it would always sit at the bottom and mark nothing.
  int _unreadOnOpen = 0;

  @override
  MessagesState build() {
    // Captured once, at build. Reading it through `ref` after an await would throw if the
    // user left the conversation while a request was in flight.
    _messages = ref.read(messageRepositoryProvider);
    _realtime = ref.read(realtimeClientProvider);

    _typing = TypingRegistry()
      ..onChanged = () {
        if (_alive) state = state.copyWith(typingNames: _typing.names);
      };
    _signaller = TypingSignaller(realtime: _realtime, conversationId: conversationId);

    ref.onDispose(() {
      _drainTimer?.cancel();
      _drainTimer = null;
      _signaller?.stop();
      _signaller?.dispose();
      _typing.dispose();
      unawaited(_events?.cancel());
      unawaited(_connection?.cancel());
      // Leaving the conversation stops its events. The socket stays up for the
      // chat list and for notifications.
      unawaited(_realtime.unsubscribe(conversationId));
    });

    // Kick the first page off without blocking the first frame; the screen renders its
    // loading state meanwhile.
    scheduleMicrotask(loadInitial);
    scheduleMicrotask(_attachRealtime);
    return MessagesState(log: MessageLog.empty(), isLoadingInitial: true);
  }

  // -----------------------------------------------------------------------
  // Realtime
  // -----------------------------------------------------------------------

  Future<void> _attachRealtime() async {
    _connection = _realtime.status.listen((status) {
      if (!_alive) return;
      state = state.copyWith(realtime: status);

      if (status == RealtimeStatus.connected) {
        // A reconnect means events may have been missed while the socket was
        // down. Re-subscribe and catch up from the watermark rather than trust
        // a gap — and note that resync() MERGES, so anything already held is
        // reconciled rather than duplicated.
        unawaited(_subscribeAndCatchUp());
      } else {
        // A connection that has gone cannot vouch for anybody still typing.
        _typing.clear();
      }
    });

    _events = _realtime.events.listen(_onEnvelope);

    await _realtime.connect();
    await _subscribeAndCatchUp();
  }

  Future<void> _subscribeAndCatchUp() async {
    final alreadyTyping = await _realtime.subscribe(conversationId);
    if (!_alive) return;

    // Somebody may have started typing before this client joined; without this
    // their indicator stays invisible until their next keystroke.
    for (final actorId in alreadyTyping) {
      _typing.start(actorId, '');
    }

    if (state.log.highestSequence != null) await resync();
  }

  void _onEnvelope(RealtimeEnvelope envelope) {
    if (!_alive) return;
    final signal = ConversationSignals.read(envelope, conversationId);
    if (signal == null) return;

    switch (signal) {
      case MessagesArrived():
        // The event says something arrived; it does not say what. The body is
        // subject to per-reader rules only the read path applies, so this
        // fetches from the watermark rather than trusting the payload — and
        // because the fetch merges by id, an arrival this client already holds
        // (its own send, or a duplicate event) adds nothing.
        unawaited(resync());

      case MessageEdited(:final messageId, :final body, :final editedAt):
        // The one signal that carries content. The backend emits it only to the
        // audience that could already read the message, so applying it directly
        // is safe and saves a round trip on every edit.
        state = state.copyWith(
          log: state.log.updateById(
            messageId,
            (m) => m.copyWith(body: body ?? m.body, editedAt: editedAt),
          ),
        );

      case MessageWithdrawn(:final messageId):
        state = state.copyWith(
          log: state.log.updateById(
            messageId,
            (m) => m.copyWith(isDeleted: true, body: ''),
          ),
        );

      // `state:` is bound to a new name: the unqualified one is the notifier's.
      case ReceiptAdvanced(:final messageId, state: final receiptState):
        _applyReceipt(messageId, receiptState);

      case ReactionsChanged(:final messageId, :final actorId, :final emoji, :final added):
        // Applied as a delta, not by refetching. The event names the actor and
        // the emoji, which is everything the roster needs — and a refetch of
        // the NEWEST page could not update a reaction on an older message the
        // user has scrolled back to.
        _applyRemoteReaction(messageId, actorId, emoji, added);

      case TypingChanged(:final actorId, :final displayName, :final isTyping):
        if (isTyping) {
          _typing.start(actorId, displayName);
        } else {
          _typing.stop(actorId);
        }
    }
  }

  /// Apply a receipt transition, never downgrading.
  ///
  /// A DELIVERED replayed after a READ — which a reconnect will do — must not
  /// drag the ticks backwards. The server enforces this on the row; the client
  /// enforces it again because a client can also receive the two events out of
  /// order, and then the row's monotonicity says nothing about what is on
  /// screen.
  void _applyReceipt(String messageId, DeliveryState incoming) {
    state = state.copyWith(
      log: state.log.updateById(messageId, (m) {
        if (!m.isMine) return m;
        return _rank(incoming) > _rank(m.deliveryState)
            ? m.copyWith(deliveryState: incoming)
            : m;
      }),
    );
  }

  static int _rank(DeliveryState state) => switch (state) {
        DeliveryState.read => 3,
        DeliveryState.delivered => 2,
        DeliveryState.sent => 1,
        _ => 0,
      };

  /// Apply somebody else's reaction to a message this client holds.
  ///
  /// An event about the VIEWER's own reaction is ignored: the optimistic update
  /// already applied it, and re-applying the server's echo of it would double
  /// the count on a message the user just tapped.
  void _applyRemoteReaction(String messageId, String actorId, String emoji, bool added) {
    if (actorId == _viewerActorId()) return;

    state = state.copyWith(
      log: state.log.updateById(messageId, (m) {
        final next = [
          for (final r in m.reactions)
            if (r.emoji == emoji)
              r.copyWith(count: r.count + (added ? 1 : -1))
            else
              r,
        ].where((r) => r.count > 0).toList();

        if (added && !next.any((r) => r.emoji == emoji)) {
          next.add(Reaction(emoji: emoji, count: 1, mine: false));
        }
        return m.copyWith(reactions: next);
      }),
    );
  }

  /// The signed-in actor's id, or empty before a session exists.
  ///
  /// Read on demand so this controller does not require an authenticated
  /// container to be constructed — which is what lets the transport tests
  /// exercise sending without standing up a session.
  String _viewerActorId() {
    try {
      return ref.read(authControllerProvider).user?.id ?? '';
    } catch (_) {
      return '';
    }
  }

  /// Every async continuation checks this before touching state.
  ///
  /// A conversation can be closed while a page is loading or a send is in flight, and
  /// writing to a disposed notifier throws. This is not hypothetical: it only became
  /// reachable once the transport had real network latency in it.
  bool get _alive => ref.mounted;

  Future<void> loadInitial() async {
    state = state.copyWith(isLoadingInitial: true, clearInitialError: true);

    try {
      final page = await _messages.history(conversationId);
      if (!_alive) return;

      final log = state.log.merge(
        page.items,
        oldestCursor: page.nextCursor,
        hasMoreOlder: page.hasMore,
      );

      // The divider is fixed HERE, once, from the count the server had when the
      // conversation was opened. Recomputing it as messages are read would walk
      // it down to the bottom, where it marks nothing.
      state = state.copyWith(
        log: log,
        isLoadingInitial: false,
        unread: UnreadMarker.from(ordered: log.messages, unreadCount: _unreadOnOpen),
      );

      // DELIVERED is asserted by the recipient's device when it actually holds
      // the message — never inferred by the sender, which is what §16 forbids.
      unawaited(_acknowledgeDelivery());
    } catch (error) {
      if (!_alive) return;
      state = state.copyWith(
        isLoadingInitial: false,
        initialError: ErrorMapper.map(error),
      );
    }
  }

  /// Load the next page of older messages (§19). The caller preserves scroll position; this
  /// only prepends.
  Future<void> loadOlder() async {
    if (state.isLoadingOlder || !state.log.hasMoreOlder) return;

    state = state.copyWith(isLoadingOlder: true, clearOlderError: true);

    try {
      final page = await _messages.history(
        conversationId,
        beforeCursor: state.log.oldestCursor,
      );
      if (!_alive) return;
      state = state.copyWith(
        log: state.log.merge(
          page.items,
          oldestCursor: page.nextCursor,
          hasMoreOlder: page.hasMore,
        ),
        isLoadingOlder: false,
      );
    } catch (error) {
      if (!_alive) return;
      state = state.copyWith(
        isLoadingOlder: false,
        olderError: ErrorMapper.map(error),
      );
    }
  }

  /// Compose and enqueue. Returns the client id so a caller can track this message.
  String send(String body, {ReplyPreview? replyTo}) {
    final clientMessageId = _uuid.v4();
    final now = DateTime.now();

    // The echo carries no author identity beyond `isMine`. Author name and role are the
    // server's to assert, and own messages never render an author line anyway — so looking
    // up the session here would be coupling for nothing.
    final echo = Message(
      clientMessageId: clientMessageId,
      conversationId: conversationId,
      kind: MessageKind.text,
      body: body,
      createdAt: now,
      // Only ever queued/sending/failed locally — never a server state (cross-platform §2).
      deliveryState: DeliveryState.queued,
      isMine: true,
      replyTo: replyTo,
    );

    state = state.copyWith(log: state.log.merge([echo]));

    _outbox.enqueue(
      OutboxEntry(
        clientMessageId: clientMessageId,
        conversationId: conversationId,
        enqueuedAt: now,
      ),
    );
    _pendingBodies[clientMessageId] =
        OutgoingMessage(
      clientMessageId: clientMessageId,
      conversationId: conversationId,
      kind: MessageKind.text,
      body: body,
      replyToMessageId: replyTo?.messageId,
    );

    unawaited(drain());
    return clientMessageId;
  }

  /// Release whatever the outbox says is ready, one head per conversation.
  Future<void> drain() async {
    if (!_alive) return;
    final now = DateTime.now();
    final entry = _outbox.nextReady(conversationId, now);
    if (entry == null) {
      _scheduleNextDrain();
      return;
    }

    final outgoing = _pendingBodies[entry.clientMessageId];
    if (outgoing == null) {
      // Nothing to send under this id — drop it rather than spin.
      _outbox.discard(entry.clientMessageId);
      return;
    }

    _outbox.markSending(entry.clientMessageId);
    state = state.copyWith(
      log: state.log.updateOne(
        entry.clientMessageId,
        (m) => m.copyWith(deliveryState: DeliveryState.sending),
      ),
    );

    try {
      final confirmed = await _messages.send(outgoing);

      _outbox.markSent(entry.clientMessageId);
      _pendingBodies.remove(entry.clientMessageId);

      if (!_alive) return;
      // Reconciled by client id, so the echo is replaced rather than duplicated.
      state = state.copyWith(log: state.log.merge([confirmed]), isOffline: false);

      unawaited(drain());
    } catch (error) {
      final failure = ErrorMapper.map(error);
      if (!_alive) return;

      _outbox.markFailed(
        entry.clientMessageId,
        DateTime.now(),
        // A policy refusal or a validation failure will fail identically forever, so it is
        // parked for an explicit retry instead of being re-attempted (§3).
        retryable: failure.isTransient,
        failureCode: failure.code,
      );

      state = state.copyWith(
        log: state.log.updateOne(
          entry.clientMessageId,
          (m) => m.copyWith(
            deliveryState: DeliveryState.failed,
            failureCode: failure.code,
          ),
        ),
        isOffline: failure.kind == AppErrorKind.network,
      );

      _scheduleNextDrain();
    }
  }

  /// Re-arm the drain for whenever the head's backoff expires.
  void _scheduleNextDrain() {
    _drainTimer?.cancel();
    if (!_alive || _outbox.isEmpty) return;

    final entries = _outbox.entriesFor(conversationId);
    if (entries.isEmpty) return;

    final notBefore = entries.first.nextAttemptAt;
    if (notBefore == null) return;

    final delay = notBefore.difference(DateTime.now());
    _drainTimer = Timer(
      delay.isNegative ? Duration.zero : delay,
      () => unawaited(drain()),
    );
  }

  /// User-initiated retry. Reuses the same entry and therefore the same client id.
  Future<void> retry(String clientMessageId) async {
    _outbox.retryNow(clientMessageId);
    state = state.copyWith(
      log: state.log.updateOne(
        clientMessageId,
        (m) => m.copyWith(deliveryState: DeliveryState.queued),
      ),
    );
    await drain();
  }

  void discard(String clientMessageId) {
    _outbox.discard(clientMessageId);
    _pendingBodies.remove(clientMessageId);
    state = state.copyWith(
      log: state.log.updateOne(
        clientMessageId,
        (m) => m.copyWith(isDeleted: true),
      ),
    );
  }

  /// Called on reconnect. Resyncs from the highest sequence we hold rather than refetching
  /// the whole conversation, which is what §49 and the handoff both ask for.
  Future<void> resync() async {
    final watermark = state.log.highestSequence;
    if (watermark == null) {
      await loadInitial();
      return;
    }

    try {
      final missed = await _messages.since(
        conversationId,
        afterSequence: watermark,
      );
      if (!_alive) return;
      // Merged, not appended. A message already held — because the realtime
      // event arrived, or because this is a replayed catch-up after a flaky
      // reconnect — reconciles into the entry that is already there.
      state = state.copyWith(log: state.log.merge(missed), isOffline: false);
      unawaited(_acknowledgeDelivery());
      await drain();
    } catch (error) {
      if (!_alive) return;
      state = state.copyWith(
        isOffline: ErrorMapper.map(error).kind == AppErrorKind.network,
      );
    }
  }

  /// Apply a realtime arrival. Events are signals: the message is merged, and identity by
  /// client id means our own echo coming back is not duplicated.
  void onRealtimeMessage(Message message) {
    if (message.conversationId != conversationId) return;
    state = state.copyWith(log: state.log.merge([message]));
  }

  // -----------------------------------------------------------------------
  // Receipts
  // -----------------------------------------------------------------------

  /// Tell the server which messages are now on this device.
  ///
  /// Only messages from somebody else, and only once each: `_acknowledged`
  /// keeps a re-read of the same page from re-acknowledging every message on
  /// it. The socket carries the batch when it is up, because one frame for a
  /// page beats one request per message on a slow network.
  Future<void> _acknowledgeDelivery() async {
    final pending = [
      for (final id in state.log.confirmedIds)
        if (!_acknowledged.contains(id)) id,
    ];
    if (pending.isEmpty) return;
    _acknowledged.addAll(pending);

    if (_realtime.currentStatus == RealtimeStatus.connected) {
      await _realtime.acknowledgeDelivered(pending);
      return;
    }
    for (final id in pending) {
      try {
        await _messages.markDelivered(conversationId: conversationId, messageId: id);
      } catch (_) {
        // A missed acknowledgement is re-sent on the next load. Surfacing it
        // would be an error for something the user did not do.
        _acknowledged.remove(id);
      }
    }
  }

  /// The conversation was opened, or scrolled to the bottom: mark it read.
  ///
  /// The cursor only ever advances. A scroll that re-crosses messages already
  /// reported does not re-post, and a replayed older cursor is refused by the
  /// server as well — read state is monotonic on both sides.
  Future<void> markReadThroughLatest() async {
    final highest = state.log.highestSequence;
    if (highest == null || highest <= _reportedReadSeq) return;
    _reportedReadSeq = highest;

    try {
      // Read here rather than captured at build: the read cursor is the only
      // thing this controller needs the conversation repository for, and
      // capturing it would make every consumer of a conversation — including
      // tests about sending — have to provide one.
      await ref
          .read(conversationRepositoryProvider)
          .markRead(conversationId, throughSequence: highest);
    } catch (_) {
      // Retried on the next open. Rolling the local watermark back would make
      // every subsequent scroll re-post the same cursor.
      _reportedReadSeq = 0;
    }
  }

  /// The unread count the server reported when this conversation was opened.
  ///
  /// Supplied by the route, which already fetched the conversation, rather than
  /// fetched again here.
  void adoptUnreadCount(int count) {
    if (_unreadOnOpen != 0 || count <= 0) return;
    _unreadOnOpen = count;
    if (!_alive || state.log.isEmpty) return;
    state = state.copyWith(
      unread: UnreadMarker.from(ordered: state.log.messages, unreadCount: count),
    );
  }

  // -----------------------------------------------------------------------
  // Acting on a message
  // -----------------------------------------------------------------------

  /// Typing. Debounced by [TypingSignaller]; a frame per keystroke would fan
  /// out two hundred frames for one bit of information.
  void onComposerChanged() => _signaller?.onChanged();

  void stopTyping() => _signaller?.stop();

  /// Replace the body of one's own message.
  ///
  /// Applied optimistically and rolled back on refusal. The server is
  /// authoritative — it enforces authorship, the window, and the message's
  /// state — and this only avoids a round-trip's worth of staleness for the
  /// overwhelmingly common case where it agrees.
  Future<void> edit(String messageId, String body) async {
    final trimmed = body.trim();
    final before = state.log.byId(messageId);
    if (trimmed.isEmpty || before == null || trimmed == before.body) return;

    state = state.copyWith(
      log: state.log.updateById(
        messageId,
        (m) => m.copyWith(body: trimmed, editedAt: DateTime.now()),
      ),
    );

    try {
      final confirmed = await _messages.edit(
        conversationId: conversationId,
        messageId: messageId,
        body: trimmed,
      );
      if (!_alive) return;
      state = state.copyWith(log: state.log.merge([confirmed]));
    } catch (error) {
      if (!_alive) return;
      state = state.copyWith(
        log: state.log.updateById(
          messageId,
          (m) => m.copyWith(body: before.body, editedAt: before.editedAt),
        ),
      );
      throw ErrorMapper.map(error);
    }
  }

  /// Hide a message from this user's view. Others keep their copy.
  Future<void> deleteForMe(String messageId) async {
    final before = state.log.byId(messageId);
    if (before == null) return;

    // Removed from view immediately: the user asked for it gone, and a message
    // that lingers while a request is in flight reads as a failure.
    state = state.copyWith(log: state.log.removeById(messageId));

    try {
      await _messages.deleteForMe(conversationId: conversationId, messageId: messageId);
    } catch (error) {
      if (!_alive) return;
      state = state.copyWith(log: state.log.merge([before]));
      throw ErrorMapper.map(error);
    }
  }

  /// Withdraw a message from everyone. The server enforces the window and the
  /// permission; the UI hides the action when it is clearly unavailable, but
  /// never decides it.
  Future<void> deleteForEveryone(String messageId, {String reason = 'deleted by author'}) async {
    final before = state.log.byId(messageId);
    if (before == null) return;

    state = state.copyWith(
      log: state.log.updateById(messageId, (m) => m.copyWith(isDeleted: true, body: '')),
    );

    try {
      await _messages.deleteForEveryone(
        conversationId: conversationId,
        messageId: messageId,
        reason: reason,
      );
    } catch (error) {
      if (!_alive) return;
      state = state.copyWith(log: state.log.merge([before]));
      throw ErrorMapper.map(error);
    }
  }

  /// Add, replace or remove this user's reaction.
  ///
  /// Tapping the emoji already applied REMOVES it, which is what the one-per-
  /// user model on the server means and what a WhatsApp user expects.
  Future<void> toggleReaction(String messageId, String emoji) async {
    final before = state.log.byId(messageId);
    if (before == null) return;

    final mine = before.reactions.where((r) => r.mine).firstOrNull;
    final removing = mine != null && mine.emoji == emoji;

    state = state.copyWith(
      log: state.log.updateById(
        messageId,
        (m) => m.copyWith(reactions: _applyReaction(m.reactions, emoji, removing)),
      ),
    );

    try {
      if (removing) {
        await _messages.removeReaction(conversationId, messageId);
      } else {
        await _messages.react(conversationId, messageId, emoji);
      }
    } catch (error) {
      if (!_alive) return;
      state = state.copyWith(
        log: state.log.updateById(messageId, (m) => m.copyWith(reactions: before.reactions)),
      );
      throw ErrorMapper.map(error);
    }
  }

  /// One reaction per user, so applying mine removes whatever I had before.
  static List<Reaction> _applyReaction(
    List<Reaction> current,
    String emoji,
    bool removing,
  ) {
    final next = current
        .map((r) => r.mine ? r.copyWith(count: r.count - 1, mine: false) : r)
        .where((r) => r.count > 0)
        .toList();
    if (removing) return next;

    final index = next.indexWhere((r) => r.emoji == emoji);
    if (index >= 0) {
      next[index] = next[index].copyWith(count: next[index].count + 1, mine: true);
    } else {
      next.add(Reaction(emoji: emoji, count: 1, mine: true));
    }
    return next;
  }

  /// Copy a message into other conversations. Not applied optimistically: the
  /// copies land somewhere the user is not looking, and the server authorizes
  /// each destination on its own.
  Future<void> forward(String messageId, List<String> toConversationIds) async {
    if (toConversationIds.isEmpty) return;
    try {
      await _messages.forward(
        conversationId: conversationId,
        messageId: messageId,
        toConversationIds: toConversationIds,
      );
    } catch (error) {
      throw ErrorMapper.map(error);
    }
  }
}

final messagesControllerProvider =
    NotifierProvider.family<MessagesController, MessagesState, String>(
  MessagesController.new,
);
