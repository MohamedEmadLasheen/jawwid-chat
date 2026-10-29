import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/shared/utils/search_text.dart';

/// Search has to work for the way this audience actually types.
///
/// Every case below is a real way an Egyptian parent's keyboard and a stored name can
/// disagree while meaning the same thing. A `toLowerCase().contains()` search fails most
/// of them, which is what makes search feel broken in Arabic apps.
void main() {
  group('Arabic folding', () {
    test('hamza on the alef is optional', () {
      // Typed without the hamza, stored with it. The single most common miss.
      expect(SearchText.matches('أحمد', 'احمد'), isTrue);
      expect(SearchText.matches('احمد', 'أحمد'), isTrue);
      expect(SearchText.matches('إسلام', 'اسلام'), isTrue);
      expect(SearchText.matches('آمنة', 'امنه'), isTrue);
    });

    test('tashkeel on the stored name does not have to be typed', () {
      // The academy's own name carries full tashkeel in the fixtures.
      expect(SearchText.matches('جَوِّد', 'جود'), isTrue);
      expect(SearchText.matches('مُحَمَّد', 'محمد'), isTrue);
    });

    test('taa marbuta and haa are interchangeable', () {
      expect(SearchText.matches('فاطمة', 'فاطمه'), isTrue);
      expect(SearchText.matches('خديجه', 'خديجة'), isTrue);
    });

    test('alef maqsura and yaa are interchangeable', () {
      expect(SearchText.matches('مصطفى', 'مصطفي'), isTrue);
      expect(SearchText.matches('يحيي', 'يحيى'), isTrue);
    });

    test('tatweel is decorative and ignored', () {
      expect(SearchText.matches('محــمد', 'محمد'), isTrue);
    });

    test('Arabic-Indic digits match ASCII digits', () {
      expect(SearchText.matches('مجموعة ٣', 'مجموعة 3'), isTrue);
      expect(SearchText.matches('Group 3', '٣'), isTrue);
    });

    test('folding does not make different names collide', () {
      expect(SearchText.matches('أحمد', 'محمد'), isFalse);
      expect(SearchText.matches('حسن', 'حسين'), isFalse);
    });
  });

  group('Latin and mixed', () {
    test('case is ignored', () {
      expect(SearchText.matches('Ahmed Hassan', 'ahmed'), isTrue);
      expect(SearchText.matches('ahmed hassan', 'AHMED'), isTrue);
    });

    test('a mixed Arabic/Latin title is searchable from either script', () {
      const title = 'أحمد · Jawwid Academy';
      expect(SearchText.matches(title, 'احمد'), isTrue);
      expect(SearchText.matches(title, 'jawwid'), isTrue);
      expect(SearchText.matches(title, 'academy'), isTrue);
    });

    test('matching is substring, not prefix', () {
      // Group titles are composed, so the child's name is often mid-string.
      expect(SearchText.matches('أحمد · جَوِّد', 'جود'), isTrue);
      expect(SearchText.matches('Ahmed · Jawwid', 'Jaw'), isTrue);
    });
  });

  group('whitespace and empty input', () {
    test('an empty or blank query matches everything', () {
      expect(SearchText.matches('anything', ''), isTrue);
      expect(SearchText.matches('anything', '   '), isTrue);
    });

    test('runs of whitespace collapse on both sides', () {
      expect(SearchText.matches('أحمد   ·   جود', 'أحمد · جود'), isTrue);
      expect(SearchText.matches(' Ahmed  Hassan ', 'ahmed hassan'), isTrue);
    });
  });

  group('matchesAllWords (pickers)', () {
    test('every word, anywhere, in any order', () {
      expect(SearchText.matchesAllWords('ali fam', ['Ali family']), isTrue);
      expect(SearchText.matchesAllWords('fam ali', ['Ali family']), isTrue);
      expect(SearchText.matchesAllWords('ali bakr', ['Ali family']), isFalse);
    });

    test('a secondary text counts, and a missing one is ignored', () {
      expect(SearchText.matchesAllWords('owner@', ['Organization Owner', 'owner@example.test']), isTrue);
      expect(SearchText.matchesAllWords('owner', ['Organization Owner', null]), isTrue);
    });

    test('folds Arabic both ways: hamza, ى/ي, ة/ه, harakat, dagger alef', () {
      expect(SearchText.matchesAllWords('احمد', ['عائلة أحمد']), isTrue);
      expect(SearchText.matchesAllWords('مصطفي', ['عائلة مصطفى']), isTrue);
      expect(SearchText.matchesAllWords('فاطمه', ['فاطمة']), isTrue);
      expect(SearchText.matchesAllWords('محمد', ['مُحَمَّد']), isTrue);
      // U+0670, the superscript alef, as in الرحمٰن.
      expect(SearchText.matchesAllWords('الرحمن', ['عبد ${String.fromCharCodes([0x627, 0x644, 0x631, 0x62d, 0x645, 0x670, 0x646])}']), isTrue);
    });

    test('an empty query matches everything', () {
      expect(SearchText.matchesAllWords('   ', ['anything']), isTrue);
    });
  });
}
