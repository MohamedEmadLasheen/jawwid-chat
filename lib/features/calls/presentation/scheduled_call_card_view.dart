import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/conversation.dart';
import '../../../shared/models/lesson.dart';
import '../../../shared/utils/clock_time.dart';
import '../../../shared/utils/text_direction.dart';
import '../../conversations/application/conversations_controller.dart';
import '../domain/scheduled_call.dart';
import 'calls_actions.dart';

/// PD-13: a scheduled call or a call link, drawn inside its message bubble.
///
/// Returns null for any other card kind, so the bubble's chain moves on and an
/// unknown kind still falls back to the plain-text body.
///
/// `call_scheduled` and `call_link` carry a Join button that is enabled inside
/// `[joinableFrom, joinableUntil]` by THIS device's clock, re-checked at the tap
/// and re-drawn when the window opens or closes while the chat is on screen. The
/// server's answer to Join is final either way. `call_schedule_cancelled` is
/// muted and has no button. The card content never changes after it is posted,
/// so a cancellation is its own card and an earlier card's Join simply meets the
/// server's 409.
Widget? scheduledCallCardView(
  BuildContext context,
  MessageCard card,
  Color foreground, {
  required String conversationId,
}) {
  if (!ScheduledCallCards.all.contains(card.kind)) return null;
  return ScheduledCallCard(
    card: card,
    foreground: foreground,
    conversationId: conversationId,
  );
}

class ScheduledCallCard extends ConsumerStatefulWidget {
  const ScheduledCallCard({
    super.key,
    required this.card,
    required this.foreground,
    required this.conversationId,
    this.clock,
  });

  final MessageCard card;
  final Color foreground;
  final String conversationId;

  /// "Now", for the join window. Defaults to [DateTime.now].
  final DateTime Function()? clock;

  @override
  ConsumerState<ScheduledCallCard> createState() => _ScheduledCallCardState();
}

class _ScheduledCallCardState extends ConsumerState<ScheduledCallCard> {
  Timer? _boundary;
  bool _joining = false;

  DateTime _now() => (widget.clock ?? DateTime.now)();

  bool get _cancelled => widget.card.kind == ScheduledCallCards.cancelled;
  DateTime? get _from => widget.card.time('joinableFrom');
  DateTime? get _until => widget.card.time('joinableUntil');

  bool _open(DateTime now) {
    final from = _from;
    final until = _until;
    if (_cancelled || from == null || until == null) return false;
    return isWithinWindow(now, from, until);
  }

  @override
  void initState() {
    super.initState();
    _scheduleBoundary();
  }

  @override
  void didUpdateWidget(covariant ScheduledCallCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    _scheduleBoundary();
  }

  /// Redraw when the window next opens or closes, if that is soon. A chat left
  /// open on a card for a call starting in ten minutes should light its button
  /// without a scroll.
  void _scheduleBoundary() {
    _boundary?.cancel();
    _boundary = null;
    if (_cancelled) return;
    final now = _now();
    final from = _from;
    final until = _until;
    final next = from != null && now.isBefore(from)
        ? from
        : until != null && !now.isAfter(until)
        ? until.add(const Duration(seconds: 1))
        : null;
    if (next == null) return;
    final wait = next.difference(now);
    if (wait > const Duration(hours: 12)) return;
    _boundary = Timer(wait, () {
      if (!mounted) return;
      setState(() {});
      _scheduleBoundary();
    });
  }

  @override
  void dispose() {
    _boundary?.cancel();
    super.dispose();
  }

