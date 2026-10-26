import { api } from '@/core/api/client'
import type { ChatConversation } from '@/features/chat/chatApi'

/**
 * `/org/*` and `POST /conversations/family-group` -- the PD-8 wire contract,
 * mirrored from apps/api/src/org/org-structure.service.ts. Who may do what is
 * decided there (and by the database); this page offers controls, the server
 * answers each request on its own.
 */

export type DepartmentKind = 'operations' | 'teachers' | 'sales'
export type Position = 'supervisor' | 'backup_supervisor'
export type BackupStatus = 'dormant' | 'active' | 'expired' | 'deactivated' | 'ended'

export interface OrgPerson {
  id: string
  name: string
  role: string
  isActive: boolean
}

export interface DepartmentMember extends OrgPerson {
  position: Position
  learnerCount: number
}

export interface BackupLink {
  id: string
  primary: OrgPerson | null
  backup: OrgPerson | null
  status: BackupStatus
  activatedAt: string | null
  activeUntil: string | null
}

export interface Department {
  id: string
  kind: DepartmentKind
  displayName: string
  manager: OrgPerson | null
  members: DepartmentMember[]
  backups: BackupLink[]
}

export interface LearnerAssignment {
  learnerId: string
  name: string
  family: { id: string; displayName: string }
  teacher: { id: string; name: string } | null
  supervisor: { id: string; name: string } | null
}

export interface CandidateFamily {
  familyId: string
  displayName: string
  parents: Array<{ id: string; name: string }>
  children: Array<{
    id: string
    name: string
    supervisor: { id: string; name: string }
    teacher: { id: string; name: string } | null
  }>
}

/** PD-24: what a transfer moved -- every child of the unit, with the counts of what followed. */
export interface TransferResult {
  supervisorId: string
  changed: boolean
  learners: Array<{ id: string; name: string }>
  groups: number
  directChats: number
}

export interface NewFamilyGroup {
  learnerIds: string[]
  contactIds: string[]
  teacherIds: string[]
  title?: string
}

/** PD-35: a teacher and their supervisor in the Teachers department. */
export interface TeacherAssignment {
  id: string
  name: string
  isActive: boolean
  supervisor: { id: string; name: string } | null
  assignedAt: string | null
}

export interface TeacherAssignments {
  /** TEACHER_SUPERVISOR_STRICT_SCOPE on this deployment: supervisors work on their own teachers only. */
  strictScope: boolean
  /** Active teachers with no supervisor. */
  unassigned: number
  teachers: TeacherAssignment[]
  /** The Teachers department's primary supervisors. */
  supervisors: Array<{ id: string; name: string }>
/** PD-33: a supervisor away, a backup covering, as GET/POST /org/covers return it. */
export interface Cover {
  id: string
  supervisor: { id: string; name: string }
  backup: { id: string; name: string }
  startsAt: string
  endsAt: string
  endedAt: string | null
  endKind: 'returned' | 'ended_early' | 'link_ended' | null
  note: string | null
  status: 'scheduled' | 'active' | 'ended'
  canExtend: boolean
  canEnd: boolean
}

export interface EligibleBackup {
  id: string
  name: string
  linked: boolean
  covering: number
  /** Why this backup cannot cover now; null when they can. */
  blocked: 'inactive' | 'away' | 'at_limit' | 'not_linked' | null
  blockedReason: string | null
}

export interface CoverPreview {
  supervisor: { id: string; name: string }
  backup: { id: string; name: string } | null
  eligibleBackups: EligibleBackup[]
  maxDays: number
  openCover: Cover | null
  counts: {
    families: number
    groups: number
    directs: number
    openItems: { approvals: number; instalments: number; newStudents: number; total: number }
  }
}

export interface MyCover {
  canHandOver: boolean
  away: Cover | null
  covering: Cover[]
}

export interface StartCover {
  supervisorId: string
  backupId: string
  from?: string
  until: string
  note?: string
}

export const orgApi = {
  structure: () => api.get<{ departments: Department[] }>('/org/structure'),
  learners: () => api.get<{ learners: LearnerAssignment[] }>('/org/learners'),
  assignSupervisor: (learnerId: string, body: { supervisorId: string; reason: string }) =>
    api.post<{ learnerId: string; supervisorId: string; changed: boolean }>(
      `/org/learners/${encodeURIComponent(learnerId)}/supervisor`,
      body,
    ),
  /** PD-24: a student or family group, with all its children, moves to another supervisor. */
  transferGroup: (conversationId: string, body: { supervisorId: string; reason: string }) =>
    api.post<TransferResult>(`/org/conversations/${encodeURIComponent(conversationId)}/supervisor`, body),
  createBackup: (body: { primaryId: string; backupId: string; reason: string }) => api.post('/org/backups', body),
  activateBackup: (id: string, body: { reason: string; until?: string }) =>
    api.post(`/org/backups/${encodeURIComponent(id)}/activate`, body),
  deactivateBackup: (id: string, body: { reason: string }) =>
    api.post(`/org/backups/${encodeURIComponent(id)}/deactivate`, body),
  endBackup: (id: string, body: { reason: string }) => api.post(`/org/backups/${encodeURIComponent(id)}/end`, body),
  groupCandidates: () => api.get<{ families: CandidateFamily[] }>('/org/group-candidates'),
  createFamilyGroup: (body: NewFamilyGroup) => api.post<ChatConversation>('/conversations/family-group', body),
  /** PD-35: the Teachers Manager's and the super admin's. */
  teacherAssignments: () => api.get<TeacherAssignments>('/org/teacher-assignments'),
  assignTeacher: (teacherId: string, supervisorId: string | null) =>
    api.post<{ teacherId: string; supervisorId: string | null }>(`/org/teachers/${encodeURIComponent(teacherId)}/supervisor`, { supervisorId }),
  // PD-33 "Hand over to backup"
  coverPreview: (supervisorId: string, backupId?: string) =>
    api.get<CoverPreview>(
      `/org/covers/preview?supervisorId=${encodeURIComponent(supervisorId)}${backupId ? `&backupId=${encodeURIComponent(backupId)}` : ''}`,
    ),
  covers: () => api.get<{ covers: Cover[] }>('/org/covers?active=true'),
  myCover: () => api.get<MyCover>('/me/cover'),
  startCover: (body: StartCover) => api.post<Cover>('/org/covers', body),
  extendCover: (id: string) => api.post<Cover>(`/org/covers/${encodeURIComponent(id)}/extend`, {}),
  endCover: (id: string) => api.post<Cover>(`/org/covers/${encodeURIComponent(id)}/end`, {}),
}

export const orgKeys = {
  structure: ['org', 'structure'] as const,
  learners: ['org', 'learners'] as const,
  candidates: ['org', 'group-candidates'] as const,
  teacherAssignments: ['org', 'teacher-assignments'] as const,
  covers: ['org', 'covers'] as const,
  myCover: ['org', 'my-cover'] as const,
  coverPreview: (supervisorId: string, backupId: string) => ['org', 'cover-preview', supervisorId, backupId] as const,
}
