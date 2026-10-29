import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../domain/board_elements.dart';

/// One ayah as the shared Quran dataset serves it (docs/product/quran-dataset-contract.md).
class VerseAyah {
  const VerseAyah({required this.ayah, required this.text, this.basmala});

  final int ayah;

  /// The verse itself, without the Basmala.
  final String text;

  /// The Basmala, for ayah 1 of the 112 surahs that carry it; drawn as its own
  /// line above the verse, never part of a hash or a reference.
  final String? basmala;
}

/// A range of ayat from GET /quran/ayahs.
class VerseText {
  const VerseText({required this.datasetId, required this.rangeSha256, required this.attribution, required this.ayahs});

  final String datasetId;

  /// The server's SHA-256 of the range: of the ayat's verse SHA-256s joined
  /// with "\n" -- the formula a board's verse reference stores.
  final String rangeSha256;

  /// "Tanzil Project — tanzil.net": shown wherever the text is chosen.
  final String attribution;
  final List<VerseAyah> ayahs;

  static VerseText? fromJson(Map<String, Object?> j) {
    final dataset = j['dataset'];
    final range = j['rangeSha256'];
    final ayahs = j['ayahs'];
    if (dataset is! Map || range is! String || ayahs is! List) return null;
    final list = <VerseAyah>[];
    for (final a in ayahs) {
      if (a is! Map || a['ayah'] is! int || a['text'] is! String) return null;
      list.add(VerseAyah(ayah: a['ayah'] as int, text: a['text'] as String, basmala: a['basmala'] as String?));
    }
    final id = dataset['id'];
    if (id is! String || list.isEmpty) return null;
    return VerseText(datasetId: id, rangeSha256: range, attribution: dataset['attribution'] as String? ?? '', ayahs: list);
  }
}

/// The verified Quran text, read-only (PD-29 P0-2's API, shared with PD-39).
abstract interface class QuranTextRepository {
  /// At most 50 ayat. Throws when the dataset is unavailable (503
  /// COMM.QURAN_UNAVAILABLE) or the range is invalid -- never a fallback text.
  Future<VerseText> ayahs(int surah, int from, int to);
}

class NoQuranTextRepository implements QuranTextRepository {
  const NoQuranTextRepository();

  @override
  Future<VerseText> ayahs(int surah, int from, int to) async => throw UnsupportedError('no Quran text in this build');
}

final quranTextRepositoryProvider = Provider<QuranTextRepository>((ref) => const NoQuranTextRepository());

class HttpQuranTextRepository implements QuranTextRepository {
  HttpQuranTextRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<VerseText> ayahs(int surah, int from, int to) async {
    final d = (await _client.get<Map<String, Object?>>('/quran/ayahs', query: {'surah': '$surah', 'from': '$from', 'to': '$to'})).data;
    final text = d == null ? null : VerseText.fromJson(d);
    if (text == null) throw const FormatException('the Quran text answer was not readable');
    return text;
  }
}

// ---------------------------------------------------------------------------

/// Where a verse's text stands for drawing.
enum VerseStatus { loading, ready, unavailable, changed }

class VerseLookup {
  const VerseLookup(this.status, [this.text]);

  final VerseStatus status;
  final VerseText? text;
}

/// The texts of the verses on the open boards, by range. A verse whose served
/// range SHA-256 (or dataset) is not the one its reference stores is
/// [VerseStatus.changed]: the board says "re-insert", never redraws it
/// silently. A dataset that cannot be verified is [VerseStatus.unavailable]:
/// the board says so, never shows a fallback text. The state's identity
/// changes whenever an entry does, which repaints the pages.
class VerseCache extends Notifier<Map<String, VerseLookup>> {
  @override
  Map<String, VerseLookup> build() => const {};

  VerseLookup lookup(VerseElement v) {
    final hit = state[v.rangeKey];
    if (hit == null) return const VerseLookup(VerseStatus.loading);
    if (hit.status != VerseStatus.ready) return hit;
    final t = hit.text!;
    return t.rangeSha256 == v.rangeSha256 && t.datasetId == v.datasetId ? hit : const VerseLookup(VerseStatus.changed);
  }

  /// Fetches every verse of [elements] not yet known (or that failed before).
  void ensure(Iterable<BoardElement> elements) {
    for (final v in elements.whereType<VerseElement>()) {
      final hit = state[v.rangeKey];
      if (hit != null && hit.status != VerseStatus.unavailable) continue;
      _fetch(v);
    }
  }

  /// A range just chosen in the picker: known without another request.
  void remember(VerseElement v, VerseText text) => state = {...state, v.rangeKey: VerseLookup(VerseStatus.ready, text)};

  Future<void> _fetch(VerseElement v) async {
    state = {...state, v.rangeKey: const VerseLookup(VerseStatus.loading)};
    try {
      final text = await ref.read(quranTextRepositoryProvider).ayahs(v.surah, v.fromAyah, v.toAyah);
      if (!ref.mounted) return;
      state = {...state, v.rangeKey: VerseLookup(VerseStatus.ready, text)};
    } on Object {
      if (!ref.mounted) return;
      // Unavailable (503) and anything else alike: no text is shown.
      state = {...state, v.rangeKey: const VerseLookup(VerseStatus.unavailable)};
    }
  }
}

final verseCacheProvider = NotifierProvider<VerseCache, Map<String, VerseLookup>>(VerseCache.new);
