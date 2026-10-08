import 'dart:io';

import 'package:dio/dio.dart';

import '../../../shared/models/teacher_profile.dart';
import '../../../shared/utils/signed_url.dart';
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
/// | POST   | `/me/teacher-profile/photo/upload`            | an authorization   |
/// | POST   | `/me/teacher-profile/photo`                   | the profile        |
/// | DELETE | `/me/teacher-profile/photo`                   | the profile        |
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
/// ## Uploading
///
/// Three steps, the same for a photo and for a certificate, because the row
/// must not exist before the bytes do:
///
/// 1. ask for an authorization -- the server validates type and size and mints
///    the destination, returning an opaque token;
/// 2. PUT the bytes to the returned URL, carrying the session's Authorization
///    header. The signature authorizes the OBJECT; the header authenticates the
///    CALLER, and the storage route requires both. An earlier version of this
///    client sent no header, reasoning that a signed URL is already a
///    capability -- QA proved that wrong against the reference storage, which
///    returns 401. The URL itself is used exactly as the server returned it:
///    no credential is ever appended to it;
/// 3. hand the token back, which creates the claim.
///
/// The token is passed through untouched. It is the server's object key and the
/// client never parses it, builds one, or stores it.
class HttpTeacherProfileRepository implements TeacherProfileRepository {
  HttpTeacherProfileRepository({
    required ApiClient client,
    required TokenProvider tokens,
    Dio? uploader,
  })  : _client = client,
        _tokens = tokens,
        _uploader = uploader ?? Dio();

  final ApiClient _client;

  /// The SAME [TokenProvider] the authenticated client uses — the session's one
  /// and only, because refresh rotation revokes account-wide and a second
  /// provider would race the first. Read per upload, never stored here.
  final TokenProvider _tokens;

  /// Separate from [_client] on purpose — see the class comment.
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
  Future<TeacherProfile> setPhoto({
    required PendingPhotoFile file,
    void Function(int sent, int total)? onProgress,
  }) async {
    final token = await _uploadBytes(
      authorizePath: '/me/teacher-profile/photo/upload',
      filePath: file.filePath,
      mimeType: file.mimeType,
      byteSize: file.byteSize,
      onProgress: onProgress,
    );

    final response = await _client.post<Map<String, Object?>>(
      '/me/teacher-profile/photo',
      data: {
        'uploadToken': token,
        'mimeType': file.mimeType,
        'byteSize': file.byteSize,
      },
    );
    return WireMappers.teacherProfile(response.data ?? const {});
  }

  @override
  Future<TeacherProfile> removePhoto() async {
    final response =
        await _client.delete<Map<String, Object?>>('/me/teacher-profile/photo');
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

  /// Steps 1 and 2 of the upload, shared by the photo and the certificate.
  ///
  /// Shared deliberately: these two steps are where the security properties
  /// live -- the credential travels in a header and nowhere else, and the URL is
  /// used verbatim -- and two copies of that is one copy that can drift.
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

    // A presigned URL is ALREADY a complete authentication: the credential, the
    // signature and their scope travel in the query string, and S3 -- MinIO
    // included -- refuses a request that also carries an `Authorization`
    // header, with "request has multiple authentication types, please use one".
    // The reference storage is the exact opposite: its route is not `@Public()`
    // and answers 401 without the session header (03051fe). So the two backends
    // want opposite things, and the URL the server just handed us is the only
    // thing that says which one this is. Read from the URL rather than from
    // configuration, which this client never sees.
    //
    // The token is read at the moment of upload and not retained: holding one
    // for a feature would outlive the refresh that rotates it. For a presigned
    // URL it is not read at all -- there is nothing to authenticate with it.
    final token =
        urlAuthenticatesItself(uploadUrl) ? null : await _tokens.accessToken();
    await _uploader.put<void>(
      uploadUrl,
      data: File(filePath).openRead(),
      options: Options(
        headers: {
          Headers.contentTypeHeader: mimeType,
          Headers.contentLengthHeader: byteSize,
          // Never in the URL, the query string or the object key.
          if (token != null) 'Authorization': 'Bearer $token',
        },
      ),
      onSendProgress: onProgress,
    );

    return uploadToken;
  }
}
