import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/logging/redacting_logger.dart';

void main() {
  group('RedactingLogger.redactText', () {
    test('removes bearer tokens', () {
      final out = RedactingLogger.redactText(
        'Authorization: Bearer abc123DEF456ghi789',
      );
      expect(out, isNot(contains('abc123DEF456ghi789')));
      expect(out, contains('[redacted]'));
    });

    test('removes JWTs appearing inline', () {
      const jwt =
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      final out = RedactingLogger.redactText('token=$jwt end');
      expect(out, isNot(contains('eyJhbGciOiJIUzI1NiJ9')));
      expect(out, contains('end'));
    });

    test('removes international phone numbers', () {
      final out = RedactingLogger.redactText('caller +20 100 123 4567 ringing');
      expect(out, isNot(contains('1001234567')));
      expect(out, isNot(contains('+20 100 123 4567')));
      expect(out, contains('ringing'));
    });

    test('removes local Egyptian mobile numbers', () {
      final out = RedactingLogger.redactText('contact 01001234567 today');
      expect(out, isNot(contains('01001234567')));
      expect(out, contains('today'));
    });

    test('removes e-mail addresses (LR-42)', () {
      final out = RedactingLogger.redactText('reset sent to parent.name+kids@mail.example.com ok');
      expect(out, isNot(contains('parent.name+kids')));
      expect(out, isNot(contains('@mail.example.com')));
      expect(out, contains('[redacted]'));
      expect(out, startsWith('reset sent to '));
      expect(out, endsWith(' ok'));
    });

    test('removes one-time codes named in free text (LR-42)', () {
      for (final input in [
        'otp=482913 accepted',
        'verification code: 4829 accepted',
        'Code 48291337 accepted',
      ]) {
        final out = RedactingLogger.redactText(input);
        expect(out, isNot(contains('4829')), reason: input);
        expect(out, contains('[redacted]'), reason: input);
        expect(out, endsWith(' accepted'), reason: input);
      }
    });

    test('keeps short status codes next to the word code', () {
      const input = 'request failed with code 404';
      expect(RedactingLogger.redactText(input), input);
    });

    test('leaves ordinary text and short numbers alone', () {
      const input = 'loaded 25 messages in 1200 ms';
      expect(RedactingLogger.redactText(input), input);
    });
  });

  group('RedactingLogger.redactMap', () {
    test('masks sensitive keys regardless of case', () {
      final out = RedactingLogger.redactMap({
        'access_token': 'super-secret',
        'Authorization': 'Bearer xyz',
        'PASSWORD': 'hunter2',
        'phone_number': '+201001234567',
        'conversation_id': 'conv_42',
      });

      expect(out['access_token'], '[redacted]');
      expect(out['Authorization'], '[redacted]');
      expect(out['PASSWORD'], '[redacted]');
      expect(out['phone_number'], '[redacted]');
      // Non-sensitive identifiers survive, or the logs would be useless.
      expect(out['conversation_id'], 'conv_42');
    });

    test('masks e-mail and one-time-code keys regardless of case (LR-42)', () {
      final out = RedactingLogger.redactMap({
        'email': 'parent@example.com',
        'Email_Address': 'teacher@example.org',
        'otp': '482913',
        'verificationCode': '4829',
        'one_time_code': 771204,
        'display_name': 'Amina',
      });

      expect(out['email'], '[redacted]');
      expect(out['Email_Address'], '[redacted]');
      expect(out['otp'], '[redacted]');
      expect(out['verificationCode'], '[redacted]');
      expect(out['one_time_code'], '[redacted]');
      // An ordinary value is untouched.
      expect(out['display_name'], 'Amina');
    });

    test('masks opaque auth, id and jwt token values by key (LR-75)', () {
      // Opaque values are not JWT-shaped, so only the key can protect them.
      final out = RedactingLogger.redactMap({
        'authToken': 'opaque-abc123',
        'auth_token': 'opaque-def456',
        'idToken': 'opaque-ghi789',
        'id_token': 'opaque-jkl012',
        'ID_TOKEN': 'opaque-mno345',
        'jwt': 'opaque-pqr678',
        'JWT': 'opaque-stu901',
        'nested': {'authToken': 'opaque-vwx234'},
        'request_id': 'req_7',
      });

      expect(out['authToken'], '[redacted]');
      expect(out['auth_token'], '[redacted]');
      expect(out['idToken'], '[redacted]');
      expect(out['id_token'], '[redacted]');
      expect(out['ID_TOKEN'], '[redacted]');
      expect(out['jwt'], '[redacted]');
      expect(out['JWT'], '[redacted]');
      expect((out['nested']! as Map<String, Object?>)['authToken'], '[redacted]');
      expect(out.toString(), isNot(contains('opaque-')));
      // An unrelated key is untouched.
      expect(out['request_id'], 'req_7');
    });

    test('masks jwt, session and credential keys, and header-style spellings (LR-75 review)', () {
      final out = RedactingLogger.redactMap({
        'jwtToken': 'opaque-1',
        'jwt_token': 'opaque-2',
        'sessionToken': 'opaque-3',
        'session_token': 'opaque-4',
        'credential': 'opaque-5',
        'credentials': 'opaque-6',
        'id-token': 'opaque-7',
        'X-Auth-Token': 'opaque-8',
        'request-id': 'req_9',
      });

      for (final key in ['jwtToken', 'jwt_token', 'sessionToken', 'session_token', 'credential', 'credentials', 'id-token', 'X-Auth-Token']) {
        expect(out[key], '[redacted]', reason: key);
      }
      expect(out.toString(), isNot(contains('opaque-')));
      expect(out['request-id'], 'req_9');
    });

    test('masks a code key only when it holds a one-time code (LR-42)', () {
      final out = RedactingLogger.redactMap({
        'code': '482 913',
        'nested': {'code': 48291337},
      });
      expect(out['code'], '[redacted]');
      expect((out['nested']! as Map<String, Object?>)['code'], '[redacted]');

      // Diagnostic codes stay readable, or the logs would be useless.
      expect(
        RedactingLogger.redactMap({'code': 'COMM.NOT_CONVERSATION_MEMBER'})['code'],
        'COMM.NOT_CONVERSATION_MEMBER',
      );
      expect(RedactingLogger.redactMap({'code': 404})['code'], 404);
      expect(RedactingLogger.redactMap({'code': -1200})['code'], -1200);
    });

    test('redacts an e-mail value under an innocuous key', () {
      final out = RedactingLogger.redactMap({'note': 'contact parent@example.com'});
      expect(out['note'], 'contact [redacted]');
    });

    test('masks message content so chat bodies never reach the log', () {
      final out = RedactingLogger.redactMap({'body': 'private family matter'});
      expect(out['body'], '[redacted]');
    });

    test('recurses into nested maps and lists', () {
      final out = RedactingLogger.redactMap({
        'session': {'refresh_token': 'nested-secret'},
        'devices': [
          {'push_token': 'device-secret', 'platform': 'android'},
        ],
      });

      final session = out['session']! as Map<String, Object?>;
      expect(session['refresh_token'], '[redacted]');

      final devices = out['devices']! as List<Object?>;
      final first = devices.first! as Map<String, Object?>;
      expect(first['push_token'], '[redacted]');
      expect(first['platform'], 'android');
    });

    test('redacts token-shaped values even under an innocuous key', () {
      final out = RedactingLogger.redactMap({'note': 'sent Bearer abc123def456'});
      expect(out['note'], isNot(contains('abc123def456')));
    });
  });
}
