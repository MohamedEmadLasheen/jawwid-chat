import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/network/error_mapper.dart';
import '../../../shared/models/message.dart';
import '../domain/message_log.dart';
import '../domain/outbox.dart';

/// Everything the chat screen renders for one conversation.
class MessagesState {
  const MessagesState({
    required this.log,
    this.isLoadingInitial = false,
    this.isLoadingOlder = false,
    this.initialError,
    this.olderError,
    this.isOffline = false,
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
  }) {
    return MessagesState(
      log: log ?? this.log,
      isLoadingInitial: isLoadingInitial ?? this.isLoadingInitial,
      isLoadingOlder: isLoadingOlder ?? this.isLoadingOlder,
      initialError: clearInitialError ? null : (initialError ?? this.initialError),
      olderError: clearOlderError ? null : (olderError ?? this.olderError),
      isOffline: isOffline ?? this.isOffline,
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

  /// Temp recordings still owned by the outbox, so a sent or abandoned voice note
  /// does not leave audio in the cache directory.
  final _pendingVoiceFiles = <String, String>{};

  Timer? _drainTimer;

  late final MessageRepository _messages;

  @override
  MessagesState build() {
    // Captured once, at build. Reading it through `ref` after an await would throw if the
    // user left the conversation while a request was in flight.
    _messages = ref.read(messageRepositoryProvider);

    ref.onDispose(() {
      _drainTimer?.cancel();
      _drainTimer = null;
    });

    // Kick the first page off without blocking the first frame; the screen renders its
    // loading state meanwhile.
    scheduleMicrotask(loadInitial);
    return MessagesState(log: MessageLog.empty(), isLoadingInitial: true);
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
      state = state.copyWith(
        log: state.log.merge(
          page.items,
          oldestCursor: page.nextCursor,
          hasMoreOlder: page.hasMore,
        ),
        isLoadingInitial: false,
      );
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

    _enqueue(
      echo: echo,
      outgoing: OutgoingMessage(
        clientMessageId: clientMessageId,
        conversationId: conversationId,
        kind: MessageKind.text,
        body: body,
        replyToMessageId: replyTo?.messageId,
      ),
      now: now,
    );
    return clientMessageId;
  }

  /// Enqueue a finished recording.
  ///
  /// It takes exactly the path a text message takes — same outbox, same
  /// idempotency key, same ordering, same retry — with one extra step inside
  /// [drain]: the bytes go to storage before the message is sent. Nothing about
  /// voice needs a second send pipeline.
  ///
  /// The echo's attachment points at the *local* file, so the sender can replay
  /// what they just recorded while it is still uploading.
  String sendVoice(PendingVoiceNote note, {ReplyPreview? replyTo}) {
    final clientMessageId = _uuid.v4();
    final now = DateTime.now();

    final echo = Message(
      clientMessageId: clientMessageId,
      conversationId: conversationId,
      kind: MessageKind.voice,
      createdAt: now,
      deliveryState: DeliveryState.queued,
      isMine: true,
      replyTo: replyTo,
      attachments: [
        Attachment(
          id: clientMessageId,
          kind: MessageKind.voice,
          url: note.filePath,
          mimeType: note.mimeType,
          byteSize: note.byteSize,
          durationMs: note.duration.inMilliseconds,
        ),
      ],
    );

    _pendingVoiceFiles[clientMessageId] = note.filePath;
    _enqueue(
      echo: echo,
      outgoing: OutgoingMessage(
        clientMessageId: clientMessageId,
        conversationId: conversationId,
        kind: MessageKind.voice,
        replyToMessageId: replyTo?.messageId,
        voiceNote: note,
      ),
      now: now,
    );
    return clientMessageId;
  }

  void _enqueue({
    required Message echo,
    required OutgoingMessage outgoing,
    required DateTime now,
  }) {
    state = state.copyWith(log: state.log.merge([echo]));

    _outbox.enqueue(
      OutboxEntry(
        clientMessageId: outgoing.clientMessageId,
        conversationId: conversationId,
        enqueuedAt: now,
      ),
    );
    _pendingBodies[outgoing.clientMessageId] = outgoing;

    unawaited(drain());
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
      var outbound = outgoing;

      // Upload first, then send. Storing the result back into the queue is what
      // makes a retry cheap: the second attempt re-sends an object key instead
      // of pushing the same bytes again.
      if (outbound.needsUpload) {
        final uploaded = await _messages.uploadVoiceNote(
          conversationId: conversationId,
          note: outbound.voiceNote!,
        );
        if (!_alive) return;
        outbound = outbound.withUploaded(uploaded);
        _pendingBodies[entry.clientMessageId] = outbound;
      }

      final confirmed = await _messages.send(outbound);

      _outbox.markSent(entry.clientMessageId);
      _pendingBodies.remove(entry.clientMessageId);
      _discardRecording(entry.clientMessageId);

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
    _discardRecording(clientMessageId);
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
      state = state.copyWith(log: state.log.merge(missed), isOffline: false);
      await drain();
    } catch (error) {
      if (!_alive) return;
      state = state.copyWith(
        isOffline: ErrorMapper.map(error).kind == AppErrorKind.network,
      );
    }
  }

  /// Delete a temp recording the outbox no longer needs.
  ///
  /// Failure is ignored on purpose: an undeleted file in the OS cache directory
  /// is not worth surfacing an error for, and never worth failing a send over.
  void _discardRecording(String clientMessageId) {
    final path = _pendingVoiceFiles.remove(clientMessageId);
    if (path == null) return;
    unawaited(
      File(path).delete().catchError((Object _) => File(path)),
    );
  }

  /// Apply a realtime arrival. Events are signals: the message is merged, and identity by
  /// client id means our own echo coming back is not duplicated.
  void onRealtimeMessage(Message message) {
    if (message.conversationId != conversationId) return;
    state = state.copyWith(log: state.log.merge([message]));
  }
}

final messagesControllerProvider =
    NotifierProvider.family<MessagesController, MessagesState, String>(
  MessagesController.new,
);
