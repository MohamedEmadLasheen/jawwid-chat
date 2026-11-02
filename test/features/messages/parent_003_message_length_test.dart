import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

/// PARENT-003: the server refuses a body over 4000 characters
/// (COMM.MESSAGE_TOO_LONG, apps/api message-length.ts). The composer holds the
/// same limit, counted the same way (characters a person sees), so nothing the
/// app lets through is refused: it stops at 4000 and shows the counter near it.
void main() {
  Widget app(Widget child) => ProviderScope(
        child: MaterialApp(
          locale: const Locale('en'),
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: Scaffold(body: child),
        ),
      );

  test('the composer\'s limit is the server\'s: 4000 characters', () {
    expect(MessageComposer(onSend: (_) {}).maxCharacters, 4000);
  });

  testWidgets('a long paste stops at 4000 characters, with the counter showing', (tester) async {
    final sent = <String>[];
    await tester.pumpWidget(app(MessageComposer(onSend: sent.add)));
    await tester.enterText(find.byType(TextField), 'a' * 95000);
    await tester.pump();
    final field = tester.widget<TextField>(find.byType(TextField));
    expect(field.controller!.text.length, 4000);
    expect(find.text('4000/4000'), findsOneWidget);
    await tester.tap(find.byIcon(Icons.send));
    expect(sent.single.length, 4000);
  });

  testWidgets('an emoji counts once, as the server counts it', (tester) async {
    await tester.pumpWidget(app(MessageComposer(onSend: (_) {})));
    await tester.enterText(find.byType(TextField), '❤️' * 4001);
    await tester.pump();
    final text = tester.widget<TextField>(find.byType(TextField)).controller!.text;
    expect(text.characters.length, 4000);
  });

  testWidgets('far from the limit there is no counter', (tester) async {
    await tester.pumpWidget(app(MessageComposer(onSend: (_) {})));
    await tester.enterText(find.byType(TextField), 'hello');
    await tester.pump();
    expect(find.textContaining('/4000'), findsNothing);
  });
}
