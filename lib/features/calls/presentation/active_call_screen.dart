import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/repositories.dart';
import '../../../design/tokens.dart';
import '../../../design/widgets/jawwid_avatar.dart';
import '../../../l10n/app_localizations.dart';
import '../application/call_controller.dart';
import 'call_controls.dart';

/// Leave the call for its conversation: to read it, or to record a voice
/// message straight away ("Record voice message" after a call that did not
/// connect). The route is the caller's business, not this widget's.
typedef OpenConversation = void Function(
  String conversationId, {
  required bool recordVoice,
});

/// The call, full screen, dark, in the style of a messenger's call screen.
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
///
/// AFTER A CALL THAT DID NOT CONNECT it offers Close, Record voice message and
/// Call again. *Call again* is a NEW call the server authorizes like any other;
/// *Record voice message* opens the conversation with the ordinary recorder —
/// it never records the call (§2: no recording UI).
class ActiveCallScreen extends ConsumerWidget {
  const ActiveCallScreen({super.key, this.onLeave, this.onOpenConversation});

  /// Leave the call screen. The route is the caller's business, not this widget's.
  final VoidCallback? onLeave;

  /// Open the call's conversation. Absent, the actions that need it are absent.
  final OpenConversation? onOpenConversation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(callControllerProvider);
    final controller = ref.read(callControllerProvider.notifier);
    final l10n = L10n.of(context);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: CallPalette.background,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              const SizedBox(height: Spacing.spacing4),
              _Title(label: l10n.callVoiceTitle),
              const Spacer(),
              _Identity(state: state),
              const SizedBox(height: Spacing.spacing4),
              _StatusLine(state: state),
              const Spacer(),
              _Panel(
                child: _Actions(
                  state: state,
                  controller: controller,
                  onLeave: onLeave,
                  onOpenConversation: onOpenConversation,
                  l10n: l10n,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Title extends StatelessWidget {
  const _Title({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.lock, size: 14, color: CallPalette.muted),
        const SizedBox(width: Spacing.spacing2),
        Text(
          label,
          style: Theme.of(context).textTheme.bodySmall
              ?.copyWith(color: CallPalette.muted),
        ),
      ],
    );
  }
}

/// Who the call is with. Present in every state, including the terminal ones.
class _Identity extends StatelessWidget {
  const _Identity({required this.state});

  final CallUiState state;

  static const double _avatar = 128;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final name = state.peerLabel ?? '';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing7),
      child: Column(
        children: [
          JawwidAvatar(displayName: name, size: _avatar),
          const SizedBox(height: Spacing.spacing6),
          Text(
            name,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
              color: CallPalette.foreground,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (state.isGroup) ...[
            const SizedBox(height: Spacing.spacing2),
            Text(
              l10n.callGroup,
              style: Theme.of(context).textTheme.bodyMedium
                  ?.copyWith(color: CallPalette.muted),
            ),
          ],
        ],
      ),
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

    final text = switch (state.phase) {
      CallUiPhase.idle => '',
      CallUiPhase.starting || CallUiPhase.outgoingRinging => l10n.callOutgoing,
      CallUiPhase.incomingRinging => l10n.callIncoming,
      CallUiPhase.connecting => l10n.callConnecting,
      CallUiPhase.live => '',
      CallUiPhase.reconnecting => l10n.callReconnecting,
      CallUiPhase.ended => endedText(l10n, state),
      CallUiPhase.failed => switch (state.failure) {
        CallUiFailure.microphone => l10n.callFailedMicrophone,
        CallUiFailure.notAllowed => l10n.callFailedNotAllowed,
        CallUiFailure.network || null => l10n.callFailedNetwork,
      },
    };
    final isFailure = state.phase == CallUiPhase.failed;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Spacing.spacing7),
      child: Column(
        children: [
          if (text.isNotEmpty)
            Text(
              text,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: isFailure ? CallPalette.alert : CallPalette.muted,
              ),
            ),
          if (state.phase == CallUiPhase.live ||
              state.phase == CallUiPhase.reconnecting)
            const Padding(
              padding: EdgeInsets.only(top: Spacing.spacing2),
              child: _LiveDuration(),
            ),
          // A call that never connected has no length worth showing.
          if (state.phase == CallUiPhase.ended &&
              (state.duration ?? Duration.zero) > Duration.zero)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.spacing2),
              child: _Duration(value: state.duration!),
            ),
        ],
      ),
    );
  }
}

