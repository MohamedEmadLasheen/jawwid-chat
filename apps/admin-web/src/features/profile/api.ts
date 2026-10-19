import { api } from '@/core/api/client'

/**
 * `/staff-profiles` -- the wire contract, mirrored from
 * apps/api/src/staff-profile/staff-profile.service.ts.
 *
 * Every flag in `access` is the SERVER's verdict for this viewer and this
 * profile. The page shows a control only when its flag is true, and the server
 * refuses the request anyway if it is not -- the flags are a description of
 * what will be honoured, never a grant.
 */

export type ProfileRelation = 'self' | 'team' | 'organization' | 'none'

export interface StaffProfileAccess {
  relation: ProfileRelation
  canView: boolean
  canEditProfessional: boolean
  canEditPhoto: boolean
  canEditDisplayName: boolean
  canManageResponsibilities: boolean
  canManageReportingLine: boolean
  canReadAudit: boolean
}

export interface StaffWorkload {
  assignedFamilies: number
  studentsInAssignedFamilies: number
  parentContacts: number
  teachersOfAssignedStudents: number
  openConversations: number
  awaitingReply: number
  pendingApprovals: number
  directReports: number
}

export type CompletenessField = 'photo' | 'job_title' | 'about' | 'reporting_line' | 'responsibility'

export interface Completeness {
  complete: number
  total: number
  missing: CompletenessField[]
}

export interface ProfilePerson {
  staffId: string
  displayName: string
  role: string
  jobTitle: string | null
  avatarUrl: string | null
}

export interface Responsibility {
  id: string
  category: string
  scopeNote: string | null
  assignedAt: string
  assignedBy: { staffId: string; displayName: string } | null
  endedAt: string | null
  endReason: string | null
}

export interface DerivedResponsibility {
  kind: 'family_supervision' | 'team_management' | 'coverage_role'
  count: number | null
}

export interface StaffProfile {
  staffId: string
  displayName: string
  role: string
  isActive: boolean
  leftAt: string | null
  joinedAt: string
  lastActivityAt: string | null
  account: { hasLogin: boolean; status: string | null; lastLoginAt: string | null }
  signInIdentity: string | null
  jobTitle: string | null
  about: string | null
  avatarUrl: string | null
  version: string | null
  profileUpdatedAt: string | null
  profileUpdatedBy: { staffId: string; displayName: string } | null
  reportingManager: ProfilePerson | null
  responsibilities: Responsibility[]
  derivedResponsibilities: DerivedResponsibility[]
  workload: StaffWorkload
  completeness: Completeness
  access: StaffProfileAccess
  /** What the viewer may open beyond this profile -- the server's answer, not a role check. */
  viewer: { team: boolean; organizationOverview: boolean }
  generatedAt: string
}

export interface StaffSummary {
  staffId: string
  displayName: string
  role: string
  jobTitle: string | null
  avatarUrl: string | null
  isActive: boolean
  account: { hasLogin: boolean; status: string | null }
  lastActivityAt: string | null
  profileUpdatedAt: string | null
  joinedAt: string
  reportingManager: { staffId: string; displayName: string; role: string } | null
  responsibilities: string[]
  workload: StaffWorkload
  completeness: Completeness
  access: Pick<StaffProfileAccess, 'relation' | 'canEditProfessional' | 'canManageResponsibilities' | 'canManageReportingLine'>
}

export interface Team {
  manager: ProfilePerson
  members: StaffSummary[]
  totals: StaffWorkload
  distinctTeachers: number
  generatedAt: string
}

export interface ActivityEntry {
  id: string
  action: string
  at: string
  target: { staffId: string; displayName: string | null }
  actor: { staffId: string; displayName: string } | null
  changedFields: string[]
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  reason: string
}

export interface OrganizationTotals {
  families: number
  studentsInFamilies: number
  activeParentContacts: number
  activeTeachers: number
  teachersWithStudents: number
  openConversations: number
  awaitingReply: number
  pendingApprovals: number
  familiesOwnedByInactiveStaff: number
}

