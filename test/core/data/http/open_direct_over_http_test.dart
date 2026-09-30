import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_conversation_repository.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'test_server.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;
  @override
  Future<String?> refresh() async => null;
  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// `POST /conversations/direct` — the first conversation-CREATION call this
/// client has ever made.
///
/// Every other repository method reads or updates something that already exists.
/// This one brings a conversation into being, and the three things that makes
/// easy to get wrong are all asserted here: that the client does not look before
/// it creates (the server's unique `direct_key` is what makes a repeat safe),
/// that a policy refusal stays a refusal rather than becoming a retry, and that
/// a failure is never reported as a conversation.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpConversationRepository repository({UserRole role = UserRole.teacher}) =>
      HttpConversationRepository(
        client: buildApiClient(
          config: ApiConfig(baseUrl: server.baseUrl),
          tokens: _NoTokens(),
        ),
        viewerRole: () => role,
      );

  Map<String, Object?> conversationDto({String id = 'c-direct'}) => {
        'id': id,
        'type': 'direct',
        'title': 'Jawwid Academy',
        'state': 'open',
        'lastSeq': '0',
        'lastActivityAt': DateTime.utc(2026, 9, 30).toIso8601String(),
        'teacherRequiresApproval': false,
        'parentRequiresApproval': false,
        'unreadCount': 0,
      };

  test('sends the counterpart id and returns the conversation', () async {
    server.on('POST', '/conversations/direct', [
      Reply.ok(conversationDto()),
    ]);

    final conversation = await repository().openDirect('staff-1');

    expect(conversation.id, 'c-direct');

    final request = server.lastRequestTo('POST', '/conversations/direct')!;
    expect(request.json, {'withActorId': 'staff-1'});
  });

  test('does not look before it creates, so there is no race to lose', () async {
    // The server's `direct_key` is unique: the same pair always resolves to the
    // same conversation. A client that asked "does it exist?" first would be
    // deciding on a stale answer, and two taps would race. One call, always.
    server.on('POST', '/conversations/direct', [
      Reply.ok(conversationDto()),
    ]);

    await repository().openDirect('staff-1');

    expect(server.countOf('POST', '/conversations/direct'), 1);
    expect(server.countOf('GET', '/conversations'), 0);
  });

  test('a repeat returns the same conversation, not a second one', () async {
    server.on('POST', '/conversations/direct', [
      Reply.ok(conversationDto()),
      Reply.ok(conversationDto()),
    ]);

    final first = await repository().openDirect('staff-1');
    final second = await repository().openDirect('staff-1');

    expect(second.id, first.id);
    expect(server.countOf('POST', '/conversations/direct'), 2);
  });

  test('a BR-1 refusal is terminal and keeps its code', () async {
    // Decided by policy, identical on every attempt. Retrying it is exactly what
    // the retry contract forbids, so it must not classify as a transient error.
    server.on('POST', '/conversations/direct', [
      Reply.commError(403, 'COMM.BR1_TEACHER_PARENT_DIRECT'),
    ]);

    await expectLater(
      repository().openDirect('contact-1'),
      throwsA(
        isA<AppError>()
            .having((e) => e.kind, 'kind', AppErrorKind.forbidden)
            .having((e) => e.code, 'code', 'COMM.BR1_TEACHER_PARENT_DIRECT'),
      ),
    );

    // One attempt. A forbidden pairing is not retried.
    expect(server.countOf('POST', '/conversations/direct'), 1);
  });

  test('an unknown actor is a not-found, not a blank conversation', () async {
    server.on('POST', '/conversations/direct', [
      Reply.commError(404, 'COMM.UNKNOWN_ACTOR'),
    ]);

    await expectLater(
      repository().openDirect('nobody'),
      throwsA(isA<AppError>().having((e) => e.kind, 'kind', AppErrorKind.notFound)),
    );
  });

  test('a network failure surfaces as network, never as success', () async {
    // The client is built while the socket is still bound, then the server goes
    // away — which is the shape of the real failure: a request that leaves and
    // finds nothing, not a client that was never configured.
    final unreachable = repository();
    await server.stop();

    await expectLater(
      unreachable.openDirect('staff-1'),
      throwsA(
        isA<AppError>().having(
          (e) => e.kind,
          'kind',
          anyOf(AppErrorKind.network, AppErrorKind.timeout),
        ),
      ),
    );

    server = await TestServer.start();
  });

  test('a response with no id is a server error, not a conversation', () async {
    // The one failure mode that could silently navigate the user into a chat
    // screen for a conversation that does not exist.
    server.on('POST', '/conversations/direct', [
      const Reply.ok({'type': 'direct'}),
    ]);

    await expectLater(
      repository().openDirect('staff-1'),
      throwsA(
        isA<AppError>()
            .having((e) => e.kind, 'kind', AppErrorKind.server)
            .having((e) => e.code, 'code', 'malformed_conversation_response'),
      ),
    );
  });

  test('the socket is a real one', () {
    // Guards the premise of this file: these assertions are about a payload
    // crossing a socket, not about a fixture handing back an object.
    expect(server.baseUrl, startsWith('http://127.0.0.1:'));
    expect(InternetAddress.tryParse('127.0.0.1'), isNotNull);
  });
}
