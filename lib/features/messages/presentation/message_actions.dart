import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';

/// What the user chose from a message's long-press menu.
enum MessageAction { reply, forward, edit, copy, deleteForMe, deleteForEveryone }

/// Which actions a message actually offers.
///
/// THE BACKEND REMAINS AUTHORITATIVE. This decides what to SHOW, and it is
/// deliberately a little conservative — an action the server would refuse is
/// worse than an action the user has to discover elsewhere, because a refusal
/// after the tap reads as a broken app rather than as a rule.
///
/// The rules mirror `AuthorizationService.canEditMessage` and
/// `canDeleteForEveryone`, which is why the window is passed in rather than
/// hardcoded: both come from server config, and a client that invented its own
/// number would drift the moment operations retuned it.
class MessageCapabilities {
  const MessageCapabilities({
    required this.canReply,
    required this.canReact,
    required this.canForward,
    required this.canEdit,
    required this.canCopy,
    required this.canDeleteForMe,
    required this.canDeleteForEveryone,
  });

  factory MessageCapabilities.of(
    Message message, {
    required bool isReadOnly,
    Duration editWindow = const Duration(minutes: 15),
    Duration deleteWindow = const Duration(hours: 1),
    DateTime? now,
  }) {
    final at = now ?? DateTime.now();
    final age = at.difference(message.createdAt);

    // A message that never reached the server has no server-side identity, so
    // nothing here applies to it: the failed-send bubble offers retry and
    // discard instead.
    final isConfirmed = message.id != null && !message.deliveryState.isLocal;
    final isActionable = isConfirmed && !message.isDeleted && !message.isSystem;

    // A message held for approval is not visible to anyone else yet. Offering
    // to forward it would be offering to spread something the group has not
    // been shown, and the server refuses it for exactly that reason.
    final isPublished = message.approvalState == ApprovalState.notRequired;

    return MessageCapabilities(
      canReply: isActionable && isPublished && !isReadOnly,
      canReact: isActionable && isPublished && !isReadOnly,
      canForward: isActionable && isPublished && message.kind == MessageKind.text,
      canEdit: isActionable &&
          isPublished &&
          message.isMine &&
          message.kind == MessageKind.text &&
          !isReadOnly &&
          age < editWindow,
      canCopy: isActionable && message.body.isNotEmpty,
      // Hiding one's own copy destroys nothing and needs no window — a
      // participant may always tidy their own view.
      canDeleteForMe: isConfirmed && !message.isSystem,
      // Shown for the author inside the window. A moderator holding
      // messages.delete may also do it at any age, and the server allows that;
      // the mobile client has no moderator, so it does not offer it.
      canDeleteForEveryone: isActionable && message.isMine && age < deleteWindow,
    );
  }

  final bool canReply;
  final bool canReact;
  final bool canForward;
  final bool canEdit;
  final bool canCopy;
  final bool canDeleteForMe;
  final bool canDeleteForEveryone;

  bool get hasAny =>
      canReply || canReact || canForward || canEdit || canCopy || canDeleteForMe || canDeleteForEveryone;
}

