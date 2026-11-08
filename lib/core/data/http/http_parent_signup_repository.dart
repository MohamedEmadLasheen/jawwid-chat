import '../../../shared/models/legal.dart';
import '../../errors/app_error.dart';
import '../../network/http_stack.dart';
import '../repositories.dart';

/// `ParentSignupRepository` over the public auth transport -- the one sign-in uses, which
/// carries no token and no refresh interceptor. A refusal reaches the caller as an AppError
/// with the server's code (`AUTH.SIGNUP_CODE_INVALID`, `AUTH.PASSWORD_TOO_WEAK`,
/// `COMMON.RATE_LIMITED`; PD-58: `COMM.LEGAL_REQUIRED`, `COMM.LEGAL_WRONG_DOCUMENTS`,
/// `COMM.LEGAL_VERSION_STALE`, `COMM.LEGAL_NOT_CONFIGURED`).
class HttpParentSignupRepository implements ParentSignupRepository {
  HttpParentSignupRepository({required AuthTransport transport}) : _transport = transport;

  final AuthTransport _transport;

  @override
  Future<void> requestCode(String email) async {
    await _transport.post<Object?>('/auth/signup/request', data: {'email': email.trim()});
  }

  @override
  Future<List<LegalDocument>?> signupLegal() async {
    final Map<String, Object?>? body;
    try {
      body = (await _transport.get<Map<String, Object?>>('/auth/signup/legal')).data;
    } on AppError catch (error) {
      // The route does not exist on the API before ENG-10: no legal step at all. Every
      // other refusal (503 LEGAL_NOT_CONFIGURED above all) is the caller's to fail closed on.
      if (error.kind == AppErrorKind.notFound) return null;
      rethrow;
    }
    final required = LegalDocument.listFromWire(body?['required']);
    if (required == null) {
      throw const AppError(AppErrorKind.server, debugDetail: 'GET /auth/signup/legal: unreadable required list');
    }
    return required;
  }

  @override
  Future<void> verify({
    required String email,
    required String code,
    required String password,
    int? lessonAudioNotice,
    List<LegalDocument>? acceptLegal,
    String? client,
    String? locale,
  }) async {
    await _transport.post<Object?>('/auth/signup/verify', data: {
      'email': email.trim(),
      'code': code.trim(),
      'password': password,
      'lessonAudioNotice': ?lessonAudioNotice,
      // PD-58: only with the documents themselves; the API before ENG-10 gets none of it.
      if (acceptLegal != null) ...{
        'acceptLegal': [for (final d in acceptLegal) d.toAcceptance()],
        'client': ?client,
        'locale': ?locale,
      },
    });
  }
}
