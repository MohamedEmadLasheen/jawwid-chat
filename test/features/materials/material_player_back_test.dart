import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/edge_swipe_back.dart';
import 'package:jawwid_chat/features/materials/data/materials_repository.dart';
import 'package:jawwid_chat/features/materials/presentation/activity_view.dart';
import 'package:jawwid_chat/features/materials/presentation/material_player.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/materials.dart';

/// The lesson player leaves by the leading-edge swipe, like every other screen, though
/// a WebView fills it (owner's Android smoke test, 2026-10-27: the swipe left the chat
/// but not the lesson, while the back key did). The lesson keeps every other touch: a
/// page that scrolls sideways still does.
///
/// The WebView is the seam's fake. It counts the horizontal drags that reach it, standing
/// in for the lesson's own scrolling. The real platform view cannot run in a widget test.
void main() {
  late _ScrollingLesson lesson;

  setUp(() => lesson = _ScrollingLesson());

  Future<void> open(WidgetTester tester, {String language = 'en'}) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          materialsRepositoryProvider.overrideWithValue(const NoMaterialsRepository()),
          activityViewFactoryProvider.overrideWithValue(lesson),
        ],
        child: MaterialApp(
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
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
                    builder: (_) => MaterialPlayerScreen(
                      title: 'Lesson',
                      load: (_) async => const OpenedMaterial(
                        kind: 'activity',
                        mode: 'link',
                        url: 'https://lessons.example/naba',
                        presentation: MaterialPresentation.frameSite,
                      ),
                    ),
                  )),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.byType(MaterialPlayerScreen), findsOneWidget);
    expect(find.byKey(_ScrollingLesson.key), findsOneWidget);
  }

  double width(WidgetTester tester) => tester.view.physicalSize.width / tester.view.devicePixelRatio;

  /// A thumb from [x], [steps] moves of [step] each toward the trailing side.
  Future<void> drag(WidgetTester tester, {required double x, required bool rtl, int steps = 12, double? step}) async {
    final by = (rtl ? -1 : 1) * (step ?? width(tester) / 20);
    final gesture = await tester.startGesture(Offset(x, 400));
    for (var i = 0; i < steps; i++) {
      await gesture.moveBy(Offset(by, 0));
      await tester.pump(const Duration(milliseconds: 16));
    }
    await gesture.up();
    await tester.pumpAndSettle();
  }

  double leadingEdge(WidgetTester tester, {required bool rtl}) => rtl ? width(tester) - 4 : 4;

  for (final platform in [TargetPlatform.android, TargetPlatform.iOS]) {
    final variant = TargetPlatformVariant.only(platform);
    for (final (language, rtl) in [('en', false), ('ar', true)]) {
      testWidgets('[$language] a swipe from the leading edge leaves the lesson, which never feels it',
          (tester) async {
        await open(tester, language: language);

        await drag(tester, x: leadingEdge(tester, rtl: rtl), rtl: rtl);

        expect(find.byType(MaterialPlayerScreen), findsNothing);
        expect(find.text('open'), findsOneWidget);
        expect(lesson.drags, 0, reason: 'the edge belongs to the swipe-back, not to the page');
      }, variant: variant);
    }

    testWidgets('a sideways scroll in the middle of the lesson stays the lesson\'s', (tester) async {
      await open(tester);

      await drag(tester, x: width(tester) / 2, rtl: false, steps: 6);

      expect(find.byType(MaterialPlayerScreen), findsOneWidget);
      expect(lesson.drags, 1);
    }, variant: variant);
  }

  testWidgets('Android: a short, slow touch at the edge does not leave', (tester) async {
    await open(tester);

    // A few points, slowly: a thumb resting near the edge, not a swipe.
    final gesture = await tester.startGesture(const Offset(4, 400));
    for (var i = 0; i < 6; i++) {
      await gesture.moveBy(const Offset(6, 0));
      await tester.pump(const Duration(milliseconds: 100));
    }
    await gesture.up();
    await tester.pumpAndSettle();

    expect(find.byType(MaterialPlayerScreen), findsOneWidget);
  }, variant: TargetPlatformVariant.only(TargetPlatform.android));

  testWidgets('Android: a swipe from the TRAILING edge in Arabic (the left) does not leave', (tester) async {
    await open(tester, language: 'ar');

    await drag(tester, x: 4, rtl: false);

    expect(find.byType(MaterialPlayerScreen), findsOneWidget);
  }, variant: TargetPlatformVariant.only(TargetPlatform.android));

  test('the strip is as wide as the Cupertino edge', () {
    expect(EdgeSwipeBack.edgeWidth, 20);
  });
}

/// A lesson page that scrolls sideways: it claims any horizontal drag that reaches it.
class _ScrollingLesson implements ActivityViewFactory {
  static const key = ValueKey('scrolling-lesson');
  int drags = 0;

  @override
  Widget build(BuildContext context,
          {required String url, required String sandbox, required bool Function(Uri uri) allow, Future<Map<String, Object?>?>? audio}) =>
      GestureDetector(
        key: key,
        behavior: HitTestBehavior.opaque,
        onHorizontalDragEnd: (_) => drags++,
        child: const SizedBox.expand(),
      );
}
