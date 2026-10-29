// PD-39 (review of #304, carried to the portal): a Tanzil pause mark rides
// above its line in Amiri Quran. A verse is clipped to its box, so the clip
// must reach as high as the first line really draws, or a waqf mark on the
// first line loses its top. Measured on the real font: the text is drawn with
// no clip and its highest inked row is compared with the clip's top.
// The words are plain Arabic, not verse text; the marks are the real U+06DB.
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/whiteboards/data/quran_text_repository.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_painter.dart';

const _mark = 'ۛ';

VerseText _text(String words) => VerseText(
  surah: 2,
  datasetId: 'synthetic',
  rangeSha256: 'a' * 64,
  attribution: '',
  ayahs: [VerseAyah(ayah: 2, text: words)],
);

VerseElement _verse(Rect rect, double size) => VerseElement(
  id: 'v',
  surah: 2,
  fromAyah: 2,
  toAyah: 2,
  datasetId: 'synthetic',
  rangeSha256: 'a' * 64,
  rect: rect,
  fontSize: size,
  color: const Color(0xFF000000),
);

/// The highest row with ink, drawing [paint] into a [w] x [h] picture.
Future<int> _inkTop(void Function(Canvas) paint, int w, int h) async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  paint(canvas);
  final image = await recorder.endRecording().toImage(w, h);
  final data = (await image.toByteData())!;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      if (data.getUint8((y * w + x) * 4 + 3) != 0) return y;
    }
  }
  return h;
}

void main() {
  setUpAll(() async {
    final loader = FontLoader(kQuranFont)
      ..addFont(Future.value(ByteData.view(Uint8List.fromList(File('assets/fonts/AmiriQuran.ttf').readAsBytesSync()).buffer)));
    await loader.load();
  });

  testWidgets('a pause mark on the first line is drawn whole, not cut by the verse clip', (tester) async {
    const size = 64.0;
    const rect = Rect.fromLTWH(20, 300, 1400, 400);
    final text = _text('كلمة $_mark كلمة $_mark كلمة أخرى');
    await tester.runAsync(() async {
      // Unclipped: where the first line really reaches.
      final free = await _inkTop((c) {
        final laid = layoutVerse(text, size, const Color(0xFF000000), rect.width);
        laid.text.paint(c, rect.topLeft);
      }, 1440, 800);
      // As the board draws it.
      final clipped = await _inkTop((c) => paintVerse(c, _verse(rect, size), text), 1440, 800);
      // Measured 2026-10-29: ink top 292, box top 300, clip top 284 (8 px to spare at 64 px).
      expect(free, lessThan(rect.top), reason: 'the mark rides above the box, so the test measures what it means to');
      expect(clipped, free, reason: 'the clip cut ${clipped - free} px off the top of the first line');
    });
  });
}
