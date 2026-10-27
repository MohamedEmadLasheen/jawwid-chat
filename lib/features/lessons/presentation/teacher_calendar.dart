import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/my_calendar.dart';
import '../../../shared/utils/app_clock.dart';
import '../../../shared/utils/clock_time.dart';
import 'teacher_schedule_screen.dart';

/// PD-38 P2: the teacher's own calendar -- Day, Week and Month -- in the Schedule
/// tab, beside its list. Everything drawn is the server's (`GET /me/calendar`):
/// the shift shaded, the shift time no lesson holds outlined in red, time
/// outside the shift grey, leave marked, and each lesson in its slot with its
/// status as a line style (solid active, dashed trial, dotted paused). Nothing
/// about another teacher, a supervisor or money reaches this screen.
///
/// Days are the account's (PD-22): the server cuts them in the zone [AppClock]
/// shows, so a lesson sits on the day the teacher's clock says.

enum ScheduleView { list, day, week, month }

@immutable
class ScheduleViewState {
  const ScheduleViewState(this.view, this.anchor);

  final ScheduleView view;

  /// The day the calendar is on, as a date (UTC midnight: date arithmetic only).
  final DateTime anchor;
}

/// Today in the account's zone, as a date.
DateTime calendarToday() {
  final now = AppClock.now();
  return DateTime.utc(now.year, now.month, now.day);
}

class ScheduleViewController extends Notifier<ScheduleViewState> {
  @override
  ScheduleViewState build() => ScheduleViewState(ScheduleView.list, calendarToday());

  void show(ScheduleView view) => state = ScheduleViewState(view, state.anchor);

  void openDay(DateTime day) => state = ScheduleViewState(ScheduleView.day, day);

  void today() => state = ScheduleViewState(state.view, calendarToday());

  void step(int dir) {
    final a = state.anchor;
    final next = switch (state.view) {
      ScheduleView.week => a.add(Duration(days: 7 * dir)),
      ScheduleView.month => DateTime.utc(a.year, a.month + dir, 1),
      _ => a.add(Duration(days: dir)),
    };
    state = ScheduleViewState(state.view, next);
  }
}

final scheduleViewProvider = NotifierProvider<ScheduleViewController, ScheduleViewState>(ScheduleViewController.new);

/// `YYYY-MM-DD` of a date.
String dayKey(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// The Saturday that starts [d]'s week (the academy's week runs Saturday to Friday).
DateTime weekStart(DateTime d) => d.subtract(Duration(days: (d.weekday + 1) % 7));

/// The view's days, [from] inclusive, [to] exclusive.
(DateTime, DateTime) calendarRange(ScheduleView view, DateTime anchor) => switch (view) {
  ScheduleView.week => (weekStart(anchor), weekStart(anchor).add(const Duration(days: 7))),
  ScheduleView.month => (DateTime.utc(anchor.year, anchor.month, 1), DateTime.utc(anchor.year, anchor.month + 1, 1)),
  _ => (anchor, anchor.add(const Duration(days: 1))),
};

final myCalendarProvider = FutureProvider.autoDispose.family<MyCalendar, (String, String)>((ref, range) {
  return ref.watch(lessonRepositoryProvider).myCalendar(range.$1, range.$2);
});

/// Minutes since [day]'s midnight of a wall-clock time, clamped to that day.
int minuteOfDay(DateTime t, String day) {
  final key = dayKey(t);
  if (key.compareTo(day) < 0) return 0;
  if (key.compareTo(day) > 0) return 1440;
  return t.hour * 60 + t.minute;
}

String _hours(int minutes) => (minutes / 60).toStringAsFixed(minutes % 60 == 0 ? 0 : 1);

class TeacherCalendar extends ConsumerWidget {
  const TeacherCalendar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final state = ref.watch(scheduleViewProvider);
    final (from, to) = calendarRange(state.view, state.anchor);
    final key = (dayKey(from), dayKey(to));
    final async = ref.watch(myCalendarProvider(key));
    return RefreshIndicator(
      onRefresh: () => ref.refresh(myCalendarProvider(key).future),
      child: ListView(
        key: const ValueKey('teacher-calendar'),
        padding: const EdgeInsets.only(bottom: Spacing.spacing7),
        children: [
          _NavBar(state: state, from: from, to: to),
          ...async.when(
            loading: () => [
              const Padding(
                padding: EdgeInsets.all(Spacing.spacing8),
                child: Center(child: CircularProgressIndicator()),
              ),
            ],
            error: (_, _) => [
              Padding(
                padding: const EdgeInsets.all(Spacing.spacing6),
                child: Text(l10n.calendarLoadFailed, textAlign: TextAlign.center),
              ),
            ],
            data: (cal) => [
              _Figures(cal: cal),
              const _Legend(),
              switch (state.view) {
                ScheduleView.week => _WeekView(cal: cal),
                ScheduleView.month => _MonthView(cal: cal, month: from),
                _ => _DayView(cal: cal, day: dayKey(from)),
              },
            ],
          ),
        ],
      ),
    );
  }
}

