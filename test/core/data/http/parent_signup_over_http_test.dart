import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_parent_signup_repository.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';

import 'test_server.dart';

/// PD-16 / PD-48 on the wire: `POST /auth/signup/verify` carries the lesson-audio notice
/// version only when the parent ticked it. Without one (Phase 2: the notice is not shown)
/// the field is absent, so the server records no acknowledgement of a text never shown.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpParentSignupRepository repo() =>
      HttpParentSignupRepository(transport: buildAuthTransport(config: ApiConfig(baseUrl: server.baseUrl)));

  test('no notice: e-mail, code and password only', () async {
    server.on('POST', '/auth/signup/verify', [const Reply.ok({'ok': true})]);
    await repo().verify(email: ' parent@example.test ', code: ' 482913 ', password: 'long-password-1');
    expect(server.requests.single.json, {'email': 'parent@example.test', 'code': '482913', 'password': 'long-password-1'});
  });

  test('a ticked notice: its version is sent', () async {
    server.on('POST', '/auth/signup/verify', [const Reply.ok({'ok': true})]);
    await repo().verify(email: 'parent@example.test', code: '482913', password: 'long-password-1', lessonAudioNotice: 1);
    expect(server.requests.single.json['lessonAudioNotice'], 1);
  });
}
