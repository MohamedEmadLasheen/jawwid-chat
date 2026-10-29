import 'dart:async';

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

/// A range of ayat from GET /quran/ayahs: the text knows its OWN surah and
/// ayat, as the server sent them (review of #295, P0), so it can never be
/// filed under another range.
class VerseText {
  const VerseText({
    required this.surah,
    required this.datasetId,
    required this.rangeSha256,
    required this.attribution,
    required this.ayahs,
  });

  final int surah;

  /// The first and last ayah actually in [ayahs].
  int get from => ayahs.first.ayah;
  int get to => ayahs.last.ayah;

  /// Exactly [surah] [fromAyah]..[toAyah], every ayah once and in order.
  bool covers(int surah, int fromAyah, int toAyah) {
    if (surah != this.surah || ayahs.length != toAyah - fromAyah + 1) return false;
    for (var i = 0; i < ayahs.length; i++) {
      if (ayahs[i].ayah != fromAyah + i) return false;
    }
    return true;
  }

  final String datasetId;

  /// The server's SHA-256 of the range: of the ayat's verse SHA-256s joined
  /// with "\n" -- the formula a board's verse reference stores.
  final String rangeSha256;

  /// "Tanzil Project — tanzil.net": shown wherever the text is chosen.
  final String attribution;
  final List<VerseAyah> ayahs;

  static VerseText? fromJson(Map<String, Object?> j) {
    final dataset = j['dataset'];
    final surah = j['surah'];
    final range = j['rangeSha256'];
    final ayahs = j['ayahs'];
    if (dataset is! Map || surah is! Map || surah['number'] is! int || range is! String || ayahs is! List) return null;
    final list = <VerseAyah>[];
    for (final a in ayahs) {
      if (a is! Map || a['ayah'] is! int || a['text'] is! String) return null;
      list.add(VerseAyah(ayah: a['ayah'] as int, text: a['text'] as String, basmala: a['basmala'] as String?));
    }
    final id = dataset['id'];
    if (id is! String || list.isEmpty) return null;
    return VerseText(
      surah: surah['number'] as int,
      datasetId: id,
      rangeSha256: range,
      attribution: dataset['attribution'] as String? ?? '',
      ayahs: list,
    );
  }
}

/// The verified Quran text, read-only (PD-29 P0-2's API, shared with PD-39).
abstract interface class QuranTextRepository {
  /// One verse element's range: at most 20 ayat on a board (the API itself
  /// takes up to 50). Throws when the dataset is unavailable (503
  /// COMM.QURAN_UNAVAILABLE), the range is invalid, or the answer is not
  /// exactly the range asked for -- never a fallback text.
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
    if (text == null || !text.covers(surah, from, to)) throw const FormatException('the Quran text answer is not the range asked for');
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
/// silently. A text that is not EXACTLY the reference's surah and ayat is
/// never shown under it (review of #295, P0). A dataset that cannot be
/// verified is [VerseStatus.unavailable]: the board says so, never shows a
/// fallback text, and asks again after 5 s, 10 s, 20 s ... at most every
/// minute -- never on every rebuild (P1). The state's identity changes
/// whenever an entry does, which repaints the pages.
class VerseCache extends Notifier<Map<String, VerseLookup>> {
  static const Duration firstRetry = Duration(seconds: 5);
  static const Duration maxRetry = Duration(seconds: 60);

  final Map<String, int> _failures = {};
  final Map<String, Timer> _retries = {};

  @override
  Map<String, VerseLookup> build() {
    ref.onDispose(() {
      for (final t in _retries.values) {
        t.cancel();
      }
    });
    return const {};
  }

  VerseLookup lookup(VerseElement v) {
    final hit = state[v.rangeKey];
    if (hit == null) return const VerseLookup(VerseStatus.loading);
    if (hit.status != VerseStatus.ready) return hit;
    final t = hit.text!;
    if (!t.covers(v.surah, v.fromAyah, v.toAyah)) return const VerseLookup(VerseStatus.unavailable);
    return t.rangeSha256 == v.rangeSha256 && t.datasetId == v.datasetId ? hit : const VerseLookup(VerseStatus.changed);
  }

  /// Fetches every verse of [elements] not yet known. A range that failed is
  /// asked again only on its own schedule, not here.
  void ensure(Iterable<BoardElement> elements) {
    for (final v in elements.whereType<VerseElement>()) {
      if (state.containsKey(v.rangeKey)) continue;
      _fetch(v);
    }
  }

  /// A range just chosen in the picker: known without another request -- if
  /// the text is exactly that range.
  void remember(VerseElement v, VerseText text) {
    if (!text.covers(v.surah, v.fromAyah, v.toAyah) || text.datasetId != v.datasetId) return;
    state = {...state, v.rangeKey: VerseLookup(VerseStatus.ready, text)};
  }

  Future<void> _fetch(VerseElement v) async {
    final key = v.rangeKey;
    _retries.remove(key)?.cancel();
    state = {...state, key: const VerseLookup(VerseStatus.loading)};
    try {
      final text = await ref.read(quranTextRepositoryProvider).ayahs(v.surah, v.fromAyah, v.toAyah);
      if (!ref.mounted) return;
      _failures.remove(key);
      state = {...state, key: VerseLookup(VerseStatus.ready, text)};
    } on Object {
      if (!ref.mounted) return;
      // Unavailable (503) and anything else alike: no text is shown.
      final n = _failures[key] = (_failures[key] ?? 0) + 1;
      state = {...state, key: const VerseLookup(VerseStatus.unavailable)};
      final wait = firstRetry * (1 << (n - 1).clamp(0, 4));
      _retries[key] = Timer(wait > maxRetry ? maxRetry : wait, () {
        if (ref.mounted) _fetch(v);
      });
    }
  }
}

/// Lives while a board is open (the editor watches it): closing the last board
/// disposes it, and its retry timers with it (review of #295).
final verseCacheProvider = NotifierProvider.autoDispose<VerseCache, Map<String, VerseLookup>>(VerseCache.new);
