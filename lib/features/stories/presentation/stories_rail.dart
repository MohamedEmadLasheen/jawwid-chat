import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../application/stories_controller.dart';
import '../domain/story.dart';

/// The horizontally scrolling stories rail, above the conversation list.
///
/// Built to the interaction model people already know from other messaging apps —
/// circular avatars, unviewed first, a ring that distinguishes viewed from unviewed, the
/// viewer's own entry leading — while staying inside Jawwid's own palette and type. No
/// borrowed colours, no borrowed marks.
///
/// **It renders nothing when there are no rings**, which is every build today. That is
/// deliberate: an empty rail of grey circles would take 110dp of the most valuable space on
/// the screen to communicate that a feature does not exist. See [storyRingsProvider].
class StoriesRail extends ConsumerWidget {
  const StoriesRail({super.key, this.onOpenStory, this.onCreateStory});

  final void Function(StoryRing story)? onOpenStory;
  final VoidCallback? onCreateStory;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rings = ref.watch(storyRingsProvider);
    final canPost = ref.watch(canPostStoryProvider);

    if (rings.isEmpty && !canPost) return const SizedBox.shrink();

    // Unviewed first, then newest — the order that makes the rail worth swiping.
    final ordered = [...rings]..sort((a, b) {
        if (a.isOwn != b.isOwn) return a.isOwn ? -1 : 1;
        if (a.isViewed != b.isViewed) return a.isViewed ? 1 : -1;
        return b.postedAt.compareTo(a.postedAt);
      });

    final own = ordered.where((s) => s.isOwn).firstOrNull;
    final others = ordered.where((s) => !s.isOwn).toList(growable: false);

    return Container(
      height: _railHeight,
      decoration: BoxDecoration(
        color: JawwidTokens.of(context).colorSurfaceDefault,
        border: Border(
          bottom: BorderSide(color: JawwidTokens.of(context).colorBorderSubtle),
        ),
      ),
      // A horizontal ListView takes its scroll direction from the ambient Directionality,
      // so this starts at the right in Arabic without any mirroring code.
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.spacing4,
          vertical: Spacing.spacing3,
        ),
        children: [
          if (canPost)
            _CreateStoryEntry(
              existing: own,
              onTap: own == null
                  ? onCreateStory
                  : () => onOpenStory?.call(own),
            ),
          for (final story in others)
            _StoryEntry(
              story: story,
              onTap: () => onOpenStory?.call(story),
            ),
        ],
      ),
    );
  }

  /// Avatar + ring + one line of name, plus the row's own padding.
  static const _railHeight = 106.0;
}

class _StoryEntry extends StatelessWidget {
  const _StoryEntry({required this.story, this.onTap});

  final StoryRing story;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return _RailSlot(
      // Viewed state reaches a screen reader as words, never as a ring colour alone.
      semanticLabel: story.authorName,
      onTap: onTap,
      ring: _AvatarRing(
        viewed: story.isViewed,
        child: JawwidAvatar(
          displayName: story.authorName,
          imageUrl: story.avatarUrl,
          size: Sizes.avatarLg,
        ),
      ),
      label: story.authorName,
      emphasised: !story.isViewed,
    );
  }
}

/// The viewer's own entry. Shown only where posting is actually supported.
class _CreateStoryEntry extends StatelessWidget {
  const _CreateStoryEntry({required this.existing, this.onTap});

  final StoryRing? existing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    final name = existing?.authorName ?? '';

    return _RailSlot(
      semanticLabel: name,
      onTap: onTap,
      ring: Stack(
        clipBehavior: Clip.none,
        children: [
          existing == null
              ? Container(
                  width: Sizes.avatarLg,
                  height: Sizes.avatarLg,
                  decoration: BoxDecoration(
                    color: tokens.colorSurfaceMuted,
                    shape: BoxShape.circle,
                    border: Border.all(color: tokens.colorBorderDefault),
                  ),
                )
              : _AvatarRing(
                  viewed: existing!.isViewed,
                  child: JawwidAvatar(
                    displayName: name,
                    imageUrl: existing!.avatarUrl,
                    size: Sizes.avatarLg,
                  ),
                ),
          PositionedDirectional(
            bottom: -2,
            end: -2,
            child: Container(
              padding: const EdgeInsets.all(2),
              decoration: BoxDecoration(
                color: tokens.colorSurfaceDefault,
                shape: BoxShape.circle,
              ),
              child: Container(
                decoration: BoxDecoration(
                  color: tokens.colorBrandPrimary,
                  shape: BoxShape.circle,
                ),
                padding: const EdgeInsets.all(2),
                child: Icon(
                  Icons.add,
                  size: 12,
                  color: tokens.colorBrandOnPrimary,
                ),
              ),
            ),
          ),
        ],
      ),
      label: name,
      emphasised: false,
    );
  }
}

/// One fixed-width column in the rail, so entries line up whatever the name length.
class _RailSlot extends StatelessWidget {
  const _RailSlot({
    required this.ring,
    required this.label,
    required this.semanticLabel,
    required this.emphasised,
    this.onTap,
  });

  final Widget ring;
  final String label;
  final String semanticLabel;
  final bool emphasised;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

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
                ring,
                const SizedBox(height: Spacing.spacing2),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontWeight: emphasised ? FontWeight.w700 : FontWeight.w400,
                    color: emphasised
                        ? theme.colorScheme.onSurface
                        : theme.colorScheme.onSurfaceVariant,
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
