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
          locale: const Locale('en'),
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

      // Read from the SEMANTIC labels, not from visible text: the rail shows
      // rings and no captions, so the title exists on screen only for a screen
      // reader. That is the point of the change, and it is also what keeps this
      // assertion possible -- the order is still observable, just not by
      // sighted means.
      // A = unviewed newest, B = unviewed oldest, C = viewed newest, D = viewed oldest.
      final order = tester
          .widgetList<Semantics>(find.byType(Semantics))
          .map((w) => w.properties.label)
          .whereType<String>()
          .where((l) => l.endsWith(' story: A') ||
              l.endsWith(' story: B') ||
              l.endsWith(' story: C') ||
              l.endsWith(' story: D'))
          .map((l) => l.characters.last)
          .toList();
      expect(order, ['A', 'B', 'C', 'D']);
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

      // Not an empty label, and not an invented author: the publisher IS the
      // academy. Asserted on the semantic label, because the rail no longer
      // prints a caption for anyone to read.
      expect(find.bySemanticsLabel('Unviewed story: Jawwid'), findsOneWidget);
    });
  });

  group('the rail is rings and nothing else', () {
    testWidgets('prints no caption under a circle, however long the title',
        (tester) async {
      const longTitle =
          'A deliberately long academy announcement that would be ellipsised into '
          'uselessness under a 76dp circle';

      await tester.pumpWidget(
        harness(
          locale: const Locale('en'),
          overrides: [
            repo(FakeStoryRepository(stories: [
              story(id: 'a', title: longTitle),
              story(id: 'b', title: 'Short'),
            ])),
          ],
        ),
      );
      await tester.pumpAndSettle();

      // Every Text still on screen belongs to an AVATAR INITIAL. A caption --
      // the title, a truncation of it, or any replacement label -- is what this
      // forbids, so the assertion is on what is rendered rather than on the
      // absence of one particular string.
      final rendered = tester
          .widgetList<Text>(find.descendant(
            of: find.byType(StoriesRail),
            matching: find.byType(Text),
          ))
          .map((t) => t.data ?? '')
          .where((t) => t.isNotEmpty)
          .toList();

      for (final text in rendered) {
        expect(text.length, lessThanOrEqualTo(2),
            reason: 'only an avatar initial may be drawn in the rail, found: $text');
      }
      expect(find.textContaining('academy announcement'), findsNothing);
      expect(find.text('Short'), findsNothing);
    });

    testWidgets('prints no caption in Arabic either', (tester) async {
      await tester.pumpWidget(
        harness(
          locale: const Locale('ar'),
          overrides: [
            repo(FakeStoryRepository(stories: [
              story(id: 'a', title: 'إجازة نهاية الأسبوع'),
            ])),
          ],
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('إجازة نهاية الأسبوع'), findsNothing);
      expect(find.textContaining('إجازة'), findsNothing);
    });

    testWidgets('keeps the ring, its seen state and the screen-reader title',
        (tester) async {
      // Removing the caption is a VISUAL decision. It must not take the title
      // away from someone who cannot see the ring, and it must not take the
      // seen state away from anyone.
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
      expect(find.byType(StoriesRail), findsOneWidget);
    });

    testWidgets('still scrolls horizontally with many stories', (tester) async {
      await tester.pumpWidget(
        harness(
          locale: const Locale('en'),
          overrides: [
            repo(FakeStoryRepository(stories: [
              for (var i = 0; i < 12; i += 1)
                story(
                  id: 's$i',
                  title: 'Story $i',
                  publishedAt: DateTime.now().subtract(Duration(minutes: i)),
                ),
            ])),
          ],
        ),
      );
      await tester.pumpAndSettle();

      final rail = find.descendant(
        of: find.byType(StoriesRail),
        matching: find.byType(Scrollable),
      );
      expect(rail, findsOneWidget);

      await tester.drag(rail, const Offset(-300, 0));
      await tester.pumpAndSettle();

      // Nothing appeared under a circle as a result of scrolling either.
      expect(find.textContaining('Story '), findsNothing);
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

      await tester.tap(find.bySemanticsLabel('Unviewed story: Second'));
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
      expect(find.bySemanticsLabel('Unviewed story: Before'), findsOneWidget);
      expect(fake.feedCalls, 1);

      // The academy published something else and pulled the first one.
      fake.setStories([story(id: 'b', title: 'After')]);
      await container.read(storiesControllerProvider.notifier).refresh();
      await tester.pumpAndSettle();

      expect(fake.feedCalls, 2);
      expect(find.bySemanticsLabel('Unviewed story: Before'), findsNothing);
      expect(find.bySemanticsLabel('Unviewed story: After'), findsOneWidget);
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
