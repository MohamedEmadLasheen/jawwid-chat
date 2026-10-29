/// PD-9 / PD-11: lesson tickets and the cards they post.
///
/// NO AUTHORIZATION LIVES HERE. Which tickets a member may open in a chat is the
/// server's answer (`GET /conversations/:id/lesson-tickets`), and each ticket is
/// decided again when it is submitted. The client only draws what it is offered.
library;

import '../utils/app_clock.dart';
import 'materials.dart';

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

  /// "Book the make-up lesson" (PD-15, renamed by PD-31): after any apology, the time
  /// the family and the teacher agreed. A parent picks from the teacher's free times; a
  /// teacher may record another agreed time.
  bookMakeup,

  /// PD-31: "Change lesson time" -- about a child, not one lesson (no lessonId). Family
  /// and teacher: move this lesson only, or ask for new weekly times.
  changeLessonTime;

  /// The server's spelling, or null for a ticket this build does not know --
  /// which is then simply not offered.
  static LessonTicketKind? parse(String? raw) => switch (raw) {
        'report' => LessonTicketKind.report,
        'absence' => LessonTicketKind.absence,
        'apology' => LessonTicketKind.apology,
        'teacher_apology' => LessonTicketKind.teacherApology,
        'late_apology' => LessonTicketKind.lateApology,
        'book_makeup' => LessonTicketKind.bookMakeup,
        'change_lesson_time' => LessonTicketKind.changeLessonTime,
        // PD-31: still emitted for old builds; "Change lesson time" replaces it here.
        'request_schedule_change' => null,
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
    this.suggestedLessonNumber,
    this.suggestedLessonTotal,
  });

  final LessonTicketKind kind;

  /// PD-15, a report ticket only: the lesson number the form starts from.
  final int? suggestedLessonNumber;

  /// PD-30: the M of "Lesson N of M" -- the lessons of the subscription the lesson falls
  /// in. Null when the child has no subscription on record ("Lesson N").
  final int? suggestedLessonTotal;

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
  const MakeupOffer({required this.durationMinutes, required this.slots, this.locked});

  final int durationMinutes;
  final List<DateTime> slots;

  /// PD-30: null, or why the child's lessons are paused (`balance` / `overdue`).
  final String? locked;
}

/// PD-31: a regular weekly time as the server takes it back -- ISO [weekday] 1..7 and
/// 'HH:MM' [start], both in the TEACHER's zone.
typedef WeeklyKey = ({int weekday, String start});

/// One free regular weekly time. [weekday] and [start] are in the teacher's zone and are
/// what is sent back; [nextStartsAt] is what is SHOWN, in the reader's own clock.
class WeeklyOption {
  const WeeklyOption({required this.weekday, required this.start, required this.nextStartsAt, this.except = const []});

  final int weekday;
  final String start;
  final DateTime nextStartsAt;

  /// PD-31: starts in the next four weeks at which the teacher already has another
  /// lesson -- those weeks are skipped, and the picker and the summary say so.
  final List<DateTime> except;

  WeeklyKey get key => (weekday: weekday, start: start);

  @override
  bool operator ==(Object other) => other is WeeklyOption && other.weekday == weekday && other.start == start;

  @override
  int get hashCode => Object.hash(weekday, start);
}

/// PD-31: `GET /lessons/:id/move-slots` -- where one lesson may move to.
class MoveOffer {
  const MoveOffer({
    required this.lessonId,
    required this.startsAt,
    required this.durationMinutes,
    this.timezone,
    this.slots = const [],
    this.locked,
    this.refusal,
    this.familyMovesLeft,
  });

  final String lessonId;

  /// The lesson's current start, in the reader's clock.
  final DateTime startsAt;
  final int durationMinutes;
  final String? timezone;

  /// The free starts, in the reader's clock. Empty when [refusal] is set.
  final List<DateTime> slots;

  /// PD-30: null, or why the child's lessons are paused.
  final String? locked;

  /// Why this lesson cannot move, before anything is picked: `started`, `not_movable`,
  /// `family_already_moved`, `family_monthly_limit` or `too_late`.
  final String? refusal;

