import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../application/call_controller.dart';
import 'call_controls.dart';

/// The call, full screen.
///
/// ONE SCREEN FOR EVERY STATE, because they are the same call: an incoming call
/// that is answered becomes a connecting one and then a live one, and pushing a
/// different route at each step would throw away the identity on screen and
/// flash. `screens/call.md` §3 asks for the identity to stay visible through
/// every transition — *"never a blank screen with a spinner"*.
///
/// NO PHONE NUMBER, NO ROOM, NO CODE. Everything rendered here comes from
/// [CallUiState], which holds a display name and a presentation phase. There is
/// no field on it that could carry a dialable number, a room handle, a token or a
/// `COMM.*` code, so none can leak into the interface (G-07, §2).
///
/// THE DURATION ON SCREEN IS PRESENTATIONAL. It counts from the moment THIS
/// device saw audio go live, because the client has no `answered_at` — that is
/// the server's, and the server's figure is what the ended state shows and what
/// history records. The two can differ by the handshake; the authoritative number
/// is never guessed from this ticker.
class ActiveCallScreen extends ConsumerWidget {
  const ActiveCallScreen({super.key, this.onLeave, this.onSendMessage});

  /// Leave the call screen. The route is the caller's business, not this widget's.
  final VoidCallback? onLeave;

  /// *"Send a message instead"* after a failure — the one alternative
  /// `screens/call.md` §3 asks for.
  final VoidCallback? onSendMessage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(callControllerProvider);
    final controller = ref.read(callControllerProvider.notifier);
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    return Scaffold(
      backgroundColor: tokens.colorBackgroundSunken,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(Spacing.spacing7),
          child: Column(
            children: [
              const Spacer(),
              _Identity(state: state),
              const SizedBox(height: Spacing.spacing5),
              _StatusLine(state: state),
              const Spacer(),
              _Actions(
                state: state,
                controller: controller,
                onLeave: onLeave,
                onSendMessage: onSendMessage,
                l10n: l10n,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Who the call is with. Present in every state, including the terminal ones.
class _Identity extends StatelessWidget {
  const _Identity({required this.state});

  final CallUiState state;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    final l10n = L10n.of(context);
    final name = state.peerLabel ?? '';

    return Column(
      children: [
        JawwidAvatar(displayName: name, size: Sizes.avatarXl),
        const SizedBox(height: Spacing.spacing5),
        Text(
          name,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                color: tokens.colorTextPrimary,
                fontWeight: FontWeight.w700,
              ),
        ),
        if (state.isGroup) ...[
          const SizedBox(height: Spacing.spacing2),
          Text(
            l10n.callGroup,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: tokens.colorTextSecondary),
          ),
        ],
      ],
    );
  }
}

/// What is happening, in words — and the duration once there is one.
class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.state});

  final CallUiState state;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final tokens = JawwidTokens.of(context);

    final text = switch (state.phase) {
      CallUiPhase.idle => '',
      CallUiPhase.starting || CallUiPhase.outgoingRinging => l10n.callOutgoing,
      CallUiPhase.incomingRinging => l10n.callIncoming,
      CallUiPhase.connecting => l10n.callConnecting,
      CallUiPhase.live => '',
      CallUiPhase.reconnecting => l10n.callReconnecting,
      CallUiPhase.ended => _endedText(l10n, state),
      CallUiPhase.failed => switch (state.failure) {
          CallUiFailure.microphone => l10n.callFailedMicrophone,
          CallUiFailure.notAllowed => l10n.callFailedNotAllowed,
          CallUiFailure.network || null => l10n.callFailedNetwork,
        },
    };

    return Column(
      children: [
        if (text.isNotEmpty)
          Text(
            text,
            textAlign: TextAlign.center,
            style: Theme.of(context)
                .textTheme
                .bodyLarge
                ?.copyWith(color: tokens.colorTextSecondary),
          ),
        if (state.phase == CallUiPhase.live ||
            state.phase == CallUiPhase.reconnecting)
          const Padding(
            padding: EdgeInsets.only(top: Spacing.spacing3),
            child: _LiveDuration(),
          ),
        if (state.phase == CallUiPhase.ended && state.duration != null)
          Padding(
            padding: const EdgeInsets.only(top: Spacing.spacing3),
            child: _Duration(value: state.duration!),
          ),
      ],
    );
  }

  /// A terminal call, named the way `screens/call.md` §3 asks: *"Declined"* is
  /// plain and neutral in both directions, and never "rejected".
  static String _endedText(L10n l10n, CallUiState state) => switch (state.outcome) {
        CallOutcome.answered => l10n.callOutcomeAnswered,
        CallOutcome.missed => l10n.callOutcomeMissed,
        CallOutcome.declined => l10n.callOutcomeDeclined,
        // The server has not said yet — we ended the call and its own event is
        // still in flight. "Call ended" is true without claiming an outcome.
        null => l10n.callEnded,
      };
}

