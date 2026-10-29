import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../password_policy.dart';
import 'recovery_widgets.dart';

enum _Stage { phone, code, found }

/// PD-25 forgot e-mail: the parent's phone -> a 6-digit code on WhatsApp, sent to the phone
/// the ACADEMY has on file (never to the number typed) -> the sign-in e-mail. From there the
/// parent either signs in with the password they remember, or -- with the same code -- sets
/// a new one.
///
/// The phone is typed by the parent and sent once; the app never receives, stores or shows a
/// phone number from the server (the contact-file rule). The first step answers the same for
/// any number, so the screen says "if this number is on file" rather than confirming one.
class ForgotEmailScreen extends ConsumerStatefulWidget {
  const ForgotEmailScreen({super.key, this.codeMinutes = 10});

  final int codeMinutes;

  static Future<RecoveryResult?> open(BuildContext context, {int codeMinutes = 10}) {
    return Navigator.of(context).push<RecoveryResult>(
      MaterialPageRoute(builder: (_) => ForgotEmailScreen(codeMinutes: codeMinutes)),
    );
  }

  @override
  ConsumerState<ForgotEmailScreen> createState() => _ForgotEmailScreenState();
}

class _ForgotEmailScreenState extends ConsumerState<ForgotEmailScreen> {
  static final _phoneRe = RegExp(r'^\+?[0-9 ()-]{5,32}$');

  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  _Stage _stage = _Stage.phone;
  List<String> _emails = const [];
  String? _chosen;
  bool _newPassword = false;
  bool _busy = false;
  bool _tried = false;
  String? _error;
  String? _notice;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  bool get _phoneOk => _phoneRe.hasMatch(_phone.text.trim()) && RegExp(r'[0-9]').allMatches(_phone.text).length >= 5;

  void _begin() => setState(() {
        _busy = true;
        _error = null;
        _notice = null;
      });

