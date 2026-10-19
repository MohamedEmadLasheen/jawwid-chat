/// PD-9 / PD-11: lesson tickets and the cards they post.
///
/// NO AUTHORIZATION LIVES HERE. Which tickets a member may open in a chat is the
/// server's answer (`GET /conversations/:id/lesson-tickets`), and each ticket is
/// decided again when it is submitted. The client only draws what it is offered.
library;

/// A form under "+" that records what happened to one lesson.
enum LessonTicketKind {
  /// Teacher: the learner attended. Closes the lesson as held.
  report,

  /// Teacher: no apology, and the lesson time has passed.
  absence,

  /// Parent: the learner cannot attend, sent before the lesson starts.
  apology,

  /// Teacher: cannot teach this lesson, sent before it starts.
  teacherApology,

  /// Parent: an emergency apology after the start. A supervisor rules on it.
  lateApology,

  /// Parent: book the make-up a teacher-cancelled lesson owes, into a free time.
  bookMakeup,

  /// Parent: ask for new regular lesson times. About a child, not one lesson.
  requestScheduleChange;

  /// The server's spelling, or null for a ticket this build does not know --
  /// which is then simply not offered.
  static LessonTicketKind? parse(String? raw) => switch (raw) {
        'report' => LessonTicketKind.report,
        'absence' => LessonTicketKind.absence,
        'apology' => LessonTicketKind.apology,
        'teacher_apology' => LessonTicketKind.teacherApology,
        'late_apology' => LessonTicketKind.lateApology,
        'book_makeup' => LessonTicketKind.bookMakeup,
        'request_schedule_change' => LessonTicketKind.requestScheduleChange,
        _ => null,
      };

  /// Whether the form asks for a reason (and refuses to submit without one).
  bool get needsReason =>
      this == apology || this == teacherApology || this == lateApology;
}

/// One ticket the server offers: for one lesson, or -- a regular-time change -- for a child.
class LessonTicket {
  const LessonTicket({
    required this.kind,
    this.lessonId,
    this.startsAt,
    this.endsAt,
    this.learnerId = '',
    this.learnerName = '',
  });

  final LessonTicketKind kind;

  /// Null for a ticket about the child rather than one lesson.
  final String? lessonId;

  /// Which child -- a family group can hold several.
  final String learnerId;
  final String learnerName;
  final DateTime? startsAt;
  final DateTime? endsAt;
}

/// The free times a make-up may be booked into, as instants (shown in the reader's clock).
class MakeupOffer {
  const MakeupOffer({required this.durationMinutes, required this.slots});

  final int durationMinutes;
  final List<DateTime> slots;
}

/// One free regular weekly time. [weekday] and [start] are in the teacher's zone and are
/// what is sent back; [nextStartsAt] is what is SHOWN, in the reader's own clock.
class WeeklyOption {
  const WeeklyOption({required this.weekday, required this.start, required this.nextStartsAt});

  final int weekday;
  final String start;
  final DateTime nextStartsAt;

  @override
  bool operator ==(Object other) => other is WeeklyOption && other.weekday == weekday && other.start == start;

  @override
  int get hashCode => Object.hash(weekday, start);
}

/// A lesson as the teacher's Schedule shows it.
class ScheduledLesson {
  const ScheduledLesson({
    required this.id,
    required this.learnerName,
    required this.startsAt,
    required this.endsAt,
    required this.kind,
    required this.phase,
    this.outcome,
  });

  final String id;
  final String learnerName;
  final DateTime startsAt;
  final DateTime endsAt;

  /// regular / makeup.
  final String kind;

  /// upcoming / in_progress / awaiting_close / overdue / closed -- the server's.
  final String phase;
  final String? outcome;
}

/// What a teacher writes about a lesson that took place. Only [covered] is required
/// (PD-11 default template): a report has to be quick or it is not written at all.
class LessonReportDraft {
  const LessonReportDraft({
    required this.covered,
    this.homework,
    this.rating,
    this.note,
  });

  final String covered;
  final String? homework;

  /// 1 to 5, or null when the teacher gives none.
  final int? rating;
  final String? note;
}

/// The structured half of a message of type `card`.
///
/// [kind] stays a string: a card this build does not know is still a message, and
/// it falls back to the plain-text body the server always sends alongside.
class MessageCard {
  const MessageCard({
    required this.kind,
    required this.payload,
    this.lessonId,
  });

  final String kind;
  final String? lessonId;
  final Map<String, Object?> payload;

  String? text(String key) {
    final v = payload[key];
    return v is String && v.trim().isNotEmpty ? v : null;
  }

  int? integer(String key) {
    final v = payload[key];
    return v is int ? v : (v is num ? v.toInt() : null);
  }

  DateTime? time(String key) {
    final v = payload[key];
    return v is String ? DateTime.tryParse(v)?.toLocal() : null;
  }

  bool flag(String key) => payload[key] == true;
}

/// A child's month, for the family (PD-10's per-child page). Counts only: nothing
/// about the teacher's performance reaches a family.
class ChildProgress {
  const ChildProgress({
    required this.attended,
    required this.apologised,
    required this.absent,
    required this.attendedAllTime,
    required this.streak,
    required this.makeupsOwed,
    this.nextLessonAt,
    this.lastCovered,
    this.lastReportAt,
  });

  final int attended;
  final int apologised;
  final int absent;
  final int attendedAllTime;

  /// Lessons attended in a row, newest first.
  final int streak;
  final int makeupsOwed;
  final DateTime? nextLessonAt;
  final String? lastCovered;
  final DateTime? lastReportAt;
}

/// A teacher's own month (PD-10: their schedule and workload, nothing else).
class TeacherWorkload {
  const TeacherWorkload({
    required this.heldLessons,
    required this.heldMinutes,
    required this.unreported,
    this.reportsOnTimeRate,
    this.availableMinutes,
  });

  final int heldLessons;
  final int heldMinutes;
  final int unreported;
  final double? reportsOnTimeRate;
  final int? availableMinutes;
}
