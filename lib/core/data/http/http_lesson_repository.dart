import '../../../shared/models/lesson.dart';
import '../../../shared/models/student_profile.dart';
import '../../../shared/utils/app_clock.dart';
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
      if (kind == LessonTicketKind.changeLessonTime ? learnerId.isEmpty : (lessonId == null || startsAt == null)) {
        continue;
      }
      tickets.add(LessonTicket(
        kind: kind,
        lessonId: lessonId,
        startsAt: startsAt == null ? null : AppClock.view(startsAt),
        endsAt: endsAt == null ? null : AppClock.view(endsAt),
        learnerId: learnerId,
        learnerName: learner['name'] as String? ?? '',
        suggestedLessonNumber: (row['suggestedLessonNumber'] as num?)?.toInt(),
        suggestedLessonTotal: (row['suggestedLessonTotal'] as num?)?.toInt(),
      ));
    }
    return tickets;
  }

  @override
  Future<void> report(String lessonId, LessonReportDraft draft) async {
    await _client.post<Object?>('/lessons/$lessonId/report', data: draft.toJson());
  }

  @override
  Future<void> editReport(String lessonId, LessonReportDraft draft) async {
    await _client.post<Object?>('/lessons/$lessonId/report/edit', data: draft.toJson());
  }

  @override
  Future<LessonReportDraft?> reportFor(String lessonId) async {
    final d = (await _client.get<Map<String, Object?>>('/lessons/$lessonId')).data ?? const {};
    final r = d['report'];
    if (r is! Map || r['deletedAt'] != null) return null;
    List<String> codes(Object? v) => [for (final c in (v as List?) ?? const []) if (c is String) c];
    return LessonReportDraft(
      lessonNumber: (r['lessonNumber'] as num?)?.toInt(),
      lessonTotal: (r['lessonTotal'] as num?)?.toInt(),
      coveredTopics: codes(r['coveredTopics']),
      covered: r['covered'] as String?,
      rating: (r['rating'] as num?)?.toInt(),
      nextTasks: codes(r['nextTasks']),
      homework: r['homework'] as String?,
      note: r['note'] as String?,
    );
  }

  @override
  Future<List<GroupChild>> groupChildren(String conversationId) async {
    final d = (await _client.get<Map<String, Object?>>('/conversations/$conversationId/learners')).data ?? const {};
    final out = <GroupChild>[];
    for (final raw in (d['learners'] as List?) ?? const []) {
      if (raw is! Map || raw['id'] is! String) continue;
      final course = raw['course'] is Map ? raw['course'] as Map : null;
      final teacher = raw['teacher'] is Map ? raw['teacher'] as Map : null;
      out.add(GroupChild(
        id: raw['id'] as String,
        name: raw['name'] as String? ?? '',
        age: (raw['age'] as num?)?.toInt(),
        courseName: course?['name'] as String?,
        packageLessons: (raw['packageLessons'] as num?)?.toInt(),
        teacherId: teacher?['id'] as String?,
        teacherName: teacher?['name'] as String?,
        schedule: [
          for (final s in (raw['schedule'] as List?) ?? const [])
            if (s is Map && s['weekday'] is num && s['start'] is String)
              GroupChildSlot(
                weekday: (s['weekday'] as num).toInt(),
                start: s['start'] as String,
                durationMinutes: (s['durationMinutes'] as num?)?.toInt() ?? 0,
                nextStartsAt: AppClock.parse(s['nextStartsAt']),
              ),
        ],
      ));
    }
    return out;
  }

  /// Reads exactly the teacher's half of the profile. Whatever else a response may
  /// carry (the administration's view adds the date of birth and the family) is
  /// never read, so it cannot reach a screen.
  @override
  Future<StudentProfile> studentProfile(String learnerId) async {
    final d = (await _client.get<Map<String, Object?>>('/learners/$learnerId/profile')).data ?? const {};
    final course = d['course'] is Map ? d['course'] as Map : null;
    final teacher = d['teacher'] is Map ? d['teacher'] as Map : null;
    String? text(Object? v) => v is String && v.trim().isNotEmpty ? v : null;
    return StudentProfile(
      id: d['id'] as String? ?? learnerId,
      name: d['name'] as String? ?? '',
      avatarUrl: text(d['avatarUrl']),
      age: (d['age'] as num?)?.toInt(),
      courseName: text(course?['name']),
      teacherName: text(teacher?['name']),
      schedule: [
        for (final s in (d['schedule'] as List?) ?? const [])
          if (s is Map && s['weekday'] is num && s['start'] is String)
            StudentProfileSlot(
              weekday: (s['weekday'] as num).toInt(),
              start: s['start'] as String,
              durationMinutes: (s['durationMinutes'] as num?)?.toInt() ?? 0,
              timezone: text(s['timezone']),
              nextStartsAt: AppClock.parse(s['nextStartsAt']),
            ),
      ],
    );
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
      slots: _instants(data['slots']),
      locked: data['locked'] as String?,
    );
  }

  /// ISO instants, shown in the reader's clock; anything unreadable is dropped.
  static List<DateTime> _instants(Object? raw) => [
        for (final v in (raw as List?) ?? const []) ?AppClock.parse(v),
      ];

  static GroupChildSlot? _weeklySlot(Object? s) => s is Map && s['weekday'] is num && s['start'] is String
      ? GroupChildSlot(
          weekday: (s['weekday'] as num).toInt(),
          start: s['start'] as String,
          durationMinutes: (s['durationMinutes'] as num?)?.toInt() ?? 0,
          nextStartsAt: AppClock.parse(s['nextStartsAt']),
        )
      : null;

  @override
  Future<MoveOffer> moveSlots(String lessonId) async {
    final d = (await _client.get<Map<String, Object?>>('/lessons/$lessonId/move-slots')).data ?? const {};
    return MoveOffer(
      lessonId: d['lessonId'] as String? ?? lessonId,
      startsAt: AppClock.parse(d['startsAt']) ?? AppClock.now(),
      durationMinutes: (d['durationMinutes'] as num?)?.toInt() ?? 0,
      timezone: d['timezone'] as String?,
      slots: _instants(d['slots']),
      locked: d['locked'] as String?,
      refusal: d['refusal'] as String?,
      familyMovesLeft: (d['familyMovesLeft'] as num?)?.toInt(),
    );
  }

  /// Sends the instant exactly as the server offered it (UTC), never a re-rendered local time.
  @override
  Future<void> moveLesson(String lessonId, DateTime startsAt) async {
    await _client.post<Object?>('/lessons/$lessonId/move', data: {'startsAt': startsAt.toUtc().toIso8601String()});
  }

  @override
  Future<ChildSchedule> childSchedule(String learnerId) async {
    final d = (await _client.get<Map<String, Object?>>('/learners/$learnerId/schedule')).data ?? const {};
    final teacher = d['teacher'] is Map ? d['teacher'] as Map : null;
    return ChildSchedule(
      slots: [for (final s in (d['slots'] as List?) ?? const []) ?_weeklySlot(s)],
      teacherName: teacher?['name'] as String?,
      hasPendingRequest: d['pendingRequest'] is Map,
    );
  }

  @override
  Future<List<ScheduledLesson>> learnerLessons(String learnerId, DateTime from, DateTime to) async {
    final data = (await _client.get<Map<String, Object?>>('/lessons', query: {
      'learnerId': learnerId,
      'from': from.toUtc().toIso8601String(),
      'to': to.toUtc().toIso8601String(),
    })).data ?? const {};
    return [for (final raw in (data['lessons'] as List?) ?? const []) ?_lesson(raw)];
  }

  /// Sends the instant exactly as the server offered it (UTC), never a re-rendered local time.
  @override
  Future<void> bookMakeup(String lessonId, DateTime startsAt) async {
    await _client.post<Object?>('/lessons/$lessonId/makeup', data: {'startsAt': startsAt.toUtc().toIso8601String()});
  }

  @override
  Future<ScheduleOptions> scheduleOptions(String learnerId) async {
    final data = (await _client.get<Map<String, Object?>>('/learners/$learnerId/schedule-options')).data ?? const {};
    return ScheduleOptions(
      timezone: data['timezone'] as String?,
      durationMinutes: (data['durationMinutes'] as num?)?.toInt() ?? 0,
      locked: data['locked'] as String?,
      current: [for (final s in (data['current'] as List?) ?? const []) ?_weeklySlot(s)],
      options: [
        for (final raw in (data['options'] as List?) ?? const [])
          if (raw is Map && raw['weekday'] is num && raw['start'] is String && AppClock.parse(raw['nextStartsAt']) != null)
            WeeklyOption(
              weekday: (raw['weekday'] as num).toInt(),
              start: raw['start'] as String,
              nextStartsAt: AppClock.parse(raw['nextStartsAt'])!,
              except: _instants(raw['except']),
            ),
      ],
    );
  }

  @override
  Future<void> requestScheduleChange(String learnerId, List<WeeklyKey> slots, {String? effectiveFrom, String? note}) async {
    await _client.post<Object?>('/learners/$learnerId/schedule-change-requests', data: {
      'slots': [for (final s in slots) {'weekday': s.weekday, 'start': s.start}],
      'effectiveFrom': ?effectiveFrom,
      'note': ?note,
    });
  }

  @override
  Future<List<ScheduledLesson>> myLessons(DateTime from, DateTime to) async {
    final data = (await _client.get<Map<String, Object?>>('/lessons', query: {
      'from': from.toUtc().toIso8601String(),
      'to': to.toUtc().toIso8601String(),
    })).data ?? const {};
    return [for (final raw in (data['lessons'] as List?) ?? const []) ?_lesson(raw)];
  }

  /// One lesson DTO (`GET /lessons`), or null for a malformed row.
  static ScheduledLesson? _lesson(Object? raw) {
    if (raw is! Map) return null;
    final starts = AppClock.parse(raw['startsAt']);
    final ends = AppClock.parse(raw['endsAt']);
    final id = raw['id'];
    if (id is! String || starts == null || ends == null) return null;
    final learner = raw['learner'] is Map ? raw['learner'] as Map : const {};
    final teacher = raw['teacher'] is Map ? raw['teacher'] as Map : const {};
    return ScheduledLesson(
      id: id,
      learnerId: learner['id'] as String? ?? '',
      learnerName: learner['name'] as String? ?? '',
      teacherName: teacher['name'] as String?,
      startsAt: starts,
      endsAt: ends,
      kind: raw['kind'] as String? ?? 'regular',
      phase: raw['phase'] as String? ?? 'upcoming',
      outcome: raw['outcome'] as String?,
      movedFrom: raw['movedFrom'] as String?,
      movedTo: AppClock.parse(raw['movedTo']),
      movedBy: raw['movedBy'] as String?,
      // PD-30: staff and the family read why a lesson is suspended ("payment").
      suspendedFor: raw['suspendedFor'] is String ? raw['suspendedFor'] as String : null,
      acts: [
        for (final a in (raw['acts'] as List?) ?? const []) ?LessonTicketKind.parse(a as String?),
      ],
    );
  }

  @override
  Future<List<LessonTicket>> lessonTickets(String lessonId) async {
    final d = (await _client.get<Map<String, Object?>>('/lessons/$lessonId')).data ?? const {};
    final starts = DateTime.tryParse('${d['startsAt']}');
    final ends = DateTime.tryParse('${d['endsAt']}');
    if (starts == null) return const [];
    final learner = d['learner'] is Map ? d['learner'] as Map : const {};
    return [
      for (final a in (d['acts'] as List?) ?? const [])
        if (LessonTicketKind.parse(a as String?) case final kind?)
          LessonTicket(
            kind: kind,
            lessonId: lessonId,
            startsAt: AppClock.view(starts),
            endsAt: ends == null ? null : AppClock.view(ends),
            learnerId: learner['id'] as String? ?? '',
            learnerName: learner['name'] as String? ?? '',
            suggestedLessonNumber: kind == LessonTicketKind.report ? (d['suggestedLessonNumber'] as num?)?.toInt() : null,
            suggestedLessonTotal: kind == LessonTicketKind.report ? (d['suggestedLessonTotal'] as num?)?.toInt() : null,
          ),
    ];
  }

  @override
  Future<ChildProgress> progress(String learnerId) async {
    final d = (await _client.get<Map<String, Object?>>('/learners/$learnerId/progress')).data ?? const {};
    final month = d['thisMonth'] is Map ? d['thisMonth'] as Map : const {};
    final all = d['allTime'] is Map ? d['allTime'] as Map : const {};
    final next = d['nextLesson'] is Map ? d['nextLesson'] as Map : null;
    final last = d['lastReport'] is Map ? d['lastReport'] as Map : null;
    int n(Object? v) => v is num ? v.toInt() : 0;
    return ChildProgress(
      attended: n(month['attended']),
      apologised: n(month['apologised']),
      absent: n(month['absent']),
      attendedAllTime: n(all['attended']),
      streak: n(d['streak']),
      makeupsOwed: n(d['makeupsOwed']),
      nextLessonAt: next == null ? null : AppClock.parse('${next['startsAt']}'),
      lastCovered: last?['covered'] as String?,
      lastCoveredTopics: [for (final c in (last?['coveredTopics'] as List?) ?? const []) if (c is String) c],
      lastReportAt: last == null ? null : AppClock.parse('${last['startsAt']}'),
      certificates: [
        for (final c in (d['certificates'] as List?) ?? const [])
          if (c is Map && c['id'] is String && c['title'] is String && DateTime.tryParse('${c['achievedOn']}T00:00:00Z') != null)
            ProgressCertificate(
              id: c['id'] as String,
              title: c['title'] as String,
              achievedOn: DateTime.parse('${c['achievedOn']}T00:00:00Z'),
              grade: c['grade'] as String?,
              conversationId: c['conversationId'] as String?,
            ),
      ],
    );
  }

  @override
  Future<TeacherWorkload> myWorkload() async {
    final d = (await _client.get<Map<String, Object?>>('/stats/me')).data ?? const {};
    final categories = (d['categories'] as List?) ?? const [];
    Map<Object?, Object?> cat(String key) =>
        categories.whereType<Map<Object?, Object?>>().firstWhere((c) => c['key'] == key, orElse: () => const {});
    int n(Object? v) => v is num ? v.toInt() : 0;
    final reports = d['reports'] is Map ? d['reports'] as Map : const {};
    final workload = d['workload'] is Map ? d['workload'] as Map : const {};
    return TeacherWorkload(
      heldLessons: n(cat('held')['lessons']),
      heldMinutes: n(cat('held')['minutes']),
      unreported: n(cat('unreported')['lessons']),
      reportsOnTimeRate: (reports['onTimeRate'] as num?)?.toDouble(),
      availableMinutes: (workload['availableMinutes'] as num?)?.toInt(),
      movesByTeacher: (d['movesByTeacher'] as num?)?.toInt(),
    );
  }
}
