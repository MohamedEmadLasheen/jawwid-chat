import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Structural guards over the source tree.
///
/// `cross-platform.md` §4 asks for a lint on physical `left`/`right` layout rather than a QA
/// pass, and the handoff repeats it. The analyzer has no such rule, so it lives here: a test
/// is cheaper than a custom analyzer plugin and fails just as loudly in CI.
void main() {
  final libDir = Directory('lib');

  List<File> dartFiles() => libDir
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      // Generated localisations are not hand-written and are not ours to style.
      .where((f) => !f.path.contains('app_localizations'))
      .toList();

  /// Report every offending line as `path:line` so a failure points at the fix.
  List<String> offenders(RegExp pattern, {bool Function(String path)? skip}) {
    final found = <String>[];

    for (final file in dartFiles()) {
      if (skip != null && skip(file.path)) continue;

      final lines = file.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        if (pattern.hasMatch(lines[i])) {
          found.add('${file.path}:${i + 1}  ${lines[i].trim()}');
        }
      }
    }
    return found;
  }

  group('RTL: physical edges must not appear in layout', () {
    test('no EdgeInsets.only with left or right', () {
      final hits = offenders(RegExp(r'EdgeInsets\.only\([^)]*\b(left|right)\s*:'));
      expect(
        hits,
        isEmpty,
        reason: 'Use EdgeInsetsDirectional.only(start:/end:) so padding mirrors in '
            'Arabic.\n${hits.join('\n')}',
      );
    });

    test('no EdgeInsets.fromLTRB', () {
      final hits = offenders(RegExp(r'EdgeInsets\.fromLTRB\('));
      expect(
        hits,
        isEmpty,
        reason: 'fromLTRB is physical and does not mirror. Use '
            'EdgeInsetsDirectional.fromSTEB.\n${hits.join('\n')}',
      );
    });

    test('no Alignment.centerLeft / centerRight in layout', () {
      final hits = offenders(
        RegExp(r'\bAlignment\.(centerLeft|centerRight|topLeft|topRight|'
            r'bottomLeft|bottomRight)\b'),
      );
      expect(
        hits,
        isEmpty,
        reason: 'Use AlignmentDirectional so alignment mirrors.\n${hits.join('\n')}',
      );
    });

    test('no Positioned with left or right', () {
      final hits = offenders(RegExp(r'\bPositioned\((?![^)]*Directional)[^)]*'
          r'\b(left|right)\s*:'));
      expect(
        hits,
        isEmpty,
        reason: 'Use PositionedDirectional.\n${hits.join('\n')}',
      );
    });

    test('no BorderRadius.only with physical corners', () {
      final hits = offenders(
        RegExp(r'BorderRadius\.only\([^)]*\b(topLeft|topRight|bottomLeft|bottomRight)\s*:'),
      );
      expect(
        hits,
        isEmpty,
        reason: 'Use BorderRadiusDirectional so corners mirror.\n${hits.join('\n')}',
      );
    });
  });

  group('design system: raw values live in tokens.dart only', () {
    bool isTokenFile(String path) =>
        path.endsWith('design/tokens.dart') || path.endsWith('design/typography.dart');

    test('no Color(0x…) outside the token file', () {
      final hits = offenders(RegExp(r'Color\(0x'), skip: isTokenFile);
      expect(
        hits,
        isEmpty,
        reason: 'Colours belong in lib/design/tokens.dart so brand sign-off changes one '
            'file (handoff §4).\n${hits.join('\n')}',
      );
    });

    test('no Colors.* constants outside the token file', () {
      // Colors.transparent is a structural value, not a brand colour.
      final hits = offenders(
        RegExp(r'\bColors\.(?!transparent\b)[a-z]'),
        skip: isTokenFile,
      );
      expect(hits, isEmpty, reason: hits.join('\n'));
    });
  });

  group('privacy: the client cannot render what it never models', () {
    test('no phone-number field or accessor anywhere in lib/', () {
      // §5 / BR-1: phone numbers must never reach a parent or teacher surface. The models
      // deliberately have no such field, and this keeps it that way.
      //
      // The redacting logger is exempt: it names these keys in order to *strip* them, which
      // is the mechanism that prevents the leak rather than an instance of one.
      final hits = offenders(
        RegExp(r'\b(phoneNumber|phone_number|msisdn|mobileNumber)\b'),
        skip: (path) => path.endsWith('logging/redacting_logger.dart'),
      );
      expect(
        hits,
        isEmpty,
        reason: 'The mobile client must not model a phone number at all.\n'
            '${hits.join('\n')}',
      );
    });

    test('no attention, workload, or case-status rendering on a family surface', () {
      // Handoff rules 1 and 2: these are admin concepts and must not appear here.
      final hits = offenders(
        RegExp(r'\b(attentionScore|attentionBucket|workloadLevel|ownerLocked|'
            r'owner_locked|onDutyLabel|responseTarget|escalationLevel)\b'),
      );
      expect(hits, isEmpty, reason: hits.join('\n'));
    });
  });
}
