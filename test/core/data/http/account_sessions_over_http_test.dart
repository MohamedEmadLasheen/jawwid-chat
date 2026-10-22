import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/features/sessions/data/account_sessions_repository.dart';
import 'package:jawwid_chat/features/sessions/domain/account_session.dart';

import 'test_server.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// PD-23: the session registry over a REAL HTTP response.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpAccountSessionsRepository repository() => HttpAccountSessionsRepository(
        client: buildApiClient(
          config: ApiConfig(baseUrl: server.baseUrl),
          tokens: _NoTokens(),
        ),
      );

  Map<String, Object?> dto(
    String id, {
    bool current = false,
    String? platform = 'ios',
    String? deviceName,
    String? lastSeenAt = '2026-10-22T08:00:00.000Z',
  }) =>
      {
        'id': id,
        'current': current,
        'platform': platform,
        'deviceName': deviceName,
        'appVersion': '1.0.0',
        'signedInAt': '2026-10-01T08:00:00.000Z',
        'lastSeenAt': lastSeenAt,
        'expiresAt': '2026-11-01T08:00:00.000Z',
        'remembered': true,
      };

  test('GET /me/sessions maps SessionDto, current first then most recent', () async {
    server.on('GET', '/me/sessions', [
      Reply.ok({
        'sessions': [
          dto('old', platform: 'web', lastSeenAt: '2026-10-10T08:00:00.000Z'),
          dto('recent', platform: 'android', lastSeenAt: '2026-10-21T08:00:00.000Z'),
          dto('me', current: true, deviceName: 'iPhone 17 Pro', lastSeenAt: null),
          {'id': 'broken'}, // no instants: dropped, never shown with invented values
          dto('future', platform: 'watch'),
        ],
      }),
    ]);

    final sessions = await repository().list();

    expect(sessions.map((s) => s.id), ['me', 'future', 'recent', 'old']);
    final me = sessions.first;
    expect(me.current, isTrue);
    expect(me.deviceName, 'iPhone 17 Pro');
    expect(me.platform, SessionPlatform.ios);
    expect(me.lastSeenAt, isNull);
    expect(me.remembered, isTrue);
    expect(me.signedInAt, DateTime.utc(2026, 10, 1, 8).toLocal());
    expect(sessions[1].platform, isNull, reason: 'an unknown platform is not guessed');
    expect(server.requests.single.method, 'GET');
  });

  test('POST /me/sessions/{id}/revoke', () async {
    server.on('POST', '/me/sessions/abc-123/revoke', [const Reply.ok({'ok': true})]);

    await repository().revoke('abc-123');

    expect(server.requests.single.method, 'POST');
    expect(server.requests.single.path, '/me/sessions/abc-123/revoke');
  });

  test('an unknown id is a 404 the caller can recognise', () async {
    server.on('POST', '/me/sessions/nope/revoke', [
      Reply.commError(404, 'COMM.SESSION_NOT_FOUND'),
    ]);

    await expectLater(
      repository().revoke('nope'),
      throwsA(isA<AppError>()
          .having((e) => e.kind, 'kind', AppErrorKind.notFound)
          .having((e) => e.code, 'code', 'COMM.SESSION_NOT_FOUND')),
    );
  });

  test('POST /me/sessions/revoke-others returns the count', () async {
    server.on('POST', '/me/sessions/revoke-others', [const Reply.ok({'revoked': 3})]);

    expect(await repository().revokeOthers(), 3);
    expect(server.requests.single.path, '/me/sessions/revoke-others');
  });
}