class _NavBar extends ConsumerWidget {
  const _NavBar({required this.state, required this.from, required this.to});

  final ScheduleViewState state;
  final DateTime from;
  final DateTime to;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final m = MaterialLocalizations.of(context);
    final rtl = Directionality.of(context) == TextDirection.rtl;
    final ctl = ref.read(scheduleViewProvider.notifier);
    final title = switch (state.view) {
      ScheduleView.week => '${m.formatShortMonthDay(from)} – ${m.formatShortMonthDay(to.subtract(const Duration(days: 1)))}',
      ScheduleView.month => m.formatMonthYear(from),
      _ => m.formatFullDate(from),
    };
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing3, Spacing.spacing3, Spacing.spacing3, 0),
      child: Row(
        children: [
          IconButton(
            key: const ValueKey('calendar-previous'),
            tooltip: l10n.calendarPrevious,
            icon: Icon(rtl ? Icons.chevron_right : Icons.chevron_left),
            onPressed: () => ctl.step(-1),
          ),
          TextButton(key: const ValueKey('calendar-today'), onPressed: ctl.today, child: Text(l10n.calendarToday)),
          IconButton(
            key: const ValueKey('calendar-next'),
            tooltip: l10n.calendarNext,
            icon: Icon(rtl ? Icons.chevron_left : Icons.chevron_right),
            onPressed: () => ctl.step(1),
          ),
          const SizedBox(width: Spacing.spacing3),
          Expanded(
            child: Text(title, key: const ValueKey('calendar-title'), style: Theme.of(context).textTheme.titleMedium, overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
    );
  }
}

/// The period at a glance: teaching time, distinct students, the shift used and
/// the empty time in it. Each number is the server's.
class _Figures extends StatelessWidget {
  const _Figures({required this.cal});

  final MyCalendar cal;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final lines = <Widget>[
      Text(l10n.calendarBooked(_hours(cal.bookedMinutes)), style: theme.textTheme.titleMedium),
      Text(
        [
          l10n.calendarHeld(_hours(cal.heldMinutes)),
          l10n.calendarStudents(cal.students),
          if (cal.trialStudents > 0) l10n.calendarTrialStudents(cal.trialStudents),
        ].join(' · '),
        style: theme.textTheme.bodySmall,
      ),
      if (cal.hasShift && cal.utilization != null) Text(l10n.calendarShiftUsed('${(cal.utilization! * 100).round()}%'), style: theme.textTheme.bodySmall),
      if (cal.hasShift && cal.emptyMinutes > 0)
        Text(
          l10n.calendarEmptyInShift(_hours(cal.emptyMinutes)),
          key: const ValueKey('calendar-empty-hours'),
          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
        ),
      if (cal.outsideMinutes > 0) Text(l10n.calendarOutsideHours(_hours(cal.outsideMinutes)), style: theme.textTheme.bodySmall),
      // The zone the server cut the days in, which is the zone every time here is drawn in.
      Text(
        l10n.calendarTimesIn(cal.zone.split('/').last.replaceAll('_', ' ')),
        key: const ValueKey('calendar-zone'),
        style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      ),
    ];
    return Card(
      key: const ValueKey('calendar-figures'),
      margin: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing3, Spacing.spacing5, 0),
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: lines),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend();

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final scheme = Theme.of(context).colorScheme;
    Widget entry(Widget swatch, String label) => Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        swatch,
        const SizedBox(width: Spacing.spacing2),
        // A long label wraps instead of overflowing a narrow phone.
        Flexible(child: Text(label, style: Theme.of(context).textTheme.labelSmall)),
      ],
    );
    Widget box({Color? fill, Color? border, LineStyle style = LineStyle.solid}) => CustomPaint(
      painter: _BorderPainter(color: border ?? Colors.transparent, style: style, width: border == null ? 0 : 1.5, radius: 3),
      child: Container(
        width: 18,
        height: 12,
        decoration: BoxDecoration(color: fill, borderRadius: BorderRadius.circular(3)),
      ),
    );
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing3, Spacing.spacing5, Spacing.spacing2),
      child: Wrap(
        spacing: Spacing.spacing4,
        runSpacing: Spacing.spacing2,
        children: [
          entry(box(border: scheme.error), l10n.calendarLegendEmpty),
          entry(box(fill: _outsideColor(scheme)), l10n.calendarLegendOutside),
          entry(box(fill: _leaveColor(scheme), border: scheme.tertiary), l10n.calendarLegendLeave),
          entry(box(border: scheme.outline, style: LineStyle.dashed), l10n.calendarStatusTrial),
          entry(box(border: scheme.outline), l10n.calendarStatusActive),
          entry(box(border: scheme.outline, style: LineStyle.dotted), l10n.calendarStatusPaused),
        ],
      ),
    );
  }
}

