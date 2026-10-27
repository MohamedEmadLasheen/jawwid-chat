import '../utils/app_clock.dart';

/// PD-38 P2: a teacher's own schedule (`GET /me/calendar`) -- their shift or
/// working hours, leave, the shift time no lesson holds, and their lessons, with
/// the period's figures. Every number is the server's (`chat.calendar_capacity`,
/// the same definition the administration reads); the app only lays it out.
///
/// Every instant is shown in the [MyCalendar.zone] the server names -- the zone it cut
/// the days in (the account's, PD-22) -- never the device's own, so a lesson always
/// sits on the day the server put it on.

/// One stretch of time, [from] to [to] (exclusive), as wall-clock in the account's zone.
class CalendarSpan {
  const CalendarSpan(this.from, this.to);

  final DateTime from;
  final DateTime to;

  Duration get length => to.difference(from);
}

/// One day of the teacher's own calendar: what each stretch of it is.
class MyCalendarDay {
  const MyCalendarDay({required this.day, this.shift = const [], this.work = const [], this.leave = const [], this.empty = const [], this.free = const []});

  /// `YYYY-MM-DD`, in the account's zone.
  final String day;

  /// The shift (full or part shift), shaded.
  final List<CalendarSpan> shift;

  /// Working hours, for an hourly teacher (their availability).
  final List<CalendarSpan> work;

  /// Approved leave and days off.
  final List<CalendarSpan> leave;

  /// Shift time no lesson, pause or leave holds: "available time without a student".
  final List<CalendarSpan> empty;

  /// The same, within an hourly teacher's working hours (not an alarm).
  final List<CalendarSpan> free;

  int get emptyMinutes => empty.fold(0, (n, s) => n + s.length.inMinutes);
}

/// trial / active / paused (moved-away lessons hold no time and are not sent).
enum CalendarLessonStatus {
  active,
  trial,
  paused;

  static CalendarLessonStatus parse(Object? raw) => switch (raw) {
    'trial' => trial,
    'paused' => paused,
    _ => active,
  };
}

class MyCalendarLesson {
  const MyCalendarLesson({
    required this.id,
    required this.startsAt,
    required this.endsAt,
    required this.kind,
    required this.status,
    this.outcome,
    this.learnerName,
    this.prospectName,
    this.outsideShift = false,
    this.moved = false,
  });

  final String id;
  final DateTime startsAt;
  final DateTime endsAt;

  /// regular / makeup / trial.
  final String kind;
  final CalendarLessonStatus status;
  final String? outcome;
  final String? learnerName;

  /// A trial lesson's prospective student.
  final String? prospectName;

  /// Booked outside the teacher's shift.
  final bool outsideShift;

  /// Moved here from another time (PD-31).
  final bool moved;

  String get title => learnerName ?? prospectName ?? '';
}

class MyCalendar {
  const MyCalendar({
    required this.zone,
    required this.from,
    required this.to,
    required this.category,
    required this.days,
    required this.lessons,
    this.lessonCount = 0,
    this.bookedMinutes = 0,
    this.heldMinutes = 0,
    this.students = 0,
    this.trialStudents = 0,
    this.shiftMinutes = 0,
    this.emptyMinutes = 0,
    this.outsideMinutes = 0,
    this.leaveMinutes = 0,
    this.utilization,
  });

  final String zone;

  /// `YYYY-MM-DD`, [from] inclusive, [to] exclusive.
  final String from;
  final String to;

  /// full_shift / part_shift / hourly / unset.
  final String category;
  final List<MyCalendarDay> days;
  final List<MyCalendarLesson> lessons;

  /// Lessons reserved for a student (and trials) in the period.
  final int lessonCount;

  /// Their time, overlaps counted once.
  final int bookedMinutes;
  final int heldMinutes;

  /// Distinct students (each once), and trial prospects.
  final int students;
  final int trialStudents;

