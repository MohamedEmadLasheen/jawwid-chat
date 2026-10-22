import '../../network/http_stack.dart';
import '../repositories.dart';

/// `AccountRecoveryRepository` over the public auth transport -- the one sign-in uses, which
/// carries no token and no refresh interceptor.
class HttpAccountRecoveryRepository implements AccountRecoveryRepository {
  HttpAccountRecoveryRepository({required AuthTransport transport}) : _transport = transport;

  final AuthTransport _transport;

  @override
  Future<RecoveryOptions> options() async {
    final json = (await _transport.get<Map<String, dynamic>>('/auth/recovery/options')).data ?? const {};
    return RecoveryOptions(
      email: json['email'] == true,
      whatsapp: json['whatsapp'] == true,
      codeMinutes: json['codeMinutes'] is int ? json['codeMinutes'] as int : 10,
    );
  }

  @override
  Future<void> requestPasswordCode(String email) async {
    await _transport.post<Object?>('/auth/recovery/password', data: {'email': email.trim()});
  }

  @override
  Future<void> requestEmailCode(String phone) async {
    await _transport.post<Object?>('/auth/recovery/email', data: {'phone': phone.trim()});
  }

  @override
  Future<List<String>> verifyEmailCode({required String phone, required String code}) async {
    final json = (await _transport.post<Map<String, dynamic>>(
          '/auth/recovery/email/verify',
          data: {'phone': phone.trim(), 'code': code.trim()},
        ))
            .data ??
        const {};
    final emails = json['emails'];
    return emails is List ? emails.whereType<String>().toList() : const [];
  }
}
