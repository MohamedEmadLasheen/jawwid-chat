import 'package:flutter/material.dart';

import '../../../core/audio/voice_recorder.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/message.dart';
import '../../../shared/utils/duration_format.dart';
import '../application/voice_composer_controller.dart';
import 'voice_message_player.dart';

/// The composer's recording surface.
///
/// It replaces the text row rather than sitting beside it, so there is never a
/// moment where both a text field and a live recording are competing for the
/// same send button — which is the source of most "it sent the wrong thing"
/// reports in a chat composer.
///
/// Three states, and every one of them offers a way out: recording (stop or
/// delete), review (play, delete, send), and failed (dismiss).
class VoiceRecorderBar extends StatelessWidget {
  const VoiceRecorderBar({
    super.key,
    required this.conversationId,
    required this.state,
    required this.onStop,
    required this.onCancel,
    required this.onSend,
  });

  final String conversationId;
  final VoiceComposerState state;
  final VoidCallback onStop;
  final VoidCallback onCancel;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.spacing3,
        vertical: Spacing.spacing3,
      ),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(top: BorderSide(color: theme.colorScheme.outlineVariant)),
      ),
      child: state.isReviewing ? _review(context) : _recording(context),
    );
  }

  Widget _recording(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    return Row(
      children: [
        IconButton(
          onPressed: onCancel,
          icon: const Icon(Icons.delete_outline),
          tooltip: l10n.voiceDeleteRecording,
          color: tokens.colorStatusDangerFg,
        ),
        Expanded(
          child: Semantics(
            liveRegion: true,
            label: l10n.voiceRecordingElapsed(DurationFormat.clock(state.elapsed)),
            child: Row(
              children: [
                _RecordingIndicator(amplitude: state.amplitude),
                const SizedBox(width: Spacing.spacing3),
                Expanded(
                  child: Text(
                    l10n.voiceRecordingInProgress,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
                // A clock, so it does not mirror and keeps Western numerals.
                Directionality(
                  textDirection: TextDirection.ltr,
                  child: Text(
                    DurationFormat.clock(state.elapsed),
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: Spacing.spacing2),
        IconButton.filled(
          // Disabled while the capture session is still opening, so a fast
          // second tap cannot stop a recording that has not started.
          onPressed: state.isRecording ? onStop : null,
          icon: const Icon(Icons.stop),
          tooltip: l10n.voiceStopRecording,
        ),
      ],
    );
  }

  Widget _review(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final draft = state.draft!;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.voiceReviewTitle,
          style: theme.textTheme.labelSmall?.copyWith(color: tokens.colorTextSecondary),
        ),
        const SizedBox(height: Spacing.spacing2),
        Row(
          children: [
            IconButton(
              onPressed: onCancel,
              icon: const Icon(Icons.delete_outline),
              tooltip: l10n.voiceDeleteRecording,
              color: tokens.colorStatusDangerFg,
            ),
            Expanded(
              // The same player the recipient sees, pointed at the local file:
              // the sender hears exactly what they are about to send, and there
              // is one playback implementation rather than two.
              child: VoiceMessagePlayer(
                conversationId: conversationId,
                attachment: Attachment(
                  id: _draftAttachmentId,
                  kind: MessageKind.voice,
                  url: draft.filePath,
                  mimeType: draft.mimeType,
                  byteSize: draft.byteSize,
                  durationMs: draft.duration.inMilliseconds,
                ),
                foreground: tokens.colorTextPrimary,
              ),
            ),
            const SizedBox(width: Spacing.spacing2),
            IconButton.filled(
              onPressed: onSend,
              icon: const Icon(Icons.send),
              tooltip: l10n.voiceSendRecording,
            ),
          ],
        ),
      ],
    );
  }

  /// Stable across rebuilds so the preview player is not reloaded — and
  /// deliberately not a real attachment id, which only a stored note has.
  static const _draftAttachmentId = 'voice-draft';
}

/// A pulsing dot that also grows with input level.
///
/// The pulse is the *state* indicator and the level is *feedback*: a muted or
/// broken microphone still shows a recording that is running, which a bare level
/// meter would render as "nothing is happening".
class _RecordingIndicator extends StatefulWidget {
  const _RecordingIndicator({required this.amplitude});

  final double amplitude;

  @override
  State<_RecordingIndicator> createState() => _RecordingIndicatorState();
}

class _RecordingIndicatorState extends State<_RecordingIndicator>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // `prefers-reduced-motion` collapses all motion (handoff §10); the dot stays
    // visible and the text label still says a recording is running, so the state
    // is never carried by the animation alone.
    //
    // Read here rather than in initState because it depends on MediaQuery, and
    // it can change while the recording is running.
    final reduceMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (reduceMotion) {
      _pulse.stop();
    } else if (!_pulse.isAnimating) {
      _pulse.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    final level = widget.amplitude.clamp(0.0, 1.0);

    return AnimatedBuilder(
      animation: _pulse,
      builder: (context, _) {
        final opacity = _pulse.isAnimating ? 0.45 + (0.55 * _pulse.value) : 1.0;
        return SizedBox.square(
          dimension: 20,
          child: Center(
            child: Container(
              width: 10 + (level * 6),
              height: 10 + (level * 6),
              decoration: BoxDecoration(
                color: tokens.colorStatusDangerFg.withValues(alpha: opacity),
                shape: BoxShape.circle,
              ),
            ),
          ),
        );
      },
    );
  }
}

/// What to say when a recording could not be made.
///
/// Each reason gets its own copy because each one needs a different action from
/// the user — a settings trip, giving up, or simply trying again.
class VoiceFailureNotice extends StatelessWidget {
  const VoiceFailureNotice({super.key, required this.failure, required this.onDismiss});

  final VoiceRecorderFailure failure;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);

    final text = switch (failure) {
      VoiceRecorderFailure.permissionDenied => l10n.voicePermissionDeniedBody,
      VoiceRecorderFailure.unsupported => l10n.voiceUnsupported,
      VoiceRecorderFailure.tooShort => l10n.voiceTooShort,
      VoiceRecorderFailure.failed => l10n.voiceRecordingFailed,
    };

    return Container(
      width: double.infinity,
      color: tokens.colorStatusWarningBg,
      padding: const EdgeInsetsDirectional.only(
        start: Spacing.spacing5,
        end: Spacing.spacing2,
        top: Spacing.spacing2,
        bottom: Spacing.spacing2,
      ),
      child: Semantics(
        liveRegion: true,
        child: Row(
          children: [
            Icon(Icons.mic_off_outlined, size: 16, color: tokens.colorStatusWarningFg),
            const SizedBox(width: Spacing.spacing3),
            Expanded(
              child: Text(
                text,
                style: theme.textTheme.labelSmall?.copyWith(
                  color: tokens.colorStatusWarningFg,
                ),
              ),
            ),
            IconButton(
              onPressed: onDismiss,
              icon: const Icon(Icons.close),
              tooltip: l10n.closeAction,
              iconSize: 18,
              color: tokens.colorStatusWarningFg,
            ),
          ],
        ),
      ),
    );
  }
}
