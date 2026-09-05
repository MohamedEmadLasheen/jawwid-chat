import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../design/theme.dart';
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

    return MaterialApp.router(
      onGenerateTitle: (context) => L10n.of(context).appName,
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: JawwidTheme.light(),
      darkTheme: JawwidTheme.dark(),
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
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }

  /// Resolve the device locale against what we support, defaulting to Arabic.
  static Locale resolveLocale(Locale? device, Iterable<Locale> supported) {
    if (device == null) return const Locale('ar');

    for (final locale in supported) {
      if (locale.languageCode == device.languageCode) return locale;
    }
    return const Locale('ar');
  }
}
