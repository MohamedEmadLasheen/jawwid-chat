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
      final lessonId = row['lessonId'] as String?;
      final startsAt = row['startsAt'] is String ? DateTime.tryParse(row['startsAt'] as String) : null;
      final endsAt = row['endsAt'] is String ? DateTime.tryParse(row['endsAt'] as String) : null;
      final learner = row['learner'] is Map ? row['learner'] as Map : const {};
      final learnerId = learner['id'] as String? ?? '';
      // A ticket this build does not know, or a malformed row, is not offered: a
      // lesson ticket needs its lesson, a child ticket its child.
      if (kind == null) continue;
      if (kind == LessonTicketKind.requestScheduleChange ? learnerId.isEmpty : (lessonId == null || startsAt == null)) {
        continue;
      }
      tickets.add(LessonTicket(
        kind: kind,
        lessonId: lessonId,
        startsAt: startsAt?.toLocal(),
        endsAt: endsAt?.toLocal(),
        learnerId: learnerId,
        learnerName: learner['name'] as String? ?? '',
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
      _ => throw ArgumentError.value(kind, 'kind', 'not an apology'),
    };
    await _client.post<Object?>('/lessons/$lessonId/$path', data: {'reason': reason});
  }

  @override
  Future<MakeupOffer> makeupSlots(String lessonId) async {
    final data = (await _client.get<Map<String, Object?>>('/lessons/$lessonId/makeup-slots')).data ?? const {};
    return MakeupOffer(
      durationMinutes: (data['durationMinutes'] as num?)?.toInt() ?? 0,
      slots: [
        for (final raw in (data['slots'] as List?) ?? const [])
          if (raw is String && DateTime.tryParse(raw) != null) DateTime.parse(raw).toLocal(),
      ],
    );
  }

  /// Sends the instant exactly as the server offered it (UTC), never a re-rendered local time.
  @override
  Future<void> bookMakeup(String lessonId, DateTime startsAt) async {
    await _client.post<Object?>('/lessons/$lessonId/makeup', data: {'startsAt': startsAt.toUtc().toIso8601String()});
  }

  @override
  Future<List<WeeklyOption>> scheduleOptions(String learnerId) async {
    final data = (await _client.get<Map<String, Object?>>('/learners/$learnerId/schedule-options')).data ?? const {};
    return [
      for (final raw in (data['options'] as List?) ?? const [])
        if (raw is Map && raw['weekday'] is num && raw['start'] is String && DateTime.tryParse('${raw['nextStartsAt']}') != null)
          WeeklyOption(
            weekday: (raw['weekday'] as num).toInt(),
            start: raw['start'] as String,
            nextStartsAt: DateTime.parse(raw['nextStartsAt'] as String).toLocal(),
          ),
    ];
  }

  @override
  Future<void> requestScheduleChange(String learnerId, List<WeeklyOption> slots, {String? note}) async {
    await _client.post<Object?>('/learners/$learnerId/schedule-change-requests', data: {
      'slots': [for (final s in slots) {'weekday': s.weekday, 'start': s.start}],
      'note': ?note,
    });
  }

  @override
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to) async {
    final data = (await _client.get<Map<String, Object?>>('/lessons', query: {
      'from': from.toUtc().toIso8601String(),
      'to': to.toUtc().toIso8601String(),
    })).data ?? const {};
    final out = <ScheduledLesson>[];
    for (final raw in (data['lessons'] as List?) ?? const []) {
      if (raw is! Map) continue;
      final starts = DateTime.tryParse('${raw['startsAt']}');
      final ends = DateTime.tryParse('${raw['endsAt']}');
      final id = raw['id'];
      if (id is! String || starts == null || ends == null) continue;
      out.add(ScheduledLesson(
        id: id,
        learnerName: (raw['learner'] is Map ? (raw['learner'] as Map)['name'] as String? : null) ?? '',
        startsAt: starts.toLocal(),
        endsAt: ends.toLocal(),
        kind: raw['kind'] as String? ?? 'regular',
        phase: raw['phase'] as String? ?? 'upcoming',
        outcome: raw['outcome'] as String?,
      ));
    }
    return out;
  }
}
