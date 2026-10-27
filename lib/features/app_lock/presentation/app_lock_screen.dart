import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';
import '../application/app_lock_controller.dart';
import 'unlock_platform.dart';

/// The brand lockup, light or dark ink by theme (the same pair the sign-in screen uses: each
/// ink only clears contrast on its own background).
class AppLockBrand extends StatelessWidget {
  const AppLockBrand({super.key});

  static const _lockup = 'assets/brand/jawwid-lockup-derived.png';
  static const _lockupDark = 'assets/brand/jawwid-lockup-dark-derived.png';

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Image.asset(
      isDark ? _lockupDark : _lockup,
      height: 56,
      fit: BoxFit.contain,
      // Decorative: the title below names the app in real text.
      excludeFromSemantics: true,
      // A missing asset must never take the lock screen down with it.
      errorBuilder: (context, error, stackTrace) => const SizedBox(height: 56),
    );
  }
}

/// PD-23: what stands over the app while it is locked.
///
/// The app logo, Unlock (which re-prompts), and Sign out -- the escape for somebody who
/// cannot pass the device's own check. Sign out goes through `AuthController.signOut`, the
/// one sign-out path, so it clears exactly what any other sign-out clears.
///
/// Prompts ONCE by itself when it appears, so the common case is: open the app, look at it,
/// done. After that it only prompts when asked -- a prompt that re-opened itself after every
/// cancel would be a loop with no way out but the sign-out.
class AppLockScreen extends ConsumerStatefulWidget {
  const AppLockScreen({super.key});

  @override
  ConsumerState<AppLockScreen> createState() => _AppLockScreenState();
}

class _AppLockScreenState extends ConsumerState<AppLockScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _unlock();
    });
  }

  void _unlock() {
    final reason = L10n.of(context).appLockReason;
    ref.read(appLockControllerProvider.notifier).unlock(reason: reason);
  }

  Future<void> _signOut() async {
    final l10n = L10n.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(l10n.signOutConfirm),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.cancelAction),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.signOutAction),
          ),
        ],
      ),
    );
    if (confirmed ?? false) {
      await ref.read(authControllerProvider.notifier).signOut();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    final tokens = JawwidTokens.of(context);
    final lock = ref.watch(appLockControllerProvider);

    return Scaffold(
      key: const ValueKey('app-lock-screen'),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Spacing.spacing7),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const AppLockBrand(),
                const SizedBox(height: Spacing.spacing7),
                Icon(Icons.lock_outline, size: 40, color: theme.colorScheme.primary),
                const SizedBox(height: Spacing.spacing5),
                Semantics(
                  header: true,
                  child: Text(
                    l10n.appLockLockedTitle,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                const SizedBox(height: Spacing.spacing3),
                Text(
                  l10n.appLockLockedBody,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium?.copyWith(color: tokens.colorTextSecondary),
                ),
                if (lock.lastAttemptFailed) ...[
                  const SizedBox(height: Spacing.spacing5),
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      l10n.appLockFailed,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(color: tokens.colorStatusDangerFg),
                    ),
                  ),
                ],
                const SizedBox(height: Spacing.spacing7),
                FilledButton.icon(
                  key: const ValueKey('app-lock-unlock'),
                  onPressed: lock.authenticating ? null : _unlock,
                  icon: const Icon(Icons.lock_open_outlined),
                  label: Text(l10n.appLockUnlockAction),
                ),
                const SizedBox(height: Spacing.spacing3),
                TextButton(
                  key: const ValueKey('app-lock-sign-out'),
                  onPressed: lock.authenticating ? null : _signOut,
                  child: Text(l10n.signOutAction),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Covers the app while it is out of the foreground, so the app switcher's snapshot shows
/// the logo rather than a conversation. Also the blank shown while a restored session's
/// lock preference is still being read.
class AppLockPrivacyCover extends StatelessWidget {
  const AppLockPrivacyCover({super.key});

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      key: const ValueKey('app-lock-privacy-cover'),
      color: Theme.of(context).colorScheme.surface,
      child: const Center(child: AppLockBrand()),
    );
  }
}

/// The one-time offer, for a parent or teacher after their first sign-in on this device.
class AppLockOffer extends ConsumerWidget {
  const AppLockOffer({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final controller = ref.read(appLockControllerProvider.notifier);
    void answer({required bool accept}) =>
        controller.answerOffer(accept: accept, reason: l10n.appLockReason);

    return Stack(
      key: const ValueKey('app-lock-offer'),
      children: [
        // Dismissible: tapping outside is an answer too ("not now"), and it is never asked
        // again.
        Positioned.fill(
          child: ModalBarrier(
            // The theme's own scrim, at the opacity a modal dialog's barrier uses.
            color: Theme.of(context).colorScheme.scrim.withValues(alpha: 0.54),
            dismissible: true,
            onDismiss: () => answer(accept: false),
          ),
        ),
        Center(
          child: AlertDialog(
            icon: const Icon(Icons.lock_outline),
            title: Text(l10n.appLockOfferTitle),
            content: Text(l10n.appLockOfferBody(unlockPlatform(context))),
            actions: [
              TextButton(
                key: const ValueKey('app-lock-offer-decline'),
                onPressed: () => answer(accept: false),
                child: Text(l10n.appLockOfferDecline),
              ),
              FilledButton(
                key: const ValueKey('app-lock-offer-accept'),
                onPressed: () => answer(accept: true),
                child: Text(l10n.appLockOfferAccept),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
