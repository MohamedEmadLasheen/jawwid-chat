/// PD-47: a task a person must do, as the teacher's "To do" reads it. Wire shape from
/// `apps/api/src/tasks` (`GET /me/tasks`, `GET /tasks/:id`); nothing here decides
/// anything -- the level, its reason and what the viewer may do are the server's.
library;

import '../utils/app_clock.dart';

/// The level the server computed (PD-47 priority amendment): red, yellow or green.
enum TaskLevel {
  high,
  medium,
  low;

  static TaskLevel parse(Object? raw) => switch (raw) {
        'high' => TaskLevel.high,
        'low' => TaskLevel.low,
        _ => TaskLevel.medium,
      };
}

/// Why the level is what it is. `manual`: a person set it, and no reason is shown.
enum TaskReason {
  manual,
  dueSoon,
  overdue,
  source;

  static TaskReason parse(Object? raw) => switch (raw) {
        'due_soon' => TaskReason.dueSoon,
        'overdue' => TaskReason.overdue,
        'source' => TaskReason.source,
        _ => TaskReason.manual,
      };
}

/// What the viewer may do with a task now (`GET /tasks/:id` `actions`). Only the ones
/// a teacher can be offered; an action this build does not know is never offered.
enum TaskAction {
  complete,
  acknowledge,
  outOfScope,
  comment;

  static TaskAction? parse(Object? raw) => switch (raw) {
        'complete' => TaskAction.complete,
        'acknowledge' => TaskAction.acknowledge,
        'out_of_scope' => TaskAction.outOfScope,
        'comment' => TaskAction.comment,
        _ => null,
      };
}

/// `GET /me/tasks`, every page this build reads; [more] when the server had more still.
class TaskList {
  const TaskList(this.tasks, {this.more = false});

  static const empty = TaskList([]);

  final List<WorkTask> tasks;
  final bool more;
}

class WorkTask {
  const WorkTask({
    required this.id,
    required this.kind,
    required this.state,
    required this.title,
    required this.level,
    required this.reason,
    this.body,
    this.dueAt,
    this.overdue = false,
    this.financial = false,
    this.instructions,
    this.createdByName,
    this.sourceType,
    this.sourceId,
    this.withdrawn = false,
    this.titleParams = const {},
    this.actions = const {},
  });

  final String id;

  /// `manual` (a person gave it) or `system` (its source raised it).
  final String kind;

  /// `open`, `awaiting_decision`, `completed` or `removed`.
  final String state;

  /// A person's words for a manual task; empty for a system task, whose title is ours.
  final String title;
  final String? body;
  final TaskLevel level;
  final TaskReason reason;

  /// In the account's zone (PD-22).
  final DateTime? dueAt;
  final bool overdue;
  final bool financial;

  /// From a manager who returned it.
  final String? instructions;
  final String? createdByName;

  /// `lesson_report`, `report_correction`, ...; null for a manual task.
  final String? sourceType;
  final String? sourceId;

  /// The work behind it no longer exists: the assignee acknowledges it.
  final bool withdrawn;
  final Map<String, Object?> titleParams;

  /// Only from `GET /tasks/:id`; a list row offers nothing until it is opened.
  final Set<TaskAction> actions;

  bool get awaitingDecision => state == 'awaiting_decision';

  /// The lesson a lesson-sourced task is about, when the server names it.
  String? get lessonId => titleParams['lessonId'] is String ? titleParams['lessonId'] as String : null;

  static WorkTask? fromJson(Object? raw) {
    if (raw is! Map || raw['id'] is! String) return null;
    final source = raw['source'];
    final params = raw['titleParams'];
    return WorkTask(
      id: raw['id'] as String,
      kind: raw['kind'] is String ? raw['kind'] as String : 'manual',
      state: raw['state'] is String ? raw['state'] as String : 'open',
      title: raw['title'] is String ? raw['title'] as String : '',
      body: raw['body'] is String ? raw['body'] as String : null,
      level: TaskLevel.parse(raw['effectivePriority']),
      reason: TaskReason.parse(raw['priorityReason']),
      dueAt: AppClock.parse(raw['dueAt']),
      overdue: raw['overdue'] == true,
      financial: raw['category'] == 'financial',
      instructions: raw['instructions'] is String ? raw['instructions'] as String : null,
      createdByName: raw['createdBy'] is Map && (raw['createdBy'] as Map)['name'] is String ? (raw['createdBy'] as Map)['name'] as String : null,
      sourceType: source is Map && source['type'] is String ? source['type'] as String : null,
      sourceId: source is Map && source['id'] is String ? source['id'] as String : null,
      withdrawn: raw['sourceState'] == 'withdrawn',
      titleParams: params is Map ? params.map((k, v) => MapEntry('$k', v as Object?)) : const {},
      actions: {
        for (final a in (raw['actions'] as List?) ?? const []) ?TaskAction.parse(a),
      },
    );
  }
}
