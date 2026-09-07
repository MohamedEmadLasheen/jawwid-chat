import 'dart:async';

import '../../../core/realtime/realtime_client.dart';
import '../../../core/realtime/realtime_events.dart';
import '../../../shared/models/message.dart';

/// What a realtime event asks the conversation to do.
///
/// The events are SIGNALS, not state. A `message.created` payload carries an
/// id, a seq and an author — enough to know something arrived and where it
/// belongs, and deliberately not the body, because the body is subject to
/// per-reader rules (internal notes, hidden-for-me, approval) that only the
/// read path applies. So the arrival triggers an authorized fetch rather than
/// being trusted as content.
///
/// The one exception is `message.updated`, which does carry the new body: the
/// backend emits it only to the audience that could already read the message,
/// so applying it directly is safe and saves a round trip on every edit.
sealed class ConversationSignal {
  const ConversationSignal();
}

/// Something arrived that this client does not hold. Fetch from the watermark.
class MessagesArrived extends ConversationSignal {
  const MessagesArrived(this.messageId);
  final String messageId;
}

/// A message this client holds was edited.
class MessageEdited extends ConversationSignal {
  const MessageEdited({
    required this.messageId,
    required this.body,
    required this.editedAt,
  });

  final String messageId;
  final String? body;
  final DateTime editedAt;
}

/// A message was withdrawn for everyone.
class MessageWithdrawn extends ConversationSignal {
  const MessageWithdrawn(this.messageId);
  final String messageId;
}

/// A receipt moved. Only ever forward: sent → delivered → read.
class ReceiptAdvanced extends ConversationSignal {
  const ReceiptAdvanced({required this.messageId, required this.state});

  final String messageId;
  final DeliveryState state;
}

/// A reaction was added or removed; the message needs re-reading.
class ReactionsChanged extends ConversationSignal {
  const ReactionsChanged(this.messageId);
  final String messageId;
}

/// Somebody started or stopped typing.
class TypingChanged extends ConversationSignal {
  const TypingChanged({
    required this.actorId,
    required this.displayName,
    required this.isTyping,
  });

  final String actorId;
  final String displayName;
  final bool isTyping;
}

/// Translates raw realtime envelopes into signals for ONE conversation.
///
/// Separate from the controller so the translation — which is where an
/// unrecognised event, a payload missing a field, or an event for a different
/// conversation must all be handled without throwing — is testable on its own.
abstract final class ConversationSignals {
  /// Null when the envelope is for another conversation, or is not one this
  /// conversation acts on. Unknown events are IGNORED rather than an error: a
  /// backend that adds an event must not break a client that predates it.
  static ConversationSignal? read(RealtimeEnvelope envelope, String conversationId) {
    if (envelope.conversationId != conversationId) return null;

    final messageId = envelope.messageId;

    switch (envelope.event) {
      case RealtimeEvent.messageCreated:
        return messageId == null ? null : MessagesArrived(messageId);

      case RealtimeEvent.messageUpdated:
        if (messageId == null) return null;
        final editedAt = envelope.payload['editedAt'];
        return MessageEdited(
          messageId: messageId,
          body: envelope.payload['body'] as String?,
          editedAt: (editedAt is String ? DateTime.tryParse(editedAt) : null)?.toLocal() ??
              DateTime.now(),
        );

      case RealtimeEvent.messageDeleted:
        return messageId == null ? null : MessageWithdrawn(messageId);

      case RealtimeEvent.messageReceiptUpdated:
        if (messageId == null) return null;
        final state = DeliveryState.parse(envelope.payload['state'] as String?);
        return ReceiptAdvanced(messageId: messageId, state: state);

      case RealtimeEvent.reactionAdded:
      case RealtimeEvent.reactionRemoved:
        return messageId == null ? null : ReactionsChanged(messageId);

      case RealtimeEvent.typingStarted:
      case RealtimeEvent.typingStopped:
        final actorId = envelope.actorId;
        if (actorId == null) return null;
        return TypingChanged(
          actorId: actorId,
          displayName: (envelope.payload['displayName'] as String?) ?? '',
          isTyping: envelope.event == RealtimeEvent.typingStarted,
        );

      default:
        return null;
    }
  }
}

/// Who is typing right now, with the stale-indicator protection the server's
/// TTL alone cannot give a client.
///
/// The server broadcasts `typing.stopped` on a stop and on a disconnect, but
/// neither reaches a client whose own connection dropped in between. So each
/// actor's indicator also expires locally: if no further signal arrives within
/// [timeout], it is dropped. That is what stops "…is typing" from being stuck
/// on screen for a person who left ten minutes ago.
class TypingRegistry {
  TypingRegistry({this.timeout = const Duration(seconds: 10)});

