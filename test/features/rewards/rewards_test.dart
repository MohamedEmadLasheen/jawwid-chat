// PD-55 PR-4: rewards for a child during their lesson -- the catalogues the
// server checks, the family's celebration (live, over any screen, never in the
// way, with a chime only where it is wanted), and the teacher's tray.
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:jawwid_chat/app/providers.dart';
import 'package:jawwid_chat/design/theme.dart';
import 'package:jawwid_chat/features/app_lock/application/app_lock_controller.dart';
import 'package:jawwid_chat/features/auth/domain/auth_state.dart';
import 'package:jawwid_chat/features/rewards/application/reward_feed.dart';
import 'package:jawwid_chat/features/rewards/data/rewards_repository.dart';
import 'package:jawwid_chat/features/rewards/domain/rewards.dart';
import 'package:jawwid_chat/features/rewards/presentation/lesson_rewards_row.dart';
import 'package:jawwid_chat/features/rewards/presentation/reward_celebration.dart';
import 'package:jawwid_chat/features/rewards/presentation/reward_tray.dart';
import 'package:jawwid_chat/features/whiteboards/domain/board_elements.dart';
import 'package:jawwid_chat/l10n/app_localizations.dart';
import 'package:jawwid_chat/shared/models/user_role.dart';

import '../calls/w7_call_fakes.dart';

class _Chime implements RewardChime {
  final cues = <RewardCue>[];
  int get plays => cues.length;
  @override
  Future<void> play(RewardCue cue) async => cues.add(cue);
}

/// The app lock, held where a test puts it.
class _Lock extends AppLockController {
  _Lock(this.initial);
  final AppLockPhase initial;
  @override
  AppLockState build() => AppLockState(phase: initial);
  void set(AppLockPhase phase) => state = AppLockState(phase: phase);
}

class _SoundStore implements RewardSoundStore {
  _SoundStore([this.value]);
  bool? value;
  @override
  Future<bool?> read() async => value;
  @override
  Future<void> write(bool on) async => value = on;
}

class _Rewards implements RewardsRepository {
  _Rewards(this.lessons);
  final List<RewardLesson> lessons;
  final given = <({String learnerId, String lessonId, RewardGift gift, String clientEventId})>[];
  final undone = <String>[];

  @override
  Future<List<RewardLesson>> lessonsNow() async => lessons;

  @override
  Future<({String eventId, int stars})> give({
    required String learnerId,
    required String lessonId,
    required RewardGift gift,
    required String clientEventId,
    String? boardId,
  }) async {
    given.add((learnerId: learnerId, lessonId: lessonId, gift: gift, clientEventId: clientEventId));
    return (eventId: 'event-${given.length}', stars: given.length);
  }

  @override
  Future<int> undo({required String learnerId, required String eventId}) async {
    undone.add(eventId);
    return 0;
  }

  LessonRewards report = const LessonRewards(stars: 0);

  @override
  Future<LessonRewards> forLesson(String lessonId) async => report;
}

Map<String, Object?> _payload({String kind = 'star', int stars = 3, String? stickerKey, String? badge, int? nextBadgeAt}) => {
  'learnerId': 'learner-1',
  'lessonId': 'lesson-1',
  'eventId': 'event-1',
  'kind': kind,
  'stickerKey': stickerKey,
  'praiseKey': null,
  'praiseText': null,
  'stars': stars,
  'badge': badge,
  'nextBadgeAt': nextBadgeAt,
};

Widget _app(List<Override> overrides, Widget home, {bool reduceMotion = false}) => ProviderScope(
  overrides: overrides,
  child: MaterialApp(
    theme: JawwidTheme.light(isArabic: false),
    localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
    supportedLocales: const [Locale('en'), Locale('ar')],
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(disableAnimations: reduceMotion),
      child: RewardCelebrationHost(child: child!),
    ),
    home: home,
  ),
);

