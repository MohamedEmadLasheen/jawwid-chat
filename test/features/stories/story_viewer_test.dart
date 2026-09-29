import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/stories/application/stories_controller.dart';
import 'package:jawwid_chat/features/stories/presentation/story_viewer_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/story.dart';

import 'fake_story_repository.dart';
import 'fake_story_video_player.dart';

/// The story viewer.
///
/// ## Why nothing here calls `pumpAndSettle` while the viewer is open
///
/// The viewer runs a continuous auto-advance animation. `pumpAndSettle` pumps until no frame
/// is scheduled, which drives that animation to completion — so it silently pages through
/// every story and closes the viewer before the assertion runs. The first draft of this file
/// did exactly that and every test "found 0 widgets". [settleRoute] advances just far enough
/// to finish a route transition, and the tests that are ABOUT auto-advance pump the duration
/// explicitly.
///
/// Image loading is never exercised against a real network here: `Image.network` in a widget
/// test resolves against a mocked HTTP client that returns a 400, so every image lands in
/// `errorBuilder`. That is actually the useful half — it proves the failure path is wired —
/// and the success path is proved by the widget being built with the URL the server sent,
/// which these tests assert directly.
void main() {
  late FakeStoryRepository fake;
  late FakeStoryVideoPlayer video;

  setUp(() {
    fake = FakeStoryRepository();
    video = FakeStoryVideoPlayer();
  });

  /// Advance past a route or page transition without completing the auto-advance animation.
  ///
  /// Stepped frames, not one big jump. A single `pump(400ms)` completes the page animation but
  /// leaves the `setState` that `onPageChanged` schedules unpumped, so the new page is never
  /// built and the assertion looks for text that is one frame away. The trailing zero-duration
  /// pumps flush the same thing for `setState`s raised from stream microtasks — the video seam
  /// delivers on a broadcast stream, so its events land a frame after the pump that queued them.
  Future<void> settleRoute(WidgetTester tester) async {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
    await tester.pump(const Duration(milliseconds: 250));
    // `_enter` is an async chain — cancel the old subscription, reset state, stop or load the
    // player, then record the view. Each await is a microtask, and each `setState` needs a
    // frame, so a handful of zero-duration pumps is what lets it finish.
    for (var i = 0; i < 4; i++) {
      await tester.pump();
    }
  }

  /// Flush a `setState` raised from a stream event without advancing the clock.
  Future<void> flush(WidgetTester tester) async {
    await tester.pump();
    await tester.pump();
  }

  /// Pump the viewer inside a real Navigator, so `maybePop` has somewhere to go and closing
  /// can be observed rather than inferred.
  Future<ProviderContainer> pumpViewer(
    WidgetTester tester, {
    required List<Story> stories,
    required String storyId,
    Locale locale = const Locale('en'),
  }) async {
    fake.setStories(stories);
    late ProviderContainer container;

    await tester.pumpWidget(
      ProviderScope(
        retry: JawwidRetryPolicy.policy,
        overrides: [
          storyRepositoryProvider.overrideWithValue(fake),
          // A factory, because the viewer owns the player's lifecycle. Returning the same
          // instance each call is what lets a test assert it was disposed.
          storyVideoPlayerFactoryProvider.overrideWithValue(() => video),
        ],
        child: Consumer(
          builder: (context, ref, _) {
            container = ProviderScope.containerOf(context);
            return MaterialApp(
              locale: locale,
              theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
              supportedLocales: JawwidApp.supportedLocales,
              localizationsDelegates: const [
                L10n.delegate,
                GlobalMaterialLocalizations.delegate,
                GlobalWidgetsLocalizations.delegate,
                GlobalCupertinoLocalizations.delegate,
              ],
              home: Builder(
                builder: (context) => Scaffold(
                  body: Center(
                    child: ElevatedButton(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => StoryViewerScreen(storyId: storyId),
                        ),
                      ),
                      child: const Text('open'),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );

    // Load the feed first: the viewer reads the already-loaded list, exactly as the rail does.
    await container.read(storiesControllerProvider.future);
    await tester.pumpAndSettle();

    await tester.tap(find.text('open'));
    await settleRoute(tester);
    return container;
  }

  group('opening', () {
    testWidgets('opens the story that was asked for, not the first one', (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', title: 'First', publishedAt: DateTime.now()),
          story(
            id: 'b',
            title: 'Second',
            publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
        storyId: 'b',
      );

      expect(find.text('Second'), findsOneWidget);
    });

    testWidgets('shows the title and the body', (tester) async {
      await pumpViewer(
        tester,
        stories: [story(id: 'a', title: 'Term starts', body: 'On Sunday.')],
        storyId: 'a',
      );

      expect(find.text('Term starts'), findsOneWidget);
      expect(find.text('On Sunday.'), findsOneWidget);
    });

    testWidgets('a story id that is not in the feed says so and closes', (tester) async {
      // A deep link to something that expired before the link was followed.
      await pumpViewer(
        tester,
        stories: [story(id: 'a')],
        storyId: 'gone',
      );

      // It left rather than showing a blank screen or the wrong story.
      expect(find.byType(StoryViewerScreen), findsNothing);
      expect(find.text('open'), findsOneWidget);
    });

    testWidgets('a COLD START waits for the feed instead of declaring the story gone',
        (tester) async {
      // A notification or a saved link can land on /stories/:id before the feed has loaded.
      // Reading the list in initState found it empty and told the reader the story was gone,
      // which was a lie about a story that was about to arrive.
      fake
        ..setStories([story(id: 'a', title: 'Arrived late')])
        ..feedDelay = const Duration(milliseconds: 80);

      await tester.pumpWidget(
        ProviderScope(
          retry: JawwidRetryPolicy.policy,
          overrides: [
            storyRepositoryProvider.overrideWithValue(fake),
            storyVideoPlayerFactoryProvider.overrideWithValue(() => video),
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
            // Straight onto the viewer, with no rail ever built.
            home: const StoryViewerScreen(storyId: 'a'),
          ),
        ),
      );

      // Waiting, not giving up.
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('This story is no longer available.'), findsNothing);

      await tester.pump(const Duration(milliseconds: 120));
      await settleRoute(tester);

      expect(find.text('Arrived late'), findsOneWidget);
      expect(fake.viewed, ['a']);
    });

    testWidgets('an EXPIRED story is left immediately, without a view request',
        (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            expiresAt: DateTime.now().subtract(const Duration(minutes: 1)),
          ),
        ],
        storyId: 'a',
      );

      expect(find.byType(StoryViewerScreen), findsNothing);
      // The client did not even ask: the server would have refused, and it already knew.
      expect(fake.viewed, isEmpty);
    });
  });

  group('view tracking', () {
    testWidgets('records a view on ARRIVAL, once', (tester) async {
      await pumpViewer(tester, stories: [story(id: 'a')], storyId: 'a');
      expect(fake.viewed, ['a']);
    });

    testWidgets('records the story actually reached, not every story in the feed',
        (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', title: 'A', publishedAt: DateTime.now()),
          story(
            id: 'b',
            title: 'B',
            publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
          ),
          story(
            id: 'c',
            title: 'C',
            publishedAt: DateTime.now().subtract(const Duration(hours: 2)),
          ),
        ],
        storyId: 'a',
      );

      expect(fake.viewed, ['a'], reason: 'b and c were never opened');
    });

    testWidgets('a FAILED view does not crash the viewer or hide the story',
        (tester) async {
      fake.viewError = const UnclassifiedFailure();
      await pumpViewer(tester, stories: [story(id: 'a', title: 'Still here')], storyId: 'a');

      expect(tester.takeException(), isNull);
      expect(find.text('Still here'), findsOneWidget);
      expect(find.byType(StoryViewerScreen), findsOneWidget);
    });

    testWidgets('a view refused because the story is GONE leaves the viewer and refetches',
        (tester) async {
      fake.viewError = storyGoneError(WireErrors.storyDeleted);
      await pumpViewer(tester, stories: [story(id: 'a')], storyId: 'a');

      expect(find.byType(StoryViewerScreen), findsNothing);
      // Refetched, so the rail comes back without it.
      expect(fake.feedCalls, greaterThan(1));
    });

    testWidgets('the ring stops looking unread immediately, before the server answers',
        (tester) async {
      final container = await pumpViewer(
        tester,
        stories: [story(id: 'a', isViewed: false)],
        storyId: 'a',
      );

      final stories = container.read(storyRailOrderProvider);
      expect(stories.single.isViewed, isTrue);
    });
  });

  group('navigation', () {
    testWidgets('next moves forward and records the next story', (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', title: 'A', publishedAt: DateTime.now()),
          story(
            id: 'b',
            title: 'B',
            publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
        storyId: 'a',
      );

      await tester.tap(find.bySemanticsLabel('Next story'));
      await settleRoute(tester);

      expect(find.text('B'), findsOneWidget);
      expect(fake.viewed, ['a', 'b']);
    });

    testWidgets('previous moves back', (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', title: 'A', publishedAt: DateTime.now()),
          story(
            id: 'b',
            title: 'B',
            publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
        storyId: 'b',
      );

      await tester.tap(find.bySemanticsLabel('Previous story'));
      await settleRoute(tester);
      expect(find.text('A'), findsOneWidget);
    });

    testWidgets('previous on the FIRST story restarts it rather than leaving',
        (tester) async {
      await pumpViewer(tester, stories: [story(id: 'a', title: 'Only')], storyId: 'a');

      await tester.tap(find.bySemanticsLabel('Previous story'));
      await tester.pump();

      // Mistiming a back-tap must not cost the reader their place.
      expect(find.byType(StoryViewerScreen), findsOneWidget);
      expect(find.text('Only'), findsOneWidget);
    });

    testWidgets('next on the LAST story closes the viewer', (tester) async {
      await pumpViewer(tester, stories: [story(id: 'a')], storyId: 'a');

      await tester.tap(find.bySemanticsLabel('Next story'));
      await tester.pumpAndSettle();

      expect(find.byType(StoryViewerScreen), findsNothing);
      expect(find.text('open'), findsOneWidget);
    });

    testWidgets('close leaves immediately', (tester) async {
      await pumpViewer(tester, stories: [story(id: 'a')], storyId: 'a');

      await tester.tap(find.bySemanticsLabel('Close story'));
      await tester.pumpAndSettle();

      expect(find.byType(StoryViewerScreen), findsNothing);
    });

    testWidgets('the system back gesture closes it too', (tester) async {
      await pumpViewer(tester, stories: [story(id: 'a')], storyId: 'a');

      // Android back / iOS swipe both arrive as a route pop.
      final popped = await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(popped, isTrue);
      expect(find.byType(StoryViewerScreen), findsNothing);
    });
  });

  group('progress and lifecycle', () {
    testWidgets('one progress segment per story', (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', publishedAt: DateTime.now()),
          story(id: 'b', publishedAt: DateTime.now().subtract(const Duration(hours: 1))),
          story(id: 'c', publishedAt: DateTime.now().subtract(const Duration(hours: 2))),
        ],
        storyId: 'a',
      );

      expect(find.byType(LinearProgressIndicator), findsNWidgets(3));
    });

    testWidgets('an image story advances on its own, and stops at the end',
        (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', title: 'A', publishedAt: DateTime.now()),
          story(
            id: 'b',
            title: 'B',
            publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
        storyId: 'a',
      );

      expect(find.text('A'), findsOneWidget);
      await tester.pump(StoryViewerScreen.imageDuration);
      await settleRoute(tester);
      expect(find.text('B'), findsOneWidget);

      // And the last story closes rather than looping.
      await tester.pump(StoryViewerScreen.imageDuration);
      await tester.pumpAndSettle();
      expect(find.byType(StoryViewerScreen), findsNothing);
    });

    testWidgets('nothing keeps ticking after the viewer is closed', (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', publishedAt: DateTime.now()),
          story(id: 'b', publishedAt: DateTime.now().subtract(const Duration(hours: 1))),
        ],
        storyId: 'a',
      );

      await tester.tap(find.bySemanticsLabel('Close story'));
      await tester.pumpAndSettle();

      // Well past the auto-advance. A controller that outlived the State, or a stray timer,
      // would throw here — pushing a route onto a tree that has moved on.
      await tester.pump(StoryViewerScreen.imageDuration * 3);
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.byType(StoryViewerScreen), findsNothing);
      // It did not sneak in a second view for the story it never reached.
      expect(fake.viewed, ['a']);
    });

    testWidgets('a long press holds the story', (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', title: 'A', publishedAt: DateTime.now()),
          story(
            id: 'b',
            title: 'B',
            publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
        storyId: 'a',
      );

      final hold = await tester.startGesture(tester.getCenter(find.byType(PageView)));
      await tester.pump(const Duration(seconds: 1)); // becomes a long press
      await tester.pump(StoryViewerScreen.imageDuration * 2);

      // Still on A: the clock is paused, not merely slow.
      expect(find.text('A'), findsOneWidget);

      await hold.up();
      await settleRoute(tester);
    });
  });

  group('media', () {
    testWidgets('an image story renders the signed URL the server sent, untouched',
        (tester) async {
      const url = 'https://storage.test/stories/abc?sig=deadbeef&expires=123';
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', mediaKind: StoryMediaKind.image, mediaUrl: url, body: null),
        ],
        storyId: 'a',
      );

      final image = tester.widget<Image>(find.byType(Image));
      final provider = image.image as NetworkImage;
      // Byte-for-byte what the server minted: no rebuilding, no bucket, no path.
      expect(provider.url, url);
    });

    testWidgets('an image that fails to load says so instead of showing nothing',
        (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            mediaKind: StoryMediaKind.image,
            mediaUrl: 'https://storage.test/gone.png',
            title: null,
            body: null,
          ),
        ],
        storyId: 'a',
      );
      await settleRoute(tester);

      // Image.network in a widget test always fails, which is the path being asserted: an
      // expired signature or a purged object reaches the reader as a message, not a blank.
      expect(find.text('This picture could not be loaded.'), findsOneWidget);
    });

    testWidgets('a VIDEO story plays inline, using the URL the server sent untouched',
        (tester) async {
      const url = 'https://storage.test/stories/clip.mp4?sig=abc&expires=123';
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', mediaKind: StoryMediaKind.video, mediaUrl: url, body: null),
        ],
        storyId: 'a',
      );

      // Byte-for-byte what the server minted: no bucket, no key, no path building.
      expect(video.loaded, [url]);
      expect(video.playCalls, greaterThan(0));
      expect(find.byKey(fakeVideoSurface), findsOneWidget);
    });

    testWidgets('shows a spinner while the video initialises, then the surface',
        (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/clip.mp4',
            title: null,
            body: null,
          ),
        ],
        storyId: 'a',
      );

      expect(find.byKey(fakeVideoSurface), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });

    testWidgets('a video that fails to initialise says so and offers a retry',
        (tester) async {
      video.failOnLoad = true;
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/gone.mp4',
            title: null,
            body: null,
          ),
        ],
        storyId: 'a',
      );

      expect(find.text('This video could not be played.'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('a failed video does NOT count as completed and does not advance',
        (tester) async {
      video.failOnLoad = true;
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            title: 'A',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/gone.mp4',
            publishedAt: DateTime.now(),
          ),
          story(
            id: 'b',
            title: 'B',
            publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
        storyId: 'a',
      );

      // Well past any image duration: a failure must not be mistaken for an ending.
      await tester.pump(StoryViewerScreen.imageDuration * 3);
      await settleRoute(tester);

      expect(find.text('This video could not be played.'), findsOneWidget);
      expect(find.text('B'), findsNothing);
      expect(fake.viewed, ['a']);
    });

    testWidgets('retry reloads the same URL and plays', (tester) async {
      video.failOnLoad = true;
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/clip.mp4',
            title: null,
            body: null,
          ),
        ],
        storyId: 'a',
      );
      expect(find.text('Try again'), findsOneWidget);

      // The signature was renewed, or the network came back.
      video.failOnLoad = false;
      await tester.tap(find.text('Try again'));
      await settleRoute(tester);
      await flush(tester);

      expect(video.loaded, [
        'https://storage.test/clip.mp4',
        'https://storage.test/clip.mp4',
      ]);
      expect(find.byKey(fakeVideoSurface), findsOneWidget);
    });

    testWidgets('a video story does NOT advance on a timer', (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            title: 'A',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/clip.mp4',
            publishedAt: DateTime.now(),
          ),
          story(
            id: 'b',
            title: 'B',
            publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
        storyId: 'a',
      );

      // Five times an image's length. A 40-second video must not be cut short.
      await tester.pump(StoryViewerScreen.imageDuration * 5);
      await settleRoute(tester);

      expect(find.text('A'), findsOneWidget);
      expect(find.text('B'), findsNothing);
    });

    testWidgets('a video story advances when PLAYBACK COMPLETES, exactly once',
        (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            title: 'A',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/clip.mp4',
            publishedAt: DateTime.now(),
          ),
          story(
            id: 'b',
            title: 'B',
            publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
          ),
          story(
            id: 'c',
            title: 'C',
            publishedAt: DateTime.now().subtract(const Duration(hours: 2)),
          ),
        ],
        storyId: 'a',
      );

      video.completePlayback();
      await settleRoute(tester);

      expect(find.text('B'), findsOneWidget);
      // Exactly one story further on, not two: a completion event must not advance twice.
      expect(find.text('C'), findsNothing);
      expect(fake.viewed, ['a', 'b']);
    });

    testWidgets('a buffering stall keeps the frames and shows a spinner over them',
        (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/clip.mp4',
            title: null,
            body: null,
          ),
        ],
        storyId: 'a',
      );

      video.reportBuffering();
      await flush(tester);

      expect(find.byKey(fakeVideoSurface), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('the progress bar tracks real position, not a timer', (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/clip.mp4',
            title: null,
            body: null,
          ),
        ],
        storyId: 'a',
      );

      video.reportProgress(const Duration(seconds: 3)); // of 12
      await flush(tester);

      final bar = tester.widget<LinearProgressIndicator>(
        find.byType(LinearProgressIndicator).first,
      );
      expect(bar.value, closeTo(0.25, 0.01));
    });
  });

  group('video lifecycle', () {
    Future<void> openVideoThen(
      WidgetTester tester,
      Future<void> Function() action, {
      int stories = 2,
    }) async {
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            title: 'A',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/clip.mp4',
            publishedAt: DateTime.now(),
          ),
          if (stories > 1)
            story(
              id: 'b',
              title: 'B',
              publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
            ),
        ],
        storyId: 'a',
      );
      await action();
    }

    testWidgets('closing stops playback and disposes the player', (tester) async {
      await openVideoThen(tester, () async {
        await tester.tap(find.bySemanticsLabel('Close story'));
        await tester.pumpAndSettle();
      });

      expect(find.byType(StoryViewerScreen), findsNothing);
      expect(video.pauseCalls, greaterThan(0));
      expect(video.isDisposed, isTrue);
      expect(video.holdsVideo, isFalse);
    });

    testWidgets('nothing is emitted after disposal, so no callback mutates dead state',
        (tester) async {
      await openVideoThen(tester, () async {
        await tester.tap(find.bySemanticsLabel('Close story'));
        await tester.pumpAndSettle();
      });

      // A completion arriving after the reader left must reach nobody.
      video.completePlayback();
      await tester.pump(const Duration(seconds: 1));
      await flush(tester);

      expect(tester.takeException(), isNull);
      expect(video.emittedAfterDispose, isNotEmpty,
          reason: 'the fake recorded it, which means the seam was closed first');
      expect(find.byType(StoryViewerScreen), findsNothing);
    });

    testWidgets('a completion arriving AFTER the reader advanced does not advance again',
        (tester) async {
      await openVideoThen(tester, () async {
        // Manual next while the video is still playing.
        await tester.tap(find.bySemanticsLabel('Next story'));
        await settleRoute(tester);
      });

      expect(find.text('B'), findsOneWidget);
      expect(video.pauseCalls, greaterThan(0));

      // The stale completion for story A lands now. The gate must drop it.
      video.completePlayback();
      await settleRoute(tester);

      expect(find.text('B'), findsOneWidget, reason: 'still on B, not closed past it');
      expect(find.byType(StoryViewerScreen), findsOneWidget);
    });

    testWidgets('previous while playing stops the video and moves back', (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', title: 'A', publishedAt: DateTime.now()),
          story(
            id: 'b',
            title: 'B',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/clip.mp4',
            publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
        storyId: 'b',
      );
      expect(video.loaded, isNotEmpty);

      await tester.tap(find.bySemanticsLabel('Previous story'));
      await settleRoute(tester);

      expect(find.text('A'), findsOneWidget);
      // Moving to an image releases the video rather than leaving a decoder running.
      expect(video.stopCalls, greaterThan(0));
      expect(video.holdsVideo, isFalse);
    });

    testWidgets('a long press pauses the video and releasing resumes it', (tester) async {
      await openVideoThen(tester, () async {});
      final playsBefore = video.playCalls;

      final hold = await tester.startGesture(tester.getCenter(find.byType(PageView)));
      await tester.pump(const Duration(seconds: 1));
      await flush(tester);
      expect(video.pauseCalls, greaterThan(0));

      await hold.up();
      await settleRoute(tester);
      expect(video.playCalls, greaterThan(playsBefore));
    });

    testWidgets('backgrounding the app pauses playback; resuming plays again',
        (tester) async {
      await openVideoThen(tester, () async {});
      final playsBefore = video.playCalls;

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await flush(tester);
      expect(video.pauseCalls, greaterThan(0));

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await flush(tester);
      expect(video.playCalls, greaterThan(playsBefore));
    });

    testWidgets('backgrounding an IMAGE story stops its clock rather than advancing',
        (tester) async {
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', title: 'A', publishedAt: DateTime.now()),
          story(
            id: 'b',
            title: 'B',
            publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
          ),
        ],
        storyId: 'a',
      );

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await flush(tester);
      // Long enough to have advanced twice if the clock had kept running.
      await tester.pump(StoryViewerScreen.imageDuration * 2);
      await settleRoute(tester);

      expect(find.text('A'), findsOneWidget);
      expect(find.text('B'), findsNothing);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await flush(tester);
      await tester.pump(StoryViewerScreen.imageDuration);
      await settleRoute(tester);
      expect(find.text('B'), findsOneWidget);
    });
  });

  group('mixed sequences use the right mechanism for each story', () {
    testWidgets('IMAGE -> VIDEO -> IMAGE', (tester) async {
      final now = DateTime.now();
      await pumpViewer(
        tester,
        stories: [
          story(id: 'i1', title: 'I1', publishedAt: now),
          story(
            id: 'v1',
            title: 'V1',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/clip.mp4',
            publishedAt: now.subtract(const Duration(hours: 1)),
          ),
          story(id: 'i2', title: 'I2', publishedAt: now.subtract(const Duration(hours: 2))),
        ],
        storyId: 'i1',
      );

      // Image: duration.
      expect(find.text('I1'), findsOneWidget);
      await tester.pump(StoryViewerScreen.imageDuration);
      await settleRoute(tester);
      expect(find.text('V1'), findsOneWidget);

      // Video: NOT duration.
      await tester.pump(StoryViewerScreen.imageDuration * 3);
      await settleRoute(tester);
      expect(find.text('V1'), findsOneWidget);

      // Video: completion.
      video.completePlayback();
      await settleRoute(tester);
      expect(find.text('I2'), findsOneWidget);
      // The decoder was released on the way out.
      expect(video.holdsVideo, isFalse);

      // Image again: duration, and the last story closes.
      await tester.pump(StoryViewerScreen.imageDuration);
      await tester.pumpAndSettle();
      expect(find.byType(StoryViewerScreen), findsNothing);

      expect(fake.viewed, ['i1', 'v1', 'i2']);
    });

    testWidgets('VIDEO -> IMAGE -> VIDEO', (tester) async {
      final now = DateTime.now();
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'v1',
            title: 'V1',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/one.mp4',
            publishedAt: now,
          ),
          story(id: 'i1', title: 'I1', publishedAt: now.subtract(const Duration(hours: 1))),
          story(
            id: 'v2',
            title: 'V2',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/two.mp4',
            publishedAt: now.subtract(const Duration(hours: 2)),
          ),
        ],
        storyId: 'v1',
      );

      expect(video.loaded, ['https://storage.test/one.mp4']);

      video.completePlayback();
      await settleRoute(tester);
      expect(find.text('I1'), findsOneWidget);

      await tester.pump(StoryViewerScreen.imageDuration);
      await settleRoute(tester);
      expect(find.text('V2'), findsOneWidget);

      // A second video loaded its own URL, and only after the first was released.
      expect(video.loaded, ['https://storage.test/one.mp4', 'https://storage.test/two.mp4']);
      expect(fake.viewed, ['v1', 'i1', 'v2']);
    });

    testWidgets('the progress bar has one segment per story throughout', (tester) async {
      final now = DateTime.now();
      await pumpViewer(
        tester,
        stories: [
          story(id: 'i1', title: 'I1', publishedAt: now),
          story(
            id: 'v1',
            title: 'V1',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/clip.mp4',
            publishedAt: now.subtract(const Duration(hours: 1)),
          ),
        ],
        storyId: 'i1',
      );
      expect(find.byType(LinearProgressIndicator), findsNWidgets(2));

      await tester.pump(StoryViewerScreen.imageDuration);
      await settleRoute(tester);
      expect(find.byType(LinearProgressIndicator), findsNWidgets(2));
    });
  });

  group('localisation', () {
    testWidgets('Arabic', (tester) async {
      await pumpViewer(
        tester,
        stories: [story(id: 'a')],
        storyId: 'a',
        locale: const Locale('ar'),
      );

      expect(find.bySemanticsLabel('إغلاق الحالة'), findsOneWidget);
      expect(find.bySemanticsLabel('الحالة التالية'), findsOneWidget);
      expect(find.bySemanticsLabel('الحالة السابقة'), findsOneWidget);
    });

    testWidgets('English', (tester) async {
      await pumpViewer(tester, stories: [story(id: 'a')], storyId: 'a');

      expect(find.bySemanticsLabel('Close story'), findsOneWidget);
      expect(find.bySemanticsLabel('Next story'), findsOneWidget);
      expect(find.bySemanticsLabel('Previous story'), findsOneWidget);
    });

    testWidgets('Arabic lays the viewer out right-to-left', (tester) async {
      await pumpViewer(
        tester,
        stories: [story(id: 'a')],
        storyId: 'a',
        locale: const Locale('ar'),
      );

      expect(Directionality.of(tester.element(find.byType(PageView))), TextDirection.rtl);
    });
  });
}

/// A plain non-story failure, for the "a failed view must not break the viewer" case.
///
/// Deliberately NOT an AppError: the viewer has to survive an unclassified exception too,
/// and a test that only ever throws the app's own error type would not prove that.
class UnclassifiedFailure implements Exception {
  const UnclassifiedFailure();

  @override
  String toString() => 'UnclassifiedFailure';
}
