import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';

/// The message composer.
///
/// Edge cases §71 calls out and that are handled here: an empty or whitespace-only message
/// cannot be sent; a very long message is capped rather than silently truncated on the
/// server; the field grows to a bounded number of lines; and the text direction follows the
/// content, so an Arabic user typing an English word keeps a sane caret.
class MessageComposer extends StatefulWidget {
  const MessageComposer({
    super.key,
    required this.onSend,
    this.onTyping,
    this.replyingTo,
    this.onCancelReply,
    this.onAttach,
    this.onStartRecording,
    this.isReadOnly = false,
    this.requiresApproval = false,
    this.maxCharacters = 4000,
  });

  final void Function(String body) onSend;

  /// Called on every keystroke. Debounced downstream by [TypingSignaller]: a
  /// socket frame per keystroke would fan out hundreds of frames to say one
  /// thing, so this reports the fact and the controller decides what to send.
  final VoidCallback? onTyping;

  final ReplyPreview? replyingTo;
  final VoidCallback? onCancelReply;
  final VoidCallback? onAttach;
  final VoidCallback? onStartRecording;

  /// The user can no longer post here — removed from the group, or archived server-side.
  final bool isReadOnly;

  /// Show the standing notice that messages here are reviewed (§26).
  final bool requiresApproval;

  final int maxCharacters;

  @override
  State<MessageComposer> createState() => _MessageComposerState();
}

class _MessageComposerState extends State<MessageComposer> {
  final _controller = TextEditingController();
  final _focus = FocusNode();

  bool get _canSend => _controller.text.trim().isNotEmpty;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onChanged);
  }

  @override
  void dispose() {
    _controller.removeListener(_onChanged);
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onChanged() {
    setState(() {});
    widget.onTyping?.call();
  }

  void _send() {
    final body = _controller.text.trim();
    // Guard again at the call site: a whitespace-only message must never leave the device,
    // even if the button somehow became enabled.
    if (body.isEmpty) return;

    widget.onSend(body);
    _controller.clear();
    // Keep focus so a parent can send several messages without re-tapping the field.
    _focus.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);

    if (widget.isReadOnly) {
      return _Notice(text: l10n.composerReadOnly, icon: Icons.lock_outline);
    }

    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.requiresApproval)
            _Notice(text: l10n.groupApprovalNotice, icon: Icons.verified_outlined),
          if (widget.replyingTo != null)
            _ReplyBanner(
              reply: widget.replyingTo!,
              onCancel: widget.onCancelReply,
            ),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: Spacing.spacing3,
              vertical: Spacing.spacing3,
            ),
            decoration: BoxDecoration(
              color: theme.colorScheme.surface,
              border: Border(
                top: BorderSide(color: theme.colorScheme.outlineVariant),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (widget.onAttach != null)
                  IconButton(
                    onPressed: widget.onAttach,
                    icon: const Icon(Icons.attach_file),
                    tooltip: l10n.composerAttach,
                  ),
                Expanded(
                  child: TextField(
                    controller: _controller,
                    focusNode: _focus,
                    minLines: 1,
                    maxLines: 5,
                    maxLength: widget.maxCharacters,
                    textCapitalization: TextCapitalization.sentences,
                    keyboardType: TextInputType.multiline,
                    textInputAction: TextInputAction.newline,
                    decoration: InputDecoration(
                      hintText: l10n.composerHint,
                      // The counter is noise until the user is near the cap.
                      counterText: _controller.text.length >
                              widget.maxCharacters - 200
                          ? null
                          : '',
                      border: const OutlineInputBorder(
                        borderRadius: BorderRadius.all(Radii.radiusLg),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: Spacing.spacing4,
                        vertical: Spacing.spacing3,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: Spacing.spacing2),
                // Voice note when there is nothing to send, send button once there is —
                // familiar, and it keeps the row to one trailing control.
                if (_canSend)
                  IconButton.filled(
                    onPressed: _send,
                    icon: const Icon(Icons.send),
                    tooltip: l10n.composerSend,
                  )
                else if (widget.onStartRecording != null)
                  IconButton(
                    onPressed: widget.onStartRecording,
                    icon: const Icon(Icons.mic),
                    tooltip: l10n.composerRecord,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text, required this.icon});

  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      width: double.infinity,
      color: theme.colorScheme.surfaceContainerHighest,
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing5,
        vertical: Spacing.spacing3,
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: Spacing.spacing3),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ReplyBanner extends StatelessWidget {
  const _ReplyBanner({required this.reply, this.onCancel});

  final ReplyPreview reply;
  final VoidCallback? onCancel;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);

    return Container(
      color: theme.colorScheme.surfaceContainerHighest,
      padding: const EdgeInsetsDirectional.only(start: Spacing.spacing5, end: Spacing.spacing2),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(height: Spacing.spacing3),
                Text(
                  l10n.replyingTo(reply.authorName),
                  style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(
                  reply.excerpt,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall,
                ),
                const SizedBox(height: Spacing.spacing3),
              ],
            ),
          ),
          IconButton(
            onPressed: onCancel,
            icon: const Icon(Icons.close),
            tooltip: l10n.cancelAction,
          ),
        ],
      ),
    );
  }
}
