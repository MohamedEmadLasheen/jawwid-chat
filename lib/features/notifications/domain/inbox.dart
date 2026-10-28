/// PD-34: the signed-in account's Notification Center, as the server sends it.
///
/// Text (title, body) is rendered by the server in the entry's language with times in
/// this account's zone; the app shows it as given and never builds notification copy of
/// its own. What the button opens is an [InboxAction] -- a kind and ids, never a URL.
library;

/// The Center's tabs, in display order. The server says which of them this account has.
enum InboxTab {
  all('all'),
  unread('unread'),
  action('action'),
  lessons('lessons'),
  payments('payments'),
  conversations('conversations'),
  announcements('announcements');

  const InboxTab(this.wire);

  final String wire;

  static InboxTab? tryParse(Object? v) {
    for (final t in values) {
      if (t.wire == v) return t;
    }
    return null;
  }
}

/// What an entry's button opens.
enum InboxActionKind {
  openConversation('open_conversation'),
  viewLesson('view_lesson'),
  viewPayments('view_payments'),
  openStories('open_stories'),
  openCalls('open_calls'),

  /// PD-47 PR-4: a task -- for a teacher, the Schedule's To do.
  openTask('open_task');

  const InboxActionKind(this.wire);

  final String wire;

  static InboxActionKind? tryParse(Object? v) {
    for (final k in values) {
      if (k.wire == v) return k;
    }
    return null;
  }
}

class InboxAction {
  const InboxAction(this.kind, {this.conversationId, this.lessonId, this.learnerId, this.taskId});

  final InboxActionKind kind;
  final String? conversationId;
  final String? lessonId;
  final String? learnerId;
  final String? taskId;
}

class InboxEntry {
  const InboxEntry({
    required this.id,
    required this.category,
    required this.title,
    required this.body,
    required this.at,
    required this.read,
    this.severity = 'normal',
    this.requiresAction = false,
    this.dueAt,
    this.count = 1,
    this.action,
  });

  final String id;

  /// lesson, payment, conversation, call, task, announcement, system, marketing.
  final String category;
  final String severity;
  final String title;
  final String body;
  final DateTime at;
  final bool read;
  final bool requiresAction;
  final DateTime? dueAt;
  final int count;
  final InboxAction? action;

  InboxEntry asRead() => InboxEntry(
        id: id,
        category: category,
        severity: severity,
        title: title,
        body: body,
        at: at,
        read: true,
        requiresAction: requiresAction,
        dueAt: dueAt,
        count: count,
        action: action,
      );
}

class InboxPage {
  const InboxPage({required this.entries, this.next});

  final List<InboxEntry> entries;

  /// The cursor for the next (older) page, or null at the end.
  final String? next;
}

class InboxCounts {
  const InboxCounts({required this.unread, required this.perTab, required this.tabs});

  static const empty = InboxCounts(unread: 0, perTab: {}, tabs: [InboxTab.all]);

  final int unread;
  final Map<InboxTab, int> perTab;

  /// The tabs this account has, in order.
  final List<InboxTab> tabs;
}

class CategorySetting {
  const CategorySetting({required this.category, required this.push, required this.locked});

  final String category;
  final bool push;

  /// Operational (lessons, payments, calls...): cannot be switched off.
  final bool locked;
}

class NotificationSettings {
  const NotificationSettings({
    required this.quietEnabled,
    required this.quietStartMinute,
    required this.quietEndMinute,
    required this.quietIsDefault,
    required this.showPreviews,
    required this.categories,
  });

  final bool quietEnabled;

  /// Minutes from local midnight; 1320 = 22:00.
  final int quietStartMinute;
  final int quietEndMinute;
  final bool quietIsDefault;
  final bool showPreviews;
  final List<CategorySetting> categories;
}
