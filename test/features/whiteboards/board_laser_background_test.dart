// PD-55 PR-3: a laser pointer that explains without marking -- its trail
// fades and is never saved, never undone, never exported -- and a dotted page
// beside blank, lined (Arabic handwriting lines) and grid.
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_page.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_canvas.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_painter.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

const _ink = Color(0xFF1B1B1F);

void main() {
  group('the laser pointer', () {
    late List<List<BoardElement>> commits;
    final key = GlobalKey<BoardCanvasState>();

    Future<void> pump(WidgetTester tester) async {
      commits = [];
      await tester.binding.setSurfaceSize(const Size(1280, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      const stamp = StampElement(id: 'a', stamp: StampKind.star, rect: Rect.fromLTWH(300, 300, 100, 100), color: _ink);
      await tester.pumpWidget(
        MaterialApp(
          theme: JawwidTheme.light(isArabic: false),
          localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
          home: Scaffold(
            body: BoardCanvas(
              key: key,
              page: const BoardPage(id: 'p1', position: 0, layout: PageLayout.plain, background: PageBackground.white, elements: [stamp]),
              tool: BoardTool.laser,
              style: const ToolStyle(color: _ink, width: 6),
              readOnly: false,
              onCommit: commits.add,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('draws a trail while it moves -- over anything, selecting nothing -- and changes nothing on the page', (tester) async {
      await pump(tester);
      final state = key.currentState!;
      final g = await tester.startGesture(state.screenOf(const Offset(200, 350)), kind: PointerDeviceKind.mouse);
      for (var x = 220.0; x <= 600; x += 40) {
        await g.moveTo(state.screenOf(Offset(x, 350)));
        await tester.pump(const Duration(milliseconds: 16));
      }
      expect(state.laserTrail, isNotEmpty);
      expect(state.selection, isEmpty, reason: 'pointing at the star does not select it');
      await g.up();
      await tester.pump(const Duration(milliseconds: 16));
      expect(commits, isEmpty, reason: 'never saved, never an undo step');
    });

    testWidgets('fades: 700 ms after the last move it is gone, and nothing keeps ticking', (tester) async {
      await pump(tester);
      final state = key.currentState!;
      final g = await tester.startGesture(state.screenOf(const Offset(200, 350)), kind: PointerDeviceKind.mouse);
      await g.moveTo(state.screenOf(const Offset(400, 350)));
      await tester.pump(const Duration(milliseconds: 16));
      await g.up();
      await tester.pump(const Duration(milliseconds: 400));
      expect(state.laserTrail, isNotEmpty, reason: 'still fading');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pump(const Duration(milliseconds: 16));
      expect(state.laserTrail, isEmpty);
      expect(tester.binding.hasScheduledFrame, isFalse, reason: 'no ticker left running');
      expect(commits, isEmpty);
    });
  });

  group('the dotted page', () {
    test('is a layout of its own on the wire', () {
      expect(PageLayout.parse('dotted'), PageLayout.dotted);
      expect(PageLayout.dotted.wire, 'dotted');
    });

    testWidgets('draws a dot every 32 units, and nothing between them', (tester) async {
      final pixels = await tester.runAsync(() async {
        final recorder = ui.PictureRecorder();
        paintBackground(Canvas(recorder), PageLayout.dotted, PageBackground.white);
        final image = await recorder.endRecording().toImage(kBoardPageSize.width.toInt(), kBoardPageSize.height.toInt());
        final bytes = await image.toByteData();
        image.dispose();
        return bytes!;
      });
      int luminance(ByteData b, int x, int y) {
        final i = (y * kBoardPageSize.width.toInt() + x) * 4;
        return b.getUint8(i) + b.getUint8(i + 1) + b.getUint8(i + 2);
      }

      expect(luminance(pixels!, 64, 64), lessThan(luminance(pixels, 80, 80)), reason: 'a dot at (64, 64)');
      expect(luminance(pixels, 80, 80), 765, reason: 'white paper between the dots');
    });
  });
}
