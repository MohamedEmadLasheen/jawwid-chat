import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
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
import 'package:jawwid_chat/shared/models/story.dart';

import '../features/messages/fake_voice_devices.dart';
import '../features/stories/fake_story_video_player.dart';

/// Stories v2 against a REAL server: a parent signs in over real HTTP, the real feed maps a
/// voice story with no expiry and a "message the publisher" button, and tapping that button
/// goes through the real `POST /stories/:id/cta` -- which opens a real direct conversation --
/// to the conversation route.
///
/// Audio itself is the one fake: a test host has no platform audio session. What the fake
/// proves is that the player was handed exactly the signed URL the server minted.
///
/// Skipped unless pointed at a server that has a published VOICE story with a
/// `message_publisher` button addressed to this parent (the super admin's reaches everyone):
///
///     JAWWID_LIVE_API=http://127.0.0.1:3000/api/v1 \
///     JAWWID_LIVE_PARENT_USERNAME=… JAWWID_LIVE_PARENT_PASSWORD=… \
///     flutter test test/integration/live_story_v2_test.dart
void main() {
  final env = Platform.environment;
  final baseUrl = env['JAWWID_LIVE_API'];
  final username = env['JAWWID_LIVE_PARENT_USERNAME'];
  final password = env['JAWWID_LIVE_PARENT_PASSWORD'];
  final configured = baseUrl != null && username != null && password != null;

  group(
    'live stories v2',
    skip: configured
        ? false
        : 'set JAWWID_LIVE_API and JAWWID_LIVE_PARENT_USERNAME/PASSWORD to run against a real server',
    () {
      HttpOverrides? saved;
      late _RealHttp realHttp;

      setUp(() {
        saved = HttpOverrides.current;
        realHttp = _RealHttp();
        HttpOverrides.global = realHttp;
      });

      tearDown(() {
        realHttp.closeAll();
        HttpOverrides.global = saved;
      });

      testWidgets('a voice story with no expiry plays its signed URL, and "message" opens a real chat',
          (tester) async {
        late final HttpStoryRepository repository;
        late final List<Story> stories;
        await tester.runAsync(() async {
          repository = await _signedInStories(baseUrl: baseUrl!, username: username!, password: password!);
          stories = await repository.feed();
        });

        final voice = stories.where(
          (s) => s.kind == StoryKind.voice && s.cta?.kind == StoryCtaKind.messagePublisher,
        );
        expect(voice, isNotEmpty, reason: 'publish a voice story with a message button first');
        final story = voice.first;
        expect(story.expiresAt, isNull, reason: 'a story published since 2026-10-17 does not expire');
        expect(story.mediaKind, StoryMediaKind.audio);
        expect(story.body, isNull, reason: 'a voice story carries no caption');
        expect(story.mediaUrl, startsWith(baseUrl!.replaceFirst(RegExp(r'/api/v1$'), '')));

        final player = FakeVoicePlayer();
        final router = GoRouter(
          initialLocation: '/stories/${story.id}',
          routes: [
            GoRoute(path: '/', builder: (_, _) => const SizedBox.shrink()),
            GoRoute(
              path: '/stories/:storyId',
              builder: (_, state) => StoryViewerScreen(storyId: state.pathParameters['storyId']!),
            ),
            GoRoute(
              path: '/chats/:id',
              builder: (_, state) => Scaffold(body: Text('chat ${state.pathParameters['id']}')),
            ),
          ],
        );

        await tester.pumpWidget(
          ProviderScope(
            retry: JawwidRetryPolicy.policy,
            overrides: [
              storyRepositoryProvider.overrideWithValue(repository),
              storyVideoPlayerFactoryProvider.overrideWithValue(FakeStoryVideoPlayer.new),
              storyVoicePlayerFactoryProvider.overrideWithValue(() => player),
            ],
            child: MaterialApp.router(
              routerConfig: router,
              locale: const Locale('en'),
              theme: JawwidTheme.light(isArabic: false),
              supportedLocales: JawwidApp.supportedLocales,
              localizationsDelegates: const [
                L10n.delegate,
                GlobalMaterialLocalizations.delegate,
                GlobalWidgetsLocalizations.delegate,
                GlobalCupertinoLocalizations.delegate,
              ],
            ),
          ),
        );

        Future<bool> waitFor(Finder finder) async {
          for (var i = 0; i < 60; i++) {
            await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 80)));
            await tester.pump(const Duration(milliseconds: 80));
            if (finder.evaluate().isNotEmpty) return true;
          }
          return false;
        }

        expect(await waitFor(find.text('Send a message')), isTrue, reason: 'the button never appeared');
        // The viewer's controller reads its own feed, so its link was minted a moment later:
        // same story, same reader, a fresh signature. Compared on identity, not on the
        // per-request expiry and signature.
        expect(player.loaded, hasLength(1));
        final played = Uri.parse(player.loaded.single);
        final minted = Uri.parse(story.mediaUrl!);
        expect(played.path, minted.path, reason: 'the player must get the server-minted media route');
        expect(played.queryParameters['a'], minted.queryParameters['a']);
        expect(played.queryParameters['s'], isNotEmpty);

        await tester.tap(find.text('Send a message'));
        expect(
          await waitFor(find.textContaining('chat ')),
          isTrue,
          reason: 'the reply tap never reached the conversation route',
        );
        final shown = tester.widget<Text>(find.textContaining('chat ')).data!;
        expect(shown.replaceFirst('chat ', ''), matches(RegExp(r'^[0-9a-f-]{36}$')));
        expect(find.byType(StoryViewerScreen), findsNothing);

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
  Future<DeviceDescription?> describe() async =>
      const DeviceDescription(platform: 'ios', name: 'stories v2 live suite', appVersion: '0.0.0-test');
}

/// Real networking, every client kept so it can be closed (see live_story_viewer_test.dart).
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
