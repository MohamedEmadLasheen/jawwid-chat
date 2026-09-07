import '../../app/router.dart';

/// Where a notification tap should take the user.
sealed class PushDestination {
  const PushDestination();
}

/// Open one conversation.
class OpenConversation extends PushDestination {
  const OpenConversation(this.conversationId);
  final String conversationId;

  /// The in-app location. Named through [Routes] rather than built here, so a
  /// deep link and in-app navigation cannot drift apart.
  String get location => Routes.conversation(conversationId);
}

/// Open the incoming-call flow for one call.
class OpenIncomingCall extends PushDestination {
  const OpenIncomingCall({required this.callId, required this.conversationId});
  final String callId;
  final String conversationId;

  /// Calls have no screen of their own yet, so the destination is the
  /// conversation the call belongs to. Stated here, once, rather than by
  /// silently emitting an OpenConversation — when the call screen lands, this
  /// is the single line that changes, and the fact that call notifications
  /// currently arrive at the thread is visible rather than lost.
  String get location => Routes.conversation(conversationId);
}

/// Nothing actionable. The app opens where it would have opened anyway.
class OpenNowhere extends PushDestination {
  const OpenNowhere(this.reason);

  /// For logs. Never shown: a person who tapped a notification does not want an
  /// error, they want the app.
  final String reason;
}

/// Reads the `data` map of a push notification.
///
/// ## This decides a DESTINATION, never an ACCESS
///
/// The payload names a conversation id. It does not, and cannot, establish that
/// the person holding the phone may read that conversation — the payload is
/// data that arrived over the network, and treating it as authorization would
/// mean anyone who could deliver a notification could name any conversation.
///
/// The route it produces resolves the conversation from the backend, which runs
/// the same authorization the rest of the app does, so an id this device is not
/// entitled to fails there with a safe error rather than opening a thread. That
/// is the whole reason the destination is a ROUTE and not a payload of message
/// content: nothing is rendered from what the notification said.
///
/// ## Why the shape is checked at all
///
/// Not for security — the server decides that — but because a malformed or
/// stale payload must produce "open the app normally" rather than a navigation
/// to a nonsense location, a crash, or a blank screen. A notification is often
/// the thing that reopens an app after days; it is the worst possible moment
/// for an unhandled cast.
abstract final class PushPayload {
  /// Ids we will act on. Anything else is treated as unactionable rather than
  /// passed through: an id from a payload becomes a URL path, and a path
  /// segment must not be able to carry a traversal or a query.
  static final _id = RegExp(r'^[A-Za-z0-9_-]{1,64}$');

  static PushDestination destinationOf(Map<String, Object?> data) {
    final eventType = _string(data['eventType']);
    if (eventType == null) return const OpenNowhere('no event type');

    final conversationId = _string(data['conversationId']);

    return switch (eventType) {
      'call_started' || 'group_call_started' || 'class_call_started' => _call(
          callId: _string(data['callId']) ?? _string(data['call_id']),
          conversationId: conversationId,
        ),
      // A missed call is history, not an invitation: it opens the conversation,
      // never a ringing screen for a call that has ended.
      'call_missed' => _conversation(conversationId),
      'message_published' ||
      'approval_requested' ||
      'approval_decided' =>
        _conversation(conversationId),
      // Everything else is a real notification with no in-app destination —
      // a payment reminder, a schedule change. Opening the app is right.
      _ => OpenNowhere('no destination for $eventType'),
    };
  }

  static PushDestination _conversation(String? conversationId) {
    if (conversationId == null || !_id.hasMatch(conversationId)) {
      return const OpenNowhere('missing or malformed conversation id');
    }
    return OpenConversation(conversationId);
  }

  static PushDestination _call({String? callId, String? conversationId}) {
    if (conversationId == null || !_id.hasMatch(conversationId)) {
      return const OpenNowhere('missing or malformed conversation id');
    }
    if (callId == null || !_id.hasMatch(callId)) {
      return const OpenNowhere('missing or malformed call id');
    }
    return OpenIncomingCall(callId: callId, conversationId: conversationId);
  }

  /// The platforms disagree about payload value types — APNs preserves JSON
  /// types and FCM stringifies everything — so nothing is assumed to be a
  /// String already.
  static String? _string(Object? value) {
    if (value is String) return value.isEmpty ? null : value;
    if (value is num || value is bool) return value.toString();
    return null;
  }

  /// The notification id, so the client can report that it was opened.
  static String? notificationIdOf(Map<String, Object?> data) =>
      _string(data['notificationId']);
}
