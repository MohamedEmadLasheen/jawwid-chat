import 'dart:io';

import '../../../core/data/http/attachment_uploader.dart';
import '../../../core/data/repositories.dart';
import '../../../core/errors/app_error.dart';
import '../../../core/network/api_client.dart';

/// The viewer's OWN look for one chat (owner decisions 2026-10-20): a preset
/// background and an optional photo wallpaper. Private to the viewer, stored on
/// the server so it follows the account. Read back on the conversation
/// (`Conversation.themeKey` / `wallpaperUrl`).
///
/// A separate seam with a harmless default, like the profile photos: a build
/// without the routes offers no Chat theme.
abstract interface class ChatThemeRepository {
  bool get isAvailable;

  Future<void> setTheme(String conversationId, String? themeKey);

  /// Upload [photo] as this chat's wallpaper; returns its link for the viewer.
  Future<String?> setWallpaper(String conversationId, PendingAttachment photo);

  Future<void> removeWallpaper(String conversationId);
}

class NoChatThemeRepository implements ChatThemeRepository {
  const NoChatThemeRepository();

  @override
  bool get isAvailable => false;
  @override
  Future<void> setTheme(String conversationId, String? themeKey) async {}
  @override
  Future<String?> setWallpaper(String conversationId, PendingAttachment photo) async => null;
  @override
  Future<void> removeWallpaper(String conversationId) async {}
}

class HttpChatThemeRepository implements ChatThemeRepository {
  HttpChatThemeRepository({required ApiClient client, AttachmentUploader? uploads})
      : _client = client,
        _uploads = uploads ?? DioAttachmentUploader();

  final ApiClient _client;
  final AttachmentUploader _uploads;

  @override
  bool get isAvailable => true;

  String _base(String conversationId) => '/conversations/$conversationId';

  @override
  Future<void> setTheme(String conversationId, String? themeKey) =>
      _client.put<Object?>('${_base(conversationId)}/theme', data: {'theme': themeKey});

  @override
  Future<String?> setWallpaper(String conversationId, PendingAttachment photo) async {
    final authorized = await _client.post<Map<String, Object?>>(
      '${_base(conversationId)}/wallpaper/upload',
      data: {'mimeType': photo.mimeType, 'byteSize': photo.byteSize},
    );
    final grant = authorized.data;
    final objectKey = grant?['objectKey'];
    final uploadUrl = grant?['uploadUrl'];
    if (objectKey is! String || uploadUrl is! String) {
      throw const AppError(
        AppErrorKind.server,
        code: 'malformed_upload_authorization',
        debugDetail: 'wallpaper upload authorization carried no objectKey or uploadUrl',
      );
    }
    final bytes = await File(photo.filePath).readAsBytes();
    final headers = <String, String>{};
    final raw = grant?['headers'];
    if (raw is Map) {
      raw.forEach((k, v) {
        if (k is String && v is String) headers[k] = v;
      });
    }
    // The signed URL is self-authorizing; the uploader never sends the session bearer.
    await _uploads.put(uploadUrl, bytes: bytes, headers: headers);
    final committed = await _client.post<Map<String, Object?>>('${_base(conversationId)}/wallpaper', data: {'objectKey': objectKey});
    final url = committed.data?['wallpaperUrl'];
    return url is String && url.isNotEmpty ? url : null;
  }

  @override
  Future<void> removeWallpaper(String conversationId) => _client.delete<Object?>('${_base(conversationId)}/wallpaper');
}
