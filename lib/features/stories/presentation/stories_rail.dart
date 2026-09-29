import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/story.dart';
import '../application/stories_controller.dart';

/// The horizontally scrolling stories rail, above the conversation list.
///
/// ## It renders nothing unless there are stories to render
///
/// Not a skeleton while loading, not a row of grey circles when the academy has published
/// nothing, and not an error band when the feed failed. Stories are secondary to the chat
/// list, and 106dp of the most valuable space on the screen is too much to spend saying
/// "nothing here". Loading, empty, unavailable and failed all look the same from the outside:
/// absent. The controller still distinguishes them internally, so a missing wiring cannot
/// masquerade as a quiet academy.
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stories = ref.watch(storyRailOrderProvider);
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
