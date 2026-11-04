import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

/// The chat list's preview line: the server sends a KIND for anything that is
/// not text, and the app words it in the reader's language.
void main() {
  Conversation conv({String preview = '', String? kind}) => Conversation(
        id: 'c',
        kind: ConversationKind.adminDirect,
        title: 't',
        updatedAt: DateTime.utc(2026, 10, 17),
        lastMessagePreview: preview,
        lastMessageKind: kind,
      );

  final en = lookupL10n(const Locale('en'));
  final ar = lookupL10n(const Locale('ar'));

  test('text previews as itself', () {
    expect(previewText(conv(preview: 'hello'), en), 'hello');
  });

  test('media, deletion and system events are worded, in each language', () {
    expect(previewText(conv(kind: 'image'), en), en.attachmentPhotoLabel);
    expect(previewText(conv(kind: 'voice'), ar), ar.attachmentVoiceLabel);
    expect(previewText(conv(kind: 'video'), en), 'Video');
    expect(previewText(conv(kind: 'file'), en), en.attachmentFileLabel);
    expect(previewText(conv(kind: 'deleted'), en), en.messageDeleted);
    expect(previewText(conv(kind: 'system:group.created'), en), en.systemGroupCreatedNoLearner);
    expect(previewText(conv(kind: 'system:something.new'), en), en.systemUpdate);
  });

  test('no last message, no preview -- never an id or raw data', () {
    expect(previewText(conv(), en), '');
    expect(previewText(conv(kind: 'unknown-kind'), en), '');
  });

  // RQA-F4 (release-qa walk): a chat whose last item was a card showed no preview line.
  test('a card is named by its kind, in each language; an unknown or payload-worded kind says it is an update', () {
    expect(previewText(conv(kind: 'card:lesson_report'), en), en.cardReportTitle);
    expect(previewText(conv(kind: 'card:lesson_makeup_booked'), ar), ar.cardMakeupBookedTitle);
    expect(previewText(conv(kind: 'card:lesson_apology'), en), en.cardApologyTitle);
    expect(previewText(conv(kind: 'card:lesson_ruling'), en), en.systemUpdate);
    expect(previewText(conv(kind: 'card:'), en), en.systemUpdate);
  });

  test("the wire's card kind reaches the preview: lastMessage {type: card, cardKind}", () {
    Conversation read(Map<String, Object?> last) => WireMappers.conversation(
          {'id': 'c1', 'type': 'student_group', 'lastActivityAt': '2026-11-02T10:00:00Z', 'members': const [], 'lastMessage': last},
          viewerRole: UserRole.teacher,
        );
    expect(read({'type': 'card', 'cardKind': 'lesson_report', 'text': null, 'deleted': false}).lastMessageKind, 'card:lesson_report');
    expect(previewText(read({'type': 'card', 'cardKind': 'lesson_report', 'text': null, 'deleted': false}), en), en.cardReportTitle);
    // A deleted card is a deleted message, as any other.
    expect(read({'type': 'card', 'cardKind': 'lesson_report', 'deleted': true}).lastMessageKind, 'deleted');
  });
}

