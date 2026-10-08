import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/story.dart';
import '../../../shared/models/user_role.dart';
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
///
/// ## A teacher gets the ring without the label
///
/// The line of text under each ring is a parent's content, the same rule the full-screen
/// viewer applies to the caption. A teacher sees the ring, its viewed/unviewed state, and
/// nothing written underneath it.
///
/// The rail keeps [railHeight] either way. A role does not change how much of the screen
/// stories cost, so the rail is not two different heights depending on who is signed in --
/// the ring is centred in the same band instead.
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
    // Read once for the rail rather than once per entry, and deliberately AFTER the early
    // return: a rail with nothing to show must not depend on knowing who is signed in.
    final showLabel = ref.watch(currentRoleProvider) != UserRole.teacher;

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
          // Keyed by story id so that "which ring is this" is answerable without reading
          // the label off it -- a teacher has no label to read. Prefixed, so a rail entry
          // and a viewer page for the same story can never answer to the same finder.
          key: storyRingKey(stories[index].id),
          story: stories[index],
          publisherName: l10n.appName,
          showLabel: showLabel,
          onTap: () => onOpenStory?.call(stories[index]),
        ),
      ),
    );
  }
}

/// The key on the rail entry for one story.
///
/// Public so a test can name a ring without depending on its label.
ValueKey<String> storyRingKey(String storyId) => ValueKey('story-ring-$storyId');

class _StoryEntry extends StatelessWidget {
  const _StoryEntry({
    super.key,
    required this.story,
    required this.publisherName,
    required this.showLabel,
    this.onTap,
  });

  final Story story;
  final String publisherName;

  /// Whether the line of text under the ring is this reader's to see.
  ///
  /// False for a teacher. It governs the SPOKEN label as well as the written one: a title
  /// withheld from the screen but read out by VoiceOver would be hidden from a sighted
  /// teacher and handed to a teacher using a screen reader, which is not a sensible place
  /// to land. The ring stays labelled either way -- it falls back to the publisher, exactly
  /// as an untitled story already does -- so nobody is left with an unnamed button.
  final bool showLabel;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final label = showLabel ? (story.title ?? publisherName) : publisherName;

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
              // A horizontal ListView hands its children a TIGHT height, so without the
              // label the ring would sit at the top of the band with the label's space left
              // empty beneath it. Centring keeps it in the middle of the same rail: the
              // ring's own size and the rail's height are both untouched.
              mainAxisAlignment:
                  showLabel ? MainAxisAlignment.start : MainAxisAlignment.center,
              children: [
                _AvatarRing(
                  viewed: story.isViewed,
                  child: JawwidAvatar(
                    displayName: publisherName,
                    size: Sizes.avatarLg,
                  ),
                ),
                if (showLabel) const SizedBox(height: Spacing.spacing2),
                if (showLabel)
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
