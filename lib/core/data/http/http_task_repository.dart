import '../../../shared/models/work_task.dart';
import '../../network/api_client.dart';
import '../repositories.dart';

/// `TaskRepository` over the PD-47 endpoints. Every method is one request (the list,
/// one per page); nothing is decided here.
class HttpTaskRepository implements TaskRepository {
  HttpTaskRepository({required ApiClient client}) : _client = client;

  final ApiClient _client;

  /// A teacher's own list is short; this bounds a runaway cursor, not a real one.
  /// Past it the list says there is more ("To do (N+)").
  static const _maxPages = 10;

  @override
  Future<TaskList> myTasks() async {
    final tasks = <WorkTask>[];
    String? cursor;
    for (var page = 0; page < _maxPages; page++) {
      final response = await _client.get<Map<String, Object?>>('/me/tasks', query: {'state': 'open', 'cursor': ?cursor});
      for (final row in (response.data?['items'] as List?) ?? const []) {
        if (WorkTask.fromJson(row) case final task?) tasks.add(task);
      }
      cursor = response.data?['nextCursor'] as String?;
      if (cursor == null) break;
    }
    return TaskList(tasks, more: cursor != null);
  }

  @override
  Future<WorkTask> task(String id) async {
    final response = await _client.get<Map<String, Object?>>('/tasks/$id');
    final task = WorkTask.fromJson(response.data);
    if (task == null) throw const FormatException('a task without an id');
    return task;
  }

  @override
  Future<void> complete(String id) async {
    await _client.post<Object?>('/tasks/$id/complete', data: const <String, Object?>{});
  }

  @override
  Future<void> acknowledge(String id) async {
    await _client.post<Object?>('/tasks/$id/acknowledge');
  }

  @override
  Future<void> outOfScope(String id, String comment) async {
    await _client.post<Object?>('/tasks/$id/out-of-scope', data: {'comment': comment});
  }

  @override
  Future<void> comment(String id, String body) async {
    await _client.post<Object?>('/tasks/$id/comments', data: {'body': body});
  }
}