  /// A family reader only: the moves left for this child this month.
  final int? familyMovesLeft;

  bool get isLocked => locked != null;
}

/// PD-31: `GET /learners/:id/schedule-options` -- the child's current weekly times and
/// the teacher's free ones (which include the current).
class ScheduleOptions {
  const ScheduleOptions({
    this.timezone,
    this.durationMinutes = 0,
    this.locked,
    this.current = const [],
    this.options = const [],
  });

  /// The TEACHER's zone: what a weekly [WeeklyKey] and `effectiveFrom` mean.
  final String? timezone;
  final int durationMinutes;
  final String? locked;
  final List<GroupChildSlot> current;
  final List<WeeklyOption> options;

  bool get isLocked => locked != null;
}

/// PD-31: `GET /learners/:id/schedule`, as the family's child schedule reads it.
class ChildSchedule {
  const ChildSchedule({this.slots = const [], this.teacherName, this.hasPendingRequest = false});

  final List<GroupChildSlot> slots;
  final String? teacherName;

  /// A weekly-time request is waiting for the supervision team.
  final bool hasPendingRequest;
}

/// A lesson as the teacher's Schedule -- and, PD-31, a child's schedule -- shows it.
class ScheduledLesson {
  const ScheduledLesson({
    required this.id,
    required this.learnerName,
    required this.startsAt,
    required this.endsAt,
    required this.kind,
    required this.phase,
    this.outcome,
    this.learnerId = '',
    this.acts = const [],
    this.suspendedFor,
    this.teacherName,
    this.movedFrom,
    this.movedTo,
    this.movedBy,
    this.movedFromStartsAt,
  });

  final String id;
  final String learnerId;
  final String learnerName;
  final DateTime startsAt;
  final DateTime endsAt;

  /// regular / makeup.
  final String kind;

  /// upcoming / in_progress / awaiting_close / overdue / closed -- the server's.
  final String phase;
  final String? outcome;

  /// PD-30: why a `suspended` lesson is: `payment` when the system held it while the
  /// child's group is locked. Null otherwise.
  final String? suspendedFor;

  /// What the server says the reader may open on this lesson now (`acts`). Advisory:
  /// each is decided again on submit.
  final List<LessonTicketKind> acts;

  final String? teacherName;

  /// PD-31: the lesson this one replaced.
  final String? movedFrom;

  /// PD-31: for a lesson moved away (`rescheduled`), its replacement's start.
  final DateTime? movedTo;

  /// PD-31: `family` / `teacher` / `staff` -- who moved THIS lesson here.
  final String? movedBy;

  /// PD-31: for a lesson moved here, the start of the lesson it replaced.
  final DateTime? movedFromStartsAt;

  int get durationMinutes => endsAt.difference(startsAt).inMinutes;

  /// Open, and started: the teacher still owes its report.
  bool get needsReport =>
      outcome == null && (phase == 'in_progress' || phase == 'awaiting_close' || phase == 'overdue');
}

/// What a teacher writes about a lesson that took place (PD-15): mostly taps -- the
/// lesson number, what was covered and what is needed next as choices, a performance
/// level -- and short optional text. What was covered is required: at least one topic
/// or a short line. The note is private: supervisors read it, the family never does.
class LessonReportDraft {
  const LessonReportDraft({
    this.lessonNumber,
    this.coveredTopics = const [],
    this.covered,
    this.rating,
    this.nextTasks = const [],
    this.homework,
    this.note,
    this.practice,
    this.lessonTotal,
  });

  final int? lessonNumber;

  /// PD-30: the M of "Lesson N of M", as the server kept it on the report. Read back
  /// only -- never sent: the server works it out.
  final int? lessonTotal;

  /// Codes from `report_vocab.dart` (the server's report-vocab.ts).
  final List<String> coveredTopics;
  final String? covered;

  /// The performance level: 1 (needs more work) to 5 (excellent), or null.
  final int? rating;
  final List<String> nextTasks;
  final String? homework;
  final String? note;

