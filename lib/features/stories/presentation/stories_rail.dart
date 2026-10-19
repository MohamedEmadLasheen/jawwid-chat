import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/story.dart';
import '../application/stories_controller.dart';
import 'story_backgrounds.dart';

/// The horizontally scrolling stories rail, above the conversation list.
///
/// ## Three outcomes on screen, not two
///
/// This used to render nothing whenever it had no stories, on the argument that 106dp of the
/// most valuable space on the screen is too much to spend saying "nothing here". That
/// argument was right about the space and wrong about the silence: because every publication
/// expires after 24 hours, the whole feature vanished from the app a day after each story —
/// for every reader at once — and was reported, twice, as Stories having been deleted.
///
/// So an answer of "none" now says so, in a strip shorter than the rail:
///
///   * **stories**     — the rings, at [railHeight].
///   * **empty**       — a quiet line at [emptyHeight], roughly half the space. Still cheap,
///                       and the feature stays visibly part of the app between publications.
///   * **hidden**      — absent, exactly as before, for loading / no-backend / failed. See
///                       [StoryRailDisplay]: those are the cases where an absence has not
///                       been established, and announcing one would be a guess.
///
/// It is NOT a row of grey circles, which the original design rejected and which would read
/// as fabricated stories. There is no placeholder ring, because a ring means a story.
///
/// Retry is the screen's existing pull-to-refresh, which refreshes conversations and stories
/// together. The rail deliberately has no refresh control of its own.
///
/// ## One ring per story, not per author
///
/// The feed carries no author, on purpose: a reader has no business learning which member of
/// staff wrote an academy publication. Every story a reader sees is from the academy, so
/// grouping by publisher would produce exactly one ring and throw away the per-story
/// unviewed state the contract does give us. Each ring is therefore one story.
///
/// ## A ring shows the story, and nothing under it (owner decision, 2026-10-17)
///
/// Like WhatsApp: inside the ring is a preview of the story itself -- the photo for a photo
/// story, the background and opening words for a text story, the background with a mic or a
/// play mark for voice and video -- never an initial. There is no caption under the ring:
/// every ring would have said "Jawwid". The academy's name still reaches a screen reader, in
/// the ring's semantic label with its viewed state.
///
/// There is no "Your story" entry. This client authenticates only as `parent` or `teacher`
/// and can never publish, so an entry that opened a composer would be a control that exists
/// only to fail.
class StoriesRail extends ConsumerWidget {
  const StoriesRail({super.key, this.onOpenStory});

  /// Overridable so widget tests can observe navigation without a router.
  final void Function(Story story)? onOpenStory;

  /// The ring plus the row's own padding. No label row since 2026-10-17.
  static const railHeight = 94.0;

  /// The story preview inside a ring.
  static const thumbSize = 64.0;

  /// Two short lines of text and the same vertical padding. Deliberately well under
  /// [railHeight]: an absence should cost less room than the thing it stands in for.
  ///
  /// Large enough that the two lines fit in BOTH languages — Arabic needs more leading than
  /// Latin and measures ~69 here — so this minimum, and not the text, is what decides the
  /// height at ordinary text sizes. That keeps the strip the same size in Arabic and English.
  static const emptyHeight = 72.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final display = ref.watch(storyRailDisplayProvider);
    if (display == StoryRailDisplay.hidden) return const SizedBox.shrink();
    if (display == StoryRailDisplay.empty) return const _EmptyRail();

    final stories = ref.watch(storyRailOrderProvider);
    // Defensive: `stories` is the only state in which the list is non-empty, but the two
    // providers are read separately and a future edit should not be able to produce a rail
    // of zero rings with a border under it.
    if (stories.isEmpty) return const SizedBox.shrink();

    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return Container(
      height: railHeight,
      decoration: BoxDecoration(
        color: tokens.colorSurfaceDefault,
        border: Border(bottom: BorderSide(color: tokens.colorBorderSubtle)),
      ),
      // A horizontal ListView takes its scroll direction from the ambient Directionality, so
      // this starts at the right in Arabic without any mirroring code.
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.spacing4,
          vertical: Spacing.spacing3,
        ),
        itemCount: stories.length,
        itemBuilder: (context, index) => _StoryEntry(
          // Rings all carry the academy's name now that a story has no title, so the key is
          // what tells them apart -- for tests, and for Flutter's element reuse on reorder.
          key: ValueKey('story-ring-${stories[index].id}'),
          story: stories[index],
          publisherName: l10n.appName,
          onTap: () => onOpenStory?.call(stories[index]),
        ),
      ),
    );
  }
}

