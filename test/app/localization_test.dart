import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

void main() {
  group('locale resolution', () {
    test('an Arabic device gets Arabic', () {
      expect(
        JawwidApp.resolveLocale(const Locale('ar', 'EG'), JawwidApp.supportedLocales),
        const Locale('ar'),
      );
    });

    test('an English device gets English', () {
      expect(
        JawwidApp.resolveLocale(const Locale('en', 'US'), JawwidApp.supportedLocales),
        const Locale('en'),
      );
    });

    test('an unsupported language falls back to Arabic, not English', () {
      expect(
        JawwidApp.resolveLocale(const Locale('fr'), JawwidApp.supportedLocales),
        const Locale('ar'),
      );
    });

    test('a null device locale falls back to Arabic', () {
      expect(
        JawwidApp.resolveLocale(null, JawwidApp.supportedLocales),
        const Locale('ar'),
      );
    });

    test('Arabic is listed first, making it the product default', () {
      expect(JawwidApp.supportedLocales.first, const Locale('ar'));
    });
  });

  group('RTL layout', () {
    Widget harness(Locale locale, Widget child) => MaterialApp(
          locale: locale,
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: child,
        );

    testWidgets('Arabic renders right-to-left', (tester) async {
      await tester.pumpWidget(
        harness(const Locale('ar'), Builder(builder: (context) {
          return Text(Directionality.of(context).name);
        })),
      );
      await tester.pumpAndSettle();

      expect(find.text('rtl'), findsOneWidget);
    });

    testWidgets('English renders left-to-right', (tester) async {
      await tester.pumpWidget(
        harness(const Locale('en'), Builder(builder: (context) {
          return Text(Directionality.of(context).name);
        })),
      );
      await tester.pumpAndSettle();

      expect(find.text('ltr'), findsOneWidget);
    });

    testWidgets('Arabic strings are actually Arabic, not English fallbacks', (tester) async {
      await tester.pumpWidget(
        harness(const Locale('ar'), Builder(builder: (context) {
          final l10n = L10n.of(context);
          return Column(
            children: [
              Text(l10n.signInAction),
              Text(l10n.messageStatePendingApproval),
              Text(l10n.tabChats),
            ],
          );
        })),
      );
      await tester.pumpAndSettle();

      expect(find.text('تسجيل الدخول'), findsOneWidget);
      expect(find.text('في انتظار المراجعة'), findsOneWidget);
      expect(find.text('المحادثات'), findsOneWidget);
    });

    testWidgets('long Arabic names wrap instead of overflowing', (tester) async {
      const longName = 'عبد الرحمن بن عبد العزيز بن محمد الشريف الحسيني';

      await tester.pumpWidget(
        harness(
          const Locale('ar'),
          const Scaffold(
            body: SizedBox(
              width: 180,
              child: Text(longName, maxLines: 2, overflow: TextOverflow.ellipsis),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });

    testWidgets('mixed Arabic and English text renders without exception', (tester) async {
      await tester.pumpWidget(
        harness(
          const Locale('ar'),
          const Scaffold(
            body: Text('الحصة القادمة يوم Monday الساعة 5 PM'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    });
  });
}
