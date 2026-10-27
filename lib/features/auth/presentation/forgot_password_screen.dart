import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../password_policy.dart';
import 'recovery_widgets.dart';

/// PD-25 forgot password: the parent's sign-in e-mail -> a 6-digit code e-mailed to it -> a
/// new password of their own (the PD-21 completion, which also signs every other device out).
///
/// The first step answers the same for any address, so the screen says "if this is a parent
/// account" rather than ever confirming one. On success it pops with the credentials and the
/// sign-in screen signs in through the ordinary path.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key, this.initialEmail = '', this.codeMinutes = 10});

  final String initialEmail;
  final int codeMinutes;

  static Future<RecoveryResult?> open(BuildContext context, {String initialEmail = '', int codeMinutes = 10}) {
    return Navigator.of(context).push<RecoveryResult>(
      MaterialPageRoute(builder: (_) => ForgotPasswordScreen(initialEmail: initialEmail, codeMinutes: codeMinutes)),
    );
  }

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  static final _emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  late final _email = TextEditingController(text: widget.initialEmail.contains('@') ? widget.initialEmail : '');
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;
  bool _tried = false;
  String? _error;
  String? _notice;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _send({bool again = false}) async {
    final l10n = L10n.of(context);
    setState(() => _tried = true);
    if (!_emailRe.hasMatch(_email.text.trim())) return;
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      await ref.read(accountRecoveryRepositoryProvider).requestPasswordCode(_email.text.trim());
      if (!mounted) return;
      setState(() {
        _busy = false;
        _codeSent = true;
        _tried = false;
        _notice = again ? l10n.recoveryResent : null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = recoveryErrorText(l10n, e);
      });
      if (again) rethrow;
    }
  }

  void _changeEmail() {
    setState(() {
      _codeSent = false;
      _tried = false;
      _error = null;
      _notice = null;
      _code.clear();
    });
  }

  Future<void> _finish() async {
    final l10n = L10n.of(context);
    setState(() => _tried = true);
    if (!recoveryCodeRe.hasMatch(_code.text.trim()) || _password.text.length < kPasswordMinLength || _password.text != _confirm.text) {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      final email = _email.text.trim();
      await ref.read(passwordResetRepositoryProvider).complete(
            username: email.toLowerCase(),
            code: _code.text.trim(),
            password: _password.text,
          );
      if (!mounted) return;
      Navigator.of(context).pop<RecoveryResult>((username: email.toLowerCase(), password: _password.text));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = recoveryErrorText(l10n, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final emailInvalid = _tried && !_codeSent && !_emailRe.hasMatch(_email.text.trim());
    final codeInvalid = _tried && _codeSent && !recoveryCodeRe.hasMatch(_code.text.trim());
    final passwordShort = _tried && _codeSent && _password.text.length < kPasswordMinLength;
    final passwordsDiffer = _tried && _codeSent && !passwordShort && _password.text != _confirm.text;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.forgotPasswordTitle)),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Spacing.spacing7),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    RecoveryStep(number: _codeSent ? 2 : 1, of: 2),
                    const SizedBox(height: Spacing.spacing3),
                    Text(
                      _codeSent
                          ? l10n.forgotPasswordCodeSent(_email.text.trim(), widget.codeMinutes)
                          : l10n.forgotPasswordIntro,
                      key: const ValueKey('forgot-password-intro'),
                      style: theme.textTheme.bodyMedium,
                    ),
                    const SizedBox(height: Spacing.spacing5),
                    TextField(
                      key: const ValueKey('forgot-password-email'),
                      controller: _email,
                      enabled: !_busy && !_codeSent,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      textDirection: TextDirection.ltr,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      decoration: InputDecoration(
                        labelText: l10n.signupEmailLabel,
                        errorText: emailInvalid ? l10n.signupEmailInvalid : null,
                      ),
                    ),
                    if (_codeSent) ...[
                      Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: TextButton(
                          key: const ValueKey('forgot-password-change-email'),
                          onPressed: _busy ? null : _changeEmail,
                          child: Text(l10n.recoveryChangeEmail),
                        ),
                      ),
                      TextField(
                        key: const ValueKey('forgot-password-code'),
                        controller: _code,
                        enabled: !_busy,
                        keyboardType: TextInputType.number,
                        autofillHints: const [AutofillHints.oneTimeCode],
                        textDirection: TextDirection.ltr,
                        maxLength: 6,
                        decoration: InputDecoration(
                          labelText: l10n.resetCodeLabel,
                          counterText: '',
                          errorText: codeInvalid ? l10n.recoveryCodeFormat : null,
                        ),
                      ),
                      const SizedBox(height: Spacing.spacing4),
                      TextField(
                        key: const ValueKey('forgot-password-password'),
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
                        key: const ValueKey('forgot-password-confirm'),
                        controller: _confirm,
                        enabled: !_busy,
                        obscureText: true,
                        textDirection: TextDirection.ltr,
                        decoration: InputDecoration(
                          labelText: l10n.signupPasswordConfirmLabel,
                          errorText: passwordsDiffer ? l10n.signupPasswordsDiffer : null,
                        ),
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: Spacing.spacing3),
                      RecoveryErrorText(_error!),
                    ],
                    if (_notice != null) ...[
                      const SizedBox(height: Spacing.spacing3),
                      Text(_notice!, key: const ValueKey('recovery-notice'), style: theme.textTheme.bodySmall),
                    ],
                    const SizedBox(height: Spacing.spacing6),
                    FilledButton(
                      key: const ValueKey('forgot-password-submit'),
                      onPressed: _busy ? null : (_codeSent ? _finish : _send),
                      child: _busy
                          ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : Text(_codeSent ? l10n.resetFinish : l10n.recoverySendCode),
                    ),
                    if (_codeSent) ResendCodeButton(enabled: !_busy, onResend: () => _send(again: true)),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
