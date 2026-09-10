import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../domain/auth_state.dart';

/// Username + password sign-in. There is no public registration and no self-service reset:
/// accounts are provisioned by Jawwid (§8), so the screen says so rather than offering a
/// dead-end "forgot password" link.
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

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();

    await ref.read(authControllerProvider.notifier).signIn(
          username: _username.text.trim(),
          password: _password.text,
        );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final state = ref.watch(authControllerProvider);
    final isBusy = state is AuthSigningIn;

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
                    _Brand(name: l10n.appName),
                    const SizedBox(height: Spacing.spacing8),
                    Text(
                      l10n.signInTitle,
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: Spacing.spacing2),
                    Text(
                      l10n.signInSubtitle,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: Spacing.spacing7),

                    if (state is AuthSignedOut) _SignInNotice(state: state),

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

    final message = switch (state.reason) {
      SignedOutReason.accountDisabled => l10n.signInFailedDisabled,
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

class _Brand extends StatelessWidget {
  const _Brand({required this.name});

  final String name;

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
    // The lockup replaces the former `ج` placeholder mark. The Arabic product
    // name stays below it: the artwork carries the LATIN wordmark only, and this
    // is an Arabic-first product, so the two together are what make the screen
    // read as Jawwid. Layout and spacing are unchanged from the placeholder.
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Column(
      children: [
        Image.asset(
          isDark ? _lockupDark : _lockup,
          height: _lockupHeight,
          fit: BoxFit.contain,
          // The product name is rendered as real text directly below, so the
          // artwork would otherwise be announced twice (§53).
          excludeFromSemantics: true,
        ),
        const SizedBox(height: Spacing.spacing4),
        Text(name, style: Theme.of(context).textTheme.titleLarge),
      ],
    );
  }
}
