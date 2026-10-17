import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/audio/voice_player.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/media/attachment_opener.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/stories/application/stories_controller.dart';
import 'package:jawwid_chat/features/stories/presentation/story_viewer_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/story.dart';

import '../messages/fake_voice_devices.dart';
import 'fake_story_repository.dart';
import 'fake_story_video_player.dart';

/// The story viewer after the 2026-10-17 owner decisions: voice stories, the one button, no
/// caption, and no expiry.
///
/// Driven through a real GoRouter, because "message the publisher" answers with a
/// conversation and the viewer's job is to take the reader there.
class _FakeOpener implements AttachmentOpener {
  final opened = <String>[];
  bool succeeds = true;

  @override
  Future<bool> open(String url) async {
    opened.add(url);
    return succeeds;
  }
}

void main() {
  late FakeStoryRepository fake;
  late FakeVoicePlayer voice;
  late _FakeOpener opener;

  setUp(() {
    fake = FakeStoryRepository();
    voice = FakeVoicePlayer();
    opener = _FakeOpener();
  });

  Future<void> settle(WidgetTester tester) async {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
    await tester.pump(const Duration(milliseconds: 250));
    for (var i = 0; i < 4; i++) {
      await tester.pump();
    }
  }

  Future<ProviderContainer> pumpViewer(
    WidgetTester tester, {
    required List<Story> stories,
    required String storyId,
    Locale locale = const Locale('en'),
  }) async {
    fake.setStories(stories);
    late ProviderContainer container;
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (context, _) => Scaffold(
            body: Center(
              child: ElevatedButton(
                onPressed: () => context.push('/stories/$storyId'),
                child: const Text('open'),
              ),
            ),
          ),
        ),
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
          storyRepositoryProvider.overrideWithValue(fake),
          storyVideoPlayerFactoryProvider.overrideWithValue(FakeStoryVideoPlayer.new),
          storyVoicePlayerFactoryProvider.overrideWithValue(() => voice),
          attachmentOpenerProvider.overrideWithValue(opener),
        ],
        child: Consumer(
          builder: (context, ref, _) {
            container = ProviderScope.containerOf(context);
            return MaterialApp.router(
              routerConfig: router,
              locale: locale,
              theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
              supportedLocales: JawwidApp.supportedLocales,
              localizationsDelegates: const [
                L10n.delegate,
                GlobalMaterialLocalizations.delegate,
                GlobalWidgetsLocalizations.delegate,
                GlobalCupertinoLocalizations.delegate,
              ],
            );
          },
        ),
      ),
    );
    await container.read(storiesControllerProvider.future);
    await tester.pumpAndSettle();
    await tester.tap(find.text('open'));
    await settle(tester);
    return container;
  }

  group('voice stories', () {
    testWidgets('load, play, and advance when PLAYBACK COMPLETES -- never on a timer',
        (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'v',
            mediaKind: StoryMediaKind.audio,
            mediaUrl: 'https://api.test/media/stories/v?sig=1',
            mediaDuration: const Duration(seconds: 40),
            background: 'sunset',
            publishedAt: DateTime.now(),
          ),
          story(id: 't', body: 'After the voice note', publishedAt: DateTime.now().subtract(const Duration(hours: 1))),
        ],
        storyId: 'v',
      );

      expect(voice.loaded, ['https://api.test/media/stories/v?sig=1']);
      expect(voice.playCount, greaterThan(0));
      expect(find.bySemanticsLabel(RegExp('^Voice story')), findsOneWidget);
      expect(fake.viewed, ['v']);

      // Five times an image's length: a 40-second voice note is not cut short.
      await tester.pump(StoryViewerScreen.imageDuration * 5);
      await settle(tester);
      expect(find.byKey(const ValueKey('story-page-v')), findsOneWidget);

      voice.advanceTo(const Duration(seconds: 40), duration: const Duration(seconds: 40));
      await tester.pump();
      voice.current = voice.current.copyWith(state: VoicePlaybackState.completed);
      voice.advanceTo(const Duration(seconds: 40));
      await settle(tester);
      expect(find.text('After the voice note'), findsOneWidget);
    });

    testWidgets('a voice note that fails to load says so, offers a retry, and does not advance',
        (tester) async {
      voice.failOnLoad = true;
      await pumpViewer(
        tester,
        stories: [
          story(id: 'v', mediaKind: StoryMediaKind.audio, mediaUrl: 'https://api.test/v'),
          story(id: 't', body: 'Next', publishedAt: DateTime.now().subtract(const Duration(hours: 2))),
        ],
        storyId: 'v',
      );
      expect(find.text('This voice note could not be played.'), findsOneWidget);

      voice.failOnLoad = false;
      await tester.tap(find.text('Try again'));
      await settle(tester);
      expect(voice.loaded, hasLength(2));
      expect(find.text('Next'), findsNothing);
    });
  });

  group('the button', () {
    testWidgets('a link: the tap is recorded, the server’s URL is opened, the story stays',
        (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(id: 'l', body: 'Open day', cta: const StoryCta(kind: StoryCtaKind.link, url: 'https://jawwid.example/open-day')),
        ],
        storyId: 'l',
      );

      expect(find.text('Learn more'), findsOneWidget);
      await tester.tap(find.text('Learn more'));
      await settle(tester);

      expect(fake.tapped, ['l']);
      expect(opener.opened, ['https://jawwid.example/open-day']);
      expect(find.byType(StoryViewerScreen), findsOneWidget);
    });

    testWidgets('WhatsApp shows the publisher’s own words', (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'w',
            body: 'Questions?',
            cta: const StoryCta(kind: StoryCtaKind.whatsapp, label: 'Ask us', url: 'https://wa.me/971501234567'),
          ),
        ],
        storyId: 'w',
      );
      await tester.tap(find.text('Ask us'));
      await settle(tester);
      expect(opener.opened, ['https://wa.me/971501234567']);
    });

    testWidgets('message the publisher: the viewer gives way to the conversation the server opened',
        (tester) async {
      fake.tapResult = const StoryCtaTap(kind: StoryCtaKind.messagePublisher, conversationId: 'conv-1');
      await pumpViewer(
        tester,
        stories: [story(id: 'm', body: 'Talk to me', cta: const StoryCta(kind: StoryCtaKind.messagePublisher))],
        storyId: 'm',
      );

      await tester.tap(find.text('Send a message'));
      await settle(tester);

      expect(fake.tapped, ['m']);
      expect(find.text('chat conv-1'), findsOneWidget);
      expect(find.byType(StoryViewerScreen), findsNothing);
      expect(opener.opened, isEmpty);
    });

    testWidgets('a failed tap is said out loud, and the reader stays on the story', (tester) async {
      fake.tapError = const AppError(AppErrorKind.network);
      await pumpViewer(
        tester,
        stories: [story(id: 'l', body: 'Open day', cta: const StoryCta(kind: StoryCtaKind.link, url: 'https://x.example'))],
        storyId: 'l',
      );
      await tester.tap(find.text('Learn more'));
      await settle(tester);

      expect(find.text("That didn't open. Please try again."), findsOneWidget);
      expect(find.byType(StoryViewerScreen), findsOneWidget);
      expect(opener.opened, isEmpty);
    });

    testWidgets('a tap on a story that is gone closes it and refetches the feed', (tester) async {
      fake.tapError = storyGoneError();
      final container = await pumpViewer(
        tester,
        stories: [story(id: 'l', body: 'Open day', cta: const StoryCta(kind: StoryCtaKind.link, url: 'https://x.example'))],
        storyId: 'l',
      );
      final before = fake.feedCalls;
      await tester.tap(find.text('Learn more'));
      await settle(tester);

      expect(find.byType(StoryViewerScreen), findsNothing);
      expect(fake.feedCalls, greaterThan(before));
      expect(container.read(storiesControllerProvider).hasValue, isTrue);
    });

    testWidgets('in Arabic, the default wording is Arabic', (tester) async {
      await pumpViewer(
        tester,
        locale: const Locale('ar'),
        stories: [story(id: 'w', body: 'سؤال؟', cta: const StoryCta(kind: StoryCtaKind.whatsapp, url: 'https://wa.me/971501234567'))],
        storyId: 'w',
      );
      expect(find.text('تواصل عبر واتساب'), findsOneWidget);
    });
  });

  group('no caption, no expiry', () {
    testWidgets('a photo story shows no words, even if a model somehow carried some', (tester) async {
      await pumpViewer(
        tester,
        stories: [
          Story(
            id: 'p',
            kind: StoryKind.image,
            body: 'a caption that must not appear',
            mediaKind: StoryMediaKind.image,
            mediaUrl: 'https://storage.test/p.png',
            publishedAt: DateTime.now(),
            isViewed: false,
          ),
        ],
        storyId: 'p',
      );
      expect(find.text('a caption that must not appear'), findsNothing);
      expect(find.byKey(const ValueKey('story-page-p')), findsOneWidget);
    });

    testWidgets('a story with no expiry is opened and viewed, however old', (tester) async {
      await pumpViewer(
        tester,
        stories: [story(id: 'old', body: 'Still here', publishedAt: DateTime.now().subtract(const Duration(days: 400)))],
        storyId: 'old',
      );
      expect(find.text('Still here'), findsOneWidget);
      expect(fake.viewed, ['old']);
    });

    testWidgets('a text story is drawn on the background the publisher chose', (tester) async {
      await pumpViewer(
        tester,
        stories: [story(id: 't', body: 'Gold', background: 'gold')],
        storyId: 't',
      );
      final box = tester.widgetList<DecoratedBox>(find.ancestor(
        of: find.text('Gold'),
        matching: find.byType(DecoratedBox),
      )).first;
      final gradient = (box.decoration as BoxDecoration).gradient! as LinearGradient;
      expect(gradient.colors.first, const Color(0xFF5C410F));
    });
  });
}
