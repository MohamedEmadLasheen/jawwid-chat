import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';

// PD-31: the one way a free time is picked in the app -- a make-up, moving one
// lesson, changing a weekly time. The Admin Web `SlotPicker` has the same shape.
//
// A strip of day chips ("Mon 27 · 6"), then the chosen day's times as chips under
// Morning / Afternoon / Evening. One tap selects; the selected chip takes the theme's
// selected colours (AA, `JawwidTheme.chipTheme`). Only free times are offered, so a
// clash cannot be picked; the server still re-checks on submit.
//
// Every time is already in the reader's clock (`AppClock.view`, done by the
// repository), so a day and a period are the reader's own -- a family abroad sees
// its own Monday evening, not the teacher's.

/// Which part of the reader's day a time falls in: before 12:00, 12:00-17:00, after.
enum DayPeriod {
  morning,
  afternoon,
  evening;

  static DayPeriod of(DateTime t) => t.hour < 12 ? morning : (t.hour < 17 ? afternoon : evening);

  String label(L10n l10n) => switch (this) {
        morning => l10n.slotsMorning,
        afternoon => l10n.slotsAfternoon,
        evening => l10n.slotsEvening,
      };
}

/// "Lessons paused -- payment" (PD-30): shown instead of any chip while the child's
/// lessons are locked. Every write is refused by the server meanwhile.
class SlotsLockedNotice extends StatelessWidget {
  const SlotsLockedNotice({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      key: const ValueKey('slots-locked'),
      children: [
        Icon(Icons.lock_clock_outlined, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: Spacing.spacing2),
        Expanded(child: Text(L10n.of(context).slotsLocked, style: theme.textTheme.bodyMedium)),
      ],
    );
  }
}

/// One-off free starts (a make-up, a moved lesson): day chips, then that day's times.
class SlotChipPicker extends StatefulWidget {
  const SlotChipPicker({
    super.key,
    required this.slots,
    required this.selected,
    required this.onSelected,
    this.locked = false,
    this.emptyText,
    this.keyPrefix = 'slot',
  });

  /// The free starts, in the reader's clock.
  final List<DateTime> slots;
  final DateTime? selected;
  final ValueChanged<DateTime> onSelected;

  /// PD-30: the child's lessons are paused; no chip is offered.
  final bool locked;

  /// What an empty offer says; "No free times right now." by default.
  final String? emptyText;

  /// Chip keys: `<prefix>-day-<day ISO>` and `<prefix>-time-<UTC ISO>`.
  final String keyPrefix;

  @override
  State<SlotChipPicker> createState() => _SlotChipPickerState();
}

class _SlotChipPickerState extends State<SlotChipPicker> {
  DateTime? _day;

  static DateTime _dayOf(DateTime t) => DateTime(t.year, t.month, t.day);

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    if (widget.locked) return const SlotsLockedNotice();
    if (widget.slots.isEmpty) return Text(widget.emptyText ?? l10n.slotsNone, style: theme.textTheme.bodyMedium);

    final locale = Localizations.localeOf(context).toLanguageTag();
    final m = MaterialLocalizations.of(context);
    final byDay = <DateTime, List<DateTime>>{};
    for (final t in [...widget.slots]..sort()) {
      (byDay[_dayOf(t)] ??= []).add(t);
    }
    final days = byDay.keys.toList()..sort();
    // The day shown: the one tapped, else the selection's, else the first -- and never
    // a day a reload took away.
    final selectedDay = widget.selected == null ? null : _dayOf(widget.selected!);
    final day = byDay.containsKey(_day) ? _day! : (byDay.containsKey(selectedDay) ? selectedDay! : days.first);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(l10n.makeupPickDay, style: theme.textTheme.labelLarge),
        const SizedBox(height: Spacing.spacing2),
        _DayStrip(
          children: [
            for (final d in days)
              ChoiceChip(
                key: ValueKey('${widget.keyPrefix}-day-${d.toIso8601String()}'),
                label: Semantics(
                  label: '${m.formatFullDate(d)}, ${l10n.slotsFreeCount(byDay[d]!.length)}',
                  excludeSemantics: true,
                  child: Text('${DateFormat.E(locale).format(d)} ${DateFormat.d(locale).format(d)} · ${byDay[d]!.length}'),
                ),
                selected: d == day,
                onSelected: (_) => setState(() => _day = d),
              ),
          ],
        ),
        const SizedBox(height: Spacing.spacing4),
        Text(l10n.makeupPickTime, style: theme.textTheme.labelLarge),
        const SizedBox(height: Spacing.spacing2),
        _PeriodGroups<DateTime>(
          items: byDay[day]!,
          at: (t) => t,
          chip: (t) => ChoiceChip(
            key: ValueKey('${widget.keyPrefix}-time-${t.toUtc().toIso8601String()}'),
            label: Text(m.formatTimeOfDay(TimeOfDay.fromDateTime(t))),
            selected: widget.selected != null && t.isAtSameMomentAs(widget.selected!),
            onSelected: (_) => widget.onSelected(t),
          ),
        ),
      ],
    );
  }
}

