import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_message_repository.dart';
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

/// Message author identity, read off a REAL HTTP response (gap O3, author half).
///
/// `MessageDto` carried `authorId` and no name, so the bubble fell back to the
/// sender's ROLE and every parent in a group read as "Parent". The client model
/// already had `authorName`; nothing could fill it.
///
/// The load-bearing assertions here are the negative ones. The name must come from
/// the payload and from nowhere else: not from `authorKind`, not from a second
/// request, not from anything this client works out for itself.
void main() {
  late TestServer server;

  setUp(() async => server = await TestServer.start());
  tearDown(() async => server.stop());

  HttpMessageRepository repository({String viewer = 'me'}) => HttpMessageRepository(
        client: buildApiClient(
          config: ApiConfig(baseUrl: server.baseUrl),
          tokens: _NoTokens(),
        ),
        viewerActorId: () => viewer,
      );

  Map<String, Object?> messageDto({
    required String id,
    required String authorKind,
    String? authorId,
    Object? authorDisplayName,
    String body = 'hello',
  }) =>
      {
        'id': id,
        'conversationId': 'c1',
        'seq': '1',
        'authorKind': authorKind,
        'authorId': authorId,
        'authorDisplayName': authorDisplayName,
        'type': 'text',
        'body': body,
        'visibility': 'customer',
        'moderation': 'published',
        'origin': 'user',
        'deletedForAll': false,
        'createdAt': DateTime.utc(2026, 9, 30).toIso8601String(),
        'attachments': <Object?>[],
        'reactions': <Object?>[],
        'receipts': <Object?>[],
      };

  void stubHistory(List<Map<String, Object?>> messages) {
    server.on('GET', '/conversations/c1/messages', [
      Reply.ok({'messages': messages, 'nextBefore': null}),
    ]);
  }

  test('renders the display name the server stated', () async {
    stubHistory([
      messageDto(
        id: 'm1',
        authorKind: 'contact',
        authorId: 'p1',
        authorDisplayName: 'Umm Yusuf',
      ),
    ]);

    final page = await repository().history('c1');

    expect(page.items.single.authorName, 'Umm Yusuf');
  });

  test('two authors of the SAME kind are told apart by name', () async {
    // The role fallback made these two indistinguishable — both "Parent". This is
    // the bug the author half of O3 existed to fix, stated as a test.
    stubHistory([
      messageDto(id: 'm1', authorKind: 'contact', authorId: 'p1', authorDisplayName: 'Umm Yusuf'),
      messageDto(id: 'm2', authorKind: 'contact', authorId: 'p2', authorDisplayName: 'Abu Yusuf'),
    ]);

    final page = await repository().history('c1');

    expect(page.items.map((m) => m.authorName), ['Umm Yusuf', 'Abu Yusuf']);
  });

  test('the name is never derived from the actor kind', () async {
    // Same kind, no name. The mapper must leave it empty rather than filling in
    // anything role-shaped; the ROLE LABEL is a presentation fallback chosen by
    // the bubble, and it is not identity.
    stubHistory([
      messageDto(id: 'm1', authorKind: 'teacher', authorId: 't1', authorDisplayName: null),
    ]);

    final page = await repository().history('c1');
    final message = page.items.single;

    expect(message.authorName, '');
    expect(message.authorName, isNot('teacher'));
    expect(message.authorName, isNot('Teacher'));
    // The role is still carried separately, for the bubble to fall back on.
    expect(message.authorRole, ParticipantRole.teacher);
  });

  test('a system message has no name and no author', () async {
    stubHistory([
      messageDto(id: 'm1', authorKind: 'system', authorId: null, authorDisplayName: null),
    ]);

    final message = (await repository().history('c1')).items.single;

    expect(message.authorId, isNull);
    expect(message.authorName, '');
    expect(message.authorRole, ParticipantRole.system);
  });

  test('a blank or whitespace name is treated as absent', () async {
    stubHistory([
      messageDto(id: 'm1', authorKind: 'contact', authorId: 'p1', authorDisplayName: '   '),
    ]);

    expect((await repository().history('c1')).items.single.authorName, '');
  });

  test('the name is never an id', () async {
    stubHistory([
      messageDto(id: 'm1', authorKind: 'staff', authorId: 'a-uuid', authorDisplayName: null),
    ]);

    expect((await repository().history('c1')).items.single.authorName, isNot('a-uuid'));
  });

  test('reading a page triggers NO second request to resolve identity', () async {
    // The one thing this client must never do. A per-message identity call would
    // be invisible in the rendered output and catastrophic on a slow network.
    stubHistory([
      messageDto(id: 'm1', authorKind: 'contact', authorId: 'p1', authorDisplayName: 'Umm Yusuf'),
      messageDto(id: 'm2', authorKind: 'teacher', authorId: 't1', authorDisplayName: 'Ustadh Kareem'),
      messageDto(id: 'm3', authorKind: 'staff', authorId: 'a1', authorDisplayName: 'Jawwid'),
    ]);

    await repository().history('c1');

    expect(server.requests.length, 1);
    expect(server.countOf('GET', '/conversations/c1/messages'), 1);
    // No /me, no actor lookup, no members fetch.
    expect(server.countOf('GET', '/me'), 0);
    expect(server.countOf('GET', '/conversations/c1'), 0);
  });

  test('the viewer still recognises their own message', () async {
    // `isMine` keys on authorId, which is unchanged — the additive name must not
    // have disturbed it.
    stubHistory([
      messageDto(id: 'm1', authorKind: 'contact', authorId: 'me', authorDisplayName: 'Me'),
      messageDto(id: 'm2', authorKind: 'contact', authorId: 'p2', authorDisplayName: 'Someone'),
    ]);

    final page = await repository(viewer: 'me').history('c1');

    expect(page.items.first.isMine, isTrue);
    expect(page.items.last.isMine, isFalse);
  });
}
