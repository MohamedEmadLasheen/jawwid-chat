import 'dart:io';

import 'package:dio/dio.dart';

import '../../../shared/models/teacher_profile.dart';
import '../../network/api_client.dart';
import '../repositories.dart';
import '../wire/wire_mappers.dart';

/// The teacher's professional profile over HTTP.
///
/// | verb   | path                                          | returns            |
/// |--------|-----------------------------------------------|--------------------|
/// | GET    | `/me/teacher-profile`                         | the profile        |
/// | POST   | `/me/teacher-profile`                         | the profile        |
/// | PATCH  | `/me/teacher-profile/name`                    | `{name, role}`     |
/// | POST   | `/me/teacher-profile/certificates/upload`     | an authorization   |
/// | POST   | `/me/teacher-profile/certificates`            | the profile        |
/// | PATCH  | `/me/teacher-profile/certificates/:id`        | the profile        |
/// | DELETE | `/me/teacher-profile/certificates/:id`        | the profile        |
/// | GET    | `/teacher-profiles/certificates/:id/download` | `{url}`            |
///
/// Every path is `/me/...`: the server derives the teacher from the session, so
/// there is no teacher id to send and none that could be tampered with. The
/// review endpoints are deliberately NOT called from this client -- a teacher
/// has no business reaching them, and the server refuses anyway.
///
/// The PHOTO is not here: it is the teacher's one account photo, set through
/// `/me/avatar` like everyone else's (`ProfilePhotoRepository`). The profile
/// only carries its link, as `photoUrl`.
///
/// ## Uploading a certificate
///
/// Three steps, because the row must not exist before the bytes do:
///
/// 1. ask for an authorization -- the server validates type and size and mints
///    the destination, returning an opaque token, the upload URL and the exact
///    headers storage signed;
/// 2. PUT the bytes to that URL with those headers and nothing else -- the URL
///    authorizes itself, so the session's token is never sent to it (in
///    production it is not our host);
/// 3. hand the token back, which creates the claim.
///
/// The token is passed through untouched. It is the server's object key and the
/// client never parses it, builds one, or stores it.
class HttpTeacherProfileRepository implements TeacherProfileRepository {
  HttpTeacherProfileRepository({
    required ApiClient client,
    Dio? uploader,
  })  : _client = client,
        _uploader = uploader ?? Dio();

  final ApiClient _client;

  /// Separate from [_client] on purpose: it carries no session -- see the class
  /// comment. A Dio rather than `AttachmentUploader` only for upload progress.
  final Dio _uploader;

  @override
  Future<TeacherProfile> myProfile() async {
    final response = await _client.get<Map<String, Object?>>('/me/teacher-profile');
    return WireMappers.teacherProfile(response.data ?? const {});
  }

  @override
  Future<TeacherProfile> saveProfile({
    String? bio,
    String? specialization,
    String? qualifications,
    String? experience,
    List<String> languages = const [],
  }) async {
    final response = await _client.post<Map<String, Object?>>(
      '/me/teacher-profile',
      data: {
        'bio': bio,
        'specialization': specialization,
        'qualifications': qualifications,
        'experience': experience,
        'languages': languages,
      },
    );
    return WireMappers.teacherProfile(response.data ?? const {});
  }

  @override
  Future<String> updateName(String name) async {
    final response = await _client.patch<Map<String, Object?>>(
      '/me/teacher-profile/name',
      data: {'name': name},
    );
    // The SERVER's name, not the one that was sent: it trims, collapses pasted
    // newlines and has the last word on what was stored. Returning the sent
    // string would be the local-only optimistic name this must not create.
    final stored = (response.data?['name'] as String?)?.trim();
    if (stored == null || stored.isEmpty) {
      throw const FormatException('the server returned no name');
    }
    return stored;
  }

  @override
  Future<TeacherProfile> addCertificate({
    required PendingCertificateFile file,
    required String title,
    String? issuingOrganization,
    DateTime? issuedOn,
    void Function(int sent, int total)? onProgress,
  }) async {
    final token = await _uploadBytes(
      authorizePath: '/me/teacher-profile/certificates/upload',
      filePath: file.filePath,
      mimeType: file.mimeType,
      byteSize: file.byteSize,
      onProgress: onProgress,
    );

    final response = await _client.post<Map<String, Object?>>(
      '/me/teacher-profile/certificates',
      data: {
        'title': title,
        'issuingOrganization': issuingOrganization,
        'issuedOn': issuedOn?.toIso8601String(),
        'mimeType': file.mimeType,
        'byteSize': file.byteSize,
        'uploadToken': token,
      },
    );
    return WireMappers.teacherProfile(response.data ?? const {});
  }

  @override
  Future<TeacherProfile> updateCertificate(
    String certificateId, {
    required String title,
    String? issuingOrganization,
    DateTime? issuedOn,
  }) async {
    // Metadata only. There is no field here for the file, so a rename cannot
    // become a substitution -- and no upload happens, so the bytes never move.
    final response = await _client.patch<Map<String, Object?>>(
      '/me/teacher-profile/certificates/$certificateId',
      data: {
        'title': title,
        'issuingOrganization': issuingOrganization,
        'issuedOn': issuedOn?.toIso8601String(),
      },
    );
    return WireMappers.teacherProfile(response.data ?? const {});
  }

  @override
  Future<TeacherProfile> removeCertificate(String certificateId) async {
    final response = await _client.delete<Map<String, Object?>>(
      '/me/teacher-profile/certificates/$certificateId',
    );
    return WireMappers.teacherProfile(response.data ?? const {});
  }

  @override
  Future<String> certificateUrl(String certificateId) async {
    // A fresh authorization every time. The URL is short-lived by design, so it
    // is fetched at the moment of opening and never cached.
    final response = await _client.get<Map<String, Object?>>(
      '/teacher-profiles/certificates/$certificateId/download',
    );
    final url = response.data?['url'] as String?;
    if (url == null || url.isEmpty) {
      throw const FormatException('no download url was returned');
    }
    return url;
  }

  /// Steps 1 and 2 of the upload.
  Future<String> _uploadBytes({
    required String authorizePath,
    required String filePath,
    required String mimeType,
    required int byteSize,
    void Function(int sent, int total)? onProgress,
  }) async {
    final authorization = await _client.post<Map<String, Object?>>(
      authorizePath,
      data: {'mimeType': mimeType, 'byteSize': byteSize},
    );
    final body = authorization.data ?? const {};
    final uploadUrl = body['uploadUrl'] as String?;
    final uploadToken = body['uploadToken'] as String?;
    if (uploadUrl == null || uploadToken == null) {
      throw const FormatException('upload authorization was incomplete');
    }

    // Exactly the headers storage signed: an S3 presigned PUT is refused if
    // they differ, and an `Authorization` header would be a second credential
    // it refuses too. Content-Type falls back to the declared type for a grant
    // that names none.
    final signed = <String, Object>{};
    final raw = body['headers'];
    if (raw is Map) {
      raw.forEach((key, value) {
        if (key is String && value is String) signed[key] = value;
      });
    }
    final hasType = signed.keys.any((k) => k.toLowerCase() == 'content-type');
    await _uploader.put<void>(
      uploadUrl,
      data: File(filePath).openRead(),
      options: Options(
        headers: {
          ...signed,
          if (!hasType) Headers.contentTypeHeader: mimeType,
          Headers.contentLengthHeader: byteSize,
        },
      ),
      onSendProgress: onProgress,
    );

    return uploadToken;
  }
}
