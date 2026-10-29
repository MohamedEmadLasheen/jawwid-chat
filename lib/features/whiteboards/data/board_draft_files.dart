// The board draft store for this platform: files on a phone or tablet,
// localStorage in a browser (where dart:io does not exist).
export 'board_draft_files_stub.dart' if (dart.library.io) 'board_draft_files_io.dart';
