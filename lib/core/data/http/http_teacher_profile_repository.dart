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
/// | GET    | `/me/teacher-profile`                         | `{published,draft}`|
/// | POST   | `/me/teacher-profile`                         | the same           |
/// | POST   | `/me/teacher-profile/submit`                  | the same           |
/// | POST   | `/me/teacher-profile/certificates/upload`     | an authorization   |
/// | POST   | `/me/teacher-profile/certificates`            | the same profile   |
/// | PATCH  | `/me/teacher-profile/certificates/:id`        | the same profile   |
/// | DELETE | `/me/teacher-profile/certificates/:id`        | the same profile   |
/// | GET    | `/teacher-profiles/certificates/:id/download` | `{url}`            |
///
/// Every path is `/me/...`: the server derives the teacher from the session, so
/// there is no teacher id to send and none that could be tampered with. The
/// review endpoints (`/teacher-profiles/review/...`) are deliberately NOT called
/// from this client — a teacher has no business reaching them, and the server
/// refuses anyway.
///
/// ## Uploading
///
/// Three steps, because the row must not exist before the bytes do:
///
/// 1. ask for an authorization — the server mints the destination and returns an
///    opaque token;
/// 2. PUT the bytes to the returned URL, on a bare Dio with no auth
///    interceptor: that URL is already a capability, and attaching the session
///    bearer to a storage host would hand it a token it has no use for;
/// 3. hand the token back, which creates the claim.
///
/// The token is passed through untouched. It is the server's object key and the
/// client never parses it, builds one, or stores it.
class HttpTeacherProfileRepository implements TeacherProfileRepository {
  HttpTeacherProfileRepository({required ApiClient client, Dio? uploader})
      : _client = client,
        _uploader = uploader ?? Dio();

  final ApiClient _client;

  /// Separate from [_client] on purpose — see the class comment.
  final Dio _uploader;

  @override
  Future<TeacherProfile> myProfile() async {
    final response = await _client.get<Map<String, Object?>>('/me/teacher-profile');
    return WireMappers.teacherProfile(response.data ?? const {});
  }

  @override
  Future<TeacherProfile> saveDraft({
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
  Future<TeacherProfile> submit() async {
    final response =
        await _client.post<Map<String, Object?>>('/me/teacher-profile/submit');
    return WireMappers.teacherProfile(response.data ?? const {});
  }

  @override
  Future<TeacherProfile> addCertificate({
    required PendingCertificateFile file,
    required String title,
    String? issuingOrganization,
    DateTime? issuedOn,
    void Function(int sent, int total)? onProgress,
  }) async {
    // 1. Authorize. The server validates type and size here, before any bytes
    //    move, so an oversized file is refused in one round trip rather than
    //    after an upload.
    final authorization = await _client.post<Map<String, Object?>>(
      '/me/teacher-profile/certificates/upload',
      data: {'mimeType': file.mimeType, 'byteSize': file.byteSize},
    );
    final body = authorization.data ?? const {};
    final uploadUrl = body['uploadUrl'] as String?;
    final uploadToken = body['uploadToken'] as String?;
    if (uploadUrl == null || uploadToken == null) {
      throw const FormatException('upload authorization was incomplete');
    }

    // 2. The bytes.
    await _uploader.put<void>(
      uploadUrl,
      data: File(file.filePath).openRead(),
      options: Options(
        headers: {
          Headers.contentTypeHeader: file.mimeType,
          Headers.contentLengthHeader: file.byteSize,
        },
      ),
      onSendProgress: onProgress,
    );

    // 3. The claim.
    final response = await _client.post<Map<String, Object?>>(
      '/me/teacher-profile/certificates',
      data: {
        'title': title,
        'issuingOrganization': issuingOrganization,
        'issuedOn': issuedOn?.toIso8601String(),
        'mimeType': file.mimeType,
        'byteSize': file.byteSize,
        'uploadToken': uploadToken,
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
    // become a substitution.
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
}
