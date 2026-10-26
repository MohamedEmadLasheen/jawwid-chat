import '../../../shared/models/teacher_feedback.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_mappers.dart';

/// `FeedbackRepository` over `/me/feedback` (PD-32).
///
/// Parsed by hand, reading only what the parent's screens show. A row without an id, a
/// child, a known category or a time is dropped rather than shown with an invented value;
/// a refusal reaches the caller with its code intact (via [ApiClient]):
/// `COMM.FEEDBACK_DENIED`, `COMM.FEEDBACK_NOT_FOUND`, `COMM.FEEDBACK_LIMIT`.
class HttpFeedbackRepository implements FeedbackRepository {
  HttpFeedbackRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  bool get isAvailable => true;

  @override
  Future<MyFeedback> mine() async {
    final d = (await _client.get<Map<String, Object?>>('/me/feedback')).data ?? const {};
    return MyFeedback(
      children: [
        for (final row in (d['children'] as List?) ?? const [])
          if (row is Map && row['learnerId'] is String)
            FeedbackChild(
              learnerId: row['learnerId'] as String,
              name: (row['name'] as String?) ?? '',
              teacherName: _nonEmpty(row['teacherName']),
            ),
      ],
      items: [
        for (final row in (d['feedback'] as List?) ?? const [])
          if (row is Map<String, Object?>) ?parseFeedbackItem(row),
      ],
    );
  }

  @override
  Future<FeedbackItem> submit({
    required String learnerId,
    required FeedbackCategory category,
    required String body,
  }) async {
    final d = (await _client.post<Map<String, Object?>>(
      '/me/feedback',
      data: {'learnerId': learnerId, 'category': category.wire, 'body': body.trim()},
    )).data;
    final item = d == null ? null : parseFeedbackItem(d);
    if (item == null) {
      throw const AppError(AppErrorKind.unknown, debugDetail: 'feedback: malformed 201');
    }
    return item;
  }
}

/// One `Item` of the contract; null when it is missing what the screen needs.
FeedbackItem? parseFeedbackItem(Map<String, Object?> row) {
  final id = row['id'];
  final learnerId = row['learnerId'];
  final category = FeedbackCategory.fromWire(row['category']);
  final createdAt = WireMappers.parseTime(row['createdAt']);
  if (id is! String || learnerId is! String || category == null || createdAt == null) return null;
  return FeedbackItem(
    id: id,
    learnerId: learnerId,
    childName: (row['childName'] as String?) ?? '',
    teacherName: _nonEmpty(row['teacherName']),
    category: category,
    body: (row['body'] as String?) ?? '',
    status: FeedbackStatus.fromWire(row['status']),
    response: _nonEmpty(row['response']),
    respondedAt: WireMappers.parseTime(row['respondedAt']),
    createdAt: createdAt,
  );
}

String? _nonEmpty(Object? value) => value is String && value.trim().isNotEmpty ? value : null;