/// The in-call timer. Presentational — see the note on [ActiveCallScreen].
class _LiveDuration extends StatefulWidget {
  const _LiveDuration();

  @override
  State<_LiveDuration> createState() => _LiveDurationState();
}

class _LiveDurationState extends State<_LiveDuration> {
  final _stopwatch = Stopwatch()..start();
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _Duration(value: _stopwatch.elapsed);
}

/// A duration, always as an LTR run.
///
/// `screens/call.md` §6: identity and controls mirror in Arabic, the timer does
/// NOT — `12:05` read right-to-left is a different number.
class _Duration extends StatelessWidget {
  const _Duration({required this.value});

  final Duration value;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    final minutes = value.inMinutes;
    final seconds = value.inSeconds.remainder(60);
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Text(
        '$minutes:${seconds.toString().padLeft(2, '0')}',
        style: Theme.of(context).textTheme.titleMedium?.copyWith(
              color: tokens.colorTextSecondary,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
      ),
    );
  }
}

/// What can be done, which depends entirely on the phase.
class _Actions extends StatelessWidget {
  const _Actions({
    required this.state,
    required this.controller,
    required this.l10n,
    this.onLeave,
    this.onSendMessage,
  });

  final CallUiState state;
  final CallController controller;
  final L10n l10n;
  final VoidCallback? onLeave;
  final VoidCallback? onSendMessage;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);

    switch (state.phase) {
      case CallUiPhase.incomingRinging:
        return Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _Big(
              label: l10n.callDecline,
              icon: Icons.call_end,
              color: tokens.colorStatusDangerFg,
              onPressed: controller.decline,
            ),
            _Big(
              label: l10n.callAccept,
              icon: Icons.call,
              color: tokens.colorStatusSuccessFg,
              onPressed: controller.accept,
            ),
          ],
        );

      case CallUiPhase.starting:
      case CallUiPhase.outgoingRinging:
      case CallUiPhase.connecting:
        // Only "end" — there is nothing to mute yet, and offering a control that
        // cannot act is worse than not offering it.
        return CallControls(
          microphoneMuted: state.microphoneMuted,
          speakerPreferred: state.speakerPreferred,
          canSwitchSpeaker: false,
          onToggleMute: () {},
          onToggleSpeaker: () {},
          onEnd: controller.hangUp,
          enabled: false,
        );

      case CallUiPhase.live:
      case CallUiPhase.reconnecting:
        // The controls STAY through a reconnect (`screens/call.md` §3).
        return CallControls(
          microphoneMuted: state.microphoneMuted,
          speakerPreferred: state.speakerPreferred,
          canSwitchSpeaker: state.canSwitchSpeaker,
          onToggleMute: controller.toggleMute,
          onToggleSpeaker: controller.toggleSpeaker,
          onEnd: controller.hangUp,
        );

      case CallUiPhase.failed:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            FilledButton(
              onPressed: controller.retry,
              child: Text(l10n.retryAction),
            ),
            const SizedBox(height: Spacing.spacing4),
            TextButton(
              onPressed: onSendMessage ?? onLeave,
              child: Text(l10n.callSendMessageInstead),
            ),
          ],
        );

      case CallUiPhase.ended:
      case CallUiPhase.idle:
        return FilledButton(
          onPressed: () {
            controller.dismiss();
            onLeave?.call();
          },
          child: Text(l10n.closeAction),
        );
    }
  }
}

class _Big extends StatelessWidget {
  const _Big({
    required this.label,
    required this.icon,
    required this.color,
    required this.onPressed,
  });

  final String label;
  final IconData icon;
  final Color color;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    return Semantics(
      button: true,
      label: label,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 72,
            height: 72,
            child: Material(
              color: color,
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: onPressed,
                child: Icon(
                  icon,
                  color: tokens.colorTextInverse,
                  size: Spacing.spacing8,
                ),
              ),
            ),
          ),
          const SizedBox(height: Spacing.spacing3),
          Text(
            label,
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: tokens.colorTextSecondary),
          ),
        ],
      ),
    );
  }
}
