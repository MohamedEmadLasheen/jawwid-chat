// PD-55 Phase 1 (4): the board's emoji -- a short list, every one drawable by
// the font the teacher portal bundles, kept on a board as a stamp that an
// older app or viewer shows as a star.
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_emoji.dart';

/// The code points a TrueType font maps (its cmap, format 12).
Set<int> _cmap(Uint8List f) {
  final d = ByteData.sublistView(f);
  final tables = d.getUint16(4);
  var cmap = -1;
  for (var i = 0; i < tables; i++) {
    final at = 12 + 16 * i;
    if (String.fromCharCodes(f.sublist(at, at + 4)) == 'cmap') cmap = d.getUint32(at + 8);
  }
  final out = <int>{};
  final subtables = d.getUint16(cmap + 2);
  for (var i = 0; i < subtables; i++) {
    final start = cmap + d.getUint32(cmap + 4 + 8 * i + 4);
    if (d.getUint16(start) != 12) continue;
    final groups = d.getUint32(start + 12);
    for (var g = 0; g < groups; g++) {
      final at = start + 16 + 12 * g;
      for (var c = d.getUint32(at); c <= d.getUint32(at + 4); c++) {
        out.add(c);
      }
    }
  }
  return out;
}

void main() {
  test('every emoji on the list is in the font the portal bundles -- none would draw as an empty box', () {
    final font = File('web/fonts/NotoColorEmoji.ttf').readAsBytesSync();
    final mapped = _cmap(font);
    for (final e in kBoardEmojiSet) {
      expect(mapped, contains(e.runes.first), reason: '$e (U+${e.runes.first.toRadixString(16)})');
    }
  });

  test('the font travels with its licence (OFL 1.1)', () {
    final licence = File('web/fonts/OFL-NotoColorEmoji.txt').readAsStringSync();
    expect(licence, contains('Copyright 2013 Google Inc.'));
    expect(licence, contains('SIL OPEN FONT LICENSE Version 1.1'));
  });

  test('the list leaves out people, hands, flags and anything negative', () {
    bool isPersonOrHand(int c) => (c >= 0x1F466 && c <= 0x1F487) || (c >= 0x1F44A && c <= 0x1F450) || (c >= 0x1F645 && c <= 0x1F64F) || c == 0x1F44D;
    bool isFlag(int c) => c >= 0x1F1E6 && c <= 0x1F1FF;
    const negative = {'❌', '😢', '😡', '💀', '👎', '😞'};
    for (final e in kBoardEmojiSet) {
      expect(e.runes.any(isPersonOrHand), isFalse, reason: e);
      expect(e.runes.any(isFlag), isFalse, reason: e);
      expect(negative, isNot(contains(e)));
    }
    expect(kBoardEmojiSet.length, kBoardEmoji.fold<int>(0, (n, g) => n + g.emoji.length), reason: 'no emoji twice');
  });

  test('an emoji is a stamp: the character in its text, and back again', () {
    const owl = StampElement(id: 'e1', stamp: StampKind.emoji, rect: Rect.fromLTWH(10, 10, 140, 140), color: Color(0xFF000000), text: '🦉');
    final json = owl.toJson();
    expect(json['stamp'], 'emoji');
    expect(json['text'], '🦉');
    final back = BoardElement.fromJson(json) as StampElement;
    expect(back.stamp, StampKind.emoji);
    expect(back.text, '🦉');
  });

  // An app from before shows an emoji as a star. If its teacher then edits that
  // page, it saves the star (with the emoji still in the text): a cost of
  // running an old app, never a crash or a lost page.
  test('an app from before reads an unknown stamp as a star', () {
    final read = BoardElement.fromJson({'id': 'e1', 'kind': 'stamp', 'stamp': 'sparkly_new_kind', 'x': 0, 'y': 0, 'w': 140, 'h': 140, 'text': '🦉'}) as StampElement;
    expect(read.stamp, StampKind.star);
    expect(read.toJson()['text'], '🦉', reason: 'its text rides along untouched');
  });
}
