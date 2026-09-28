/// The Calls tab, now that the server can answer it (W8-W2).
///
/// WHAT CHANGED. Until this workstream the tab had nothing it could honestly
/// request: `GET /calls/history/:conversationId` is per-conversation and this
/// screen is the ACCOUNT's call list, so it reported the absence rather than
/// inventing an answer. `GET /calls/history` answers it, scoped server-side to
/// the conversations the actor may read.
///
/// WHAT MUST NOT CHANGE. The screen still computes nothing: no fan-out across
/// conversations, no client-side merge, no re-sorting, no `family_id`, and no
/// locally derived authorization. These tests assert the ABSENCE of those as
/// much as the presence of a list.
library;

import 'package:flutter/material.dart' hide Page;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/core/errors/app_error.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/calls/data/account_call_history.dart';
import 'package:jawwid_chat/features/calls/presentation/calls_screen.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';

/// Records what the screen asked for, and answers however the test says.
class RecordingHistory implements AccountCallHistoryRepository {
  RecordingHistory({this.result, this.error});

  Page<CallHistoryEntry>? result;
  Object? error;

  final cursors = <String?>[];

  @override
  Future<Page<CallHistoryEntry>> page({String? cursor}) async {
    cursors.add(cursor);
    if (error != null) throw error!;
    return result ?? const Page(items: []);
  }
}

CallHistoryEntry entry({
  String id = 'call_1',
  String conversationId = 'conv_1',
  CallOutcome outcome = CallOutcome.answered,
  Duration? duration = const Duration(minutes: 2),
  DateTime? startedAt,
}) =>
    CallHistoryEntry(
      id: id,
      conversationId: conversationId,
      title: 'Jawwid',
      startedAt: startedAt ?? DateTime.now().subtract(const Duration(hours: 1)),
      outcome: outcome,
      isGroup: false,
      duration: duration,
    );

void main() {
  /// The screen, with the account-history repository registered or absent.
  ///
  /// Typed by the repository rather than by an override list: Riverpod does not
  /// export `Override` here, and one named dependency reads better than a bag of
  /// them for a screen with exactly one.
  Widget harness({AccountCallHistoryRepository? history}) => ProviderScope(
        overrides: [
          if (history != null)
            accountCallHistoryProvider.overrideWithValue(history),
        ],
        child: MaterialApp(
          locale: const Locale('en'),
          theme: JawwidTheme.light(isArabic: false),
          supportedLocales: JawwidApp.supportedLocales,
          localizationsDelegates: const [
            L10n.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: const CallsScreen(),
        ),
      );

  testWidgets('the tab lists the account\'s calls from ONE request',
      (tester) async {
    final history = RecordingHistory(
      result: Page(items: [entry(id: 'a'), entry(id: 'b', conversationId: 'conv_2')]),
    );

    await tester.pumpWidget(harness(history: history));
    await tester.pumpAndSettle();
    final l10n = await L10n.delegate.load(const Locale('en'));

    // The row reads "Answered · 2m 0s", so the outcome is matched as a substring.
    expect(find.textContaining(l10n.callOutcomeAnswered), findsNWidgets(2));
    expect(
      history.cursors,
      [null],
      reason: 'one page, one request — never one per conversation',
    );
  });

  testWidgets('the order on screen is the order the server sent',
      (tester) async {
    // Deliberately not chronological: a screen that sorted would reorder these.
    final history = RecordingHistory(
      result: Page(items: [
        entry(
          id: 'first',
          outcome: CallOutcome.missed,
          startedAt: DateTime.now().subtract(const Duration(minutes: 5)),
        ),
        entry(
          id: 'second',
          outcome: CallOutcome.declined,
          startedAt: DateTime.now().subtract(const Duration(days: 2)),
        ),
        entry(
          id: 'third',
          outcome: CallOutcome.answered,
          startedAt: DateTime.now().subtract(const Duration(hours: 3)),
        ),
      ]),
    );

    await tester.pumpWidget(harness(history: history));
    await tester.pumpAndSettle();
    final l10n = await L10n.delegate.load(const Locale('en'));

    final missed = tester.getTopLeft(find.textContaining(l10n.callOutcomeMissed)).dy;
    final declined = tester.getTopLeft(find.textContaining(l10n.callOutcomeDeclined)).dy;
    final answered = tester.getTopLeft(find.textContaining(l10n.callOutcomeAnswered)).dy;

    expect(missed, lessThan(declined));
    expect(declined, lessThan(answered));
  });

  testWidgets('an empty account history says so, and is not an error',
      (tester) async {
    await tester.pumpWidget(harness(history: RecordingHistory()));
    await tester.pumpAndSettle();
    final l10n = await L10n.delegate.load(const Locale('en'));

    expect(find.text(l10n.callHistoryEmpty), findsOneWidget);
  });

  testWidgets('a build with no account repository still says calling is not on',
      (tester) async {
    // The provider throws UnimplementedError when unregistered; the controller
    // turns that into a specific state rather than a red screen.
    await tester.pumpWidget(harness());
    await tester.pumpAndSettle();
    final l10n = await L10n.delegate.load(const Locale('en'));

    expect(find.text(l10n.callsUnavailableTitle), findsOneWidget);
  });

  testWidgets('a refusal is an error, never an empty list', (tester) async {
    await tester.pumpWidget(
      harness(
        history: RecordingHistory(
          error: const AppError(
            AppErrorKind.forbidden,
            code: 'COMM.NOT_CONVERSATION_MEMBER',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final l10n = await L10n.delegate.load(const Locale('en'));

    // The empty state would be a lie: it would read as "you have no calls".
    expect(find.textContaining(l10n.callHistoryEmpty), findsNothing);
    // And the code itself is never rendered.
    expect(find.textContaining('COMM.'), findsNothing);
  });

  testWidgets('nothing technical reaches the screen', (tester) async {
    await tester.pumpWidget(
      harness(history: RecordingHistory(result: Page(items: [entry()]))),
    );
    await tester.pumpAndSettle();

    for (final secret in ['call_1', 'conv_1', 'jawwid-', 'token', 'wss://']) {
      expect(find.textContaining(secret), findsNothing, reason: secret);
    }
  });
}
