import 'dart:io';

import '../../../shared/models/parent_profile.dart';
import '../../errors/app_error.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import 'attachment_uploader.dart';

/// `ProfileRepository` over the published REST contract.
///
/// Routes consumed (`apps/api/src/communication/api/profile.controller.ts`):
///
/// | Method | Path | Purpose |
/// |---|---|---|
/// | GET | `/me/profile` | the caller's own profile and their family's children (contact only) |
/// | GET | `/me/avatar` | the caller's own name and photo, for ANY account kind |
/// | POST | `/me/avatar/authorize` | a short-lived, size- and type-bound upload grant |
/// | POST | `/me/avatar` | commit an uploaded photo as the caller's own |
/// | DELETE | `/me/avatar` | remove it |
/// | POST | `/me/children/:id/avatar` | the same, for a child of the caller's family |
/// | DELETE | `/me/children/:id/avatar` | and its removal |
///
/// ## None of these take a parent id
///
/// There is no `:parentId` anywhere above, because the server reads the caller from the
/// bearer token. This client could not ask for somebody else's profile if it tried.
///
/// ## The upload path is the existing one, unchanged
///
/// Authorize, then PUT the bytes STRAIGHT to storage on the returned signed URL, then tell
/// the API the key. The bytes never pass through the API process, and no storage credential
/// ever reaches this app — the same two-step attachments and story media already use, via
/// the same [AttachmentUploader] seam.
///
/// Every response returns the whole profile, so a caller never has to re-fetch to find out
/// what the change did, and the UI never has to guess.
class HttpProfileRepository implements ProfileRepository {
  HttpProfileRepository({required ApiClient client, AttachmentUploader? uploads})
      : _client = client,
        _uploads = uploads ?? DioAttachmentUploader();

  final ApiClient _client;
  final AttachmentUploader _uploads;

  @override
  Future<ParentProfile> me() async {
    final response = await _client.get<Map<String, Object?>>('/me/profile');
    return _profile(response.data);
  }

  @override
  Future<ParentProfile> myAvatar() async {
    final response = await _client.get<Map<String, Object?>>('/me/avatar');
    return _profile(response.data);
  }

  @override
  Future<ParentProfile> setAvatar(PendingAttachment image) async {
    final key = await _authorizeAndPut(image);
    final response = await _client.post<Map<String, Object?>>(
      '/me/avatar',
      data: {'objectKey': key},
    );
    return _profile(response.data);
  }

  @override
  Future<ParentProfile> removeAvatar() async {
    final response = await _client.delete<Map<String, Object?>>('/me/avatar');
    return _profile(response.data);
  }

  @override
  Future<ParentProfile> setChildAvatar(String childId, PendingAttachment image) async {
    final key = await _authorizeAndPut(image);
    final response = await _client.post<Map<String, Object?>>(
      '/me/children/$childId/avatar',
      data: {'objectKey': key},
    );
    return _profile(response.data);
  }

  @override
  Future<ParentProfile> removeChildAvatar(String childId) async {
    final response =
        await _client.delete<Map<String, Object?>>('/me/children/$childId/avatar');
    return _profile(response.data);
  }

  // -------------------------------------------------------------------------

  /// Authorize, then put the bytes where the grant says. Returns the object key.
  ///
  /// The server decides the type and size rules; this sends what the picker produced and
  /// lets the API refuse it. A client-side check here would be a convenience, never the
  /// control — and duplicating the rule is how the two drift apart.
  Future<String> _authorizeAndPut(PendingAttachment image) async {
    final authorized = await _client.post<Map<String, Object?>>(
      '/me/avatar/authorize',
      data: {'mimeType': image.mimeType, 'byteSize': image.byteSize},
    );

    final grant = authorized.data;
    final objectKey = grant?['objectKey'] as String?;
    final uploadUrl = grant?['uploadUrl'] as String?;
    if (objectKey == null || uploadUrl == null) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_upload_authorization',
        debugDetail: 'authorize response carried no objectKey or uploadUrl',
      );
    }

    final bytes = await File(image.filePath).readAsBytes();
    // The grant is bound to the size it signed for, so a file that changed underneath us
    // would be refused by storage as an opaque 403. Fail here with something diagnosable.
    if (bytes.length != image.byteSize) {
      throw const AppError(
        AppErrorKind.server,
        code: 'avatar_size_changed',
        debugDetail: 'the image changed size between authorization and upload',
      );
    }

    await _uploads.put(uploadUrl, bytes: bytes, headers: _headers(grant?['headers']));
    return objectKey;
  }

  /// The headers the grant told us to send — chiefly the content type, which storage
  /// signed and therefore verifies.
  static Map<String, String> _headers(Object? raw) {
    final out = <String, String>{};
    if (raw is! Map) return out;
    raw.forEach((key, value) {
      if (key is String && value is String) out[key] = value;
    });
    return out;
  }

  static ParentProfile _profile(Map<String, Object?>? json) {
    if (json == null) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_profile',
        debugDetail: 'the profile response carried no body',
      );
    }
    final rows = (json['children'] as List?) ?? const [];
    return ParentProfile(
      displayName: (json['displayName'] as String?) ?? '',
      relationship: _text(json['relationship']),
      signInIdentity: _text(json['signInIdentity']),
      avatarUrl: _text(json['avatarUrl']),
      canMessage: json['canMessage'] != false,
      children: [
        for (final row in rows)
          if (row is Map<String, Object?> && (row['id'] as String?) != null)
            ChildProfile(
              id: row['id']! as String,
              displayName: (row['displayName'] as String?) ?? '',
              level: _text(row['level']),
              avatarUrl: _text(row['avatarUrl']),
            ),
      ],
    );
  }

  static String? _text(Object? raw) {
    if (raw is! String) return null;
    final trimmed = raw.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}