  void _fail(Object e) {
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = recoveryErrorText(L10n.of(context), e);
    });
  }

  Future<void> _send({bool again = false}) async {
    final l10n = L10n.of(context);
    setState(() => _tried = true);
    if (!_phoneOk) return;
    _begin();
    try {
      await ref.read(accountRecoveryRepositoryProvider).requestEmailCode(_phone.text.trim());
      if (!mounted) return;
      setState(() {
        _busy = false;
        _stage = _Stage.code;
        _tried = false;
        _notice = again ? l10n.recoveryResent : null;
      });
    } catch (e) {
      _fail(e);
      if (again) rethrow;
    }
  }

  Future<void> _verify() async {
    setState(() => _tried = true);
    if (!recoveryCodeRe.hasMatch(_code.text.trim())) return;
    _begin();
    try {
      final emails = await ref.read(accountRecoveryRepositoryProvider).verifyEmailCode(
            phone: _phone.text.trim(),
            code: _code.text.trim(),
          );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _tried = false;
        _emails = emails;
        _chosen = emails.length == 1 ? emails.single : null;
        _stage = _Stage.found;
      });
    } catch (e) {
      _fail(e);
    }
  }

  void _startOver() {
    setState(() {
      _stage = _Stage.phone;
      _tried = false;
      _error = null;
      _notice = null;
      _code.clear();
    });
  }

  void _signIn() {
    if (_chosen == null) return;
    Navigator.of(context).pop<RecoveryResult>((username: _chosen!, password: null));
  }

  Future<void> _setPassword() async {
    setState(() => _tried = true);
    if (_chosen == null || _password.text.length < kPasswordMinLength || _password.text != _confirm.text) return;
    _begin();
    try {
      await ref.read(passwordResetRepositoryProvider).complete(
            username: _chosen!,
            code: _code.text.trim(),
            password: _password.text,
          );
      if (!mounted) return;
      Navigator.of(context).pop<RecoveryResult>((username: _chosen!, password: _password.text));
    } catch (e) {
      _fail(e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);

    final children = <Widget>[
      RecoveryStep(number: _stage.index + 1, of: 3),
      const SizedBox(height: Spacing.spacing3),
      ...switch (_stage) {
        _Stage.phone => _phoneStep(l10n, theme),
        _Stage.code => _codeStep(l10n, theme),
        _Stage.found => _foundStep(l10n, theme),
      },
      if (_error != null) ...[
        const SizedBox(height: Spacing.spacing3),
        RecoveryErrorText(_error!),
      ],
      if (_notice != null) ...[
        const SizedBox(height: Spacing.spacing3),
        Text(_notice!, key: const ValueKey('recovery-notice'), style: theme.textTheme.bodySmall),
      ],
    ];

    return Scaffold(
      appBar: AppBar(title: Text(l10n.forgotEmailTitle)),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Spacing.spacing7),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
            ),
          ),
        ),
      ),
    );
  }

  Widget _submit(String key, String label, VoidCallback? onPressed) => FilledButton(
        key: ValueKey(key),
        onPressed: _busy ? null : onPressed,
        child: _busy ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(label),
      );

  List<Widget> _phoneStep(L10n l10n, ThemeData theme) => [
        Text(l10n.forgotEmailIntro, style: theme.textTheme.bodyMedium),
        const SizedBox(height: Spacing.spacing5),
        TextField(
          key: const ValueKey('forgot-email-phone'),
          controller: _phone,
          enabled: !_busy,
          keyboardType: TextInputType.phone,
          autofillHints: const [AutofillHints.telephoneNumber],
          textDirection: TextDirection.ltr,
          textInputAction: TextInputAction.send,
          onSubmitted: (_) => _send(),
          decoration: InputDecoration(
            labelText: l10n.forgotEmailPhoneLabel,
            helperText: l10n.forgotEmailPhoneHint,
            helperMaxLines: 2,
            errorText: _tried && !_phoneOk ? l10n.forgotEmailPhoneInvalid : null,
          ),
        ),
        const SizedBox(height: Spacing.spacing6),
        _submit('forgot-email-send', l10n.recoverySendCode, _send),
      ];

  List<Widget> _codeStep(L10n l10n, ThemeData theme) => [
        Text(l10n.forgotEmailCodeSent(widget.codeMinutes), key: const ValueKey('forgot-email-code-sent'), style: theme.textTheme.bodyMedium),
        const SizedBox(height: Spacing.spacing5),
        TextField(
          key: const ValueKey('forgot-email-code'),
          controller: _code,
          enabled: !_busy,
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          textDirection: TextDirection.ltr,
          maxLength: 6,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _verify(),
          decoration: InputDecoration(
            labelText: l10n.resetCodeLabel,
            counterText: '',
            errorText: _tried && !recoveryCodeRe.hasMatch(_code.text.trim()) ? l10n.recoveryCodeFormat : null,
          ),
        ),
        const SizedBox(height: Spacing.spacing6),
        _submit('forgot-email-verify', l10n.recoveryContinue, _verify),
        ResendCodeButton(enabled: !_busy, onResend: () => _send(again: true)),
        TextButton(
          key: const ValueKey('forgot-email-change-phone'),
          onPressed: _busy ? null : _startOver,
          child: Text(l10n.recoveryChangePhone),
        ),
      ];

  List<Widget> _foundStep(L10n l10n, ThemeData theme) => [
        Text(_emails.length == 1 ? l10n.forgotEmailFound : l10n.forgotEmailFoundMany, style: theme.textTheme.bodyMedium),
        const SizedBox(height: Spacing.spacing4),
        if (_emails.length == 1)
          Card(
            child: ListTile(
              leading: const Icon(Icons.alternate_email),
              title: SelectableText(
                _emails.single,
                key: const ValueKey('forgot-email-found'),
                textDirection: TextDirection.ltr,
                style: theme.textTheme.titleMedium,
              ),
            ),
          )
        else
          RadioGroup<String>(
            groupValue: _chosen,
            onChanged: (v) => setState(() => _chosen = v),
            child: Column(
              children: [
                for (final email in _emails)
                  RadioListTile<String>(
                    key: ValueKey('forgot-email-choice-$email'),
                    value: email,
                    title: Text(email, textDirection: TextDirection.ltr),
                  ),
              ],
            ),
          ),
        const SizedBox(height: Spacing.spacing5),
        if (!_newPassword) ...[
          _submit('forgot-email-sign-in', l10n.forgotEmailSignIn, _chosen == null ? null : _signIn),
          TextButton(
            key: const ValueKey('forgot-email-new-password'),
            onPressed: _busy || _chosen == null ? null : () => setState(() => _newPassword = true),
            child: Text(l10n.forgotEmailSetPassword),
          ),
        ] else ...[
          TextField(
            key: const ValueKey('forgot-email-password'),
            controller: _password,
            enabled: !_busy,
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            textDirection: TextDirection.ltr,
            decoration: InputDecoration(
              labelText: l10n.signupPasswordLabel,
              errorText: _tried && _password.text.length < kPasswordMinLength ? l10n.signupPasswordTooShort : null,
            ),
          ),
          const SizedBox(height: Spacing.spacing4),
          TextField(
            key: const ValueKey('forgot-email-confirm'),
            controller: _confirm,
            enabled: !_busy,
            obscureText: true,
            textDirection: TextDirection.ltr,
            decoration: InputDecoration(
              labelText: l10n.signupPasswordConfirmLabel,
              errorText: _tried && _password.text.length >= kPasswordMinLength && _password.text != _confirm.text ? l10n.signupPasswordsDiffer : null,
            ),
          ),
          const SizedBox(height: Spacing.spacing6),
          _submit('forgot-email-set-password', l10n.resetFinish, _setPassword),
        ],
      ];
}