void main() {
  group('the catalogues', () {
    test('are the server\'s: the same sticker and praise keys in the API and in the migration', () {
      final api = File('apps/api/src/rewards/reward.service.ts').readAsStringSync();
      final migration = File('supabase/migrations/20261102130000_chat_pd055_learner_rewards.sql').readAsStringSync();
      for (final s in Sticker.values) {
        expect(api, contains("'${s.wire}'"), reason: 'API sticker ${s.wire}');
        expect(migration, contains("'${s.wire}'"), reason: 'migration sticker ${s.wire}');
      }
      for (final p in Praise.values) {
        expect(api, contains("'${p.wire}'"), reason: 'API praise ${p.wire}');
        expect(migration, contains("'${p.wire}'"), reason: 'migration praise ${p.wire}');
      }
    });

    test('PD-55 (3): each reward has its sound -- a bell for a star or sticker, applause for praise, a fanfare to celebrate', () {
      RewardCue cue(String kind, {String? stickerKey}) => RewardCue.of(RewardGiven.fromPayload({..._payload(kind: kind, stickerKey: stickerKey), if (kind == 'praise') 'praiseKey': 'excellent'})!);
      expect(cue('star'), RewardCue.encouragement);
      expect(cue('sticker', stickerKey: 'rocket'), RewardCue.encouragement);
      expect(cue('praise'), RewardCue.applause);
      expect(cue('celebration'), RewardCue.celebration);
    });

    test('PD-55 (3): the sounds are ours, CC0, bundled, and each one is short', () {
      final licence = File('assets/sounds/LICENSE.md').readAsStringSync();
      final pubspec = File('pubspec.yaml').readAsStringSync();
      expect(licence, contains('CC0 1.0'));
      expect(licence, contains('scripts/assets/make_reward_sounds.py'));
      for (final c in RewardCue.values) {
        final file = File(c.asset);
        expect(pubspec, contains('- ${c.asset}'), reason: '${c.asset} is bundled');
        expect(licence, contains(c.asset.split('/').last), reason: '${c.asset} is in the licence record');
        // 22.05 kHz, 16-bit mono: under two seconds is under 88,244 bytes with its header.
        expect(file.lengthSync(), lessThan(88244), reason: '${c.asset} is short');
      }
      expect(File('assets/sounds/reward_chime.wav').existsSync(), isFalse, reason: 'the old chime is gone');
    });

    test('praise is general praise only -- and in the words the teacher chose', () {
      final ar = lookupL10n(const Locale('ar')), en = lookupL10n(const Locale('en'));
      expect([for (final p in Praise.values) p.words(ar, en)], ['ممتاز', 'أحسنت', 'رائع', 'بطل', 'Excellent', 'Well done', 'Great', 'Champion']);
    });

    test('a reward frame is read only when it matches the contract', () {
      expect(RewardGiven.fromPayload(_payload(kind: 'sticker', stickerKey: 'rocket'))!.sticker, Sticker.rocket);
      expect(RewardGiven.fromPayload(_payload(kind: 'celebration'))!.isCelebration, isTrue);
      expect(RewardGiven.fromPayload({..._payload(), 'kind': 'gold_bar'}), isNull);
      expect(RewardGiven.fromPayload({..._payload(), 'stars': 'many'}), isNull);
      expect(RewardGiven.fromPayload('nonsense'), isNull);
    });
  });

  group('the family\'s celebration', () {
    late SpySocket socket;
    late _Chime chime;
    late _Lock lock;

    List<Override> overrides({UserRole role = UserRole.parent, bool? sound, AppLockPhase phase = AppLockPhase.unlocked}) {
      socket = SpySocket();
      chime = _Chime();
      lock = _Lock(phase);
      final auth = ScriptedAuth(signedIn());
      return [
        appLockControllerProvider.overrideWith(() => lock),
        authControllerProvider.overrideWith(() => auth),
        currentRoleProvider.overrideWithValue(role),
        realtimeSocketProvider.overrideWithValue(socket),
        rewardChimeProvider.overrideWithValue(chime),
        rewardSoundStoreProvider.overrideWithValue(_SoundStore(sound)),
      ];
    }

    Widget screen(void Function() onTap) => Scaffold(body: Center(child: ElevatedButton(onPressed: onTap, child: const Text('under'))));

    testWidgets('a star plays over whatever is on screen, says how many stars this lesson, never blocks a tap, and is gone after', (tester) async {
      var taps = 0;
      await tester.pumpWidget(_app(overrides(), screen(() => taps++)));
      await tester.pumpAndSettle();
      final en = lookupL10n(const Locale('en'));

      socket.emit(rewardGivenEvent, _payload(stars: 3));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const ValueKey('reward-celebration')), findsOneWidget);
      expect(find.text(en.rewardStarLine(3)), findsOneWidget);
      expect(find.byKey(const ValueKey('reward-confetti')), findsOneWidget);

      await tester.tap(find.text('under'));
      expect(taps, 1, reason: 'the celebration takes no tap');

      await tester.pump(const Duration(seconds: 3));
      expect(find.byKey(const ValueKey('reward-celebration')), findsNothing);
      expect(chime.cues, [RewardCue.encouragement], reason: 'a family\'s phone plays by default; a star is the bell');
      await socket.close();
    });

    testWidgets('never over the app lock: nothing shown or heard while locked, nothing replayed after; locking hides one playing', (tester) async {
      await tester.pumpWidget(_app(overrides(phase: AppLockPhase.locked), screen(() {})));
      await tester.pumpAndSettle();
      socket.emit(rewardGivenEvent, _payload());
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const ValueKey('reward-celebration')), findsNothing);
      await tester.pump(const Duration(seconds: 3));
      expect(chime.plays, 0, reason: 'a locked phone does not chime a child\'s reward');

      lock.set(AppLockPhase.unlocked);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const ValueKey('reward-celebration')), findsNothing, reason: 'unlocking does not replay it');

      socket.emit(rewardGivenEvent, _payload(stars: 4));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const ValueKey('reward-celebration')), findsOneWidget);
      lock.set(AppLockPhase.locked);
      await tester.pump();
      expect(find.byKey(const ValueKey('reward-celebration')), findsNothing, reason: 'the lock hides one already playing');
      await tester.pump(const Duration(seconds: 3));
      await socket.close();
    });

    testWidgets('a celebration says so; a malformed frame or another event shows nothing', (tester) async {
      await tester.pumpWidget(_app(overrides(), screen(() {})));
      await tester.pumpAndSettle();
      final en = lookupL10n(const Locale('en'));
      socket.emit(rewardGivenEvent, {'kind': 'star'});
      socket.emit('message.created', _payload());
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const ValueKey('reward-celebration')), findsNothing);
      socket.emit(rewardGivenEvent, _payload(kind: 'celebration'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.text(en.rewardCelebrationLine), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      expect(chime.cues, [RewardCue.celebration], reason: 'the malformed frame and the other event played nothing');
      await socket.close();
    });

    testWidgets('a teacher\'s device is silent by default; a family that muted it is silent too', (tester) async {
      await tester.pumpWidget(_app(overrides(role: UserRole.teacher), screen(() {})));
      await tester.pumpAndSettle();
      socket.emit(rewardGivenEvent, _payload());
      await tester.pump();
      await tester.pump(const Duration(seconds: 3));
      expect(chime.plays, 0);
      await socket.close();

      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(_app(overrides(sound: false), screen(() {})));
      await tester.pumpAndSettle();
      socket.emit(rewardGivenEvent, _payload());
      await tester.pump();
      await tester.pump(const Duration(seconds: 3));
      expect(chime.plays, 0, reason: 'the parent turned reward sounds off');
      await socket.close();
    });

    testWidgets('with "reduce motion" on: the line and the star, no confetti', (tester) async {
      await tester.pumpWidget(_app(overrides(), screen(() {}), reduceMotion: true));
      await tester.pumpAndSettle();
      socket.emit(rewardGivenEvent, _payload());
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const ValueKey('reward-celebration')), findsOneWidget);
      expect(find.byKey(const ValueKey('reward-confetti')), findsNothing, reason: 'no particles');
      await tester.pump(const Duration(seconds: 3));
      await socket.close();
    });
  });

  group('the teacher\'s tray', () {
    late List<({StampKind stamp, String? text})> placed;

    String place({required StampKind stamp, String? text, required Color color}) {
      placed.add((stamp: stamp, text: text));
      return 'el-${placed.length}';
    }

    Future<_Rewards> pump(WidgetTester tester, List<RewardLesson> lessons) async {
      placed = [];
      final repo = _Rewards(lessons);
      await tester.binding.setSurfaceSize(const Size(900, 1400));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        ProviderScope(
          overrides: [rewardsRepositoryProvider.overrideWithValue(repo)],
          child: MaterialApp(
            theme: JawwidTheme.light(isArabic: false),
            localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
            supportedLocales: const [Locale('en'), Locale('ar')],
            home: Scaffold(body: RewardTray(place: place, boardId: 'board-1', random: math.Random(7))),
          ),
        ),
      );
      await tester.pumpAndSettle();
      return repo;
    }

    const adam = RewardLesson(lessonId: 'lesson-a', learnerId: 'adam', learnerName: 'Adam', stars: 2);
    const jana = RewardLesson(lessonId: 'lesson-j', learnerId: 'jana', learnerName: 'Jana', stars: 0);

    testWidgets('one lesson on: its child is chosen; a star lands on the board AND is recorded once; Undo withdraws it', (tester) async {
      final repo = await pump(tester, [adam]);
      expect(tester.widget<FilterChip>(find.byKey(const ValueKey('reward-for-adam'))).selected, isTrue);
      await tester.tap(find.byKey(const ValueKey('reward-star')));
      await tester.pumpAndSettle();
      expect(placed, [(stamp: StampKind.star, text: null)]);
      expect(repo.given.map((g) => (g.learnerId, g.lessonId, g.gift.kind)), [('adam', 'lesson-a', 'star')]);
      expect(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').hasMatch(repo.given.single.clientEventId), isTrue);
      await tester.tap(find.byKey(const ValueKey('reward-undo')));
      await tester.pumpAndSettle();
      expect(repo.undone, ['event-1']);
    });

    testWidgets('a sticker and a praise stamp: on the board in their own form, and one reward each', (tester) async {
      final repo = await pump(tester, [adam]);
      await tester.tap(find.byKey(const ValueKey('reward-sticker-rocket')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('reward-praise-champion_ar')));
      await tester.pumpAndSettle();
      expect(placed, [(stamp: StampKind.rocket, text: null), (stamp: StampKind.praise, text: 'بطل')]);
      expect(repo.given.map((g) => g.gift.toJson()), [
        {'kind': 'sticker', 'stickerKey': 'rocket'},
        {'kind': 'praise', 'praiseKey': 'champion_ar'},
      ]);
    });

    testWidgets('the teacher\'s own words: up to 40 characters, on the board and recorded', (tester) async {
      final repo = await pump(tester, [adam]);
      await tester.ensureVisible(find.byKey(const ValueKey('reward-own-words-add')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('reward-own-words')), 'Beautiful reading today');
      await tester.tap(find.byKey(const ValueKey('reward-own-words-add')));
      await tester.pumpAndSettle();
      expect(placed.single, (stamp: StampKind.praise, text: 'Beautiful reading today'));
      expect(repo.given.single.gift.toJson(), {'kind': 'praise', 'praiseText': 'Beautiful reading today'});
      expect(tester.widget<TextField>(find.byKey(const ValueKey('reward-own-words'))).maxLength, 40);
    });

    testWidgets('Everyone, then Celebrate: one celebration per child, nothing placed on the board', (tester) async {
      final repo = await pump(tester, [adam, jana]);
      expect(tester.widget<FilledButton>(find.byKey(const ValueKey('reward-celebrate'))).onPressed, isNull, reason: 'nobody chosen yet');
      await tester.tap(find.byKey(const ValueKey('reward-for-everyone')));
      await tester.pump();
      expect(tester.widget<FilterChip>(find.byKey(const ValueKey('reward-for-jana'))).selected, isTrue);
      await tester.ensureVisible(find.byKey(const ValueKey('reward-celebrate')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('reward-celebrate')));
      await tester.pumpAndSettle();
      expect(repo.given.map((g) => (g.learnerId, g.gift.kind)).toSet(), {('adam', 'celebration'), ('jana', 'celebration')});
      expect(placed, isEmpty);
      expect(find.byKey(const ValueKey('reward-undo')), findsNothing, reason: 'a celebration is not withdrawn');
    });

    testWidgets('no lesson on: it says rewards count during a lesson, and decorates the board only', (tester) async {
      final repo = await pump(tester, const []);
      expect(find.byKey(const ValueKey('reward-no-lesson')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('reward-star')));
      await tester.pumpAndSettle();
      expect(placed, hasLength(1));
      expect(repo.given, isEmpty);
    });
  });

  group('the tally and its badges (PR-5)', () {
    test('progress: how many more for the next badge, or the badge once the last is earned', () {
      final en = lookupL10n(const Locale('en')), ar = lookupL10n(const Locale('ar'));
      expect(rewardProgress(en, stars: 1, nextBadgeAt: 3), '2 more stars for Great effort');
      expect(rewardProgress(en, stars: 4, badge: RewardBadge.bronze, nextBadgeAt: 6), '2 more stars for Amazing effort');
      expect(rewardProgress(en, stars: 9, badge: RewardBadge.silver, nextBadgeAt: 10), '1 more star for Superstar');
      expect(rewardProgress(en, stars: 12, badge: RewardBadge.gold), 'Badge: Superstar');
      expect(rewardProgress(en, stars: 0), isNull);
      expect(rewardProgress(ar, stars: 4, badge: RewardBadge.bronze, nextBadgeAt: 6), 'نجمتان أخريان لـجهد مذهل');
    });

    testWidgets('the celebration says how far to the next badge', (tester) async {
      final socket = SpySocket();
      await tester.pumpWidget(_app([
        appLockControllerProvider.overrideWith(() => _Lock(AppLockPhase.unlocked)),
        authControllerProvider.overrideWith(() => ScriptedAuth(signedIn())),
        currentRoleProvider.overrideWithValue(UserRole.parent),
        realtimeSocketProvider.overrideWithValue(socket),
        rewardChimeProvider.overrideWithValue(_Chime()),
        rewardSoundStoreProvider.overrideWithValue(_SoundStore(false)),
      ], const Scaffold(body: SizedBox())));
      await tester.pumpAndSettle();
      socket.emit(rewardGivenEvent, _payload(stars: 4, badge: 'bronze', nextBadgeAt: 6));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(tester.widget<Text>(find.byKey(const ValueKey('reward-progress'))).data, '2 more stars for Amazing effort');
      await tester.pump(const Duration(seconds: 3));
      await socket.close();
    });

    testWidgets('the tray shows the chosen child\'s own tally and progress -- a HUD, nothing placed on the board', (tester) async {
      placedForTally = [];
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            rewardsRepositoryProvider.overrideWithValue(
              _Rewards([const RewardLesson(lessonId: 'l', learnerId: 'adam', learnerName: 'Adam', stars: 4, badge: RewardBadge.bronze, nextBadgeAt: 6)]),
            ),
          ],
          child: MaterialApp(
            theme: JawwidTheme.light(isArabic: false),
            localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
            supportedLocales: const [Locale('en'), Locale('ar')],
            home: const Scaffold(body: RewardTray(place: _placeForTally)),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final tally = find.byKey(const ValueKey('reward-tally-adam'));
      expect(tally, findsOneWidget);
      expect(find.descendant(of: tally, matching: find.text('2 more stars for Amazing effort')), findsOneWidget);
      expect(tester.widget<LinearProgressIndicator>(find.descendant(of: tally, matching: find.byType(LinearProgressIndicator))).value, closeTo(4 / 6, 0.001));
      expect(placedForTally, isEmpty);
    });

    Future<void> report(WidgetTester tester, LessonRewards rewards) async {
      final repo = _Rewards(const [])..report = rewards;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [rewardsRepositoryProvider.overrideWithValue(repo)],
          child: MaterialApp(
            theme: JawwidTheme.light(isArabic: false),
            localizationsDelegates: const [L10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
            supportedLocales: const [Locale('en'), Locale('ar')],
            home: const Scaffold(body: LessonRewardsRow(lessonId: 'lesson-1')),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    testWidgets('the report card\'s row: stars, the badge, the praise -- and nothing at all with no stars', (tester) async {
      await report(tester, const LessonRewards(stars: 7, badge: RewardBadge.silver, nextBadgeAt: 10, praise: [(praise: Praise.excellentAr, text: null), (praise: null, text: 'Lovely!')]));
      expect(find.text('7 stars · Amazing effort · ممتاز، Lovely!'), findsOneWidget);

      await report(tester, const LessonRewards(stars: 0));
      expect(find.byKey(const ValueKey('lesson-rewards-lesson-1')), findsNothing, reason: 'never shown as zero');
    });
  });

  test('the sound: on by default for a family, off for a teacher', () async {
    for (final (role, expected) in [(UserRole.parent, true), (UserRole.teacher, false)]) {
      final container = ProviderContainer(
        overrides: [
          authControllerProvider.overrideWith(() => ScriptedAuth(signedIn())),
          currentRoleProvider.overrideWithValue(role),
          rewardSoundStoreProvider.overrideWithValue(_SoundStore()),
        ],
      );
      expect(await container.read(rewardSoundProvider.future), expected, reason: '$role');
      container.dispose();
    }
  });

  test('AuthSignedOut is not a reason to crash the feed', () {
    final container = ProviderContainer(
      overrides: [authControllerProvider.overrideWith(() => ScriptedAuth(const AuthSignedOut()))],
    );
    expect(container.read(rewardFeedProvider), isNull);
    container.dispose();
  });
}

List<({StampKind stamp, String? text})> placedForTally = [];

String _placeForTally({required StampKind stamp, String? text, required Color color}) {
  placedForTally.add((stamp: stamp, text: text));
  return 'x';
}
