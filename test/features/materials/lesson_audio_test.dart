import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/materials/data/lesson_audio.dart';

void main() {
  test('only a lessons-site Quran surah page is a lesson that takes audio', () {
    expect(lessonSurahOf('https://lessons.example.test/lessons/quran/surah-78'), 78);
    expect(lessonSurahOf('https://lessons.example.test/lessons/quran/surah-1/'), 1);
    for (final url in [
      'https://lessons.example.test/lessons/quran/surah-0',
      'https://lessons.example.test/lessons/quran/surah-115',
      'https://lessons.example.test/lessons/quran/surah-078',
      'https://lessons.example.test/lessons/arabic/lesson-1',
      'ftp://lessons.example.test/lessons/quran/surah-78',
      'not a url',
    ]) {
      expect(lessonSurahOf(url), isNull, reason: url);
    }
  });

  test('the message is DATA: {ayah, audio} of the ayat that have audio, never their text; none at all is no message', () {
    Map<String, Object?> audio(int a) => {'reciter': 'kfgqpc-huthify-hafs', 'key': 'quran/audio/kfgqpc-huthify-hafs/078$a.mp3', 'url': 'https://media.example.test/$a', 'sha256': 'a' * 64};
    final message = lessonAudioMessage(78, [
      {'ayah': 1, 'basmala': 'x', 'text': 'stand-in verse', 'sha256': 'b' * 64, 'audio': audio(1)},
      {'ayah': 2, 'text': 'stand-in verse', 'audio': null},
      {'ayah': 3, 'text': 'stand-in verse', 'audio': {...audio(3), 'extra': 'dropped'}},
    ]);
    expect(message, {
      'type': 'jawwid:quran-audio',
      'surah': 78,
      'ayahs': [
        {'ayah': 1, 'audio': audio(1)},
        {'ayah': 3, 'audio': audio(3)},
      ],
    });
    expect(message.toString(), isNot(contains('stand-in verse')));
    expect(lessonAudioMessage(78, [{'ayah': 1, 'audio': null}]), isNull);
  });
}
