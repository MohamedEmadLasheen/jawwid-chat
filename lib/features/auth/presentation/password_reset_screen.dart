import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';

/// What a finished reset hands back to the sign-in screen, which then signs in normally.
typedef PasswordResetResult = ({String username, String password});

/// PD-21: a parent or teacher finishes a password reset the academy issued.
///
/// The administrator never knows the password: they hand over a one-time 6-digit code, and
/// the person enters it here with a password of their own. On success the screen pops with
/// the credentials and the sign-in screen signs in through the ordinary path, so a reset
/// never holds tokens of its own. The server ended every earlier session when the reset
/// completed, on every device.
class PasswordResetScreen extends ConsumerStatefulWidget {
  const PasswordResetScreen({super.key, this.initialUsername = ''});

  final String initialUsername;

  static Future<PasswordResetResult?> open(BuildContext context, {String initialUsername = ''}) {
    return Navigator.of(context).push<PasswordResetResult>(
      MaterialPageRoute(builder: (_) => PasswordResetScreen(initialUsername: initialUsername)),
    );
  }

  @override
  ConsumerState<PasswordResetScreen> createState() => _PasswordResetScreenState();
}

class _PasswordResetScreenState extends ConsumerState<PasswordResetScreen> {
  static final _codeRe = RegExp(r'^[0-9]{6}$');

  late final _username = TextEditingController(text: widget.initialUsername);
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  bool _tried = false;
  String? _error;

  @override
  void dispose() {
    _username.dispose();
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String _errorText(L10n l10n, Object error) {
    final code = error is AppError ? error.code : null;
    return switch (code) {
      'AUTH.RESET_CODE_INVALID' => l10n.resetCodeInvalid,
      'AUTH.PASSWORD_TOO_WEAK' => l10n.signupPasswordTooShort,
      'COMMON.RATE_LIMITED' => l10n.signupTooMany,
      _ => l10n.signupFailed,
    };
  }

  Future<void> _finish() async {
    final l10n = L10n.of(context);
    setState(() => _tried = true);
    if (_username.text.trim().isEmpty ||
        !_codeRe.hasMatch(_code.text.trim()) ||
        _password.text.length < 8 ||
        _password.text != _confirm.text) {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(passwordResetRepositoryProvider).complete(
            username: _username.text.trim(),
            code: _code.text.trim(),
            password: _password.text,
          );
      if (!mounted) return;
      Navigator.of(context).pop<PasswordResetResult>((username: _username.text.trim(), password: _password.text));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _errorText(l10n, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final usernameMissing = _tried && _username.text.trim().isEmpty;
    final codeInvalid = _tried && !_codeRe.hasMatch(_code.text.trim());
    final passwordShort = _tried && _password.text.length < 8;
    final passwordsDiffer = _tried && !passwordShort && _password.text != _confirm.text;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.resetTitle)),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Spacing.spacing7),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(l10n.resetIntro, style: theme.textTheme.bodyMedium),
                  const SizedBox(height: Spacing.spacing5),
                  TextField(
                    key: const ValueKey('reset-username'),
                    controller: _username,
                    enabled: !_busy,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.username],
                    textDirection: TextDirection.ltr,
                    decoration: InputDecoration(
                      labelText: l10n.resetUsernameLabel,
                      errorText: usernameMissing ? l10n.resetUsernameRequired : null,
                    ),
                  ),
                  const SizedBox(height: Spacing.spacing4),
                  TextField(
                    key: const ValueKey('reset-code'),
                    controller: _code,
                    enabled: !_busy,
                    keyboardType: TextInputType.number,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    textDirection: TextDirection.ltr,
                    maxLength: 6,
                    decoration: InputDecoration(
                      labelText: l10n.resetCodeLabel,
                      counterText: '',
                      errorText: codeInvalid ? l10n.resetCodeLabel : null,
                    ),
                  ),
                  const SizedBox(height: Spacing.spacing4),
                  TextField(
                    key: const ValueKey('reset-password'),
                    controller: _password,
                    enabled: !_busy,
                    obscureText: true,
                    autofillHints: const [AutofillHints.newPassword],
                    textDirection: TextDirection.ltr,
                    decoration: InputDecoration(
                      labelText: l10n.signupPasswordLabel,
                      errorText: passwordShort ? l10n.signupPasswordTooShort : null,
                    ),
                  ),
                  const SizedBox(height: Spacing.spacing4),
                  TextField(
                    key: const ValueKey('reset-confirm'),
                    controller: _confirm,
                    enabled: !_busy,
                    obscureText: true,
                    textDirection: TextDirection.ltr,
                    decoration: InputDecoration(
                      labelText: l10n.signupPasswordConfirmLabel,
                      errorText: passwordsDiffer ? l10n.signupPasswordsDiffer : null,
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: Spacing.spacing3),
                    Text(_error!, key: const ValueKey('reset-error'), style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
                  ],
                  const SizedBox(height: Spacing.spacing6),
                  FilledButton(
                    key: const ValueKey('reset-submit'),
                    onPressed: _busy ? null : _finish,
                    child: _busy
                        ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text(l10n.resetFinish),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
