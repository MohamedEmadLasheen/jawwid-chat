import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/media_viewer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// PD-37: the photo viewer swipes between photos, as WhatsApp does -- while
/// the photo is at its own size. Zoomed in, the same drag moves around the
/// photo, and carried on past its edge turns to the next one. Double-tap
/// zooms. The edge swipe still closes the viewer on iOS
/// (media_viewer_back_test).
///
/// What was actually broken: ZOOMED IN, a horizontal drag turned the page
/// instead of moving the photo. At a thumb's pace the unzoomed swipe already
/// worked; it only failed in tests that moved 40 px per event, past both the
/// pager's slop (18) and the zoom's (36) at once, which the zoom then won.
/// These tests drag at 6 px a frame and pin both.
void main() {
  // No URL: each photo renders its "unavailable" state, enough to page through.
  const photos = [
    Attachment(id: 'p1', kind: MessageKind.image),
    Attachment(id: 'p2', kind: MessageKind.image),
    Attachment(id: 'p3', kind: MessageKind.image),
  ];

  Future<void> open(WidgetTester tester, {String language = 'en', List<Attachment> of = photos}) async {
    await tester.pumpWidget(MaterialApp(
      locale: Locale(language),
      theme: JawwidTheme.light(isArabic: language == 'ar'),
      supportedLocales: JawwidApp.supportedLocales,
      localizationsDelegates: const [
        L10n.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: TextButton(
              onPressed: () => showMediaViewer(context, photos: of, initialIndex: 0),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  double width(WidgetTester tester) => tester.view.physicalSize.width / tester.view.devicePixelRatio;
  Offset middle(WidgetTester tester) => Offset(width(tester) / 2, 300);

  /// The page on screen's zoom.
  TransformationController zoomOf(WidgetTester tester) =>
      tester.widget<InteractiveViewer>(find.byType(InteractiveViewer).first).transformationController!;

  /// One finger from the middle, [by] pixels to the right (negative: left),
  /// 6 px a frame -- a thumb's pace, not a teleport: the first move decides
  /// which gesture the touch is, as it does on a phone.
  Future<void> drag(WidgetTester tester, double by) async {
    final gesture = await tester.startGesture(middle(tester));
    final steps = (by.abs() / 6).ceil();
    for (var i = 0; i < steps; i++) {
      await gesture.moveBy(Offset(by / steps, 0));
      await tester.pump(const Duration(milliseconds: 8));
    }
    await gesture.up();
    await tester.pumpAndSettle();
  }

  /// Two fingers moving apart ([spread] > 0, zoom in) or together (< 0), both
  /// drifting [drift] px sideways each frame as they go.
  Future<void> pinch(WidgetTester tester, {double spread = 10, double drift = 0}) async {
    final center = middle(tester);
    final start = spread > 0 ? 20.0 : 120.0;
    final a = await tester.startGesture(center - Offset(start, 0), pointer: 1);
    final b = await tester.startGesture(center + Offset(start, 0), pointer: 2);
    for (var i = 0; i < 10; i++) {
      await a.moveBy(Offset(-spread + drift, 0));
      await b.moveBy(Offset(spread + drift, 0));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await a.up();
    await b.up();
    await tester.pumpAndSettle();
  }

  Future<void> doubleTap(WidgetTester tester) async {
    await tester.tapAt(middle(tester));
    await tester.pump(const Duration(milliseconds: 60));
    await tester.tapAt(middle(tester));
    await tester.pumpAndSettle();
  }

  for (final (language, rtl) in [('en', false), ('ar', true)]) {
    // The next photo comes from the trailing side: drag toward the leading one.
    final next = rtl ? 1.0 : -1.0;

    testWidgets('[$language] a swipe turns to the next photo, and back', (tester) async {
      await open(tester, language: language);
      expect(find.text('1 / 3'), findsOneWidget);
      await drag(tester, next * width(tester) * 0.6);
      expect(find.text('2 / 3'), findsOneWidget);
      await drag(tester, next * width(tester) * 0.6);
      expect(find.text('3 / 3'), findsOneWidget);
      await drag(tester, -next * width(tester) * 0.6);
      expect(find.text('2 / 3'), findsOneWidget);
    });

    testWidgets("[$language] zoomed in, a drag carried on past the photo's edge turns to the next one", (tester) async {
      await open(tester, language: language);
      await doubleTap(tester);
      expect(zoomOf(tester).value.getMaxScaleOnAxis(), greaterThan(1.01));
      // First the zoomed photo pans to its edge, then the drag carries on past it.
      await drag(tester, next * width(tester) * 1.6);
      expect(find.text('2 / 3'), findsOneWidget);
      expect(zoomOf(tester).value.getMaxScaleOnAxis(), closeTo(1, 0.01), reason: 'the next photo opens at its size');
    });
  }

  group('zoomed in', () {
    testWidgets('a drag moves the photo, and the pages hold still', (tester) async {
      await open(tester);
      await pinch(tester);
      final zoom = zoomOf(tester);
      expect(zoom.value.getMaxScaleOnAxis(), greaterThan(1.01));
      final before = zoom.value.getTranslation().x;

      await drag(tester, 40); // short of the edge
      expect(zoom.value.getTranslation().x, isNot(closeTo(before, 0.5)), reason: 'the photo moved');
      expect(find.text('1 / 3'), findsOneWidget);
    });

    testWidgets('a long drag that stays inside the photo, either way, never turns it', (tester) async {
      await open(tester);
      await drag(tester, -width(tester) * 0.6); // to the middle photo: one on each side
      expect(find.text('2 / 3'), findsOneWidget);
      await doubleTap(tester); // 2.5x at the centre: 0.75 of a width to either edge
      await drag(tester, width(tester) * 0.4);
      expect(find.text('2 / 3'), findsOneWidget);
      await drag(tester, -width(tester) * 0.4);
      expect(find.text('2 / 3'), findsOneWidget);
    });

    testWidgets('a short drag at the edge does not turn the photo', (tester) async {
      await open(tester);
      await doubleTap(tester);
      await drag(tester, -width(tester) * 0.75); // pans to the edge, a little past it
      expect(find.text('1 / 3'), findsOneWidget);
    });

    testWidgets('pinched back in to its size, the photo swipes again', (tester) async {
      await open(tester);
      await pinch(tester);
      expect(zoomOf(tester).value.getMaxScaleOnAxis(), greaterThan(1.01));
      await pinch(tester, spread: -9); // 240 px apart down to 60 -- fingers never quite meet
      expect(zoomOf(tester).value.getMaxScaleOnAxis(), closeTo(1, 0.01));

      await drag(tester, -width(tester) * 0.6);
      expect(find.text('2 / 3'), findsOneWidget);
    });

    testWidgets('a pinch that drifts sideways never turns the page', (tester) async {
      await open(tester);
      await pinch(tester, drift: -12);
      expect(find.text('1 / 3'), findsOneWidget);
    });
  });

  testWidgets('double-tap zooms in, and double-tap again zooms back out', (tester) async {
    await open(tester);
    await doubleTap(tester);
    expect(zoomOf(tester).value.getMaxScaleOnAxis(), closeTo(2.5, 0.01));
    await doubleTap(tester);
    expect(zoomOf(tester).value.getMaxScaleOnAxis(), closeTo(1, 0.01));
  });

  group('screen readers', () {
    testWidgets('the photo and the counter read "Photo N of M"', (tester) async {
      final semantics = tester.ensureSemantics();
      await open(tester);
      expect(find.bySemanticsLabel('Photo 1 of 3'), findsWidgets);
      expect(find.bySemanticsLabel('1 / 3'), findsNothing, reason: 'not "one slash three"');
      semantics.dispose();
    });

    testWidgets('a page change is announced', (tester) async {
      final said = <String>[];
      tester.binding.defaultBinaryMessenger.setMockDecodedMessageHandler<Object?>(SystemChannels.accessibility,
          (message) async {
        final m = message! as Map<Object?, Object?>;
        if (m['type'] == 'announce') said.add((m['data']! as Map<Object?, Object?>)['message']! as String);
        return null;
      });
      addTearDown(() =>
          tester.binding.defaultBinaryMessenger.setMockDecodedMessageHandler<Object?>(SystemChannels.accessibility, null));
      await open(tester);
      await drag(tester, -width(tester) * 0.6);
      expect(said, ['Photo 2 of 3']);
    });

    testWidgets('one photo is just "Photo", and has no counter', (tester) async {
      final semantics = tester.ensureSemantics();
      await open(tester, of: const [Attachment(id: 'p1', kind: MessageKind.image)]);
      expect(find.bySemanticsLabel('Photo'), findsWidgets);
      expect(find.text('1 / 1'), findsNothing);
      semantics.dispose();
    });
  });

  testWidgets("decoded at the screen's width in pixels, not the photo's", (tester) async {
    await open(tester, of: const [Attachment(id: 'p1', kind: MessageKind.image, url: '/never/there.jpg')]);
    final image = tester.widget<Image>(find.byType(Image).first).image;
    expect(image, isA<ResizeImage>());
    expect((image as ResizeImage).width, (width(tester) * tester.view.devicePixelRatio).round());
  });

  testWidgets('iOS: a swipe from the middle turns the photo and keeps the viewer open', (tester) async {
    await open(tester);
    await drag(tester, -width(tester) * 0.6);
    expect(find.byType(MediaViewer), findsOneWidget);
    expect(find.text('2 / 3'), findsOneWidget);
  }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));
}