/// A terminal call, named from THIS side of it. The outcome itself is the
/// server's (`call.ended`); only the words depend on who placed the call:
/// `missed` is *"No answer"* to the caller and *"Missed call"* to the callee.
/// *"Declined"* is plain and neutral in both directions, never "rejected"
/// (`screens/call.md` §3).
String endedText(L10n l10n, CallUiState state) => switch (state.outcome) {
  CallOutcome.answered => l10n.callOutcomeAnswered,
  CallOutcome.missed =>
    state.direction == CallDirection.incoming
        ? l10n.callMissedIncoming
        : l10n.callNoAnswer,
  CallOutcome.declined => l10n.callOutcomeDeclined,
  // The server has not said yet — we ended the call and its own event is
  // still in flight. "Call ended" is true without claiming an outcome.
  null => l10n.callEnded,
};

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
    final minutes = value.inMinutes;
    final seconds = value.inSeconds.remainder(60);
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Text(
        '$minutes:${seconds.toString().padLeft(2, '0')}',
        style: Theme.of(context).textTheme.titleMedium?.copyWith(
          color: CallPalette.foreground,
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}

/// The rounded panel the controls sit on, flush with the bottom edge.
class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: CallPalette.panel,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      child: Padding(
        padding: EdgeInsetsDirectional.fromSTEB(
          Spacing.spacing5,
          Spacing.spacing7,
          Spacing.spacing5,
          Spacing.spacing7 + bottomInset,
        ),
        child: SizedBox(width: double.infinity, child: child),
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
    this.onOpenConversation,
  });

  final CallUiState state;
  final CallController controller;
  final L10n l10n;
  final VoidCallback? onLeave;
  final OpenConversation? onOpenConversation;

  /// Leave this screen for the conversation. The call is already over (or never
  /// started), so leaving ends nothing; dismissing first means the presenter
  /// never re-shows a finished call.
  void _openConversation({required bool recordVoice}) {
    final conversationId = state.conversationId;
    final open = onOpenConversation;
    if (conversationId == null || open == null) return;
    controller.dismiss();
    open(conversationId, recordVoice: recordVoice);
  }

  @override
  Widget build(BuildContext context) {
    final canOpen = onOpenConversation != null && state.conversationId != null;

    switch (state.phase) {
      case CallUiPhase.incomingRinging:
        return Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            CallRoundButton(
              icon: Icons.call_end,
              label: l10n.callDecline,
              fill: CallPalette.hangUp,
              large: true,
              onPressed: controller.decline,
            ),
            CallRoundButton(
              icon: Icons.call,
              label: l10n.callAccept,
              fill: CallPalette.accept,
              large: true,
              onPressed: controller.accept,
            ),
          ],
        );

      case CallUiPhase.starting:
      case CallUiPhase.outgoingRinging:
      case CallUiPhase.connecting:
        // Only "end" is live — there is nothing to mute yet, and offering a
        // control that cannot act is worse than not offering it.
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
        return Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CallRoundButton(
              icon: Icons.close,
              label: l10n.closeAction,
              onPressed: () {
                controller.dismiss();
                onLeave?.call();
              },
            ),
            // Always offered (`screens/call.md` §3). Without a way to open the
            // conversation it falls back to leaving, as it always did.
            CallRoundButton(
              icon: Icons.chat_bubble,
              label: l10n.callSendMessageInstead,
              onPressed: canOpen
                  ? () => _openConversation(recordVoice: false)
                  : () {
                      controller.dismiss();
                      onLeave?.call();
                    },
            ),
            CallRoundButton(
              icon: Icons.call,
              label: l10n.retryAction,
              fill: CallPalette.accept,
              onPressed: controller.retry,
            ),
          ],
        );

      case CallUiPhase.ended:
      case CallUiPhase.idle:
        return Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CallRoundButton(
              icon: Icons.close,
              label: l10n.closeAction,
              onPressed: () {
                controller.dismiss();
                onLeave?.call();
              },
            ),
            if (canOpen && state.phase == CallUiPhase.ended)
              CallRoundButton(
                icon: Icons.mic,
                label: l10n.callRecordVoice,
                onPressed: () => _openConversation(recordVoice: true),
              ),
            if (state.phase == CallUiPhase.ended &&
                state.conversationId != null)
              CallRoundButton(
                icon: Icons.call,
                label: l10n.callAgain,
                fill: CallPalette.accept,
                onPressed: controller.callAgain,
              ),
          ],
        );
    }
  }
}
