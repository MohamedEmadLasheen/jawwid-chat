import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/http/http_auth_repository.dart';
import 'package:jawwid_chat/core/data/http/http_story_repository.dart';
import 'package:jawwid_chat/core/network/api_client.dart';
import 'package:jawwid_chat/core/network/api_config.dart';
import 'package:jawwid_chat/core/network/device_descriptor.dart';
import 'package:jawwid_chat/core/network/http_stack.dart';
import 'package:jawwid_chat/core/storage/secure_token_store.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/stories/presentation/story_viewer_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

import '../features/stories/fake_story_video_player.dart';

/// The picture, ON SCREEN, in the real story viewer.
///
/// ## Why this exists even though the bytes are already tested
///
/// `live_story_media_test.dart` proves the signed URL is fetchable and that the bytes decode.
/// That is necessary and it is not sufficient: it never builds the viewer, so it cannot catch
/// a story whose picture never reaches the screen — a URL the widget declines to load, an
/// `errorBuilder` firing, a loading state that never resolves. Those are what the reader
/// actually experiences, and the reported QA symptom was exactly that: the API answered
/// correctly and the story was blank.
///
/// So this one pumps the REAL [StoryViewerScreen] against the REAL backend and asserts the
/// decoded frame is in the widget tree:
///
///   sign in -> real feed -> real `Image.network` -> a RawImage holding real pixels
///
/// ## Why it is a widget test and not a simulator tap
///
/// Deterministic. Driving the rail by coordinate on a simulator proved unreliable — the tap
/// is swallowed often enough that a green run means nothing and a red one diagnoses nothing.
/// This builds the same widget the device builds, over the same HTTP stack, and fails for a
/// reason you can read.
///
/// Flutter's test binding installs an `HttpOverrides` that answers every request with 400, so
/// it is removed for the duration: without that, `Image.network` could not reach the server
/// and this suite would be testing the mock.
///
/// Skipped unless pointed at a live server:
///
/// ```
/// JAWWID_LIVE_API=http://127.0.0.1:3100/api/v1 \
/// JAWWID_LIVE_PARENT_USERNAME=… JAWWID_LIVE_PARENT_PASSWORD=… \
/// JAWWID_LIVE_TEACHER_USERNAME=… JAWWID_LIVE_TEACHER_PASSWORD=… \
/// flutter test test/integration/live_story_viewer_test.dart
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
    'live story viewer',
    skip: configured
        ? false
        : 'set JAWWID_LIVE_API and the JAWWID_LIVE_*_USERNAME/PASSWORD pairs to run '
            'against a real server',
    () {
    HttpOverrides? savedOverrides;
    late _RealHttp realHttp;

      setUp(() {
        // The binding's mock answers 400 to everything, including image requests.
        savedOverrides = HttpOverrides.current;
        realHttp = _RealHttp();
        HttpOverrides.global = realHttp;
      });

      tearDown(() {
        // Keep-alive connections hold a 15s idle timer, and the widget tester fails a test
        // that ends with one pending. Closing the clients we handed out releases them.
        realHttp.closeAll();
        HttpOverrides.global = savedOverrides;
      });

      Future<void> theImageAppears(
        WidgetTester tester,
        String username,
        String password,
      ) async {
        // Sign in and read the feed with REAL async, outside the pump loop.
        late final HttpStoryRepository repository;
        late final List<dynamic> media;
        await tester.runAsync(() async {
          repository = await _signedInStories(
            baseUrl: baseUrl!,
            username: username,
            password: password,
          );
          final stories = await repository.feed();
          media = stories.where((s) => s.mediaKind != null).toList();
        });

        expect(
          media,
          isNotEmpty,
          reason: 'publish a live story with media before running this suite',
        );

        await tester.pumpWidget(
          ProviderScope(
            retry: JawwidRetryPolicy.policy,
            overrides: [
              storyRepositoryProvider.overrideWithValue(repository),
              // The suite's existing seam fake: no platform video session on a test host,
              // and this story is an image, so it is never driven.
              storyVideoPlayerFactoryProvider
                  .overrideWithValue(FakeStoryVideoPlayer.new),
            ],
            child: MaterialApp(
              locale: const Locale('en'),
              theme: JawwidTheme.light(isArabic: false),
              supportedLocales: JawwidApp.supportedLocales,
              localizationsDelegates: const [
                L10n.delegate,
                GlobalMaterialLocalizations.delegate,
                GlobalWidgetsLocalizations.delegate,
                GlobalCupertinoLocalizations.delegate,
              ],
              home: StoryViewerScreen(storyId: media.first.id),
            ),
          ),
        );

        // `pump` must stay OUTSIDE runAsync; the real IO gets its own window each turn.
        RawImage? decoded;
        for (var i = 0; i < 50; i++) {
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 80)),
          );
          await tester.pump(const Duration(milliseconds: 80));
          final found = tester
              .widgetList<RawImage>(find.byType(RawImage))
              .where((w) => w.image != null);
          if (found.isNotEmpty) {
            decoded = found.first;
            break;
          }
        }


        // The failure path the reader would see, named so a red run says why.
        expect(
          find.text('This picture could not be loaded.'),
          findsNothing,
          reason: 'the viewer rendered its media-failure state',
        );
        expect(
          decoded,
          isNotNull,
          reason: 'no decoded frame ever reached the story viewer',
        );

        // The RIGHT picture, not merely some picture: the published dimensions.
        expect(decoded!.image!.width, 400, reason: 'wrong image rendered for $username');
        expect(decoded.image!.height, 700, reason: 'wrong image rendered for $username');
      }

      // Both roles in ONE case, deliberately. `NetworkImage` holds a single `HttpClient` per
      // isolate, created on first use and honouring whatever `HttpOverrides` was installed
      // then; closing it at the end of a first test leaves a second test loading images
      // through a closed client, which fails as "could not be loaded" and looks like a
      // product bug. One client lifecycle, closed once, keeps the signal honest — and each
      // role still gets its own sign-in, its own feed and its own assertions.
      testWidgets('the picture renders for a parent AND for a teacher', (tester) async {
        await theImageAppears(tester, parentUsername!, parentPassword!);
        await theImageAppears(tester, teacherUsername!, teacherPassword!);

        // Only now: closing cancels the pooled keep-alive timers inside the test body, where
        // a pending timer would otherwise fail the run.
        realHttp.closeAll();
        await tester.pump();
      });
    },
  );
}

Future<HttpStoryRepository> _signedInStories({
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
  return HttpStoryRepository(client: client);
}

class _TestDevice implements DeviceDescriptor {
  @override
  Future<DeviceDescription?> describe() async => const DeviceDescription(
        platform: 'ios',
        name: 'story viewer suite',
        appVersion: '0.0.0-test',
      );
}

/// Real networking for the image load, with every client kept so it can be closed.
///
/// `HttpOverrides.global = null` would also restore real networking, but the connections it
/// pools keep a 15-second keep-alive timer alive, and the tester fails any test that ends
/// with a pending timer. Keeping a handle on every client so the test can close them — once
/// the bytes have arrived, never before — is what makes this deterministic. Shortening
/// `idleTimeout` instead does not work: it severs the download mid-flight and the viewer
/// renders its failure state, which is a false red.
class _RealHttp extends HttpOverrides {
  final _clients = <HttpClient>[];

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final client = super.createHttpClient(context);
    _clients.add(client);
    return client;
  }

  void closeAll() {
    for (final client in _clients) {
      client.close(force: true);
    }
    _clients.clear();
  }
}
