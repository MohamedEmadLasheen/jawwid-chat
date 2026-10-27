import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// No ARB key is defined twice. JSON lets a later key silently replace an earlier one, and
/// gen-l10n raises no error: #156 added a plain "typingMany" below the plural one, the plain
/// string won, and Arabic lost its plural forms without a warning.
void main() {
  for (final path in ['lib/l10n/app_en.arb', 'lib/l10n/app_ar.arb']) {
    test('$path defines every key once', () {
      // Top-level keys only: each sits at two spaces of indentation in these files.
      final key = RegExp(r'^  "([^"]+)"\s*:');
      final seen = <String, int>{};
      final duplicates = <String>[];
      final lines = File(path).readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final name = key.firstMatch(lines[i])?.group(1);
        if (name == null) continue;
        final first = seen[name];
        if (first != null) duplicates.add('"$name" at lines $first and ${i + 1}');
        seen.putIfAbsent(name, () => i + 1);
      }
      expect(duplicates, isEmpty, reason: duplicates.join('\n'));
    });
  }
}
