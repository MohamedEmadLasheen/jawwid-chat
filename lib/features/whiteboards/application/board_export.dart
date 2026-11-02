import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:file_selector/file_selector.dart' as selector;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/data/http/attachment_uploader.dart';
import '../../../core/errors/app_error.dart';
import '../data/board_images.dart';
import '../data/quran_text_repository.dart';
import '../data/whiteboards_repository.dart';
import '../domain/board_elements.dart';
import '../domain/board_page.dart';
import '../presentation/board_painter.dart';

/// PD-39 PR-4 (design §4.6): a board as a PNG or a PDF.
///
/// The portal is the one renderer: each page is drawn here, by the same
/// painter as the editor, at the board's own size (1920 x 1080, the server's
/// cap for an export page). A PNG is saved as it is. A PDF is made by the
/// server from those PNGs (grant, PUT each to its signed URL, compose) -- with
/// the Quran text's credit when a verse is on the board -- and comes back in
/// the answer; nothing of it is kept on the server.

/// How an export ended, for the teacher. [inProgress]: the teacher's own
/// exports already in flight (five at most); [busy]: the server's workers are
/// all taken; [expired]: the export took over an hour and must be made again.
enum ExportOutcome { saved, cancelled, exportsOff, busy, inProgress, expired, tooLarge, notHere, failed }

class ExportException implements Exception {
  const ExportException(this.outcome);

  final ExportOutcome outcome;

  @override
  String toString() => 'ExportException($outcome)';
}

/// What a page is drawn with: the open board's verses and images, and the
/// words on a box that has not loaded.
class PageInk {
  const PageInk({this.verses, this.images, this.label});

  final VerseSource? verses;
  final BoardImageSource? images;
  final String Function(BoardElement element)? label;
}

