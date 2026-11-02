import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../domain/rewards.dart';

/// PD-55: a teacher's rewards during a lesson (apps/api/src/rewards). Every route
/// answers 404 while the server's `rewards.enabled` is off: the tray then says
/// rewards count only during a lesson and decorates the board alone.
abstract interface class RewardsRepository {
  /// `GET /teacher/rewards/now`: the teacher's lessons on now, each with its learner.
  Future<List<RewardLesson>> lessonsNow();

  /// `POST /learners/:learnerId/rewards`. Idempotent on [clientEventId], so a
  /// retried tap records once. Returns the reward's id (for Undo) and the
  /// learner's stars in that lesson after it.
  Future<({String eventId, int stars})> give({required String learnerId, required String lessonId, required RewardGift gift, required String clientEventId, String? boardId});

  /// `POST /learners/:learnerId/rewards/:eventId/undo` -- within 2 minutes, by the same teacher.
  Future<int> undo({required String learnerId, required String eventId});

  /// `GET /lessons/:lessonId/rewards`: one lesson's rewards for its learner (PR-5).
  Future<LessonRewards> forLesson(String lessonId);
}

/// A build with no rewards server: no lessons on, nothing recorded.
class NoRewardsRepository implements RewardsRepository {
  const NoRewardsRepository();

  @override
  Future<List<RewardLesson>> lessonsNow() async => const [];

  @override
  Future<({String eventId, int stars})> give({
    required String learnerId,
    required String lessonId,
    required RewardGift gift,
    required String clientEventId,
    String? boardId,
  }) => throw UnsupportedError('no rewards server in this build');

  @override
  Future<int> undo({required String learnerId, required String eventId}) => throw UnsupportedError('no rewards server in this build');

  @override
  Future<LessonRewards> forLesson(String lessonId) async => const LessonRewards(stars: 0);
}

class HttpRewardsRepository implements RewardsRepository {
  HttpRewardsRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  @override
  Future<List<RewardLesson>> lessonsNow() async {
    final response = await _client.get<Map<String, Object?>>('/teacher/rewards/now');
    final lessons = response.data?['lessons'];
    return [
      if (lessons is List)
        for (final l in lessons)
          if (l is Map) RewardLesson.fromJson(Map<String, Object?>.from(l)),
    ];
  }

  @override
  Future<({String eventId, int stars})> give({
    required String learnerId,
    required String lessonId,
    required RewardGift gift,
    required String clientEventId,
    String? boardId,
  }) async {
    final response = await _client.post<Map<String, Object?>>(
      '/learners/$learnerId/rewards',
      data: {'lessonId': lessonId, 'clientEventId': clientEventId, 'boardId': ?boardId, ...gift.toJson()},
    );
    final event = response.data?['event'];
    return (
      eventId: event is Map && event['id'] is String ? event['id'] as String : clientEventId,
      stars: (response.data?['stars'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  Future<int> undo({required String learnerId, required String eventId}) async {
    final response = await _client.post<Map<String, Object?>>('/learners/$learnerId/rewards/$eventId/undo');
    return (response.data?['stars'] as num?)?.toInt() ?? 0;
  }

  @override
  Future<LessonRewards> forLesson(String lessonId) async {
    final response = await _client.get<Map<String, Object?>>('/lessons/$lessonId/rewards');
    return LessonRewards.fromJson(response.data ?? const {});
  }
}

/// PD-55 PR-5: a lesson's rewards for the report card. Rewards off (404), an
/// error, or none: no stars -- and the card shows no row, never a zero.
final lessonRewardsProvider = FutureProvider.autoDispose.family<LessonRewards, String>((ref, lessonId) async {
  try {
    return await ref.watch(rewardsRepositoryProvider).forLesson(lessonId);
  } on Object {
    return const LessonRewards(stars: 0);
  }
});

final rewardsRepositoryProvider = Provider<RewardsRepository>((ref) => const NoRewardsRepository());
