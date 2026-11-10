import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../design/theme.dart';
import '../features/app_lock/presentation/app_lock_gate.dart';
import '../features/auth/presentation/web_portal_gate.dart';
import '../features/calls/presentation/call_presenter.dart';
import '../features/legal/presentation/legal_gate.dart';
import '../features/rewards/presentation/reward_celebration.dart';
import '../features/settings/application/theme_mode_controller.dart';
import '../l10n/app_localizations.dart';
import 'router.dart';

/// The user's language choice. `null` means "follow the device" (§46).
///
/// Persisted by the settings feature; held here so the whole app rebuilds on a change.
class LocaleController extends Notifier<Locale?> {
  @override
  Locale? build() => null;

  void set(Locale? locale) => state = locale;
}

final localeOverrideProvider =
    NotifierProvider<LocaleController, Locale?>(LocaleController.new);

class JawwidApp extends ConsumerWidget {
  const JawwidApp({super.key});

  /// Arabic first — it is the primary audience, and listing it first makes it the fallback
  /// when the device locale matches neither entry (§45).
  static const supportedLocales = <Locale>[Locale('ar'), Locale('en')];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final override = ref.watch(localeOverrideProvider);

    // The type scale differs between Arabic and Latin (Arabic needs more leading), so the
    // theme is rebuilt when the resolved language changes rather than fixed at startup.
    final resolved = override ??
        resolveLocale(
          WidgetsBinding.instance.platformDispatcher.locale,
          supportedLocales,
        );
    final isArabic = resolved.languageCode == 'ar';

    return MaterialApp.router(
      onGenerateTitle: (context) => L10n.of(context).appName,
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: JawwidTheme.light(isArabic: isArabic),
      darkTheme: JawwidTheme.dark(isArabic: isArabic),
      // Auto by default. `ThemeMode.system` is re-resolved by MaterialApp
      // against the platform brightness, so Auto tracks the device live rather
      // than freezing whatever was set at launch.
      themeMode: ref.watch(themeModeProvider),
      locale: override,
      supportedLocales: supportedLocales,
      localizationsDelegates: const [
        L10n.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      localeResolutionCallback: resolveLocale,
      builder: (context, child) {
        // Clamp text scaling. Parents often run large system fonts; beyond ~1.6 the chat
        // layout stops being usable, but scaling must not be disabled outright (§53).
        final media = MediaQuery.of(context);
        final scale = media.textScaler.clamp(
          minScaleFactor: 0.85,
          maxScaleFactor: 1.6,
        );

        return MediaQuery(
          data: media.copyWith(textScaler: scale),
          // W7: a call has to be able to appear wherever the user is, so the
          // presenter wraps the whole router rather than one screen. It renders
          // nothing itself; see `call_presenter.dart`.
          //
          // PD-23: the app lock sits over everything the router renders, so no
          // protected route can show above an unlocked check -- except the call
          // screen, which a locked app still rings and answers on (see
          // `app_lock_gate.dart`).
          //
          // PD-28: in a browser, an account that is not a teacher's gets the "web portal is
          // for teachers" screen in place of all of it -- calls included. A no-op on a phone.
          //
          // PD-55: a reward's celebration plays over all of it -- a call included --
          // and never takes a tap (`reward_celebration.dart`). LR-46: not while the app is
          // shown over the phone's lock screen for a call: it waits until unlocked.
          //
          // PD-58: the Terms of Use gate, under the app lock -- see [sessionGates].
          child: RewardCelebrationHost(
            child: WebPortalGate(
              child: CallPresenter(
                child: sessionGates(child ?? const SizedBox.shrink()),
              ),
            ),
          ),
        );
      },
    );
  }

  /// The gates between a signed-in session and the router, outermost first.
  ///
  /// PD-23 `AppLockGate` is OUTSIDE PD-58 `LegalGate`, on purpose:
  ///  * a locked device shows the lock screen over the legal gate, so nothing of the account
  ///    (its documents, Delete account) is readable or reachable before the device unlocks;
  ///  * the lock screen, its unlock and its own Sign out are never covered by the legal gate,
  ///    and the legal gate offers Sign out itself;
  ///  * the legal gate still covers every route and every dialog a route opens, as the
  ///    developer guide's "before AppLockGate" asks of it: it is the next thing the router's
  ///    output meets, and the app-lock offer waits while it is up (`legalGateShownProvider`).
  /// `WebPortalGate` stays outermost: an account the browser portal is not for gets that
  /// screen and never this one. Public for the tests, which mount exactly this.
  static Widget sessionGates(Widget child) => AppLockGate(child: LegalGate(child: child));

  /// Resolve the device locale against what we support, defaulting to Arabic.
  static Locale resolveLocale(Locale? device, Iterable<Locale> supported) {
    if (device == null) return const Locale('ar');

    for (final locale in supported) {
      if (locale.languageCode == device.languageCode) return locale;
    }
    return const Locale('ar');
  }
}
