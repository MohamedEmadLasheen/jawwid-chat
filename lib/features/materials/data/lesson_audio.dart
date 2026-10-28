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
library;

const lessonAudioType = 'jawwid:quran-audio';

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