Color _outsideColor(ColorScheme s) => s.surfaceContainerHighest;
Color _shiftColor(ColorScheme s) => s.primaryContainer.withValues(alpha: 0.55);
Color _workColor(ColorScheme s) => s.surface;
Color _leaveColor(ColorScheme s) => s.tertiaryContainer;

/// The hours a day is drawn over: everything the data holds, at least 10:00-22:00.
(int, int) _hourRange(MyCalendar cal) {
  var lo = 10 * 60;
  var hi = 22 * 60;
  for (final d in cal.days) {
    for (final s in [...d.shift, ...d.work]) {
      lo = lo < minuteOfDay(s.from, d.day) ? lo : minuteOfDay(s.from, d.day);
      hi = hi > minuteOfDay(s.to, d.day) ? hi : minuteOfDay(s.to, d.day);
    }
  }
  for (final l in cal.lessons) {
    final day = dayKey(l.startsAt);
    lo = lo < minuteOfDay(l.startsAt, day) ? lo : minuteOfDay(l.startsAt, day);
    hi = hi > minuteOfDay(l.endsAt, day) ? hi : minuteOfDay(l.endsAt, day);
  }
  return ((lo ~/ 60) * 60, ((hi + 59) ~/ 60 * 60).clamp(0, 1440));
}

MyCalendarDay? _dayOf(MyCalendar cal, String day) {
  for (final d in cal.days) {
    if (d.day == day) return d;
  }
  return null;
}

/// Lanes for overlapping lessons: an overlap is drawn side by side, never hidden.
Map<String, (int, int)> _lanes(List<MyCalendarLesson> lessons) {
  final sorted = [...lessons]..sort((a, b) => a.startsAt.compareTo(b.startsAt));
  final ends = <DateTime>[];
  final at = <String, int>{};
  for (final l in sorted) {
    var lane = ends.indexWhere((e) => !e.isAfter(l.startsAt));
    if (lane == -1) {
      lane = ends.length;
      ends.add(l.endsAt);
    } else {
      ends[lane] = l.endsAt;
    }
    at[l.id] = lane;
  }
  final of = ends.isEmpty ? 1 : ends.length;
  return {for (final e in at.entries) e.key: (e.value, of)};
}

String _lessonLabel(BuildContext context, MyCalendarLesson l) {
  final l10n = L10n.of(context);
  final status = switch (l.status) {
    CalendarLessonStatus.trial => l10n.calendarStatusTrial,
    CalendarLessonStatus.paused => l10n.calendarStatusPaused,
    CalendarLessonStatus.active => l10n.calendarStatusActive,
  };
  return [
    l.title,
    '${formatClockTime(context, TimeOfDay.fromDateTime(l.startsAt))} – ${formatClockTime(context, TimeOfDay.fromDateTime(l.endsAt))}',
    status,
    if (l.outsideShift) l10n.calendarOutsideShift,
  ].join(' · ');
}

void _openLesson(BuildContext context, WidgetRef ref, MyCalendarLesson l) {
  final m = MaterialLocalizations.of(context);
  openLessonActions(
    context,
    ref,
    lessonId: l.id,
    title: l.title,
    subtitle: '${m.formatMediumDate(l.startsAt)} · ${formatClockTime(context, TimeOfDay.fromDateTime(l.startsAt))}',
  );
}

/// One day, hours down the page: grey outside the shift, the shift shaded,
/// empty shift time outlined in red, lessons in their slots.
class _DayView extends ConsumerWidget {
  const _DayView({required this.cal, required this.day});

  final MyCalendar cal;
  final String day;

