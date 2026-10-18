/// PD-12 S1: what the teacher files in their private supervision conversation, and
/// their own leave. Wire shapes from `apps/api/src/supervision`, `src/certificates`
/// and `src/teacher-file/leave.*`; nothing here decides anything.
library;

/// The tickets "+" may offer in a teacher's supervision conversation.
enum SupervisionTicketKind {
  certificate,
  leave;

  static SupervisionTicketKind? parse(String? raw) => switch (raw) {
        'certificate' => SupervisionTicketKind.certificate,
        'leave' => SupervisionTicketKind.leave,
        _ => null,
      };
}

/// A learner the teacher may request a certificate for (the server's list, never a guess).
class SupervisionLearner {
  const SupervisionLearner({required this.id, required this.name});

  final String id;
  final String name;
}

/// `GET /conversations/:id/supervision-tickets`. Advisory: each ticket is re-decided on submit.
class SupervisionTickets {
  const SupervisionTickets({this.kinds = const [], this.learners = const []});

  static const none = SupervisionTickets();

  final List<SupervisionTicketKind> kinds;
  final List<SupervisionLearner> learners;
}

class CertificateDraft {
  const CertificateDraft({
    required this.learnerId,
    required this.title,
    required this.achievement,
    required this.achievedOn,
    required this.printedName,
    this.grade,
    this.note,
  });

  final String learnerId;
  final String title;
  final String achievement;

  /// A calendar date: only its year, month and day are sent.
  final DateTime achievedOn;
  final String printedName;
  final String? grade;
  final String? note;
}

enum LeaveState {
  requested,
  approved,
  declined,
  withdrawn,
  cancelled;

  static LeaveState parse(String? raw) => switch (raw) {
        'approved' => LeaveState.approved,
        'declined' => LeaveState.declined,
        'withdrawn' => LeaveState.withdrawn,
        'cancelled' => LeaveState.cancelled,
        _ => LeaveState.requested,
      };
}

class LeaveRequest {
  const LeaveRequest({
    required this.id,
    required this.firstDay,
    required this.lastDay,
    required this.days,
    required this.reason,
    required this.state,
    this.decisionNote,
  });

  final String id;

  /// Calendar dates (UTC midnight): the same day for the reader in every time zone.
  final DateTime firstDay;
  final DateTime lastDay;
  final int days;
  final String reason;
  final LeaveState state;
  final String? decisionNote;
}

/// The teacher's own leave for one year. Every number is the server's.
class LeaveSummary {
  const LeaveSummary({
    required this.year,
    required this.used,
    this.allowance,
    this.balance,
    this.requests = const [],
  });

  final int year;

  /// Null until the Teachers department types one in.
  final int? allowance;
  final int used;

  /// Null while there is no allowance. Computed by the server on every read.
  final int? balance;
  final List<LeaveRequest> requests;
}

/// `YYYY-MM-DD` for a calendar date, from its local year/month/day.
String calendarDay(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// A `YYYY-MM-DD` from the wire as a UTC date, or null.
DateTime? parseCalendarDay(Object? raw) {
  if (raw is! String || !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(raw)) return null;
  return DateTime.tryParse('${raw}T00:00:00Z');
}