/// The long-press sheet: a reaction row above a list of actions.
///
/// A bottom sheet rather than a context menu, because it is the familiar shape
/// on both platforms for a touch long-press and it leaves room for the reaction
/// row a context menu cannot hold comfortably.
///
/// Returns the chosen [MessageAction], or calls [onReact] and closes.
Future<MessageAction?> showMessageActions(
  BuildContext context, {
  required Message message,
  required MessageCapabilities capabilities,
  required void Function(String emoji) onReact,
}) {
  final l10n = L10n.of(context);

  return showModalBottomSheet<MessageAction>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) {
      final mine = message.reactions.where((r) => r.mine).firstOrNull;

      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (capabilities.canReact)
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: Spacing.spacing4,
                  vertical: Spacing.spacing2,
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    for (final emoji in kReactionEmoji)
                      _ReactionButton(
                        emoji: emoji,
                        // The one already applied is highlighted, and tapping it
                        // removes it — one reaction per person, which is what
                        // the server's unique index enforces.
                        isSelected: mine?.emoji == emoji,
                        onTap: () {
                          onReact(emoji);
                          Navigator.of(sheetContext).pop();
                        },
                      ),
                  ],
                ),
              ),
            if (capabilities.canReact) const Divider(height: 1),
            if (capabilities.canReply)
              _ActionTile(
                icon: Icons.reply,
                label: l10n.messageActionReply,
                action: MessageAction.reply,
              ),
            if (capabilities.canForward)
              _ActionTile(
                icon: Icons.forward,
                label: l10n.messageActionForward,
                action: MessageAction.forward,
              ),
            if (capabilities.canEdit)
              _ActionTile(
                icon: Icons.edit_outlined,
                label: l10n.messageActionEdit,
                action: MessageAction.edit,
              ),
            if (capabilities.canCopy)
              _ActionTile(
                icon: Icons.copy_outlined,
                label: l10n.messageActionCopy,
                action: MessageAction.copy,
              ),
            if (capabilities.canDeleteForMe)
              _ActionTile(
                icon: Icons.visibility_off_outlined,
                label: l10n.messageActionDeleteForMe,
                action: MessageAction.deleteForMe,
              ),
            if (capabilities.canDeleteForEveryone)
              _ActionTile(
                icon: Icons.delete_outline,
                label: l10n.messageActionDeleteForEveryone,
                action: MessageAction.deleteForEveryone,
                isDestructive: true,
              ),
          ],
        ),
      );
    },
  );
}

/// Confirm before withdrawing a message from everyone.
///
/// Deliberately confirmed and the per-user delete is not: hiding your own copy
/// is reversible and private, whereas this one changes what other people see
/// and cannot be undone.
Future<bool> confirmDeleteForEveryone(BuildContext context) async {
  final l10n = L10n.of(context);

  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l10n.deleteForEveryoneConfirmTitle),
      content: Text(l10n.deleteForEveryoneConfirmBody),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: Text(l10n.cancelAction),
        ),
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(true),
          style: TextButton.styleFrom(
            foregroundColor: Theme.of(dialogContext).colorScheme.error,
          ),
          child: Text(l10n.deleteAction),
        ),
      ],
    ),
  );
  return confirmed ?? false;
}

/// Edit a message in place.
///
/// Returns the new body, or null if the user cancelled or changed nothing.
Future<String?> showEditMessage(BuildContext context, Message message) async {
  final l10n = L10n.of(context);
  final controller = TextEditingController(text: message.body);

  final result = await showDialog<String>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l10n.editMessageTitle),
      content: TextField(
        controller: controller,
        autofocus: true,
        minLines: 1,
        maxLines: 6,
        // Content decides its own direction, so an Arabic message being edited
        // keeps a sane caret when an English word is typed into it.
        textDirection: null,
        decoration: InputDecoration(hintText: l10n.composerHint),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: Text(l10n.cancelAction),
        ),
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(controller.text.trim()),
          child: Text(l10n.saveAction),
        ),
      ],
    ),
  );

  controller.dispose();
  if (result == null || result.isEmpty || result == message.body) return null;
  return result;
}

/// Put a message body on the clipboard.
Future<void> copyMessage(BuildContext context, Message message) async {
  await Clipboard.setData(ClipboardData(text: message.body));
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(L10n.of(context).messageCopied)));
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.label,
    required this.action,
    this.isDestructive = false,
  });

  final IconData icon;
  final String label;
  final MessageAction action;
  final bool isDestructive;

  @override
  Widget build(BuildContext context) {
    final colour = isDestructive ? Theme.of(context).colorScheme.error : null;

    return ListTile(
      leading: Icon(icon, color: colour),
      title: Text(label, style: TextStyle(color: colour)),
      onTap: () => Navigator.of(context).pop(action),
    );
  }
}

class _ReactionButton extends StatelessWidget {
  const _ReactionButton({
    required this.emoji,
    required this.isSelected,
    required this.onTap,
  });

  final String emoji;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Semantics(
      button: true,
      selected: isSelected,
      child: InkWell(
        onTap: onTap,
        borderRadius: const BorderRadius.all(Radii.radiusFull),
        child: Container(
          padding: const EdgeInsets.all(Spacing.spacing3),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isSelected
                ? theme.colorScheme.primaryContainer
                : Colors.transparent,
          ),
          child: Text(emoji, style: const TextStyle(fontSize: 24)),
        ),
      ),
    );
  }
}
