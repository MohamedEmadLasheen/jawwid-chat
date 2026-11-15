/// LR-74: one microphone question at a time.
///
/// `record_android` keeps one pending permission result and Android answers a
/// second concurrent request with an empty (denied) result, so two callers
/// asking at once must share ONE platform question.
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/call_media/microphone_permission.dart';

class _PromptingMic implements MicrophonePermission {
  int calls = 0;
  Completer<MicrophoneAccess> prompt = Completer<MicrophoneAccess>();

  @override
  Future<MicrophoneAccess> ensure() {
    calls++;
    return prompt.future;
  }
}

void main() {
  test('two askers while the prompt is open share one platform question and one answer', () async {
    final inner = _PromptingMic();
    final shared = SharedMicrophonePermission(inner);

    final first = shared.ensure();
    final second = shared.ensure();
    expect(inner.calls, 1);

    inner.prompt.complete(MicrophoneAccess.granted);
    expect(await first, MicrophoneAccess.granted);
    expect(await second, MicrophoneAccess.granted);
  });

  test('a denial is shared too -- nobody is prompted a second time for it', () async {
    final inner = _PromptingMic();
    final shared = SharedMicrophonePermission(inner);

    final first = shared.ensure();
    final second = shared.ensure();
    inner.prompt.complete(MicrophoneAccess.denied);

    expect(await first, MicrophoneAccess.denied);
    expect(await second, MicrophoneAccess.denied);
    expect(inner.calls, 1);
  });

  test('once answered, the next ask asks again (a grant is never cached)', () async {
    final inner = _PromptingMic();
    final shared = SharedMicrophonePermission(inner);

    final first = shared.ensure();
    inner.prompt.complete(MicrophoneAccess.granted);
    await first;
    await Future<void>.delayed(Duration.zero);

    inner.prompt = Completer<MicrophoneAccess>();
    final again = shared.ensure();
    expect(inner.calls, 2);
    inner.prompt.complete(MicrophoneAccess.denied);
    expect(await again, MicrophoneAccess.denied);
  });

  test('an error reaches every asker and does not wedge the next question', () async {
    final inner = _PromptingMic();
    final shared = SharedMicrophonePermission(inner);

    final first = shared.ensure();
    final second = shared.ensure();
    inner.prompt.completeError(StateError('platform'));
    await expectLater(first, throwsStateError);
    await expectLater(second, throwsStateError);
    await Future<void>.delayed(Duration.zero);

    inner.prompt = Completer<MicrophoneAccess>()..complete(MicrophoneAccess.granted);
    expect(await shared.ensure(), MicrophoneAccess.granted);
    expect(inner.calls, 2);
  });
}
