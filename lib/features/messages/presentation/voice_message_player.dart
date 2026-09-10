import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/audio/voice_player.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/duration_format.dart';
import '../application/voice_playback_controller.dart';

/// A voice note inside a message bubble.
///
/// Design rules this encodes (`design-system.md` §7.7, `cross-platform.md` §4):
///
/// * The **progress track does not mirror in RTL.** It is a timeline of physical
///   sound, so it always runs left to right; only the transport button takes the
///   bubble's leading edge, which it does for free through the surrounding
///   directionality.
/// * The duration is a **LTR run in both locales**, so `0:18` reads the same in
///   Arabic as in English.
/// * State is never carried by colour alone: the glyph changes, the label
///   changes, and both are exposed to the screen reader.
/// * The duration comes from the message, not from decoding the file, so a
///   screenful of voice notes renders without touching audio (handoff §9).
class VoiceMessagePlayer extends ConsumerWidget {
  const VoiceMessagePlayer({
    super.key,
    required this.conversationId,
    required this.attachment,
    required this.foreground,
  });

  final String conversationId;
  final Attachment attachment;

  /// The bubble's text colour, so the player reads as part of the bubble rather
  /// than as an embedded control with a palette of its own.
  final Color foreground;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    final session = ref.watch(voicePlaybackProvider(conversationId));
    final status = session.statusFor(attachment.id);

    // Until the file is loaded, the stored duration is the honest one.
    final total = status.duration ?? attachment.duration ?? Duration.zero;
    final position = status.position > total ? total : status.position;
    final url = attachment.url;

    final muted = theme.textTheme.labelSmall?.copyWith(
      color: foreground.withValues(alpha: 0.75),
    );

    if (status.hasFailed) {
      return _PlayerFrame(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 18, color: tokens.colorStatusDangerFg),
            const SizedBox(width: Spacing.spacing3),
            Flexible(
              child: Text(
                l10n.voicePlaybackFailed,
                style: muted?.copyWith(color: tokens.colorStatusDangerFg),
              ),
            ),
          ],
        ),
      );
    }

    final canPlay = url != null && url.isNotEmpty;
    final label = status.isPlaying
        ? l10n.voicePause
        : status.state == VoicePlaybackState.completed
            ? l10n.voiceReplay
            : l10n.voicePlay;

    return Semantics(
      container: true,
      // The accessible name states what this is and how long it runs, so a
      // screen-reader user knows before pressing anything.
      label: l10n.voiceMessageDuration(DurationFormat.clock(total)),
      // Without this the container absorbs the button and the seek bar into one
      // flat label, and a screen-reader user can no longer reach either.
      explicitChildNodes: true,
      child: _PlayerFrame(
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            _TransportButton(
              isLoading: status.isLoading,
              isPlaying: status.isPlaying,
              label: label,
              foreground: foreground,
              onPressed: canPlay
                  ? () => ref
                      .read(voicePlaybackProvider(conversationId).notifier)
                      .toggle(attachmentId: attachment.id, url: url)
                  : null,
            ),
            const SizedBox(width: Spacing.spacing3),
            Flexible(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _ProgressTrack(
                    position: position,
                    total: total,
                    foreground: foreground,
                    enabled: canPlay && session.isCurrent(attachment.id),
                    onSeek: (value) => ref
                        .read(voicePlaybackProvider(conversationId).notifier)
                        .seek(attachment.id, value),
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Icon plus words: a voice note is identifiable without
                      // relying on the glyph being understood.
                      Icon(Icons.mic, size: 13, color: muted?.color),
                      const SizedBox(width: Spacing.spacing2),
                      Text(l10n.voiceMessageLabel, style: muted),
                      const SizedBox(width: Spacing.spacing3),
                      // Durations never mirror and always use Western numerals.
                      Directionality(
                        textDirection: TextDirection.ltr,
                        child: Text(
                          session.isCurrent(attachment.id) && position > Duration.zero
                              ? '${DurationFormat.clock(position)} / ${DurationFormat.clock(total)}'
                              : DurationFormat.clock(total),
                          style: muted,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Sets the player apart from a text bubble without inventing a new surface.
class _PlayerFrame extends StatelessWidget {
  const _PlayerFrame({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 200),
      padding: const EdgeInsets.symmetric(vertical: Spacing.spacing1),
      child: child,
    );
  }
}

class _TransportButton extends StatelessWidget {
  const _TransportButton({
    required this.isLoading,
    required this.isPlaying,
    required this.label,
    required this.foreground,
    this.onPressed,
  });

  final bool isLoading;
  final bool isPlaying;
  final String label;
  final Color foreground;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    // Transport controls do not mirror (cross-platform.md §4): play always
    // points the way time runs, which is not a reading direction.
    final icon = isPlaying ? Icons.pause : Icons.play_arrow;

    return SizedBox.square(
      // 48x48 regardless of the glyph inside it (handoff §10).
      dimension: Sizes.minTouchTarget,
      child: IconButton(
        onPressed: onPressed,
        // The tooltip serves pointer users. The screen-reader name comes from
        // the icon's own semantic label below: Tooltip contributes a `tooltip`
        // property, which is not what assistive tech reads as the name.
        tooltip: label,
        style: IconButton.styleFrom(
          foregroundColor: foreground,
          backgroundColor: foreground.withValues(alpha: 0.12),
          shape: const CircleBorder(),
        ),
        icon: isLoading
            ? Semantics(
                label: L10n.of(context).voiceLoading,
                child: SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: foreground),
                ),
              )
            // Play/pause is announced in words, so the state is never carried by
            // the glyph alone.
            : Icon(icon, size: 22, semanticLabel: label),
      ),
    );
  }
}

/// The seek bar.
///
/// A [Slider] rather than a painted bar, because it arrives keyboard-operable
/// and screen-reader-adjustable, which a custom gesture target would not.
class _ProgressTrack extends StatelessWidget {
  const _ProgressTrack({
    required this.position,
    required this.total,
    required this.foreground,
    required this.enabled,
    required this.onSeek,
  });

  final Duration position;
  final Duration total;
  final Color foreground;
  final bool enabled;
  final ValueChanged<Duration> onSeek;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final milliseconds = total.inMilliseconds;
    final value = milliseconds <= 0
        ? 0.0
        : (position.inMilliseconds / milliseconds).clamp(0.0, 1.0);

    return SizedBox(
      height: 24,
      // A timeline of sound, so it runs the same way in both locales.
      child: Directionality(
        textDirection: TextDirection.ltr,
        child: SliderTheme(
          data: SliderTheme.of(context).copyWith(
            trackHeight: 3,
            activeTrackColor: foreground,
            inactiveTrackColor: foreground.withValues(alpha: 0.25),
            thumbColor: foreground,
            overlayColor: foreground.withValues(alpha: 0.12),
            thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
            overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
            trackShape: const RoundedRectSliderTrackShape(),
          ),
          child: Slider(
            value: value,
            // Announced as a percentage of the note rather than a bare number.
            semanticFormatterCallback: (v) =>
                l10n.voiceMessageDuration(DurationFormat.clock(total * v)),
            onChanged: enabled && milliseconds > 0
                ? (next) => onSeek(
                      Duration(milliseconds: (next * milliseconds).round()),
                    )
                : null,
          ),
        ),
      ),
    );
  }
}
