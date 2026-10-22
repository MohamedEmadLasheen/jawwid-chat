import '../../../core/errors/app_error.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/utils/app_clock.dart';
import '../domain/scheduled_call.dart';
import 'scheduled_call_repository.dart';

/// `/scheduled-calls` over the application's shared [ApiClient] (PD-13).
///
/// ONE CLIENT, NOT A SECOND STACK: the same `ApiClient` every repository
/// receives, with its one refresh lifecycle.
///
/// IT FAILS CLOSED, like `HttpAccountCallHistory`. A list with a row this client
/// cannot read is refused whole rather than shown shortened, and a single DTO
/// that is missing a required field is an error rather than a guessed default.
/// A wrong time on a scheduled call is worse than no row at all.
class HttpScheduledCallRepository implements ScheduledCallRepository {
  HttpScheduledCallRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<List<ScheduledCall>> upcoming() async {
    final response = await _client.get<Map<String, Object?>>(
      '/scheduled-calls',
    );
    final rows = response.data?['items'];
    if (rows is! List) throw _malformed('response carried no items array');
    return [
      for (final row in rows)
        if (row is Map)
          parseScheduledCall(row)
        else
          throw _malformed('an item was not an object'),
    ];
  }

  @override
  Future<ScheduledCall> get(String id) async {
    final response = await _client.get<Map<String, Object?>>(
      '/scheduled-calls/$id',
    );
    return _one(response.data);
  }

  @override
  Future<ScheduledCall> create({
    required String conversationId,
    required ScheduledCallKind kind,
    DateTime? startsAt,
    String? title,
  }) async {
    final trimmed = title?.trim();
    final response = await _client.post<Map<String, Object?>>(
      '/scheduled-calls',
      data: {
        'conversationId': conversationId,
        'kind': kind.name,
        if (kind == ScheduledCallKind.scheduled && startsAt != null)
          'startsAt': startsAt.toUtc().toIso8601String(),
        if (trimmed != null && trimmed.isNotEmpty) 'title': trimmed,
      },
    );
    return _one(response.data);
  }

  @override
  Future<ScheduledCall> cancel(String id) async {
    final response = await _client.post<Map<String, Object?>>(
      '/scheduled-calls/$id/cancel',
    );
    return _one(response.data);
  }

  @override
  Future<ScheduledJoin> join(String id) async {
    final response = await _client.post<Map<String, Object?>>(
      '/scheduled-calls/$id/join',
    );
    final data = response.data;
    final callId = data?['callId'];
    final conversationId = data?['conversationId'];
    final mode = switch (data?['mode']) {
      'started' => ScheduledJoinMode.started,
      'joined' => ScheduledJoinMode.joined,
      _ => null,
    };
    if (callId is! String ||
        callId.isEmpty ||
        conversationId is! String ||
        mode == null) {
      throw _malformed('join answer missing callId, conversationId or mode');
    }
    return ScheduledJoin(
      callId: callId,
      conversationId: conversationId,
      mode: mode,
    );
  }

  ScheduledCall _one(Map<String, Object?>? data) {
    if (data == null) throw _malformed('response had no body');
    return parseScheduledCall(data);
  }
}

/// One `ScheduledCallDto`, or a refusal. Public for the tests and for any other
/// reader of the same DTO; there is no branch that substitutes a default for a
/// required field the server did not send.
ScheduledCall parseScheduledCall(Map<dynamic, dynamic> row) {
  final id = row['id'];
  final conversationId = row['conversationId'];
  final kind = switch (row['kind']) {
    'scheduled' => ScheduledCallKind.scheduled,
    'link' => ScheduledCallKind.link,
    _ => null,
  };
  final state = switch (row['state']) {
    'upcoming' => ScheduledCallState.upcoming,
    'open' => ScheduledCallState.open,
    'cancelled' => ScheduledCallState.cancelled,
    'over' => ScheduledCallState.over,
    _ => null,
  };
  DateTime? time(String key) {
    final raw = row[key];
    return AppClock.parse(raw);
  }

  final startsAt = time('startsAt');
  final from = time('joinableFrom');
  final until = time('joinableUntil');
  if (id is! String ||
      id.isEmpty ||
      conversationId is! String ||
      conversationId.isEmpty ||
      kind == null ||
      state == null ||
      startsAt == null ||
      from == null ||
      until == null) {
    throw _malformed('a scheduled call was missing a required field');
  }

  final title = row['title'];
  if (title != null && title is! String) {
    throw _malformed('title was not a string');
  }
  final createdBy = row['createdBy'];
  final createdByName = createdBy is Map && createdBy['displayName'] is String
      ? (createdBy['displayName'] as String).trim()
      : null;

  return ScheduledCall(
    id: id,
    conversationId: conversationId,
    kind: kind,
    title: (title as String?)?.trim().isEmpty ?? true
        ? null
        : (title as String).trim(),
    startsAt: startsAt,
    joinableFrom: from,
    joinableUntil: until,
    state: state,
    createdByName: createdByName == null || createdByName.isEmpty
        ? null
        : createdByName,
    canCancel: row['canCancel'] == true,
  );
}

AppError _malformed(String detail) => AppError(
  AppErrorKind.server,
  code: 'malformed_scheduled_call',
  debugDetail: detail,
);
