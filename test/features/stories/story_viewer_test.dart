import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/media/attachment_opener.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/stories/application/stories_controller.dart';
import 'package:jawwid_chat/features/stories/presentation/story_viewer_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/story.dart';

import 'fake_story_repository.dart';

/// Records what it was asked to open, and whether it could.
class _RecordingOpener implements AttachmentOpener {
  _RecordingOpener({this.succeeds = true});

  final bool succeeds;
  final List<String> opened = [];

  @override
  Future<bool> open(String url) async {
    opened.add(url);
    return succeeds;
  }
}

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
  late _RecordingOpener opener;

  setUp(() {
    fake = FakeStoryRepository();
    opener = _RecordingOpener();
  });

  /// Advance past a route or page transition without completing the auto-advance animation.
  ///
  /// Three stepped frames, not one big jump. A single `pump(400ms)` completes the page
  /// animation but leaves the `setState` that `onPageChanged` schedules unpumped, so the new
  /// page is never built and the assertion looks for text that is one frame away.
  Future<void> settleRoute(WidgetTester tester) async {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));
    await tester.pump(const Duration(milliseconds: 250));
  }

  /// Pump the viewer inside a real Navigator, so `maybePop` has somewhere to go and closing
  /// can be observed rather than inferred.
  Future<ProviderContainer> pumpViewer(
    WidgetTester tester, {
    required List<Story> stories,
    required String storyId,
    Locale locale = const Locale('en'),
    AttachmentOpener? attachmentOpener,
  }) async {
    fake.setStories(stories);
    late ProviderContainer container;

    await tester.pumpWidget(
      ProviderScope(
        retry: JawwidRetryPolicy.policy,
        overrides: [
          storyRepositoryProvider.overrideWithValue(fake),
          attachmentOpenerProvider.overrideWithValue(attachmentOpener ?? opener),
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
            attachmentOpenerProvider.overrideWithValue(opener),
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

    testWidgets('a VIDEO story offers to open it, through the existing opener seam',
        (tester) async {
      const url = 'https://storage.test/stories/clip.mp4?sig=abc';
      await pumpViewer(
        tester,
        stories: [
          story(id: 'a', mediaKind: StoryMediaKind.video, mediaUrl: url, body: null),
        ],
        storyId: 'a',
      );

      expect(find.text('This story is a video.'), findsOneWidget);
      await tester.tap(find.text('Open video'));
      await settleRoute(tester);

      // The same seam attachments already use — no new media architecture, and the URL is
      // passed through exactly as received.
      expect(opener.opened, [url]);
    });

    testWidgets('a video the device cannot open says so rather than doing nothing',
        (tester) async {
      final failing = _RecordingOpener(succeeds: false);
      await pumpViewer(
        tester,
        stories: [
          story(
            id: 'a',
            mediaKind: StoryMediaKind.video,
            mediaUrl: 'https://storage.test/clip.mp4',
            body: null,
          ),
        ],
        storyId: 'a',
        attachmentOpener: failing,
      );

      await tester.tap(find.text('Open video'));
      await settleRoute(tester);

      expect(find.text('Nothing on this device can open it.'), findsOneWidget);
    });

    testWidgets('a video story does NOT auto-advance', (tester) async {
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

      await tester.pump(StoryViewerScreen.imageDuration * 2);
      await settleRoute(tester);

      // Advancing past a video the reader is about to open would be worse than waiting.
      expect(find.text('A'), findsOneWidget);
      expect(find.text('B'), findsNothing);
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
