import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/http/http_story_repository.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/features/stories/application/stories_controller.dart';
import 'package:jawwid_chat/shared/models/story.dart';

import 'test_server.dart';

class _NoTokens implements TokenProvider {
  @override
  Future<String?> accessToken() async => null;

  @override
  Future<String?> refresh() async => null;

  @override
  Future<void> onSessionEnded(AppError error) async {}
}

/// Stories over the real HTTP transport.
///
/// This is where the two halves meet: the controller and the repository driving actual sockets
/// against a server that speaks the published contract. Everything above this file fakes the
/// repository; this one does not, so it is the only place the wire format itself is proved —
/// the paths, the response envelopes, and what happens to a refusal on the way back.
///
/// It does NOT re-test the backend. The server here is scripted, not real: what is under test
/// is the client's half of the contract in `apps/api/src/communication/api/story.controller.ts`.
void main() {
  late TestServer server;
  late ProviderContainer container;

  /// A `StoryFeedItem` as the API sends it since 2026-10-17: a kind, no title, and no
  /// expiry unless a test gives one.
  Map<String, Object?> feedItem({
    String id = 'story-1',
    String? kind,
    String? body = 'Classes resume this Sunday.',
    String? background,
    String? mediaKind,
    String? mediaUrl,
    int? mediaDurationMs,
    Map<String, Object?>? cta,
    String publishedAt = '2026-09-29T09:00:00.000Z',
    String? expiresAt,
    bool viewed = false,
  }) =>
      {
        'id': id,
        'kind': kind,
        'body': body,
        'background': background,
        'mediaKind': mediaKind,
        'mediaUrl': mediaUrl,
        'mediaDurationMs': mediaDurationMs,
        'cta': cta,
        'publishedAt': publishedAt,
        'expiresAt': expiresAt,
        'viewed': viewed,
      };

  setUp(() async {
    server = await TestServer.start();
    container = ProviderContainer(
      // The app's own policy, as main() installs it. Without it Riverpod's default retries
      // every failed provider on a timer -- including a 403, which will fail identically
      // forever. That is exactly what JawwidRetryPolicy exists to refuse.
      retry: JawwidRetryPolicy.policy,
      overrides: [
        storyRepositoryProvider.overrideWithValue(
          HttpStoryRepository(
            client: buildApiClient(
              config: ApiConfig(baseUrl: server.baseUrl),
              tokens: _NoTokens(),
            ),
          ),
        ),
      ],
    );
  });

  tearDown(() async {
    container.dispose();
    await server.stop();
  });

  group('GET /stories/feed', () {
    test('the client asks the published path, and maps the published envelope', () async {
      server.on('GET', '/stories/feed', [
        Reply.ok({
          'stories': [feedItem(id: 'a', kind: 'text', background: 'plum'), feedItem(id: 'b', viewed: true)],
        }),
      ]);

      final stories = await container.read(storiesControllerProvider.future);

      expect(server.requests.single.method, 'GET');
      expect(server.requests.single.path, '/stories/feed');
      expect(stories.map((s) => s.id), ['a', 'b']);
      expect(stories.first.kind, StoryKind.text);
      expect(stories.first.body, 'Classes resume this Sunday.');
      expect(stories.first.background, 'plum');
      expect(stories.last.isViewed, isTrue);
    });

    test('it sends no pagination parameters, because the contract publishes none', () async {
      server.on('GET', '/stories/feed', [const Reply.ok({'stories': <Object?>[]})]);

      await container.read(storiesControllerProvider.future);

      // GET /stories/feed takes no cursor and no page size. Inventing one would be a
      // parameter the server ignores and a promise the client cannot keep.
      expect(server.requests.single.query, isEmpty);
    });

    test('media travels as the signed URL the server minted, byte for byte', () async {
      const url = 'https://storage.example/stories/abc?expires=1234&sig=deadbeef';
      server.on('GET', '/stories/feed', [
        Reply.ok({
          'stories': [feedItem(mediaKind: 'image', mediaUrl: url)],
        }),
      ]);

      final stories = await container.read(storiesControllerProvider.future);

      expect(stories.single.mediaKind, StoryMediaKind.image);
      expect(stories.single.mediaUrl, url);
    });

    test('a half-described attachment is treated as no attachment', () async {
      // The server sets mediaKind and mediaUrl together, and sends neither once media is
      // purged. A row with only one of them would render an image box that can never fill.
      server.on('GET', '/stories/feed', [
        Reply.ok({
          'stories': [
            feedItem(id: 'kind-only', mediaKind: 'image'),
            feedItem(id: 'url-only', mediaUrl: 'https://storage.example/x'),
          ],
        }),
      ]);

      final stories = await container.read(storiesControllerProvider.future);

      expect(stories.every((s) => s.hasMedia), isFalse);
      expect(stories.every((s) => s.mediaUrl == null), isTrue);
    });

    test('an unusable row is dropped, and does not blank the whole feed', () async {
      server.on('GET', '/stories/feed', [
        Reply.ok({
          'stories': [
            feedItem(id: 'good'),
            // No publication time: there is no story without one.
            {'id': 'no-publishedAt', 'viewed': false},
            'not even an object',
          ],
        }),
      ]);

      final stories = await container.read(storiesControllerProvider.future);
      expect(stories.map((s) => s.id), ['good']);
    });

    test('a story with NO expiry is kept -- that is every story since 2026-10-17', () async {
      // Regression: this mapper used to drop a row without expiresAt, which would have made
      // every new story invisible on the phone the day the server stopped expiring them.
      server.on('GET', '/stories/feed', [
        Reply.ok({
          'stories': [
            {'id': 'forever', 'kind': 'text', 'body': 'Hi', 'publishedAt': '2026-10-17T09:00:00.000Z', 'expiresAt': null, 'viewed': false},
            feedItem(id: 'legacy', expiresAt: '2099-09-30T09:00:00.000Z'),
          ],
        }),
      ]);

      final stories = await container.read(storiesControllerProvider.future);
      expect(stories.map((s) => s.id), ['forever', 'legacy']);
      expect(stories.first.expiresAt, isNull);
      expect(stories.first.isExpiredAt(DateTime.utc(2100)), isFalse);
      expect(stories.last.expiresAt!.toUtc(), DateTime.utc(2099, 9, 30, 9));
    });

    test('a picture carries no caption, even from an older server that sent one', () async {
      server.on('GET', '/stories/feed', [
        Reply.ok({
          'stories': [
            feedItem(mediaKind: 'image', mediaUrl: 'https://storage.example/p.png', body: 'old caption'),
          ],
        }),
      ]);

      final stories = await container.read(storiesControllerProvider.future);
      expect(stories.single.kind, StoryKind.image);
      expect(stories.single.body, isNull);
    });

    test('a voice story maps its audio and its duration', () async {
      server.on('GET', '/stories/feed', [
        Reply.ok({
          'stories': [
            feedItem(
              kind: 'voice',
              body: null,
              background: 'sunset',
              mediaKind: 'audio',
              mediaUrl: 'https://api.example/media/stories/x?sig=1',
              mediaDurationMs: 42000,
            ),
          ],
        }),
      ]);

      final stories = await container.read(storiesControllerProvider.future);
      expect(stories.single.kind, StoryKind.voice);
      expect(stories.single.mediaKind, StoryMediaKind.audio);
      expect(stories.single.mediaDuration, const Duration(seconds: 42));
      expect(stories.single.background, 'sunset');
    });

    test('a button is mapped as sent; one that could only fail is no button', () async {
      server.on('GET', '/stories/feed', [
        Reply.ok({
          'stories': [
            feedItem(id: 'wa', cta: {'kind': 'whatsapp', 'label': 'Ask us', 'url': 'https://wa.me/971501234567'}),
            feedItem(id: 'msg', cta: {'kind': 'message_publisher', 'label': null, 'url': null}),
            feedItem(id: 'http', cta: {'kind': 'link', 'url': 'http://insecure.example'}),
            feedItem(id: 'odd', cta: {'kind': 'telegram', 'url': 'https://t.me/x'}),
          ],
        }),
      ]);

      final byId = {
        for (final s in await container.read(storiesControllerProvider.future)) s.id: s,
      };
      expect(byId['wa']!.cta!.kind, StoryCtaKind.whatsapp);
      expect(byId['wa']!.cta!.label, 'Ask us');
      expect(byId['wa']!.cta!.url, 'https://wa.me/971501234567');
      expect(byId['msg']!.cta!.kind, StoryCtaKind.messagePublisher);
      expect(byId['msg']!.cta!.url, isNull);
      expect(byId['http']!.cta, isNull);
      expect(byId['odd']!.cta, isNull);
    });

    test('an unknown media kind is ignored rather than guessed', () async {
      server.on('GET', '/stories/feed', [
        Reply.ok({
          'stories': [
            feedItem(mediaKind: 'hologram', mediaUrl: 'https://storage.example/x.holo'),
          ],
        }),
      ]);

      final stories = await container.read(storiesControllerProvider.future);
      expect(stories.single.mediaKind, isNull);
      expect(stories.single.hasMedia, isFalse);
    });

    test('a 403 refusal surfaces as a forbidden error, not an empty feed', () async {
      server.on('GET', '/stories/feed', [
        const Reply(403, {
          'error': {'code': WireErrors.storyCannotRead, 'message': 'not a communicating contact'},
        }),
      ]);

      await expectLater(
        container.read(storiesControllerProvider.future),
        throwsA(
          isA<AppError>()
              .having((e) => e.kind, 'kind', AppErrorKind.forbidden)
              .having((e) => e.code, 'code', WireErrors.storyCannotRead),
        ),
      );
    });
  });

  group('POST /stories/:id/view', () {
    test('posts to the published path and records nothing else', () async {
      server.on('GET', '/stories/feed', [Reply.ok({'stories': [feedItem(id: 'abc')]})]);
      server.on('POST', '/stories/abc/view', [const Reply.ok({'ok': true})]);

      await container.read(storiesControllerProvider.future);
      final failure = await container.read(storiesControllerProvider.notifier).markViewed('abc');

      expect(failure, isNull);
      final post = server.requests.last;
      expect(post.method, 'POST');
      expect(post.path, '/stories/abc/view');
      // The server derives the viewer from the session. A body naming an actor would be a
      // field no code path reads.
      expect(post.body, anyOf(isNull, isEmpty));
    });

    test('a 410 GONE is returned to the caller so the viewer can leave', () async {
      server.on('GET', '/stories/feed', [Reply.ok({'stories': [feedItem(id: 'abc')]})]);
      server.on('POST', '/stories/abc/view', [
        const Reply(410, {
          'error': {'code': WireErrors.storyExpired, 'message': 'this story has expired'},
        }),
      ]);

      await container.read(storiesControllerProvider.future);
      final failure = await container.read(storiesControllerProvider.notifier).markViewed('abc');

      expect(failure, isNotNull);
      expect(failure!.code, WireErrors.storyExpired);
    });

    test('an unrelated failure is swallowed: the reader keeps reading', () async {
      server.on('GET', '/stories/feed', [Reply.ok({'stories': [feedItem(id: 'abc')]})]);
      server.on('POST', '/stories/abc/view', [const Reply(500, {'error': {'code': 'boom'}})]);

      await container.read(storiesControllerProvider.future);
      final failure = await container.read(storiesControllerProvider.notifier).markViewed('abc');

      // Not worth interrupting a reader for. The story is still perfectly readable, and the
      // next refresh reconciles the flag.
      expect(failure, isNull);
    });

    test('a view is NOT auto-retried by the transport', () async {
      server.on('GET', '/stories/feed', [Reply.ok({'stories': [feedItem(id: 'abc')]})]);
      server.on('POST', '/stories/abc/view', [
        const Reply(503, {'error': {'code': 'unavailable'}}),
        const Reply.ok({'ok': true}),
      ]);

      await container.read(storiesControllerProvider.future);
      await container.read(storiesControllerProvider.notifier).markViewed('abc');

      // Exactly one POST. The view is already idempotent on the server by composite primary
      // key, so a replay would add a request and nothing else.
      final posts = server.requests.where((r) => r.method == 'POST').toList();
      expect(posts, hasLength(1));
    });
  });

  group('POST /stories/:id/cta', () {
    test('posts to the published path once, and returns where to go', () async {
      server.on('GET', '/stories/feed', [
        Reply.ok({'stories': [feedItem(id: 'abc', cta: {'kind': 'message_publisher'})]}),
      ]);
      server.on('POST', '/stories/abc/cta', [
        const Reply.ok({'kind': 'message_publisher', 'url': null, 'conversationId': 'conv-9'}),
      ]);

      await container.read(storiesControllerProvider.future);
      final result = await container.read(storiesControllerProvider.notifier).tapCta('abc');

      expect(result.error, isNull);
      expect(result.tap!.conversationId, 'conv-9');
      final posts = server.requests.where((r) => r.method == 'POST').toList();
      expect(posts.single.path, '/stories/abc/cta');
    });

    test('a tap is NOT auto-retried: every tap is a tap, and the failure is reported', () async {
      server.on('GET', '/stories/feed', [
        Reply.ok({'stories': [feedItem(id: 'abc', cta: {'kind': 'link', 'url': 'https://x.example'})]}),
      ]);
      server.on('POST', '/stories/abc/cta', [
        const Reply(503, {'error': {'code': 'unavailable'}}),
        const Reply.ok({'kind': 'link', 'url': 'https://x.example'}),
      ]);

      await container.read(storiesControllerProvider.future);
      final result = await container.read(storiesControllerProvider.notifier).tapCta('abc');

      expect(result.tap, isNull);
      expect(result.error, isNotNull);
      expect(server.requests.where((r) => r.method == 'POST'), hasLength(1));
    });

    test('a story that is gone comes back as gone, so the viewer can leave', () async {
      server.on('GET', '/stories/feed', [
        Reply.ok({'stories': [feedItem(id: 'abc', cta: {'kind': 'link', 'url': 'https://x.example'})]}),
      ]);
      server.on('POST', '/stories/abc/cta', [
        const Reply(410, {'error': {'code': WireErrors.storyDeleted, 'message': 'this story was removed'}}),
      ]);

      await container.read(storiesControllerProvider.future);
      final result = await container.read(storiesControllerProvider.notifier).tapCta('abc');
      expect(result.error?.code, WireErrors.storyDeleted);
    });
  });

  group('the whole read journey, over sockets', () {
    test('feed -> open -> view -> the flag comes back set', () async {
      server.on('GET', '/stories/feed', [
        Reply.ok({'stories': [feedItem(id: 's1', viewed: false)]}),
        // What the server says after the view has been recorded.
        Reply.ok({'stories': [feedItem(id: 's1', viewed: true)]}),
      ]);
      server.on('POST', '/stories/s1/view', [const Reply.ok({'ok': true})]);

      // 1. The rail's data.
      final first = await container.read(storiesControllerProvider.future);
      expect(first.single.isViewed, isFalse);

      // 2. The reader opens it; the viewer records the view.
      await container.read(storiesControllerProvider.notifier).markViewed('s1');

      // 3. Optimistically already read, before any refetch.
      expect(container.read(storyRailOrderProvider).single.isViewed, isTrue);

      // 4. And the server agrees on the next refresh — the client was not inventing it.
      await container.read(storiesControllerProvider.notifier).refresh();
      expect(container.read(storyRailOrderProvider).single.isViewed, isTrue);

      expect(
        server.requests.map((r) => '${r.method} ${r.path}'),
        ['GET /stories/feed', 'POST /stories/s1/view', 'GET /stories/feed'],
      );
    });
  });
}
