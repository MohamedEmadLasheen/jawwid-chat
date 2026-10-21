import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_lesson_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';

import 'test_server.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-17: the Student Profile, read off a REAL HTTP response.
///
/// The administration's answer from the same endpoint carries more than a teacher's
/// (the date of birth, the family); the server leaves those out for a teacher, and
/// this proves the client would not pick them up even if they arrived -- the type has
/// no field for them, and the parser reads only the teacher's half.
///
/// No widget binding here: `TestWidgetsFlutterBinding` answers real requests with 400.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpLessonRepository repository() => HttpLessonRepository(
        client: buildApiClient(
          config: ApiConfig(baseUrl: server.baseUrl),
          tokens: _NoTokens(),
        ),
      );

  test('GET /learners/:id/profile maps the teacher\'s half and ignores the rest', () async {
    server.on('GET', '/learners/k1/profile', [
      const Reply.ok({
        'id': 'k1',
        'name': 'سارة',
        'avatarUrl': 'https://media.example/avatars/k1.jpg',
        'age': 9,
        'course': {'id': 'co1', 'name': 'Tajweed'},
        'teacher': {'id': 't1', 'name': 'خديجة'},
        'schedule': [
          {'weekday': 1, 'start': '16:30', 'durationMinutes': 30, 'timezone': 'Africa/Cairo'},
          {'weekday': 4, 'start': '17:00', 'durationMinutes': 45, 'timezone': 'Africa/Cairo'},
          {'weekday': 'Tuesday', 'start': '17:00'}, // malformed: dropped
        ],
        'viewer': 'teacher',
        // Staff-only fields, as if the server had sent them anyway.
        'birthDate': '2017-03-04',
        'family': {
          'id': 'f1',
          'name': 'حسن',
          'parents': [
            {'id': 'p1', 'name': 'حسن'},
          ],
        },
      }),
    ]);

    final profile = await repository().studentProfile('k1');

    expect(server.countOf('GET', '/learners/k1/profile'), 1);
    expect(profile.id, 'k1');
    expect(profile.name, 'سارة');
    expect(profile.avatarUrl, 'https://media.example/avatars/k1.jpg');
    expect(profile.age, 9);
    expect(profile.courseName, 'Tajweed');
    expect(profile.teacherName, 'خديجة');
    expect(profile.schedule.map((s) => (s.weekday, s.start, s.durationMinutes, s.timezone)), [
      (1, '16:30', 30, 'Africa/Cairo'),
      (4, '17:00', 45, 'Africa/Cairo'),
    ]);
  });

  test('nulls stay null: no age, no course, no teacher, no times', () async {
    server.on('GET', '/learners/k2/profile', [
      const Reply.ok({
        'id': 'k2',
        'name': 'حسن',
        'avatarUrl': null,
        'age': null,
        'course': null,
        'teacher': null,
        'schedule': <Object?>[],
        'viewer': 'teacher',
      }),
    ]);

    final profile = await repository().studentProfile('k2');

    expect(profile.avatarUrl, isNull);
    expect(profile.age, isNull);
    expect(profile.courseName, isNull);
    expect(profile.teacherName, isNull);
    expect(profile.schedule, isEmpty);
  });

  test("another teacher's student is a 404 that reaches the caller with its code", () async {
    server.on('GET', '/learners/k9/profile', [Reply.commError(404, 'COMM.LESSON_NOT_FOUND')]);

    await expectLater(
      repository().studentProfile('k9'),
      throwsA(isA<AppError>()
          .having((e) => e.kind, 'kind', AppErrorKind.notFound)
          .having((e) => e.code, 'code', 'COMM.LESSON_NOT_FOUND')),
    );
    expect(server.countOf('GET', '/learners/k9/profile'), 1);
  });

  test("a group's child carries its teacher's id -- what decides whether its card opens", () async {
    server.on('GET', '/conversations/c1/learners', [
      const Reply.ok({
        'learners': [
          {'id': 'k1', 'name': 'سارة', 'teacher': {'id': 't1', 'name': 'خديجة'}, 'schedule': <Object?>[]},
          {'id': 'k2', 'name': 'حسن', 'teacher': null, 'schedule': <Object?>[]},
        ],
      }),
    ]);

    final children = await repository().groupChildren('c1');

    expect(children.map((c) => (c.id, c.teacherId, c.teacherName)), [
      ('k1', 't1', 'خديجة'),
      ('k2', null, null),
    ]);
  });
}