  Future<void> _join() async {
    final l10n = L10n.of(context);
    // Re-evaluated at the tap: the button may have been drawn a while ago.
    if (!_open(_now())) {
      showCallsSnack(context, l10n.scheduledJoinNotJoinable);
      setState(() {});
      return;
    }
    final id = widget.card.text('scheduledCallId');
    if (id == null) return;

    setState(() => _joining = true);
    // The call screen's wording: the conversation's name, from the chat list
    // the app already holds. Never fetched specially, and never required.
    Conversation? conversation;
    try {
      final sections = await ref.read(conversationsControllerProvider.future);
      conversation = conversationById([
        for (final section in sections) ...section.conversations,
      ], widget.conversationId);
    } catch (_) {
      conversation = null;
    }
    if (!mounted) return;
    await joinScheduledCall(
      context,
      ref,
      scheduledCallId: id,
      conversationId: widget.conversationId,
      peerLabel: conversation == null
          ? (widget.card.text('title') ?? l10n.scheduledCallDefaultTitle)
          : conversationLabel(l10n, conversation),
      isGroup: conversation != null && isGroupConversation(conversation),
    );
    if (mounted) setState(() => _joining = false);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final card = widget.card;
    final foreground = widget.foreground;
    final muted = foreground.withValues(alpha: 0.75);
    final isLink =
        card.kind == ScheduledCallCards.link || card.text('kind') == 'link';

    final (icon, heading) = _cancelled
        ? (Icons.event_busy_outlined, l10n.scheduledCallCancelled)
        : isLink
        ? (Icons.link, l10n.scheduledCallLinkLabel)
        : (Icons.event_outlined, l10n.scheduledCallDefaultTitle);

    final title = card.text('title');
    // PD-22: the moment, in THIS reader's zone. The server's `when` is written in the
    // academy's zone for everyone in the conversation; it is only the fallback for a card
    // that carries no `startsAt`.
    final when =
        _formatStart(context, card.time('startsAt')) ?? card.text('when');
    final by = card.text('byName');
    final open = _open(_now());
    final notYet =
        !_cancelled && !open && _from != null && _now().isBefore(_from!);

    return Semantics(
      container: true,
      label: heading,
      child: Opacity(
        opacity: _cancelled ? 0.7 : 1,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Icon(icon, size: 20, color: _cancelled ? muted : foreground),
                const SizedBox(width: Spacing.spacing2),
                Flexible(
                  child: Text(
                    heading,
                    style: theme.textTheme.titleSmall?.copyWith(
                      color: _cancelled ? muted : foreground,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            if (title != null)
              Padding(
                padding: const EdgeInsets.only(top: Spacing.spacing1),
                child: ContentText(
                  title,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: _cancelled ? muted : foreground,
                    decoration: _cancelled ? TextDecoration.lineThrough : null,
                  ),
                ),
              ),
            if (when != null)
              Padding(
                padding: const EdgeInsets.only(top: Spacing.spacing1),
                child: Text(
                  when,
                  style: theme.textTheme.labelMedium?.copyWith(color: muted),
                ),
              ),
            if (by != null)
              Padding(
                padding: const EdgeInsets.only(top: Spacing.spacing1),
                child: Text(
                  l10n.scheduledCallBy(by),
                  style: theme.textTheme.labelSmall?.copyWith(color: muted),
                ),
              ),
            if (!_cancelled) ...[
              const SizedBox(height: Spacing.spacing3),
              FilledButton.icon(
                key: const ValueKey('scheduled-call-join'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(
                    Sizes.minTouchTarget,
                    Sizes.minTouchTarget,
                  ),
                ),
                icon: const Icon(Icons.call_outlined, size: 18),
                label: Text(l10n.scheduledCallJoin),
                onPressed: open && !_joining ? _join : null,
              ),
              if (notYet)
                Padding(
                  padding: const EdgeInsets.only(top: Spacing.spacing2),
                  child: Text(
                    l10n.scheduledCallJoinHint,
                    style: theme.textTheme.labelSmall?.copyWith(color: muted),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  static String? _formatStart(BuildContext context, DateTime? start) {
    if (start == null) return null;
    final material = MaterialLocalizations.of(context);
    return '${material.formatMediumDate(start)} · '
        '${formatClockTime(context, TimeOfDay.fromDateTime(start), alwaysUse24HourFormat: MediaQuery.alwaysUse24HourFormatOf(context))}';
  }
}
