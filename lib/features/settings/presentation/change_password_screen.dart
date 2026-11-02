import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../auth/password_policy.dart';

/// TEACHER-023: change your own password, signed in -- any role, the teacher web portal
/// too. Until this a teacher's only way was a reset code from their supervisor.
///
/// The current password proves it is the account holder, not whoever found the phone
/// unlocked. On success the server ends every OTHER session of the account; this one
/// stays, so the person is not signed out of the device they are holding.
class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _current = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _tried = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String _errorText(L10n l10n, Object error) {
    final code = error is AppError ? error.code : null;
    return switch (code) {
      'AUTH.INVALID_CREDENTIALS' => l10n.changePasswordWrongCurrent,
      'AUTH.PASSWORD_TOO_WEAK' => l10n.signupPasswordTooShort,
      'AUTH.PASSWORD_UNCHANGED' => l10n.changePasswordUnchanged,
      'COMMON.RATE_LIMITED' => l10n.signupTooMany,
      _ => l10n.signupFailed,
    };
  }

  Future<void> _submit() async {
    final l10n = L10n.of(context);
    setState(() => _tried = true);
    if (_current.text.isEmpty || _password.text.length < kPasswordMinLength || _password.text != _confirm.text) {
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(passwordChangeRepositoryProvider).change(currentPassword: _current.text, newPassword: _password.text);
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      Navigator.of(context).pop();
      messenger.showSnackBar(SnackBar(content: Text(l10n.changePasswordDone)));
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
    final currentMissing = _tried && _current.text.isEmpty;
    final passwordShort = _tried && _password.text.length < kPasswordMinLength;
    final passwordsDiffer = _tried && !passwordShort && _password.text != _confirm.text;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.changePasswordTitle)),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Spacing.spacing7),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    key: const ValueKey('change-password-current'),
                    controller: _current,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    decoration: InputDecoration(
                      labelText: l10n.changePasswordCurrentLabel,
                      errorText: currentMissing ? l10n.changePasswordCurrentRequired : null,
                    ),
                  ),
                  const SizedBox(height: Spacing.spacing5),
                  TextField(
                    key: const ValueKey('change-password-new'),
                    controller: _password,
                    obscureText: true,
                    autofillHints: const [AutofillHints.newPassword],
                    decoration: InputDecoration(
                      labelText: l10n.signupPasswordLabel,
                      errorText: passwordShort ? l10n.signupPasswordTooShort : null,
                    ),
                  ),
                  const SizedBox(height: Spacing.spacing5),
                  TextField(
                    key: const ValueKey('change-password-confirm'),
                    controller: _confirm,
                    obscureText: true,
                    autofillHints: const [AutofillHints.newPassword],
                    decoration: InputDecoration(
                      labelText: l10n.signupPasswordConfirmLabel,
                      errorText: passwordsDiffer ? l10n.signupPasswordsDiffer : null,
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: Spacing.spacing5),
                    Text(
                      _error!,
                      key: const ValueKey('change-password-error'),
                      style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
                    ),
                  ],
                  const SizedBox(height: Spacing.spacing7),
                  FilledButton(
                    key: const ValueKey('change-password-submit'),
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text(l10n.changePasswordAction),
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
