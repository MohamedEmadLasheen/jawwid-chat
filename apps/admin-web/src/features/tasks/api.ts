import { api } from '@/core/api/client'

/**
 * PD-47: tasks (apps/api src/tasks). Who sees a task, what it says, its level
 * and what the viewer may do with it are the server's; this page draws them.
 */
export type TaskView = 'mine' | 'team' | 'decisions' | 'all'
export type TaskState = 'open' | 'awaiting_decision' | 'completed' | 'removed'
export type Level = 'high' | 'medium' | 'low'
export type PriorityReason = 'manual' | 'due_soon' | 'overdue' | 'source'
export type Category = 'financial' | 'operational'
export type SourceType =
  | 'lesson_report'
  | 'report_correction'
  | 'lesson_ruling'
  | 'leave_decision'
  | 'violation_decision'
  | 'case'
  | 'instalment'
  | 'package_low'
  | 'renewal_request'
  | 'receipt_review'
  | 'checkout_failed'
export type TaskActionName = 'complete' | 'acknowledge' | 'out_of_scope' | 'comment' | 'return' | 'remove' | 'reassign' | 'due' | 'priority'

export interface Principal {
  kind: 'staff' | 'teacher'
  id: string
}

export interface Named {
  id: string
  name: string
}

export interface TaskSummary {
  id: string
  kind: 'manual' | 'system'
  state: TaskState
  outcome: 'done' | 'acknowledged' | null
  assignee: Principal
  assigneeName: string
  /** The assignee is no longer active: a manager reassigns it. */
  needsReassignment: boolean
  /** No live manager stands to it: only the super admin can move it. */
  unmanaged: boolean
  title: string
  body: string | null
  dueAt: string | null
  instructions: string | null
  disputedCount: number
  createdBy: Named | null
  createdAt: string
  updatedAt: string
  activityAt: string
  closedBy: Named | null
  closedAt: string | null
  closeReason: string | null
  revision: number
  manualPriority: Level
  effectivePriority: Level
  priorityReason: PriorityReason
  overdue: boolean
  category: Category
  source: { type: SourceType; id: string } | null
  /** withdrawn: the work no longer exists; the assignee acknowledges it, or a manager removes it. */
  sourceState: 'pending' | 'withdrawn' | null
  titleKey: string | null
  titleParams: Record<string, unknown> | null
}

export interface TaskEvent {
  id: string
  kind:
    | 'created'
    | 'reassigned'
    | 'out_of_scope'
    | 'returned'
    | 'completed'
    | 'removed'
    | 'commented'
    | 'due_changed'
    | 'priority_changed'
    | 'source_withdrawn'
    | 'source_restored'
    | 'source_raised'
  /** null: the system. */
  actor: { kind: 'staff' | 'teacher'; id: string; name: string } | null
  fromAssigneeId: string | null
  toAssigneeId: string | null
  body: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  at: string
}

export interface TaskDetail extends TaskSummary {
  actions: TaskActionName[]
  history: TaskEvent[]
}

export interface TaskPage {
  asOf: string
  items: TaskSummary[]
  nextCursor: string | null
}

export interface ListQuery {
  view: TaskView
  state: 'open' | 'closed'
  level?: Level
  category?: Category
  overdue?: boolean
}

export interface Assignees {
  people: Array<Principal & { name: string }>
  departments: Array<{ kind: 'operations' | 'teachers' | 'sales'; managerName: string }>
}

export type Target = Principal | { department: 'operations' | 'teachers' | 'sales' }

export interface NewTask {
  assignee: Principal
  title: string
  body?: string
  dueAt?: string
  priority?: Level
  category?: Category
}

const one = (id: string) => `/tasks/${encodeURIComponent(id)}`

export const tasksApi = {
  list: (q: ListQuery, cursor?: string) => {
    const query = { state: q.state, level: q.level, category: q.category, overdue: q.overdue ? 'true' : undefined, cursor }
    return q.view === 'mine' ? api.get<TaskPage>('/me/tasks', query) : api.get<TaskPage>('/tasks', { view: q.view, ...query })
  },
  get: (id: string) => api.get<TaskDetail>(one(id)),
  assignees: (taskId?: string) => api.get<Assignees>('/tasks/assignees', { task: taskId }),
  create: (body: NewTask) => api.post<TaskSummary>('/tasks', body),
  complete: (id: string, note?: string) => api.post<TaskSummary>(`${one(id)}/complete`, note ? { note } : {}),
  acknowledge: (id: string) => api.post<TaskSummary>(`${one(id)}/acknowledge`),
  outOfScope: (id: string, comment: string) => api.post<TaskSummary>(`${one(id)}/out-of-scope`, { comment }),
  comment: (id: string, body: string) => api.post<unknown>(`${one(id)}/comments`, { body }),
  returnTask: (id: string, instructions: string) => api.post<TaskSummary>(`${one(id)}/return`, { instructions }),
  remove: (id: string, reason: string) => api.post<TaskSummary>(`${one(id)}/remove`, { reason }),
  reassign: (id: string, to: Target, instructions?: string) =>
    api.post<TaskSummary>(`${one(id)}/reassign`, instructions ? { to, instructions } : { to }),
  setDue: (id: string, dueAt: string | null) => api.post<TaskSummary>(`${one(id)}/due`, { dueAt }),
  setPriority: (id: string, priority: Level) => api.post<TaskSummary>(`${one(id)}/priority`, { priority }),
}
