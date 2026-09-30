import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';

/// The in-call controls: mute, speaker, end.
///
/// LAYOUT IS A SAFETY PROPERTY HERE, not a style choice. `screens/call.md` §6
/// requires the end-call button to be the largest target on screen and NEVER
/// adjacent to mute — hanging up by accident while reaching for mute is the one
/// misfire that cannot be undone. So end sits on its own row, below the others,
/// and is deliberately bigger.
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
    final tokens = JawwidTokens.of(context);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _CircleControl(
              icon: microphoneMuted ? Icons.mic_off : Icons.mic,
              label: microphoneMuted ? l10n.callUnmute : l10n.callMute,
              selected: microphoneMuted,
              onPressed: enabled ? onToggleMute : null,
            ),
            if (canSwitchSpeaker) ...[
              const SizedBox(width: Spacing.spacing7),
              _CircleControl(
                icon: speakerPreferred ? Icons.volume_up : Icons.hearing,
                label: l10n.callSpeaker,
                selected: speakerPreferred,
                onPressed: enabled ? onToggleSpeaker : null,
              ),
            ],
          ],
        ),
        // The separation that keeps "end" away from "mute".
        const SizedBox(height: Spacing.spacing8),
        Semantics(
          button: true,
          label: l10n.callEnd,
          child: SizedBox(
            width: _endDiameter,
            height: _endDiameter,
            child: Material(
              color: tokens.colorStatusDangerFg,
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: onEnd,
                child: Icon(
                  Icons.call_end,
                  color: tokens.colorTextInverse,
                  size: Spacing.spacing8,
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Larger than the secondary controls, on purpose. See the class comment.
  static const double _endDiameter = 72;
}

class _CircleControl extends StatelessWidget {
  const _CircleControl({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onPressed,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final tokens = JawwidTokens.of(context);
    return Semantics(
      button: true,
      toggled: selected,
      label: label,
      child: Tooltip(
        message: label,
        child: SizedBox(
          width: _diameter,
          height: _diameter,
          child: Material(
            color: selected ? tokens.colorBrandSubtle : tokens.colorSurfaceMuted,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: onPressed,
              child: Icon(
                icon,
                color: onPressed == null
                    ? tokens.colorTextMuted
                    : tokens.colorTextPrimary,
              ),
            ),
          ),
        ),
      ),
    );
  }

  static const double _diameter = 56;
}
