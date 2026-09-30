import 'package:flutter/material.dart';

import '../../../core/data/repositories.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/utils/relative_time.dart';

/// A call, in the conversation thread.
///
/// CENTRED AND UNATTRIBUTED, deliberately unlike a message bubble. A call is not
/// something one side said; it is something that happened between them, so it
/// reads as an event in the thread rather than a turn in the conversation. That
/// is also why it has no reply, no reaction and no long-press: see
/// `call_timeline.dart` for why a call is not a message here.
///
/// WHAT IT SHOWS: what happened, and when. Participants are named by the history
/// record's own `title` — a display name, never a number (G-07, §2 "people are
/// named, never dialled"). There is no call id, no room name and no outcome code
/// on screen.
class CallCard extends StatelessWidget {
  const CallCard({super.key, required this.call, this.onTap});

  final CallHistoryEntry call;

  /// Tapping a card does nothing in W7. Redialling from history would be a second
  /// way to start a call, and `screens/call.md` §4 puts the affordance in the
  /// conversation header where the capability check lives.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);
    final (icon, colour) = _appearance(tokens);

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing5,
        vertical: Spacing.spacing3,
      ),
      child: Center(
        child: Container(
          decoration: BoxDecoration(
            color: tokens.colorSurfaceMuted,
            borderRadius: const BorderRadius.all(Radii.radiusLg),
            border: Border.all(color: tokens.colorBorderSubtle),
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.spacing5,
            vertical: Spacing.spacing4,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: Spacing.spacing6, color: colour),
              const SizedBox(width: Spacing.spacing4),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _headline(l10n),
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: tokens.colorTextPrimary,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                    const SizedBox(height: Spacing.spacing1),
                    Text(
                      _detail(context, l10n),
                      style: Theme.of(context)
                          .textTheme
                          .bodySmall
                          ?.copyWith(color: tokens.colorTextSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _headline(L10n l10n) {
    final outcome = switch (call.outcome) {
      CallOutcome.answered => l10n.callOutcomeAnswered,
      CallOutcome.missed => l10n.callOutcomeMissed,
      CallOutcome.declined => l10n.callOutcomeDeclined,
    };
    return call.isGroup ? '${l10n.callGroup} · $outcome' : '${l10n.callVoice} · $outcome';
  }

  /// When, and for how long. The duration is the SERVER's — derived from
  /// `answered_at` — never timed on this device.
  String _detail(BuildContext context, L10n l10n) {
    final locale = Localizations.localeOf(context).toLanguageTag();
    final when = RelativeTime.forBubble(call.startedAt, locale: locale);
    final duration = call.duration;
    if (duration == null || duration == Duration.zero) return when;
    final minutes = duration.inMinutes;
    final seconds = duration.inSeconds.remainder(60);
    return '$when · ${l10n.callDuration(minutes, seconds)}';
  }

  (IconData, Color) _appearance(JawwidTokens tokens) => switch (call.outcome) {
        CallOutcome.answered => (Icons.call, tokens.colorTextSecondary),
        CallOutcome.missed => (Icons.call_missed, tokens.colorStatusDangerFg),
        CallOutcome.declined => (Icons.call_end, tokens.colorTextSecondary),
      };
}
