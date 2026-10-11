import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/story.dart';
import '../application/stories_controller.dart';

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
/// unviewed state the contract does give us. Each ring is therefore one story, labelled with
/// its own title, and the avatar carries the academy's initial.
///
/// There is no "Your story" entry. This client authenticates only as `parent` or `teacher`
/// and can never publish, so an entry that opened a composer would be a control that exists
/// only to fail.
class StoriesRail extends ConsumerWidget {
  const StoriesRail({super.key, this.onOpenStory});

  /// Overridable so widget tests can observe navigation without a router.
  final void Function(Story story)? onOpenStory;

  /// Avatar + ring + one line of label, plus the row's own padding.
  static const railHeight = 106.0;

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
    final theme = Theme.of(context);
    final label = story.title ?? publisherName;

    // Viewed state reaches a screen reader as WORDS. The ring colour alone would be the only
    // indication for a sighted user and no indication at all for anyone else.
    final semanticLabel = story.isViewed
        ? l10n.storyRingViewed(label)
        : l10n.storyRingUnviewed(label);

    return Semantics(
      button: true,
      label: semanticLabel,
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          borderRadius: const BorderRadius.all(Radii.radiusMd),
          child: SizedBox(
            width: 76,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _AvatarRing(
                  viewed: story.isViewed,
                  child: JawwidAvatar(
                    displayName: publisherName,
                    size: Sizes.avatarLg,
                  ),
                ),
                const SizedBox(height: Spacing.spacing2),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontWeight: story.isViewed ? FontWeight.w400 : FontWeight.w700,
                    color: story.isViewed
                        ? theme.colorScheme.onSurfaceVariant
                        : theme.colorScheme.onSurface,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
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
