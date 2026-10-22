import '../../network/http_stack.dart';
import '../repositories.dart';

/// `PasswordResetRepository` over the public auth transport -- the one sign-in uses, which
/// carries no token and no refresh interceptor.
class HttpPasswordResetRepository implements PasswordResetRepository {
  HttpPasswordResetRepository({required AuthTransport transport}) : _transport = transport;

  final AuthTransport _transport;

  @override
  Future<void> complete({required String username, required String code, required String password}) async {
    await _transport.post<Object?>('/auth/password-reset', data: {
      'username': username.trim(),
      'code': code.trim(),
      'password': password,
    });
  }
}
