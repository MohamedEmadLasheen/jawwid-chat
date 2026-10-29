import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../l10n/app_localizations.dart';
import '../data/parent_notice_repository.dart';
import 'lesson_audio_about_screen.dart';

/// PD-48: a family already enrolled acknowledges the lesson-audio notice ONCE, at its
/// next sign-in (owner 2026-10-29). The parent shell asks the server; only when this
/// parent has no acknowledgement of the current version is the notice shown, and only
/// once per account per app session. The child's lesson screen shows nothing.
class LessonAudioNoticeGate extends ConsumerStatefulWidget {
  const LessonAudioNoticeGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<LessonAudioNoticeGate> createState() => _LessonAudioNoticeGateState();
}

class _LessonAudioNoticeGateState extends ConsumerState<LessonAudioNoticeGate> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_maybeAsk()));
  }

  Future<void> _maybeAsk() async {
    final repo = ref.read(parentNoticeRepositoryProvider);
    if (repo == null) return;
    // The account asked about: if another one is signed in by the time the server
    // answers, that answer was about someone else, and it is dropped.
    final accountId = ref.read(authControllerProvider).user?.id;
    if (accountId == null || ref.read(lessonAudioNoticeAskedProvider).contains(accountId)) return;
    final needs = await repo.needsLessonAudio().catchError((Object _) => false);
    if (!needs || !mounted || ref.read(authControllerProvider).user?.id != accountId) return;
    if (ref.read(lessonAudioNoticeAskedProvider).contains(accountId)) return;
    ref.read(lessonAudioNoticeAskedProvider.notifier).mark(accountId);
    final accepted = await showDialog<bool>(context: context, barrierDismissible: false, builder: (_) => const LessonAudioNoticeDialog());
    // Without a record (dismissed, or the request failed) the next sign-in asks again.
    if (accepted == true && mounted && ref.read(authControllerProvider).user?.id == accountId) {
      await repo.acknowledgeLessonAudio().catchError((Object _) {});
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// The notice: the approved About text, the approved line to tick, and the full terms one tap away.
class LessonAudioNoticeDialog extends StatefulWidget {
  const LessonAudioNoticeDialog({super.key});

  @override
  State<LessonAudioNoticeDialog> createState() => _LessonAudioNoticeDialogState();
}

class _LessonAudioNoticeDialogState extends State<LessonAudioNoticeDialog> {
  bool _ticked = false;

  @override
  Widget build(BuildContext context) {
    final l10n = L10n.of(context);
    return AlertDialog(
      title: Text(l10n.lessonAudioAboutTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.lessonAudioAboutBody),
            CheckboxListTile(
              key: const ValueKey('lesson-audio-notice-tick'),
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _ticked,
              onChanged: (v) => setState(() => _ticked = v ?? false),
              title: Text(l10n.lessonAudioNoticeAccept),
            ),
            TextButton(
              key: const ValueKey('lesson-audio-notice-terms'),
              onPressed: () => LessonAudioAboutScreen.open(context),
              child: Text(l10n.lessonAudioTermsTitle),
            ),
          ],
        ),
      ),
      actions: [
        FilledButton(
          key: const ValueKey('lesson-audio-notice-ok'),
          onPressed: _ticked ? () => Navigator.of(context).pop(true) : null,
          child: Text(l10n.okAction),
        ),
      ],
    );
  }
}
