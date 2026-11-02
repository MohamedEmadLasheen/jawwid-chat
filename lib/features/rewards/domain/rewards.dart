import 'package:flutter/material.dart';

import '../../../design/tokens.dart';
import '../../../l10n/app_localizations.dart';

/// PD-55: rewards for a child during their lesson
/// (docs/product/pd055-whiteboard-teaching-and-rewards-plan.md §3).
///
/// THE CATALOGUES ARE CLOSED, here and on the server (the migration's checks,
/// RewardService), so the family's app can draw every key it is sent. General
/// praise only -- never Quran or other religious text -- and never emoji: every
/// sticker is a bundled Material icon (emoji draw as boxes in the browser build).

/// A sticker: its wire key, its icon and its colour.
enum Sticker {
  star('star', Icons.star_rounded, RewardPalette.gold),
  medal('medal', Icons.military_tech_rounded, RewardPalette.orange),
  trophy('trophy', Icons.emoji_events_rounded, RewardPalette.gold),
  rocket('rocket', Icons.rocket_launch_rounded, RewardPalette.blue),
  sun('sun', Icons.wb_sunny_rounded, RewardPalette.gold),
  rainbow('rainbow', Icons.looks_rounded, RewardPalette.purple),
  crown('crown', Icons.workspace_premium_rounded, RewardPalette.orange),
  balloon('balloon', Icons.celebration_rounded, RewardPalette.red),
  heart('heart', Icons.favorite_rounded, RewardPalette.red),
  thumbsUp('thumbs_up', Icons.thumb_up_rounded, RewardPalette.green),
  check('check', Icons.check_circle_rounded, RewardPalette.green);

  const Sticker(this.wire, this.icon, this.color);
  final String wire;
  final IconData icon;
  final Color color;

  static Sticker? parse(Object? wire) => values.where((s) => s.wire == wire).firstOrNull;
}

/// A praise stamp: four in Arabic, four in English -- general praise only.
enum Praise {
  excellentAr('excellent_ar'),
  wellDoneAr('well_done_ar'),
  greatAr('great_ar'),
  championAr('champion_ar'),
  excellent('excellent'),
  wellDone('well_done'),
  great('great'),
  champion('champion');

  const Praise(this.wire);
  final String wire;

  static Praise? parse(Object? wire) => values.where((p) => p.wire == wire).firstOrNull;

  /// The words as drawn: the Arabic ones always in Arabic, the English ones in English,
  /// whatever the app's language -- the teacher chose the words.
  String words(L10n arabic, L10n english) => switch (this) {
    Praise.excellentAr => arabic.rewardPraiseExcellent,
    Praise.wellDoneAr => arabic.rewardPraiseWellDone,
    Praise.greatAr => arabic.rewardPraiseGreat,
    Praise.championAr => arabic.rewardPraiseChampion,
    Praise.excellent => english.rewardPraiseExcellent,
    Praise.wellDone => english.rewardPraiseWellDone,
    Praise.great => english.rewardPraiseGreat,
    Praise.champion => english.rewardPraiseChampion,
  };
}

/// PD-55 PR-5: a lesson's badge, at the configured thresholds -- named for effort, never a rank.
enum RewardBadge {
  bronze,
  silver,
  gold;

  static RewardBadge? parse(Object? wire) => values.where((b) => b.name == wire).firstOrNull;

  String label(L10n l10n) => switch (this) {
    RewardBadge.bronze => l10n.rewardBadgeBronze,
    RewardBadge.silver => l10n.rewardBadgeSilver,
    RewardBadge.gold => l10n.rewardBadgeGold,
  };

  /// The badge after this one, if any.
  RewardBadge? get next => this == RewardBadge.gold ? null : RewardBadge.values[index + 1];
}

/// "N more stars for (the next badge)", or the badge itself once the last is earned -- null with no tally.
String? rewardProgress(L10n l10n, {required int stars, RewardBadge? badge, int? nextBadgeAt}) {
  if (nextBadgeAt != null && nextBadgeAt > stars) {
    final coming = badge?.next ?? RewardBadge.bronze;
    return l10n.rewardToNextBadge(nextBadgeAt - stars, coming.label(l10n));
  }
  return badge == null ? null : l10n.rewardBadgeEarned(badge.label(l10n));
}

/// A custom praise is at most this long (the server's limit).
const kRewardPraiseMaxLength = 40;

/// A lesson of the teacher's that is on now, with its learner: one "For" chip.
class RewardLesson {
  const RewardLesson({required this.lessonId, required this.learnerId, required this.learnerName, required this.stars, this.badge, this.nextBadgeAt});

