import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../l10n/app_localizations.dart';

/// PD-56 (store compliance): where the privacy policy and the terms of use live (support contact: P-5, below). Both are
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

/// P-5 (Apple 1.2 / 1.5): where a person reaches the academy for help, from build-time
/// `--dart-define`s: `SUPPORT_URL` (a help page; `{lang}` becomes `ar` or `en`, https only) and
/// `SUPPORT_EMAIL` (a plain address). Either one unset or malformed, its row is not shown.
class SupportContact {
  const SupportContact({required this.url, required this.email});

  final String url;
  final String email;

  static final _plausibleEmail = RegExp(r'^[^\s@:/]+@[^\s@:/.]+(\.[^\s@:/.]+)+$');

  /// The help page in the reader's language, or null.
  Uri? pageFor(String languageCode) => LegalLinks._resolve(url, languageCode);

  /// The address, trimmed, when it looks like an e-mail address; otherwise null.
  String? get emailAddress {
    final raw = email.trim();
    return _plausibleEmail.hasMatch(raw) ? raw : null;
  }

  /// `mailto:` for the address, or null.
  Uri? get mailto {
    final address = emailAddress;
    return address == null ? null : Uri(scheme: 'mailto', path: address);
  }
}

final supportContactProvider = Provider<SupportContact>(
  (ref) => const SupportContact(
    url: String.fromEnvironment('SUPPORT_URL'),
    email: String.fromEnvironment('SUPPORT_EMAIL'),
  ),
);

/// Opens a legal page outside the app (the system browser). Overridden in tests.
final legalLinkOpenerProvider = Provider<Future<bool> Function(Uri)>(
  (ref) => (uri) => launchUrl(uri, mode: LaunchMode.externalApplication),
);

/// "Privacy policy · Terms of use · Help and support · Contact support" under the sign-in
/// and sign-up forms. Each is left out when its build-time value is unset; nothing when all are.
class LegalLinksRow extends ConsumerWidget {
  const LegalLinksRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final lang = Localizations.localeOf(context).languageCode;
    final links = ref.watch(legalLinksProvider);
    final support = ref.watch(supportContactProvider);
    final open = ref.watch(legalLinkOpenerProvider);
    final privacy = links.privacyPolicyFor(lang);
    final terms = links.termsFor(lang);
    final help = support.pageFor(lang);
    final mail = support.mailto;
    if (privacy == null && terms == null && help == null && mail == null) return const SizedBox.shrink();
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
        if (help != null)
          TextButton(
            key: const ValueKey('legal-support-help'),
            onPressed: () => open(help),
            child: Text(l10n.supportHelpAction),
          ),
        if (mail != null)
          TextButton(
            key: const ValueKey('legal-support-email'),
            onPressed: () => open(mail),
            child: Text(l10n.supportContactAction),
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

/// P-5: "Help and support" (the page) and "Contact support" (the e-mail) as Settings rows.
/// A row is left out when its value is unset or malformed.
class SupportLinksTiles extends ConsumerWidget {
  const SupportLinksTiles({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = L10n.of(context);
    final lang = Localizations.localeOf(context).languageCode;
    final support = ref.watch(supportContactProvider);
    final open = ref.watch(legalLinkOpenerProvider);
    final help = support.pageFor(lang);
    final mail = support.mailto;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (help != null)
          ListTile(
            key: const ValueKey('settings-support-help'),
            leading: const Icon(Icons.help_outline),
            title: Text(l10n.supportHelpAction),
            trailing: const Icon(Icons.open_in_new),
            onTap: () => open(help),
          ),
        if (mail != null)
          ListTile(
            key: const ValueKey('settings-support-email'),
            leading: const Icon(Icons.mail_outline),
            title: Text(l10n.supportContactAction),
            subtitle: Text(support.emailAddress!),
            trailing: const Icon(Icons.open_in_new),
            onTap: () => open(mail),
          ),
      ],
    );
  }
}
