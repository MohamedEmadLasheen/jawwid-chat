import { api, newIdempotencyKey } from './client'
import type {
  FamilySummary,
  Group,
  GroupHistoryEntry,
  GroupMember,
  GroupTeacher,
  Label,
  Learner,
  LifecycleEntry,
  SettableInactiveState,
  SupervisorAssignment,
  TeacherAssignment,
  BulkOutcome,
} from '@/shared/types/directory'

/**
 * THE PHASE 3 BUSINESS-MODEL ENDPOINTS.
 *
 * One typed function per route, following `core/api/conversations.ts` exactly:
 * every path here is a route the API actually serves, and the console never
 * invents one. This module ADDS to that convention; it does not replace it, and
 * there is no second client, no second key registry and no second error shape.
 *
 * The server authorizes; these only ask. Every list is already scoped to what
 * this operator may see, so nothing here filters for authorization reasons.
 */
export const familyApi = {
  /**
   * List, search and label-filter in one call. Repeating `label` INTERSECTS,
   * so "VIP + Renewal" is families carrying both.
   */
  list: (params: { q?: string; label?: string[]; activeOnly?: boolean; limit?: number } = {}) => {
    // `label` repeats, and the shared client's query serialiser takes scalars
    // only. The string is built here rather than widening that serialiser: this
    // is the one endpoint with a repeated parameter, and a local encode is a
    // smaller change than a new shape for every caller of the shared client.
    const qs = new URLSearchParams()
    if (params.q) qs.set('q', params.q)
    if (params.activeOnly) qs.set('activeOnly', 'true')
    if (params.limit) qs.set('limit', String(params.limit))
    for (const id of params.label ?? []) qs.append('label', id)
    const suffix = qs.toString()
    return api.get<{ families: FamilySummary[] }>(`/families${suffix ? `?${suffix}` : ''}`)
  },

  get: (id: string) => api.get<FamilySummary>(`/families/${id}`),

  create: (input: { displayName: string; supervisorId: string; language?: string }) =>
    api.post<FamilySummary>('/families', input, newIdempotencyKey()),

  update: (id: string, patch: { displayName?: string; language?: string; tier?: string }) =>
    api.patch<FamilySummary>(`/families/${id}`, patch, newIdempotencyKey()),

  /** Two NAMED lifecycle operations. There is no generic state setter. */
  deactivate: (id: string, reason: string, state: SettableInactiveState = 'paused') =>
    api.post<FamilySummary>(`/families/${id}/deactivate`, { reason, state }, newIdempotencyKey()),
  activate: (id: string, reason: string) =>
    api.post<FamilySummary>(`/families/${id}/activate`, { reason }, newIdempotencyKey()),

  lifecycleHistory: (id: string) =>
    api.get<{ history: LifecycleEntry[] }>(`/families/${id}/history`),

  /** Current supervisor AND every past one; the rows carry their own end. */
  assignments: (id: string) =>
    api.get<{ assignments: SupervisorAssignment[] }>(`/families/${id}/assignments`),

  transferSupervisor: (id: string, staffId: string, reason: string) =>
    api.post<SupervisorAssignment>(`/families/${id}/assignment`, { staffId, reason }, newIdempotencyKey()),

  labels: (id: string) => api.get<{ labels: Label[] }>(`/families/${id}/labels`),
}

export const learnerApi = {
  listForFamily: (familyId: string) =>
    api.get<{ learners: Learner[] }>(`/families/${familyId}/learners`),
  create: (familyId: string, input: { name: string; level?: string | null }) =>
    api.post<Learner>(`/families/${familyId}/learners`, input, newIdempotencyKey()),
  get: (id: string) => api.get<Learner>(`/learners/${id}`),
  update: (id: string, patch: { name?: string; level?: string | null }) =>
    api.patch<Learner>(`/learners/${id}`, patch, newIdempotencyKey()),
  deactivate: (id: string, reason: string) =>
    api.post<Learner>(`/learners/${id}/deactivate`, { reason }, newIdempotencyKey()),
  activate: (id: string, reason: string) =>
    api.post<Learner>(`/learners/${id}/activate`, { reason }, newIdempotencyKey()),

  /** Assign AND transfer: one route, because it is one act. */
  assignTeacher: (id: string, teacherId: string, reason: string) =>
    api.post<{ assignments: TeacherAssignment[] }>(
      `/learners/${id}/teacher`,
      { teacherId, reason },
      newIdempotencyKey(),
    ),
  teacherHistory: (id: string) =>
    api.get<{ assignments: TeacherAssignment[] }>(`/learners/${id}/teacher-history`),
}

