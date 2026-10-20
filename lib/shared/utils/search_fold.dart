/// The client's copy of `chat.search_fold` (migration 20261020140000), used only
/// to HIGHLIGHT what the server matched -- the server decides what matches.
///
/// Lower case; Arabic harakat (U+064B-U+065F), superscript alef (U+0670) and
/// tatweel (U+0640) ignored; hamza/madda alef forms read as bare alef, alef
/// maqsura as yeh, teh marbuta as heh. Written as code points so the source
/// carries no invisible characters.
library;

bool _ignored(int cp) => (cp >= 0x64b && cp <= 0x65f) || cp == 0x670 || cp == 0x640;

const Map<int, int> _sameAs = {0x623: 0x627, 0x625: 0x627, 0x622: 0x627, 0x671: 0x627, 0x649: 0x64a, 0x629: 0x647};

/// The folded text, and for each folded code unit the UTF-16 offset it came from.
({String folded, List<int> from}) _fold(String text) {
  final folded = StringBuffer();
  final from = <int>[];
  var offset = 0;
  for (final cp in text.runes) {
    final width = cp > 0xffff ? 2 : 1;
    if (!_ignored(cp)) {
      final lowered = String.fromCharCode(_sameAs[cp] ?? cp).toLowerCase();
      for (var i = 0; i < lowered.length; i++) {
        from.add(offset);
      }
      folded.write(lowered);
    }
    offset += width;
  }
  from.add(offset);
  return (folded: folded.toString(), from: from);
}

/// Where [query] occurs in [text], as (start, end) UTF-16 offsets into the
/// original text.
List<(int, int)> searchMatchRanges(String text, String query) {
  final needle = _fold(query.trim().replaceAll(RegExp(r'\s+'), ' ')).folded;
  if (needle.isEmpty) return const [];
  final f = _fold(text);
  final out = <(int, int)>[];
  var at = f.folded.indexOf(needle);
  while (at != -1) {
    var end = f.from[at + needle.length];
    // Run on past marks that follow the last matched letter.
    while (end < text.length && _ignored(text.codeUnitAt(end))) {
      end += 1;
    }
    out.add((f.from[at], end));
    at = f.folded.indexOf(needle, at + needle.length);
  }
  return out;
}

/// A term worth sending: [min] characters (default 2) that are not only marks.
/// Search across chats asks for [searchAcrossMin], as the server does: a
/// two-letter term cannot use the trigram index.
bool isSearchable(String query, {int min = 2}) =>
    _fold(query.trim()).folded.replaceAll(RegExp(r'\s'), '').length >= min;

/// The fewest characters a search across chats needs (MessageService.SEARCH_ACROSS_MIN).
const int searchAcrossMin = 3;

/// A long text cut to the part around its first match.
String snippetAround(String text, String query, {int before = 32}) {
  final ranges = searchMatchRanges(text, query);
  if (ranges.isEmpty || ranges.first.$1 <= before) return text;
  final start = text.lastIndexOf(' ', ranges.first.$1 - before);
  return '…${text.substring(start > 0 ? start + 1 : ranges.first.$1 - before)}';
}
