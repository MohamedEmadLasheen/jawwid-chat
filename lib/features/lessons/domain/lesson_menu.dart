import '../../../shared/models/lesson.dart';

/// What the "+" menu's Lesson section shows in one chat (owner 2026-10-24).
///
/// The server offers every ticket the clock allows -- an apology for each of a child's
/// lessons in the next two weeks, a report for each lesson still open, a make-up for
/// each lesson still owed one. Listing them all made the section a column of
/// "I can't teach this lesson" / "Apologise for the lesson" for every date, so the menu
/// shows THE relevant lesson of each child here:
///
/// * teacher: a lesson that started (in progress or ended) and has no report gets
///   "Write lesson report" -- the most recent one when several are owed; the rest are
///   counted in [otherUnreported] and reached from the Schedule. Otherwise "I can't
///   teach this lesson" for the NEXT upcoming lesson only;
/// * parent: "Apologise for the lesson" for the NEXT upcoming lesson only, and one
///   "Reschedule a make-up class" (the oldest lesson still owed one);
/// * everything set aside is in [more], one tap further ("Other lessons (N)"), so no
///   lesson becomes unreachable -- a parent has no Schedule tab.
///
/// A late apology and a regular-time change pass through as offered. This decides what
/// is drawn, never what is allowed -- the server decides each ticket again on submit.
class LessonMenu {
  const LessonMenu({this.tickets = const [], this.otherUnreported = 0, this.more = const []});

  final List<LessonTicket> tickets;

  /// Lessons still owed a report beyond the one offered, across the children here.
  final int otherUnreported;

  /// The upcoming lessons and owed make-ups not shown in [tickets], soonest first.
  final List<LessonTicket> more;
}

/// The kinds narrowed to one per child, and which end of the dates is "the" one.
const _oneEach = {
  LessonTicketKind.report: _Pick.latest,
  LessonTicketKind.teacherApology: _Pick.earliest,
  LessonTicketKind.apology: _Pick.earliest,
  LessonTicketKind.bookMakeup: _Pick.earliest,
};

enum _Pick { earliest, latest }

LessonMenu lessonMenu(List<LessonTicket> offered) {
  // The same lesson offered twice is one entry (a make-up ticket names its lesson).
  final seen = <String>{};
  final unique = [
    for (final t in offered)
      if (t.lessonId == null || seen.add('${t.kind.name}:${t.lessonId}')) t,
  ];

  final byChild = <(LessonTicketKind, String), List<LessonTicket>>{};
  for (final t in unique) {
    if (_oneEach.containsKey(t.kind)) (byChild[(t.kind, t.learnerId)] ??= []).add(t);
  }
  int byStart(LessonTicket a, LessonTicket b) => (a.startsAt ?? DateTime(0)).compareTo(b.startsAt ?? DateTime(0));

  final keep = <LessonTicket>{};
  for (final MapEntry(key: (kind, _), value: group) in byChild.entries) {
    group.sort(byStart);
    keep.add(_oneEach[kind] == _Pick.latest ? group.last : group.first);
  }
  // A child still owed a report is asked for it, not offered "I can't teach".
  final reported = {for (final t in keep) if (t.kind == LessonTicketKind.report) t.learnerId};
  bool shown(LessonTicket t) => switch (t.kind) {
        LessonTicketKind.teacherApology => keep.contains(t) && !reported.contains(t.learnerId),
        LessonTicketKind.report || LessonTicketKind.apology || LessonTicketKind.bookMakeup => keep.contains(t),
        // PD-15: an absence is reached from inside its lesson's report entry; a teacher
        // is offered one only together with that report.
        LessonTicketKind.absence => !byChild.containsKey((LessonTicketKind.report, t.learnerId)),
        _ => true,
      };

  return LessonMenu(
    tickets: [for (final t in unique) if (shown(t)) t],
    otherUnreported: unique.where((t) => t.kind == LessonTicketKind.report).length -
        keep.where((t) => t.kind == LessonTicketKind.report).length,
    more: [
      for (final t in unique)
        if (!shown(t) && t.kind != LessonTicketKind.report && t.kind != LessonTicketKind.absence) t,
    ]..sort(byStart),
  );
}
