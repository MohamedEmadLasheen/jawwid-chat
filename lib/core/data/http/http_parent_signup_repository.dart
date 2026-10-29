import '../../network/http_stack.dart';
import '../repositories.dart';

/// `ParentSignupRepository` over the public auth transport -- the one sign-in uses, which
/// carries no token and no refresh interceptor. A refusal reaches the caller as an AppError
/// with the server's code (`AUTH.SIGNUP_CODE_INVALID`, `AUTH.PASSWORD_TOO_WEAK`,
/// `COMMON.RATE_LIMITED`).
class HttpParentSignupRepository implements ParentSignupRepository {
  HttpParentSignupRepository({required AuthTransport transport}) : _transport = transport;

  final AuthTransport _transport;

  @override
  Future<void> requestCode(String email) async {
    await _transport.post<Object?>('/auth/signup/request', data: {'email': email.trim()});
  }

  @override
  Future<void> verify({required String email, required String code, required String password, int? lessonAudioNotice}) async {
    await _transport.post<Object?>('/auth/signup/verify', data: {
      'email': email.trim(),
      'code': code.trim(),
      'password': password,
      'lessonAudioNotice': ?lessonAudioNotice,
    });
  }
}
