/// Seams for the PD-13 Calls page tests: a chat list, a scheduled-call API and
/// a call controller that records instead of calling.
library;

import 'package:flutter/material.dart' hide Page;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:jawwid_chat/app/app.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/core/data/repositories.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/calls/application/call_controller.dart';
import 'package:jawwid_chat/features/calls/data/account_call_history.dart';
import 'package:jawwid_chat/features/calls/data/scheduled_call_repository.dart';
import 'package:jawwid_chat/features/calls/domain/scheduled_call.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/conversation.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import 'w7_call_fakes.dart';

Conversation conv(
  String id,
  String title, {
  ConversationKind kind = ConversationKind.adminDirect,
  bool pinned = false,
  bool readOnly = false,
}) => Conversation(
  id: id,
  kind: kind,
  title: title,
  updatedAt: DateTime(2026, 10, 1),
  isPinned: pinned,
  isReadOnly: readOnly,
);

/// The chat list, as given. Everything else is out of scope for these tests.
class ListConversations implements ConversationRepository {
  ListConversations(this.items);

  final List<Conversation> items;

  @override
  Future<List<Conversation>> list({bool includeArchived = false}) async =>
      items;

  @override
  Future<Conversation> byId(String conversationId) async =>
      items.firstWhere((c) => c.id == conversationId);

  @override
  Future<void> setPinned(String conversationId, bool pinned) async {}

  @override
  Future<void> setMuted(String conversationId, bool muted) async {}

  @override
  Future<void> setArchived(String conversationId, bool archived) async {}

  @override
  Future<void> markRead(
    String conversationId, {
    required int throughSequence,
  }) async {}

  @override
  Future<List<Conversation>> search(String query) async => const [];

  @override
  Future<Conversation> openDirect(String withActorId) =>
      throw UnimplementedError();
}

/// The scheduled-call API, recorded.
class RecordingScheduled implements ScheduledCallRepository {
  RecordingScheduled({List<ScheduledCall>? items}) : items = items ?? [];

  List<ScheduledCall> items;
  Object? createError;
  Object? joinError;
  ScheduledJoin? joinAnswer;

  final creates =
      <
        ({
          String conversationId,
          ScheduledCallKind kind,
          DateTime? startsAt,
          String? title,
        })
      >[];
  final cancels = <String>[];
  final joins = <String>[];
  int listCalls = 0;

  @override
  Future<List<ScheduledCall>> upcoming() async {
    listCalls++;
    return items;
  }

  @override
  Future<ScheduledCall> get(String id) async =>
      items.firstWhere((c) => c.id == id);

  @override
  Future<ScheduledCall> create({
    required String conversationId,
    required ScheduledCallKind kind,
    DateTime? startsAt,
    String? title,
  }) async {
    creates.add((
      conversationId: conversationId,
      kind: kind,
      startsAt: startsAt,
      title: title,
    ));
    if (createError != null) throw createError!;
    final at = startsAt ?? DateTime.now();
    return scheduled(
      id: 'sc_${creates.length}',
      conversationId: conversationId,
      kind: kind,
      startsAt: at,
      title: title,
    );
  }

  @override
  Future<ScheduledCall> cancel(String id) async {
    cancels.add(id);
    return items.firstWhere((c) => c.id == id);
  }

  @override
  Future<ScheduledJoin> join(String id) async {
    joins.add(id);
    if (joinError != null) throw joinError!;
    return joinAnswer ??
        const ScheduledJoin(
          callId: 'call_1',
          conversationId: 'conv_1',
          mode: ScheduledJoinMode.started,
        );
  }
}

ScheduledCall scheduled({
  String id = 'sc_1',
  String conversationId = 'conv_1',
  ScheduledCallKind kind = ScheduledCallKind.scheduled,
  DateTime? startsAt,
  String? title,
  ScheduledCallState state = ScheduledCallState.upcoming,
  bool canCancel = false,
}) {
  final at = startsAt ?? DateTime.now().add(const Duration(days: 1));
  return ScheduledCall(
    id: id,
    conversationId: conversationId,
    kind: kind,
    title: title,
    startsAt: at,
    joinableFrom: at.subtract(const Duration(minutes: 10)),
    joinableUntil: at.add(const Duration(hours: 2)),
    state: state,
    canCancel: canCancel,
  );
}

/// The call API with a capability answer per conversation.
class PerConversationCalls extends FakeCalls {
  PerConversationCalls(this.answers);

  final Map<String, CallCapability> answers;

  @override
  Future<CallCapability> capability({required String conversationId}) async {
    capabilityCalls.add(conversationId);
    return answers[conversationId] ?? const CallCapability(canCall: false);
  }
}

/// The REAL controller type with its effects recorded instead of performed.
class RecordingCallController extends CallController {
  final starts = <({String conversationId, String peerLabel, bool isGroup})>[];
  final scheduledJoins =
      <
        ({
          String scheduledCallId,
          String conversationId,
          String peerLabel,
          bool isGroup,
        })
      >[];
  ScheduledJoinResult joinResult = ScheduledJoinResult.joined;

  @override
  CallUiState build() => const CallUiState();

  @override
  Future<void> start({
    required String conversationId,
    required String peerLabel,
    required bool isGroup,
  }) async {
    starts.add((
      conversationId: conversationId,
      peerLabel: peerLabel,
      isGroup: isGroup,
    ));
  }

  @override
  Future<ScheduledJoinResult> joinScheduled({
    required String scheduledCallId,
    required String conversationId,
    required String peerLabel,
    required bool isGroup,
  }) async {
    scheduledJoins.add((
      scheduledCallId: scheduledCallId,
      conversationId: conversationId,
      peerLabel: peerLabel,
      isGroup: isGroup,
    ));
    return joinResult;
  }
}

/// Answers the account history with a fixed page.
class StaticHistory implements AccountCallHistoryRepository {
  StaticHistory(this.items);

  final List<CallHistoryEntry> items;

  @override
  Future<Page<CallHistoryEntry>> page({String? cursor}) async =>
      Page(items: items);
}

/// A [MaterialApp] around [home] with the Calls page's dependencies.
Widget callsHarness({
  required Widget home,
  UserRole role = UserRole.parent,
  Locale locale = const Locale('en'),
  List<Conversation> conversations = const [],
  CallRepository? calls,
  ScheduledCallRepository? scheduledCalls,
  AccountCallHistoryRepository? history,
  CallController Function()? controller,
  List<Override> extra = const [],
}) {
  return ProviderScope(
    overrides: [
      currentRoleProvider.overrideWithValue(role),
      conversationRepositoryProvider.overrideWithValue(
        ListConversations(conversations),
      ),
      if (calls != null) callRepositoryProvider.overrideWithValue(calls),
      if (scheduledCalls != null)
        scheduledCallRepositoryProvider.overrideWithValue(scheduledCalls),
      if (history != null)
        accountCallHistoryProvider.overrideWithValue(history),
      if (controller != null) callControllerProvider.overrideWith(controller),
      ...extra,
    ],
    child: MaterialApp(
      locale: locale,
      theme: JawwidTheme.light(isArabic: locale.languageCode == 'ar'),
      supportedLocales: JawwidApp.supportedLocales,
      localizationsDelegates: const [
        L10n.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: home,
    ),
  );
}
