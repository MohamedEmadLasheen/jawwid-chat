import '../repositories.dart';

/// Wire mapping for the Phase 5 contracts: calls, recordings, stories and
/// broadcast.
///
/// Kept beside [WireMappers] rather than inside it because these are a distinct
/// contract surface, and because every function here follows the same rule the
/// existing mappers do: an unknown enum value from the server maps to a safe
/// local default rather than throwing. A client that crashes on a value the
/// backend added is a client that cannot be deployed independently of it.
abstract final class WirePhase5 {
  // The server's strings, named once. A listener cannot drift from the contract
  // silently, and a value the backend renames fails visibly at this boundary
  // rather than producing a screen that quietly stops updating.
  static const _statuses = <String, CallStatus>{
    'initiated': CallStatus.initiated,
    'ringing': CallStatus.ringing,
    'active': CallStatus.active,
    'ended': CallStatus.ended,
  };

  static const _outcomes = <String, CallOutcome>{
    'answered': CallOutcome.answered,
    'missed': CallOutcome.missed,
    'declined': CallOutcome.declined,
    'cancelled': CallOutcome.cancelled,
    'failed': CallOutcome.failed,
  };

  static const _kinds = <String, CallKind>{
    'direct': CallKind.direct,
    'group': CallKind.group,
    'class': CallKind.classCall,
  };

  static const _participantStates = <String, CallParticipantState>{
    'invited': CallParticipantState.invited,
    'joined': CallParticipantState.joined,
    'declined': CallParticipantState.declined,
    'left': CallParticipantState.left,
    'missed': CallParticipantState.missed,
  };

  static CallStatus callStatus(Object? raw) =>
      _statuses[raw as String? ?? ''] ?? CallStatus.ended;

  static CallOutcome? callOutcome(Object? raw) =>
      raw == null ? null : _outcomes[raw as String? ?? ''];

  static CallKind callKind(Object? raw) =>
      _kinds[raw as String? ?? ''] ?? CallKind.direct;

  /// An unrecognised mode is NORMAL.
  ///
  /// The safe direction, and the only defensible one: mapping an unknown value
  /// to `followUp` would show a recording indicator on a call that is not being
  /// recorded, and mapping it the other way shows no indicator on a call that
  /// might be. Neither is good — but the server's own default is `normal`, and
  /// the recording indicator is driven by [CallView.mode] straight from the
  /// server on a call that really is recordable.
  static CallMode callMode(Object? raw) =>
      raw == 'follow_up' ? CallMode.followUp : CallMode.normal;

  static DateTime? _at(Object? raw) =>
      raw is String ? DateTime.tryParse(raw)?.toLocal() : null;

  static CallView callView(Map<String, Object?> json) => CallView(
        id: json['id'] as String? ?? '',
        conversationId: json['conversationId'] as String? ?? '',
        kind: callKind(json['type']),
        mode: callMode(json['mode']),
        status: callStatus(json['status']),
        initiatorId: json['initiatorId'] as String? ?? '',
        startedAt: _at(json['startedAt']) ?? DateTime.now(),
        outcome: callOutcome(json['outcome']),
        answeredAt: _at(json['answeredAt']),
        endedAt: _at(json['endedAt']),
        ringExpiresAt: _at(json['ringExpiresAt']),
        duration: json['durationSeconds'] is num
            ? Duration(seconds: (json['durationSeconds'] as num).toInt())
            : null,
        // Absent means false. The server sends false rather than omitting the
        // field for an unauthorized reader, and this treats a missing field the
        // same way — either route ends at "you are not told there is one".
        hasRecording: json['hasRecording'] == true,
        participants: [
          for (final row in (json['participants'] as List?) ?? const [])
            if (row is Map<String, Object?>)
              CallParticipantView(
                actorId: row['actorId'] as String? ?? '',
                state: _participantStates[row['state'] as String? ?? ''] ??
                    CallParticipantState.invited,
                joinedAt: _at(row['joinedAt']),
              ),
        ],
      );

  /// An incoming call, from the `call.incoming` / `call.class_started` payload.
  ///
  /// Both events carry the same core fields; the class variant adds the group
  /// and teacher names. Note what is NOT read from the payload: any sentence to
  /// show the user. The words come from the notification the server rendered in
  /// the recipient's own locale, or from this app's own localisations.
  static IncomingCall incomingCall(Map<String, Object?> payload) {
    final kind = callKind(payload['type']);
    return IncomingCall(
      callId: payload['callId'] as String? ?? '',
      conversationId: payload['conversationId'] as String? ?? '',
      callerName: (payload['teacherName'] ?? payload['initiatorName']) as String? ?? '',
      kind: kind,
      mode: callMode(payload['mode']),
      expiresAt: _at(payload['expiresAt']),
      groupName: payload['groupName'] as String?,
    );
  }

  static CallGrant callGrant(Map<String, Object?> json) => CallGrant(
        callId: json['callId'] as String? ?? '',
        serverUrl: json['url'] as String? ?? '',
        token: json['token'] as String? ?? '',
        expiresAt: _at(json['expiresAt']) ?? DateTime.now(),
      );

  // --- Stories --------------------------------------------------------------

  static Story story(Map<String, Object?> json) => Story(
        id: json['id'] as String? ?? '',
        state: json['state'] as String? ?? 'draft',
        title: json['title'] as String?,
        body: json['body'] as String?,
        mediaUrl: json['mediaUrl'] as String?,
        mediaKind: json['mediaKind'] as String?,
        publishedAt: _at(json['publishedAt']),
        expiresAt: _at(json['expiresAt']),
        viewed: json['viewed'] == true,
      );

}
