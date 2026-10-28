/// PD-48: the lesson-audio notice a parent acknowledges -- at sign-up, or once at
/// their next sign-in (owner 2026-10-29; docs/product/pd048-lesson-voice-over-design.md
/// §17 Q7). The wording is in lib/l10n (lessonAudio*), word for word as approved.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';

const kLessonAudioNoticeKey = 'lesson_audio';

/// The version of the notice THIS app shows (apps/api/src/lesson-audio/parent-notices.ts).
/// An app showing another version than the server's current one asks nothing: the
/// parent would acknowledge a text they were not shown.
const kLessonAudioNoticeVersion = 1;

abstract interface class ParentNoticeRepository {
  /// `GET /parent-notices` -- whether this parent has still to acknowledge the lesson-audio notice.
  Future<bool> needsLessonAudio();

  /// `POST /parent-notices/lesson_audio/acknowledge` -- idempotent.
  Future<void> acknowledgeLessonAudio();
}

/// A build with no API: nothing to acknowledge.
class NoParentNoticeRepository implements ParentNoticeRepository {
  const NoParentNoticeRepository();

  @override
  Future<bool> needsLessonAudio() async => false;

  @override
  Future<void> acknowledgeLessonAudio() async {}
}

class HttpParentNoticeRepository implements ParentNoticeRepository {
  HttpParentNoticeRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<bool> needsLessonAudio() async {
    final d = (await _client.get<Map<String, Object?>>('/parent-notices')).data ?? const {};
    for (final n in (d['notices'] as List?) ?? const []) {
      if (n is Map && n['key'] == kLessonAudioNoticeKey) {
        return n['version'] == kLessonAudioNoticeVersion && n['acknowledged'] == false;
      }
    }
    return false;
  }

  @override
  Future<void> acknowledgeLessonAudio() async {
    await _client.post<Map<String, Object?>>('/parent-notices/$kLessonAudioNoticeKey/acknowledge', data: {'version': kLessonAudioNoticeVersion});
  }
}

/// Overridden at startup with [HttpParentNoticeRepository].
final parentNoticeRepositoryProvider = Provider<ParentNoticeRepository>((ref) => const NoParentNoticeRepository());

/// The accounts already asked in this app session (an account switch asks the next parent).
class LessonAudioNoticeAsked extends Notifier<Set<String>> {
  @override
  Set<String> build() => const {};

  void mark(String accountId) => state = {...state, accountId};
}

final lessonAudioNoticeAskedProvider = NotifierProvider<LessonAudioNoticeAsked, Set<String>>(LessonAudioNoticeAsked.new);
