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
