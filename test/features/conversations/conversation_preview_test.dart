import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/conversations/presentation/conversation_tile.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';

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
}
