import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../core/errors/app_error.dart';
import '../../../core/errors/error_presenter.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../design/widgets/state_views.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/student_profile.dart';
import '../../../shared/utils/text_direction.dart';
import '../../materials/presentation/child_materials_entry.dart';
import '../application/student_profile_provider.dart';

/// PD-17: a teacher's view of one of their own students -- photo, name, age, course,
/// assigned teacher and the weekly class times. Nothing about the family and nothing
/// about money: the type behind it has no field for either.
///
/// Reached only from that child's card in their group's info, and only by their own
/// teacher (the route sends everyone else away). The server decides regardless: a
/// teacher who is not this child's gets a 404, shown as a plain refusal rather than as
/// a failure to retry, because retrying cannot change the answer.
class StudentProfileScreen extends ConsumerWidget {
  const StudentProfileScreen({super.key, required this.learnerId});

  final String learnerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(studentProfileProvider(learnerId));

    return Scaffold(
      appBar: AppBar(title: Text(l10n.studentProfileTitle)),
      body: switch (state) {
        AsyncLoading() => const JawwidLoadingView(),
        AsyncError(:final error) => _Error(
            error: error,
            onRetry: () => ref.invalidate(studentProfileProvider(learnerId)),
          ),
        AsyncData(:final value) => _Body(profile: value),
      },
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.profile});

  final StudentProfile profile;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();
    // ISO weekday 1 = Monday; 2024-01-01 was a Monday.
    String weekday(int d) => DateFormat.EEEE(locale).format(DateTime(2024, 1, d));
    final material = MaterialLocalizations.of(context);
    // PD-22: each lesson's next real start in the reader's own zone. Only a slot the server
    // sent without one falls back to the teacher's wall clock, and only then is its zone named.
    String when(StudentProfileSlot s) {
      final next = s.nextStartsAt;
      return next == null
          ? '${weekday(s.weekday)} · ${s.start}'
          : '${weekday(next.weekday)} · ${material.formatTimeOfDay(TimeOfDay.fromDateTime(next))}';
    }
    final zones = {for (final s in profile.schedule) if (s.nextStartsAt == null) ?s.timezone};

    return ListView(
      padding: const EdgeInsetsDirectional.only(bottom: Spacing.spacing9),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing7),
          child: Column(
            children: [
              JawwidAvatar(displayName: profile.name, imageUrl: profile.avatarUrl, size: Sizes.avatarXl),
              const SizedBox(height: Spacing.spacing5),
              ContentText(
                profile.name,
                textAlign: TextAlign.center,
                style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
              ),
            ],
          ),
        ),
        Divider(height: 1, color: tokens.colorBorderSubtle),
        _Field(
          key: const ValueKey('student-profile-age'),
          label: l10n.groupChildAgeLabel,
          value: profile.age == null ? null : l10n.groupChildAge(profile.age!),
        ),
        _Field(key: const ValueKey('student-profile-course'), label: l10n.groupChildCourse, value: profile.courseName),
        _Field(key: const ValueKey('student-profile-teacher'), label: l10n.studentProfileTeacher, value: profile.teacherName),
        _Field(
          key: const ValueKey('student-profile-schedule'),
          label: l10n.studentProfileSchedule,
          lines: [
            for (final s in profile.schedule)
              '${when(s)} · ${l10n.groupChildMinutes(s.durationMinutes)}',
          ],
          missing: l10n.groupChildNoSchedule,
          note: zones.length == 1 ? l10n.studentProfileTimeZone(zones.single) : null,
        ),
        // PD-29: the child's Materials (library, opened this week).
        Divider(height: 1, color: tokens.colorBorderSubtle),
        ChildMaterialsEntry(learnerId: profile.id, childName: profile.name),
      ],
    );
  }
}

/// One labelled fact. A missing value says so in words ("Not set"), never a blank:
/// a blank reads as "this child has no course", which is not what the app knows.
class _Field extends StatelessWidget {
  const _Field({super.key, required this.label, this.value, this.lines, this.missing, this.note});

  final String label;
  final String? value;

  /// Several values, one per line (the weekly times); [value] is ignored when set.
  final List<String>? lines;

  /// What to say when there is nothing; "Not set" unless given.
  final String? missing;

  /// A quiet line under the values.
  final String? note;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final values = lines ?? [if (value != null && value!.trim().isNotEmpty) value!.trim()];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing5, vertical: Spacing.spacing3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 132,
            child: Text(label, style: theme.textTheme.labelMedium?.copyWith(color: tokens.colorTextSecondary)),
          ),
          const SizedBox(width: Spacing.spacing3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (values.isEmpty)
                  Text(
                    missing ?? l10n.groupChildNotSet,
                    style: theme.textTheme.bodyMedium?.copyWith(color: tokens.colorTextMuted, fontStyle: FontStyle.italic),
                  )
                else
                  for (final v in values) ContentText(v, style: theme.textTheme.bodyMedium),
                if (note != null && values.isNotEmpty) ...[
                  const SizedBox(height: Spacing.spacing1),
                  Text(note!, style: theme.textTheme.bodySmall?.copyWith(color: tokens.colorTextSecondary)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Error extends StatelessWidget {
  const _Error({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final appError = asAppErrorOf(error);

    // Not this teacher's student (404), or not a teacher at all (403): the same calm
    // answer, and no retry -- asking again cannot change it.
    if (appError.kind == AppErrorKind.notFound || appError.kind == AppErrorKind.forbidden) {
      return JawwidEmptyView(
        icon: Icons.lock_outline,
        title: l10n.studentProfileNotYoursTitle,
        body: l10n.studentProfileNotYoursBody,
      );
    }

    final message = ErrorPresenter.present(appError, l10n);
    return JawwidErrorView(
      title: message.title,
      body: message.body,
      retryLabel: message.canRetry ? l10n.retryAction : null,
      onRetry: message.canRetry ? onRetry : null,
    );
  }
}
