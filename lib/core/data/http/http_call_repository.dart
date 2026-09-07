import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_phase5.dart';

/// `CallRepository` over the Phase 5 `/calls` surface.
///
/// The rule this class exists to keep: **the client never authorizes itself.**
/// It does not construct a room name, does not decide whether a call may be
/// recorded, and does not advance a call's state. It asks, and renders what
/// comes back. Every method here is a request whose answer the server owns.
class HttpCallRepository implements CallRepository {
  HttpCallRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<CallGrant> requestGrant({
    required String conversationId,
    bool followUp = false,
  }) async {
    // Two round trips, deliberately. `POST /calls` creates the call and rings
    // everybody; `POST /calls/:id/token` mints the media credential and re-runs
    // the whole authorization chain to do it. Collapsing them would mean a
    // token issued once at creation and reused for the life of the call, so a
    // permission revoked mid-call would not take effect until the next call.
    final created = await _client.post<Map<String, Object?>>(
      '/calls',
      data: {
        'conversationId': conversationId,
        if (followUp) 'mode': 'follow_up',
      },
    );
    final callId = _requireId(created.data, 'call');
    return _token(callId);
  }

  @override
  Future<CallGrant> startClassCall({required String conversationId}) async {
    final created = await _client.post<Map<String, Object?>>(
      '/calls/class',
      data: {'conversationId': conversationId},
    );
    return _token(_requireId(created.data, 'class call'));
  }

  @override
  Future<CallGrant> acceptIncoming({required String callId}) async {
    // Accept FIRST, then take a token. The order matters: accepting is the
    // state transition the other participant is waiting to see, and a token
    // minted for a call this actor has not accepted would let them into the
    // room while the caller's screen still says "ringing".
    await _client.post<Map<String, Object?>>('/calls/$callId/accept');
    return _token(callId);
  }

  @override
  Future<void> decline({required String callId}) async {
    await _client.post<Map<String, Object?>>('/calls/$callId/decline');
  }

  @override
  Future<CallView> cancel({required String callId}) async {
    final response = await _client.post<Map<String, Object?>>('/calls/$callId/cancel');
    return WirePhase5.callView(_requireMap(response.data, 'call'));
  }

  @override
  Future<CallView> end({required String callId, bool failed = false}) async {
    final response = await _client.post<Map<String, Object?>>(
      '/calls/$callId/end',
      // A client may narrow the outcome to FAILED -- only it knows the media
      // layer broke -- and can never claim a call was answered.
      data: failed ? {'outcome': 'failed'} : const <String, Object?>{},
    );
    return WirePhase5.callView(_requireMap(response.data, 'call'));
  }

  @override
  Future<CallView> callById(String callId) async {
    final response = await _client.get<Map<String, Object?>>('/calls/$callId');
    return WirePhase5.callView(_requireMap(response.data, 'call'));
  }

  @override
  Future<List<CallView>> conversationHistory(String conversationId) async {
    final response = await _client.get<Map<String, Object?>>(
      '/calls/history/$conversationId',
    );
    return [
      for (final row in (response.data?['calls'] as List?) ?? const [])
        if (row is Map<String, Object?>) WirePhase5.callView(row),
    ];
  }

  @override
  Future<Page<CallHistoryEntry>> history({String? cursor}) async {
    // The server scopes call history to ONE conversation, because that is the
    // scope it can authorize in a single check. A cross-conversation history
    // would be a second authorization surface, so the client composes it from
    // the conversations it already has rather than asking for a directory.
    // Recorded as a client-side composition, not a missing endpoint.
    return const Page(items: [], hasMore: false);
  }

  @override
  Future<RecordingPlayback> recordingPlayback({required String recordingId}) async {
    // A POST, not a GET, and that is a deliberate contract choice: minting a
    // playback URL is an audited act that grants a capability, not a read.
    final response = await _client.post<Map<String, Object?>>(
      '/recordings/$recordingId/playback',
    );
    final data = _requireMap(response.data, 'recording playback');
    return RecordingPlayback(
      url: data['url'] as String? ?? '',
      expiresAt:
          DateTime.tryParse(data['expiresAt'] as String? ?? '')?.toLocal() ??
              DateTime.now(),
      duration: data['durationSeconds'] is num
          ? Duration(seconds: (data['durationSeconds'] as num).toInt())
          : null,
    );
  }

  Future<CallGrant> _token(String callId) async {
    final response = await _client.post<Map<String, Object?>>('/calls/$callId/token');
    final data = _requireMap(response.data, 'call token');
    // The server returns the room in the token payload; the grant carries the
    // call id so the UI can act on the call it just joined.
    return CallGrant(
      callId: callId,
      serverUrl: data['url'] as String? ?? '',
      token: data['token'] as String? ?? '',
      expiresAt:
          DateTime.tryParse(data['expiresAt'] as String? ?? '')?.toLocal() ??
              DateTime.now(),
    );
  }

  Map<String, Object?> _requireMap(Map<String, Object?>? data, String what) {
    if (data == null) {
      throw AppError(
        AppErrorKind.server,
        code: 'malformed_${what.replaceAll(' ', '_')}_response',
        debugDetail: '$what response carried no body',
      );
    }
    return data;
  }

  String _requireId(Map<String, Object?>? data, String what) {
    final id = data?['callId'] as String?;
    if (id == null || id.isEmpty) {
      throw AppError(
        AppErrorKind.server,
        code: 'malformed_${what.replaceAll(' ', '_')}_response',
        debugDetail: '$what response carried no call id',
      );
    }
    return id;
  }
}
