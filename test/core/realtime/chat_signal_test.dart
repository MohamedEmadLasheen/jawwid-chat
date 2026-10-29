import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/realtime/chat_signal.dart';

/// The chat events the server emits are SIGNALS: which conversation changed.
/// These pin the decoding the realtime client routes on.
void main() {
  const conv = '11111111-1111-1111-1111-111111111111';

  test('message.created decodes its conversation and server seq (sent as a string)', () {
    final s = decodeChatSignal('message.created', {
      'conversationId': conv,
      'messageId': 'm1',
      'seq': '42',
      'authorId': 'a',
    })!;
    expect(s.kind, ChatSignalKind.messageCreated);
    expect(s.conversationId, conv);
    expect(s.seq, 42);
  });

  test('changes to an existing message all decode as messageChanged', () {
    for (final event in [
      'message.deleted',
      'message.updated',
      'reaction.added',
      'reaction.removed',
      'approval.decided',
    ]) {
      expect(
        decodeChatSignal(event, {'conversationId': conv, 'messageId': 'm1'})?.kind,
        ChatSignalKind.messageChanged,
        reason: event,
      );
    }
  });

  test('membership_changed and conversation.added both mean "re-read the list"', () {
    expect(
      decodeChatSignal('conversation.membership_changed', {'conversationId': conv})?.kind,
      ChatSignalKind.membershipChanged,
    );
    expect(
      decodeChatSignal('conversation.added', {'conversationId': conv})?.kind,
      ChatSignalKind.membershipChanged,
    );
  });

  test('access_revoked and conversation.updated decode', () {
    expect(
      decodeChatSignal('conversation.access_revoked', {'conversationId': conv})?.kind,
      ChatSignalKind.accessRevoked,
    );
    expect(
      decodeChatSignal('conversation.updated', {'conversationId': conv})?.kind,
      ChatSignalKind.conversationUpdated,
    );
  });

  test('a call event, typing, or an unknown frame is not a chat signal', () {
    for (final event in ['call.incoming', 'typing.started', 'presence.changed', 'nonsense']) {
      expect(decodeChatSignal(event, {'conversationId': conv}), isNull, reason: event);
    }
  });

  test('a chat event that names no conversation is dropped, never guessed at', () {
    expect(decodeChatSignal('message.created', {'messageId': 'm1'}), isNull);
    expect(decodeChatSignal('message.created', {'conversationId': ''}), isNull);
    expect(decodeChatSignal('message.created', 'not a map'), isNull);
    expect(decodeChatSignal('message.created', null), isNull);
  });

  test('PD-50: message.updated carries the changed message\'s seq; other changes carry none', () {
    final s = decodeChatSignal('message.updated', {'conversationId': conv, 'messageId': 'm1', 'seq': '17'})!;
    expect(s.kind, ChatSignalKind.messageChanged);
    expect(s.seq, 17);
    expect(decodeChatSignal('message.updated', {'conversationId': conv, 'messageId': 'm1'})!.seq, isNull);
    for (final event in ['message.deleted', 'reaction.added', 'approval.decided', 'conversation.updated']) {
      expect(decodeChatSignal(event, {'conversationId': conv, 'seq': '17'})!.seq, isNull, reason: event);
    }
  });

  test('a malformed seq is not invented: it decodes as null', () {
    final s = decodeChatSignal('message.created', {'conversationId': conv, 'seq': 'x'})!;
    expect(s.seq, isNull);
  });
}
