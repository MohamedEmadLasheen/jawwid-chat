import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/core/data/wire/wire_vocab.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/core/network/error_mapper.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/application/messages_controller.dart';
import 'package:jawwid_chat/features/messages/presentation/message_bubble.dart';
import 'package:jawwid_chat/features/messages/presentation/message_composer.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// LD-12 / MG-3 (Apple 1.2): the server refuses a text holding a word on its
/// list with COMM.CONTENT_NOT_ALLOWED. The app says so plainly and the person's
/// words stay in the box to change -- never sent again as they are.
void main() {
  Widget app(Widget child, {Locale locale = const Locale('en')}) => ProviderScope(
        child: MaterialApp(
          locale: locale,
          theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
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

  const notice = 'This message has words that are not allowed here. Please change them and send it again.';

  group('the error', () {
    test('is the server\'s code, a validation failure, and never retried', () {
      expect(WireErrors.contentNotAllowed, 'COMM.CONTENT_NOT_ALLOWED');
      final error = ErrorMapper.map(DioException(
        requestOptions: RequestOptions(path: '/conversations/c1/messages'),
        type: DioExceptionType.badResponse,
        response: Response<Object?>(
          requestOptions: RequestOptions(path: '/conversations/c1/messages'),
          statusCode: 400,
          data: {
            'error': {'code': 'COMM.CONTENT_NOT_ALLOWED', 'message': 'not allowed'},
          },
        ),
      ));
      expect(error.code, WireErrors.contentNotAllowed);
      expect(error.kind, AppErrorKind.validation);
      expect(error.isTransient, isFalse);
      expect(WireErrors.terminal, contains(WireErrors.contentNotAllowed));
    });
  });

  group('the composer', () {
    testWidgets('puts the refused words back in the box and says why', (tester) async {
      final sent = <String>[];
      await tester.pumpWidget(app(MessageComposer(onSend: sent.add)));
      await tester.enterText(find.byType(TextField), 'some words');
      await tester.pump();
      await tester.tap(find.byIcon(Icons.send));
      await tester.pump();
      expect(sent, ['some words']);
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);

      await tester.pumpWidget(app(MessageComposer(
        onSend: sent.add,
        contentRefusal: const ContentRefusal(1, 'some words'),
      )));
      await tester.pump();

      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, 'some words');
      expect(find.text(notice), findsOneWidget);

      // Changing the words takes the notice away.
      await tester.enterText(find.byType(TextField), 'other words');
      await tester.pump();
      expect(find.text(notice), findsNothing);
    });

    testWidgets('never overwrites what the person has typed since', (tester) async {
      await tester.pumpWidget(app(MessageComposer(onSend: (_) {})));
      await tester.enterText(find.byType(TextField), 'a new message');
      await tester.pumpWidget(app(MessageComposer(
        onSend: (_) {},
        contentRefusal: const ContentRefusal(1, 'the refused one'),
      )));
      await tester.pump();
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, 'a new message');
      expect(find.text(notice), findsOneWidget);
    });

    testWidgets('in Arabic', (tester) async {
      await tester.pumpWidget(app(
        MessageComposer(onSend: (_) {}, contentRefusal: const ContentRefusal(1, 'نص')),
        locale: const Locale('ar'),
      ));
      await tester.pump();
      expect(find.text('في هذه الرسالة كلمات غير مسموح بها هنا. عدّلها ثم أرسلها مرة أخرى.'), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, 'نص');
    });
  });

  group('a refused caption', () {
    Message photo() => Message(
          clientMessageId: 'c-1',
          conversationId: 'c1',
          kind: MessageKind.image,
          body: 'a caption',
          createdAt: DateTime.utc(2026, 11, 7, 9),
          deliveryState: DeliveryState.failed,
          failureCode: WireErrors.contentNotAllowed,
          isMine: true,
        );

    testWidgets('says why it was not sent and offers Discard, not Retry', (tester) async {
      await tester.pumpWidget(app(MessageBubble(
        message: photo(),
        showAuthor: false,
        onRetry: () {},
        onDiscard: () {},
      )));
      await tester.pump();
      expect(find.text('Not sent: the caption has words that are not allowed'), findsOneWidget);
      expect(find.text('Retry'), findsNothing);
      expect(find.text('Discard'), findsOneWidget);
    });

    testWidgets('in Arabic', (tester) async {
      await tester.pumpWidget(app(
        MessageBubble(message: photo(), showAuthor: false, onRetry: () {}, onDiscard: () {}),
        locale: const Locale('ar'),
      ));
      await tester.pump();
      expect(find.text('لم تُرسَل: في التعليق كلمات غير مسموح بها'), findsOneWidget);
    });
  });
}