  final int shiftMinutes;
  final int emptyMinutes;
  final int outsideMinutes;
  final int leaveMinutes;

  /// Share of the shift (less leave) booked; null without a shift.
  final double? utilization;

  bool get hasShift => category == 'full_shift' || category == 'part_shift';

  /// `GET /me/calendar`'s body, or null when it is not one.
  static MyCalendar? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final zone = raw['zone'];
    final from = raw['from'];
    final to = raw['to'];
    if (zone is! String || from is! String || to is! String || !_day.hasMatch(from) || !_day.hasMatch(to)) return null;
    DateTime? at(Object? v) {
      final parsed = v is String ? DateTime.tryParse(v) : null;
      return parsed == null ? null : AppClock.viewIn(parsed, zone);
    }

    int n(Object? v) => v is num ? v.toInt() : 0;
    final totals = raw['totals'] is Map ? raw['totals'] as Map : const {};
    final teaching = raw['teaching'] is Map ? raw['teaching'] as Map : const {};
    final students = raw['students'] is Map ? raw['students'] as Map : const {};
    return MyCalendar(
      zone: zone,
      from: from,
      to: to,
      category: raw['category'] is String ? raw['category'] as String : 'unset',
      days: [for (final d in (raw['days'] as List?) ?? const []) ?_dayOf(d, at)],
      lessons: [for (final l in (raw['lessons'] as List?) ?? const []) ?_lesson(l, at)],
      lessonCount: n(teaching['lessons']),
      bookedMinutes: n(teaching['bookedMinutes']),
      heldMinutes: n(teaching['heldMinutes']),
      students: n(students['distinct']),
      trialStudents: n(students['trial']),
      shiftMinutes: n(totals['shiftMinutes']),
      emptyMinutes: n(totals['emptyMinutes']),
      outsideMinutes: n(totals['outsideMinutes']),
      leaveMinutes: n(totals['inShiftLeaveMinutes']),
      utilization: (raw['utilization'] as num?)?.toDouble(),
    );
  }

  static final _day = RegExp(r'^\d{4}-\d{2}-\d{2}$');

  static List<CalendarSpan> _spans(Object? raw, DateTime? Function(Object?) at) => [
    for (final pair in (raw as List?) ?? const [])
      if (pair is List && pair.length == 2)
        if ((at(pair[0]), at(pair[1])) case (final DateTime a, final DateTime b)) CalendarSpan(a, b),
  ];

  static MyCalendarDay? _dayOf(Object? raw, DateTime? Function(Object?) at) {
    if (raw is! Map || raw['day'] is! String || !_day.hasMatch(raw['day'] as String)) return null;
    return MyCalendarDay(
      day: raw['day'] as String,
      shift: _spans(raw['shift'], at),
      work: _spans(raw['work'], at),
      leave: _spans(raw['leave'], at),
      empty: _spans(raw['empty'], at),
      free: _spans(raw['free'], at),
    );
  }

  static MyCalendarLesson? _lesson(Object? raw, DateTime? Function(Object?) at) {
    if (raw is! Map || raw['id'] is! String) return null;
    final starts = at(raw['startsAt']);
    final ends = at(raw['endsAt']);
    if (starts == null || ends == null) return null;
    final learner = raw['learner'] is Map ? raw['learner'] as Map : null;
    final prospect = raw['prospect'] is Map ? raw['prospect'] as Map : null;
    return MyCalendarLesson(
      id: raw['id'] as String,
      startsAt: starts,
      endsAt: ends,
      kind: raw['kind'] is String ? raw['kind'] as String : 'regular',
      status: CalendarLessonStatus.parse(raw['status']),
      outcome: raw['outcome'] as String?,
      learnerName: learner?['name'] as String?,
      prospectName: prospect?['name'] as String?,
      outsideShift: raw['outsideShift'] == true,
      moved: raw['movedFrom'] is String,
    );
  }
}
