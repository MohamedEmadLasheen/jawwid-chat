import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/user_role.dart';

/// PD-56 (store compliance, Apple 5.1.1(v)): a parent or a teacher deletes their own
/// account. The screen says what goes and what is kept, asks for the password again, then
/// asks once more in a dialog. On success the server has already ended every session, so
/// the app clears what is local without calling `/auth/logout`.
///
/// O-3 (owner, 2026-11-07): a teacher with lessons, students or payroll still open is never
/// refused. The screen offers "Request account deletion", confirms with the deadline date, and
/// then shows the request: "Requested on X; your account will be deleted by Y", with
/// "Cancel request". The server decides which it is; `GET /me/account/deletion` says so first.
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

  /// A teacher's view of what deleting does now (null for a parent, or until it loads).
  AccountDeletionStatus? _status;
  bool _loadingStatus = false;

  /// The teacher's pending request, shown instead of the form.
  AccountDeletionRequest? _request;

  @override
  void initState() {
    super.initState();
    if (ref.read(currentRoleProvider) == UserRole.teacher) _loadStatus();
  }

  Future<void> _loadStatus() async {
    setState(() => _loadingStatus = true);
    try {
      final status = await ref.read(accountDeletionRepositoryProvider).status();
      if (!mounted) return;
      setState(() {
        _status = status;
        _request = status.request?.isPending == true ? status.request : null;
        _loadingStatus = false;
      });
    } catch (_) {
      // Unknown: the ordinary form. The server still decides, and answers with a request if so.
      if (mounted) setState(() => _loadingStatus = false);
    }
  }

  /// A teacher whose deletion would be a request (O-3).
  bool get _asRequest => _status != null && !_status!.immediate;

  String _day(DateTime at) => DateFormat.yMMMMd(Localizations.localeOf(context).toLanguageTag()).format(at.toLocal());

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
        title: Text(_asRequest ? l10n.deleteAccountRequestAction : l10n.deleteAccountTitle),
        content: Text(
          _asRequest ? l10n.deleteAccountRequestConfirm(_day(_status!.deadlineIfRequested)) : l10n.deleteAccountConfirm,
          key: const ValueKey('delete-account-confirm-text'),
        ),
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
            child: Text(_asRequest ? l10n.deleteAccountRequestAction : l10n.deleteAccountAction),
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
    final AccountDeletionOutcome outcome;
    try {
      outcome = await ref.read(accountDeletionRepositoryProvider).deleteAccount(password: _password.text);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = _errorText(l10n, e);
      });
      return;
    }
    if (!outcome.deleted) {
      // O-3: a request. Nothing is deleted yet and the session stays.
      if (!mounted) return;
      _password.clear();
      setState(() {
        _busy = false;
        _tried = false;
        _request = outcome.request;
      });
      messenger.showSnackBar(SnackBar(content: Text(l10n.deleteAccountRequested)));
      return;
    }
    await auth.signOut(serverAlreadyEnded: true);
    messenger.showSnackBar(SnackBar(content: Text(l10n.deleteAccountDone)));
    // Signing out leaves this screen; if anything keeps it up, it must not spin forever.
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _cancelRequest() async {
    final l10n = L10n.of(context);
    final sure = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.deleteAccountRequestCancel),
        content: Text(l10n.deleteAccountRequestCancelConfirm),
        actions: [
          TextButton(
            key: const ValueKey('delete-account-request-keep'),
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.deleteAccountRequestKeep),
          ),
          TextButton(
            key: const ValueKey('delete-account-request-cancel-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.deleteAccountRequestCancel),
          ),
        ],
      ),
    );
    if (sure != true || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(accountDeletionRepositoryProvider).cancelRequest();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = l10n.deleteAccountRequestCancelFailed;
      });
      // Already cancelled or completed elsewhere: show what the server has now.
      if (e is AppError && e.code == 'AUTH.DELETION_REQUEST_NOT_PENDING') await _loadStatus();
      return;
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _request = null;
    });
    messenger.showSnackBar(SnackBar(content: Text(l10n.deleteAccountRequestCancelled)));
    await _loadStatus();
  }

  Widget _requestCard(L10n l10n, ThemeData theme, AccountDeletionRequest request) {
    return Card(
      key: const ValueKey('delete-account-request-card'),
      child: Padding(
        padding: const EdgeInsets.all(Spacing.spacing5),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.deleteAccountRequestStatusTitle, style: theme.textTheme.titleMedium),
            const SizedBox(height: Spacing.spacing4),
            Text(
              l10n.deleteAccountRequestStatus(_day(request.requestedAt), _day(request.deadlineAt)),
              key: const ValueKey('delete-account-request-status'),
            ),
            if (_error != null) ...[
              const SizedBox(height: Spacing.spacing4),
              Text(
                _error!,
                key: const ValueKey('delete-account-error'),
                style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
              ),
            ],
            const SizedBox(height: Spacing.spacing5),
            OutlinedButton(
              key: const ValueKey('delete-account-request-cancel'),
              onPressed: _busy ? null : _cancelRequest,
              child: _busy
                  ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(l10n.deleteAccountRequestCancel),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final isParent = ref.watch(currentRoleProvider) == UserRole.parent;
    final missing = _tried && _password.text.isEmpty;
    final request = _request;

    if (_loadingStatus || request != null) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.deleteAccountTitle)),
        body: SafeArea(
          child: Center(
            child: _loadingStatus && request == null
                ? const CircularProgressIndicator()
                : SingleChildScrollView(
                    padding: const EdgeInsets.all(Spacing.spacing7),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 420),
                      child: _requestCard(l10n, theme, request!),
                    ),
                  ),
          ),
        ),
      );
    }

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
                  if (_asRequest) ...[
                    const SizedBox(height: Spacing.spacing4),
                    Text(l10n.deleteAccountRequestIntro, key: const ValueKey('delete-account-request-intro')),
                  ],
                  const SizedBox(height: Spacing.spacing5),
                  // A request is not "deleted now": what goes, goes with the account (O-3).
                  Text(
                    _asRequest ? l10n.deleteAccountGoesOnRequest : l10n.deleteAccountGoes,
                    key: const ValueKey('delete-account-goes'),
                  ),
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
                        : Text(_asRequest ? l10n.deleteAccountRequestAction : l10n.deleteAccountAction),
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
