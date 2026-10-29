import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';

/// PD-48: Parent Settings → About lesson audio, with its "Terms and privacy" section.
/// Every sentence is the owner's approved wording (2026-10-29), unchanged in either
/// language; only the section header is a UI label. Reachable before sign-in too (the
/// sign-up acknowledgement links here).
class LessonAudioAboutScreen extends StatelessWidget {
  const LessonAudioAboutScreen({super.key});

  static Future<void> open(BuildContext context) =>
      Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => const LessonAudioAboutScreen()));

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.lessonAudioAboutTitle)),
      body: ListView(
        padding: const EdgeInsets.all(Spacing.spacing5),
        children: [
          Text(l10n.lessonAudioAboutBody, key: const ValueKey('lesson-audio-about-body'), style: theme.textTheme.bodyLarge),
          const SizedBox(height: Spacing.spacing6),
          Text(l10n.lessonAudioTermsTitle, style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: Spacing.spacing3),
          Text.rich(
            key: const ValueKey('lesson-audio-terms'),
            TextSpan(children: [
              TextSpan(text: l10n.lessonAudioTermsHeading, style: const TextStyle(fontWeight: FontWeight.w700)),
              const TextSpan(text: ' '),
              TextSpan(text: l10n.lessonAudioTermsBody),
            ]),
            style: theme.textTheme.bodyMedium,
          ),
        ],
      ),
    );
  }
}
