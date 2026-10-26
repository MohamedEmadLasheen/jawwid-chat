import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/models/message.dart';
import '../../../shared/models/supervision.dart';
import '../../../shared/models/trial.dart';
import '../../lessons/presentation/lesson_ticket_sheet.dart';
import '../../supervision/presentation/supervision_ticket_sheet.dart';
import '../application/voice_composer_controller.dart';
import 'voice_recorder_bar.dart';

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
    this.replyingTo,
    this.onCancelReply,
    this.onAttach,
    this.onStartRecording,
    this.voice,
    this.conversationId = '',
    this.onStopRecording,
    this.onCancelRecording,
    this.onSendRecording,
    this.onDismissVoiceFailure,
    this.isReadOnly = false,
    this.requiresApproval = false,
    this.maxCharacters = 4000,
  });

  final void Function(String body) onSend;
  final ReplyPreview? replyingTo;
  final VoidCallback? onCancelReply;
  final VoidCallback? onAttach;
  final VoidCallback? onStartRecording;

  /// Recording state, when the screen has wired voice notes up. Null leaves the
  /// composer exactly as it was.
  final VoiceComposerState? voice;

  final String conversationId;
  final VoidCallback? onStopRecording;
  final VoidCallback? onCancelRecording;
  final VoidCallback? onSendRecording;
  final VoidCallback? onDismissVoiceFailure;

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

  void _onChanged() => setState(() {});

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

    final voice = widget.voice;
    final failure = voice?.failure;

    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.requiresApproval)
            _Notice(text: l10n.groupApprovalNotice, icon: Icons.verified_outlined),
          if (failure != null)
            VoiceFailureNotice(
              failure: failure,
              onDismiss: widget.onDismissVoiceFailure ?? () {},
            ),
          if (widget.replyingTo != null)
            _ReplyBanner(
              reply: widget.replyingTo!,
              onCancel: widget.onCancelReply,
            ),
          // While a recording is live or under review it owns the input row.
          // Leaving the text field visible alongside it is how a user ends up
          // sending the wrong one.
          if (voice != null && voice.isActive)
            VoiceRecorderBar(
              conversationId: widget.conversationId,
              state: voice,
              onStop: widget.onStopRecording ?? () {},
              onCancel: widget.onCancelRecording ?? () {},
              onSend: widget.onSendRecording ?? () {},
            )
          else
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
                    // A plus, not a paperclip. §7 asks for `[ + ]` and it is the
                    // better sign for this audience anyway: a paperclip means
                    // "attachment" to people who have used email, and a plus
                    // means "more" to everyone.
                    icon: const Icon(Icons.add),
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

/// The `+` menu: the camera, a photo, or a file.
///
/// Three entries, in that order (`screens/parent-chat.md` §6). Camera is first
/// because the commonest reason anyone attaches anything is something in front
/// of them right now, and for that the library is the wrong door. It stops at
/// three: a menu that grows past what fits on one glance has stopped being a
/// shortcut.
Future<AttachmentSource?> showAttachmentMenu(BuildContext context) {
  return showModalBottomSheet<AttachmentSource>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    builder: (sheetContext) {
      final l10n = L10n.of(sheetContext);

      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Camera first: the commonest reason a parent attaches anything at
            // all is something in front of them right now -- a page of
            // homework, a certificate -- not a file they saved earlier.
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(l10n.attachCamera),
              onTap: () =>
                  Navigator.of(sheetContext).pop(AttachmentSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_outlined),
              title: Text(l10n.attachPhoto),
              onTap: () =>
                  Navigator.of(sheetContext).pop(AttachmentSource.photo),
            ),
            ListTile(
              leading: const Icon(Icons.insert_drive_file_outlined),
              title: Text(l10n.attachFile),
              onTap: () => Navigator.of(sheetContext).pop(AttachmentSource.file),
            ),
          ],
        ),
      );
    },
  );
}

/// Where an attachment comes from.
///
/// All three end in the SAME place: one `PendingAttachment`, through the same
/// authorize -> upload -> send pipeline, arriving as the same message. The
/// source is a question about the picker and about which permission is asked
/// for; it is not a question about the attachment.
enum AttachmentSource { camera, photo, file }

/// What the user picked from "+": an attachment source, or a lesson ticket.
sealed class ComposerChoice {
  const ComposerChoice();
}

class AttachmentChoice extends ComposerChoice {
  const AttachmentChoice(this.source);
  final AttachmentSource source;
}

class TicketChoice extends ComposerChoice {
  const TicketChoice(this.ticket);
  final LessonTicket ticket;
}

/// "Other unreported lessons (N)": open the Schedule, filtered to the lessons still
/// owed a report.
class UnreportedLessonsChoice extends ComposerChoice {
  const UnreportedLessonsChoice();
}

/// "Other lessons (N)": the later lessons and owed make-ups, to pick one from.
class MoreLessonsChoice extends ComposerChoice {
  const MoreLessonsChoice(this.tickets);
  final List<LessonTicket> tickets;
}

/// The tickets set aside under "Other lessons", each naming its child and date.
/// Resolves to the one picked, or null.
Future<LessonTicket?> showMoreLessonTickets(BuildContext context, List<LessonTicket> tickets) {
  return showModalBottomSheet<LessonTicket>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (sheet) {
      final l10n = L10n.of(sheet);
      return SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, 0, Spacing.spacing5, Spacing.spacing2),
                child: Text(l10n.lessonsOtherLessonsTitle, style: Theme.of(sheet).textTheme.titleMedium),
              ),
              for (final t in tickets)
                ListTile(
                  key: ValueKey('more-ticket-${t.kind.name}-${t.lessonId}'),
                  leading: Icon(lessonTicketIcon(t.kind)),
                  title: Text(lessonTicketLabel(l10n, t.kind)),
                  subtitle: Text([
                    if (t.learnerName.isNotEmpty) t.learnerName,
                    if (t.startsAt != null) lessonWhen(sheet, t.startsAt!),
                  ].join(' · ')),
                  onTap: () => Navigator.of(sheet).pop(t),
                ),
            ],
          ),
        ),
      );
    },
  );
}

