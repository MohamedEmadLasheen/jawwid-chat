import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/materials.dart';
import '../../../shared/utils/app_clock.dart';
import 'lesson_audio.dart';

/// PD-29 Materials. Every method is one endpoint; NO AUTHORIZATION LIVES HERE --
/// the server decides who may read a child's page (the family, the child's own
/// teacher, staff in PD-8 scope) and its `COMM.*` refusal reaches the caller
/// intact. `open` is the access decision: the only call that returns a URL.
abstract interface class MaterialsRepository {
  /// `GET /materials/quran/surahs`
  Future<List<Surah>> surahs();

  /// `GET /learners/:id/materials/library?subject&ageGroup`
  Future<ChildLibrary> library(String learnerId, {String? subject, String? ageGroup});

  /// `GET /learners/:id/materials/opened` -- what was opened for this child this
  /// academy week (Saturday to Friday).
  Future<OpenedThisWeek> opened(String learnerId);

  /// `POST /materials/items/:id/open` -- a short-lived URL to play. With
  /// [learnerId], the opening is recorded for that child ("Opened this week").
  Future<OpenedMaterial> open(String itemId, {String? learnerId});

  /// `POST /materials/recitations/:surah/open`
  Future<String> recitation(int surah);

  /// `GET /materials/items?q&surah` -- the teacher's picker (published items only).
  Future<List<MaterialItem>> picker({String? query, int? surah});

  /// `GET /quran/ayahs?surah` (50 ayat a request) -- the audio list for a framed
  /// Quran lesson ([lessonAudioMessage]), or null when the release gate gives
  /// this account no audio.
  Future<Map<String, Object?>?> lessonAudio(int surah);
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
  Future<OpenedThisWeek> opened(String learnerId) async => _none();
  @override
  Future<OpenedMaterial> open(String itemId, {String? learnerId}) async => _none();
  @override
  Future<String> recitation(int surah) async => _none();
  @override
  Future<List<MaterialItem>> picker({String? query, int? surah}) async => _none();
  @override
  Future<Map<String, Object?>?> lessonAudio(int surah) async => null;
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
  Future<OpenedThisWeek> opened(String learnerId) async {
    final d = await _get('/learners/$learnerId/materials/opened');
    final items = <OpenedItem>[];
    for (final r in (d['items'] as List?) ?? const []) {
      if (r is! Map) continue;
      final item = MaterialItem.fromJson(r['item']);
      final at = DateTime.tryParse(r['lastOpenedAt'] as String? ?? '');
      if (item == null || at == null) continue;
      items.add(OpenedItem(
        item: item,
        available: r['available'] != false,
        lastOpenedAt: AppClock.view(at),
        times: (r['times'] as num?)?.toInt() ?? 1,
      ));
    }
    final week = DateTime.tryParse(d['weekStartsAt'] as String? ?? '');
    return OpenedThisWeek(weekStartsAt: week == null ? DateTime.now() : AppClock.view(week), items: items);
  }

  @override
  Future<OpenedMaterial> open(String itemId, {String? learnerId}) async =>
      OpenedMaterial.fromJson(await _post('/materials/items/$itemId/open', {'learnerId': ?learnerId}));

  @override
  Future<String> recitation(int surah) async => (await _post('/materials/recitations/$surah/open'))['url'] as String? ?? '';

  @override
  Future<Map<String, Object?>?> lessonAudio(int surah) async {
    final ayahs = <Object?>[];
    var from = 1;
    int? count;
    while (count == null || from <= count) {
      final d = await _get('/quran/ayahs', {'surah': '$surah', 'from': '$from', if (count != null) 'to': '${from + 49 < count ? from + 49 : count}'});
      count = ((d['surah'] as Map?)?['ayahCount'] as num?)?.toInt() ?? 0;
      final page = (d['ayahs'] as List?) ?? const [];
      if (page.isEmpty) break;
      ayahs.addAll(page);
      from = (((page.last as Map?)?['ayah'] as num?)?.toInt() ?? count) + 1;
    }
    return lessonAudioMessage(surah, ayahs);
  }

  @override
  Future<List<MaterialItem>> picker({String? query, int? surah}) async {
    final d = await _get('/materials/items', {
      if (query != null && query.trim().isNotEmpty) 'q': query.trim(),
      if (surah != null) 'surah': '$surah',
    });
    return [for (final i in (d['items'] as List?) ?? const []) ?MaterialItem.fromJson(i)];
  }
}
