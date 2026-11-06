import '../../../features/moderation/data/moderation_repository.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../wire/wire_mappers.dart';

/// `ModerationRepository` over `POST /reports` and `GET /me/reports` (PD-57, §5.4).
///
/// Parsed by hand, reading only what the reporter's screens show. A row without an id, a
/// target kind or a time is dropped rather than shown with an invented value. A refusal
/// reaches the caller with its code intact (via [ApiClient]).
class HttpModerationRepository implements ModerationRepository {
  HttpModerationRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  bool get isAvailable => true;

  @override
  Future<ReportReceipt> submit(ReportDraft draft) async {
    final response = await _client.post<Map<String, Object?>>('/reports', data: draft.toJson());
    final d = response.data;
    final id = d?['id'];
    if (id is! String) {
      throw const AppError(AppErrorKind.unknown, debugDetail: 'reports: malformed response');
    }
    return ReportReceipt(
      id: id,
      status: (d?['status'] as String?) ?? 'open',
      dueAt: WireMappers.parseTime(d?['dueAt']),
      // 201 is a new report; 200 is the same report already open.
      alreadyOpen: response.statusCode == 200,
    );
  }

  @override
  Future<List<MyReport>> mine() async {
    final data = (await _client.get<List<Object?>>('/me/reports')).data ?? const [];
    final reports = <MyReport>[];
    for (final row in data) {
      if (row is! Map) continue;
      final id = row['id'];
      final targetKind = row['targetKind'];
      final createdAt = WireMappers.parseTime(row['createdAt']);
      if (id is! String || targetKind is! String || createdAt == null) continue;
      final answer = row['answer'];
      final text = answer is Map ? answer['text'] : null;
      reports.add(
        MyReport(
          id: id,
          targetKind: targetKind,
          reason: ReportReason.fromWire(row['reason']),
          status: ReportStatus.fromWire(row['status']),
          createdAt: createdAt,
          answer: text is String && text.trim().isNotEmpty
              ? ReportAnswer(text: text, at: WireMappers.parseTime((answer as Map)['at']))
              : null,
        ),
      );
    }
    reports.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return reports;
  }
}
