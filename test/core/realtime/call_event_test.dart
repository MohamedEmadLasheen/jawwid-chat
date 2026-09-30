/// The event decoder, against the contract it mirrors.
///
/// The payloads below are copied from
/// `apps/api/src/communication/contracts/events.ts` — `CallPayload`,
/// `CallParticipantPayload`, `CallEndedPayload`. If the server changes one of
/// them, this file should fail before a screen does.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/data/repositories.dart' show CallOutcome;
import 'package:jawwid_chat/core/realtime/call_event.dart';

const _callId = '11111111-1111-1111-1111-111111111111';
const _conversationId = '22222222-2222-2222-2222-222222222222';
const _actorId = '33333333-3333-3333-3333-333333333333';

Map<String, Object?> _incoming({Map<String, Object?> overrides = const {}}) => {
      'callId': _callId,
      'conversationId': _conversationId,
      'type': 'direct',
      'initiatorId': _actorId,
      'initiatorName': 'teacher_t',
      ...overrides,
    };

Map<String, Object?> _participant({Map<String, Object?> overrides = const {}}) => {
      'callId': _callId,
      'conversationId': _conversationId,
      'actorId': _actorId,
      ...overrides,
    };

Map<String, Object?> _ended({Map<String, Object?> overrides = const {}}) => {
      'callId': _callId,
      'conversationId': _conversationId,
      'outcome': 'answered',
      'durationSeconds': 42,
      ...overrides,
    };

