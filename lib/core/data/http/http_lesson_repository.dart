import '../../../shared/models/lesson.dart';
import '../../network/api_client.dart';
import '../repositories.dart';

/// `LessonRepository` over the PD-11 lesson endpoints.
///
/// Every method is one request. Nothing is decided here: the server answers which
/// tickets exist and refuses one it would not allow, and that refusal reaches the
/// caller with its `COMM.LESSON_*` code intact (via [ApiClient]).
class HttpLessonRepository implements LessonRepository {
  HttpLessonRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<List<LessonTicket>> tickets(String conversationId) async {
    final response = await _client.get<Map<String, Object?>>(
      '/conversations/$conversationId/lesson-tickets',
    );
    final tickets = <LessonTicket>[];
    for (final row in (response.data?['tickets'] as List?) ?? const []) {
      if (row is! Map) continue;
      final kind = LessonTicketKind.parse(row['ticket'] as String?);
      final lessonId = row['lessonId'];
      final startsAt = DateTime.tryParse('${row['startsAt']}');
      final endsAt = DateTime.tryParse('${row['endsAt']}');
      // A ticket this build does not know, or a malformed row, is not offered.
      if (kind == null || lessonId is! String || startsAt == null || endsAt == null) continue;
      tickets.add(LessonTicket(
        kind: kind,
        lessonId: lessonId,
        startsAt: startsAt.toLocal(),
        endsAt: endsAt.toLocal(),
        learnerName: (row['learner'] is Map ? (row['learner'] as Map)['name'] as String? : null) ?? '',
      ));
    }
    return tickets;
  }

  @override
  Future<void> report(String lessonId, LessonReportDraft draft) async {
    await _client.post<Object?>('/lessons/$lessonId/report', data: {
      'covered': draft.covered,
      if (draft.homework != null) 'homework': draft.homework,
      if (draft.rating != null) 'rating': draft.rating,
      if (draft.note != null) 'note': draft.note,
    });
  }

  @override
  Future<void> absence(String lessonId, {String? note}) async {
    await _client.post<Object?>('/lessons/$lessonId/absence', data: {
      'note': ?note,
    });
  }

  @override
  Future<void> apologise(String lessonId, LessonTicketKind kind, String reason) async {
    final path = switch (kind) {
      LessonTicketKind.apology => 'apology',
      LessonTicketKind.teacherApology => 'teacher-apology',
      LessonTicketKind.lateApology => 'late-apology',
      LessonTicketKind.report || LessonTicketKind.absence =>
        throw ArgumentError.value(kind, 'kind', 'not an apology'),
    };
    await _client.post<Object?>('/lessons/$lessonId/$path', data: {'reason': reason});
  }
}
