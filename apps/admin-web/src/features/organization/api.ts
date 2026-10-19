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

export interface NewFamilyGroup {
  learnerIds: string[]
  contactIds: string[]
  teacherIds: string[]
  title?: string
}

export const orgApi = {
  structure: () => api.get<{ departments: Department[] }>('/org/structure'),
  learners: () => api.get<{ learners: LearnerAssignment[] }>('/org/learners'),
  assignSupervisor: (learnerId: string, body: { supervisorId: string; reason: string }) =>
    api.post<{ learnerId: string; supervisorId: string; changed: boolean }>(
      `/org/learners/${encodeURIComponent(learnerId)}/supervisor`,
      body,
    ),
  createBackup: (body: { primaryId: string; backupId: string; reason: string }) => api.post('/org/backups', body),
  activateBackup: (id: string, body: { reason: string; until?: string }) =>
    api.post(`/org/backups/${encodeURIComponent(id)}/activate`, body),
  deactivateBackup: (id: string, body: { reason: string }) =>
    api.post(`/org/backups/${encodeURIComponent(id)}/deactivate`, body),
  endBackup: (id: string, body: { reason: string }) => api.post(`/org/backups/${encodeURIComponent(id)}/end`, body),
  groupCandidates: () => api.get<{ families: CandidateFamily[] }>('/org/group-candidates'),
  createFamilyGroup: (body: NewFamilyGroup) => api.post<ChatConversation>('/conversations/family-group', body),
}

export const orgKeys = {
  structure: ['org', 'structure'] as const,
  learners: ['org', 'learners'] as const,
  candidates: ['org', 'group-candidates'] as const,
}
