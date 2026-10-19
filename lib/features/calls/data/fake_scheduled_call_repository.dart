import '../../../core/errors/app_error.dart';
import '../domain/scheduled_call.dart';
import 'scheduled_call_repository.dart';

/// Scheduled calls for the fixture build: in memory, gone on restart.
///
/// It mirrors the server's window (10 minutes before the start until 2 hours
/// after it) so the fixture build exercises the same Join states, and it
/// starts calls through the fixture call repository it is handed, so a Join
/// produces a call id the rest of the fixture call stack recognises. It posts
/// no card into the conversation: the fixture backend has no card writer.
class FakeScheduledCallRepository implements ScheduledCallRepository {
  FakeScheduledCallRepository({
    required Future<String> Function(String conversationId) startCall,
    DateTime Function()? clock,
  }) : _startCall = startCall,
       _clock = clock ?? DateTime.now;

  final Future<String> Function(String conversationId) _startCall;
  final DateTime Function() _clock;

  final _rows = <String, _Row>{};
  var _next = 0;

  static const _openBefore = Duration(minutes: 10);
  static const _openAfter = Duration(hours: 2);

  @override
  Future<List<ScheduledCall>> upcoming() async {
    final now = _clock();
    final out = [
      for (final row in _rows.values)
        if (!row.cancelled && !now.isAfter(row.startsAt.add(_openAfter)))
          _dto(row, now),
    ]..sort((a, b) => a.startsAt.compareTo(b.startsAt));
    return out;
  }

  @override
  Future<ScheduledCall> get(String id) async => _dto(_find(id), _clock());

  @override
  Future<ScheduledCall> create({
    required String conversationId,
    required ScheduledCallKind kind,
    DateTime? startsAt,
    String? title,
  }) async {
    final now = _clock();
    final at = kind == ScheduledCallKind.link ? now : startsAt;
    if (at == null) {
      throw const AppError(
        AppErrorKind.validation,
        code: 'COMMON.VALIDATION',
        debugDetail: 'startsAt',
      );
    }
    final id = 'fake-scheduled-${_next++}';
    final trimmed = title?.trim();
    _rows[id] = _Row(
      id: id,
      conversationId: conversationId,
      kind: kind,
      title: trimmed == null || trimmed.isEmpty ? null : trimmed,
      startsAt: at,
    );
    return _dto(_rows[id]!, now);
  }

  @override
  Future<ScheduledCall> cancel(String id) async {
    final row = _find(id);
    row.cancelled = true;
    return _dto(row, _clock());
  }

  @override
  Future<ScheduledJoin> join(String id) async {
    final row = _find(id);
    final now = _clock();
    final dto = _dto(row, now);
    if (!dto.isJoinableAt(now)) {
      throw const AppError(
        AppErrorKind.validation,
        code: ScheduledCallCodes.notJoinable,
      );
    }
    final live = row.callId;
    if (live != null) {
      return ScheduledJoin(
        callId: live,
        conversationId: row.conversationId,
        mode: ScheduledJoinMode.joined,
      );
    }
    final callId = await _startCall(row.conversationId);
    row.callId = callId;
    return ScheduledJoin(
      callId: callId,
      conversationId: row.conversationId,
      mode: ScheduledJoinMode.started,
    );
  }

  _Row _find(String id) {
    final row = _rows[id];
    if (row == null) {
      throw const AppError(
        AppErrorKind.notFound,
        code: ScheduledCallCodes.notFound,
      );
    }
    return row;
  }

  ScheduledCall _dto(_Row row, DateTime now) {
    final from = row.startsAt.subtract(_openBefore);
    final until = row.startsAt.add(_openAfter);
    final state = row.cancelled
        ? ScheduledCallState.cancelled
        : now.isAfter(until)
        ? ScheduledCallState.over
        : now.isBefore(from)
        ? ScheduledCallState.upcoming
        : ScheduledCallState.open;
    return ScheduledCall(
      id: row.id,
      conversationId: row.conversationId,
      kind: row.kind,
      title: row.title,
      startsAt: row.startsAt,
      joinableFrom: from,
      joinableUntil: until,
      state: state,
      canCancel: !row.cancelled && state != ScheduledCallState.over,
    );
  }
}

class _Row {
  _Row({
    required this.id,
    required this.conversationId,
    required this.kind,
    required this.title,
    required this.startsAt,
  });

  final String id;
  final String conversationId;
  final ScheduledCallKind kind;
  final String? title;
  final DateTime startsAt;
  bool cancelled = false;
  String? callId;
}
