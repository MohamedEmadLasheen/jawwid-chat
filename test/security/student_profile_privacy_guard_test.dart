import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// PD-17 (2026-10-21): a teacher may open their own student's profile, and must never
/// see a parent's profile or anything about money.
///
/// Both halves are source scans, in the spirit of the directionality guard: a screen
/// check can be bypassed by the next screen, but a type with no field cannot leak one,
/// and an app that never names an endpoint cannot call it.
void main() {
  final forbiddenField = RegExp(
    r'\b(family|families|parent|birthDate|birth_date|payment|invoice|subscription|instalment|installment|price)\w*\s*[,;=)]',
    caseSensitive: false,
  );

  /// The Admin Web's endpoints: `/parent-profiles/...`, `/instalments...`, `/families/:id/billing`.
  bool namesAdminPath(String line) =>
      line.contains('/parent-profiles') ||
      line.contains('/instalments') ||
      (line.contains('/families/') && line.contains('billing'));

  /// Every Dart file of the Student Profile, its model included.
  List<File> studentProfileSources() => [
        ...Directory('lib/features/student_profile')
            .listSync(recursive: true)
            .whereType<File>()
            .where((f) => f.path.endsWith('.dart')),
        File('lib/shared/models/student_profile.dart'),
      ];

  /// Lines of code (not comments) in [files] that match [pattern].
  List<String> offenders(Iterable<File> files, RegExp pattern) {
    final hits = <String>[];
    for (final file in files) {
      final lines = file.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i].trimLeft();
        // Prose explains *why* these are absent and must stay allowed to say the words.
        if (line.startsWith('//')) continue;
        if (pattern.hasMatch(line)) hits.add('${file.path}:${i + 1}  ${line.trim()}');
      }
    }
    return hits;
  }

  test('the Student Profile exists where these scans look', () {
    expect(Directory('lib/features/student_profile').existsSync(), isTrue);
    expect(File('lib/shared/models/student_profile.dart').existsSync(), isTrue);
    expect(studentProfileSources().length, greaterThan(2));
  });

  test('the Student Profile declares no family, parent, birth-date or money field', () {
    final hits = offenders(studentProfileSources(), forbiddenField);
    expect(
      hits,
      isEmpty,
      reason: 'A teacher must never see a parent or anything about money (PD-17). The '
          'server sends staff more from the same endpoint; this client must not model '
          'it.\n${hits.join('\n')}',
    );
  });

  test('the Student Profile declares no contact field either', () {
    final hits = offenders(
      studentProfileSources(),
      RegExp(r'\b(phone|email|msisdn|mobile|whatsapp|address)\w*\s*[,;=)]', caseSensitive: false),
    );
    expect(hits, isEmpty, reason: hits.join('\n'));
  });

  test('no file under lib/ names a parent-profile or payment endpoint', () {
    // The app has no business with any of them, for any role.
    final files = Directory('lib')
        .listSync(recursive: true)
        .whereType<File>()
        .where((f) => f.path.endsWith('.dart'))
        .toList();
    expect(files, isNotEmpty);

    final hits = <String>[];
    for (final file in files) {
      final lines = file.readAsLinesSync();
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i];
        if (namesAdminPath(line)) hits.add('${file.path}:${i + 1}  ${line.trim()}');
      }
    }
    expect(
      hits,
      isEmpty,
      reason: 'Parent profiles and payments are administration-only (PD-17); the app '
          'must never be able to call them.\n${hits.join('\n')}',
    );
  });

  test('both scans catch what they exist to catch (positive controls)', () {
    for (final probe in [
      r"await _client.get('/families/$id/billing');",
      "await _client.post('/instalments/\$id/payment');",
      "_client.get('/parent-profiles/\$contactId')",
    ]) {
      expect(namesAdminPath(probe), isTrue, reason: probe);
    }
    expect(namesAdminPath("_client.get('/learners/\$id/profile')"), isFalse);
    // The parent's OWN payments are the one billing path the app may call (PD-17).
    expect(namesAdminPath("_client.get('/me/billing')"), isFalse);

    for (final probe in ['final String? familyName;', 'this.birthDate,', 'final int? price;', 'List<Parent> parents)']) {
      expect(forbiddenField.hasMatch(probe), isTrue, reason: probe);
    }
    expect(forbiddenField.hasMatch('final String? teacherName;'), isFalse);
  });
}
