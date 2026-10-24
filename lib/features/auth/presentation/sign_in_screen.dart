import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/storage/browser_token_store.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/auth_state.dart';
import 'account_recovery_screen.dart';
import 'parent_signup_screen.dart';

/// Username + password sign-in. Accounts are provisioned by Jawwid (§8); a parent whose child
/// was enrolled creates their own (PD-16), and anyone locked out starts at "Trouble signing
/// in?" (PD-25), which offers only the ways back in this deployment has switched on.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _formKey = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _passwordFocus = FocusNode();

  bool _obscured = true;

  /// PD-28 (web only): PD-23's "Keep me signed in on this device". Unticked by default.
  bool _remember = false;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  /// PD-16: a parent whose child was enrolled creates their account, then signs in here.
  Future<void> _openSignup() async {
    final result = await ParentSignupScreen.open(context);
    if (result == null || !mounted) return;
    _username.text = result.email;
    _password.text = result.password;
    await ref.read(authControllerProvider.notifier).signIn(
          username: result.email,
          password: result.password,
          remember: _remember,
        );
  }

  /// PD-25 (and PD-21's academy code): a recovery that set a new password signs in normally
  /// with it; one that only found the e-mail fills the login and waits for the password.
  Future<void> _openRecovery() async {
    final result = await AccountRecoveryScreen.open(context, initialUsername: _username.text.trim());
    if (result == null || !mounted) return;
    _username.text = result.username;
    final password = result.password;
    if (password == null) {
      _password.clear();
      _passwordFocus.requestFocus();
      return;
    }
    _password.text = password;
    await ref.read(authControllerProvider.notifier).signIn(
          username: result.username,
          password: password,
          remember: _remember,
        );
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();

    await ref.read(authControllerProvider.notifier).signIn(
          username: _username.text.trim(),
          password: _password.text,
          remember: _remember,
        );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final state = ref.watch(authControllerProvider);
    final isBusy = state is AuthSigningIn;

    // PD-28: offered only in a browser that can keep a shared token safely (Web Locks and
    // localStorage, see BrowserTokenStore). The phone keeps every session anyway.
    final store = ref.watch(tokenStoreProvider);
    final canRemember = store is BrowserTokenStore && store.persistenceSupported;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Spacing.spacing7),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const _Brand(),
                    const SizedBox(height: Spacing.spacing8),
                    Text(
                      l10n.signInTitle,
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: Spacing.spacing7),

                    if (state is AuthSignedOut) _SignInNotice(state: state),
                    if (state is AuthUnreachable) _UnreachableNotice(state: state),

                    TextFormField(
                      controller: _username,
                      enabled: !isBusy,
                      autofillHints: const [AutofillHints.username],
                      textInputAction: TextInputAction.next,
                      // Credentials are Latin identifiers; forcing LTR here avoids the
                      // caret jumping around inside an otherwise RTL screen (§71).
                      textDirection: TextDirection.ltr,
                      decoration: InputDecoration(labelText: l10n.usernameLabel),
                      validator: (value) =>
                          (value == null || value.trim().isEmpty) ? '' : null,
                      onFieldSubmitted: (_) => _passwordFocus.requestFocus(),
                    ),
                    const SizedBox(height: Spacing.spacing4),

                    TextFormField(
                      controller: _password,
                      focusNode: _passwordFocus,
                      enabled: !isBusy,
                      obscureText: _obscured,
                      autofillHints: const [AutofillHints.password],
                      textInputAction: TextInputAction.done,
                      textDirection: TextDirection.ltr,
                      decoration: InputDecoration(
                        labelText: l10n.passwordLabel,
                        suffixIcon: IconButton(
                          onPressed: () => setState(() => _obscured = !_obscured),
                          icon: Icon(
                            _obscured ? Icons.visibility_off : Icons.visibility,
                          ),
                          tooltip: _obscured ? null : null,
                        ),
                      ),
                      validator: (value) =>
                          (value == null || value.isEmpty) ? '' : null,
                      onFieldSubmitted: (_) => _submit(),
                    ),
                    if (canRemember)
                      CheckboxListTile(
                        key: const ValueKey('sign-in-remember'),
                        contentPadding: EdgeInsets.zero,
                        controlAffinity: ListTileControlAffinity.leading,
                        value: _remember,
                        onChanged: isBusy ? null : (value) => setState(() => _remember = value ?? false),
                        title: Text(l10n.signInKeepSignedIn),
                      ),
                    const SizedBox(height: Spacing.spacing7),

                    FilledButton(
                      onPressed: isBusy ? null : _submit,
                      child: isBusy
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(l10n.signInAction),
                    ),
                    const SizedBox(height: Spacing.spacing3),
                    // PD-28: the web portal is for teachers; a parent creates an account in the app.
                    if (!kIsWeb)
                      TextButton(
                        key: const ValueKey('parent-signup-open'),
                        onPressed: isBusy ? null : _openSignup,
                        child: Text(l10n.signupOpen),
                      ),
                    TextButton(
                      key: const ValueKey('account-recovery-open'),
                      onPressed: isBusy ? null : _openRecovery,
                      child: Text(l10n.recoveryOpen),
                    ),
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

