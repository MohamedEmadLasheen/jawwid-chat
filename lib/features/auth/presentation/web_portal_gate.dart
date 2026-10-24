import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../../../shared/models/auth.dart';

/// PD-28 (owner decision 2026-10-24): in a browser, the app is the TEACHER portal.
///
/// True when [user] is signed in, this is the web build, and [user] is not a teacher.
/// Every other case -- the phone builds, and nobody signed in yet -- is left alone.
///
/// This is a choice about which screens a browser offers, not an access control: the server
/// decides every request on its own, exactly as it does for the same account on a phone.
bool webPortalRefuses(AuthUser? user, {bool isWeb = kIsWeb}) =>
    isWeb && user != null && !user.isTeacher;

/// Whether this build refuses the signed-in account, for code outside the widget tree (the
/// time zone sync) that must not act for an account the portal turned away. On a phone it is
/// a constant false that depends on nothing.
final webPortalRefusedProvider = Provider<bool>((ref) {
  if (!kIsWeb) return false;
  return webPortalRefuses(ref.watch(authControllerProvider.select((state) => state.user)));
});

/// Puts [WebPortalRefusal] in place of everything the router renders, for an account the web
/// portal is not for. The routes below are never built for that account, so none of their
/// requests are made.
class WebPortalGate extends ConsumerWidget {
  const WebPortalGate({super.key, required this.child, this.isWeb = kIsWeb});

  final Widget child;

  /// The build target. A parameter only so the gate can be tested on the test host.
  final bool isWeb;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider.select((state) => state.user));
    if (!webPortalRefuses(user, isWeb: isWeb)) return child;
    return WebPortalRefusal(user: user!);
  }
}

/// "The web portal is for teachers", and the one thing left to do here: sign out.
class WebPortalRefusal extends ConsumerStatefulWidget {
  const WebPortalRefusal({super.key, required this.user});

  final AuthUser user;

  @override
  ConsumerState<WebPortalRefusal> createState() => _WebPortalRefusalState();
}

class _WebPortalRefusalState extends ConsumerState<WebPortalRefusal> {
  bool _signingOut = false;

  Future<void> _signOut() async {
    setState(() => _signingOut = true);
    try {
      await ref.read(authControllerProvider.notifier).signOut();
    } finally {
      if (mounted) setState(() => _signingOut = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    // A parent belongs in the phone app; a staff member (Sales, the super admin) in Admin Web.
    final body = widget.user.isParent ? l10n.webPortalFamilyBody : l10n.webPortalStaffBody;

    return Scaffold(
      key: const ValueKey('web-portal-refusal'),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Spacing.spacing7),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(Icons.laptop_outlined, size: 48, color: theme.colorScheme.primary),
                  const SizedBox(height: Spacing.spacing6),
                  Text(
                    l10n.webPortalTitle,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: Spacing.spacing4),
                  Text(body, textAlign: TextAlign.center, style: theme.textTheme.bodyLarge),
                  const SizedBox(height: Spacing.spacing7),
                  FilledButton(
                    key: const ValueKey('web-portal-sign-out'),
                    onPressed: _signingOut ? null : _signOut,
                    child: Text(l10n.signOutAction),
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
