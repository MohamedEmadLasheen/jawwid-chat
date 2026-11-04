// PD-56 (store compliance, S-07): crash reporting sends no personal data, and nothing at
// all outside a release build with a DSN.
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/core/crash/crash_reporting.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

void main() {
  test('off in a test (debug) build without a DSN: the app runs as before, no observers', () async {
    expect(crashReportingEnabled, isFalse);
    var ran = false;
    await runWithCrashReporting(() => ran = true);
    expect(ran, isTrue);
    expect(crashReportingObservers(), isEmpty);
    setCrashReportingActor('actor-1'); // a no-op, never a throw
  });

  test('the person is a hash of the actor id, stable, and never the id', () {
    final h = actorHash('0a4b5e2c-1111-4c2a-9c33-aaaaaaaaaaaa');
    expect(h, matches(RegExp(r'^[0-9a-f]{64}$')));
    expect(h, actorHash('0a4b5e2c-1111-4c2a-9c33-aaaaaaaaaaaa'));
    expect(h, isNot(contains('0a4b5e2c')));
  });

  test('e-mails, phone numbers and quoted text are replaced', () {
    expect(scrubText('send to ahmad.k@example.org failed'), 'send to [email] failed');
    expect(scrubText('call +20 100 123 4567 dropped'), 'call [phone] dropped');
    expect(scrubText('bad input "As-salamu alaykum, teacher"'), 'bad input "[text]"');
    expect(scrubText('«مرحبا يا أستاذ»'), '«[text]»');
    expect(scrubText('RangeError: index 3 out of 0..2'), 'RangeError: index 3 out of 0..2');
  });

  test('a report keeps the stack and navigation; the person, the request, extras and the device name go', () {
    final event = SentryEvent(
      message: SentryMessage('could not send "hello there" to a@b.co', template: 'to %s', params: ['a@b.co']),
      exceptions: [SentryException(type: 'StateError', value: 'reply to +201001234567 failed')],
      user: SentryUser(id: 'hash-1', email: 'a@b.co', name: 'Ahmad', ipAddress: '10.0.0.1'),
      request: SentryRequest(url: 'https://api.example.org/me?email=a@b.co'),
      breadcrumbs: [
        Breadcrumb(category: 'navigation', data: {'from': '/chats', 'to': '/chats/c1', 'arguments': 'Ahmad'}),
        Breadcrumb(category: 'ui.click', message: 'tapped "Send"'),
        Breadcrumb(category: 'http', data: {'url': 'https://api.example.org/messages'}),
      ],
      contexts: Contexts(device: SentryDevice(name: "Ahmad's iPhone", model: 'iPhone15,2')),
    );
    final out = scrubEvent(event);
    expect(out.user!.id, 'hash-1');
    expect([out.user!.email, out.user!.name, out.user!.ipAddress], [null, null, null]);
    expect(out.request, isNull);
    expect(out.contexts.device!.name, isNull);
    expect(out.contexts.device!.model, 'iPhone15,2');
    expect(out.message!.formatted, 'could not send "[text]" to [email]');
    expect(out.message!.params, isNull);
    expect(out.exceptions!.single.value, 'reply to [phone] failed');
    expect(out.breadcrumbs!.map((c) => c.category), ['navigation']);
    expect(out.breadcrumbs!.single.data, {'from': '/chats', 'to': '/chats/c1'});
  });

  test('only navigation breadcrumbs are kept as they happen', () {
    expect(keepNavigationOnly(Breadcrumb(category: 'ui.click'), Hint()), isNull);
    expect(keepNavigationOnly(Breadcrumb(category: 'console', message: 'a@b.co'), Hint()), isNull);
    expect(keepNavigationOnly(Breadcrumb(category: 'navigation', data: {'to': '/settings'}), Hint())!.data, {'to': '/settings'});
  });
}
