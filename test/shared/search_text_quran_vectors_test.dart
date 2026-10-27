import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/shared/utils/search_text.dart';

/// The shared Quran dataset derives `text_search` with the loader's port of
/// [SearchText.fold] (scripts/db/load-quran.py). Both are held to the same vectors,
/// data/quran/search-normalisation.vectors.json, so a verse found in the app and a
/// verse found by the API can never fold differently
/// (docs/product/quran-dataset-contract.md).
void main() {
  final file = File('data/quran/search-normalisation.vectors.json');
  final vectors = (jsonDecode(file.readAsStringSync()) as Map<String, dynamic>)['vectors'] as List<dynamic>;

  test('the vector file is not empty', () => expect(vectors, isNotEmpty));

  for (final raw in vectors) {
    final v = raw as Map<String, dynamic>;
    test(v['note'] as String, () {
      expect(SearchText.fold(v['input'] as String), v['folded'] as String);
    });
  }
}
