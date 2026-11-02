import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/app/retry_policy.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/features/messages/presentation/chat_screen_route.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';

/// PARENT-013: a chat's look (`viewerState.theme`) is kept on the server for the
/// ACCOUNT. The route's conversation used to be cached for the life of the app, so
/// after signing out and back in the chat reopened with the look it had when first
/// opened -- this session's choice rightly dropped, the server's never read again.
/// It now belongs to the signed-in person: dropped when they change, read afresh.
void main() {
  test('signed out and back in, the chat reads the look the account keeps on the server', () async {
    final who = NotifierProvider<_PrincipalHolder, String?>(_PrincipalHolder.new);
    final server = _ThemeServer();
    final c = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        conversationRepositoryProvider.overrideWithValue(server),
        principalIdProvider.overrideWith((ref) => ref.watch(who)),
      ],
    );
    addTearDown(c.dispose);

    c.read(who.notifier).set(server.reader = 'parentA');
    final sub = c.listen(conversationRouteProvider('family-group'), (_, _) {});
    addTearDown(sub.close);
    expect((await c.read(conversationRouteProvider('family-group').future)).themeKey, isNull);

    // Rose is chosen (the sheet saves it on the server), then the parent signs out and in.
    server.themes['parentA'] = 'rose';
    c.read(who.notifier).set(server.reader = null);
    await _drain();
    c.read(who.notifier).set(server.reader = 'parentA');
    await _drain();

    expect((await c.read(conversationRouteProvider('family-group').future)).themeKey, 'rose');
    expect(server.reads.last, 'parentA');
  });

  test('another account on the same device reads its own look, never the previous one\'s', () async {
    final who = NotifierProvider<_PrincipalHolder, String?>(_PrincipalHolder.new);
    final server = _ThemeServer()
      ..themes['parentA'] = 'rose'
      ..themes['teacherA'] = 'mint';
    final c = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        conversationRepositoryProvider.overrideWithValue(server),
        principalIdProvider.overrideWith((ref) => ref.watch(who)),
      ],
    );
    addTearDown(c.dispose);

    c.read(who.notifier).set(server.reader = 'parentA');
    final sub = c.listen(conversationRouteProvider('student-group'), (_, _) {});
    addTearDown(sub.close);
    expect((await c.read(conversationRouteProvider('student-group').future)).themeKey, 'rose');

    c.read(who.notifier).set(server.reader = 'teacherA');
    await _drain();
    expect((await c.read(conversationRouteProvider('student-group').future)).themeKey, 'mint');
    expect(server.reads, ['parentA', 'teacherA']);
  });

  test('within one session the chat is not read again', () async {
    final who = NotifierProvider<_PrincipalHolder, String?>(_PrincipalHolder.new);
    final server = _ThemeServer();
    final c = ProviderContainer(
      retry: JawwidRetryPolicy.policy,
      overrides: [
        conversationRepositoryProvider.overrideWithValue(server),
        principalIdProvider.overrideWith((ref) => ref.watch(who)),
      ],
    );
    addTearDown(c.dispose);
    c.read(who.notifier).set(server.reader = 'parentA');
    final sub = c.listen(conversationRouteProvider('family-group'), (_, _) {});
    addTearDown(sub.close);
    await c.read(conversationRouteProvider('family-group').future);
    await c.read(conversationRouteProvider('family-group').future);
    expect(server.reads, ['parentA']);
  });
}

Future<void> _drain() => Future<void>.delayed(Duration.zero);

class _PrincipalHolder extends Notifier<String?> {
  @override
  String? build() => null;

  void set(String? value) => state = value;
}

/// Answers `byId` as the server does: the conversation with the CURRENT reader's own look.
class _ThemeServer implements ConversationRepository {
  final themes = <String, String?>{};
  final reads = <String?>[];
  String? reader;

  @override
  Future<Conversation> byId(String conversationId) async {
    reads.add(reader);
    return Conversation(
      id: conversationId,
      kind: ConversationKind.adminDirect,
      title: 'Family group',
      updatedAt: DateTime.utc(2026, 11, 2),
      themeKey: themes[reader],
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
