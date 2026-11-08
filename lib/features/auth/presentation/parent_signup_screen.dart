import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/wire/wire_vocab.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/legal/legal_links.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/legal.dart';
import '../../legal/application/legal_client.dart';
import '../../legal/presentation/legal_gate.dart';
import '../../settings/data/parent_notice_repository.dart';
import '../../settings/presentation/lesson_audio_about_screen.dart';
import '../password_policy.dart';

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
  // PD-48: the lesson-audio notice, ticked before the account is finished (required).
  bool _noticeTicked = false;
  String? _error;

  // PD-58: the family Terms of Use and the Code of Conduct (`GET /auth/signup/legal`), asked
  // for when the screen opens. [_legal] null = not offered (404, the API before ENG-10): no
  // boxes, nothing legal sent. [_legalFailed]: the server could not say (503, no network) --
  // sign-up then fails closed and submits nothing.
  late Future<void> _legalLoad;
  List<LegalDocument>? _legal;
  bool _legalFailed = false;

  /// Ticked documents, by [LegalDocument.id]. Never pre-ticked.
  final Set<String> _legalTicked = {};

  @override
  void initState() {
    super.initState();
    _legalLoad = _loadLegal();
  }

  Future<void> _loadLegal() async {
    try {
      final docs = await ref.read(parentSignupRepositoryProvider).signupLegal();
      if (!mounted) return;
      setState(() {
        _legal = docs;
        _legalFailed = false;
        final ids = {for (final d in docs ?? const <LegalDocument>[]) d.id};
        _legalTicked.removeWhere((id) => !ids.contains(id));
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _legal = null;
        _legalFailed = true;
        _legalTicked.clear();
      });
    }
  }

  bool get _legalAllTicked => (_legal ?? const <LegalDocument>[]).every((d) => _legalTicked.contains(d.id));

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
      WireErrors.legalVersionStale || WireErrors.legalWrongDocuments || WireErrors.legalRequired => l10n.signupLegalChanged,
      WireErrors.legalNotConfigured => l10n.signupLegalUnavailable,
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
    if (!RegExp(r'^[0-9]{6}$').hasMatch(_code.text.trim()) || _password.text.length < kPasswordMinLength || _password.text != _confirm.text) {
      return;
    }
    if (kLessonAudioNoticeLive && !_noticeTicked) return;
    // N3: busy BEFORE the first await, so a second tap cannot start a second submission.
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    // PD-58: the documents must be known before anything is sent. Not yet answered: wait for
    // it. Failed: ask once more, then fail closed -- nothing is submitted.
    await _legalLoad;
    if (!mounted) return;
    if (_legalFailed) {
      _legalLoad = _loadLegal();
      await _legalLoad;
      if (!mounted) return;
      if (_legalFailed) {
        setState(() {
          _busy = false;
          _error = l10n.signupLegalUnavailable;
        });
        return;
      }
    }
    final legal = _legal;
    final client = ref.read(legalClientProvider);
    if (!_legalAllTicked) {
      // The unticked boxes say so themselves.
      setState(() => _busy = false);
      return;
    }
    if (legal != null && client == null) {
      setState(() {
        _busy = false;
        _error = l10n.signupFailed;
      });
      return;
    }
    final locale = Localizations.localeOf(context).toLanguageTag();
    try {
      await ref.read(parentSignupRepositoryProvider).verify(
            email: _email.text.trim(),
            code: _code.text.trim(),
            password: _password.text,
            // Phase 2: no notice shown, so none acknowledged (the server records nothing).
            lessonAudioNotice: kLessonAudioNoticeLive ? kLessonAudioNoticeVersion : null,
            // PD-58: exactly the documents listed and ticked; none when none were offered.
            acceptLegal: legal == null ? null : List.unmodifiable(legal),
            client: legal == null ? null : client,
            locale: legal == null ? null : locale,
          );
      if (!mounted) return;
      Navigator.of(context).pop<ParentSignupResult>((email: _email.text.trim(), password: _password.text));
    } catch (e) {
      if (!mounted) return;
      final code = e is AppError ? e.code : null;
      setState(() {
        _busy = false;
        _error = _errorText(l10n, e);
      });
      // The documents on screen are not the ones in force: reload them and ask again.
      if (code == WireErrors.legalVersionStale || code == WireErrors.legalWrongDocuments || code == WireErrors.legalRequired) {
        setState(_legalTicked.clear);
        _legalLoad = _loadLegal();
        await _legalLoad;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final emailInvalid = _tried && !_codeAsked && !_emailRe.hasMatch(_email.text.trim());
    final codeInvalid = _tried && _codeAsked && !RegExp(r'^[0-9]{6}$').hasMatch(_code.text.trim());
    final passwordShort = _tried && _codeAsked && _password.text.length < kPasswordMinLength;
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
                    // PD-58: one required box per document (the family terms, the Code of
                    // Conduct), each opening its page. Separate from the PD-48 box below.
                    for (final doc in _legal ?? const <LegalDocument>[]) ...[
                      const SizedBox(height: Spacing.spacing4),
                      LegalDocumentTile(
                        document: doc,
                        tickKey: ValueKey('signup-legal-${doc.documentKey}'),
                        openKey: ValueKey('signup-legal-open-${doc.documentKey}'),
                        ticked: _legalTicked.contains(doc.id),
                        // Finishing without the tick is refused; the box itself shows it.
                        isError: _tried,
                        onChanged: _busy
                            ? null
                            : (v) => setState(() {
                                  if (v) {
                                    _legalTicked.add(doc.id);
                                  } else {
                                    _legalTicked.remove(doc.id);
                                  }
                                }),
                      ),
                    ],
                    // PD-48: the owner's approved line, ticked to finish; the notice is one tap
                    // away -- from Phase 2, with the lessons ([kLessonAudioNoticeLive]).
                    if (kLessonAudioNoticeLive) ...[
                    const SizedBox(height: Spacing.spacing4),
                    CheckboxListTile(
                      key: const ValueKey('signup-lesson-audio'),
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      value: _noticeTicked,
                      // Finishing without the tick is refused; the box itself shows it.
                      isError: _tried && !_noticeTicked,
                      onChanged: _busy ? null : (v) => setState(() => _noticeTicked = v ?? false),
                      title: Text(l10n.lessonAudioNoticeAccept),
                    ),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton(
                        key: const ValueKey('signup-lesson-audio-about'),
                        onPressed: () => LessonAudioAboutScreen.open(context),
                        child: Text(l10n.lessonAudioAboutTitle),
                      ),
                    ),
                    ],
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
                  // PD-56: the privacy policy and the terms, before the account exists.
                  const LegalLinksRow(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