/// Regular weekly times (changing a child's weekly lessons): weekday chips with how
/// many times each has, then that weekday's times. A time the teacher is already busy
/// at in one of the next four weeks says so on its chip ("except 2 Nov").
class WeeklySlotChipPicker extends StatefulWidget {
  const WeeklySlotChipPicker({
    super.key,
    required this.options,
    required this.selected,
    required this.onSelected,
    this.locked = false,
    this.emptyText,
  });

  /// Shown by [WeeklyOption.nextStartsAt], in the reader's clock.
  final List<WeeklyOption> options;
  final WeeklyKey? selected;
  final ValueChanged<WeeklyOption> onSelected;
  final bool locked;
  final String? emptyText;

  @override
  State<WeeklySlotChipPicker> createState() => _WeeklySlotChipPickerState();
}

class _WeeklySlotChipPickerState extends State<WeeklySlotChipPicker> {
  int? _weekday;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    if (widget.locked) return const SlotsLockedNotice();
    if (widget.options.isEmpty) {
      return Text(widget.emptyText ?? l10n.scheduleChangeNoOptions, style: theme.textTheme.bodyMedium);
    }

    final locale = Localizations.localeOf(context).toLanguageTag();
    final m = MaterialLocalizations.of(context);
    // Grouped by the weekday the READER's clock shows, soonest weekday first.
    final sorted = [...widget.options]..sort((a, b) => a.nextStartsAt.compareTo(b.nextStartsAt));
    final byWeekday = <int, List<WeeklyOption>>{};
    for (final o in sorted) {
      (byWeekday[o.nextStartsAt.weekday] ??= []).add(o);
    }
    final weekdays = byWeekday.keys.toList();
    final selectedWeekday = sorted.where((o) => o.key == widget.selected).firstOrNull?.nextStartsAt.weekday;
    final weekday = byWeekday.containsKey(_weekday)
        ? _weekday!
        : (byWeekday.containsKey(selectedWeekday) ? selectedWeekday! : weekdays.first);
    final times = [...byWeekday[weekday]!]..sort((a, b) => _minuteOfDay(a.nextStartsAt).compareTo(_minuteOfDay(b.nextStartsAt)));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(l10n.makeupPickDay, style: theme.textTheme.labelLarge),
        const SizedBox(height: Spacing.spacing2),
        _DayStrip(
          children: [
            for (final d in weekdays)
              ChoiceChip(
                key: ValueKey('weekly-day-$d'),
                label: Semantics(
                  label: '${DateFormat.EEEE(locale).format(byWeekday[d]!.first.nextStartsAt)}, '
                      '${l10n.slotsFreeCount(byWeekday[d]!.length)}',
                  excludeSemantics: true,
                  child: Text('${DateFormat.E(locale).format(byWeekday[d]!.first.nextStartsAt)} · ${byWeekday[d]!.length}'),
                ),
                selected: d == weekday,
                onSelected: (_) => setState(() => _weekday = d),
              ),
          ],
        ),
        const SizedBox(height: Spacing.spacing4),
        Text(l10n.makeupPickTime, style: theme.textTheme.labelLarge),
        const SizedBox(height: Spacing.spacing2),
        _PeriodGroups<WeeklyOption>(
          items: times,
          at: (o) => o.nextStartsAt,
          chip: (o) {
            final time = Text(m.formatTimeOfDay(TimeOfDay.fromDateTime(o.nextStartsAt)));
            return ChoiceChip(
              key: ValueKey('weekly-${o.weekday}-${o.start}'),
              label: o.except.isEmpty
                  ? time
                  : Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        time,
                        Text(
                          l10n.slotsExcept(o.except.map(m.formatShortMonthDay).join(locale.startsWith('ar') ? '، ' : ', ')),
                          style: theme.textTheme.labelSmall,
                        ),
                      ],
                    ),
              selected: o.key == widget.selected,
              onSelected: (_) => widget.onSelected(o),
            );
          },
        ),
      ],
    );
  }

  static int _minuteOfDay(DateTime t) => t.hour * 60 + t.minute;
}

/// The day chips, in one horizontal strip.
class _DayStrip extends StatelessWidget {
  const _DayStrip({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          for (final c in children)
            Padding(padding: const EdgeInsetsDirectional.only(end: Spacing.spacing2), child: c),
        ],
      ),
    );
  }
}

/// One day's times, under Morning / Afternoon / Evening -- a period with no time is
/// not shown.
class _PeriodGroups<T> extends StatelessWidget {
  const _PeriodGroups({required this.items, required this.at, required this.chip});

  final List<T> items;
  final DateTime Function(T) at;
  final Widget Function(T) chip;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final period in DayPeriod.values)
          if (items.where((i) => DayPeriod.of(at(i)) == period).toList() case final inPeriod when inPeriod.isNotEmpty) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: Spacing.spacing2),
              child: Text(
                period.label(l10n),
                key: ValueKey('slot-period-${period.name}'),
                style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: Spacing.spacing3),
              child: Wrap(
                spacing: Spacing.spacing2,
                runSpacing: Spacing.spacing2,
                children: [for (final i in inPeriod) chip(i)],
              ),
            ),
          ],
      ],
    );
  }
}
