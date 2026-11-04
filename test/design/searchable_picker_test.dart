import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/design/widgets/searchable_picker.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/utils/text_direction.dart';

/// Owner 2026-10-29: every list can be typed into as well as chosen from. One
/// picker serves every list in the app, so these pin its contract.
void main() {
  const families = ['Abdelrahman family', 'Ali family', 'Amer family', 'Ashour family', 'Bakr family'];
  final options = [
    for (var i = 0; i < families.length; i++)
      PickerOption(value: 'f$i', label: families[i], enabled: families[i] != 'Amer family'),
    const PickerOption(value: 'a', label: 'عائلة أحمد', hint: 'ahmad@example.test'),
  ];

  Widget app({String? value, ValueChanged<String>? onChanged, Locale locale = const Locale('en')}) => MaterialApp(
        locale: locale,
        theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: Scaffold(
          body: Padding(
            padding: const EdgeInsets.all(16),
            child: SearchablePickerField<String>(
              key: const ValueKey('family'),
              label: 'Family',
              value: value,
              options: options,
              onChanged: onChanged,
            ),
          ),
        ),
      );

  void phone(WidgetTester tester) {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
  }

  Iterable<String> shown(WidgetTester tester) =>
      tester.widgetList<ListTile>(find.byType(ListTile)).map((t) => (t.title! as ContentText).data);

  testWidgets('shows the chosen label, and on a phone opens a bottom sheet with a search field', (tester) async {
    phone(tester);
    await tester.pumpWidget(app(value: 'f1', onChanged: (_) {}));
    expect(find.text('Ali family'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('family')));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsOneWidget);
    expect(find.byKey(const ValueKey('picker-search')), findsOneWidget);
    expect(find.text('Type to search'), findsOneWidget);
    expect(shown(tester), [...families, 'عائلة أحمد']);
    // The chosen one is marked.
    final ali = tester.widget<ListTile>(find.widgetWithText(ListTile, 'Ali family'));
    expect(ali.selected, isTrue);
    expect(ali.trailing, isA<Icon>());
  });

  testWidgets('typing filters by every word; tapping picks and closes', (tester) async {
    phone(tester);
    String? picked;
    await tester.pumpWidget(app(onChanged: (v) => picked = v));
    await tester.tap(find.byKey(const ValueKey('family')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('picker-search')), 'fam ash');
    await tester.pumpAndSettle();
    expect(shown(tester), ['Ashour family']);
    await tester.tap(find.text('Ashour family'));
    await tester.pumpAndSettle();
    expect(picked, 'f3');
    expect(find.byType(BottomSheet), findsNothing);
  });

  testWidgets('a bare alef finds the hamza spelling, and the hint is searched too', (tester) async {
    phone(tester);
    await tester.pumpWidget(app(onChanged: (_) {}));
    await tester.tap(find.byKey(const ValueKey('family')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('picker-search')), 'احمد');
    await tester.pumpAndSettle();
    expect(shown(tester), ['عائلة أحمد']);
    await tester.enterText(find.byKey(const ValueKey('picker-search')), 'example.test');
    await tester.pumpAndSettle();
    expect(shown(tester), ['عائلة أحمد']);
  });

  testWidgets('says so when nothing matches, and the clear button brings the list back', (tester) async {
    phone(tester);
    await tester.pumpWidget(app(onChanged: (_) {}));
    await tester.tap(find.byKey(const ValueKey('family')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('picker-search')), 'zzz');
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('picker-no-matches')), findsOneWidget);
    expect(find.text('No matches'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('picker-search-clear')));
    await tester.pumpAndSettle();
    expect(shown(tester), hasLength(families.length + 1));
  });

  testWidgets('Enter picks the first enabled match; a disabled option cannot be picked', (tester) async {
    phone(tester);
    String? picked;
    await tester.pumpWidget(app(onChanged: (v) => picked = v));
    await tester.tap(find.byKey(const ValueKey('family')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Amer family'));
    await tester.pumpAndSettle();
    expect(picked, isNull);
    expect(find.byType(BottomSheet), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('picker-search')), 'amer');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(picked, isNull, reason: 'the only match is disabled');
    await tester.enterText(find.byKey(const ValueKey('picker-search')), 'a');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(picked, 'f0');
  });

  testWidgets('in Arabic the sheet is right to left and speaks Arabic', (tester) async {
    phone(tester);
    await tester.pumpWidget(app(onChanged: (_) {}, locale: const Locale('ar')));
    await tester.tap(find.byKey(const ValueKey('family')));
    await tester.pumpAndSettle();
    expect(Directionality.of(tester.element(find.byKey(const ValueKey('picker-search')))), TextDirection.rtl);
    expect(find.text('اكتب للبحث'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('picker-search')), 'zzz');
    await tester.pumpAndSettle();
    expect(find.text('لا توجد نتائج مطابقة'), findsOneWidget);
  });

  testWidgets('on a wide screen (the teacher web portal) it is a dialog', (tester) async {
    tester.view.physicalSize = const Size(1280, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(app(onChanged: (_) {}));
    await tester.tap(find.byKey(const ValueKey('family')));
    await tester.pumpAndSettle();
    expect(find.byType(Dialog), findsOneWidget);
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.byKey(const ValueKey('picker-search')), findsOneWidget);
  });

  testWidgets('a field without onChanged does not open', (tester) async {
    phone(tester);
    await tester.pumpWidget(app(value: 'f1'));
    await tester.tap(find.byKey(const ValueKey('family')));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsNothing);
  });
}
