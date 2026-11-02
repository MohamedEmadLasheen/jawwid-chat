/// PARENT-017: the real PluginMediaPicker's video path, with the system picker
/// and the duration probe replaced (no platform channel).
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:jawwid_chat/core/media/media_picker.dart';
import 'package:jawwid_chat/shared/models/message.dart';

class _Images extends ImagePicker {
  _Images(this.file);

  final XFile? file;
  ImageSource? source;
  Duration? maxDuration;

  @override
  Future<XFile?> pickVideo({
    required ImageSource source,
    CameraDevice preferredCameraDevice = CameraDevice.rear,
    Duration? maxDuration,
  }) async {
    this.source = source;
    this.maxDuration = maxDuration;
    return file;
  }
}

void main() {
  late Directory dir;
  setUp(() => dir = Directory.systemTemp.createTempSync('video_picker'));
  tearDown(() => dir.deleteSync(recursive: true));

  File fileOf(String name, int length) {
    final f = File('${dir.path}/$name');
    // Sparse: the length is real, the bytes are never allocated.
    final raf = f.openSync(mode: FileMode.write)..truncateSync(length);
    raf.closeSync();
    return f;
  }

  test('a library video: its type from the file, its length from the probe, no duration cap', () async {
    final images = _Images(XFile(fileOf('clip.mov', 2048).path, name: 'clip.mov'));
    final picker = PluginMediaPicker(images: images, probe: (_) async => const Duration(seconds: 42));
    final picked = (await picker.pickVideo())!;
    expect(images.source, ImageSource.gallery);
    expect(images.maxDuration, isNull);
    expect(picked.kind, MessageKind.video);
    expect(picked.mimeType, 'video/quicktime');
    expect(picked.byteSize, 2048);
    expect(picked.fileName, 'clip.mov');
    expect(picked.duration, const Duration(seconds: 42));
  });

  test('a recording comes from the camera, capped at 3 minutes', () async {
    final images = _Images(XFile(fileOf('rec.mp4', 1024).path, name: 'rec.mp4', mimeType: 'video/mp4'));
    final picked = (await PluginMediaPicker(images: images, probe: (_) async => null).recordVideo())!;
    expect(images.source, ImageSource.camera);
    expect(images.maxDuration, AttachmentLimits.videoMaxDuration);
    expect(AttachmentLimits.videoMaxDuration, const Duration(minutes: 3));
    expect(picked.mimeType, 'video/mp4');
    expect(picked.duration, isNull, reason: 'an unreadable length is no length, not a guess');
  });

  test('a video over the server\'s 100 MB is refused before the preview', () async {
    final big = fileOf('long.mp4', AttachmentLimits.videoBytes + 1);
    final picker = PluginMediaPicker(images: _Images(XFile(big.path, name: 'long.mp4')), probe: (_) async => null);
    await expectLater(
      picker.pickVideo(),
      throwsA(isA<MediaPickException>().having((e) => e.reason, 'reason', MediaPickFailure.tooLarge)),
    );
    expect(AttachmentLimits.videoBytes, 100 * 1024 * 1024);
  });

  test('a container the server does not accept is refused as a type', () async {
    final picker = PluginMediaPicker(images: _Images(XFile(fileOf('old.avi', 512).path, name: 'old.avi')), probe: (_) async => null);
    await expectLater(
      picker.pickVideo(),
      throwsA(isA<MediaPickException>().having((e) => e.reason, 'reason', MediaPickFailure.typeNotAllowed)),
    );
  });

  test('backing out is null, not a failure', () async {
    expect(await PluginMediaPicker(images: _Images(null), probe: (_) async => null).pickVideo(), isNull);
  });
}
