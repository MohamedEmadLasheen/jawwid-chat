import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/shared/utils/text_direction.dart';

/// The app's language and its content's language are independent, and the UI has to
/// survive every combination of the two.
void main() {
  group('direction is taken from the content, not from the UI', () {
    test('an Arabic name lays out right-to-left', () {
      expect(TextDirectionOf.forContent('أحمد'), TextDirection.rtl);
      expect(TextDirectionOf.forContent('جَوِّد'), TextDirection.rtl);
      // The case that gave it away on screen: a trailing full stop landing on the wrong
      // side of an Arabic sentence rendered in an English UI.
      expect(
        TextDirectionOf.forContent('تم تأكيد موعد الحصة القادمة.'),
        TextDirection.rtl,
      );
    });

    test('an English name lays out left-to-right', () {
      expect(TextDirectionOf.forContent('Jawwid Academy'), TextDirection.ltr);
      expect(TextDirectionOf.forContent('See you tomorrow.'), TextDirection.ltr);
    });

    test('a mixed string follows its first strong character', () {
      expect(TextDirectionOf.forContent('أحمد · Jawwid'), TextDirection.rtl);
      expect(TextDirectionOf.forContent('Jawwid · أحمد'), TextDirection.ltr);
    });
  });

  group('strings with no direction of their own inherit', () {
    test('digits alone do not decide a direction', () {
      // A timestamp or a group number must follow the row, not flip it.
      expect(TextDirectionOf.forContent('2026'), isNull);
      expect(TextDirectionOf.forContent('١٢:٤٥'), isNull);
    });

    test('punctuation and emoji alone do not decide a direction', () {
      expect(TextDirectionOf.forContent('…'), isNull);
      expect(TextDirectionOf.forContent('👍'), isNull);
      expect(TextDirectionOf.forContent(''), isNull);
    });
  });

  group('ContentText', () {
    Future<void> pump(WidgetTester tester, TextDirection ui, String text) =>
        tester.pumpWidget(
          Directionality(
            textDirection: ui,
            child: Center(child: ContentText(text)),
          ),
        );

    testWidgets('Arabic content in an English UI is laid out RTL', (tester) async {
      await pump(tester, TextDirection.ltr, 'تم تأكيد موعد الحصة القادمة.');

      final widget = tester.widget<Text>(find.byType(Text));
      expect(widget.textDirection, TextDirection.rtl);
      // Aligned to the row's leading edge — "end" within an RTL paragraph is the left.
      expect(widget.textAlign, TextAlign.end);
    });

    testWidgets('English content in an Arabic UI is laid out LTR', (tester) async {
      await pump(tester, TextDirection.rtl, 'See you tomorrow.');

      final widget = tester.widget<Text>(find.byType(Text));
      expect(widget.textDirection, TextDirection.ltr);
      expect(widget.textAlign, TextAlign.end);
    });

    testWidgets('content matching the UI is simply start-aligned', (tester) async {
      await pump(tester, TextDirection.rtl, 'أحمد');

      final widget = tester.widget<Text>(find.byType(Text));
      expect(widget.textDirection, TextDirection.rtl);
      expect(widget.textAlign, TextAlign.start);
    });

    testWidgets('a directionless string inherits the UI direction', (tester) async {
      await pump(tester, TextDirection.rtl, '2026');

      final widget = tester.widget<Text>(find.byType(Text));
      expect(widget.textDirection, isNull);
      expect(widget.textAlign, isNull);
    });
  });
}
