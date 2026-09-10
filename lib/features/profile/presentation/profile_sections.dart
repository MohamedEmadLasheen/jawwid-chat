import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/text_direction.dart';
import '../domain/profile_view.dart';

/// Shared furniture for the profile screens, kept small and quiet on purpose.
///
/// A profile is a place people glance at, not a record they audit. Every piece here is a
/// plain row on the page background — no cards, no shadows, no chips.
class ProfileSectionHeading extends StatelessWidget {
  const ProfileSectionHeading({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(
        Spacing.spacing5,
        Spacing.spacing5,
        Spacing.spacing5,
        Spacing.spacing3,
      ),
      child: Semantics(
        header: true,
        child: Text(
          text,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                color: JawwidTokens.of(context).colorTextSecondary,
                fontWeight: FontWeight.w700,
              ),
        ),
      ),
    );
  }
}

class ProfileDivider extends StatelessWidget {
  const ProfileDivider({super.key});

  @override
  Widget build(BuildContext context) => Divider(
        height: 1,
        color: JawwidTokens.of(context).colorBorderSubtle,
      );
}

/// A sentence explaining a state — an empty section, an approval rule, a gap.
class ProfileNote extends StatelessWidget {
  const ProfileNote({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing5,
        vertical: Spacing.spacing3,
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: JawwidTokens.of(context).colorTextSecondary,
            ),
      ),
    );
  }
}

/// One child, collapsed to a name until someone asks for more.
///
/// Progressive disclosure is doing real work here: a parent with three children would
/// otherwise meet fifteen labelled rows on opening their own account, which is the admin
/// panel this screen must not become.
class ChildTile extends StatelessWidget {
  const ChildTile({super.key, required this.child});

  final ProfileChild child;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return Theme(
      // The default expansion tile paints its own divider lines and tints its header when
      // open; both fight the flat treatment the rest of the screen uses.
      data: theme.copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5),
        childrenPadding: const EdgeInsetsDirectional.only(
          start: Spacing.spacing5,
          end: Spacing.spacing5,
          bottom: Spacing.spacing4,
        ),
        shape: const Border(),
        collapsedShape: const Border(),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        title: ContentText(
          child.learner.displayName,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
        // The one fact worth showing before expanding: which group this child is in.
        subtitle: child.groupTitle == null
            ? null
            : ContentText(
                child.groupTitle!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: tokens.colorTextSecondary),
              ),
        children: [
          _Field(label: l10n.childGroupLabel, value: child.groupTitle),
          _Field(label: l10n.childTeacherLabel, value: child.teacherName),
          _Field(label: l10n.childLevelLabel, value: child.level),
          _Field(label: l10n.childSubscriptionLabel, value: child.subscription),
          _Field(label: l10n.childScheduleLabel, value: child.schedule),
        ],
      ),
    );
  }
}

/// One labelled fact.
///
/// A missing value renders the words "Not available yet", never a blank or a dash. A blank
/// reads as "this child has no teacher"; the truth is that the app cannot see one, and the
/// difference matters to a parent.
class _Field extends StatelessWidget {
  const _Field({required this.label, required this.value});

  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final resolved = value?.trim();
    final missing = resolved == null || resolved.isEmpty;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: Spacing.spacing2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 104,
            child: Text(
              label,
              style: theme.textTheme.labelSmall
                  ?.copyWith(color: tokens.colorTextSecondary),
            ),
          ),
          const SizedBox(width: Spacing.spacing3),
          Expanded(
            child: ContentText(
              missing ? l10n.fieldNotAvailableYet : resolved,
              style: theme.textTheme.bodySmall?.copyWith(
                color: missing ? tokens.colorTextMuted : tokens.colorTextPrimary,
                fontStyle: missing ? FontStyle.italic : FontStyle.normal,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