/// Explains why the user is here, when they did not arrive by choice (§7).
class _SignInNotice extends StatelessWidget {
  const _SignInNotice({required this.state});

  final AuthSignedOut state;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);

    // Locked, disabled and wrong-password are three different backend security states and
    // are shown as three different things. Collapsing them would tell someone whose account
    // unlocks in five minutes to go and find an administrator.
    final message = switch (state.reason) {
      SignedOutReason.accountDisabled => l10n.signInFailedDisabled,
      SignedOutReason.accountLocked => l10n.signInFailedLocked,
      SignedOutReason.roleNotSupported => l10n.signInFailedRoleUnsupported,
      SignedOutReason.sessionRevoked ||
      SignedOutReason.sessionExpired =>
        state.error == null ? l10n.sessionExpiredBody : l10n.signInFailedCredentials,
      SignedOutReason.none => state.error == null ? null : l10n.errorServerBody,
    };

    if (message == null) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(bottom: Spacing.spacing5),
      child: Container(
        padding: const EdgeInsets.all(Spacing.spacing4),
        decoration: BoxDecoration(
          color: theme.colorScheme.errorContainer,
          borderRadius: Radii.card,
        ),
        child: Row(
          children: [
            Icon(Icons.info_outline, color: theme.colorScheme.onErrorContainer),
            const SizedBox(width: Spacing.spacing3),
            Expanded(
              child: Text(
                message,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onErrorContainer,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The launch could not reach the server, but the stored session is intact.
///
/// Said plainly, with the way back on the same card: retrying needs no password. The form
/// stays usable below it, because signing in as someone else is still a legitimate choice.
class _UnreachableNotice extends ConsumerWidget {
  const _UnreachableNotice({required this.state});

  final AuthUnreachable state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final ink = theme.colorScheme.onSecondaryContainer;

    return Padding(
      padding: const EdgeInsets.only(bottom: Spacing.spacing5),
      child: Container(
        padding: const EdgeInsets.all(Spacing.spacing4),
        decoration: BoxDecoration(
          color: theme.colorScheme.secondaryContainer,
          borderRadius: Radii.card,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.cloud_off_outlined, color: ink),
                const SizedBox(width: Spacing.spacing3),
                Expanded(
                  child: Text(
                    l10n.sessionUnreachableBody,
                    style: theme.textTheme.bodyMedium?.copyWith(color: ink),
                  ),
                ),
              ],
            ),
            const SizedBox(height: Spacing.spacing3),
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: state.retrying
                  ? const Padding(
                      padding: EdgeInsets.all(Spacing.spacing3),
                      child: SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : TextButton(
                      onPressed: () =>
                          ref.read(authControllerProvider.notifier).restore(),
                      child: Text(l10n.retryAction),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Brand extends StatelessWidget {
  const _Brand();

  /// The approved production lockup, trimmed to its artwork and carrying real
  /// transparency, so it sits on the page background rather than on a white tile.
  ///
  /// Two variants, not one asset and a filter. They share geometry and alpha
  /// exactly; only the teal ink differs. The light teal (#195766) measures
  /// 2.19:1 on the dark canvas and the dark teal (#2A94AD) measures 1.10:1 on
  /// the light one, so neither can serve both — the pair is the fix.
  static const _lockup = 'assets/brand/jawwid-lockup-derived.png';
  static const _lockupDark = 'assets/brand/jawwid-lockup-dark-derived.png';

  /// Height of the ARTWORK, which is also the height of the image: the asset is
  /// trimmed, so unlike the web JPEG there is no padding to compensate for.
  /// `width` is deliberately left unset — one fixed axis and the other follows
  /// the file's own 372:148 ratio, which makes distortion impossible.
  static const double _lockupHeight = 64;

  @override
  Widget build(BuildContext context) {
    // The lockup alone. It used to carry the product name underneath it as real
    // text, which read as the same word twice: the heading immediately below is
    // already "Sign in to Jawwid".
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Image.asset(
      isDark ? _lockupDark : _lockup,
      height: _lockupHeight,
      fit: BoxFit.contain,
      // Decorative, and deliberately so: the heading below names the product in
      // real text, so announcing the artwork too would say it twice (§53).
      excludeFromSemantics: true,
    );
  }
}