void main() {
  group('the four events decode', () {
    test('call.incoming', () {
      final event = decodeCallEvent(CallEventNames.incoming, _incoming());

      expect(event, isA<CallIncoming>());
      final incoming = event! as CallIncoming;
      expect(incoming.callId, _callId);
      expect(incoming.conversationId, _conversationId);
      expect(incoming.isGroup, isFalse);
      expect(incoming.initiatorId, _actorId);
      expect(incoming.initiatorName, 'teacher_t');
    });

    test('call.incoming carries the group flag', () {
      final event = decodeCallEvent(
        CallEventNames.incoming,
        _incoming(overrides: {'type': 'group'}),
      );
      expect((event! as CallIncoming).isGroup, isTrue);
    });

    test('call.accepted', () {
      final event = decodeCallEvent(CallEventNames.accepted, _participant());

      expect(event, isA<CallAccepted>());
      final accepted = event! as CallAccepted;
      expect(accepted.callId, _callId);
      expect(accepted.conversationId, _conversationId);
      expect(accepted.actorId, _actorId);
    });

    test('call.declined', () {
      final event = decodeCallEvent(CallEventNames.declined, _participant());

      expect(event, isA<CallDeclined>());
      expect((event! as CallDeclined).actorId, _actorId);
    });

    test('call.ended', () {
      final event = decodeCallEvent(CallEventNames.ended, _ended());

      expect(event, isA<CallEnded>());
      final ended = event! as CallEnded;
      expect(ended.outcome, CallOutcome.answered);
      expect(ended.duration, const Duration(seconds: 42));
    });

    test('call.ended accepts every outcome the contract defines', () {
      for (final (wire, expected) in <(String, CallOutcome)>[
        ('answered', CallOutcome.answered),
        ('missed', CallOutcome.missed),
        ('declined', CallOutcome.declined),
      ]) {
        final event = decodeCallEvent(
          CallEventNames.ended,
          _ended(overrides: {'outcome': wire}),
        );
        expect((event! as CallEnded).outcome, expected, reason: wire);
      }
    });

    test('call.ended keeps a null duration null, rather than calling it zero', () {
      // `durationSeconds: number | null`. A missed call has no duration, and
      // reporting one of zero would be a claim the server did not make.
      final explicitNull = decodeCallEvent(
        CallEventNames.ended,
        _ended(overrides: {'outcome': 'missed', 'durationSeconds': null}),
      );
      expect((explicitNull! as CallEnded).duration, isNull);

      final absent = decodeCallEvent(CallEventNames.ended, {
        'callId': _callId,
        'conversationId': _conversationId,
        'outcome': 'missed',
      });
      expect((absent! as CallEnded).duration, isNull);
    });
  });

  group('malformed payloads fail closed', () {
    test('a payload that is not a map is rejected', () {
      for (final payload in <Object?>[null, 'string', 42, <String>['a']]) {
        expect(
          () => decodeCallEvent(CallEventNames.accepted, payload),
          throwsA(isA<CallEventFormatException>()),
          reason: '$payload',
        );
      }
    });

    test('every required field of call.incoming is required', () {
      for (final field in [
        'callId',
        'conversationId',
        'type',
        'initiatorId',
        'initiatorName',
      ]) {
        final payload = _incoming()..remove(field);
        expect(
          () => decodeCallEvent(CallEventNames.incoming, payload),
          throwsA(
            isA<CallEventFormatException>()
                .having((e) => e.field, 'field', field),
          ),
          reason: field,
        );
      }
    });

    test('conversationId is required — it is the routing field', () {
      // An event without one could not have been routed to this client, so its
      // presence is not decoration.
      for (final name in [
        CallEventNames.accepted,
        CallEventNames.declined,
      ]) {
        expect(
          () => decodeCallEvent(name, _participant()..remove('conversationId')),
          throwsA(isA<CallEventFormatException>()),
          reason: name,
        );
      }
      expect(
        () => decodeCallEvent(
          CallEventNames.ended,
          _ended()..remove('conversationId'),
        ),
        throwsA(isA<CallEventFormatException>()),
      );
    });

    test('an empty string is not a valid id', () {
      expect(
        () => decodeCallEvent(
          CallEventNames.accepted,
          _participant(overrides: {'actorId': ''}),
        ),
        throwsA(isA<CallEventFormatException>()),
      );
    });

    test('a non-string id is rejected rather than coerced', () {
      expect(
        () => decodeCallEvent(
          CallEventNames.accepted,
          _participant(overrides: {'actorId': 12345}),
        ),
        throwsA(isA<CallEventFormatException>()),
      );
    });

    test('an unknown call type is rejected', () {
      // `video` is the one that matters: the product has no video calling
      // (G-32) and a client that quietly accepted the word would be the first
      // place that stopped being true.
      for (final type in ['video', 'DIRECT', '', 'conference']) {
        expect(
          () => decodeCallEvent(
            CallEventNames.incoming,
            _incoming(overrides: {'type': type}),
          ),
          throwsA(isA<CallEventFormatException>()),
          reason: type,
        );
      }
    });

    test('an unknown outcome is rejected', () {
      for (final outcome in ['answered_late', 'ANSWERED', 'busy', '']) {
        expect(
          () => decodeCallEvent(
            CallEventNames.ended,
            _ended(overrides: {'outcome': outcome}),
          ),
          throwsA(isA<CallEventFormatException>()),
          reason: outcome,
        );
      }
    });

    test('a duration that is not a non-negative integer is rejected', () {
      for (final value in <Object>['42', 42.5, -1]) {
        expect(
          () => decodeCallEvent(
            CallEventNames.ended,
            _ended(overrides: {'durationSeconds': value}),
          ),
          throwsA(isA<CallEventFormatException>()),
          reason: '$value',
        );
      }
    });

    test('the exception names the event and field, never the payload', () {
      // A malformed frame is exactly what gets pasted into a bug report.
      try {
        decodeCallEvent(
          CallEventNames.incoming,
          _incoming(overrides: {'initiatorName': ''}),
        );
        fail('expected a CallEventFormatException');
      } on CallEventFormatException catch (error) {
        expect(error.toString(), contains('call.incoming'));
        expect(error.toString(), contains('initiatorName'));
        expect(error.toString(), isNot(contains(_callId)));
        expect(error.toString(), isNot(contains(_actorId)));
      }
    });
  });

  group('events this client does not handle', () {
    test('a non-call event decodes to null rather than throwing', () {
      for (final name in [
        'message.created',
        'typing.started',
        'presence.changed',
        'notification.created',
      ]) {
        expect(decodeCallEvent(name, const {}), isNull, reason: name);
      }
    });

    test('call.participant_joined is NOT handled here', () {
      // It is declared server-side and emitted by nothing: only something that
      // has observed media presence may emit it, and that is a LiveKit webhook
      // which does not exist. W2 must not invent it, and must not let
      // call.accepted stand in for it.
      expect(
        decodeCallEvent('call.participant_joined', _participant()),
        isNull,
      );
      expect(decodeCallEvent('call.participant_left', _participant()), isNull);
    });

    test('an unknown call-shaped name does not crash the decoder', () {
      expect(decodeCallEvent('call.something_new', _participant()), isNull);
    });
  });
}
