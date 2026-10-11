import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/http/http_story_repository.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/device_descriptor.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/shared/models/story.dart';

/// Story MEDIA, end to end, against a **running backend and real object storage**.
///
/// ## The gap this closes
///
/// Every other story test stops at the contract: the server returns a `mediaUrl`, and a fake
/// stands in for the bytes. That leaves the one thing a reader actually cares about unproven
/// — whether the picture appears — and it is not a hypothetical gap. A signed URL is built
/// from configuration, and a misconfigured deployment hands out URLs that resolve to a host
/// nothing can reach: the API answers correctly, the contract tests pass, and the story is
/// blank on the phone. That is exactly what was found in QA.
///
/// So this suite follows the bytes the whole way:
///
///   sign in -> GET /stories/feed -> the signed mediaUrl -> real HTTP GET ->
///   decode through Flutter's own image pipeline -> assert real pixels
///
/// It decodes with `ui.instantiateImageCodec`, which is the same decoder `Image.network`
/// uses once its bytes have arrived, so a payload that is an error page, a redirect, a
/// truncated object or the wrong content type fails here rather than on a reader's phone.
///
/// Run for BOTH roles, because the audience is resolved per principal and a URL signed for
/// one is not evidence about the other.
///
/// Skipped unless pointed at a live server, exactly like `live_backend_test.dart`:
///
/// ```
/// JAWWID_LIVE_API=http://127.0.0.1:3100/api/v1 \
/// JAWWID_LIVE_PARENT_USERNAME=… JAWWID_LIVE_PARENT_PASSWORD=… \
/// JAWWID_LIVE_TEACHER_USERNAME=… JAWWID_LIVE_TEACHER_PASSWORD=… \
/// flutter test test/integration/live_story_media_test.dart
/// ```
void main() {
  final env = Platform.environment;
  final baseUrl = env['JAWWID_LIVE_API'];
  final parentUsername = env['JAWWID_LIVE_PARENT_USERNAME'];
  final parentPassword = env['JAWWID_LIVE_PARENT_PASSWORD'];
  final teacherUsername = env['JAWWID_LIVE_TEACHER_USERNAME'];
  final teacherPassword = env['JAWWID_LIVE_TEACHER_PASSWORD'];

  final configured = baseUrl != null &&
      parentUsername != null &&
      parentPassword != null &&
      teacherUsername != null &&
      teacherPassword != null;

  group(
    'live story media',
    skip: configured
        ? false
        : 'set JAWWID_LIVE_API and the JAWWID_LIVE_*_USERNAME/PASSWORD pairs to run '
            'against a real server',
    () {
      /// Sign in, read the feed, and fetch + decode the first story that carries media.
      Future<void> mediaRenders(String username, String password) async {
        final stories = await _feedFor(
          baseUrl: baseUrl!,
          username: username,
          password: password,
        );

        final withMedia = stories.where((s) => s.mediaUrl != null).toList();
        expect(
          withMedia,
          isNotEmpty,
          reason: 'publish a live story with media before running this suite',
        );

        for (final story in withMedia) {
          final url = Uri.parse(story.mediaUrl!);

          // A real socket to whatever the signed URL actually names. This is the step that
          // fails when the configured public base URL points somewhere unreachable, and no
          // amount of contract testing substitutes for it.
          final client = HttpClient()
            ..connectionTimeout = const Duration(seconds: 10);
          final bytes = await () async {
            try {
              final response = await (await client.getUrl(url)).close();
              expect(
                response.statusCode,
                200,
                reason: 'the signed media URL for ${story.id} must be fetchable at $url',
              );
              final chunks = await response.toList();
              return chunks.expand((c) => c).toList();
            } finally {
              client.close(force: true);
            }
          }();

          expect(bytes, isNotEmpty, reason: 'media for ${story.id} was empty');

          // Decoded, not merely downloaded: an HTML error page is also "bytes", and it is
          // what a misrouted request returns.
          final codec = await ui.instantiateImageCodec(Uint8List.fromList(bytes));
          final frame = await codec.getNextFrame();
          addTearDown(frame.image.dispose);

          expect(frame.image.width, greaterThan(0));
          expect(frame.image.height, greaterThan(0));
        }
      }

      test('a parent can fetch and decode the media of their own stories', () async {
        await mediaRenders(parentUsername!, parentPassword!);
      });

      test('a teacher can fetch and decode the media of their own stories', () async {
        await mediaRenders(teacherUsername!, teacherPassword!);
      });
    },
  );
}

/// The signed-in reader's feed, over the app's own HTTP stack.
Future<List<Story>> _feedFor({
  required String baseUrl,
  required String username,
  required String password,
}) async {
  final store = InMemoryTokenStore();
  late final ApiClient client;

  final auth = HttpAuthRepository(
    transport: buildAuthTransport(config: ApiConfig(baseUrl: baseUrl)),
    protected: () => client,
    device: _TestDevice(),
    currentAccessToken: () async => (await store.read())?.accessToken,
  );

  client = buildApiClient(
    config: ApiConfig(baseUrl: baseUrl),
    tokens: StoredTokenProvider(store: store, auth: auth, onEnded: (_) async {}),
  );

  await store.write(await auth.signIn(username: username, password: password));
  return HttpStoryRepository(client: client).feed();
}

class _TestDevice implements DeviceDescriptor {
  @override
  Future<DeviceDescription?> describe() async => const DeviceDescription(
        platform: 'ios',
        name: 'story media suite',
        appVersion: '0.0.0-test',
      );
}
