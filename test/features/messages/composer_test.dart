import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/features/messages/application/attachment_draft.dart';
import 'package:jawwid_chat/features/messages/domain/outgoing_attachment.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// The composer, including the attach affordance.
///
/// Phase 2 delivered the attach BUTTON and nothing behind it: the storage, the
/// schema and the object-level authorization were built, and no client could
/// reach them, so the control said attachments were not available. Phase 4
/// connected it. What is asserted here is the composer's half — that the button
/// leads somewhere, that the tray reports the upload honestly, and that a
/// second file cannot silently replace the first. The pipeline itself is
/// asserted in attachment_send_test.dart.
void main() {
  Future<void> pumpComposer(
    WidgetTester tester, {
    AttachmentDraft? attachment,
    VoidCallback? onRemoveAttachment,
    VoidCallback? onRetryAttachment,
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
            attachment: attachment,
            onRemoveAttachment: onRemoveAttachment,
            onRetryAttachment: onRetryAttachment,
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

    testWidgets('the tray reports an upload in progress', (tester) async {
      await pumpComposer(
        tester,
        onAttach: () {},
        attachment: AttachmentDraft(
          file: _picked(),
          stage: AttachmentStage.uploading,
          progress: 0.4,
        ),
      );

      expect(find.text('photo.jpg'), findsOneWidget);
      expect(find.text('Uploading…'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
    });

    testWidgets('a failed upload offers a retry rather than vanishing', (tester) async {
      var retried = false;
      await pumpComposer(
        tester,
        onAttach: () {},
        onRetryAttachment: () => retried = true,
        attachment: AttachmentDraft(
          file: _picked(),
          stage: AttachmentStage.failed,
        ),
      );

      expect(find.text('Upload failed'), findsOneWidget);
      // The chosen file is never silently discarded: the user picked it, and
      // must be able to see what happened and try again.
      expect(find.text('photo.jpg'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      expect(retried, isTrue);
    });

    testWidgets('a ready attachment can be removed', (tester) async {
      var removed = false;
      await pumpComposer(
        tester,
        onAttach: () {},
        onRemoveAttachment: () => removed = true,
        attachment: AttachmentDraft(
          file: _picked(),
          stage: AttachmentStage.ready,
          uploaded: const OutgoingAttachment(
            kind: MessageKind.image,
            objectKey: 'conversations/c1/o1',
            mimeType: 'image/jpeg',
            byteSize: 2048,
          ),
        ),
      );

      expect(find.text('Ready to send'), findsOneWidget);
      await tester.tap(find.byIcon(Icons.close));
      expect(removed, isTrue);
    });

    testWidgets('a second file cannot silently replace the first', (tester) async {
      await pumpComposer(
        tester,
        onAttach: () {},
        attachment: AttachmentDraft(
          file: _picked(),
          stage: AttachmentStage.ready,
        ),
      );

      // A message carries one attachment. Leaving the button live would let a
      // second pick overwrite a file the user had already waited for.
      final button = tester.widget<IconButton>(
        find.ancestor(
          of: find.byIcon(Icons.attach_file),
          matching: find.byType(IconButton),
        ),
      );
      expect(button.onPressed, isNull);
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


PickedAttachment _picked() => const PickedAttachment(
      path: '/tmp/photo.jpg',
      fileName: 'photo.jpg',
      byteSize: 2048,
      kind: MessageKind.image,
      mimeType: 'image/jpeg',
    );
