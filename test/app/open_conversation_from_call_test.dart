import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:jawwid_chat/app/router.dart';

/// "Message" / "Record voice message" leave the call screen for its
/// conversation. The stack must come out right: the call route gone, the chat
/// on top exactly once, and `?voice=1` carried only when recording was asked.
void main() {
  late List<String> built;

  GoRouter router(String initial) {
    built = [];
    return GoRouter(
      initialLocation: initial,
      routes: [
        GoRoute(path: '/calls', builder: (_, _) => const Text('calls tab')),
        GoRoute(
          path: '/chats/:id',
          builder: (_, state) {
            built.add(state.uri.toString());
            return Text(
              'chat ${state.pathParameters['id']} '
              'voice=${state.uri.queryParameters['voice'] == '1'}',
            );
          },
        ),
        GoRoute(
          path: Routes.activeCall,
          builder: (_, _) => const Text('call screen'),
        ),
      ],
    );
  }

  Future<GoRouter> callOver(WidgetTester tester, String underneath) async {
    final r = router(underneath);
    await tester.pumpWidget(MaterialApp.router(routerConfig: r));
    unawaited(r.push(Routes.activeCall));
    await tester.pumpAndSettle();
    expect(find.text('call screen'), findsOneWidget);
    return r;
  }

  testWidgets(
    'placed FROM the chat: the chat is replaced, never stacked twice',
    (tester) async {
      final r = await callOver(tester, '/chats/c1');

      openConversationFromCall(r, 'c1', recordVoice: true);
      await tester.pumpAndSettle();

      expect(find.text('call screen'), findsNothing);
      expect(find.text('chat c1 voice=true'), findsOneWidget);
      expect(
        r.canPop(),
        isFalse,
        reason: 'one copy of the chat, nothing under it',
      );
    },
  );

  testWidgets('placed from elsewhere: the chat is pushed, Back returns there', (
    tester,
  ) async {
    final r = await callOver(tester, '/calls');

    openConversationFromCall(r, 'c1', recordVoice: false);
    await tester.pumpAndSettle();

    expect(find.text('chat c1 voice=false'), findsOneWidget);
    expect(r.canPop(), isTrue);
    r.pop();
    await tester.pumpAndSettle();
    expect(find.text('calls tab'), findsOneWidget);
    expect(find.text('call screen'), findsNothing);
  });

  testWidgets('a different chat underneath is not replaced', (tester) async {
    final r = await callOver(tester, '/chats/other');

    openConversationFromCall(r, 'c1', recordVoice: true);
    await tester.pumpAndSettle();

    expect(find.text('chat c1 voice=true'), findsOneWidget);
    r.pop();
    await tester.pumpAndSettle();
    expect(find.text('chat other voice=false'), findsOneWidget);
  });
}
