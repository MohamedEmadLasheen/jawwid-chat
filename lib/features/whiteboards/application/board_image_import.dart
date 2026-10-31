import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:cross_file/cross_file.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/data/http/attachment_uploader.dart';
import '../../../core/errors/app_error.dart';
import '../data/board_images.dart';
import '../data/whiteboards_repository.dart';
import '../domain/board.dart';
import '../domain/board_elements.dart';

/// PD-39 PR-4 (design §4.4): putting a picture on a board.
///
/// The picture is checked here as the server will check it -- PNG, JPEG or
/// WebP, a still image, at most 10 MB and 8,000 px -- and anything else that
/// decodes (a GIF, an animated image, a very large photo) is turned into a
/// still PNG of its first frame, at most 4,000 px, first. Then: a grant for a
/// key the server chose, the bytes PUT to its signed URL (never with the
/// app's own token), and a confirm, after which the server has checked the
/// real bytes and a page may name the image.

/// How adding a picture ended, for the teacher.
enum ImageImportOutcome { added, imagesOff, notAnImage, tooLarge, failed }

class ImageImportException implements Exception {
  const ImageImportException(this.outcome);

  final ImageImportOutcome outcome;

  @override
  String toString() => 'ImageImportException($outcome)';
}

/// The server's limits (apps/api/src/whiteboards/whiteboard-image.ts).
const int kBoardImageMaxBytes = 10 * 1024 * 1024;
const int kBoardImageMaxEdge = 8000;

/// What is redrawn as a still PNG is at most this on its long side.
const int kBoardImageRedrawEdge = 4000;

/// A picture ready to upload, and its first frame decoded (drawn at once, not
/// fetched back). [width] and [height] are the uploaded picture's own; the
/// decoded [image] may be smaller ([kBoardImageDrawEdge]).
class PreparedImage {
  const PreparedImage({required this.bytes, required this.contentType, required this.image, required this.width, required this.height});

  final Uint8List bytes;
  final String contentType;
  final ui.Image image;
  final int width;
  final int height;
}

String? sniffBoardImage(Uint8List b) {
  bool at(int i, List<int> bytes) => b.length >= i + bytes.length && [for (var k = 0; k < bytes.length; k++) b[i + k] == bytes[k]].every((x) => x);
  if (at(0, const [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (at(0, const [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (at(0, const [0x52, 0x49, 0x46, 0x46]) && at(8, const [0x57, 0x45, 0x42, 0x50])) return 'image/webp';
  return null;
}

Future<PreparedImage> prepareBoardImage(Uint8List raw) async {
  final type = sniffBoardImage(raw);
  var width = 0, height = 0;
  final int frames;
  final ui.Image first;
  try {
    // Decoded no larger than it will be used: the page's width when it goes
    // as it is, the redraw's when it must be redrawn -- never a 8,000 px
    // photo in full (review of #328). Its own size is read on the way.
    // A damaged file can fail at either step: opening it, or decoding its first frame.
    final codec = await ui.instantiateImageCodecWithSize(
      await ui.ImmutableBuffer.fromUint8List(raw),
      getTargetSize: (w, h) {
        width = w;
        height = h;
        final asItIs = type != null && raw.length <= kBoardImageMaxBytes && w <= kBoardImageMaxEdge && h <= kBoardImageMaxEdge;
        return boundedDecode(w, h, asItIs ? kBoardImageDrawEdge : kBoardImageRedrawEdge);
      },
    );
    frames = codec.frameCount;
    first = (await codec.getNextFrame()).image;
    codec.dispose();
  } on Object {
    throw const ImageImportException(ImageImportOutcome.notAnImage);
  }
  final fits = type != null && raw.length <= kBoardImageMaxBytes && width <= kBoardImageMaxEdge && height <= kBoardImageMaxEdge;
  if (fits && frames == 1) return PreparedImage(bytes: raw, contentType: type, image: first, width: width, height: height);

  // A GIF, an animated image, or one too large: its first frame, redrawn as a
  // still PNG. It was decoded at most [kBoardImageRedrawEdge] (an animated
  // one that fits, at most [kBoardImageDrawEdge]): drawn at that size.
  final w = first.width, h = first.height;
  final recorder = ui.PictureRecorder();
  ui.Canvas(recorder).drawImage(first, ui.Offset.zero, ui.Paint()..filterQuality = ui.FilterQuality.medium);
  first.dispose();
  final still = await recorder.endRecording().toImage(w, h);
  final png = (await still.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
  if (png.length > kBoardImageMaxBytes) {
    still.dispose();
    throw const ImageImportException(ImageImportOutcome.tooLarge);
  }
  return PreparedImage(bytes: png, contentType: 'image/png', image: still, width: w, height: h);
}

/// Where a new picture sits: the middle of the page, at most 60% of it either
/// way, keeping its proportions.
ImageElement placeBoardImage(String assetId, int width, int height, {String? id}) {
  final maxW = kBoardPageSize.width * 0.6, maxH = kBoardPageSize.height * 0.6;
  final k = [maxW / width, maxH / height, 1.0].reduce((a, b) => a < b ? a : b);
  final w = width * k, h = height * k;
  return ImageElement(
    id: id ?? 'i${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}',
    assetId: assetId,
    rect: ui.Rect.fromLTWH((kBoardPageSize.width - w) / 2, (kBoardPageSize.height - h) / 2, w, h),
  );
}

/// A picked file's bytes (a seam for tests: the file system is not theirs).
final boardImageBytesProvider = Provider<Future<Uint8List> Function(String path)>((ref) => (path) => XFile(path).readAsBytes());

/// The signed-URL PUT, a separate client from the API's (attachment_uploader.dart).
final boardUploaderProvider = Provider<AttachmentUploader>((ref) => DioAttachmentUploader());

/// Grant, PUT, confirm: the picture kept on the server as an image of [boardId].
Future<BoardAsset> uploadBoardImage(WhiteboardsRepository repo, AttachmentUploader uploads, String boardId, PreparedImage image) async {
  try {
    final grant = await repo.grantImage(boardId, contentType: image.contentType, byteSize: image.bytes.length);
    await uploads.put(grant.uploadUrl, bytes: image.bytes, headers: grant.headers);
    return await repo.confirmImage(boardId, grant.assetId, grant.objectKey);
  } on AppError catch (e) {
    // A server from before PR-4 has no image routes at all: a 404 that is
    // not one of ours (no code) means the same as switched off (review of #328).
    if (e.code == kAssetsOffCode || (e.kind == AppErrorKind.notFound && e.code == null)) {
      throw const ImageImportException(ImageImportOutcome.imagesOff);
    }
    if (e.code == 'COMM.WHITEBOARD_LIMIT') throw const ImageImportException(ImageImportOutcome.tooLarge);
    if (e.code == 'COMM.WHITEBOARD_INVALID') throw const ImageImportException(ImageImportOutcome.notAnImage);
    throw const ImageImportException(ImageImportOutcome.failed);
  } on Object {
    throw const ImageImportException(ImageImportOutcome.failed);
  }
}