  /// PD-29: the report's practice (ayah ranges and library items, shown on its card).
  /// Null means "not sent": on an edit the server then keeps what the report has.
  final List<PracticeDraft>? practice;

  bool get isComplete => coveredTopics.isNotEmpty || (covered?.trim().isNotEmpty ?? false);

  Map<String, Object?> toJson() => {
        'lessonNumber': ?lessonNumber,
        'coveredTopics': coveredTopics,
        'covered': ?covered,
        'rating': ?rating,
        'nextTasks': nextTasks,
        'homework': ?homework,
        'note': ?note,
        if (practice != null) 'practice': [for (final p in practice!) p.toJson()],
      };
}

/// PD-15 / PD-50: what `GET /lessons/:id` tells a teacher or staff reader about an
/// excuse that the group card deliberately leaves out. The server decides who reads
/// each field; a blank one arrives here as null. NEVER fetched for a parent.
class LessonStaffDetails {
  const LessonStaffDetails({this.note, this.category, this.familyWords});

  /// The internal reason (`outcomeNote`): a supervisor's excuse, a teacher's apology.
  final String? note;

  /// The excuse's category code (`excuseCategory`). For a teacher's own apology this is
  /// staff data: the card payload never carries it.
  final String? category;

  /// A family's own words on its late apology (`ruling.reason`), which a PD-50 card
  /// replaces with the category.
  final String? familyWords;
}

/// One child of a group, as its details page shows it (PD-15): each child apart, so
/// siblings' courses, times and packages are never confused.
class GroupChild {
  const GroupChild({
    required this.id,
    required this.name,
    this.age,
    this.courseName,
    this.packageLessons,
    this.teacherId,
    this.teacherName,
    this.schedule = const [],
  });

  final String id;
  final String name;
  final int? age;
  final String? courseName;
  final int? packageLessons;

  /// PD-17: whose student this child is. Only a match with the signed-in teacher
  /// offers the Student Profile; the server still decides when it is opened.
  final String? teacherId;
  final String? teacherName;
  final List<GroupChildSlot> schedule;
}

/// A child's regular weekly time, in the teacher's zone: ISO [weekday] 1..7, [start] 'HH:MM'.
class GroupChildSlot {
  const GroupChildSlot({
    required this.weekday,
    required this.start,
    required this.durationMinutes,
    this.nextStartsAt,
  });

  final int weekday;
  final String start;
  final int durationMinutes;

  /// PD-22: the next real start, in the account's zone. What a reader is shown: the
  /// weekday itself can differ from [weekday] in another country.
  final DateTime? nextStartsAt;

  WeeklyKey get key => (weekday: weekday, start: start);
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
    return AppClock.parse(v);
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
    this.lastCoveredTopics = const [],
    this.lastReportAt,
    this.certificates = const [],
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

  /// PD-15: the latest report's topic codes (shown with their labels).
  final List<String> lastCoveredTopics;
  final DateTime? lastReportAt;

  /// PD-12: issued student certificates, newest first.
  final List<ProgressCertificate> certificates;
}

/// One issued student certificate on a child's progress (PD-12). Its file is the
/// attachment of the card in [conversationId] -- opened there, signed for the reader.
class ProgressCertificate {
  const ProgressCertificate({required this.id, required this.title, required this.achievedOn, this.grade, this.conversationId});

  final String id;
  final String title;

  /// A calendar date (UTC midnight).
  final DateTime achievedOn;
  final String? grade;
  final String? conversationId;
}

/// A teacher's own month (PD-10: their schedule and workload, nothing else).
class TeacherWorkload {
  const TeacherWorkload({
    required this.heldLessons,
    required this.heldMinutes,
    required this.unreported,
    this.reportsOnTimeRate,
    this.availableMinutes,
    this.movesByTeacher,
  });

  final int heldLessons;
  final int heldMinutes;
  final int unreported;
  final double? reportsOnTimeRate;
  final int? availableMinutes;

  /// PD-31: lessons the teacher moved this month. A fact, NOT a violation.
  final int? movesByTeacher;
}
