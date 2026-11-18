/// PD-32: a parent's feedback about their child's teacher.
///
/// Read through `GET /me/feedback`, written through `POST /me/feedback`. The administration
/// reviews it; the teacher never learns who wrote it, so nothing here names the parent.
library;

enum FeedbackCategory {
  praise,
  suggestion,
  complaint;

  /// The wire value.
  String get wire => name;

  static FeedbackCategory? fromWire(Object? value) =>
      FeedbackCategory.values.where((c) => c.name == value).firstOrNull;
}

enum FeedbackStatus {
  received,
  inReview,
  resolved;

  String get wire => switch (this) {
        FeedbackStatus.received => 'received',
        FeedbackStatus.inReview => 'in_review',
        FeedbackStatus.resolved => 'resolved',
      };

  /// An unknown status reads as [received]: the item was sent, and that is all the
  /// client can truthfully say about it.
  static FeedbackStatus fromWire(Object? value) =>
      FeedbackStatus.values.where((s) => s.wire == value).firstOrNull ?? FeedbackStatus.received;
}

/// A child the parent may give feedback about, with the teacher it would be about.
class FeedbackChild {
  const FeedbackChild({required this.learnerId, required this.name, this.teacherName});

  final String learnerId;
  final String name;

  /// Null when the child has no teacher yet; the server then refuses a submission
  /// (`COMM.FEEDBACK_NOT_FOUND`).
  final String? teacherName;
}

/// One piece of feedback, as its author sees it.
class FeedbackItem {
  const FeedbackItem({
    required this.id,
    required this.learnerId,
    required this.childName,
    this.teacherName,
    required this.category,
    required this.body,
    required this.status,
    this.response,
    this.respondedAt,
    this.replyUnread = false,
    required this.createdAt,
  });

  final String id;
  final String learnerId;
  final String childName;
  final String? teacherName;
  final FeedbackCategory category;
  final String body;
  final FeedbackStatus status;

  /// The staff reply, when there is one.
  final String? response;
  final DateTime? respondedAt;

  /// PD-32 amendment: a reply this parent account has not opened yet (the unread dot).
  /// Per account, decided by the server; cleared by opening the reply.
  final bool replyUnread;
  final DateTime createdAt;

  /// The same item once this account has opened its reply.
  FeedbackItem asReplySeen() => FeedbackItem(
        id: id,
        learnerId: learnerId,
        childName: childName,
        teacherName: teacherName,
        category: category,
        body: body,
        status: status,
        response: response,
        respondedAt: respondedAt,
        createdAt: createdAt,
      );
}

/// `GET /me/feedback`: the parent's children and every item they sent, newest first.
class MyFeedback {
  const MyFeedback({this.children = const [], this.items = const []});

  final List<FeedbackChild> children;
  final List<FeedbackItem> items;

  FeedbackChild? child(String learnerId) => children.where((c) => c.learnerId == learnerId).firstOrNull;

  /// One item by id; null when it is not (or no longer) the family's.
  FeedbackItem? item(String id) => items.where((i) => i.id == id).firstOrNull;

  List<FeedbackItem> forChild(String learnerId) => [
        for (final item in items)
          if (item.learnerId == learnerId) item,
      ];
}
