import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/board.dart';
import '../domain/board_elements.dart';
import 'whiteboards_repository.dart';

/// A picture is decoded for drawing at most this on its long side: the page's
/// own width, so a phone photo never costs more memory than the page can show
/// (review of #328).
const int kBoardImageDrawEdge = 1920;

/// The decode size for a picture of [width] x [height]: none larger than
/// [edge] on its long side, proportions kept.
ui.TargetImageSize boundedDecode(int width, int height, int edge) {
  if (width <= edge && height <= edge) return const ui.TargetImageSize();
  return width >= height ? ui.TargetImageSize(width: edge) : ui.TargetImageSize(height: edge);
}

/// Where an image of the board stands for drawing.
enum BoardImageStatus { loading, ready, unavailable }

class BoardImageLookup {
  const BoardImageLookup(this.status, [this.image]);

  final BoardImageStatus status;
  final ui.Image? image;
}

/// How the painter learns an image: the open board's [BoardImages].
typedef BoardImageSource = BoardImageLookup Function(String assetId);

/// An image's bytes, from its signed URL. A bearer link to exactly that image,
/// fetched WITHOUT the app's own token (a separate client, as the attachment
/// uploader is): the URL may point at a host that is not our API.
typedef BoardImageFetch = Future<Uint8List> Function(String url);

/// How long an unavailable image waits before it is tried again (review of
/// #328): a dropped connection should not leave it blank until the board is
/// reopened. Each further wait is twice the last, at most 10 minutes.
final boardImageRetryProvider = Provider<Duration>((ref) => const Duration(seconds: 60));

final boardImageFetchProvider = Provider<BoardImageFetch>((ref) {
  final dio = Dio(BaseOptions(connectTimeout: const Duration(seconds: 15), receiveTimeout: const Duration(seconds: 60)));
  return (url) async {
    final r = await dio.get<List<int>>(url, options: Options(responseType: ResponseType.bytes));
    return Uint8List.fromList(r.data ?? const []);
  };
});

/// PD-39 PR-4: the images of one open board, decoded once each. The server
/// signs them with the board (BoardDetail.assets) for about 15 minutes; an
/// image asked for after its URL ran out -- or whose fetch fails -- has the
/// board's URLs signed again (GET .../assets) and is tried once more, then
/// shows as unavailable -- and is tried again after [boardImageRetryProvider].
/// Each is decoded at most [kBoardImageDrawEdge] on its long side. Lives while
/// the board is open; closing it frees the decoded images.
class BoardImages extends Notifier<Map<String, BoardImageLookup>> {
  BoardImages(this.boardId);

  final String boardId;

  /// A URL this close to its end is signed again before it is used.
  static const Duration refreshMargin = Duration(seconds: 30);

  final Map<String, BoardAsset> _assets = {};
  Future<void>? _refreshing;

  /// Every image decoded here, freed when the board closes (state is not
  /// read in a disposal callback).
  final List<ui.Image> _decoded = [];

  /// The next try of each unavailable image, and how many it has had.
  final Map<String, Timer> _retries = {};
  final Map<String, int> _tries = {};

  static const Duration _longestWait = Duration(minutes: 10);

  @override
  Map<String, BoardImageLookup> build() {
    ref.onDispose(() {
      for (final t in _retries.values) {
        t.cancel();
      }
      _retries.clear();
      for (final image in _decoded) {
        image.dispose();
      }
      _decoded.clear();
    });
    return const {};
  }

  BoardImageLookup lookup(String assetId) => state[assetId] ?? const BoardImageLookup(BoardImageStatus.loading);

  /// The signed URLs a board answer carried.
  void seed(Iterable<BoardAsset> assets) {
    for (final a in assets) {
      _assets[a.id] = a;
    }
  }

  /// An image just added: known at once, without fetching it back.
  void remember(BoardAsset asset, ui.Image image) {
    _retries.remove(asset.id)?.cancel();
    _assets[asset.id] = asset;
    _decoded.add(image);
    state = {...state, asset.id: BoardImageLookup(BoardImageStatus.ready, image)};
  }

  /// Fetches every image of [elements] not yet known.
  void ensure(Iterable<BoardElement> elements) {
    for (final e in elements.whereType<ImageElement>()) {
      if (state.containsKey(e.assetId)) continue;
      unawaited(_load(e.assetId));
    }
  }

  Future<void> _load(String id, {bool again = false}) async {
    state = {...state, id: const BoardImageLookup(BoardImageStatus.loading)};
    try {
      var asset = _assets[id];
      if (asset == null || asset.expiresAt.isBefore(DateTime.now().add(refreshMargin))) {
        await _refresh();
        asset = _assets[id];
      }
      if (!ref.mounted) return;
      if (asset == null) return _unavailable(id);
      final bytes = await ref.read(boardImageFetchProvider)(asset.url);
      final codec = await ui.instantiateImageCodecWithSize(
        await ui.ImmutableBuffer.fromUint8List(bytes),
        getTargetSize: (w, h) => boundedDecode(w, h, kBoardImageDrawEdge),
      );
      final frame = await codec.getNextFrame();
      codec.dispose();
      if (!ref.mounted) {
        frame.image.dispose();
        return;
      }
      _decoded.add(frame.image);
      _tries.remove(id);
      state = {...state, id: BoardImageLookup(BoardImageStatus.ready, frame.image)};
    } on Object {
      if (!ref.mounted) return;
      if (!again) {
        // Most often a URL that ran out: sign the board's images again, once.
        _assets.remove(id);
        return _load(id, again: true);
      }
      _unavailable(id);
    }
  }

  void _unavailable(String id) {
    state = {...state, id: const BoardImageLookup(BoardImageStatus.unavailable)};
    _retries[id]?.cancel();
    final n = _tries[id] = (_tries[id] ?? 0) + 1;
    final wait = ref.read(boardImageRetryProvider) * (1 << (n - 1).clamp(0, 10));
    _retries[id] = Timer(wait < _longestWait ? wait : _longestWait, () {
      _retries.remove(id);
      if (ref.mounted) unawaited(_load(id));
    });
  }

  /// One re-signing at a time, shared by every image waiting for it.
  Future<void> _refresh() => _refreshing ??= () async {
    try {
      seed(await ref.read(whiteboardsRepositoryProvider).imageUrls(boardId));
    } on Object {
      // Nothing new: the image shows as unavailable.
    } finally {
      _refreshing = null;
    }
  }();
}

final boardImagesProvider = NotifierProvider.autoDispose.family<BoardImages, Map<String, BoardImageLookup>, String>(BoardImages.new);
