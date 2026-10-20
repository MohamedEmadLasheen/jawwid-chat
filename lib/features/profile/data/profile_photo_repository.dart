import 'dart:io';

import '../../../core/data/http/attachment_uploader.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/network/api_client.dart';

/// The signed-in person's own photo and, for a parent, each child's.
///
/// Every url here is a signed `/media/avatars` link for THIS viewer: loaded with
/// no bearer header, re-authorized by the server on every request.
class MyPhotos {
  const MyPhotos({this.avatarUrl, this.children = const []});

  final String? avatarUrl;
  final List<ChildPhoto> children;

  /// Parents only: the server lists children for a family contact and nobody else.
  bool get hasChildren => children.isNotEmpty;
}

class ChildPhoto {
  const ChildPhoto({required this.id, required this.name, this.avatarUrl});

  final String id;
  final String name;
  final String? avatarUrl;
}

/// Profile photos: own (parent, teacher) and children's (parent).
///
/// Staff set their photo on their staff profile in Admin Web, never here.
abstract interface class ProfilePhotoRepository {
  /// False when this build has no photo server: the section is not offered.
  bool get isAvailable;

  Future<MyPhotos> mine();

  /// Upload and commit. [childId] null means the caller's own photo.
  /// Returns the new signed link.
  Future<String?> set(PendingAttachment photo, {String? childId});

  Future<void> remove({String? childId});
}

/// A build without a photo server simply offers no photo controls.
class NoProfilePhotoRepository implements ProfilePhotoRepository {
  const NoProfilePhotoRepository();

  @override
  bool get isAvailable => false;

  @override
  Future<MyPhotos> mine() async => const MyPhotos();

  @override
  Future<String?> set(PendingAttachment photo, {String? childId}) async => null;

  @override
  Future<void> remove({String? childId}) async {}
}

/// `/me/photo`, `/me/avatar…`, `/me/children/:id/avatar…`.
///
/// The bytes go to the signed upload URL through [AttachmentUploader], never
/// through [ApiClient]: that URL is self-authorizing and in production is not
/// our host, so the session's bearer token must never be sent to it.
class HttpProfilePhotoRepository implements ProfilePhotoRepository {
  HttpProfilePhotoRepository({required ApiClient client, AttachmentUploader? uploads})
      : _client = client,
        _uploads = uploads ?? DioAttachmentUploader();

  final ApiClient _client;
  final AttachmentUploader _uploads;

  @override
  bool get isAvailable => true;

  String _base(String? childId) => childId == null ? '/me/avatar' : '/me/children/$childId/avatar';

  @override
  Future<MyPhotos> mine() async {
    final response = await _client.get<Map<String, Object?>>('/me/photo');
    final data = response.data ?? const {};
    return MyPhotos(
      avatarUrl: _url(data['avatarUrl']),
      children: [
        for (final c in (data['children'] as List?) ?? const [])
          if (c is Map && c['id'] is String)
            ChildPhoto(
              id: c['id'] as String,
              name: c['name'] is String ? c['name'] as String : '',
              avatarUrl: _url(c['avatarUrl']),
            ),
      ],
    );
  }

  @override
  Future<String?> set(PendingAttachment photo, {String? childId}) async {
    final authorized = await _client.post<Map<String, Object?>>(
      '${_base(childId)}/upload',
      data: {'mimeType': photo.mimeType, 'byteSize': photo.byteSize},
    );
    final grant = authorized.data;
    final objectKey = grant?['objectKey'];
    final uploadUrl = grant?['uploadUrl'];
    if (objectKey is! String || uploadUrl is! String) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_upload_authorization',
        debugDetail: 'avatar upload authorization carried no objectKey or uploadUrl',
      );
    }
    final bytes = await File(photo.filePath).readAsBytes();
    if (bytes.length != photo.byteSize) {
      throw const AppError(
        AppErrorKind.server,
        code: 'avatar_size_changed',
        debugDetail: 'the photo changed size between authorization and upload',
      );
    }
    final headers = <String, String>{};
    final raw = grant?['headers'];
    if (raw is Map) {
      raw.forEach((k, v) {
        if (k is String && v is String) headers[k] = v;
      });
    }
    await _uploads.put(uploadUrl, bytes: bytes, headers: headers);
    final committed = await _client.post<Map<String, Object?>>(_base(childId), data: {'objectKey': objectKey});
    return _url(committed.data?['avatarUrl']);
  }

  @override
  Future<void> remove({String? childId}) async {
    await _client.delete<Object?>(_base(childId));
  }

  static String? _url(Object? raw) => raw is String && raw.isNotEmpty ? raw : null;
}
