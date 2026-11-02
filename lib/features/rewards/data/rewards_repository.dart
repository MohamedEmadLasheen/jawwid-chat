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
}

final rewardsRepositoryProvider = Provider<RewardsRepository>((ref) => const NoRewardsRepository());
