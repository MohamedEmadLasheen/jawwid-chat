import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/materials.dart';
import '../../../shared/utils/app_clock.dart';

/// PD-29 Materials. Every method is one endpoint; NO AUTHORIZATION LIVES HERE --
/// the server decides who may read a child's page (the family, the child's own
/// teacher, staff in PD-8 scope) and its `COMM.*` refusal reaches the caller
/// intact. `open` is the access decision: the only call that returns a URL.
abstract interface class MaterialsRepository {
  /// `GET /materials/quran/surahs`
  Future<List<Surah>> surahs();

  /// `GET /learners/:id/materials/library?subject&ageGroup`
  Future<ChildLibrary> library(String learnerId, {String? subject, String? ageGroup});

  /// `GET /learners/:id/materials/practice`
  Future<PracticeWeek> practice(String learnerId);

  /// `GET /learners/:id/materials/progress`
  Future<ProgressMap> progress(String learnerId);

  /// `GET /learners/:id/materials/progress/:surah`
  Future<SurahHistory> history(String learnerId, int surah);

  /// `POST /learners/:id/materials/progress/:surah/correct`
  Future<SurahHistory> correct(String learnerId, int surah, {required String status, required String reason});

  /// `POST /materials/items/:id/open` -- a short-lived URL to play.
  Future<OpenedMaterial> open(String itemId);

  /// `POST /materials/recitations/:surah/open`
  Future<String> recitation(int surah);

  /// `GET /materials/items?q&surah` -- the teacher's picker (published items only).
  Future<List<MaterialItem>> picker({String? query, int? surah});
}

/// A build with no materials server (fixtures, tests that do not override it):
/// it offers nothing, so no fixture item can be mistaken for the academy's.
class NoMaterialsRepository implements MaterialsRepository {
  const NoMaterialsRepository();

  Never _none() => throw UnsupportedError('materials are not available in this build');

  @override
  Future<List<Surah>> surahs() async => _none();
  @override
  Future<ChildLibrary> library(String learnerId, {String? subject, String? ageGroup}) async => _none();
  @override
  Future<PracticeWeek> practice(String learnerId) async => _none();
  @override
  Future<ProgressMap> progress(String learnerId) async => _none();
  @override
  Future<SurahHistory> history(String learnerId, int surah) async => _none();
  @override
  Future<SurahHistory> correct(String learnerId, int surah, {required String status, required String reason}) async => _none();
  @override
  Future<OpenedMaterial> open(String itemId) async => _none();
  @override
  Future<String> recitation(int surah) async => _none();
  @override
  Future<List<MaterialItem>> picker({String? query, int? surah}) async => _none();
}

/// Overridden at startup with [HttpMaterialsRepository].
final materialsRepositoryProvider = Provider<MaterialsRepository>((ref) => const NoMaterialsRepository());

/// The surah list, fetched once per session.
final surahsProvider = FutureProvider<List<Surah>>((ref) => ref.watch(materialsRepositoryProvider).surahs());

class HttpMaterialsRepository implements MaterialsRepository {
  HttpMaterialsRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  Future<Map<String, Object?>> _get(String path, [Map<String, Object?>? query]) async =>
      (await _client.get<Map<String, Object?>>(path, query: query)).data ?? const {};

  Future<Map<String, Object?>> _post(String path, [Map<String, Object?>? body]) async =>
      (await _client.post<Map<String, Object?>>(path, data: body ?? const {})).data ?? const {};

  @override
  Future<List<Surah>> surahs() async {
    final d = await _get('/materials/quran/surahs');
    return [for (final s in (d['surahs'] as List?) ?? const []) ?Surah.fromJson(s)];
  }

  @override
  Future<ChildLibrary> library(String learnerId, {String? subject, String? ageGroup}) async {
    final d = await _get('/learners/$learnerId/materials/library', {
      'subject': ?subject,
      'ageGroup': ?ageGroup,
    });
    final child = d['child'] is Map ? d['child'] as Map : const {};
    return ChildLibrary(
      childName: child['name'] as String? ?? '',
      childAgeGroup: child['ageGroup'] as String?,
      ageGroup: d['ageGroup'] as String? ?? 'all',
      items: [for (final i in (d['items'] as List?) ?? const []) ?MaterialItem.fromJson(i)],
    );
  }

