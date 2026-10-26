import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';

/// What a finished sign-up hands back to the sign-in screen, which then signs in normally.
typedef ParentSignupResult = ({String email, String password});

/// PD-16: a parent whose child the academy enrolled creates their account.
///
/// Two steps: the e-mail they gave the academy -> a 6-digit code (sent to them on WhatsApp
/// by their supervisor for now) and the password they choose. On success the screen pops
/// with the credentials and the sign-in screen signs in through the ordinary path, so a
/// sign-up never holds tokens of its own. The server answers the first step the same way
/// for any e-mail, so this screen never says whether an address is known.
class ParentSignupScreen extends ConsumerStatefulWidget {
  const ParentSignupScreen({super.key});

  static Future<ParentSignupResult?> open(BuildContext context) {
    return Navigator.of(context).push<ParentSignupResult>(
      MaterialPageRoute(builder: (_) => const ParentSignupScreen()),
    );
  }

  @override
  ConsumerState<ParentSignupScreen> createState() => _ParentSignupScreenState();
}

class _ParentSignupScreenState extends ConsumerState<ParentSignupScreen> {
  static final _emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  final _email = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _codeAsked = false;
  bool _busy = false;
  bool _tried = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String? _errorText(L10n l10n, Object error) {
    final code = error is AppError ? error.code : null;
    return switch (code) {
      'AUTH.SIGNUP_CODE_INVALID' => l10n.signupCodeInvalid,
      // PD-16 amendment: ten wrong codes in 24 h lock sign-up; a new code will not help.
      'AUTH.SIGNUP_LOCKED' => l10n.signupLocked,
      'AUTH.PASSWORD_TOO_WEAK' => l10n.signupPasswordTooShort,
      'COMMON.RATE_LIMITED' => l10n.signupTooMany,
      _ => l10n.signupFailed,
    };
  }

  Future<void> _askCode() async {
    final l10n = L10n.of(context);
    setState(() => _tried = true);
    if (!_emailRe.hasMatch(_email.text.trim())) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(parentSignupRepositoryProvider).requestCode(_email.text.trim());
      if (!mounted) return;
      setState(() {
        _busy = false;
        _codeAsked = true;
        _tried = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _errorText(l10n, e);
      });
    }
  }

  Future<void> _finish() async {
    final l10n = L10n.of(context);
    setState(() => _tried = true);
    if (!RegExp(r'^[0-9]{6}$').hasMatch(_code.text.trim()) || _password.text.length < 8 || _password.text != _confirm.text) {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(parentSignupRepositoryProvider).verify(
            email: _email.text.trim(),
            code: _code.text.trim(),
            password: _password.text,
          );
      if (!mounted) return;
      Navigator.of(context).pop<ParentSignupResult>((email: _email.text.trim(), password: _password.text));
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
    final emailInvalid = _tried && !_codeAsked && !_emailRe.hasMatch(_email.text.trim());
    final codeInvalid = _tried && _codeAsked && !RegExp(r'^[0-9]{6}$').hasMatch(_code.text.trim());
    final passwordShort = _tried && _codeAsked && _password.text.length < 8;
    final passwordsDiffer = _tried && _codeAsked && !passwordShort && _password.text != _confirm.text;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.signupTitle)),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Spacing.spacing7),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(_codeAsked ? l10n.signupCodeSent : l10n.signupEmailIntro, style: theme.textTheme.bodyMedium),
                  const SizedBox(height: Spacing.spacing5),
                  TextField(
                    key: const ValueKey('signup-email'),
                    controller: _email,
                    enabled: !_busy && !_codeAsked,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    textDirection: TextDirection.ltr,
                    decoration: InputDecoration(
                      labelText: l10n.signupEmailLabel,
                      errorText: emailInvalid ? l10n.signupEmailInvalid : null,
                    ),
                  ),
                  if (_codeAsked) ...[
                    const SizedBox(height: Spacing.spacing4),
                    TextField(
                      key: const ValueKey('signup-code'),
                      controller: _code,
                      enabled: !_busy,
                      keyboardType: TextInputType.number,
                      autofillHints: const [AutofillHints.oneTimeCode],
                      textDirection: TextDirection.ltr,
                      maxLength: 6,
                      decoration: InputDecoration(
                        labelText: l10n.signupCodeLabel,
                        counterText: '',
                        errorText: codeInvalid ? l10n.signupCodeLabel : null,
                      ),
                    ),
                    const SizedBox(height: Spacing.spacing4),
                    TextField(
                      key: const ValueKey('signup-password'),
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
                      key: const ValueKey('signup-confirm'),
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
                    Text(_error!, key: const ValueKey('signup-error'), style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
                  ],
                  const SizedBox(height: Spacing.spacing6),
                  FilledButton(
                    key: const ValueKey('signup-submit'),
                    onPressed: _busy ? null : (_codeAsked ? _finish : _askCode),
                    child: _busy
                        ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text(_codeAsked ? l10n.signupFinish : l10n.signupSendCode),
                  ),
                  if (_codeAsked)
                    TextButton(
                      key: const ValueKey('signup-new-code'),
                      onPressed: _busy ? null : _askCode,
                      child: Text(l10n.signupNewCode),
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
