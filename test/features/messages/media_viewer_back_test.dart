import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/media_viewer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// The photo viewer leaves by the iOS edge swipe, like every other screen. It used to be
/// a `fullscreenDialog`, which on iOS has no swipe-back at all: the close button was the
/// only way out. A swipe that does not start at the edge stays the photo's.
void main() {
  // No URL: each photo renders its "unavailable" state, which is enough to page through
  // without a network.
  const photos = [
    Attachment(id: 'p1', kind: MessageKind.image),
    Attachment(id: 'p2', kind: MessageKind.image),
  ];

  Future<void> open(WidgetTester tester, {required String language}) async {
    await tester.pumpWidget(
      MaterialApp(
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
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.byType(MediaViewer), findsOneWidget);
  }

  Future<void> swipe(WidgetTester tester, {required double x, required bool rtl}) async {
    final width = tester.view.physicalSize.width / tester.view.devicePixelRatio;
    final gesture = await tester.startGesture(Offset(x, 300));
    for (var i = 0; i < 12; i++) {
      await gesture.moveBy(Offset((rtl ? -1 : 1) * width / 20, 0));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await gesture.up();
    await tester.pumpAndSettle();
  }

  double width(WidgetTester tester) => tester.view.physicalSize.width / tester.view.devicePixelRatio;

  for (final (language, rtl) in [('en', false), ('ar', true)]) {
    testWidgets('[$language] a swipe from the leading edge closes the viewer', (tester) async {
      await open(tester, language: language);

      await swipe(tester, x: rtl ? width(tester) - 4 : 4, rtl: rtl);

      expect(find.byType(MediaViewer), findsNothing);
      expect(find.text('open'), findsOneWidget);
    }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));
  }

  // Edge-only: a swipe that starts mid-screen is the photo's, never a way out.
  //
  // It does not assert that the photo turns. It does not, on main either: each page's
  // InteractiveViewer takes the horizontal pan before the PageView can (a follow-up, not
  // part of back navigation).
  testWidgets('a swipe from the middle does not close the viewer', (tester) async {
    await open(tester, language: 'en');

    await swipe(tester, x: width(tester) / 2, rtl: false);

    expect(find.byType(MediaViewer), findsOneWidget);
  }, variant: TargetPlatformVariant.only(TargetPlatform.iOS));
}
