import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/media_viewer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// PD-37: the photo viewer swipes between photos, as WhatsApp does -- while
/// the photo is at its own size. Zoomed in, the same drag moves around the
/// photo instead. The edge swipe still closes the viewer on iOS
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

  Future<void> open(WidgetTester tester, {String language = 'en'}) async {
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
              onPressed: () => showMediaViewer(context, photos: photos, initialIndex: 0),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('1 / 3'), findsOneWidget);
  }

  double width(WidgetTester tester) => tester.view.physicalSize.width / tester.view.devicePixelRatio;
  Offset middle(WidgetTester tester) => Offset(width(tester) / 2, 300);

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

  /// Two fingers apart: zoom in.
  Future<void> pinchOut(WidgetTester tester) async {
    final center = middle(tester);
    final a = await tester.startGesture(center - const Offset(20, 0), pointer: 1);
    final b = await tester.startGesture(center + const Offset(20, 0), pointer: 2);
    for (var i = 0; i < 10; i++) {
      await a.moveBy(const Offset(-10, 0));
      await b.moveBy(const Offset(10, 0));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await a.up();
    await b.up();
    await tester.pumpAndSettle();
  }

  for (final (language, rtl) in [('en', false), ('ar', true)]) {
    // The next photo comes from the trailing side: drag toward the leading one.
    final next = rtl ? 1.0 : -1.0;

    testWidgets('[$language] a swipe turns to the next photo, and back', (tester) async {
      await open(tester, language: language);
      await drag(tester, next * width(tester) * 0.6);
      expect(find.text('2 / 3'), findsOneWidget);
      await drag(tester, next * width(tester) * 0.6);
      expect(find.text('3 / 3'), findsOneWidget);
      await drag(tester, -next * width(tester) * 0.6);
      expect(find.text('2 / 3'), findsOneWidget);
    });
  }

  testWidgets('zoomed in, a drag moves the photo and the pages hold still', (tester) async {
    await open(tester);
    await pinchOut(tester);
    final zoomed = tester.widget<InteractiveViewer>(find.byType(InteractiveViewer).first);
    expect(zoomed.transformationController!.value.getMaxScaleOnAxis(), greaterThan(1.01));

    await drag(tester, -width(tester) * 0.6);
    expect(find.text('1 / 3'), findsOneWidget, reason: 'the drag panned the zoomed photo');
  });

  testWidgets('back at its own size, the photo swipes again', (tester) async {
    await open(tester);
    await pinchOut(tester);
    final viewer = tester.widget<InteractiveViewer>(find.byType(InteractiveViewer).first);
    viewer.transformationController!.value = Matrix4.identity(); // zoomed back out
    await tester.pumpAndSettle();

    await drag(tester, -width(tester) * 0.6);
    expect(find.text('2 / 3'), findsOneWidget);
  });

  testWidgets('iOS: a swipe from the middle turns the photo and keeps the viewer open', (tester) async {
    await open(tester);
    await drag(tester, -width(tester) * 0.6);
    expect(find.byType(MediaViewer), findsOneWidget);
    expect(find.text('2 / 3'), findsOneWidget);
  }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));
}
