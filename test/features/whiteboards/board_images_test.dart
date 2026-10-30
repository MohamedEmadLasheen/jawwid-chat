// PD-39 PR-4 (design §4.4, §6.3): a picture on a board. It is checked here
// as the server will check it, and anything else that decodes is turned into
// a still PNG first. It is uploaded by grant, PUT to the signed URL and
// confirm, and every refusal tells the teacher which one it is. The board's
// images are decoded once each, and a URL that ran out is signed again once.
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/http/attachment_uploader.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/features/whiteboards/application/board_image_import.dart';
import 'package:jawwid_chat/features/whiteboards/data/board_images.dart';
import 'package:jawwid_chat/features/whiteboards/data/whiteboards_repository.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/features/whiteboards/presentation/board_painter.dart';

/// A real PNG of [w] x [h], drawn and encoded by the engine.
Future<Uint8List> _png(int w, int h) async {
  final recorder = ui.PictureRecorder();
  ui.Canvas(recorder).drawRect(ui.Rect.fromLTWH(0, 0, w.toDouble(), h.toDouble()), ui.Paint()..color = const ui.Color(0xFF2E7D32));
  final image = await recorder.endRecording().toImage(w, h);
  return (await image.toByteData(format: ui.ImageByteFormat.png))!.buffer.asUint8List();
}

