import 'package:collection/collection.dart';
import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/text_direction.dart';

/// What the user chose from the long-press sheet.
///
/// A choice, not a command: the sheet decides *what was asked for* and the chat
/// screen decides what to do about it. Keeping the two apart is what lets the
/// sheet be tested without a controller, a repository or a network.
enum MessageAction { reply, star, pin, copy, open, deleteForMe, deleteForEveryone }

/// The reactions a parent can leave.
///
/// Six, chosen once and never configurable. A picker with every emoji in it is
/// a keyboard, and this audience is being asked to acknowledge a teacher's
/// message, not to compose with it.
const kQuickReactions = <String>['❤️', '👍', '😂', '😢', '😮', '👏'];

/// A reaction tapped in the sheet, distinguished from an action by its type so
/// the caller cannot confuse the two.
class ReactionChoice {
  const ReactionChoice(this.emoji);

  final String emoji;
}

/// The outcome of the sheet: an action, a reaction, or nothing.
class MessageActionResult {
  const MessageActionResult.action(this.action) : reaction = null;
  MessageActionResult.reaction(String emoji)
      : action = null,
        reaction = ReactionChoice(emoji);

  final MessageAction? action;
  final ReactionChoice? reaction;
}

/// Long-press a message.
///
/// ## Which entries appear
///
/// Only the ones that are **valid for this message and this user** (§35). The
/// rule throughout is that an affordance the backend would refuse must be
/// absent rather than present-and-failing: a parent who taps Delete and is told
/// no has learned that the app lies, and there is no way to unlearn it.
///
/// So:
/// * Copy is for messages that have text to copy.
/// * Open is for a photo or a document — something there is to open.
/// * Delete for everyone is offered only on the user's **own** published
///   message. The server additionally enforces a time window whose length is on
///   no DTO this client can read, so this one *can* still be refused; that
///   refusal is presented, never pre-empted with a guess at the window.
/// * Nothing at all is offered on a message that is already deleted, still
///   sending, or failed — a failed bubble carries its own Retry and Discard.
///
/// Reply and React are deliberately not gated on message kind: you can answer
/// or acknowledge anything, including a voice note.
Future<MessageActionResult?> showMessageActions(
  BuildContext context, {
  required Message message,
  bool withMarks = false,
}) {
  if (!canActOn(message)) return Future.value(null);

  return showModalBottomSheet<MessageActionResult>(
    context: context,
    // The root navigator, or the sheet is clipped to the body it was opened
    // from and its last row disappears behind the tab bar.
    useRootNavigator: true,
    showDragHandle: true,
    builder: (sheetContext) => _MessageActionsSheet(message: message, withMarks: withMarks),
  );
}

/// Whether a message can be acted on at all.
///
/// Exposed so the bubble can decide whether to *offer* the long-press gesture:
/// a long press that opens an empty sheet is worse than one that does nothing.
bool canActOn(Message message) {
  if (message.isSystem || message.isDeleted) return false;
  // Still in the outbox. It has no server id, so there is nothing to react to,
  // reply to or delete — and the bubble already offers Retry and Discard.
  return !message.deliveryState.isLocal;
}

/// The actions valid for one message, in the order they are shown.
/// [withMarks] offers Star and Pin -- only when this build can reach those
/// routes. Pin is offered for a message that reached everyone; the server
/// decides whether this viewer may write (and so pin) here.
List<MessageAction> actionsFor(Message message, {bool withMarks = false}) {
  final hasText = message.body.trim().isNotEmpty;
  final openable = message.attachments.any(
    (a) => a.kind == MessageKind.image || a.kind == MessageKind.file,
  );

  return [
    MessageAction.reply,
    if (withMarks) MessageAction.star,
    if (withMarks && message.approvalState == ApprovalState.notRequired) MessageAction.pin,
    if (hasText) MessageAction.copy,
    if (openable) MessageAction.open,
    MessageAction.deleteForMe,
    // Only the author's own message, and only one that actually reached
    // everyone: a message still awaiting approval has been seen by nobody, so
    // there is nothing to retract from anyone.
    if (message.isMine && message.approvalState == ApprovalState.notRequired)
      MessageAction.deleteForEveryone,
  ];
}

class _MessageActionsSheet extends StatelessWidget {
  const _MessageActionsSheet({required this.message, required this.withMarks});

