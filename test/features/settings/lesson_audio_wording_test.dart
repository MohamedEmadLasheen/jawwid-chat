import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

/// PD-48: the owner approved the lesson-audio texts word for word (2026-10-29). The app's
/// strings are held to docs/legal/pd048-lesson-audio-parent-notice.md, exactly, in both
/// languages: a change to either side without the other fails here.
void main() {
  final doc = File('docs/legal/pd048-lesson-audio-parent-notice.md').readAsStringSync();
  final quotes = doc.split('\n').where((l) => l.startsWith('> ')).map((l) => l.substring(2)).toSet();

  for (final locale in const [Locale('en'), Locale('ar')]) {
    test('every lesson-audio text in ${locale.languageCode} is the approved one', () async {
      final l10n = await L10n.delegate.load(locale);
      expect(quotes, contains('**${l10n.lessonAudioTermsHeading}** ${l10n.lessonAudioTermsBody}'));
      expect(quotes, contains(l10n.lessonAudioNoticeAccept));
      expect(quotes, contains(l10n.lessonAudioAboutBody));
    });
  }

  test('the About title is the approved heading', () async {
    expect((await L10n.delegate.load(const Locale('en'))).lessonAudioAboutTitle, 'About lesson audio');
    expect((await L10n.delegate.load(const Locale('ar'))).lessonAudioAboutTitle, 'عن صوت الدروس');
  });
}
