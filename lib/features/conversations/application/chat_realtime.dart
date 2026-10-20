import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/realtime/call_realtime_client.dart';
import '../../../core/realtime/chat_signal.dart';
import '../../calls/application/call_session.dart';
import '../../messages/application/marks_providers.dart';
import '../../messages/application/messages_controller.dart';
import '../domain/conversation_list.dart';
import 'conversations_controller.dart';

/// Live chat for the signed-in session: keeps the chat list and every open
/// thread in step with the server without a pull-to-refresh.
///
/// NO SECOND CONNECTION. It rides the session's one realtime client
/// ([callRealtimeClientProvider]) and its one socket; it adds listeners to that
/// client's [CallRealtimeClient.chatSignals] and nothing else.
///
/// SIGNALS, NOT STATE. An event says which conversation changed and the
/// coordinator asks the server, through the same authorized REST routes the
/// screens read from. Nothing here writes a message, a count or a preview from
/// an event payload -- `message.created` carries no body to write -- so a
/// duplicate or replayed event costs one idempotent re-read and nothing else.
/// The thread log already de-duplicates by message identity.
///
/// WHAT IT SUBSCRIBES TO. Every conversation in the account's list, so a
/// message in a conversation that is not open still moves the list and its
/// unread badge. The list is the server's answer to "what may I read", so the
/// subscription set can never be wider than that, and the server re-authorizes
/// each subscribe anyway. A conversation the account is ADDED to arrives as
/// `conversation.added` in the account's own room, which refreshes the list,
/// which subscribes it.
class ChatRealtimeCoordinator {
  ChatRealtimeCoordinator(
    this._ref,
    this._client, {
    this.listRefreshDebounce = const Duration(milliseconds: 300),
    this.safetyResyncInterval = const Duration(seconds: 60),
  });

  final Ref _ref;
  final CallRealtimeClient _client;

  /// A burst of events (a group thread, a reconnect) becomes one list read.
  final Duration listRefreshDebounce;

  /// THE SAFETY NET. Events are at-least-once from a durable outbox, but the
  /// last hop -- one socket emit -- has no acknowledgement: a delivery the
  /// server refuses to risk (a lock it could not take in time, a node that
  /// lost its realtime lease) is dropped rather than sent unchecked. The next
  /// event or reconnect heals it; this bounds how long it can stay unhealed
  /// when neither comes. One list read and one watermark read per open thread.
  final Duration safetyResyncInterval;
  Timer? _safety;

  final _requested = <String>{};
  StreamSubscription<ChatSignal>? _signals;
  Timer? _listRefresh;
  bool _disposed = false;

  /// Conversations this coordinator has asked the server to subscribe it to.
  Set<String> get requested => Set.unmodifiable(_requested);

  void start() {
    _signals = _client.chatSignals.listen(_onSignal);
    _safety = Timer.periodic(safetyResyncInterval, (_) => _catchUpEverything());
    _ref.listen<AsyncValue<List<ConversationSection>>>(
      conversationsControllerProvider,
      (_, next) {
        final sections = next.value;
        if (sections == null) return;
        _syncSubscriptions({
          for (final section in sections)
            for (final conversation in section.conversations) conversation.id,
        });
      },
      fireImmediately: true,
    );
  }

  void _syncSubscriptions(Set<String> wanted) {
    if (_disposed) return;
    for (final id in _requested.difference(wanted).toList()) {
      _requested.remove(id);
      unawaited(_client.unsubscribe(id));
    }
    for (final id in wanted.difference(_requested)) {
      _requested.add(id);
      unawaited(_client.subscribe(id));
    }
  }

  void _onSignal(ChatSignal signal) {
    if (_disposed) return;
    final id = signal.conversationId;
    switch (signal.kind) {
      case ChatSignalKind.messageCreated:
        final thread = _openThread(id);
        if (thread != null) unawaited(thread.onMessageCreated(signal.seq));
        _scheduleListRefresh();
      case ChatSignalKind.messageChanged:
        final thread = _openThread(id);
        if (thread != null) unawaited(thread.refreshLatest());
        _scheduleListRefresh();
      case ChatSignalKind.conversationUpdated:
        // A pin or unpin arrives this way: the open thread re-reads its page
        // (the pinned flags) and its pinned bar.
        final thread = _openThread(id);
        if (thread != null) unawaited(thread.refreshLatest());
        if (id != null) _ref.invalidate(pinnedMessagesProvider(id));
        _scheduleListRefresh();
      case ChatSignalKind.membershipChanged:
        _scheduleListRefresh();
      case ChatSignalKind.accessRevoked:
        // The server already took the socket out of the room. Re-read what is
        // still readable; a thread that is not answers with its own refusal.
        final thread = _openThread(id);
        if (thread != null) unawaited(thread.refreshLatest());
        _scheduleListRefresh();
      case ChatSignalKind.reconnected:
        // Anything may have happened while the socket was down.
        _catchUpEverything();
    }
  }

  /// Catch every open thread up from its watermark and re-read the newest page
  /// (an approval or a deletion does not move a watermark), then the list.
  void _catchUpEverything() {
    if (_disposed) return;
    for (final conversationId in _requested) {
      final thread = _openThread(conversationId);
      if (thread == null) continue;
      unawaited(thread.resync().then((_) => thread.refreshLatest()));
    }
    _scheduleListRefresh();
  }

  /// The thread controller for [conversationId], ONLY if a screen already
  /// created it. Reading it otherwise would load a conversation nobody opened.
  MessagesController? _openThread(String? conversationId) {
    if (conversationId == null) return null;
    final provider = messagesControllerProvider(conversationId);
    if (!_ref.exists(provider)) return null;
    return _ref.read(provider.notifier);
  }

  void _scheduleListRefresh() {
    _listRefresh?.cancel();
    _listRefresh = Timer(listRefreshDebounce, () {
      if (_disposed) return;
      unawaited(_ref.read(conversationsControllerProvider.notifier).refresh());
    });
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _listRefresh?.cancel();
    _safety?.cancel();
    unawaited(_signals?.cancel());
    _signals = null;
    _requested.clear();
  }
}

/// The session's chat realtime, or null while signed out.
///
/// Keyed on the session's realtime client, which is itself keyed on the
/// account: a sign-out disposes this coordinator (and its listeners) before
/// the next account's exists, so nothing of one account's live chat survives
/// into another's. Watched by the signed-in shell so it lives exactly as long
/// as an authenticated UI does.
final chatRealtimeProvider = Provider<ChatRealtimeCoordinator?>((ref) {
  final client = ref.watch(callRealtimeClientProvider);
  if (client == null) return null;

  final coordinator = ChatRealtimeCoordinator(ref, client);
  ref.onDispose(coordinator.dispose);
  coordinator.start();
  return coordinator;
});
