import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_lesson_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/shared/models/lesson.dart';

import 'test_server.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-31 on the wire, against the API contract: moving one lesson, the weekly options
/// with their current times and `except`, the full-set change request, a child's
/// schedule and lessons, the new ticket, and the teacher's "moved" count.
///
/// No widget binding here: `TestWidgetsFlutterBinding` answers real requests with 400.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpLessonRepository repository() => HttpLessonRepository(
        client: buildApiClient(config: ApiConfig(baseUrl: server.baseUrl), tokens: _NoTokens()),
      );

  test('GET /lessons/:id/move-slots: slots, refusal, locked and the family\'s moves left', () async {
    server.on('GET', '/lessons/l1/move-slots', [
      const Reply.ok({
        'lessonId': 'l1',
        'startsAt': '2026-10-27T14:00:00.000Z',
        'durationMinutes': 30,
        'timezone': 'Africa/Cairo',
        'slots': ['2026-10-29T15:30:00.000Z', 'not a time'],
        'locked': null,
        'refusal': null,
        'familyMovesLeft': 3,
      }),
      const Reply.ok({
        'lessonId': 'l1', 'startsAt': '2026-10-27T14:00:00.000Z', 'durationMinutes': 30,
        'slots': <Object?>[], 'locked': 'overdue', 'refusal': 'family_monthly_limit', 'familyMovesLeft': null,
      }),
    ]);
    final open = await repository().moveSlots('l1');
    expect(open.slots.map((s) => s.toUtc()), [DateTime.utc(2026, 10, 29, 15, 30)]);
    expect(open.startsAt.toUtc(), DateTime.utc(2026, 10, 27, 14));
    expect((open.durationMinutes, open.timezone, open.refusal, open.familyMovesLeft, open.isLocked), (30, 'Africa/Cairo', null, 3, false));

    final refused = await repository().moveSlots('l1');
    expect(refused.slots, isEmpty);
    expect((refused.refusal, refused.familyMovesLeft, refused.locked), ('family_monthly_limit', null, 'overdue'));
  });

  test('POST /lessons/:id/move sends the instant as offered, in UTC', () async {
    server.on('POST', '/lessons/l1/move', [const Reply.ok({'id': 'l2'})]);
    await repository().moveLesson('l1', DateTime.utc(2026, 10, 29, 15, 30).toLocal());
    expect(server.lastRequestTo('POST', '/lessons/l1/move')!.json, {'startsAt': '2026-10-29T15:30:00.000Z'});
  });

  test('GET /learners/:id/schedule-options: current times, options and except', () async {
    server.on('GET', '/learners/k1/schedule-options', [
      const Reply.ok({
        'timezone': 'Africa/Cairo',
        'durationMinutes': 30,
        'locked': null,
        'current': [
          {'weekday': 1, 'start': '17:00', 'durationMinutes': 30, 'nextStartsAt': '2026-11-02T15:00:00.000Z'},
        ],
        'options': [
          {'weekday': 2, 'start': '18:00', 'nextStartsAt': '2026-10-27T16:00:00.000Z', 'except': ['2026-11-10T16:00:00.000Z']},
          {'weekday': 1, 'start': '17:00', 'nextStartsAt': '2026-11-02T15:00:00.000Z', 'except': <Object?>[]},
          {'weekday': 3, 'start': '18:00'}, // no nextStartsAt: dropped
        ],
      }),
    ]);
    final o = await repository().scheduleOptions('k1');
    expect((o.timezone, o.durationMinutes, o.isLocked), ('Africa/Cairo', 30, false));
    expect(o.current.map((c) => (c.key, c.durationMinutes, c.nextStartsAt?.toUtc())), [
      ((weekday: 1, start: '17:00'), 30, DateTime.utc(2026, 11, 2, 15)),
    ]);
    expect(o.options.map((x) => x.key), [(weekday: 2, start: '18:00'), (weekday: 1, start: '17:00')]);
    expect(o.options.first.except.map((e) => e.toUtc()), [DateTime.utc(2026, 11, 10, 16)]);
  });

  test('POST /learners/:id/schedule-change-requests sends the full set and effectiveFrom', () async {
    server.on('POST', '/learners/k1/schedule-change-requests', [const Reply.ok({'id': 'r1', 'status': 'pending'})]);
    await repository().requestScheduleChange(
      'k1',
      [(weekday: 2, start: '18:00'), (weekday: 4, start: '17:00')],
      effectiveFrom: '2026-11-02',
    );
    expect(server.lastRequestTo('POST', '/learners/k1/schedule-change-requests')!.json, {
      'slots': [
        {'weekday': 2, 'start': '18:00'},
        {'weekday': 4, 'start': '17:00'},
      ],
      'effectiveFrom': '2026-11-02',
    });
  });

  test('GET /learners/:id/schedule and GET /lessons?learnerId= for the child\'s schedule', () async {
    server.on('GET', '/learners/k1/schedule', [
      const Reply.ok({
        'learnerId': 'k1',
        'timezone': 'Africa/Cairo',
        'teacher': {'id': 't1', 'name': 'teacher_t'},
        'slots': [
          {'id': 's1', 'weekday': 1, 'start': '17:00', 'durationMinutes': 30, 'validFrom': '2026-09-01', 'nextStartsAt': '2026-11-02T15:00:00.000Z'},
        ],
        'pendingRequest': {'id': 'r1', 'slots': <Object?>[], 'effectiveFrom': '2026-11-02', 'requestedBy': 'family'},
      }),
    ]);
    server.on('GET', '/lessons', [
      const Reply.ok({
        'lessons': [
          {
            'id': 'old', 'learner': {'id': 'k1', 'name': 'learner_k'}, 'teacher': {'id': 't1', 'name': 'teacher_t'},
            'kind': 'regular', 'startsAt': '2026-10-27T14:00:00.000Z', 'endsAt': '2026-10-27T14:30:00.000Z',
            'phase': 'closed', 'outcome': 'rescheduled', 'movedFrom': null, 'movedTo': '2026-10-29T15:30:00.000Z', 'movedBy': null,
          },
          {
            'id': 'new', 'learner': {'id': 'k1', 'name': 'learner_k'}, 'teacher': {'id': 't1', 'name': 'teacher_t'},
            'kind': 'regular', 'startsAt': '2026-10-29T15:30:00.000Z', 'endsAt': '2026-10-29T16:00:00.000Z',
            'phase': 'upcoming', 'outcome': null, 'movedFrom': 'old', 'movedTo': null, 'movedBy': 'family',
          },
        ],
      }),
    ]);
    final repo = repository();
    final s = await repo.childSchedule('k1');
    expect((s.teacherName, s.hasPendingRequest), ('teacher_t', true));
    expect(s.slots.single.nextStartsAt?.toUtc(), DateTime.utc(2026, 11, 2, 15));

    final from = DateTime.utc(2026, 10, 26);
    final lessons = await repo.learnerLessons('k1', from, from.add(const Duration(days: 28)));
    expect(server.lastRequestTo('GET', '/lessons')!.query, {
      'learnerId': 'k1',
      'from': '2026-10-26T00:00:00.000Z',
      'to': '2026-11-23T00:00:00.000Z',
    });
    expect(lessons.first.movedTo?.toUtc(), DateTime.utc(2026, 10, 29, 15, 30));
    expect((lessons.last.teacherName, lessons.last.movedFrom, lessons.last.movedBy, lessons.last.durationMinutes), ('teacher_t', 'old', 'family', 30));
  });

  test('tickets: "change_lesson_time" is offered per child; the legacy request is not', () async {
    server.on('GET', '/conversations/c1/lesson-tickets', [
      const Reply.ok({
        'tickets': [
          {'ticket': 'change_lesson_time', 'lessonId': null, 'learner': {'id': 'k1', 'name': 'learner_k'}},
          {'ticket': 'request_schedule_change', 'lessonId': null, 'learner': {'id': 'k1', 'name': 'learner_k'}},
          {'ticket': 'change_lesson_time', 'lessonId': null, 'learner': {'id': '', 'name': ''}}, // no child: dropped
        ],
      }),
    ]);
    final tickets = await repository().tickets('c1');
    expect(tickets.map((t) => (t.kind, t.learnerId, t.lessonId)), [(LessonTicketKind.changeLessonTime, 'k1', null)]);
  });

  test('GET /stats/me reads movesByTeacher', () async {
    server.on('GET', '/stats/me', [
      const Reply.ok({'categories': <Object?>[], 'movesByTeacher': 4}),
    ]);
    expect((await repository().myWorkload()).movesByTeacher, 4);
  });
}