/// The Stories area, present and honestly empty.
///
/// Same surface and bottom border as the rail, so it reads as the same region of the screen
/// rather than as a new component. Laid out with a leading icon and text, which the ambient
/// [Directionality] mirrors for Arabic without any code of its own — the same way the rail's
/// horizontal list does.
class _EmptyRail extends StatelessWidget {
  const _EmptyRail();

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return Container(
      // A MINIMUM, not a fixed height. The two lines fit inside it at every ordinary text
      // size, so the strip measures exactly [StoriesRail.emptyHeight] in practice — but a
      // parent running the large system fonts this audience often does would otherwise
      // overflow it, and clipping the explanation is worse than growing by a few pixels.
      constraints: const BoxConstraints(minHeight: StoriesRail.emptyHeight),
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing4,
        vertical: Spacing.spacing3,
      ),
      decoration: BoxDecoration(
        color: tokens.colorSurfaceDefault,
        border: Border(bottom: BorderSide(color: tokens.colorBorderSubtle)),
      ),
      // One node for the screen reader rather than two stray strings, and `header` so it is
      // navigable as the region it is.
      child: Semantics(
        header: true,
        label: '${l10n.storiesEmpty}. ${l10n.storiesEmptyBody}',
        child: ExcludeSemantics(
          child: Row(
            children: [
              Icon(
                Icons.amp_stories_outlined,
                color: theme.colorScheme.onSurfaceVariant,
              ),
              const SizedBox(width: Spacing.spacing3),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.storiesEmpty,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      l10n.storiesEmptyBody,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StoryEntry extends StatelessWidget {
  const _StoryEntry({
    super.key,
    required this.story,
    required this.publisherName,
    this.onTap,
  });

  final Story story;
  final String publisherName;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    // A story has no title (2026-10-17); every ring is the academy's.
    final label = publisherName;

    // Viewed state reaches a screen reader as WORDS. The ring colour alone would be the only
    // indication for a sighted user and no indication at all for anyone else.
    final semanticLabel = story.isViewed
        ? l10n.storyRingViewed(label)
        : l10n.storyRingUnviewed(label);

    return Semantics(
      button: true,
      label: semanticLabel,
      child: ExcludeSemantics(
        child: Padding(
          padding: const EdgeInsetsDirectional.only(end: Spacing.spacing3),
          child: InkWell(
            onTap: onTap,
            customBorder: const CircleBorder(),
            child: Center(
              child: _AvatarRing(
                viewed: story.isViewed,
                child: _StoryThumb(story: story, size: StoriesRail.thumbSize),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A preview of the story, the way WhatsApp fills a status ring.
class _StoryThumb extends StatelessWidget {
  const _StoryThumb({required this.story, required this.size});

  final Story story;
  final double size;

  @override
  Widget build(BuildContext context) {
    Widget onBackground(Widget child, {String? background}) => DecoratedBox(
          decoration: BoxDecoration(gradient: storyBackground(background ?? story.background)),
          child: Center(child: child),
        );
    Widget mark(IconData icon, {String? background}) => onBackground(
          Icon(icon, size: size * 0.4, color: StoryPalette.onStory),
          background: background,
        );

    final Widget content = switch (story.kind) {
      StoryKind.image when story.mediaUrl != null => Image.network(
          story.mediaUrl!,
          fit: BoxFit.cover,
          // A lapsed signature or a purged picture: still a ring, never a broken box.
          errorBuilder: (_, _, _) => mark(Icons.image_outlined, background: 'ink'),
        ),
      StoryKind.image => mark(Icons.image_outlined, background: 'ink'),
      StoryKind.video => mark(Icons.play_arrow_rounded, background: 'ink'),
      StoryKind.voice => mark(Icons.mic_rounded),
      StoryKind.text => onBackground(
          Padding(
            padding: EdgeInsets.all(size * 0.14),
            child: Text(
              story.body ?? '',
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: StoryPalette.onStory,
                    fontSize: 8,
                    height: 1.2,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
        ),
    };

    return ClipOval(child: SizedBox.square(dimension: size, child: content));
  }
}

/// The ring itself: brand colour while unviewed, a muted border once seen.
class _AvatarRing extends StatelessWidget {
  const _AvatarRing({required this.viewed, required this.child});

  final bool viewed;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);

    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: viewed ? tokens.colorBorderDefault : tokens.colorBrandPrimary,
          width: viewed ? 1.5 : 2.5,
        ),
      ),
      child: child,
    );
  }
}
