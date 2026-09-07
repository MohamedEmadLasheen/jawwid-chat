import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../data/call_media.dart';
import '../domain/call_session.dart';

/// The one call surface: it rings, it connects, it ends.
///
/// Incoming and outgoing are the SAME screen, differing only in which controls
/// are offered. They are one widget because they are one call from the moment
/// it exists, and splitting them is how two screens end up on screen at once
/// when a call is answered on another device.
///
/// Everything shown here comes from [CallSession] -- which carries the server's
/// [CallView] -- and nothing is inferred locally. In particular the recording
/// indicator is driven by the server's mode, so a participant who JOINED a
/// follow-up call somebody else started still sees it. That is the entire point
/// of the indicator.
class CallScreen extends ConsumerWidget {
  const CallScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final session = ref.watch(callControllerProvider);
    final controller = ref.read(callControllerProvider.notifier);
    final theme = Theme.of(context);

    // The MEDIA state outranks the phase for the connected case, and only for
    // that case. A call is `connected` the moment the server says somebody
    // answered; telling the user "Connected" while their transport is
    // re-establishing is the screen lying about whether they can be heard.
    final title = switch (session.phase) {
      CallPhase.incoming => session.incoming?.isClassCall == true
          ? l10n.callClassWaitingTitle
          : l10n.callIncomingTitle,
      CallPhase.dialling || CallPhase.ringing => l10n.callRinging,
      CallPhase.connecting => l10n.callConnecting,
      CallPhase.connected => switch (session.media) {
          MediaState.reconnecting => l10n.callReconnecting,
          MediaState.connecting => l10n.callConnecting,
          MediaState.failed => l10n.callAudioFailed,
          _ => l10n.callConnected,
        },
      CallPhase.ended || CallPhase.idle => l10n.callEnded,
    };

    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(Spacing.spacing6),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const Spacer(),
              Text(
                _peerName(session),
                style: theme.textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: Spacing.spacing3),
              Text(
                title,
                style: theme.textTheme.bodyLarge,
                // A live region, so a screen reader announces the call
                // connecting rather than leaving a blind user guessing.
                semanticsLabel: title,
              ),

              // The class-call sentence, from THIS app's localisations in the
              // reader's own language -- never a string that travelled from the
              // server in whatever locale it happened to pick.
              if (session.incoming?.isClassCall == true) ...[
                const SizedBox(height: Spacing.spacing3),
                Text(
                  l10n.callClassWaitingBody(session.incoming!.callerName),
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium,
                ),
              ],

              if (session.isRecordable) ...[
                const SizedBox(height: Spacing.spacing5),
                _RecordingIndicator(label: l10n.callRecordingIndicator),
              ],

              if (session.errorCode != null) ...[
                const SizedBox(height: Spacing.spacing5),
                Text(
                  _errorText(l10n, session.errorCode!),
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium
                      ?.copyWith(color: theme.colorScheme.error),
                ),
              ],

              const Spacer(),
              _Controls(
                session: session,
                onAccept: controller.accept,
                onDecline: controller.decline,
                onHangUp: () => controller.hangUp(),
                onToggleMute: () => controller.toggleMute(),
                onDismiss: controller.dismiss,
              ),
              const SizedBox(height: Spacing.spacing6),
            ],
          ),
        ),
      ),
    );
  }

  /// Who is on the other end. A DISPLAY NAME, always: §5 makes phone numbers
  /// unrenderable, and this client never receives one to render.
  String _peerName(CallSession session) =>
      session.incoming?.groupName ?? session.incoming?.callerName ?? '';

  /// Stable codes to sentences. The UI branches on the code, never on prose.
  String _errorText(L10n l10n, String code) => switch (code) {
        'COMM.CALL_EXPIRED' ||
        'COMM.CALL_ALREADY_ENDED' ||
        'COMM.CALL_INVALID_TRANSITION' ||
        'COMM.CALL_NOT_FOUND' =>
          l10n.callUnavailable,
        _ => l10n.callNotPermitted,
      };
}

/// "This call is being recorded."
///
/// Not dismissible and not conditional on anything local. A participant is told
/// their voice is being recorded for as long as it is.
class _RecordingIndicator extends StatelessWidget {
  const _RecordingIndicator({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      liveRegion: true,
      label: label,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: Spacing.spacing4,
          vertical: Spacing.spacing2,
        ),
        decoration: BoxDecoration(
          color: theme.colorScheme.errorContainer,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.fiber_manual_record,
                size: 12, color: theme.colorScheme.error),
            const SizedBox(width: Spacing.spacing2),
            Flexible(
              child: Text(
                label,
                style: theme.textTheme.labelLarge
                    ?.copyWith(color: theme.colorScheme.onErrorContainer),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Controls extends StatelessWidget {
  const _Controls({
    required this.session,
    required this.onAccept,
    required this.onDecline,
    required this.onHangUp,
    required this.onToggleMute,
    required this.onDismiss,
  });

  final CallSession session;
  final VoidCallback onAccept;
  final VoidCallback onDecline;
  final VoidCallback onHangUp;
  final VoidCallback onToggleMute;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    // Which controls exist is decided by the PHASE, so a control that cannot
    // lawfully be pressed is not on screen to press. The server would refuse it
    // anyway -- this just stops the user finding out that way.
    return switch (session.phase) {
      CallPhase.incoming => Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _CallButton(
              icon: Icons.call_end,
              label: l10n.callDecline,
              onPressed: onDecline,
              isDestructive: true,
            ),
            _CallButton(
              icon: Icons.call,
              label: l10n.callAccept,
              onPressed: onAccept,
            ),
          ],
        ),
      CallPhase.ended || CallPhase.idle => _CallButton(
          icon: Icons.close,
          label: MaterialLocalizations.of(context).closeButtonLabel,
          onPressed: onDismiss,
        ),
      _ => Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _CallButton(
              icon: session.isMuted ? Icons.mic_off : Icons.mic,
              label: session.isMuted ? l10n.callUnmute : l10n.callMute,
              onPressed: onToggleMute,
            ),
            _CallButton(
              icon: Icons.call_end,
              label: l10n.callHangUp,
              onPressed: onHangUp,
              isDestructive: true,
            ),
          ],
        ),
    };
  }
}

class _CallButton extends StatelessWidget {
  const _CallButton({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.isDestructive = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onPressed;
  final bool isDestructive;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final background =
        isDestructive ? theme.colorScheme.error : theme.colorScheme.primary;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // A 64pt target: this is the control somebody presses in a hurry, and
        // the minimum touch target is a floor, not an aspiration.
        SizedBox.square(
          dimension: 64,
          child: Material(
            color: background,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onPressed,
              child: Icon(icon, color: theme.colorScheme.onPrimary),
            ),
          ),
        ),
        const SizedBox(height: Spacing.spacing2),
        Text(label, style: theme.textTheme.labelMedium),
      ],
    );
  }
}
