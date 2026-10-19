/// PD-11 T4: what a teacher does in their trial group. Wire shapes from
/// `apps/api/src/lessons/trial-group.service.ts` and `trial.service.ts`; nothing here
/// decides anything.
library;

/// One trial the teacher may report from "+": started, and still without an outcome.
class TrialTicket {
  const TrialTicket({
    required this.trialId,
    required this.prospectName,
    required this.startsAt,
    required this.durationMinutes,
  });

  final String trialId;

  /// A prospect is named by display name only (BR-2).
  final String prospectName;
  final DateTime startsAt;
  final int durationMinutes;
}

/// The teacher's fact about a trial: the prospect attended (with what was covered), or not.
class TrialAttendanceDraft {
  const TrialAttendanceDraft.attended({required String this.covered, this.rating, this.note}) : attended = true;
  const TrialAttendanceDraft.absent({this.note})
      : attended = false,
        covered = null,
        rating = null;

  final bool attended;
  final String? covered;

  /// 1 to 5, optional.
  final int? rating;
  final String? note;
}