  final Duration timeout;
  final Map<String, String> _names = {};
  final Map<String, Timer> _expiries = {};

  /// Called whenever the set changes, so the screen can rebuild.
  void Function()? onChanged;

  List<String> get names => _names.values.toList(growable: false);
  bool get isEmpty => _names.isEmpty;

  void start(String actorId, String displayName) {
    final isNew = !_names.containsKey(actorId);
    _names[actorId] = displayName;

    _expiries[actorId]?.cancel();
    _expiries[actorId] = Timer(timeout, () => stop(actorId));

    if (isNew) onChanged?.call();
  }

  void stop(String actorId) {
    _expiries.remove(actorId)?.cancel();
    if (_names.remove(actorId) != null) onChanged?.call();
  }

  /// Drop everything. Used on disconnect: a connection that has gone cannot
  /// vouch for anybody still typing.
  void clear() {
    for (final timer in _expiries.values) {
      timer.cancel();
    }
    _expiries.clear();
    if (_names.isNotEmpty) {
      _names.clear();
      onChanged?.call();
    }
  }

  void dispose() {
    for (final timer in _expiries.values) {
      timer.cancel();
    }
    _expiries.clear();
    _names.clear();
  }
}

/// Debounces the local user's own typing frames.
///
/// A frame per keystroke would be an amplifier: on a 40-word message that is
/// two hundred socket frames fanned out to every participant, to communicate
/// one bit. This sends `start` once and refreshes it while typing continues,
/// then `stop` after a pause — which is also what the server's own TTL expects.
class TypingSignaller {
  TypingSignaller({
    required RealtimeClient realtime,
    required String conversationId,
    this.idleAfter = const Duration(seconds: 3),
    this.refreshEvery = const Duration(seconds: 5),
  })  : _realtime = realtime,
        _conversationId = conversationId;

  final RealtimeClient _realtime;
  final String _conversationId;

  /// How long after the last keystroke the user counts as having stopped.
  final Duration idleAfter;

  /// How often a continuing typist re-announces, so the server's key does not
  /// expire mid-sentence.
  final Duration refreshEvery;

  Timer? _idle;
  DateTime? _lastSent;

  /// The user typed something.
  void onChanged() {
    final now = DateTime.now();
    final last = _lastSent;
    if (last == null || now.difference(last) >= refreshEvery) {
      _lastSent = now;
      unawaited(_realtime.setTyping(_conversationId, isTyping: true));
    }

    _idle?.cancel();
    _idle = Timer(idleAfter, stop);
  }

  /// The user stopped — sent the message, cleared the field, or left.
  void stop() {
    _idle?.cancel();
    _idle = null;
    if (_lastSent == null) return;
    _lastSent = null;
    unawaited(_realtime.setTyping(_conversationId, isTyping: false));
  }

  void dispose() {
    _idle?.cancel();
    _idle = null;
  }
}

/// The unread divider's position, and how it is decided.
///
/// Held apart from the message log because it must be STICKY: the divider marks
/// where the user had read up to WHEN THEY OPENED the conversation, and it must
/// not creep downwards as they read, or it would always sit at the bottom and
/// mark nothing.
class UnreadMarker {
  const UnreadMarker({this.firstUnreadSequence, this.count = 0});

  /// The sequence of the first message the user had not read on open.
  final int? firstUnreadSequence;

  /// How many were unread on open. Shown on the divider.
  final int count;

  bool get isEmpty => firstUnreadSequence == null || count == 0;

  /// Whether the divider belongs immediately above [message].
  bool marks(Message message) =>
      !isEmpty && message.sequence != null && message.sequence == firstUnreadSequence;

  /// Compute from a conversation's unread count and the messages on screen.
  ///
  /// The count is the server's; the POSITION is derived from it, because the
  /// server tracks a read cursor rather than a divider. Taking the nth-from-last
  /// message is exact when the page holds them all and degrades to the oldest
  /// loaded message when it does not — which is the right way to be wrong: the
  /// divider sits too high rather than hiding unread messages above it.
  static UnreadMarker from({
    required List<Message> ordered,
    required int unreadCount,
  }) {
    if (unreadCount <= 0 || ordered.isEmpty) return const UnreadMarker();

    final confirmed = ordered.where((m) => m.sequence != null).toList();
    if (confirmed.isEmpty) return const UnreadMarker();

    final index = confirmed.length - unreadCount;
    final first = confirmed[index < 0 ? 0 : index];
    return UnreadMarker(firstUnreadSequence: first.sequence, count: unreadCount);
  }
}
