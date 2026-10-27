import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../app/providers.dart';
import '../../../app/router.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/models/user_role.dart';
import '../../../shared/utils/clock_time.dart';
import '../../profile/presentation/profile_sections.dart';

/// PD-15: each child of a group, from `GET /conversations/:id/learners`.
final groupChildrenProvider = FutureProvider.autoDispose.family<List<GroupChild>, String>((ref, conversationId) {
  return ref.watch(lessonRepositoryProvider).groupChildren(conversationId);
});

/// A group's details, one child at a time -- name, age, course, weekly lesson times,
/// package, teacher -- so siblings' courses, times and packages are never confused.
/// Nothing is shown when the group is about no child, or the request fails: the rest
/// of the page does not depend on it.
///
/// PD-17: a child's card opens their Student Profile, and only for the child's own
/// teacher -- the signed-in teacher whose id the card carries. A parent's cards, and
/// another teacher's, are not tappable at all: no affordance rather than a refusal.
class GroupChildrenSection extends ConsumerWidget {
  const GroupChildrenSection({super.key, required this.conversationId});

  final String conversationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final children = ref.watch(groupChildrenProvider(conversationId)).value ?? const <GroupChild>[];
    if (children.isEmpty) return const SizedBox.shrink();
    final l10n = L10n.of(context);
    final isTeacher = ref.watch(currentRoleProvider) == UserRole.teacher;
    final me = ref.watch(principalIdProvider);
    bool mine(GroupChild child) => isTeacher && me != null && me.isNotEmpty && child.teacherId == me;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const ProfileDivider(),
        ProfileSectionHeading(text: l10n.groupChildrenTitle),
        for (final child in children)
          _ChildCard(
            child: child,
            onOpen: mine(child) ? () => context.push(Routes.studentProfile(child.id)) : null,
          ),
      ],
    );
  }
}

class _ChildCard extends StatelessWidget {
  const _ChildCard({required this.child, this.onOpen});

  final GroupChild child;

  /// Opens the Student Profile; null when this viewer may not (no affordance at all).
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    // ISO weekday 1 = Monday; 2024-01-01 was a Monday.
    String weekday(int d) => DateFormat.EEEE(locale).format(DateTime(2024, 1, d));
    final notSet = l10n.groupChildNotSet;
    // PD-22: the next real start in the reader's own zone; the teacher's wall clock only
    // for a slot the server sent without one.
    String when(GroupChildSlot s) {
      final next = s.nextStartsAt;
      return next == null
          ? '${weekday(s.weekday)} · ${s.start}'
          : '${weekday(next.weekday)} · ${formatClockTime(context, TimeOfDay.fromDateTime(next))}';
    }

    Widget row(String label, Widget value) => Padding(
          padding: const EdgeInsets.only(top: Spacing.spacing2),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 132,
                child: Text(label, style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ),
              Expanded(child: value),
            ],
          ),
        );
    Text text(String v) => Text(v, style: theme.textTheme.bodyMedium);

    final content = Padding(
      padding: const EdgeInsets.all(Spacing.spacing4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(child.name, style: theme.textTheme.titleMedium),
          row(l10n.groupChildAgeLabel, text(child.age == null ? notSet : l10n.groupChildAge(child.age!))),
          row(l10n.groupChildCourse, text(child.courseName ?? notSet)),
          row(
            l10n.groupChildSchedule,
            child.schedule.isEmpty
                ? text(l10n.groupChildNoSchedule)
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (final s in child.schedule)
                        text('${when(s)} · ${l10n.groupChildMinutes(s.durationMinutes)}'),
                    ],
                  ),
          ),
          row(l10n.groupChildPackage, text(child.packageLessons == null ? notSet : l10n.groupChildPackageLessons(child.packageLessons!))),
          row(l10n.groupChildTeacher, text(child.teacherName ?? notSet)),
          // PD-17: the way in, said in words and with a chevron, so a tappable card
          // does not have to be discovered.
          if (onOpen != null)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing3),
              child: Row(
                children: [
                  Expanded(
                    child: Text(l10n.studentProfileView, style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary)),
                  ),
                  Icon(Icons.chevron_right, color: theme.colorScheme.primary),
                ],
              ),
            ),
        ],
      ),
    );

    return Card(
      key: ValueKey('group-child-${child.id}'),
      margin: const EdgeInsets.symmetric(horizontal: Spacing.spacing4, vertical: Spacing.spacing2),
      clipBehavior: onOpen == null ? Clip.none : Clip.antiAlias,
      child: onOpen == null
          ? content
          : InkWell(key: ValueKey('group-child-open-${child.id}'), onTap: onOpen, child: content),
    );
  }
}
