import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/data/repositories.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import 'forgot_email_screen.dart';
import 'forgot_password_screen.dart';
import 'password_reset_screen.dart';
import 'recovery_widgets.dart';

/// PD-25: "Trouble signing in?" -- one place on the sign-in screen for every way back in.
///
///   * I forgot my password  -> a code by e-mail            (when the deployment sends e-mail)
///   * I forgot my e-mail    -> a code by WhatsApp           (when it sends WhatsApp)
///   * I have a code from the academy -> the PD-21 reset    (always)
///
/// A way the server has not switched on is not offered at all, rather than offered and then
/// failing; the supervisor stays the fallback for everything.
class AccountRecoveryScreen extends ConsumerStatefulWidget {
  const AccountRecoveryScreen({super.key, this.initialUsername = ''});

  final String initialUsername;

  static Future<RecoveryResult?> open(BuildContext context, {String initialUsername = ''}) {
    return Navigator.of(context).push<RecoveryResult>(
      MaterialPageRoute(builder: (_) => AccountRecoveryScreen(initialUsername: initialUsername)),
    );
  }

  @override
  ConsumerState<AccountRecoveryScreen> createState() => _AccountRecoveryScreenState();
}

class _AccountRecoveryScreenState extends ConsumerState<AccountRecoveryScreen> {
  late final Future<RecoveryOptions> _options = _load();

  Future<RecoveryOptions> _load() async {
    try {
      return await ref.read(accountRecoveryRepositoryProvider).options();
    } catch (_) {
      // Offline or an older server: the academy's code is still a way in.
      return RecoveryOptions.none;
    }
  }

  Future<void> _forward(Future<RecoveryResult?> step) async {
    final result = await step;
    if (result != null && mounted) Navigator.of(context).pop<RecoveryResult>(result);
  }

  Future<void> _haveCode() async {
    final result = await PasswordResetScreen.open(context, initialUsername: widget.initialUsername);
    if (result != null && mounted) {
      Navigator.of(context).pop<RecoveryResult>((username: result.username, password: result.password));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.recoveryTitle)),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Spacing.spacing7),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: FutureBuilder<RecoveryOptions>(
                future: _options,
                builder: (context, snapshot) {
                  if (snapshot.connectionState != ConnectionState.done) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final options = snapshot.data ?? RecoveryOptions.none;
                  final selfService = options.email || options.whatsapp;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(selfService ? l10n.recoveryIntro : l10n.recoveryUnavailable, style: theme.textTheme.bodyMedium),
                      const SizedBox(height: Spacing.spacing5),
                      if (options.email)
                        _Choice(
                          key: const ValueKey('recovery-forgot-password'),
                          icon: Icons.lock_reset,
                          title: l10n.recoveryForgotPassword,
                          subtitle: l10n.recoveryForgotPasswordHint,
                          onTap: () => _forward(ForgotPasswordScreen.open(
                            context,
                            initialEmail: widget.initialUsername,
                            codeMinutes: options.codeMinutes,
                          )),
                        ),
                      if (options.whatsapp)
                        _Choice(
                          key: const ValueKey('recovery-forgot-email'),
                          icon: Icons.alternate_email,
                          title: l10n.recoveryForgotEmail,
                          subtitle: l10n.recoveryForgotEmailHint,
                          onTap: () => _forward(ForgotEmailScreen.open(context, codeMinutes: options.codeMinutes)),
                        ),
                      _Choice(
                        key: const ValueKey('recovery-have-code'),
                        icon: Icons.pin_outlined,
                        title: l10n.recoveryHaveCode,
                        subtitle: l10n.recoveryHaveCodeHint,
                        onTap: _haveCode,
                      ),
                      const SizedBox(height: Spacing.spacing5),
                      Text(l10n.recoveryStillStuck, style: theme.textTheme.bodySmall),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Choice extends StatelessWidget {
  const _Choice({super.key, required this.icon, required this.title, required this.subtitle, required this.onTap});

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: Spacing.spacing3),
      child: ListTile(
        leading: Icon(icon),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
