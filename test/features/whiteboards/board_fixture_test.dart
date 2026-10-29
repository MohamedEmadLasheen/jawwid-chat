// PD-39: the shared board fixture (test/fixtures/whiteboards/page-every-kind.json)
// is exactly what this portal writes. The API accepts it and Admin Web's
// staff viewer draws it from the same file, so the three agree on a board's
// JSON: a change to the shape here fails here first.
import 'dart:convert';
import 'dart:io';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/tokens.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';

void main() {
  final fixture = jsonDecode(File('test/fixtures/whiteboards/page-every-kind.json').readAsStringSync()) as Map<String, Object?>;
  final pageJson = fixture['page']! as Map<String, Object?>;
  final expected = fixture['expect']! as Map<String, Object?>;
  final page = BoardPage.fromJson(pageJson);
  final raw = ((pageJson['document']! as Map)['elements']! as List).cast<Map<String, Object?>>();

  test('every element is read as its own kind, and written back exactly as it came', () {
    expect(page.layout, PageLayout.arabicLines);
    expect(page.background, PageBackground.cream);
    expect(page.elements.map((e) => e.id), raw.map((e) => e['id']));
    for (final (i, e) in page.elements.indexed) {
      final notDrawn = (expected['notDrawn']! as List).contains(e.id);
      expect(e is OpaqueElement, notDrawn, reason: '${e.id} is ${e.runtimeType}');
      expect(e.toJson(), raw[i], reason: e.id);
    }
  });

  test('the packed stroke points decode to the fixture\'s points', () {
    final points = expected['points']! as Map<String, Object?>;
    for (final MapEntry(:key, :value) in points.entries) {
      final ink = page.elements.firstWhere((e) => e.id == key) as InkElement;
      final want = (value! as List).cast<List<Object?>>();
      expect(ink.points.length, want.length, reason: key);
      for (final (i, p) in ink.points.indexed) {
        expect(p.x, closeTo((want[i][0]! as num).toDouble(), 0.05), reason: '$key[$i].x');
        expect(p.y, closeTo((want[i][1]! as num).toDouble(), 0.05), reason: '$key[$i].y');
        expect(p.pressure, closeTo((want[i][2]! as num) / 255, 1e-9), reason: '$key[$i].pressure');
      }
    }
  });

  test('the page colours are the ones Admin Web draws', () {
    final palette = fixture['palette']! as Map<String, Object?>;
    String rgba(Color c) {
      final v = c.toARGB32();
      return '#${(v & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}${(v >> 24).toRadixString(16).padLeft(2, '0')}';
    }

    String rgb(Color c) => rgba(c).substring(0, 7);
    expect(rgb(BoardPalette.ink), palette['ink']);
    for (final b in PageBackground.values) {
      expect(rgb(b.color), palette[b.wire], reason: b.wire);
    }
    expect(rgba(BoardPalette.ruleOnLight), palette['ruleOnLight']);
    expect(rgba(BoardPalette.ruleOnDark), palette['ruleOnDark']);
    expect(rgba(BoardPalette.placeholderOnLight), palette['placeholderOnLight']);
    expect(rgba(BoardPalette.placeholderOnDark), palette['placeholderOnDark']);
  });
}
