import 'dart:async';
import 'dart:ui' as ui;

import 'package:cross_file/cross_file.dart';
import 'package:file_selector/file_selector.dart' as selector;
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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

/// How an export ended, for the teacher.
enum ExportOutcome { saved, cancelled, exportsOff, busy, tooLarge, notHere, failed }

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

/// The whole board as a PDF, made by the server from [pngs] (page order).
Future<Uint8List> exportPdf(WhiteboardsRepository repo, AttachmentUploader uploads, String boardId, List<Uint8List> pngs) async {
  try {
    final grants = await repo.grantExport(boardId, [for (final p in pngs) p.length]);
    if (grants.length != pngs.length) throw const ExportException(ExportOutcome.failed);
    for (var i = 0; i < pngs.length; i++) {
      await uploads.put(grants[i].uploadUrl, bytes: pngs[i], headers: grants[i].headers);
    }
    return await repo.composeExport(boardId, grants);
  } on ExportException {
    rethrow;
  } on AppError catch (e) {
    if (e.code == kAssetsOffCode) throw const ExportException(ExportOutcome.exportsOff);
    if (e.kind == AppErrorKind.rateLimited) throw const ExportException(ExportOutcome.busy);
    if (e.code == 'COMM.WHITEBOARD_LIMIT') throw const ExportException(ExportOutcome.tooLarge);
    throw const ExportException(ExportOutcome.failed);
  } on Object {
    throw const ExportException(ExportOutcome.failed);
  }
}

/// "Al-Fatihah review" -> "Al-Fatihah review.pdf": the board's title, safe as a file name.
String exportName(String title, String extension) {
  final safe = title.replaceAll(RegExp(r'[\\/:*?"<>|\x00-\x1f]+'), ' ').replaceAll(RegExp(r'\s+'), ' ').trim();
  final cut = safe.length > 80 ? safe.substring(0, 80).trim() : safe;
  return '${cut.isEmpty ? 'board' : cut}.$extension';
}

/// Where an export goes: a download in the browser, a save dialog on a
/// desktop. A phone or tablet has no place to put a file without more
/// plugins; there the teacher is told to export from the browser.
typedef ExportSaver = Future<ExportOutcome> Function(Uint8List bytes, String name, String mimeType);

/// The saver the editor uses (tests put a recorder in its place).
final exportSaverProvider = Provider<ExportSaver>((ref) => saveExport);

Future<ExportOutcome> saveExport(Uint8List bytes, String name, String mimeType) async {
  final file = XFile.fromData(bytes, mimeType: mimeType, name: name);
  if (kIsWeb) {
    await file.saveTo(name); // the browser downloads it
    return ExportOutcome.saved;
  }
  final desktop = defaultTargetPlatform == TargetPlatform.macOS ||
      defaultTargetPlatform == TargetPlatform.windows ||
      defaultTargetPlatform == TargetPlatform.linux;
  if (!desktop) return ExportOutcome.notHere;
  final where = await selector.getSaveLocation(suggestedName: name);
  if (where == null) return ExportOutcome.cancelled;
  await file.saveTo(where.path);
  return ExportOutcome.saved;
}