export const groupApi = {
  list: (includeArchived = false) =>
    api.get<{ groups: Group[] }>('/groups', { includeArchived }),
  get: (id: string) => api.get<Group>(`/groups/${id}`),
  create: (input: { name: string; ownerId?: string }) =>
    api.post<Group>('/groups', input, newIdempotencyKey()),
  /** A rename never changes the id. */
  rename: (id: string, name: string) =>
    api.patch<Group>(`/groups/${id}`, { name }, newIdempotencyKey()),

  members: (id: string) => api.get<{ members: GroupMember[] }>(`/groups/${id}/members`),
  addMember: (id: string, learnerId: string) =>
    api.post<{ members: GroupMember[] }>(`/groups/${id}/members`, { learnerId }, newIdempotencyKey()),
  removeMember: (id: string, learnerId: string, reason: string) =>
    api.delete<{ members: GroupMember[] }>(`/groups/${id}/members/${learnerId}?reason=${encodeURIComponent(reason)}`),

  teachers: (id: string) => api.get<{ teachers: GroupTeacher[] }>(`/groups/${id}/teachers`),
  addTeacher: (id: string, teacherId: string) =>
    api.post<{ teachers: GroupTeacher[] }>(`/groups/${id}/teachers`, { teacherId }, newIdempotencyKey()),
  removeTeacher: (id: string, teacherId: string, reason: string) =>
    api.delete<{ teachers: GroupTeacher[] }>(`/groups/${id}/teachers/${teacherId}?reason=${encodeURIComponent(reason)}`),

  close: (id: string, reason: string) =>
    api.post<Group>(`/groups/${id}/close`, { reason }, newIdempotencyKey()),
  archive: (id: string, reason: string) =>
    api.post<Group>(`/groups/${id}/archive`, { reason }, newIdempotencyKey()),
  /** The successor gets a NEW id; the old group keeps its own and its history. */
  createReplacement: (id: string, name: string, reason: string) =>
    api.post<Group>(`/groups/${id}/replacement`, { name, reason }, newIdempotencyKey()),

  history: (id: string) => api.get<{ history: GroupHistoryEntry[] }>(`/groups/${id}/history`),
}

export const labelApi = {
  list: () => api.get<{ labels: Label[] }>('/labels'),
  create: (input: { name: string; color?: string | null; description?: string | null }) =>
    api.post<Label>('/labels', input, newIdempotencyKey()),
  /** An edit keeps the label's identity: every family stays filed under it. */
  update: (id: string, patch: { name?: string; color?: string | null; description?: string | null }) =>
    api.patch<Label>(`/labels/${id}`, patch, newIdempotencyKey()),
  /** Soft. Never reaches a family, a student or a conversation. */
  remove: (id: string, reason: string) =>
    api.delete<{ ok: true }>(`/labels/${id}?reason=${encodeURIComponent(reason)}`),

  addFamilies: (id: string, familyIds: string[]) =>
    api.post<{ outcomes: BulkOutcome[] }>(`/labels/${id}/families`, { familyIds }, newIdempotencyKey()),
  /** POST, not DELETE: the shared client sends no body on DELETE. */
  removeFamilies: (id: string, familyIds: string[]) =>
    api.post<{ outcomes: BulkOutcome[] }>(
      `/labels/${id}/families/remove`,
      { familyIds },
      newIdempotencyKey(),
    ),
}