export interface OrganizationOverview {
  generatedAt: string
  accounts: {
    byRole: Record<string, { active: number; inactive: number }>
    managers: number
    adminsAndSupervisors: number
    active: number
    inactive: number
    withoutLogin: number
  }
  teams: Array<{
    manager: ProfilePerson & { isActive: boolean }
    memberCount: number
    totals: StaffWorkload
    distinctTeachers: number
  }>
  responsibilityCoverage: Array<{ category: string; holders: Array<{ staffId: string; displayName: string }> }>
  workload: {
    unique: OrganizationTotals
    sumOfTeams: Pick<StaffWorkload, 'assignedFamilies' | 'studentsInAssignedFamilies' | 'openConversations' | 'pendingApprovals'>
    familiesOutsideTeams: number
  }
  health: {
    withoutReportingLine: ProfilePerson[]
    incompleteProfiles: Array<ProfilePerson & { missing: CompletenessField[] }>
    withoutLogin: ProfilePerson[]
    staleReportingLines: Array<{ member: ProfilePerson; manager: ProfilePerson }>
    familiesOwnedByInactiveStaff: number
  }
  directory: StaffSummary[]
  directoryTruncated: boolean
  recentActivity: ActivityEntry[]
}

export interface AvatarUploadGrant {
  objectKey: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
}

/** The categories the server accepts (mirrors the CHECK on chat.staff_responsibility). */
export const RESPONSIBILITY_CATEGORIES = [
  'family_follow_up',
  'student_follow_up',
  'teacher_supervision',
  'teaching_quality',
  'academic_progress',
  'attendance_monitoring',
  'operations_scheduling',
  'message_moderation',
  'content_materials',
  'customer_support',
  'complaints_escalations',
  'sales_admissions',
  'team_management',
  'other',
] as const

export const JOB_TITLE_MAX = 80
export const ABOUT_MAX = 1500
export const DISPLAY_NAME_MAX = 80
export const NOTE_MAX = 280

const path = (ref: string) => `/staff-profiles/${encodeURIComponent(ref)}`

export const profileKeys = {
  all: ['staff-profiles'] as const,
  profile: (ref: string) => ['staff-profiles', 'profile', ref] as const,
  team: ['staff-profiles', 'team'] as const,
  organization: ['staff-profiles', 'organization'] as const,
  activity: (ref: string) => ['staff-profiles', 'activity', ref] as const,
}

export const staffProfileApi = {
  get: (ref: string) => api.get<StaffProfile>(path(ref)),
  team: () => api.get<Team>('/staff-profiles/team'),
  organization: () => api.get<OrganizationOverview>('/staff-profiles/organization'),
  activity: (ref: string) => api.get<{ entries: ActivityEntry[] }>(`${path(ref)}/activity`),

  update: (
    ref: string,
    body: { jobTitle?: string | null; about?: string | null; displayName?: string; expectedVersion?: string | null; reason?: string },
  ) => api.patch<StaffProfile>(path(ref), body),

  authorizeAvatar: (ref: string, mimeType: string, byteSize: number) =>
    api.post<AvatarUploadGrant>(`${path(ref)}/avatar/upload`, { mimeType, byteSize }),
  commitAvatar: (ref: string, objectKey: string) =>
    api.post<StaffProfile>(`${path(ref)}/avatar`, { objectKey }),
  removeAvatar: (ref: string) => api.delete<StaffProfile>(`${path(ref)}/avatar`),

  assign: (ref: string, category: string, scopeNote: string | null) =>
    api.post<StaffProfile>(`${path(ref)}/responsibilities`, { category, scopeNote }),
  end: (ref: string, responsibilityId: string, reason: string) =>
    api.post<StaffProfile>(`${path(ref)}/responsibilities/${encodeURIComponent(responsibilityId)}/end`, { reason }),
  setReportingLine: (ref: string, managerStaffId: string | null, reason: string) =>
    api.post<StaffProfile>(`${path(ref)}/reporting-line`, { managerStaffId, reason }),
}

/**
 * Upload the prepared photo straight to storage on the signed URL, then commit
 * it. The bytes never pass through this console's API calls; the server then
 * reads them back and inspects them before the profile points at them.
 */
export async function uploadAvatar(ref: string, photo: Blob): Promise<StaffProfile> {
  const grant = await staffProfileApi.authorizeAvatar(ref, photo.type, photo.size)
  const response = await fetch(grant.uploadUrl, {
    method: grant.method,
    // content-length is set by the browser from the body; it is a forbidden header.
    headers: Object.fromEntries(Object.entries(grant.headers).filter(([k]) => k.toLowerCase() !== 'content-length')),
    body: photo,
    credentials: 'omit',
  })
  if (!response.ok) throw new UploadError(response.status)
  return staffProfileApi.commitAvatar(ref, grant.objectKey)
}

export class UploadError extends Error {
  constructor(readonly status: number) {
    super(`upload failed with ${status}`)
    this.name = 'UploadError'
  }
}
