import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'whiteboards_repository.dart';

/// A phone or tablet: one file per account and board in the app's support
/// directory, which only this app reads and the OS does not back up to a
/// shared place. Up to 32 MB a draft (a teacher's whole 25 MB of drawings fits).
BoardDraftStore platformBoardDraftStore() => const FileBoardDraftStore();

class FileBoardDraftStore implements BoardDraftStore {
  const FileBoardDraftStore();

  static const int maxBytes = 32 * 1024 * 1024;

  Future<Directory> _dir() async => Directory('${(await getApplicationSupportDirectory()).path}/whiteboard-drafts');

  Future<File> _file(String actorId, String boardId) async {
    // Ids are UUIDs; anything else is reduced to safe characters.
    String safe(String v) => v.replaceAll(RegExp('[^A-Za-z0-9-]'), '_');
    return File('${(await _dir()).path}/${safe(actorId)}.${safe(boardId)}.json');
  }

  @override
  Future<BoardDraft?> read(String actorId, String boardId) async {
    try {
      final f = await _file(actorId, boardId);
      if (!await f.exists()) return null;
      return BoardDraft.fromJson(jsonDecode(await f.readAsString()));
    } on Object {
      return null;
    }
  }

  @override
  Future<bool> write(String actorId, String boardId, BoardDraft draft) async {
    try {
      final bytes = utf8.encode(jsonEncode(draft.toJson()));
      if (bytes.length > maxBytes) return false;
      final f = await _file(actorId, boardId);
      await f.parent.create(recursive: true);
      // Write then rename: a crash mid-write never leaves half a draft.
      final tmp = File('${f.path}.tmp');
      await tmp.writeAsBytes(bytes, flush: true);
      await tmp.rename(f.path);
      return true;
    } on Object {
      return false;
    }
  }

  @override
  Future<void> clear(String actorId, String boardId) async {
    try {
      final f = await _file(actorId, boardId);
      if (await f.exists()) await f.delete();
    } on Object {
      // Nothing to clear.
    }
  }

  @override
  Future<void> clearAll() async {
    try {
      final d = await _dir();
      if (await d.exists()) await d.delete(recursive: true);
    } on Object {
      // Nothing to clear.
    }
  }
}
