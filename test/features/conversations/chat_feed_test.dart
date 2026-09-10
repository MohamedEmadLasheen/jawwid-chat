import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/conversations/domain/chat_feed.dart';
import 'package:jawwid_chat/features/conversations/domain/conversation_list.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The filter chips are the whole reason Groups stopped being a tab, so what each chip
/// shows is a product guarantee rather than a display detail.
void main() {
  final now = DateTime.utc(2026, 9, 5, 12);

  Conversation conversation({
    required String id,
    required ConversationKind kind,
    required String title,
    int unread = 0,
    bool pinned = false,
    LearnerRef? learner,
  }) =>
      Conversation(
        id: id,
        kind: kind,
        title: title,
        learner: learner,
        updatedAt: now,
        lastMessageAt: now,
        unreadCount: unread,
        isPinned: pinned,
      );

  final support = conversation(
    id: 'c_support',
    kind: ConversationKind.jawwidSupport,
    title: 'جَوِّد',
    unread: 2,
    pinned: true,
  );
  final ahmed = conversation(
    id: 'c_group_1',
    kind: ConversationKind.studentGroup,
    title: 'أحمد · جَوِّد',
    learner: const LearnerRef(id: 'l_1', displayName: 'أحمد'),
    unread: 1,
  );
  final maryam = conversation(
    id: 'c_group_2',
    kind: ConversationKind.studentGroup,
    title: 'مريم · جَوِّد',
    learner: const LearnerRef(id: 'l_2', displayName: 'مريم'),
  );
  final staff = conversation(
    id: 'c_admin',
    kind: ConversationKind.adminDirect,
    title: 'إدارة جَوِّد',
  );

  List<ConversationSection> sections() => ConversationListBuilder.build(
        role: UserRole.parent,
        conversations: [support, ahmed, maryam, staff],
      );

  List<String> ids(List<Conversation> conversations) =>
      conversations.map((c) => c.id).toList();

  group('the four chips are filters of one feed', () {
    test('All shows every conversation, whatever its kind', () {
      final feed = ChatFeed.build(sections: sections(), filter: ChatFilter.all);

      expect(feed, hasLength(4));
      expect(
        ids(feed),
        containsAll(['c_support', 'c_group_1', 'c_group_2', 'c_admin']),
      );
    });

    test('Unread shows only conversations with unread messages', () {
      final feed =
          ChatFeed.build(sections: sections(), filter: ChatFilter.unread);

      expect(ids(feed), ['c_support', 'c_group_1']);
    });

    test('Groups shows the student groups — and nothing else', () {
      // This is the tab that was deleted. Everything it used to show must still be
      // reachable, and only that.
      final feed =
          ChatFeed.build(sections: sections(), filter: ChatFilter.groups);

      expect(ids(feed), ['c_group_1', 'c_group_2']);
      expect(
        feed.every((c) => c.kind == ConversationKind.studentGroup),
        isTrue,
      );
    });

    test('Favourites is the existing pin, not an invented field', () {
      final feed =
          ChatFeed.build(sections: sections(), filter: ChatFilter.favorites);

      expect(ids(feed), ['c_support']);
      expect(feed.single.isPinned, isTrue);
    });
  });

  group('nothing is lost in the flattening', () {
    test('every conversation the sections hold reaches the feed', () {
      final sectioned = sections()
          .expand((s) => s.conversations)
          .map((c) => c.id)
          .toSet();
      final flat =
          ChatFeed.build(sections: sections(), filter: ChatFilter.all)
              .map((c) => c.id)
              .toSet();

      expect(flat, sectioned);
    });

    test('the pinned Jawwid thread still leads the list', () {
      final feed = ChatFeed.build(sections: sections(), filter: ChatFilter.all);
      expect(feed.first.id, 'c_support');
    });
  });

  group('search', () {
    test('matches a conversation title, hamza and tashkeel aside', () {
      final feed = ChatFeed.build(
        sections: sections(),
        filter: ChatFilter.all,
        query: 'احمد',
      );

      expect(ids(feed), ['c_group_1']);
    });

    test('matches the child behind a group even when the title differs', () {
      // The learner's name is searchable in its own right, not only as part of the
      // composed group title.
      final feed = ChatFeed.build(
        sections: sections(),
        filter: ChatFilter.all,
        query: 'مريم',
      );

      expect(ids(feed), ['c_group_2']);
    });

    test('search composes with the active filter rather than replacing it', () {
      // Someone on the Unread chip who searches must not silently be shown read
      // conversations again.
      final feed = ChatFeed.build(
        sections: sections(),
        filter: ChatFilter.unread,
        query: 'مريم',
      );

      expect(feed, isEmpty);
    });

    test('a blank query changes nothing', () {
      final all = ChatFeed.build(sections: sections(), filter: ChatFilter.all);
      final blank = ChatFeed.build(
        sections: sections(),
        filter: ChatFilter.all,
        query: '   ',
      );

      expect(ids(blank), ids(all));
    });

    test('search does not reach into the last-message preview', () {
      // The client holds one message per conversation, so preview matching would find
      // the newest message and miss every older one. Honest omission, asserted.
      final withPreview = [
        Conversation(
          id: 'c_x',
          kind: ConversationKind.adminDirect,
          title: 'إدارة',
          updatedAt: now,
          lastMessageAt: now,
          lastMessagePreview: 'برجاء مراجعة جدول الحصص',
        ),
      ];
      final built = ConversationListBuilder.build(
        role: UserRole.parent,
        conversations: withPreview,
      );

      expect(
        ChatFeed.build(
          sections: built,
          filter: ChatFilter.all,
          query: 'الحصص',
        ),
        isEmpty,
      );
    });
  });

  group('counts', () {
    test('the unread chip counts conversations, not messages', () {
      // Two unread conversations carrying three unread messages between them.
      expect(
        ChatFeed.count(sections: sections(), filter: ChatFilter.unread),
        2,
      );
    });
  });
}
