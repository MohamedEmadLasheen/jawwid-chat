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

  test('pages /quran/ayahs 50 at a time, only forward, and never more than 6 requests', () async {
    final asked = <(int, int?)>[];
    Future<Map<String, Object?>> pages(int from, int? to) async {
      asked.add((from, to));
      final end = to ?? from + 49;
      return {
        'surah': {'ayahCount': 120},
        'ayahs': [for (var a = from; a <= (end > 120 ? 120 : end); a++) {'ayah': a}],
      };
    }
    final all = await collectAyahPages(pages);
    expect(all.length, 120);
    expect(asked, [(1, null), (51, 100), (101, 120)]);

    // A server that does not move forward is not followed; one that never ends stops at 6.
    var stuck = 0;
    expect(await collectAyahPages((from, to) async {
      stuck++;
      return {'surah': {'ayahCount': 286}, 'ayahs': [{'ayah': 1}]};
    }), hasLength(1));
    expect(stuck, 2);
    var endless = 0;
    await collectAyahPages((from, to) async {
      endless++;
      return {'surah': {'ayahCount': 100000}, 'ayahs': [{'ayah': from + 49}]};
    });
    expect(endless, 6);
  });

  test('the WebView injection posts JSON to the EXPECTED lesson origin, both as literals', () {
    final js = audioInjection({'type': 'jawwid:quran-audio', 'surah': 78, 'ayahs': <Object?>[]}, 'https://lessons.example.test');
    expect(js, 'window.postMessage({"type":"jawwid:quran-audio","surah":78,"ayahs":[]}, "https://lessons.example.test");');
    // A quote in the data stays data.
    expect(audioInjection({'x': '"); alert(1); ("'}, 'https://l.test'), contains(r'"x":"\"); alert(1); (\""'));
  });

  test('a lesson origin is compared exactly: scheme, host and port', () {
    expect(lessonOriginOf('https://lessons.example.test/lessons/quran/surah-78'), 'https://lessons.example.test');
    expect(lessonOriginOf('https://lessons.example.test:8443/x'), 'https://lessons.example.test:8443');
    expect(lessonOriginOf('not a url'), isNull);
  });

  test('PD-48: only a lessons-site Arabic letters page takes voice-over, under its lesson key', () {
    expect(lessonLettersOf('https://lessons.example.test/lessons/arabic/lesson-1'), 'arabic-001');
    expect(lessonLettersOf('https://lessons.example.test/lessons/arabic/lesson-12/'), 'arabic-012');
    for (final url in [
      'https://lessons.example.test/lessons/arabic/lesson-01',
      'https://lessons.example.test/lessons/arabic/lesson-0',
      'https://lessons.example.test/lessons/quran/surah-78',
      'https://lessons.example.test/lessons/arabic/lesson-1/x',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(lessonLettersOf(url), isNull, reason: url);
    }
  });

  test('PD-48: the voice-over message is the API answer field by field, nothing added; an empty one still clears', () {
    final answer = {
      'lesson': 'arabic-001',
      'clips': [
        {'id': 'ba-001', 'audio': {'key': 'k', 'url': 'u', 'sha256': 's', 'textSha256': 't', 'token': 'never'}, 'extra': 1},
        'junk',
        {'id': 7, 'audio': <String, Object?>{}},
      ],
    };
    expect(lessonVoiceMessage('arabic-001', answer), {
      'type': 'jawwid:lesson-audio',
      'lesson': 'arabic-001',
      'clips': [
        {'id': 'ba-001', 'audio': {'key': 'k', 'url': 'u', 'sha256': 's', 'textSha256': 't'}},
      ],
    });
    expect(lessonVoiceMessage('arabic-001', {'lesson': 'arabic-001', 'clips': <Object?>[]}), {'type': 'jawwid:lesson-audio', 'lesson': 'arabic-001', 'clips': <Object?>[]});
    // Another lesson's answer is no message.
    expect(lessonVoiceMessage('arabic-001', {'lesson': 'arabic-002', 'clips': <Object?>[]}), isNull);
  });

  test("a lesson's ready message names its surah or, for a letters lesson, its lesson key", () {
    expect(readyFor({'type': 'jawwid:lesson-ready', 'surah': 78}, 'https://l.test/lessons/quran/surah-78'), isTrue);
    expect(readyFor({'type': 'jawwid:lesson-ready', 'surah': 79}, 'https://l.test/lessons/quran/surah-78'), isFalse);
    expect(readyFor({'type': 'jawwid:lesson-ready', 'lesson': 'arabic-001'}, 'https://l.test/lessons/arabic/lesson-1'), isTrue);
    expect(readyFor({'type': 'jawwid:lesson-ready', 'lesson': 'arabic-002'}, 'https://l.test/lessons/arabic/lesson-1'), isFalse);
    expect(readyFor({'type': 'jawwid:lesson-ready', 'surah': 1}, 'https://l.test/lessons/arabic/lesson-1'), isFalse);
    expect(readyFor({'type': 'other', 'lesson': 'arabic-001'}, 'https://l.test/lessons/arabic/lesson-1'), isFalse);
  });
}