/// The classic 1 x 1 GIF89a: the engine decodes it, the server would refuse it.
final Uint8List _gif = Uint8List.fromList([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, //
  0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, //
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

class _Repo implements WhiteboardsRepository {
  Object? grantError;
  int urlsAsked = 0;
  List<BoardAsset> urls = const [];
  final grants = <(String, int)>[];

  @override
  Future<ImageGrant> grantImage(String boardId, {required String contentType, required int byteSize}) async {
    if (grantError != null) throw grantError!;
    grants.add((contentType, byteSize));
    return const ImageGrant(assetId: 'a1', objectKey: 'whiteboard-uploads/o/b1/a1/u', uploadUrl: 'https://s.test/up', headers: {'Content-Type': 'image/png'});
  }

  @override
  Future<BoardAsset> confirmImage(String boardId, String assetId, String objectKey) async =>
      BoardAsset(id: assetId, url: 'https://s.test/a1', expiresAt: DateTime.now().add(const Duration(minutes: 15)), width: 40, height: 30);

  @override
  Future<List<BoardAsset>> imageUrls(String boardId) async {
    urlsAsked++;
    return urls;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError(invocation.memberName.toString());
}

class _Uploads implements AttachmentUploader {
  final puts = <(String, int, Map<String, String>)>[];

  @override
  Future<void> put(String uploadUrl, {required Uint8List bytes, required Map<String, String> headers}) async =>
      puts.add((uploadUrl, bytes.length, headers));
}

void main() {
  group('a picture is prepared as the server will check it', () {
    test('a PNG within the limits goes as it is', () async {
      final raw = await _png(40, 30);
      final p = await prepareBoardImage(raw);
      expect([p.contentType, p.width, p.height, identical(p.bytes, raw)], ['image/png', 40, 30, true]);
    });

    test('a GIF becomes a still PNG of its first frame', () async {
      final p = await prepareBoardImage(_gif);
      expect([p.contentType, p.width, p.height], ['image/png', 1, 1]);
      expect(sniffBoardImage(p.bytes), 'image/png');
    });

    test('a file that is not a picture, or a damaged one, is refused as not a picture', () async {
      final damaged = Uint8List.fromList([..._gif.sublist(0, 30), 0xff, 0xff, 0xff]);
      for (final raw in [Uint8List.fromList('<svg><script/></svg>'.codeUnits), damaged]) {
        await expectLater(
          prepareBoardImage(raw),
          throwsA(isA<ImageImportException>().having((e) => e.outcome, 'outcome', ImageImportOutcome.notAnImage)),
        );
      }
    });

    test('placed in the middle of the page, at most 60% of it, keeping its proportions', () {
      final e = placeBoardImage('a1', 4000, 1000, id: 'i1');
      expect(e.rect.width, closeTo(kBoardPageSize.width * 0.6, 0.01));
      expect(e.rect.width / e.rect.height, closeTo(4, 0.001));
      expect(e.rect.center, kBoardPageSize.center(ui.Offset.zero));
      expect(placeBoardImage('a1', 100, 50, id: 'i2').rect.size, const ui.Size(100, 50));
    });
  });

  group('upload: grant, PUT, confirm', () {
    test('the bytes go to the signed URL with the grant\'s headers; the kept image comes back', () async {
      final repo = _Repo();
      final uploads = _Uploads();
      final p = await prepareBoardImage(await _png(40, 30));
      final asset = await uploadBoardImage(repo, uploads, 'b1', p);
      expect(asset.id, 'a1');
      expect(repo.grants, [('image/png', p.bytes.length)]);
      final put = uploads.puts.single;
      expect([put.$1, put.$2, put.$3], ['https://s.test/up', p.bytes.length, {'Content-Type': 'image/png'}]);
    });

    test('each refusal says which: switched off, too large, not a picture, anything else', () async {
      final p = await prepareBoardImage(await _png(4, 4));
      Future<ImageImportOutcome> outcome(Object error) async {
        final repo = _Repo()..grantError = error;
        try {
          await uploadBoardImage(repo, _Uploads(), 'b1', p);
        } on ImageImportException catch (e) {
          return e.outcome;
        }
        throw StateError('no refusal');
      }

      expect(await outcome(const AppError(AppErrorKind.server, code: kAssetsOffCode)), ImageImportOutcome.imagesOff);
      expect(await outcome(const AppError(AppErrorKind.unknown, code: 'COMM.WHITEBOARD_LIMIT')), ImageImportOutcome.tooLarge);
      expect(await outcome(const AppError(AppErrorKind.validation, code: 'COMM.WHITEBOARD_INVALID')), ImageImportOutcome.notAnImage);
      expect(await outcome(const AppError(AppErrorKind.network)), ImageImportOutcome.failed);
      expect(await outcome(const FormatException('odd answer')), ImageImportOutcome.failed);
    });
  });

  group('the open board\'s images', () {
    late _Repo repo;
    late ProviderContainer container;
    late Map<String, Uint8List> served;
    late List<String> fetched;

    setUp(() async {
      repo = _Repo();
      served = {'https://s.test/fresh': await _png(8, 6)};
      fetched = [];
      container = ProviderContainer(
        overrides: [
          whiteboardsRepositoryProvider.overrideWithValue(repo),
          boardImageFetchProvider.overrideWithValue((url) async {
            fetched.add(url);
            final bytes = served[url];
            if (bytes == null) throw StateError('403: the URL ran out');
            return bytes;
          }),
        ],
      );
      container.listen(boardImagesProvider('b1'), (_, _) {});
    });
    tearDown(() => container.dispose());

    BoardImages images() => container.read(boardImagesProvider('b1').notifier);
    const element = ImageElement(id: 'i1', assetId: 'a1', rect: ui.Rect.fromLTWH(0, 0, 80, 60));

    Future<void> settle() async {
      for (var i = 0; i < 20; i++) {
        await Future<void>.delayed(Duration.zero);
      }
    }

    test('an image signed with the board is fetched once and decoded', () async {
      images().seed([BoardAsset(id: 'a1', url: 'https://s.test/fresh', expiresAt: DateTime.now().add(const Duration(minutes: 15)))]);
      images().ensure([element]);
      await settle();
      expect(images().lookup('a1').status, BoardImageStatus.ready);
      expect(images().lookup('a1').image!.width, 8);
      images().ensure([element]);
      await settle();
      expect(fetched, ['https://s.test/fresh']);
      expect(repo.urlsAsked, 0);
    });

    test('a URL that ran out is signed again, once, and the image comes', () async {
      images().seed([BoardAsset(id: 'a1', url: 'https://s.test/old', expiresAt: DateTime.now().add(const Duration(minutes: 15)))]);
      repo.urls = [BoardAsset(id: 'a1', url: 'https://s.test/fresh', expiresAt: DateTime.now().add(const Duration(minutes: 15)))];
      images().ensure([element]);
      await settle();
      expect(fetched, ['https://s.test/old', 'https://s.test/fresh']);
      expect(repo.urlsAsked, 1);
      expect(images().lookup('a1').status, BoardImageStatus.ready);
    });

    test('an image that cannot be had shows as unavailable, after one re-signing', () async {
      repo.urls = const [];
      images().ensure([element]);
      await settle();
      expect(images().lookup('a1').status, BoardImageStatus.unavailable);
      expect(repo.urlsAsked, 1);
      expect(fetched, isEmpty);
    });
  });

  test('the painter draws a ready image into its box, and a box with its label while it loads', () async {
    final codec = await ui.instantiateImageCodec(await _png(8, 6));
    final green = (await codec.getNextFrame()).image;
    const e = ImageElement(id: 'i1', assetId: 'a1', rect: ui.Rect.fromLTWH(10, 10, 80, 60));
    Future<ui.Color> centre(BoardImageSource source) async {
      final recorder = ui.PictureRecorder();
      paintElement(ui.Canvas(recorder), e, images: source, label: (_) => 'loading');
      final image = await recorder.endRecording().toImage(100, 80);
      final data = (await image.toByteData())!;
      const at = (40 * 100 + 50) * 4;
      return ui.Color.fromARGB(data.getUint8(at + 3), data.getUint8(at), data.getUint8(at + 1), data.getUint8(at + 2));
    }

    expect(await centre((_) => BoardImageLookup(BoardImageStatus.ready, green)), const ui.Color(0xFF2E7D32));
    expect(await centre((_) => const BoardImageLookup(BoardImageStatus.loading)), isNot(const ui.Color(0xFF2E7D32)));
  });
}
