import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../l10n/app_localizations.dart';

/// PD-56 (store compliance): where the privacy policy and the terms of use live. Both are
/// build-time `--dart-define`s (`PRIVACY_POLICY_URL`, `TERMS_URL`); the owner writes the
/// texts. A `{lang}` in a URL becomes `ar` or `en`, so one setting serves both languages.
/// Only an https URL is offered; unset or anything else, the link is not shown.
class LegalLinks {
  const LegalLinks({required this.privacyPolicy, required this.terms});

  final String privacyPolicy;
  final String terms;

  Uri? privacyPolicyFor(String languageCode) => _resolve(privacyPolicy, languageCode);
  Uri? termsFor(String languageCode) => _resolve(terms, languageCode);

  static Uri? _resolve(String template, String languageCode) {
    final raw = template.trim();
    if (raw.isEmpty) return null;
    final lang = languageCode == 'ar' ? 'ar' : 'en';
    final uri = Uri.tryParse(raw.replaceAll('{lang}', lang));
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) return null;
    return uri;
  }
}

final legalLinksProvider = Provider<LegalLinks>(
  (ref) => const LegalLinks(
    privacyPolicy: String.fromEnvironment('PRIVACY_POLICY_URL'),
    terms: String.fromEnvironment('TERMS_URL'),
  ),
);

/// Opens a legal page outside the app (the system browser). Overridden in tests.
final legalLinkOpenerProvider = Provider<Future<bool> Function(Uri)>(
  (ref) => (uri) => launchUrl(uri, mode: LaunchMode.externalApplication),
);

/// "Privacy policy · Terms of use" under the sign-in and sign-up forms. Nothing when
/// neither is set.
class LegalLinksRow extends ConsumerWidget {
  const LegalLinksRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final lang = Localizations.localeOf(context).languageCode;
    final links = ref.watch(legalLinksProvider);
    final open = ref.watch(legalLinkOpenerProvider);
    final privacy = links.privacyPolicyFor(lang);
    final terms = links.termsFor(lang);
    if (privacy == null && terms == null) return const SizedBox.shrink();
    return Wrap(
      alignment: WrapAlignment.center,
      children: [
        if (privacy != null)
          TextButton(
            key: const ValueKey('legal-privacy'),
            onPressed: () => open(privacy),
            child: Text(l10n.legalPrivacyPolicy),
          ),
        if (terms != null)
          TextButton(
            key: const ValueKey('legal-terms'),
            onPressed: () => open(terms),
            child: Text(l10n.legalTerms),
          ),
      ],
    );
  }
}

/// The same two links as Settings rows. Nothing when neither is set.
class LegalLinksTiles extends ConsumerWidget {
  const LegalLinksTiles({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final lang = Localizations.localeOf(context).languageCode;
    final links = ref.watch(legalLinksProvider);
    final open = ref.watch(legalLinkOpenerProvider);
    final privacy = links.privacyPolicyFor(lang);
    final terms = links.termsFor(lang);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (privacy != null)
          ListTile(
            key: const ValueKey('settings-legal-privacy'),
            leading: const Icon(Icons.privacy_tip_outlined),
            title: Text(l10n.legalPrivacyPolicy),
            trailing: const Icon(Icons.open_in_new),
            onTap: () => open(privacy),
          ),
        if (terms != null)
          ListTile(
            key: const ValueKey('settings-legal-terms'),
            leading: const Icon(Icons.description_outlined),
            title: Text(l10n.legalTerms),
            trailing: const Icon(Icons.open_in_new),
            onTap: () => open(terms),
          ),
      ],
    );
  }
}
