import '../../../shared/models/message.dart';

/// PD-36 @mentions -- the text half, kept pure so it is tested on its own.
///
/// Offsets are UTF-16 code units: what a Dart string indexes by and what the server stores,
/// so a span means the same characters here, in Admin Web and on the server. The composer
/// never tracks offsets while typing: it remembers WHO was picked under which label, and
/// finds each "@label" in the final text when it sends -- an edit in between cannot leave a
/// span pointing at the wrong words.

/// Someone picked from the @ list, under the label inserted into the text (no "@").
class PickedMention {
  const PickedMention.person(this.label, String this.actorId) : role = null;
  const PickedMention.role(this.label, String this.role) : actorId = null;

  final String label;
  final String? actorId;
  final String? role;
}

/// The "@query" being typed just before [caret].
class MentionQuery {
  const MentionQuery(this.start, this.query);

  final int start;
  final String query;

  @override
  bool operator ==(Object other) => other is MentionQuery && other.start == start && other.query == query;

  @override
  int get hashCode => Object.hash(start, query);
}

const _maxQuery = 40;
final _space = RegExp(r'\s');

/// The "@query" before [caret], or null. "@" opens a mention only at the start or after
/// whitespace (so an e-mail address does not), and the query has no whitespace in it.
MentionQuery? activeMentionQuery(String text, int caret) {
  if (caret < 1 || caret > text.length) return null;
  for (var i = caret - 1; i >= 0 && caret - i <= _maxQuery + 1; i--) {
    final ch = text[i];
    if (_space.hasMatch(ch)) return null;
    if (ch == '@') {
      if (i > 0 && !_space.hasMatch(text[i - 1])) return null;
      return MentionQuery(i, text.substring(i + 1, caret));
    }
  }
  return null;
}

/// Replace the "@query" at `start..caret` with "@label " and put the caret after it.
({String text, int caret}) insertMention(String text, int caret, int start, String label) {
  final chip = '@$label ';
  return (text: text.substring(0, start) + chip + text.substring(caret), caret: start + chip.length);
}

/// At send: where each picked mention sits in the final [text]. A pick whose "@label" is no
/// longer there mentions nobody. Spans never overlap; longer labels are placed first so
/// "@Laila Mansour" is not claimed as "@Laila".
List<MessageMention> spansFor(String text, List<PickedMention> picked) {
  final taken = <(int, int)>[];
  bool free(int s, int e) => taken.every((t) => e <= t.$1 || s >= t.$2);
  final out = <MessageMention>[];
  final order = [...picked]..sort((a, b) => b.label.length.compareTo(a.label.length));
  for (final p in order) {
    final needle = '@${p.label}';
    var from = 0;
    while (true) {
      final at = text.indexOf(needle, from);
      if (at < 0) break;
      final end = at + needle.length;
      final boundaryBefore = at == 0 || _space.hasMatch(text[at - 1]);
      if (boundaryBefore && free(at, end)) {
        taken.add((at, end));
        out.add(MessageMention(start: at, length: needle.length, actorId: p.actorId, role: p.role));
        break;
      }
      from = at + 1;
    }
  }
  out.sort((a, b) => a.start.compareTo(b.start));
  return out;
}

/// The body cut into plain runs and chips. A span that does not fit the text is plain text.
List<({String text, MessageMention? mention})> mentionSegments(String body, List<MessageMention> mentions) {
  final valid = mentions
      .where((m) => m.start >= 0 && m.length > 0 && m.start + m.length <= body.length && body[m.start] == '@')
      .toList()
    ..sort((a, b) => a.start.compareTo(b.start));
  final out = <({String text, MessageMention? mention})>[];
  var at = 0;
  for (final m in valid) {
    if (m.start < at) continue; // overlapping: the first wins
    if (m.start > at) out.add((text: body.substring(at, m.start), mention: null));
    out.add((text: body.substring(m.start, m.start + m.length), mention: m));
    at = m.start + m.length;
  }
  if (at < body.length) out.add((text: body.substring(at), mention: null));
  return out;
}

/// Unicode isolates around a chip, so an Arabic name in English text (or the reverse) keeps
/// its own direction and never reorders the words around it. Drawing only -- never sent.
String isolate(String chip) => '\u2068$chip\u2069';
