import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';

/// The in-call controls: speaker and mute on one row, End alone below.
///
/// LAYOUT IS A SAFETY PROPERTY HERE, not a style choice. `screens/call.md` §6
/// requires the end-call button to be the largest target on screen and NEVER
/// adjacent to mute — hanging up by accident while reaching for mute is the one
/// misfire that cannot be undone. So End sits on its own row, below the others,
/// and is deliberately bigger. (The reference messenger puts End in the grid;
/// this keeps the spec.)
///
/// RTL: the row mirrors, but the mute and speaker GLYPHS do not — they are
/// physical objects (`cross-platform.md` §4), and a mirrored microphone reads as
/// a different object rather than a mirrored one. Material's icons are already
/// direction-agnostic here, so nothing is forced.
class CallControls extends StatelessWidget {
  const CallControls({
    super.key,
    required this.microphoneMuted,
    required this.speakerPreferred,
    required this.canSwitchSpeaker,
    required this.onToggleMute,
    required this.onToggleSpeaker,
    required this.onEnd,
    this.enabled = true,
  });

  final bool microphoneMuted;
  final bool speakerPreferred;

  /// False on a platform that cannot move audio. The control is then ABSENT
  /// rather than disabled: a button that silently does nothing teaches people
  /// the app is broken.
  final bool canSwitchSpeaker;

  final VoidCallback onToggleMute;
  final VoidCallback onToggleSpeaker;
  final VoidCallback onEnd;

  /// Mute and speaker are only meaningful once there is a call to affect. End is
  /// always live — leaving must never be blocked.
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            if (canSwitchSpeaker)
              CallRoundButton(
                icon: speakerPreferred ? Icons.volume_up : Icons.hearing,
                label: l10n.callSpeaker,
                toggled: speakerPreferred,
                onPressed: enabled ? onToggleSpeaker : null,
              ),
            CallRoundButton(
              icon: microphoneMuted ? Icons.mic_off : Icons.mic,
              label: microphoneMuted ? l10n.callUnmute : l10n.callMute,
              toggled: microphoneMuted,
              onPressed: enabled ? onToggleMute : null,
            ),
          ],
        ),
        // The separation that keeps "end" away from "mute".
        const SizedBox(height: Spacing.spacing7),
        CallRoundButton(
          icon: Icons.call_end,
          label: l10n.callEnd,
          fill: CallPalette.hangUp,
          large: true,
          onPressed: onEnd,
        ),
      ],
    );
  }
}

/// One round control with its label underneath, as on the reference screens.
///
/// [toggled] makes it a toggle for assistive technology as well as visually;
/// a null [onPressed] renders it disabled, never hidden.
class CallRoundButton extends StatelessWidget {
  const CallRoundButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.fill,
    this.toggled,
    this.large = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onPressed;

  /// A solid fill (End, Accept, Call again). Otherwise the translucent control.
  final Color? fill;
  final bool? toggled;

  /// The largest size is reserved for End / Accept / Decline (`call.md` §6).
  final bool large;

  static const double diameter = 60;
  static const double largeDiameter = 76;

  @override
  Widget build(BuildContext context) {
    final size = large ? largeDiameter : diameter;
    final on = toggled ?? false;
    final enabled = onPressed != null;
    final background =
        fill ?? (on ? CallPalette.controlOn : CallPalette.control);
    final foreground = fill != null
        ? CallPalette.onFill
        : on
        ? CallPalette.background
        : CallPalette.foreground;

    return Semantics(
      button: true,
      enabled: enabled,
      toggled: toggled,
      label: label,
      excludeSemantics: true,
      // The label is part of the target: people tap the word as often as the
      // circle, and a bigger target is the accessible one.
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onPressed,
        child: Opacity(
          opacity: enabled ? 1 : 0.45,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: size,
                height: size,
                child: Material(
                  color: background,
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: onPressed,
                    child: Icon(icon, color: foreground, size: large ? 34 : 28),
                  ),
                ),
              ),
              const SizedBox(height: Spacing.spacing2),
              SizedBox(
                width: 92,
                child: Text(
                  label,
                  textAlign: TextAlign.center,
                  maxLines: 2,
                  style: Theme.of(context).textTheme.bodySmall
                      ?.copyWith(color: CallPalette.muted),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
