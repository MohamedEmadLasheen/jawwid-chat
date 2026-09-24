import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_vocab.dart';

/// `CallRepository` over the endpoints the backend actually has.
///
/// WHAT THIS LAYER IS FOR. Transport and shape: it sends the authenticated
/// request the contract describes and turns the answer into a typed value. It
/// holds no policy. Whether a call may be started is decided by the server on
/// every operation, and this class has no branch that could decide otherwise.
///
/// THE ACTOR IS NEVER SENT. Identity comes from the bearer token the
/// [ApiClient] already attaches; no method here takes an actor id, so there is
/// no parameter through which a caller could name somebody else. `POST /calls`
/// takes a conversationId and nothing more.
///
/// ERRORS KEEP THE SERVER'S CODE. [ApiClient] maps a `COMM.*` body into an
/// [AppError] carrying that code, so a revoked relationship
/// (`TEACHER_PARENT_NOT_AUTHORIZED`) stays distinguishable from a call that has
/// already ended. Nothing here collapses them into "call failed".
class HttpCallRepository implements CallRepository {
  HttpCallRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<CallCapability> capability({required String conversationId}) async {
    final response = await _client.get<Map<String, Object?>>(
      '/conversations/$conversationId/call-capability',
    );
    final data = _require(response.data, 'call_capability');

    // FAIL CLOSED on a shape we do not recognise. A missing or non-boolean
    // `canCall` must not read as "yes": this decides whether an affordance is
    // offered, and the safe direction is not offering it.
    final canCall = data['canCall'];
    if (canCall is! bool) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_call_capability',
        debugDetail: 'call-capability response carried no boolean canCall',
      );
    }
    final code = data['code'];
    return CallCapability(
      canCall: canCall,
      code: code is String && code.isNotEmpty ? code : null,
    );
  }

  @override
  Future<StartedCall> start({required String conversationId}) async {
    final response = await _client.post<Map<String, Object?>>(
      '/calls',
      data: {'conversationId': conversationId},
    );
    final data = _require(response.data, 'start_call');
    return StartedCall(
      callId: _string(data, 'callId', 'start_call'),
      roomName: _string(data, 'roomName', 'start_call'),
    );
  }

  @override
  Future<CallMediaGrant> mediaToken({required String callId}) async {
    final response = await _client.post<Map<String, Object?>>(
      '/calls/$callId/token',
    );
    final data = _require(response.data, 'call_media_token');

    final expiresAt = DateTime.tryParse(_string(data, 'expiresAt', 'call_media_token'));
    if (expiresAt == null) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_call_media_token',
        debugDetail: 'media token response carried an unparseable expiresAt',
      );
    }

    return CallMediaGrant(
      token: _string(data, 'token', 'call_media_token'),
      serverUrl: _string(data, 'url', 'call_media_token'),
      roomName: _string(data, 'roomName', 'call_media_token'),
      expiresAt: expiresAt,
    );
  }

  @override
  Future<void> accept({required String callId}) async {
    await _client.post<Map<String, Object?>>('/calls/$callId/accept');
  }

  @override
  Future<void> decline({required String callId}) async {
    await _client.post<Map<String, Object?>>('/calls/$callId/decline');
  }

  @override
  Future<void> end({required String callId, String? outcome}) async {
    await _client.post<Map<String, Object?>>(
      '/calls/$callId/end',
      // Omitted rather than defaulted: the server derives the outcome from
      // whether the call was answered, and guessing it here would write a
      // history the client invented.
      data: outcome == null ? null : {'outcome': outcome},
    );
  }

  @override
  Future<List<CallHistoryEntry>> callHistory({
    required String conversationId,
  }) async {
    final response = await _client.get<Map<String, Object?>>(
      '/calls/history/$conversationId',
    );
    final data = _require(response.data, 'call_history');

    final rows = data['calls'];
    if (rows is! List) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_call_history',
        debugDetail: 'call history response carried no calls array',
      );
    }

    final entries = <CallHistoryEntry>[];
    for (final row in rows) {
      if (row is! Map) continue;
      final entry = _historyEntry(row);
      if (entry != null) entries.add(entry);
    }
    return entries;
  }

  /// One history row, or null when it cannot be trusted.
  ///
  /// A row that does not parse is DROPPED rather than rendered half-built or
  /// allowed to fail the whole list: one malformed entry should not empty a
  /// parent's call history.
  CallHistoryEntry? _historyEntry(Map<dynamic, dynamic> row) {
    final id = row['id'];
    final conversationId = row['conversationId'];
    final startedAt = DateTime.tryParse(row['startedAt'] as String? ?? '');
    if (id is! String || conversationId is! String || startedAt == null) {
      return null;
    }

    final outcome = switch (row['outcome']) {
      Wire.callAnswered => CallOutcome.answered,
      Wire.callMissed => CallOutcome.missed,
      Wire.callDeclined => CallOutcome.declined,
      // A call still ringing or active has no outcome yet. `missed` is the
      // honest placeholder for a row with no answer recorded; it is also what
      // the server writes when such a call is swept.
      _ => CallOutcome.missed,
    };

    final seconds = row['durationSeconds'];
    return CallHistoryEntry(
      id: id,
      conversationId: conversationId,
      // NO DISPLAY NAME EXISTS. The history rows carry `initiatorId` and no
      // name, so this is left empty for the interface to treat as unresolved
      // rather than filled with an id a parent would then read. Same choice
      // HttpGroupRepository makes for members; recorded as O3 in
      // `docs/mobile/backend-dependencies.md`.
      title: '',
      startedAt: startedAt,
      outcome: outcome,
      isGroup: row['type'] == Wire.callTypeGroup,
      duration: seconds is int ? Duration(seconds: seconds) : null,
    );
  }

  Map<String, Object?> _require(Map<String, Object?>? data, String what) {
    if (data == null) {
      throw AppError(
        AppErrorKind.server,
        code: 'malformed_$what',
        debugDetail: '$what response had no body',
      );
    }
    return data;
  }

  String _string(Map<String, Object?> data, String field, String what) {
    final value = data[field];
    if (value is! String || value.isEmpty) {
      throw AppError(
        AppErrorKind.server,
        code: 'malformed_$what',
        debugDetail: '$what response carried no $field',
      );
    }
    return value;
  }
}
