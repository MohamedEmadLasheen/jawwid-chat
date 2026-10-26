import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

/// ARABIC COUNTS AGREE WITH THEIR NOUNS.
///
/// `docs/design/terminology.md`: *"Arabic plurals have six forms. Any string
/// containing a count must go through ICU plural selection, never
/// `n + " " + noun`."* `unreadCount` honoured that from the start; the typing
/// indicator did not have a count at all, and the version that did was a
/// single fixed plural that reads "2 persons" where Arabic wants the dual, and
/// "11 persons" where Arabic wants a singular accusative.
///
/// These tests assert the rendered sentence at every boundary the CLDR rules
/// for Arabic actually distinguish, and then assert structurally that no other
/// counted string can quietly introduce the same defect.
void main() {
  late L10n ar;
  late L10n en;

  setUp(() async {
    ar = await L10n.delegate.load(const Locale('ar'));
    en = await L10n.delegate.load(const Locale('en'));
  });

  group('typing indicator', () {
    /// zero / one are not what a "many" indicator is for — a single typist
    /// reads `typingSingle` — but ICU selection must still be correct for
    /// them, because a form that is wrong is wrong the day a caller changes.
    test('Arabic agrees at every plural boundary', () {
      expect(ar.typingMany(0), 'لا أحد يكتب الآن…');
      expect(ar.typingMany(1), 'شخص واحد يكتب الآن…');
      // The dual is a distinct form, not a plural: شخصان, and the verb duals too.
      expect(ar.typingMany(2), 'شخصان يكتبان الآن…');
      // 3–10 take the plural noun.
      expect(ar.typingMany(3), '3 أشخاص يكتبون الآن…');
      expect(ar.typingMany(10), '10 أشخاص يكتبون الآن…');
      // 11–99 take a singular accusative tamyīz.
      expect(ar.typingMany(11), '11 شخصًا يكتبون الآن…');
      // 100 takes a singular genitive.
      expect(ar.typingMany(100), '100 شخص يكتبون الآن…');
    });

    test('English stays natural at the same boundaries', () {
      expect(en.typingMany(1), '1 person is typing…');
      expect(en.typingMany(2), '2 people are typing…');
      expect(en.typingMany(3), '3 people are typing…');
      expect(en.typingMany(11), '11 people are typing…');
      expect(en.typingMany(100), '100 people are typing…');
    });

    /// The defect this replaces was ONE fixed noun for every count. If a future
    /// edit collapsed the forms again, 2 / 3 / 11 would start agreeing with
    /// each other — so assert that they do not.
    test('does not collapse back to a single fixed Arabic noun', () {
      final forms = {ar.typingMany(2), ar.typingMany(3), ar.typingMany(11)};
      expect(forms.length, 3, reason: 'dual, few and many must differ: $forms');
      expect(ar.typingMany(2), isNot(contains('أشخاص')));
    });

    test('Western digits, per DD-09', () {
      final arabicIndic = RegExp(r'[٠-٩]');
      for (final n in [0, 1, 2, 3, 11, 100]) {
        expect(arabicIndic.hasMatch(ar.typingMany(n)), isFalse);
      }
    });
  });

  group('every counted Arabic string goes through ICU', () {
    /// Keys whose numeric placeholder is NOT a counted noun, so plural
    /// selection would be meaningless. Each needs a reason to be here.
    const notCounted = <String, String>{
      // «{minutes} د {seconds} ث» — abbreviated unit symbols. An abbreviation
      // does not inflect, which is exactly why a duration is written this way.
      'callDuration': 'abbreviated unit symbols, which do not inflect',
      // «(+{added} / −{removed})» — signed deltas beside no noun; the same
      // wording as the Admin Web chat (`features/chat/copy.ts`).
      'systemGroupMembersUpdated': 'signed deltas, not a count beside a noun',
      // «{count} بانتظار التقرير» — the number is the subject; no noun agrees.
      'workloadNeedsReport':
          'the count stands alone; there is no noun to agree',
      // «{index} من {total}» — a position ("3 of 12"), not a count of
      // anything; no noun agrees with either number.
      'searchPosition': 'a position (index of total), not a count',
      // «رسالة مثبّتة {index} من {total}» — the same position, after a noun
      // in the singular that names one item, whatever the numbers are.
      'pinnedBannerOf': 'a position (index of total), not a count',
      // «الخطوة {number} من {total}» — PD-25 recovery: which step of the flow,
      // the same position as searchPosition.
      'recoveryStep': 'a position (step of total), not a count',
      // «إرسال رمز جديد بعد {seconds} ث» — an abbreviated unit symbol, like
      // callDuration; it does not inflect.
      'recoveryResendIn': 'abbreviated unit symbol, which does not inflect',
      // «الحصة {number} من {total}» -- PD-30: which lesson of the subscription,
      // a position like searchPosition; the noun names one lesson whatever N is.
      'reportLessonOf': 'a position (lesson of total), not a count',
      // «{number} من {total}» -- the same position on the report card.
      'cardLessonNumberOf': 'a position (lesson of total), not a count',
    };

    /// Counted strings that predate this guard and still put a number beside a
    /// fixed noun. They are KNOWN DEFECTS, pinned here so the guard can stop
    /// any new one without first fixing every old one. The list may only
    /// shrink: fixing one fails the test below until it is removed from here.
    const knownDebt = <String>{
      'reactionCountSemantics',
      'makeupLength',
      'progressAllTime',
      'workloadHeld',
    };

    Map<String, dynamic> readArb(String path) =>
        jsonDecode(File(path).readAsStringSync()) as Map<String, dynamic>;

    /// Every key whose template metadata declares an int placeholder.
    List<String> countedKeys() {
      final template = readArb('lib/l10n/app_en.arb');
      final keys = <String>[];
      for (final entry in template.entries) {
        if (!entry.key.startsWith('@') || entry.key.startsWith('@@')) continue;
        final meta = entry.value;
        if (meta is! Map) continue;
        final placeholders = meta['placeholders'];
        if (placeholders is! Map) continue;
        final hasInt = placeholders.values.any(
          (p) => p is Map && p['type'] == 'int',
        );
        if (hasInt) keys.add(entry.key.substring(1));
      }
      return keys;
    }

    test('an int placeholder implies a plural block in app_ar.arb', () {
      final arb = readArb('lib/l10n/app_ar.arb');
      final offenders = <String>[];

      for (final key in countedKeys()) {
        if (notCounted.containsKey(key) || knownDebt.contains(key)) continue;
        final arabic = arb[key];
        if (arabic is String && !arabic.contains('plural,')) {
          offenders.add('$key = $arabic');
        }
      }

      expect(
        offenders,
        isEmpty,
        reason:
            'terminology.md — a counted Arabic string must use ICU plural '
            'selection, never a number beside a fixed noun:\n'
            '${offenders.join('\n')}',
      );
    });

    test('the known-debt list only names strings that are still defects', () {
      final arb = readArb('lib/l10n/app_ar.arb');
      final counted = countedKeys().toSet();
      for (final key in knownDebt) {
        expect(
          counted,
          contains(key),
          reason: '$key is no longer counted; remove it',
        );
        expect(
          arb[key] as String,
          isNot(contains('plural,')),
          reason: '$key now uses ICU plurals; remove it from knownDebt',
        );
      }
    });
  });
}