  final Message message;
  final bool withMarks;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final actions = actionsFor(message, withMarks: withMarks);
    final mine = message.reactions.firstWhereOrNull((r) => r.mine)?.emoji;

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Semantics(
            header: true,
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: Spacing.spacing5,
                vertical: Spacing.spacing2,
              ),
              child: ContentText(
                _preview(message, l10n),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ),
          ),
          _ReactionRow(selected: mine),
          const Divider(height: 1),
          // Scrollable, and Flexible so it gives way rather than overflowing.
          // Arabic sets taller than Latin and a large accessibility text size
          // taller still; a fixed Column here overflows on a small phone in
          // exactly the configuration this product's primary audience uses.
          Flexible(
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
          for (final action in actions)
            ListTile(
              leading: Icon(_iconFor(action, message)),
              title: Text(_labelFor(action, l10n, message)),
              // The two deletes are the only entries that need explaining,
              // because "for me" and "for everyone" look alike and do not
              // behave alike.
              subtitle: switch (action) {
                MessageAction.deleteForMe =>
                  Text(l10n.deleteForMeExplainer),
                MessageAction.deleteForEveryone =>
                  Text(l10n.deleteForEveryoneExplainer),
                _ => null,
              },
              textColor: _isDestructive(action)
                  ? Theme.of(context).colorScheme.error
                  : null,
              iconColor: _isDestructive(action)
                  ? Theme.of(context).colorScheme.error
                  : null,
              onTap: () =>
                  Navigator.of(context).pop(MessageActionResult.action(action)),
            ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  static bool _isDestructive(MessageAction action) =>
      action == MessageAction.deleteForMe ||
      action == MessageAction.deleteForEveryone;

  static IconData _iconFor(MessageAction action, Message message) => switch (action) {
        MessageAction.reply => Icons.reply,
        MessageAction.star => message.isStarred ? Icons.star : Icons.star_border,
        MessageAction.pin => message.isPinned ? Icons.push_pin : Icons.push_pin_outlined,
        MessageAction.copy => Icons.copy_outlined,
        MessageAction.open => Icons.open_in_new,
        MessageAction.deleteForMe => Icons.delete_outline,
        MessageAction.deleteForEveryone => Icons.delete_forever_outlined,
      };

  static String _labelFor(MessageAction action, L10n l10n, Message message) => switch (action) {
        MessageAction.reply => l10n.replyAction,
        MessageAction.star => message.isStarred ? l10n.unstarAction : l10n.starAction,
        MessageAction.pin => message.isPinned ? l10n.unpinAction : l10n.pinAction,
        MessageAction.copy => l10n.copyAction,
        MessageAction.open => l10n.openAction,
        MessageAction.deleteForMe => l10n.deleteForMeAction,
        MessageAction.deleteForEveryone => l10n.deleteForEveryoneAction,
      };

  /// What the user long-pressed, in one line.
  ///
  /// A voice note or a photo has no body, and heading the sheet with a blank
  /// line leaves the user unsure which bubble they hit.
  static String _preview(Message message, L10n l10n) {
    final body = message.body.trim();
    if (body.isNotEmpty) return body;

    final kind = message.attachments.firstOrNull?.kind ?? message.kind;
    return switch (kind) {
      MessageKind.image => l10n.attachmentPhotoLabel,
      MessageKind.voice => l10n.attachmentVoiceLabel,
      MessageKind.file || MessageKind.video => l10n.attachmentFileLabel,
      _ => l10n.messageActionsTitle,
    };
  }
}

/// The six reactions, in a row, with the viewer's current one marked.
class _ReactionRow extends StatelessWidget {
  const _ReactionRow({this.selected});

  /// The emoji this viewer has already left, if any.
  final String? selected;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing3,
        vertical: Spacing.spacing3,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          for (final emoji in kQuickReactions)
            Semantics(
              label: emoji,
              selected: emoji == selected,
              button: true,
              child: InkResponse(
                onTap: () => Navigator.of(context)
                    .pop(MessageActionResult.reaction(emoji)),
                radius: Sizes.minTouchTarget / 2,
                child: Container(
                  // The accessibility floor, not the glyph's own size: an emoji
                  // rendered at 24dp is a 24dp target unless it is given one.
                  width: Sizes.minTouchTarget,
                  height: Sizes.minTouchTarget,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: emoji == selected
                        ? tokens.colorBrandSubtle
                        : Colors.transparent,
                  ),
                  child: Text(emoji, style: const TextStyle(fontSize: 24)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