  final String lessonId;
  final String learnerId;
  final String learnerName;

  /// This learner's stars in this lesson so far.
  final int stars;
  final RewardBadge? badge;
  final int? nextBadgeAt;

  factory RewardLesson.fromJson(Map<String, Object?> json) => RewardLesson(
    lessonId: json['lessonId']! as String,
    learnerId: json['learnerId']! as String,
    learnerName: json['learnerName'] as String? ?? '',
    stars: (json['stars'] as num?)?.toInt() ?? 0,
    badge: RewardBadge.parse(json['badge']),
    nextBadgeAt: (json['nextBadgeAt'] as num?)?.toInt(),
  );
}

/// PD-55 PR-5: one learner's rewards in one lesson -- the report card's row.
class LessonRewards {
  const LessonRewards({required this.stars, this.badge, this.nextBadgeAt, this.praise = const []});

  final int stars;
  final RewardBadge? badge;
  final int? nextBadgeAt;

  /// The praise given, oldest first: a stamp, or the teacher's own words.
  final List<({Praise? praise, String? text})> praise;

  factory LessonRewards.fromJson(Map<String, Object?> json) => LessonRewards(
    stars: (json['stars'] as num?)?.toInt() ?? 0,
    badge: RewardBadge.parse(json['badge']),
    nextBadgeAt: (json['nextBadgeAt'] as num?)?.toInt(),
    praise: [
      if (json['praise'] case final List list)
        for (final p in list)
          if (p is Map) (praise: Praise.parse(p['key']), text: p['text'] is String ? p['text'] as String : null),
    ],
  );
}

/// What a teacher gives: a star, a sticker, a praise stamp (or their own words), or a celebration.
sealed class RewardGift {
  const RewardGift();

  String get kind;
  Map<String, Object?> toJson();
}

class StarGift extends RewardGift {
  const StarGift();
  @override
  String get kind => 'star';
  @override
  Map<String, Object?> toJson() => {'kind': kind};
}

class StickerGift extends RewardGift {
  const StickerGift(this.sticker);
  final Sticker sticker;
  @override
  String get kind => 'sticker';
  @override
  Map<String, Object?> toJson() => {'kind': kind, 'stickerKey': sticker.wire};
}

class PraiseGift extends RewardGift {
  const PraiseGift({this.praise, this.text}) : assert((praise == null) != (text == null));
  final Praise? praise;
  final String? text;
  @override
  String get kind => 'praise';
  @override
  Map<String, Object?> toJson() => {'kind': kind, 'praiseKey': ?praise?.wire, 'praiseText': ?text};
}

class CelebrationGift extends RewardGift {
  const CelebrationGift();
  @override
  String get kind => 'celebration';
  @override
  Map<String, Object?> toJson() => {'kind': kind};
}

/// `learner.reward_given`, as the family's app (and the teacher's other devices) receive it.
class RewardGiven {
  const RewardGiven({
    required this.learnerId,
    required this.lessonId,
    required this.eventId,
    required this.kind,
    required this.stars,
    this.sticker,
    this.praise,
    this.praiseText,
    this.badge,
    this.nextBadgeAt,
  });

  final String learnerId;
  final String lessonId;
  final String eventId;

  /// star | sticker | praise | celebration.
  final String kind;
  final int stars;
  final Sticker? sticker;
  final Praise? praise;
  final String? praiseText;
  final RewardBadge? badge;
  final int? nextBadgeAt;

  bool get isCelebration => kind == 'celebration';

  /// Null for anything that does not match the contract: a bad frame is dropped, never shown.
  static RewardGiven? fromPayload(Object? payload) {
    if (payload is! Map) return null;
    final learnerId = payload['learnerId'], lessonId = payload['lessonId'], eventId = payload['eventId'];
    final kind = payload['kind'], stars = payload['stars'];
    if (learnerId is! String || lessonId is! String || eventId is! String || stars is! num) return null;
    if (kind is! String || !const {'star', 'sticker', 'praise', 'celebration'}.contains(kind)) return null;
    final text = payload['praiseText'];
    return RewardGiven(
      learnerId: learnerId,
      lessonId: lessonId,
      eventId: eventId,
      kind: kind,
      stars: stars.toInt(),
      sticker: Sticker.parse(payload['stickerKey']),
      praise: Praise.parse(payload['praiseKey']),
      praiseText: text is String && text.length <= kRewardPraiseMaxLength ? text : null,
      badge: RewardBadge.parse(payload['badge']),
      nextBadgeAt: payload['nextBadgeAt'] is num ? (payload['nextBadgeAt'] as num).toInt() : null,
    );
  }
}
