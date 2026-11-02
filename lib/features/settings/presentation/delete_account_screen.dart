import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/app_error.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/user_role.dart';

/// PD-56 (store compliance, Apple 5.1.1(v)): a parent or a teacher deletes their own
/// account. The screen says what goes and what is kept, asks for the password again, then
/// asks once more in a dialog. On success the server has already ended every session, so
/// the app clears what is local without calling `/auth/logout`.
class DeleteAccountScreen extends ConsumerStatefulWidget {
  const DeleteAccountScreen({super.key});

  @override
  ConsumerState<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends ConsumerState<DeleteAccountScreen> {
  final _password = TextEditingController();
  bool _tried = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  String _errorText(L10n l10n, Object error) {
    final code = error is AppError ? error.code : null;
    return switch (code) {
      'AUTH.INVALID_CREDENTIALS' => l10n.deleteAccountWrongPassword,
      'AUTH.ACCOUNT_LOCKED' || 'COMMON.RATE_LIMITED' => l10n.signupTooMany,
      'AUTH.FORBIDDEN' => l10n.deleteAccountStaff,
      // A teacher with a lesson, a student or payroll still open: the academy closes those first.
      'AUTH.TEACHER_DELETION_BLOCKED' => l10n.deleteAccountTeacherBlocked,
      _ => l10n.deleteAccountFailed,
    };
  }

  Future<void> _submit() async {
    final l10n = L10n.of(context);
    setState(() => _tried = true);
    if (_password.text.isEmpty) return;
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.deleteAccountTitle),
        content: Text(l10n.deleteAccountConfirm),
        actions: [
          TextButton(
            key: const ValueKey('delete-account-cancel'),
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancelAction),
          ),
          TextButton(
            key: const ValueKey('delete-account-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
            child: Text(l10n.deleteAccountAction),
          ),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    // Read before the await: signing out unmounts this screen.
    final messenger = ScaffoldMessenger.of(context);
    final auth = ref.read(authControllerProvider.notifier);
    try {
      await ref.read(accountDeletionRepositoryProvider).deleteAccount(password: _password.text);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _errorText(l10n, e);
      });
      return;
    }
    await auth.signOut(serverAlreadyEnded: true);
    messenger.showSnackBar(SnackBar(content: Text(l10n.deleteAccountDone)));
    // Signing out leaves this screen; if anything keeps it up, it must not spin forever.
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final isParent = ref.watch(currentRoleProvider) == UserRole.parent;
    final missing = _tried && _password.text.isEmpty;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.deleteAccountTitle)),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Spacing.spacing7),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(l10n.deleteAccountIntro, style: theme.textTheme.titleMedium),
                  const SizedBox(height: Spacing.spacing5),
                  Text(l10n.deleteAccountGoes, key: const ValueKey('delete-account-goes')),
                  const SizedBox(height: Spacing.spacing4),
                  Text(
                    isParent ? l10n.deleteAccountKeptParent : l10n.deleteAccountKeptTeacher,
                    key: const ValueKey('delete-account-kept'),
                  ),
                  const SizedBox(height: Spacing.spacing7),
                  TextField(
                    key: const ValueKey('delete-account-password'),
                    controller: _password,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    decoration: InputDecoration(
                      labelText: l10n.deleteAccountPasswordLabel,
                      errorText: missing ? l10n.changePasswordCurrentRequired : null,
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: Spacing.spacing5),
                    Text(
                      _error!,
                      key: const ValueKey('delete-account-error'),
                      style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
                    ),
                  ],
                  const SizedBox(height: Spacing.spacing7),
                  FilledButton(
                    key: const ValueKey('delete-account-submit'),
                    style: FilledButton.styleFrom(backgroundColor: theme.colorScheme.error, foregroundColor: theme.colorScheme.onError),
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text(l10n.deleteAccountAction),
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
