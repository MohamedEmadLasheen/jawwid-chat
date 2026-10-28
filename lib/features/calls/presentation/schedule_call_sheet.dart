import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/utils/app_clock.dart';
import '../../../shared/utils/clock_time.dart';
import '../../../shared/utils/text_direction.dart';
import '../application/upcoming_calls_controller.dart';
import '../data/scheduled_call_repository.dart';
import '../domain/scheduled_call.dart';
import 'calls_actions.dart';

/// Schedule a call in one conversation (PD-13), or null when dismissed.
///
/// Saving posts `POST /scheduled-calls` with `kind: 'scheduled'`. The server
/// posts the card into the conversation and decides whether this actor may
/// schedule there at all; this sheet only refuses a time in the past, which no
/// server answer could make sensible.
Future<ScheduledCall?> showScheduleCallSheet(
  BuildContext context, {
  required Conversation conversation,
}) {
  return showModalBottomSheet<ScheduledCall>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (sheetContext) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
      ),
      child: ScheduleCallSheet(conversation: conversation),
    ),
  );
}

/// The longest title the server accepts.
const scheduledCallTitleMax = 120;

class ScheduleCallSheet extends ConsumerStatefulWidget {
  const ScheduleCallSheet({
    super.key,
    required this.conversation,
    this.initialStart,
    this.clock,
  });

  final Conversation conversation;

  /// Where the pickers start. Defaults to the next half hour.
  final DateTime? initialStart;

  /// "Now", for the not-in-the-past rule. Defaults to [DateTime.now].
  final DateTime Function()? clock;

  @override
  ConsumerState<ScheduleCallSheet> createState() => _ScheduleCallSheetState();
}

class _ScheduleCallSheetState extends ConsumerState<ScheduleCallSheet> {
  final _title = TextEditingController();
  late DateTime _day;
  late TimeOfDay _time;
  String? _error;
  bool _saving = false;

  DateTime _now() => (widget.clock ?? DateTime.now)();

  @override
  void initState() {
    super.initState();
    final start = widget.initialStart ?? _nextHalfHour(_now());
    _day = DateTime(start.year, start.month, start.day);
    _time = TimeOfDay(hour: start.hour, minute: start.minute);
  }

  static DateTime _nextHalfHour(DateTime now) {
    final base = DateTime(now.year, now.month, now.day, now.hour);
    return now.minute < 30
        ? base.add(const Duration(minutes: 30))
        : base.add(const Duration(hours: 1));
  }

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  // PD-22: the picked wall clock is the account's zone, which may not be the phone's.
  DateTime get _startsAt =>
      AppClock.wallClock(_day.year, _day.month, _day.day, _time.hour, _time.minute);

  Future<void> _pickDay() async {
    final today = DateTime(_now().year, _now().month, _now().day);
    final picked = await showDatePicker(
      context: context,
      initialDate: _day.isBefore(today) ? today : _day,
      firstDate: today,
      lastDate: today.add(const Duration(days: 365)),
    );
    if (picked != null && mounted) setState(() => _day = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(context: context, initialTime: _time);
    if (picked != null && mounted) setState(() => _time = picked);
  }

  Future<void> _save() async {
    final l10n = L10n.of(context);
    final startsAt = _startsAt;
    if (!startsAt.isAfter(_now())) {
      setState(() => _error = l10n.callScheduleInPast);
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final created =
          await resolveScheduledCallRepository(
            () => ref.read(scheduledCallRepositoryProvider),
          ).create(
            conversationId: widget.conversation.id,
            kind: ScheduledCallKind.scheduled,
            startsAt: startsAt,
            title: _title.text,
          );
      if (mounted) Navigator.of(context).pop(created);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = scheduleFailureMessage(l10n, error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final material = MaterialLocalizations.of(context);
    final label = conversationLabel(l10n, widget.conversation);
    final use24h = MediaQuery.alwaysUse24HourFormatOf(context);

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing5,
        vertical: Spacing.spacing3,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.callActionSchedule, style: theme.textTheme.titleLarge),
          const SizedBox(height: Spacing.spacing4),
          Row(
            children: [
              JawwidAvatar(
                displayName: label,
                imageUrl: widget.conversation.avatarUrl,
                size: Sizes.avatarMd,
              ),
              const SizedBox(width: Spacing.spacing4),
              Expanded(
                child: ContentText(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall,
                ),
              ),
            ],
          ),
          const SizedBox(height: Spacing.spacing5),
          Row(
            children: [
              Expanded(
                child: _PickerButton(
                  key: const ValueKey('schedule-date'),
                  icon: Icons.calendar_today_outlined,
                  label: l10n.callScheduleDate,
                  value: material.formatMediumDate(_day),
                  onTap: _saving ? null : _pickDay,
                ),
              ),
              const SizedBox(width: Spacing.spacing3),
              Expanded(
                child: _PickerButton(
                  key: const ValueKey('schedule-time'),
                  icon: Icons.schedule_outlined,
                  label: l10n.callScheduleTime,
                  value: formatClockTime(context, _time,
                    alwaysUse24HourFormat: use24h,
                  ),
                  onTap: _saving ? null : _pickTime,
                ),
              ),
            ],
          ),
          const SizedBox(height: Spacing.spacing5),
          TextField(
            controller: _title,
            enabled: !_saving,
            maxLength: scheduledCallTitleMax,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(labelText: l10n.callScheduleTitleLabel),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing2),
              child: Text(
                _error!,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: tokens.colorStatusDangerFg,
                ),
              ),
            ),
          const SizedBox(height: Spacing.spacing5),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox.square(
                    dimension: Spacing.spacing6,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(l10n.saveAction),
          ),
        ],
      ),
    );
  }
}

class _PickerButton extends StatelessWidget {
  const _PickerButton({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return Semantics(
      button: true,
      label: '$label: $value',
      excludeSemantics: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: Radii.card,
        child: Container(
          constraints: const BoxConstraints(minHeight: Sizes.minTouchTarget),
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.spacing4,
            vertical: Spacing.spacing3,
          ),
          decoration: BoxDecoration(
            borderRadius: Radii.card,
            border: Border.all(color: tokens.colorBorderDefault),
          ),
          child: Row(
            children: [
              Icon(icon, size: 20, color: tokens.colorTextSecondary),
              const SizedBox(width: Spacing.spacing3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      label,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: tokens.colorTextSecondary,
                      ),
                    ),
                    Text(
                      value,
                      style: theme.textTheme.bodyMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
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
