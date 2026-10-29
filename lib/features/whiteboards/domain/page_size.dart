import 'dart:convert';

/// A page holds at most 512 KB as the SERVER measures it (review of #293): the
/// bytes of the stored document's text, `octet_length(document::text)` --
/// Postgres prints jsonb with ": " after every key and ", " between items, so
/// the stored text is longer than the compact JSON a client sends.
const int kPageMaxStoredBytes = 512 * 1024;

/// [value]'s size as Postgres stores it (jsonb's text form), in UTF-8 bytes.
int storedJsonBytes(Object? value) {
  if (value is Map) {
    var n = 2 + (value.isEmpty ? 0 : 2 * (value.length - 1));
    value.forEach((k, v) => n += utf8.encode(jsonEncode('$k')).length + 2 + storedJsonBytes(v));
    return n;
  }
  if (value is List) {
    var n = 2 + (value.isEmpty ? 0 : 2 * (value.length - 1));
    for (final v in value) {
      n += storedJsonBytes(v);
    }
    return n;
  }
  return utf8.encode(jsonEncode(value)).length;
}
