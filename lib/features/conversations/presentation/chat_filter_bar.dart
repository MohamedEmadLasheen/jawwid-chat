import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/chat_feed.dart';

/// The All · Unread · Groups · Favourites chips.
///
/// Chips, not tabs: they filter one feed rather than navigating anywhere, and they are
/// sized to say so. A tab bar here would cost twice the height and would re-introduce
/// exactly the "which list is my group in?" question this redesign removes.
class ChatFilterBar extends StatelessWidget {
  const ChatFilterBar({
    super.key,
    required this.selected,
    required this.onSelected,
    required this.unreadCount,
  });

  final ChatFilter selected;
  final ValueChanged<ChatFilter> onSelected;

  /// Shown on the Unread chip. Real, from the loaded conversations.
  final int unreadCount;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    String label(ChatFilter filter) => switch (filter) {
          ChatFilter.all => l10n.filterAll,
          ChatFilter.unread => unreadCount > 0
              ? '${l10n.filterUnread} $unreadCount'
              : l10n.filterUnread,
          ChatFilter.groups => l10n.filterGroups,
          ChatFilter.favorites => l10n.filterFavorites,
        };

    return SizedBox(
      height: 48,
      // Horizontal scrolling takes its direction from the ambient Directionality, so this
      // starts at the right in Arabic with no mirroring code.
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
        children: [
          for (final filter in ChatFilter.values)
            Padding(
              padding: const EdgeInsetsDirectional.only(end: Spacing.spacing3),
              child: _FilterChip(
                label: label(filter),
                selected: filter == selected,
                onTap: () => onSelected(filter),
              ),
            ),
        ],
      ),
    );
  }
}

/// Hand-rolled rather than `FilterChip`, for one reason: the selected state must be
/// unmistakable at a glance, and Material's default selected chip differs from its
/// unselected one by a tint most people do not notice. This one changes fill, text colour
/// and weight together, so it reads as selected in bright sunlight and to anyone who does
/// not distinguish the two tints (§53).
class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: ExcludeSemantics(
        child: Material(
          color: selected ? tokens.colorBrandPrimary : tokens.colorSurfaceMuted,
          shape: StadiumBorder(
            side: BorderSide(
              color:
                  selected ? tokens.colorBrandPrimary : tokens.colorBorderSubtle,
            ),
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Container(
              alignment: AlignmentDirectional.center,
              // A minimum width as well as a height: "All" and "الكل" are short enough
              // that a stadium border round them alone renders a circle, which reads as a
              // different kind of control from the three pills beside it.
              constraints: const BoxConstraints(minHeight: 34, minWidth: 68),
              padding: const EdgeInsets.symmetric(
                horizontal: Spacing.spacing4,
              ),
              child: Text(
                label,
                style: theme.textTheme.labelMedium?.copyWith(
                  color: selected
                      ? tokens.colorBrandOnPrimary
                      : tokens.colorTextSecondary,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