/// A page as a PNG, 1920 x 1080.
Future<Uint8List> renderPagePng(BoardPage page, PageInk ink) async {
  final w = kBoardPageSize.width.toInt(), h = kBoardPageSize.height.toInt();
  final recorder = ui.PictureRecorder();
  final canvas = ui.Canvas(recorder);
  BoardPagePainter(page: page, verses: ink.verses, images: ink.images, placeholderLabel: ink.label, versesVersion: Object(), imagesVersion: Object())
      .paint(canvas, kBoardPageSize);
  final image = await recorder.endRecording().toImage(w, h);
  try {
    return (await image.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
  } finally {
    image.dispose();
  }
}

/// Whether anything on [pages] is still loading (a verse's text, an image).
bool stillLoading(Iterable<BoardPage> pages, PageInk ink) {
  for (final e in pages.expand((p) => p.elements)) {
    if (e is VerseElement && ink.verses?.call(e).status == VerseStatus.loading) return true;
    if (e is ImageElement && ink.images?.call(e.assetId).status == BoardImageStatus.loading) return true;
  }
  return false;
}

/// Waits (up to [limit]) for what the pages show to load, so an export never
/// catches a verse or an image half-way. What is still loading after that is
/// exported as its labelled box, as the board shows it.
Future<void> settleForExport(Iterable<BoardPage> pages, PageInk ink, {Duration limit = const Duration(seconds: 10)}) async {
  final until = DateTime.now().add(limit);
  while (stillLoading(pages, ink) && DateTime.now().isBefore(until)) {
    await Future<void>.delayed(const Duration(milliseconds: 200));
  }
}

/// How often compose is asked when the server's workers are all taken.
const int kComposeTries = 4;

/// The whole board as a PDF, made by the server from [pngs] (page order).
///
/// A compose turned away because the workers are busy (429) is asked again
/// with the SAME grants, after the server's Retry-After or a growing wait
/// (review of #335): new grants would leave these pending for an hour,
/// counting toward the teacher's five exports in flight. Given up on in any
/// way after its grant -- an upload that fails, a refusal, still busy after
/// the last try, or [cancelled] (the editor closed) -- the export is
/// released on the server at once, quietly.
Future<Uint8List> exportPdf(
  WhiteboardsRepository repo,
  AttachmentUploader uploads,
  String boardId,
  List<Uint8List> pngs, {
  Future<void> Function(Duration) wait = _wait,
  bool Function()? cancelled,
}) async {
  final List<ImageGrant> grants;
  try {
    grants = await repo.grantExport(boardId, [for (final p in pngs) p.length]);
  } on AppError catch (e) {
    throw ExportException(_grantRefusal(e));
  } on Object {
    throw const ExportException(ExportOutcome.failed);
  }
  try {
    if (grants.length != pngs.length) throw const ExportException(ExportOutcome.failed);
    void stopIfCancelled() {
      if (cancelled?.call() ?? false) throw const ExportException(ExportOutcome.cancelled);
    }

    for (var i = 0; i < pngs.length; i++) {
      stopIfCancelled();
      try {
        await uploads.put(grants[i].uploadUrl, bytes: pngs[i], headers: grants[i].headers);
      } on Object {
        throw const ExportException(ExportOutcome.failed);
      }
    }
    for (var attempt = 1; ; attempt++) {
      stopIfCancelled();
      try {
        return await repo.composeExport(boardId, grants);
      } on AppError catch (e) {
        if (e.kind == AppErrorKind.rateLimited && attempt < kComposeTries) {
          await wait(e.retryAfter ?? Duration(seconds: 2 << attempt));
          continue;
        }
        throw ExportException(_composeRefusal(e));
      } on Object {
        throw const ExportException(ExportOutcome.failed);
      }
    }
  } on ExportException {
    await _release(repo, boardId, grants);
    rethrow;
  }
}

/// Lets an export go on the server; a failure here changes nothing for the
/// teacher (what is not released runs out within the hour).
Future<void> _release(WhiteboardsRepository repo, String boardId, List<ImageGrant> grants) async {
  if (grants.isEmpty) return;
  try {
    await repo.releaseExport(boardId, grants);
  } on Object {
    // Quietly: the export's own outcome is what the teacher hears.
  }
}

Future<void> _wait(Duration d) => Future<void>.delayed(d);

/// The grant's refusals, as #325 sends them: 409 LIMIT is the teacher's five
/// exports in flight; 422 INVALID a board over the export's size.
ExportOutcome _grantRefusal(AppError e) => switch (e) {
  AppError(code: kAssetsOffCode) => ExportOutcome.exportsOff,
  AppError(kind: AppErrorKind.rateLimited) => ExportOutcome.busy,
  AppError(code: 'COMM.WHITEBOARD_LIMIT') => ExportOutcome.inProgress,
  AppError(code: 'COMM.WHITEBOARD_INVALID') => ExportOutcome.tooLarge,
  _ => ExportOutcome.failed,
};

/// Compose's refusals: 409 STATE is an export that ran out ("export again");
/// 409 CONFLICT one already being made.
ExportOutcome _composeRefusal(AppError e) => switch (e) {
  AppError(code: kAssetsOffCode) => ExportOutcome.exportsOff,
  AppError(kind: AppErrorKind.rateLimited) => ExportOutcome.busy,
  AppError(code: 'COMM.WHITEBOARD_STATE') => ExportOutcome.expired,
  AppError(code: 'COMM.WHITEBOARD_CONFLICT') => ExportOutcome.inProgress,
  _ => ExportOutcome.failed,
};

/// "Al-Fatihah review" -> "Al-Fatihah review.pdf": the board's title, safe as a file name.
String exportName(String title, String extension) {
  final safe = title.replaceAll(RegExp(r'[\\/:*?"<>|\x00-\x1f]+'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
  final cut = safe.length > 80 ? safe.substring(0, 80).trim() : safe;
  return '${cut.isEmpty ? 'board' : cut}.$extension';
}

/// Where an export goes: a download in the browser, a save dialog on a
/// desktop, the system share sheet on a phone or tablet (owner, 2026-11-02).
typedef ExportSaver = Future<ExportOutcome> Function(Uint8List bytes, String name, String mimeType);

/// The system share sheet for one file: true when it was shared, false when the
/// person closed the sheet, null when the platform has no sheet.
typedef ExportShare = Future<bool?> Function(String path, String mimeType, String name);

Future<bool?> _shareWithSystem(String path, String mimeType, String name) async {
  // An iPad shows the sheet as a popover, which needs somewhere to point:
  // the middle of the screen (a phone ignores it).
  final view = ui.PlatformDispatcher.instance.views.first;
  final size = view.physicalSize / view.devicePixelRatio;
  final result = await SharePlus.instance.share(ShareParams(
    files: [XFile(path, mimeType: mimeType, name: name)],
    fileNameOverrides: [name],
    sharePositionOrigin: ui.Rect.fromCenter(center: ui.Offset(size.width / 2, size.height / 2), width: 1, height: 1),
  ));
  return switch (result.status) {
    ShareResultStatus.success => true,
    ShareResultStatus.dismissed => false,
    ShareResultStatus.unavailable => null,
  };
}

final exportShareProvider = Provider<ExportShare>((ref) => _shareWithSystem);

/// Where a phone keeps an export while the sheet is open (tests use their own).
final exportTempDirProvider = Provider<Future<Directory> Function()>((ref) => getTemporaryDirectory);

/// The saver the editor uses (tests put a recorder in its place).
final exportSaverProvider = Provider<ExportSaver>((ref) {
  final share = ref.watch(exportShareProvider);
  final tempDir = ref.watch(exportTempDirProvider);
  return (bytes, name, mimeType) => saveExport(bytes, name, mimeType, share: share, tempDir: tempDir);
});

bool get _isPhone => defaultTargetPlatform == TargetPlatform.iOS || defaultTargetPlatform == TargetPlatform.android;

/// Whether this build has somewhere to put an export: the browser, a
/// desktop's save dialog, or a phone's share sheet. Asked BEFORE anything is
/// drawn or sent (review of #335): elsewhere an export would take a worker and
/// an audit row for a file never saved.
bool canSaveExportHere() =>
    kIsWeb ||
    _isPhone ||
    defaultTargetPlatform == TargetPlatform.macOS ||
    defaultTargetPlatform == TargetPlatform.windows ||
    defaultTargetPlatform == TargetPlatform.linux;

final exportHereProvider = Provider<bool>((ref) => canSaveExportHere());

Future<ExportOutcome> saveExport(
  Uint8List bytes,
  String name,
  String mimeType, {
  ExportShare share = _shareWithSystem,
  Future<Directory> Function() tempDir = getTemporaryDirectory,
}) async {
  if (kIsWeb) {
    await XFile.fromData(bytes, mimeType: mimeType, name: name).saveTo(name); // the browser downloads it
    return ExportOutcome.saved;
  }
  if (_isPhone) return shareExport(bytes, name, mimeType, share: share, tempDir: tempDir);
  if (!canSaveExportHere()) return ExportOutcome.notHere;
  final where = await selector.getSaveLocation(suggestedName: name);
  if (where == null) return ExportOutcome.cancelled;
  await XFile.fromData(bytes, mimeType: mimeType, name: name).saveTo(where.path);
  return ExportOutcome.saved;
}

/// A phone or tablet: the file, under its board's name, in a folder of its own
/// in the app's temporary directory, handed to the system share sheet -- and
/// the folder deleted when the sheet closes, whatever happened (nothing of a
/// board is left lying in a cache).
Future<ExportOutcome> shareExport(
  Uint8List bytes,
  String name,
  String mimeType, {
  required ExportShare share,
  required Future<Directory> Function() tempDir,
}) async {
  final folder = await (await tempDir()).createTemp('jawwid-export-');
  try {
    final file = File('${folder.path}/$name');
    await file.writeAsBytes(bytes, flush: true);
    final shared = await share(file.path, mimeType, name);
    return switch (shared) {
      true => ExportOutcome.saved,
      false => ExportOutcome.cancelled,
      null => ExportOutcome.notHere,
    };
  } finally {
    try {
      await folder.delete(recursive: true);
    } on Object {
      // The OS clears its temporary directory on its own; nothing to tell the teacher.
    }
  }
}
