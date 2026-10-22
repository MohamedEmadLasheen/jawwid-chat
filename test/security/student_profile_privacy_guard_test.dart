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

  /// PD-20: the one HTTP repository outside lib/features/sales_payments/ allowed to name them.
  const salesRepository = 'lib/core/data/http/http_sales_payments_repository.dart';
  bool mayNameAdminPaths(String path) => path.startsWith('lib/features/sales_payments/') || path == salesRepository;

  /// `/parent-profiles/` followed by an id, an interpolation or a concatenation: the
  /// DETAIL record, which carries a phone number and an e-mail address.
  final detailPath = RegExp(r"/parent-profiles/(\$|'|[A-Za-z0-9_{])");
  bool namesParentDetailPath(String line) => detailPath.hasMatch(line);

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

  /// Every Dart file under lib/, by its path relative to the package root.
  List<File> libSources() => Directory('lib')
      .listSync(recursive: true)
      .whereType<File>()
      .where((f) => f.path.endsWith('.dart'))
      .toList();

  /// Lines of [files] (comments included -- a path in prose is still a path) for which
  /// [matches] holds.
  List<String> hitsIn(Iterable<File> files, bool Function(String line) matches) => [
        for (final file in files)
          for (final (i, line) in file.readAsLinesSync().indexed)
            if (matches(line)) '${file.path}:${i + 1}  ${line.trim()}',
      ];

  test('the administration paths are CONFINED to Sales\' Payments (PD-20)', () {
    // `/parent-profiles`, `/instalments`, `/families/:id/billing` may be named only by Sales'
    // Payments feature and its one HTTP repository. Anywhere else -- the parent's own
    // Payments, the teacher's Student Profile, any other screen -- is a regression.
    final files = libSources();
    expect(files, isNotEmpty);

    final outside = hitsIn(files.where((f) => !mayNameAdminPaths(f.path)), namesAdminPath);
    expect(
      outside,
      isEmpty,
      reason: 'Parent profiles and payments are administration endpoints; only '
          'lib/features/sales_payments/ and $salesRepository may name them.\n${outside.join('\n')}',
    );

    // And the confinement is not vacuous: the one repository really is where they live.
    expect(hitsIn([File(salesRepository)], namesAdminPath), isNotEmpty);
  });

  test("the parent's Payments and the teacher's Student Profile name none of them", () {
    final files = [
      ...studentProfileSources(),
      ...Directory('lib/features/billing').listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.dart')),
      File('lib/shared/models/parent_billing.dart'),
      File('lib/core/data/http/http_billing_repository.dart'),
    ];
    final hits = hitsIn(files, namesAdminPath);
    expect(hits, isEmpty, reason: hits.join('\n'));
  });

  test("no file under lib/ names a parent's DETAIL record", () {
    // `GET /parent-profiles/:id` answers a phone number and an e-mail address. The app
    // must never hold either (G-07), so the route is never named -- not even by Sales.
    final hits = hitsIn(libSources(), namesParentDetailPath);
    expect(
      hits,
      isEmpty,
      reason: 'The parent detail record carries contact data the app must never hold.\n${hits.join('\n')}',
    );
  });

  test('every scan catches what it exists to catch (positive controls)', () {
    for (final probe in [
      r"await _client.get('/families/$id/billing');",
      "await _client.post('/instalments/\$id/payment');",
      "_client.get('/parent-profiles/\$contactId')",
      "_client.get('/parent-profiles', query: {'q': q})",
    ]) {
      expect(namesAdminPath(probe), isTrue, reason: probe);
    }
    expect(namesAdminPath("_client.get('/learners/\$id/profile')"), isFalse);
    // The parent's OWN payments are the one billing path the whole app may call (PD-17).
    expect(namesAdminPath("_client.get('/me/billing')"), isFalse);

    // Confinement: the Sales folder and its repository yes; nothing else.
    expect(mayNameAdminPaths('lib/features/sales_payments/presentation/family_billing_screen.dart'), isTrue);
    expect(mayNameAdminPaths(salesRepository), isTrue);
    for (final path in [
      'lib/features/billing/presentation/my_payments_screen.dart',
      'lib/features/student_profile/presentation/student_profile_screen.dart',
      'lib/core/data/http/http_billing_repository.dart',
      'lib/core/data/repositories.dart',
      'lib/features/sales_payments_extra/x.dart',
    ]) {
      expect(mayNameAdminPaths(path), isFalse, reason: path);
    }

    // The detail record, however it is spelled; the search list is not one.
    for (final probe in [
      r"_client.get('/parent-profiles/$contactId')",
      r"_client.get('/parent-profiles/${hit.id}')",
      "_client.get('/parent-profiles/' + id)",
      "_client.get('/parent-profiles/c0ffee')",
    ]) {
      expect(namesParentDetailPath(probe), isTrue, reason: probe);
    }
    for (final probe in [
      "_client.get('/parent-profiles', query: {'q': q})",
      "/// | GET | `/parent-profiles?q=` -- the list",
    ]) {
      expect(namesParentDetailPath(probe), isFalse, reason: probe);
    }

    for (final probe in ['final String? familyName;', 'this.birthDate,', 'final int? price;', 'List<Parent> parents)']) {
      expect(forbiddenField.hasMatch(probe), isTrue, reason: probe);
    }
    expect(forbiddenField.hasMatch('final String? teacherName;'), isFalse);
  });
}
