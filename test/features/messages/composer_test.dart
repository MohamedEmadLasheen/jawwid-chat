import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// The composer, including the attach affordance.
///
/// Phase 2 delivers the attach BUTTON, not an upload pipeline: the phase map
/// gives this client the realtime client, and the attachment work it names is
/// server-side (real object storage plus object-level authorization on signed
/// reads). So the entry point must exist, be reachable, be honest about what it
/// currently does, and not pretend to upload anything.
void main() {
  Future<void> pumpComposer(
    WidgetTester tester, {
    VoidCallback? onAttach,
    void Function(String)? onSend,
    void Function()? onTyping,
    ReplyPreview? replyingTo,
    VoidCallback? onCancelReply,
    bool isReadOnly = false,
    Locale locale = const Locale('en'),
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        locale: locale,
        localizationsDelegates: const [
          L10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: L10n.supportedLocales,
        home: Scaffold(
          body: MessageComposer(
            onSend: onSend ?? (_) {},
            onTyping: onTyping,
            onAttach: onAttach,
            replyingTo: replyingTo,
            onCancelReply: onCancelReply,
            isReadOnly: isReadOnly,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  group('the attach affordance', () {
    testWidgets('is rendered and reachable when the screen supplies a handler', (tester) async {
      var taps = 0;
      await pumpComposer(tester, onAttach: () => taps++);

      final button = find.byIcon(Icons.attach_file);
      expect(button, findsOneWidget);

      await tester.tap(button);
      await tester.pump();
      expect(taps, 1, reason: 'the entry point must actually be reachable');
    });

    testWidgets('is ENABLED, not a disabled control', (tester) async {
      await pumpComposer(tester, onAttach: () {});

      final iconButton = tester.widget<IconButton>(
        find.ancestor(of: find.byIcon(Icons.attach_file), matching: find.byType(IconButton)),
      );
      // A disabled button reads as "broken" or "you are not allowed", and
      // neither is true: it is a working entry point to a pipeline that is not
      // built yet, and it says so when tapped.
      expect(iconButton.onPressed, isNotNull);
    });

    testWidgets('carries a label and a hint for a screen reader', (tester) async {
      final handle = tester.ensureSemantics();
      await pumpComposer(tester, onAttach: () {});

      // State is never conveyed by a glyph alone: a paperclip means nothing
      // spoken aloud without these.
      expect(
        find.bySemanticsLabel(RegExp('Attach')),
        findsWidgets,
      );

      handle.dispose();
    });

    testWidgets('does not appear when the screen offers no handler', (tester) async {
      await pumpComposer(tester);
      expect(find.byIcon(Icons.attach_file), findsNothing);
    });

    testWidgets('does not appear in a read-only conversation', (tester) async {
      await pumpComposer(tester, onAttach: () {}, isReadOnly: true);

      // Removed from the group, or archived server-side: nothing may be
      // composed here, attachments included.
      expect(find.byIcon(Icons.attach_file), findsNothing);
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('does not break the composer: sending still works beside it', (tester) async {
      final sent = <String>[];
      await pumpComposer(tester, onAttach: () {}, onSend: sent.add);

      await tester.enterText(find.byType(TextField), 'مرحبا');
      await tester.pump();
      await tester.tap(find.byIcon(Icons.send));
      await tester.pump();

      expect(sent, ['مرحبا']);
      expect(find.byIcon(Icons.attach_file), findsOneWidget);
    });
  });

  group('composer behaviour', () {
    testWidgets('refuses to send an empty or whitespace-only message', (tester) async {
      final sent = <String>[];
      await pumpComposer(tester, onSend: sent.add);

      // The send button is not even offered with nothing to send.
      expect(find.byIcon(Icons.send), findsNothing);

      await tester.enterText(find.byType(TextField), '   ');
      await tester.pump();
      expect(find.byIcon(Icons.send), findsNothing);
      expect(sent, isEmpty);
    });

    testWidgets('trims what it sends, and clears the field', (tester) async {
      final sent = <String>[];
      await pumpComposer(tester, onSend: sent.add);

      await tester.enterText(find.byType(TextField), '  hello  ');
      await tester.pump();
      await tester.tap(find.byIcon(Icons.send));
      await tester.pump();

      expect(sent, ['hello']);
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);
    });

    testWidgets('reports typing on every keystroke, for the debouncer downstream', (tester) async {
      var typed = 0;
      await pumpComposer(tester, onTyping: () => typed++);

      await tester.enterText(find.byType(TextField), 'a');
      await tester.pump();
      expect(typed, greaterThan(0));
    });

    testWidgets('shows the reply banner and can cancel out of it', (tester) async {
      var cancelled = 0;
      await pumpComposer(
        tester,
        replyingTo: const ReplyPreview(
          messageId: 'm1',
          authorName: 'أحمد',
          excerpt: 'متى الحصة؟',
        ),
        onCancelReply: () => cancelled++,
      );

      expect(find.text('متى الحصة؟'), findsOneWidget);

      await tester.tap(find.byIcon(Icons.close));
      await tester.pump();
      expect(cancelled, 1);
    });
  });
}
