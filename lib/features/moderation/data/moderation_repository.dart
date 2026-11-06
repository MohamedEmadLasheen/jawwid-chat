/// PD-57 (WP-1B): reporting a message or a person, and the reporter's own reports.
///
/// Contract of record: `docs/release/google-play-blocker-roadmap-2026-11-03.md` §5.4.
/// NO AUTHORIZATION LIVES HERE: whether a target is visible, reportable or one's own is the
/// server's answer, and its `COMM.*` code reaches the caller intact.
abstract interface class ModerationRepository {
  /// False in a build with no moderation server: no Report entry is offered.
  bool get isAvailable;

  /// `POST /reports`.
  Future<ReportReceipt> submit(ReportDraft draft);

  /// `GET /me/reports` -- the signed-in user's own reports only, newest first.
  Future<List<MyReport>> mine();
}

/// The five reasons a user can pick (§5.1). `blocked` is set by the server only, so it is
/// not here; a report carrying it (or any code this build does not know) is shown with a
/// neutral label and is never sent.
enum ReportReason {
  harassment('harassment'),
  inappropriate('inappropriate'),
  spam('spam'),
  childSafety('child_safety'),
  other('other');

  const ReportReason(this.wire);

  final String wire;

  static ReportReason? fromWire(Object? raw) {
    for (final r in values) {
      if (r.wire == raw) return r;
    }
    return null;
  }
}

/// What is being reported: one message, or one person.
sealed class ReportTarget {
  const ReportTarget();
}

/// A message by its server id. The conversation is not sent: the server resolves it.
class MessageReportTarget extends ReportTarget {
  const MessageReportTarget(this.messageId);

  final String messageId;
}

/// A person, as the `{kind, id}` pair the server uses for actors (`contact`, `teacher`,
/// `staff`).
class PersonReportTarget extends ReportTarget {
  const PersonReportTarget({required this.kind, required this.id});

  final String kind;
  final String id;
}

/// A report as the user filled it in.
class ReportDraft {
  const ReportDraft({required this.target, required this.reason, this.note});

  final ReportTarget target;
  final ReportReason reason;

  /// Free text, at most [ModerationErrors.noteMaxLength] characters; required for
  /// [ReportReason.other].
  final String? note;

  /// The exact body of `POST /reports` (§5.4). The note is trimmed and omitted when blank.
  Map<String, Object?> toJson() {
    final trimmed = note?.trim();
    return {
      ...switch (target) {
        MessageReportTarget(:final messageId) => {'targetKind': 'message', 'messageId': messageId},
        PersonReportTarget(:final kind, :final id) => {
            'targetKind': 'person',
            'subject': {'kind': kind, 'id': id},
          },
      },
      'reason': reason.wire,
      if (trimmed != null && trimmed.isNotEmpty) 'note': trimmed,
    };
  }
}

/// `201 {id, status, dueAt}`; [alreadyOpen] when the server answered `200` because the
/// same report was already open.
class ReportReceipt {
  const ReportReceipt({required this.id, required this.status, this.dueAt, this.alreadyOpen = false});

  final String id;
  final String status;
  final DateTime? dueAt;
  final bool alreadyOpen;
}

/// The status of a report as the reporter sees it.
enum ReportStatus {
  open,
  inReview,
  actioned,
  dismissed;

  /// Unknown codes read as [open]: the reporter is told "received", never something invented.
  static ReportStatus fromWire(Object? raw) => switch (raw) {
        'in_review' => ReportStatus.inReview,
        'actioned' => ReportStatus.actioned,
        'dismissed' => ReportStatus.dismissed,
        _ => ReportStatus.open,
      };
}

/// The answer the reporter received. No reviewer name, by contract.
class ReportAnswer {
  const ReportAnswer({required this.text, this.at});

  final String text;
  final DateTime? at;
}

/// One row of `GET /me/reports`. No evidence and no reviewer, by contract.
class MyReport {
  const MyReport({
    required this.id,
    required this.targetKind,
    required this.reason,
    required this.status,
    required this.createdAt,
    this.answer,
  });

  final String id;

  /// `message` or `person`.
  final String targetKind;

  /// Null for a reason this build does not know (for example the server-only `blocked`).
  final ReportReason? reason;
  final ReportStatus status;
  final DateTime createdAt;
  final ReportAnswer? answer;

  bool get isPerson => targetKind == 'person';
}

/// The refusals of §5.4 that the report sheet answers in its own words.
abstract final class ModerationErrors {
  /// 404: the reporter cannot read the message now / shares no conversation with the person.
  static const targetNotVisible = 'COMM.REPORT_TARGET_NOT_VISIBLE';

  /// 400: it is one's own message or one's own account.
  static const self = 'COMM.REPORT_SELF';

  /// 400: a system or card message.
  static const notReportable = 'COMM.REPORT_NOT_REPORTABLE';

  /// 400: reason `other` with no note.
  static const noteRequired = 'COMM.REPORT_NOTE_REQUIRED';

  /// 429.
  static const rateLimited = 'COMMON.RATE_LIMITED';

  /// 403, after WP-3.
  static const termsNotAccepted = 'COMM.TERMS_NOT_ACCEPTED';

  /// The longest note the server accepts (§5.3).
  static const noteMaxLength = 500;
}

/// The build with no moderation server: no entry is offered and nothing is sent.
class NoModerationRepository implements ModerationRepository {
  const NoModerationRepository();

  @override
  bool get isAvailable => false;

  @override
  Future<ReportReceipt> submit(ReportDraft draft) => throw UnsupportedError('no moderation server in this build');

  @override
  Future<List<MyReport>> mine() async => const [];
}
