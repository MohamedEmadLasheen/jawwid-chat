/// PD-29: hand a framed Quran lesson its recitation (apps/lessons,
/// src/audio/audio-manifest.ts). The lesson never calls the API and holds no
/// token. The app, signed in, reads `GET /quran/ayahs`, where the server's
/// release gate decides whether THIS account gets audio at all, and passes the
/// answer to the lesson as DATA:
///
///   { type: 'jawwid:quran-audio', surah, ayahs: [{ ayah, audio: { reciter, key, url, sha256 } }] }
///
/// only the ayat that have audio, never their text, never a credential. With no
/// audio for this account there is no message at all. The lesson checks every
/// key and every file's SHA-256 itself.
///
/// ONLY the academy's own lessons site is ever handed audio: the server marks the
/// item `audioEligible` (a lessons-site item, never an allowlisted third-party
/// frame), AND the frame's origin must be this build's JAWWID_LESSONS_ORIGIN.
/// Unset, no lesson gets audio.
library;

import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

const lessonAudioType = 'jawwid:quran-audio';

/// The lessons site's origin, fixed at build time (`--dart-define=JAWWID_LESSONS_ORIGIN=https://…`); '' means none.
final lessonsOriginProvider = Provider<String>((ref) => const String.fromEnvironment('JAWWID_LESSONS_ORIGIN').trim());

/// 286 ayat (the longest surah) is 6 requests of 50: never more.
const _perRequest = 50;
const _maxRequests = 6;

/// `scheme://host[:port]` of [url], or null.
String? lessonOriginOf(String url) {
  final uri = Uri.tryParse(url);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) return null;
  return uri.origin;
}

/// Every `/quran/ayahs` entry of a surah, a page at a time: each page must move
/// forward, and there are never more than 6 requests.
Future<List<Object?>> collectAyahPages(Future<Map<String, Object?>> Function(int from, int? to) page) async {
  final ayahs = <Object?>[];
  var from = 1;
  int? count;
  for (var request = 0; request < _maxRequests && (count == null || from <= count); request++) {
    final to = count == null ? null : (from + _perRequest - 1 < count ? from + _perRequest - 1 : count);
    final d = await page(from, to);
    count = ((d['surah'] as Map?)?['ayahCount'] as num?)?.toInt() ?? 0;
    final entries = (d['ayahs'] as List?) ?? const [];
    int? last;
    for (final e in entries) {
      final n = e is Map ? (e['ayah'] as num?)?.toInt() : null;
      if (n == null || n < from || (to != null && n > to)) continue; // only what this request asked for
      ayahs.add(e);
      last = n;
    }
    if (last == null || last < from) break;
    from = last + 1;
  }
  return ayahs;
}

/// The script a WebView runs to hand the page its audio list: a `message` event
/// to the EXPECTED lesson origin. Both are JSON literals, so data stays data.
String audioInjection(Map<String, Object?> message, String origin) => 'window.postMessage(${jsonEncode(message)}, ${jsonEncode(origin)});';

final _surahPage = RegExp(r'^/lessons/quran/surah-([1-9]\d{0,2})/?$');

/// The surah of a lessons-site Quran page (`…/lessons/quran/surah-N`), or null.
int? lessonSurahOf(String url) {
  final uri = Uri.tryParse(url);
  if (uri == null || (uri.scheme != 'https' && uri.scheme != 'http')) return null;
  final m = _surahPage.firstMatch(uri.path);
  final surah = m == null ? null : int.parse(m.group(1)!);
  return surah != null && surah >= 1 && surah <= 114 ? surah : null;
}

/// The message for [surah] from `/quran/ayahs` entries, or null when none has audio.
Map<String, Object?>? lessonAudioMessage(int surah, Iterable<Object?> ayahs) {
  final out = <Map<String, Object?>>[];
  for (final a in ayahs) {
    if (a is! Map) continue;
    final audio = a['audio'];
    final ayah = a['ayah'];
    if (audio is! Map || ayah is! int) continue;
    out.add({
      'ayah': ayah,
      'audio': {'reciter': audio['reciter'], 'key': audio['key'], 'url': audio['url'], 'sha256': audio['sha256']},
    });
  }
  return out.isEmpty ? null : {'type': lessonAudioType, 'surah': surah, 'ayahs': out};
}
