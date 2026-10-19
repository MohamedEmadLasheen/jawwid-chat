import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/wire/wire_mappers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/messages/data/message_marks_repository.dart';
import 'package:jawwid_chat/features/messages/presentation/message_actions.dart';
import 'package:jawwid_chat/features/messages/presentation/pinned_banner.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/message.dart';

/// Star (private) and pin (shared, at most three) -- group B, 2026-10-19.
void main() {
  Message message(String id, {String body = 'hello', ApprovalState approval = ApprovalState.notRequired}) => Message(
        id: id,
        clientMessageId: 'c-$id',
        conversationId: 'conv',
        sequence: 1,
        kind: MessageKind.text,
        body: body,
        createdAt: DateTime.utc(2026, 10, 19, 12),
        deliveryState: DeliveryState.delivered,
        approvalState: approval,
      );

  group('actions', () {
    test('Star and Pin are offered only when the build reaches those routes', () {
      expect(actionsFor(message('m')), isNot(contains(MessageAction.star)));
      expect(actionsFor(message('m'), withMarks: true), containsAll([MessageAction.star, MessageAction.pin]));
    });

    test('a message still awaiting approval can be starred but not pinned', () {
      final held = actionsFor(message('m', approval: ApprovalState.pending), withMarks: true);
      expect(held, contains(MessageAction.star));
      expect(held, isNot(contains(MessageAction.pin)));
    });
  });

  test('the server flags map onto the message, and survive a copy', () {
    final m = WireMappers.message(
      {'id': 'm1', 'type': 'text', 'createdAt': '2026-10-19T10:00:00Z', 'starred': true, 'pinned': true},
      viewerActorId: 'me',
    );
    expect(m.isStarred, isTrue);
    expect(m.isPinned, isTrue);
    expect(m.copyWith(isDeleted: false).isStarred, isTrue);
    final plain = WireMappers.message({'id': 'm2', 'type': 'text', 'createdAt': '2026-10-19T10:00:00Z'}, viewerActorId: 'me');
    expect(plain.isStarred || plain.isPinned, isFalse);
  });

  testWidgets('the pinned bar shows the newest pin, counts, and moves on when tapped', (tester) async {
    final jumped = <String>[];
    final repo = _Pins([
      PinnedMessage(message: message('a', body: 'the schedule'), pinnedAt: DateTime.utc(2026, 10, 19, 9)),
      PinnedMessage(message: message('b', body: 'the meeting link'), pinnedAt: DateTime.utc(2026, 10, 19, 10)),
    ]);
    await tester.pumpWidget(ProviderScope(
      overrides: [messageMarksRepositoryProvider.overrideWithValue(repo), principalIdProvider.overrideWithValue('me')],
      child: MaterialApp(
        theme: JawwidTheme.light(isArabic: false),
        supportedLocales: JawwidApp.supportedLocales,
        localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
        home: Scaffold(body: PinnedBanner(conversationId: 'conv', onJump: jumped.add)),
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Pinned message 2 of 2'), findsOneWidget);
    expect(find.text('the meeting link'), findsOneWidget);
    await tester.tap(find.text('the meeting link'));
    await tester.pumpAndSettle();
    expect(jumped, ['b']);
    expect(find.text('Pinned message 1 of 2'), findsOneWidget);
    expect(find.text('the schedule'), findsOneWidget);
  });

  testWidgets('no pins, no bar', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [messageMarksRepositoryProvider.overrideWithValue(_Pins(const [])), principalIdProvider.overrideWithValue('me')],
      child: MaterialApp(
        localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate],
        supportedLocales: JawwidApp.supportedLocales,
        theme: JawwidTheme.light(isArabic: false),
        home: Scaffold(body: PinnedBanner(conversationId: 'conv', onJump: (_) {})),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.byType(InkWell), findsNothing);
  });
}

class _Pins extends NoMessageMarksRepository {
  _Pins(this.items);
  final List<PinnedMessage> items;
  @override
  bool get isAvailable => true;
  @override
  Future<List<PinnedMessage>> pins(String conversationId) async => items;
}
