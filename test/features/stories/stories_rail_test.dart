import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/stories/application/stories_controller.dart';
import 'package:jawwid_chat/features/stories/presentation/stories_rail.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/story.dart';

import 'fake_story_repository.dart';

/// The stories rail.
///
/// The rail's whole job is to be honest about how much there is to see, so most of these
/// tests are about it NOT appearing. A rail that renders a row of grey circles when the
/// academy has published nothing costs 106dp of the most valuable space on the screen to
/// say "nothing here".
void main() {
  Widget harness({
    required List<Override> overrides,
    Locale locale = const Locale('ar'),
    void Function(Story story)? onOpenStory,
  }) {
    return ProviderScope(
      retry: JawwidRetryPolicy.policy,
      overrides: overrides,
      child: MaterialApp(
        locale: locale,
        theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Scaffold(body: StoriesRail(onOpenStory: onOpenStory)),
      ),
    );
  }

  Override repo(FakeStoryRepository fake) =>
      storyRepositoryProvider.overrideWithValue(fake);

  group('the rail appears only when there is something to show', () {
    testWidgets('no stories: renders nothing and takes no height', (tester) async {
      await tester.pumpWidget(harness(overrides: [repo(FakeStoryRepository())]));
      await tester.pumpAndSettle();

      expect(find.byType(SizedBox), findsWidgets);
      expect(
        tester.getSize(find.byType(StoriesRail)).height,
        0,
        reason: 'an empty rail must cost no vertical space',
      );
    });

    testWidgets('while LOADING: nothing, not a skeleton', (tester) async {
      await tester.pumpWidget(
        harness(
          overrides: [
            repo(FakeStoryRepository(
              stories: [story()],
              feedDelay: const Duration(milliseconds: 50),
            )),
          ],
        ),
      );
      // One frame only — the feed is still in flight.
      await tester.pump();

      expect(tester.getSize(find.byType(StoriesRail)).height, 0);
      expect(find.byType(CircularProgressIndicator), findsNothing);

      await tester.pumpAndSettle();
      // And it does appear once the answer lands, so the zero height above was the loading
      // frame and not a broken rail.
      expect(tester.getSize(find.byType(StoriesRail)).height, StoriesRail.railHeight);
    });

    testWidgets('a FAILED feed: nothing, and no error band above the chat list',
        (tester) async {
      await tester.pumpWidget(
        harness(
          overrides: [
            repo(FakeStoryRepository(feedError: const AppError(AppErrorKind.network))),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.getSize(find.byType(StoriesRail)).height, 0);
      // Stories are secondary. A failure here must never shout over the messages.
      expect(find.byType(ErrorWidget), findsNothing);
    });

    testWidgets('NO repository registered: nothing, and no thrown error', (tester) async {
      await tester.pumpWidget(harness(overrides: const []));
      await tester.pumpAndSettle();

      expect(tester.getSize(find.byType(StoriesRail)).height, 0);
      expect(tester.takeException(), isNull);
    });

    testWidgets('stories present: the rail renders at its full height', (tester) async {
      await tester.pumpWidget(
        harness(overrides: [repo(FakeStoryRepository(stories: [story()]))]),
      );
      await tester.pumpAndSettle();

      expect(tester.getSize(find.byType(StoriesRail)).height, StoriesRail.railHeight);
    });
  });

  group('ordering and read state', () {
    testWidgets('unviewed first, then newest', (tester) async {
      final now = DateTime.now();
      await tester.pumpWidget(
        harness(
          overrides: [
            repo(FakeStoryRepository(stories: [
              // Deliberately the NEWEST story of all, and viewed: it must still sort behind
              // every unviewed one. Unviewed-first outranks newest-first.
              story(
                id: 'viewed-new',
                title: 'C',
                isViewed: true,
                publishedAt: now,
              ),
              story(
                id: 'unviewed-old',
                title: 'B',
                publishedAt: now.subtract(const Duration(hours: 5)),
              ),
              story(
                id: 'unviewed-new',
                title: 'A',
                publishedAt: now.subtract(const Duration(minutes: 1)),
              ),
              story(
                id: 'viewed-old',
                title: 'D',
                isViewed: true,
                publishedAt: now.subtract(const Duration(hours: 9)),
              ),
            ])),
          ],
        ),
      );
      await tester.pumpAndSettle();

      // Only the ring labels. The avatar initials are Text too, and interleaved; filtering
      // to the titles keeps the tree order, which is what is being asserted.
      // A = unviewed newest, B = unviewed oldest, C = viewed newest, D = viewed oldest.
      const titles = {'A', 'B', 'C', 'D'};
      final labels = tester
          .widgetList<Text>(find.byType(Text))
          .map((t) => t.data)
          .whereType<String>()
          .where(titles.contains)
          .toList();
      expect(labels, ['A', 'B', 'C', 'D']);
    });

    testWidgets('viewed state reaches a screen reader as WORDS, not just a ring colour',
        (tester) async {
      await tester.pumpWidget(
        harness(
          locale: const Locale('en'),
          overrides: [
            repo(FakeStoryRepository(stories: [
              story(id: 'a', title: 'Fresh', publishedAt: DateTime.now()),
              story(
                id: 'b',
                title: 'Seen',
                isViewed: true,
                publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
              ),
            ])),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.bySemanticsLabel('Unviewed story: Fresh'), findsOneWidget);
      expect(find.bySemanticsLabel('Viewed story: Seen'), findsOneWidget);
    });

    testWidgets('a story with no title falls back to the academy name', (tester) async {
      await tester.pumpWidget(
        harness(
          locale: const Locale('en'),
          overrides: [
            repo(FakeStoryRepository(stories: [story(id: 'a', title: null)])),
          ],
        ),
      );
      await tester.pumpAndSettle();

      // Not an empty label, and not an invented author: the publisher IS the academy.
      expect(find.text('Jawwid'), findsOneWidget);
    });
  });

  group('there is no publishing affordance anywhere', () {
    testWidgets('no "your story" entry, no add button', (tester) async {
      await tester.pumpWidget(
        harness(overrides: [repo(FakeStoryRepository(stories: [story()]))]),
      );
      await tester.pumpAndSettle();

      // This client authenticates only as parent or teacher and can never publish. A
      // composer entry would be a control that exists only to fail.
      for (final icon in [Icons.add, Icons.add_a_photo, Icons.camera_alt, Icons.edit]) {
        expect(find.byIcon(icon), findsNothing, reason: '$icon must not appear');
      }
      expect(find.byType(FloatingActionButton), findsNothing);
    });
  });

  group('tapping a ring', () {
    testWidgets('reports the story that was tapped', (tester) async {
      final tapped = <String>[];
      await tester.pumpWidget(
        harness(
          locale: const Locale('en'),
          overrides: [
            repo(FakeStoryRepository(stories: [
              story(id: 'first', title: 'First', publishedAt: DateTime.now()),
              story(
                id: 'second',
                title: 'Second',
                publishedAt: DateTime.now().subtract(const Duration(hours: 1)),
              ),
            ])),
          ],
          onOpenStory: (s) => tapped.add(s.id),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Second'));
      await tester.pumpAndSettle();
      expect(tapped, ['second']);
    });

    testWidgets('opening a ring does NOT record a view on its own', (tester) async {
      // The rail showing a story is not the reader having opened it. The view belongs to the
      // viewer arriving on the story, not to a tap on a ring — and certainly not to the feed
      // loading.
      final fake = FakeStoryRepository(stories: [story(id: 'a')]);
      await tester.pumpWidget(
        harness(overrides: [repo(fake)], onOpenStory: (_) {}),
      );
      await tester.pumpAndSettle();
      expect(fake.viewed, isEmpty);

      await tester.tap(find.byType(InkWell).first);
      await tester.pumpAndSettle();
      expect(fake.viewed, isEmpty);
    });
  });

  group('refresh', () {
    testWidgets('refetches, and the rail reflects the new answer', (tester) async {
      final fake = FakeStoryRepository(stories: [story(id: 'a', title: 'Before')]);
      late ProviderContainer container;

      await tester.pumpWidget(
        ProviderScope(
          retry: JawwidRetryPolicy.policy,
          overrides: [repo(fake)],
          child: Consumer(
            builder: (context, ref, _) {
              container = ProviderScope.containerOf(context);
              return MaterialApp(
                locale: const Locale('en'),
                theme: JawwidTheme.light(isArabic: false),
                supportedLocales: JawwidApp.supportedLocales,
                localizationsDelegates: const [
                  L10n.delegate,
                  GlobalMaterialLocalizations.delegate,
                  GlobalWidgetsLocalizations.delegate,
                  GlobalCupertinoLocalizations.delegate,
                ],
                home: const Scaffold(body: StoriesRail()),
              );
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Before'), findsOneWidget);
      expect(fake.feedCalls, 1);

      // The academy published something else and pulled the first one.
      fake.setStories([story(id: 'b', title: 'After')]);
      await container.read(storiesControllerProvider.notifier).refresh();
      await tester.pumpAndSettle();

      expect(fake.feedCalls, 2);
      expect(find.text('Before'), findsNothing);
      expect(find.text('After'), findsOneWidget);
    });

    testWidgets('a refresh that finds nothing collapses the rail again', (tester) async {
      final fake = FakeStoryRepository(stories: [story(id: 'a')]);
      late ProviderContainer container;

      await tester.pumpWidget(
        ProviderScope(
          retry: JawwidRetryPolicy.policy,
          overrides: [repo(fake)],
          child: Consumer(
            builder: (context, ref, _) {
              container = ProviderScope.containerOf(context);
              return MaterialApp(
                theme: JawwidTheme.light(isArabic: true),
                supportedLocales: JawwidApp.supportedLocales,
                localizationsDelegates: const [
                  L10n.delegate,
                  GlobalMaterialLocalizations.delegate,
                  GlobalWidgetsLocalizations.delegate,
                  GlobalCupertinoLocalizations.delegate,
                ],
                home: const Scaffold(body: StoriesRail()),
              );
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.getSize(find.byType(StoriesRail)).height, StoriesRail.railHeight);

      fake.setStories(const []);
      await container.read(storiesControllerProvider.notifier).refresh();
      await tester.pumpAndSettle();

      expect(tester.getSize(find.byType(StoriesRail)).height, 0);
    });
  });
}