  @override
  Future<PracticeWeek> practice(String learnerId) async {
    final d = await _get('/learners/$learnerId/materials/practice');
    final reports = <PracticeReport>[];
    for (final r in (d['reports'] as List?) ?? const []) {
      if (r is! Map || r['lessonId'] is! String) continue;
      final submitted = DateTime.tryParse(r['submittedAt'] as String? ?? '');
      if (submitted == null) continue;
      final practice = <PracticeEntry>[];
      for (final p in (r['practice'] as List?) ?? const []) {
        if (p is! Map) continue;
        if (p['kind'] == 'item') {
          practice.add(ItemPractice(MaterialItem.fromJson(p['item'])));
        } else if (p['kind'] == 'ayah_range' && p['surah'] is num) {
          practice.add(AyahPractice(
            surah: (p['surah'] as num).toInt(),
            nameAr: p['nameAr'] as String? ?? '',
            nameEn: p['nameEn'] as String? ?? '',
            ayahFrom: (p['ayahFrom'] as num?)?.toInt() ?? 1,
            ayahTo: (p['ayahTo'] as num?)?.toInt() ?? 1,
            wholeSurah: p['wholeSurah'] == true,
            hasRecitation: p['hasRecitation'] == true,
          ));
        }
      }
      reports.add(PracticeReport(
        lessonId: r['lessonId'] as String,
        submittedAt: AppClock.view(submitted),
        lessonNumber: (r['lessonNumber'] as num?)?.toInt(),
        nextTasks: [for (final t in (r['nextTasks'] as List?) ?? const []) if (t is String) t],
        homework: r['homework'] as String?,
        practice: practice,
      ));
    }
    return PracticeWeek(current: d['current'] != false, reports: reports);
  }

  @override
  Future<ProgressMap> progress(String learnerId) async {
    final d = await _get('/learners/$learnerId/materials/progress');
    final child = d['child'] is Map ? d['child'] as Map : const {};
    final counts = <String, int>{};
    if (d['counts'] is Map) {
      (d['counts'] as Map).forEach((k, v) {
        if (k is String && v is num) counts[k] = v.toInt();
      });
    }
    return ProgressMap(
      childName: child['name'] as String? ?? '',
      counts: counts,
      canCorrect: d['canCorrect'] == true,
      juz: [
        for (final j in (d['juz'] as List?) ?? const [])
          if (j is Map && j['juz'] is num)
            JuzGroup(
              juz: (j['juz'] as num).toInt(),
              surahs: [for (final s in (j['surahs'] as List?) ?? const []) ?_surah(s)],
            ),
      ],
    );
  }

  ProgressSurah? _surah(Object? s) {
    if (s is! Map || s['number'] is! num) return null;
    return ProgressSurah(
      number: (s['number'] as num).toInt(),
      nameAr: s['nameAr'] as String? ?? '',
      nameEn: s['nameEn'] as String? ?? '',
      status: s['status'] as String? ?? 'not_started',
      hasRecitation: s['hasRecitation'] == true,
    );
  }

  SurahHistory _history(Map<String, Object?> d) {
    final s = d['surah'] is Map ? d['surah'] as Map : const {};
    return SurahHistory(
      surah: ProgressSurah(
        number: (s['number'] as num?)?.toInt() ?? 0,
        nameAr: s['nameAr'] as String? ?? '',
        nameEn: s['nameEn'] as String? ?? '',
        status: '',
      ),
      marks: [
        for (final m in (d['marks'] as List?) ?? const [])
          if (m is Map && DateTime.tryParse(m['at'] as String? ?? '') != null)
            SurahMark(
              status: m['status'] as String? ?? '',
              source: m['source'] as String? ?? '',
              byKind: (m['by'] is Map ? (m['by'] as Map)['kind'] : null) as String? ?? 'staff',
              byName: (m['by'] is Map ? (m['by'] as Map)['name'] : null) as String?,
              reason: m['reason'] as String?,
              at: AppClock.view(DateTime.parse(m['at'] as String)),
            ),
      ],
    );
  }

  @override
  Future<SurahHistory> history(String learnerId, int surah) async =>
      _history(await _get('/learners/$learnerId/materials/progress/$surah'));

  @override
  Future<SurahHistory> correct(String learnerId, int surah, {required String status, required String reason}) async =>
      _history(await _post('/learners/$learnerId/materials/progress/$surah/correct', {'status': status, 'reason': reason}));

  @override
  Future<OpenedMaterial> open(String itemId) async => OpenedMaterial.fromJson(await _post('/materials/items/$itemId/open'));

  @override
  Future<String> recitation(int surah) async => (await _post('/materials/recitations/$surah/open'))['url'] as String? ?? '';

  @override
  Future<List<MaterialItem>> picker({String? query, int? surah}) async {
    final d = await _get('/materials/items', {
      if (query != null && query.trim().isNotEmpty) 'q': query.trim(),
      if (surah != null) 'surah': '$surah',
    });
    return [for (final i in (d['items'] as List?) ?? const []) ?MaterialItem.fromJson(i)];
  }
}
