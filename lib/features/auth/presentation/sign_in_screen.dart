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
            padding: const EdgeInsets.all(Spacing.xl),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _Brand(name: l10n.appName),
                    const SizedBox(height: Spacing.xxl),
                    Text(
                      l10n.signInTitle,
                      style: theme.textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: Spacing.xs),
                    Text(
                      l10n.signInSubtitle,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: Spacing.xl),

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
                    const SizedBox(height: Spacing.md),

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
                    const SizedBox(height: Spacing.xl),

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
      padding: const EdgeInsets.only(bottom: Spacing.lg),
      child: Container(
        padding: const EdgeInsets.all(Spacing.md),
        decoration: BoxDecoration(
          color: theme.colorScheme.errorContainer,
          borderRadius: Radii.card,
        ),
        child: Row(
          children: [
            Icon(Icons.info_outline, color: theme.colorScheme.onErrorContainer),
            const SizedBox(width: Spacing.sm),
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

  @override
  Widget build(BuildContext context) {
    // Placeholder brand mark. Replaced by the official Jawwid logo once brand assets are
    // supplied — see lib/design/tokens.dart.
    return Column(
      children: [
        Container(
          width: Sizes.avatarXl,
          height: Sizes.avatarXl,
          decoration: const BoxDecoration(
            color: JawwidColors.brand,
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Text(
            name.characters.first,
            style: const TextStyle(
              color: JawwidColors.textOnBrand,
              fontSize: 40,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(height: Spacing.md),
        Text(name, style: Theme.of(context).textTheme.titleLarge),
      ],
    );
  }
}