  static const double hourHeight = 56;
  static const double gutter = 52;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final scheme = Theme.of(context).colorScheme;
    final (lo, hi) = _hourRange(cal);
    double y(int minute) => (minute - lo) / 60 * hourHeight;
    final height = y(hi);
    final d = _dayOf(cal, day);
    final lessons = [
      for (final l in cal.lessons)
        if (dayKey(l.startsAt) == day) l,
    ];
    final lanes = _lanes(lessons);

    Widget band(CalendarSpan s, Widget child, {double inset = 0}) {
      final top = y(minuteOfDay(s.from, day).clamp(lo, hi));
      final bottom = y(minuteOfDay(s.to, day).clamp(lo, hi));
      if (bottom <= top) return const SizedBox.shrink();
      return PositionedDirectional(top: top + inset, height: bottom - top - inset * 2, start: inset, end: inset, child: child);
    }

    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing3, Spacing.spacing3, Spacing.spacing5, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (lessons.isEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: Spacing.spacing3),
              child: Text(l10n.calendarNoLessons, key: const ValueKey('calendar-day-empty'), textAlign: TextAlign.center),
            ),
          SizedBox(
            height: height,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(
                  width: gutter,
                  height: height,
                  child: Stack(
                    children: [
                      for (var minute = lo; minute < hi; minute += 60)
                        PositionedDirectional(
                          top: y(minute) - 7,
                          start: 0,
                          child: Text(
                            formatClockTime(context, TimeOfDay(hour: minute ~/ 60, minute: 0), alwaysUse24HourFormat: true),
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        ),
                    ],
                  ),
                ),
                Expanded(
                  child: LayoutBuilder(
                    builder: (context, box) => Stack(
                      key: ValueKey('calendar-day-$day'),
                      children: [
                        Positioned.fill(child: ColoredBox(color: _outsideColor(scheme))),
                        for (var minute = lo; minute < hi; minute += 60)
                          PositionedDirectional(
                            top: y(minute),
                            start: 0,
                            end: 0,
                            child: Divider(height: 1, color: scheme.outlineVariant),
                          ),
                        for (final s in d?.shift ?? const <CalendarSpan>[]) band(s, ColoredBox(color: _shiftColor(scheme))),
                        for (final s in d?.work ?? const <CalendarSpan>[])
                          band(
                            s,
                            DecoratedBox(
                              decoration: BoxDecoration(
                                color: _workColor(scheme),
                                border: Border.all(color: scheme.outlineVariant),
                              ),
                            ),
                          ),
                        for (final s in d?.leave ?? const <CalendarSpan>[])
                          band(
                            s,
                            DecoratedBox(
                              decoration: BoxDecoration(
                                color: _leaveColor(scheme),
                                border: Border.all(color: scheme.tertiary),
                              ),
                            ),
                          ),
                        for (final s in d?.empty ?? const <CalendarSpan>[])
                          band(
                            s,
                            DecoratedBox(
                              key: const ValueKey('calendar-empty'),
                              decoration: BoxDecoration(
                                border: Border.all(color: scheme.error, width: 2),
                                borderRadius: BorderRadius.circular(6),
                              ),
                            ),
                            inset: 3,
                          ),
                        for (final l in lessons)
                          () {
                            final (lane, of) = lanes[l.id] ?? (0, 1);
                            final top = y(minuteOfDay(l.startsAt, day).clamp(lo, hi));
                            final bottom = y(minuteOfDay(l.endsAt, day).clamp(lo, hi));
                            final width = box.maxWidth / of;
                            return PositionedDirectional(
                              top: top + 1,
                              height: (bottom - top - 2).clamp(14, double.infinity),
                              start: width * lane + 2,
                              width: width - 4,
                              child: _LessonBlock(lesson: l, label: _lessonLabel(context, l), onTap: () => _openLesson(context, ref, l)),
                            );
                          }(),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

enum LineStyle { solid, dashed, dotted }

class _LessonBlock extends StatelessWidget {
  const _LessonBlock({required this.lesson, required this.label, required this.onTap, this.compact = false});

  final MyCalendarLesson lesson;
  final String label;
  final VoidCallback onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final (fill, ink) = switch (lesson.status) {
      CalendarLessonStatus.paused => (scheme.surfaceContainerHigh, scheme.onSurfaceVariant),
      CalendarLessonStatus.trial => (scheme.secondaryContainer, scheme.onSecondaryContainer),
      CalendarLessonStatus.active => (scheme.primaryContainer, scheme.onPrimaryContainer),
    };
    final style = switch (lesson.status) {
      CalendarLessonStatus.trial => LineStyle.dashed,
      CalendarLessonStatus.paused => LineStyle.dotted,
      CalendarLessonStatus.active => LineStyle.solid,
    };
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: Tooltip(
        message: label,
        child: Material(
          key: ValueKey('calendar-lesson-${lesson.id}'),
          color: fill,
          borderRadius: BorderRadius.circular(6),
          child: InkWell(
            borderRadius: BorderRadius.circular(6),
            onTap: onTap,
            child: CustomPaint(
              painter: _BorderPainter(color: scheme.primary, style: style, width: 2, radius: 6),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing2, vertical: 1),
                child: compact
                    ? const SizedBox.expand()
                    : Row(
                        children: [
                          Expanded(
                            child: Text(
                              lesson.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.labelMedium?.copyWith(color: ink),
                            ),
                          ),
                          if (lesson.outsideShift) Icon(Icons.schedule, size: 14, color: scheme.tertiary),
                        ],
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A rounded border drawn solid, dashed (trial) or dotted (paused).
class _BorderPainter extends CustomPainter {
  _BorderPainter({required this.color, required this.style, required this.width, required this.radius});

  final Color color;
  final LineStyle style;
  final double width;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    if (width <= 0) return;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = width;
    final rect = RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(radius)).deflate(width / 2);
    if (style == LineStyle.solid) {
      canvas.drawRRect(rect, paint);
      return;
    }
    final (dash, gap) = style == LineStyle.dashed ? (6.0, 4.0) : (1.5, 3.0);
    if (style == LineStyle.dotted) paint.strokeCap = StrokeCap.round;
    for (final PathMetric metric in (Path()..addRRect(rect)).computeMetrics()) {
      for (var d = 0.0; d < metric.length; d += dash + gap) {
        canvas.drawPath(metric.extractPath(d, d + dash), paint);
      }
    }
  }

  @override
  bool shouldRepaint(_BorderPainter old) => old.color != color || old.style != style || old.width != width || old.radius != radius;
}

/// A week: one strip per day (Saturday to Friday), the shift and its empty time
/// across it, lessons as blocks. A day opens the Day view.
class _WeekView extends ConsumerWidget {
  const _WeekView({required this.cal});

  final MyCalendar cal;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final m = MaterialLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final (lo, hi) = _hourRange(cal);
    // MyCalendar.fromJson refuses a malformed day, so this parses; never throw in build regardless.
    final start = DateTime.tryParse('${cal.from}T00:00:00Z');
    if (start == null) {
      return Padding(
        padding: const EdgeInsets.all(Spacing.spacing6),
        child: Text(l10n.calendarLoadFailed, textAlign: TextAlign.center),
      );
    }
    return Column(
      children: [
        for (var i = 0; i < 7; i++)
          () {
            final date = start.add(Duration(days: i));
            final day = dayKey(date);
            final d = _dayOf(cal, day);
            final lessons = [
              for (final l in cal.lessons)
                if (dayKey(l.startsAt) == day) l,
            ];
            final empty = d?.emptyMinutes ?? 0;
            return InkWell(
              key: ValueKey('calendar-week-$day'),
              onTap: () => ref.read(scheduleViewProvider.notifier).openDay(date),
              child: Padding(
                padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing3, Spacing.spacing5, Spacing.spacing3),
                child: Row(
                  children: [
                    SizedBox(
                      width: 76,
                      child: Text('${m.narrowWeekdays[date.weekday % 7]} ${m.formatShortMonthDay(date)}', style: theme.textTheme.labelMedium),
                    ),
                    Expanded(
                      child: SizedBox(
                        height: 28,
                        child: LayoutBuilder(
                          builder: (context, box) {
                            double x(DateTime t) => (minuteOfDay(t, day).clamp(lo, hi) - lo) / (hi - lo) * box.maxWidth;
                            Widget span(CalendarSpan s, Widget child, {double inset = 0}) {
                              final a = x(s.from);
                              final b = x(s.to);
                              if (b <= a) return const SizedBox.shrink();
                              return PositionedDirectional(start: a, width: b - a, top: inset, bottom: inset, child: child);
                            }

                            return Stack(
                              children: [
                                Positioned.fill(child: ColoredBox(color: _outsideColor(scheme))),
                                for (final s in d?.shift ?? const <CalendarSpan>[]) span(s, ColoredBox(color: _shiftColor(scheme))),
                                for (final s in d?.work ?? const <CalendarSpan>[]) span(s, ColoredBox(color: _workColor(scheme))),
                                for (final s in d?.leave ?? const <CalendarSpan>[]) span(s, ColoredBox(color: _leaveColor(scheme))),
                                for (final s in d?.empty ?? const <CalendarSpan>[])
                                  span(
                                    s,
                                    DecoratedBox(
                                      decoration: BoxDecoration(border: Border.all(color: scheme.error, width: 1.5)),
                                    ),
                                    inset: 3,
                                  ),
                                for (final l in lessons)
                                  span(
                                    CalendarSpan(l.startsAt, l.endsAt),
                                    _LessonBlock(lesson: l, label: _lessonLabel(context, l), onTap: () => _openLesson(context, ref, l), compact: true),
                                    inset: 2,
                                  ),
                              ],
                            );
                          },
                        ),
                      ),
                    ),
                    const SizedBox(width: Spacing.spacing3),
                    SizedBox(
                      width: 72,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(l10n.calendarDayLessons(lessons.length), style: theme.textTheme.labelSmall),
                          if (empty > 0) Text(l10n.calendarHoursShort(_hours(empty)), style: theme.textTheme.labelSmall?.copyWith(color: scheme.error)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            );
          }(),
      ],
    );
  }
}

/// A month: a grid from Saturday, each day with its lessons and, in red, the
/// shift time still empty. A day opens the Day view.
class _MonthView extends ConsumerWidget {
  const _MonthView({required this.cal, required this.month});

  final MyCalendar cal;
  final DateTime month;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final m = MaterialLocalizations.of(context);
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final first = month;
    final lead = (first.weekday + 1) % 7;
    final days = DateTime.utc(month.year, month.month + 1, 1).difference(first).inDays;
    final counts = <String, int>{};
    for (final l in cal.lessons) {
      counts.update(dayKey(l.startsAt), (n) => n + 1, ifAbsent: () => 1);
    }
    // Saturday first: MaterialLocalizations lists Sunday first (index 0).
    final names = [for (var i = 0; i < 7; i++) m.narrowWeekdays[(i + 6) % 7]];
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing3, Spacing.spacing5, 0),
      child: Column(
        children: [
          Row(
            children: [
              for (final n in names)
                Expanded(
                  child: Center(child: Text(n, style: theme.textTheme.labelSmall)),
                ),
            ],
          ),
          const SizedBox(height: Spacing.spacing2),
          GridView.count(
            crossAxisCount: 7,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            childAspectRatio: 0.8,
            children: [
              for (var i = 0; i < lead; i++) const SizedBox.shrink(),
              for (var i = 0; i < days; i++)
                () {
                  final date = first.add(Duration(days: i));
                  final day = dayKey(date);
                  final d = _dayOf(cal, day);
                  final n = counts[day] ?? 0;
                  final empty = d?.emptyMinutes ?? 0;
                  final hasHours = (d?.shift.isNotEmpty ?? false) || (d?.work.isNotEmpty ?? false);
                  final onLeave = (d?.leave.isNotEmpty ?? false);
                  return Padding(
                    padding: const EdgeInsets.all(1.5),
                    child: Material(
                      color: onLeave
                          ? _leaveColor(scheme)
                          : hasHours
                          ? _shiftColor(scheme)
                          : _outsideColor(scheme),
                      borderRadius: BorderRadius.circular(6),
                      child: Semantics(
                        button: true,
                        excludeSemantics: true,
                        label: [m.formatFullDate(date), l10n.calendarDayLessons(n), if (empty > 0) l10n.calendarEmptyInShift(_hours(empty))].join(' · '),
                        child: InkWell(
                          key: ValueKey('calendar-month-$day'),
                          borderRadius: BorderRadius.circular(6),
                          onTap: () => ref.read(scheduleViewProvider.notifier).openDay(date),
                          child: Container(
                            decoration: empty > 0
                                ? BoxDecoration(
                                    border: Border(bottom: BorderSide(color: scheme.error, width: 3)),
                                    borderRadius: BorderRadius.circular(6),
                                  )
                                : null,
                            padding: const EdgeInsets.all(Spacing.spacing2),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${date.day}', maxLines: 1, style: theme.textTheme.labelMedium),
                                const Spacer(),
                                // The lessons that day; empty shift time is the red edge (its hours are in the Day view).
                                if (n > 0)
                                  Text(
                                    '$n',
                                    maxLines: 1,
                                    softWrap: false,
                                    overflow: TextOverflow.clip,
                                    style: theme.textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w600),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  );
                }(),
            ],
          ),
        ],
      ),
    );
  }
}
