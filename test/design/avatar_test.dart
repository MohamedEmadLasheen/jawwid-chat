import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/design/widgets/jawwid_avatar.dart';

void main() {
  group('avatar initials', () {
    test('takes the first letter of the first two words', () {
      expect(avatarInitialsOf('Ahmed Hassan'), 'AH');
    });

    test('works for Arabic names', () {
      expect(avatarInitialsOf('أحمد حسن'), 'أح');
    });

    test('handles a single-word name', () {
      expect(avatarInitialsOf('جوّد'), isNotEmpty);
    });

    test('collapses extra whitespace', () {
      expect(avatarInitialsOf('  Ahmed   Hassan  '), 'AH');
    });

    test('falls back for an empty name rather than throwing', () {
      expect(avatarInitialsOf('   '), '؟');
    });

    test('ignores words beyond the first two', () {
      expect(avatarInitialsOf('عبد الرحمن بن عبد العزيز'), 'عا');
    });
  });
}