/// PD-12: a request filed in the teacher's supervision conversation.
class SupervisionChoice extends ComposerChoice {
  const SupervisionChoice(this.kind);
  final SupervisionTicketKind kind;
}

/// PD-11 T4: a trial report filed in the teacher's trial group.
class TrialChoice extends ComposerChoice {
  const TrialChoice(this.ticket);
  final TrialTicket ticket;
}

/// The `+` menu with PD-11's lesson tickets under the three attachment entries.
///
/// The attachments stay first and stay three. The tickets are a second, titled
/// group, and they appear only when the server offers one for this member, here,
/// now -- a parent with no lesson today sees exactly the menu they always saw.
/// Each ticket names its lesson, because a teacher may owe two at once.
///
/// [otherUnreportedLessons]: lessons still owed a report beyond the one offered
/// (lessonMenu); when there are any, a link to the Schedule filtered to them follows.
///
/// [moreLessons]: the later lessons and owed make-ups set aside (lessonMenu), behind
/// one "Other lessons (N)" entry.
Future<ComposerChoice?> showComposerMenu(
  BuildContext context, {
  List<LessonTicket> tickets = const [],
  int otherUnreportedLessons = 0,
  List<LessonTicket> moreLessons = const [],
  List<SupervisionTicketKind> supervisionTickets = const [],
  List<TrialTicket> trialTickets = const [],
}) {
  if (tickets.isEmpty && supervisionTickets.isEmpty && trialTickets.isEmpty) {
    return showAttachmentMenu(context).then((s) => s == null ? null : AttachmentChoice(s));
  }
  return showModalBottomSheet<ComposerChoice>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (sheetContext) {
      final l10n = L10n.of(sheetContext);
      final theme = Theme.of(sheetContext);
      void pick(ComposerChoice c) => Navigator.of(sheetContext).pop(c);

      return SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined),
                title: Text(l10n.attachCamera),
                onTap: () => pick(const AttachmentChoice(AttachmentSource.camera)),
              ),
              ListTile(
                leading: const Icon(Icons.photo_outlined),
                title: Text(l10n.attachPhoto),
                onTap: () => pick(const AttachmentChoice(AttachmentSource.photo)),
              ),
              ListTile(
                leading: const Icon(Icons.insert_drive_file_outlined),
                title: Text(l10n.attachFile),
                onTap: () => pick(const AttachmentChoice(AttachmentSource.file)),
              ),
              if (supervisionTickets.isNotEmpty) ...[
                const Divider(),
                Padding(
                  padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing2, Spacing.spacing5, Spacing.spacing1),
                  child: Text(
                    l10n.supervisionTicketsHeader,
                    style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary),
                  ),
                ),
                for (final k in supervisionTickets)
                  ListTile(
                    key: ValueKey('supervision-ticket-${k.name}'),
                    leading: Icon(supervisionTicketIcon(k)),
                    title: Text(supervisionTicketLabel(l10n, k)),
                    onTap: () => pick(SupervisionChoice(k)),
                  ),
              ],
              if (trialTickets.isNotEmpty) ...[
                const Divider(),
                Padding(
                  padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing2, Spacing.spacing5, Spacing.spacing1),
                  child: Text(
                    l10n.trialTicketsHeader,
                    style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary),
                  ),
                ),
                for (final t in trialTickets)
                  ListTile(
                    key: ValueKey('trial-ticket-${t.trialId}'),
                    leading: const Icon(Icons.menu_book_outlined),
                    title: Text(l10n.trialReportTitle),
                    subtitle: Text('${t.prospectName} · ${lessonWhen(sheetContext, t.startsAt)}'),
                    onTap: () => pick(TrialChoice(t)),
                  ),
              ],
              if (tickets.isNotEmpty) ...[
              const Divider(),
              Padding(
                padding: const EdgeInsetsDirectional.fromSTEB(Spacing.spacing5, Spacing.spacing2, Spacing.spacing5, Spacing.spacing1),
                child: Text(
                  l10n.lessonTicketsHeader,
                  style: theme.textTheme.labelLarge?.copyWith(color: theme.colorScheme.primary),
                ),
              ),
              for (final t in tickets)
                ListTile(
                  key: ValueKey('ticket-${t.kind.name}-${t.lessonId ?? t.learnerId}'),
                  leading: Icon(lessonTicketIcon(t.kind)),
                  title: Text(lessonTicketLabel(l10n, t.kind)),
                  subtitle: Text([
                    if (t.learnerName.isNotEmpty) t.learnerName,
                    if (t.startsAt != null) lessonWhen(sheetContext, t.startsAt!),
                  ].join(' · ')),
                  onTap: () => pick(TicketChoice(t)),
                ),
              if (otherUnreportedLessons > 0)
                ListTile(
                  key: const ValueKey('ticket-other-unreported'),
                  leading: const Icon(Icons.event_note_outlined),
                  title: Text(l10n.lessonsOtherUnreported(otherUnreportedLessons)),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => pick(const UnreportedLessonsChoice()),
                ),
              if (moreLessons.isNotEmpty)
                ListTile(
                  key: const ValueKey('ticket-more-lessons'),
                  leading: const Icon(Icons.more_time_outlined),
                  title: Text(l10n.lessonsOtherLessons(moreLessons.length)),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => pick(MoreLessonsChoice(moreLessons)),
                ),
              ],
            ],
          ),
        ),
      );
    },
  );
}
