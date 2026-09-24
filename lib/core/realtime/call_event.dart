import '../data/repositories.dart' show CallOutcome;
import '../data/wire/wire_vocab.dart';

/// The call events the backend publishes, as Dart types.
///
/// Mirrors `apps/api/src/communication/contracts/events.ts` — `CallPayload`,
/// `CallParticipantPayload` and `CallEndedPayload` — and nothing else. The four
/// names below are the four the server actually emits.
///
/// WHAT THESE DO NOT MEAN
/// ----------------------
/// [CallAccepted] is an APPLICATION answer: somebody called `POST
/// /calls/:id/accept` and the server moved the call to `active`. It does not
/// say a device reached the media room, published a microphone, or that any
/// audio exists. The server is explicit about this — `call.participant_joined`
/// is the event that would mean media presence, it is emitted by nothing today,
/// and it is deliberately absent here for that reason.
///
/// [CallEnded] is the server's terminal event for the call record. It is not a
/// media event either.
///
/// Keeping those apart is the whole reason these are separate types rather than
/// one bag of fields.
sealed class CallEvent {
  const CallEvent({required this.callId, required this.conversationId});

  final String callId;

  /// The routing field. The server sends every call event to
  /// `conversation:<id>`, and an event without one could not have been routed.
  final String conversationId;
}

/// `call.incoming` — a call was created and is ringing.
///
/// `roomName` is deliberately not part of this payload on the server: the media
/// handle comes back from `POST /calls/:id/token` with the token that makes it
/// usable. Nothing here is a media credential.
final class CallIncoming extends CallEvent {
  const CallIncoming({
    required super.callId,
    required super.conversationId,
    required this.isGroup,
    required this.initiatorId,
    required this.initiatorName,
  });

  final bool isGroup;
  final String initiatorId;

  /// A display name. Never a phone number (BR-2).
  final String initiatorName;
}

/// `call.accepted` — a participant answered at the application level.
final class CallAccepted extends CallEvent {
  const CallAccepted({
    required super.callId,
    required super.conversationId,
    required this.actorId,
  });

  final String actorId;
}

/// `call.declined` — a participant refused a ringing call.
final class CallDeclined extends CallEvent {
  const CallDeclined({
    required super.callId,
    required super.conversationId,
    required this.actorId,
  });

  final String actorId;
}

/// `call.ended` — the call reached a terminal state and carries its outcome.
final class CallEnded extends CallEvent {
  const CallEnded({
    required super.callId,
    required super.conversationId,
    required this.outcome,
    required this.duration,
  });

  final CallOutcome outcome;

  /// Null when the server sent no duration. Not defaulted to zero: "we were not
  /// told" and "the call lasted no time" are different facts, and a call that
  /// was never answered legitimately has no duration.
  final Duration? duration;
}

/// A payload that does not match the contract.
///
/// Thrown only inside [decodeCallEvent] and caught at the client boundary, so a
/// malformed frame is dropped rather than delivered as a trusted object. It
/// carries the event name and the failing field, never the payload — a bad
/// frame is exactly the kind of thing that ends up in a log.
class CallEventFormatException implements Exception {
  const CallEventFormatException(this.event, this.field);

  final String event;
  final String field;

  @override
  String toString() => 'CallEventFormatException($event: $field)';
}

/// The wire names. The server's, not ours.
abstract final class CallEventNames {
  static const incoming = 'call.incoming';
  static const accepted = 'call.accepted';
  static const declined = 'call.declined';
  static const ended = 'call.ended';

  static const all = <String>{incoming, accepted, declined, ended};
}

/// Decode one server frame.
///
/// Returns null for an event this client does not handle — a name outside
/// [CallEventNames.all] is somebody else's event, not an error. Throws
/// [CallEventFormatException] for a name we DO handle whose payload does not
/// match the contract, which is a defect worth surfacing rather than guessing
/// past.
///
/// FAILS CLOSED. Every required field must be present, a string, and non-empty;
/// every enum must be a value the contract defines. There is no branch that
/// substitutes a default for something the server did not send, because a call
/// event with an invented field is worse than no event: it would be acted upon.
CallEvent? decodeCallEvent(String name, Object? payload) {
  if (!CallEventNames.all.contains(name)) return null;

  if (payload is! Map) throw CallEventFormatException(name, 'payload');
  final map = payload;

  String required(String field) {
    final value = map[field];
    if (value is! String || value.isEmpty) {
      throw CallEventFormatException(name, field);
    }
    return value;
  }

  final callId = required('callId');
  final conversationId = required('conversationId');

  switch (name) {
    case CallEventNames.incoming:
      final type = required('type');
      final isGroup = switch (type) {
        Wire.callTypeDirect => false,
        Wire.callTypeGroup => true,
        _ => throw CallEventFormatException(name, 'type'),
      };
      return CallIncoming(
        callId: callId,
        conversationId: conversationId,
        isGroup: isGroup,
        initiatorId: required('initiatorId'),
        initiatorName: required('initiatorName'),
      );

    case CallEventNames.accepted:
      return CallAccepted(
        callId: callId,
        conversationId: conversationId,
        actorId: required('actorId'),
      );

    case CallEventNames.declined:
      return CallDeclined(
        callId: callId,
        conversationId: conversationId,
        actorId: required('actorId'),
      );

    case CallEventNames.ended:
      final outcome = switch (required('outcome')) {
        Wire.callAnswered => CallOutcome.answered,
        Wire.callMissed => CallOutcome.missed,
        Wire.callDeclined => CallOutcome.declined,
        _ => throw CallEventFormatException(name, 'outcome'),
      };
      // Nullable BY CONTRACT (`durationSeconds: number | null`), so absent and
      // null are both legitimate. Any other type is not.
      final raw = map['durationSeconds'];
      if (raw != null && raw is! int) {
        throw CallEventFormatException(name, 'durationSeconds');
      }
      final seconds = raw as int?;
      if (seconds != null && seconds < 0) {
        throw CallEventFormatException(name, 'durationSeconds');
      }
      return CallEnded(
        callId: callId,
        conversationId: conversationId,
        outcome: outcome,
        duration: seconds == null ? null : Duration(seconds: seconds),
      );
  }

  // Unreachable: `all` and the switch above are the same four names.
  throw CallEventFormatException(name, 'event');
}
