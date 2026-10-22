import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/errors/app_error.dart';
import '../../../l10n/app_localizations.dart';

/// What a recovery hands back to the sign-in screen. With a password, the sign-in screen
/// signs in normally; without one (the parent only needed their e-mail), it fills the login
/// and lets them type the password they remember.
typedef RecoveryResult = ({String username, String? password});

/// PD-25: the server's shortest wait between two codes (RECOVERY_RESEND_SECONDS).
const recoveryResendSeconds = 60;

final recoveryCodeRe = RegExp(r'^[0-9]{6}$');

/// The plain-words message for a refusal on any recovery step.
String recoveryErrorText(L10n l10n, Object error) {
  final code = error is AppError ? error.code : null;
  return switch (code) {
    'AUTH.RESET_CODE_INVALID' => l10n.recoveryCodeInvalid,
    'AUTH.PASSWORD_TOO_WEAK' => l10n.signupPasswordTooShort,
    'COMMON.RATE_LIMITED' => l10n.signupTooMany,
    _ => l10n.signupFailed,
  };
}

/// "Send a new code", disabled with a countdown for [recoveryResendSeconds] after each send,
/// so a parent cannot ask faster than the server would answer.
class ResendCodeButton extends StatefulWidget {
  const ResendCodeButton({super.key, required this.onResend, this.enabled = true});

  /// Sends a new code. A throw leaves the button usable again.
  final Future<void> Function() onResend;
  final bool enabled;

  @override
  State<ResendCodeButton> createState() => _ResendCodeButtonState();
}

class _ResendCodeButtonState extends State<ResendCodeButton> {
  Timer? _timer;
  int _left = recoveryResendSeconds;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _start();
  }

  void _start() {
    _timer?.cancel();
    _left = recoveryResendSeconds;
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      setState(() => _left--);
      if (_left <= 0) t.cancel();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _resend() async {
    setState(() => _sending = true);
    try {
      await widget.onResend();
      if (mounted) setState(_start);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final waiting = _left > 0;
    return TextButton(
      key: const ValueKey('recovery-resend'),
      onPressed: widget.enabled && !waiting && !_sending ? _resend : null,
      child: Text(waiting ? l10n.recoveryResendIn(_left) : l10n.recoveryResend),
    );
  }
}

/// The error line under a form, in the theme's error colour.
class RecoveryErrorText extends StatelessWidget {
  const RecoveryErrorText(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Text(
      text,
      key: const ValueKey('recovery-error'),
      style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error),
    );
  }
}

/// "Step 1 of 3": where the parent is in a recovery flow.
class RecoveryStep extends StatelessWidget {
  const RecoveryStep({super.key, required this.number, required this.of});

  final int number;
  final int of;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Text(
      L10n.of(context).recoveryStep(number, of),
      key: const ValueKey('recovery-step'),
      style: theme.textTheme.labelMedium?.copyWith(color: theme.colorScheme.primary),
    );
  }
}
