import { api, newIdempotencyKey, request, type SessionInfoDto } from './client'
import { persistenceSupported, tokenStore } from '@/core/auth/tokens'
import { deviceLabel } from '@/core/auth/device'
import { ApiError } from './errors'
import type { Paginated, Staff, Task } from '@/shared/types/domain'

/* ---------------------------------------------------------------- session */

/** The principal the API reports (API-CONTRACT §3.2, `ActorDto`). */
export interface ActorDto {
  actorId: string
  kind: 'contact' | 'staff' | 'teacher' | 'system'
  displayName: string
  locale: string
  isActive: boolean
  staffRole: string | null
  organizationId: string | null
  /** PD-40: the caller's permission keys (UX only: the server decides every request). */
  permissions?: string[]
}

interface TokenPairDto {
  tokenType: 'Bearer'
  accessToken: string
  expiresIn: number
  refreshToken: string
  actor: ActorDto
  /** PD-23. `remembered` decides where the refresh token is kept. */
  session?: SessionInfoDto
}

/** Raised when a non-staff login (a parent, a teacher) reaches Admin Web. */
export const NOT_STAFF_CODE = 'admin.not_staff'

/**
 * Admin Web is for staff. A parent or teacher whose credentials are valid is
 * still refused here -- FAIL CLOSED: an unknown kind or a missing role is a
 * refusal, never a default role. The server enforces the same independently.
 */
export function toStaff(actor: ActorDto): Staff {
  if (actor.kind !== 'staff' || !actor.staffRole) {
    throw new ApiError({
      status: 403,
      code: NOT_STAFF_CODE,
      messageEn: 'This account cannot use the Admin Portal.',
      messageAr: 'هذا الحساب لا يمكنه استخدام بوابة الإدارة.',
    })
  }
  return {
    id: actor.actorId,
    name: actor.displayName,
    role: actor.staffRole as Staff['role'],
    presence: 'online',
    is_active: actor.isActive,
    ...(actor.permissions ? { permissions: actor.permissions } : {}),
  }
}

export const sessionApi = {
  /** Null without a session, so a signed-out load never sends a request. */
  me: async (): Promise<Staff | null> => {
    if (!tokenStore.hasSession()) return null
    return toStaff(await api.get<ActorDto>('/me'))
  },
  /**
   * `username` is the wire name of `chat.account.subject` (the decision gate
   * §5); for staff it is their email address.
   */
  /**
   * PD-23: `remember` is the "Keep me signed in on this device" tick. It is
   * only a request -- the SERVER's `session.remembered` decides where the token
   * goes (it is always false for the super admin, and absent on an older API).
   * The device name is this browser ("Chrome on macOS"), so each browser shows
   * as its own device in "My devices".
   */
  login: async (username: string, password: string, remember = false): Promise<Staff> => {
    const pair = await request<TokenPairDto>('/auth/login', {
      method: 'POST',
      body: {
        username,
        password,
        remember: remember && persistenceSupported(),
        device: { platform: 'web', name: deviceLabel() },
      },
      anonymous: true,
    })
    tokenStore.set(pair, { remembered: pair.session?.remembered === true })
    try {
      return toStaff(pair.actor)
    } catch (refusal) {
      // A parent/teacher login is valid, just not here: end the session it
      // just opened so no token outlives the refusal.
      await sessionApi.logout()
      throw refusal
    }
  },
  /**
   * PD-21: finish a password reset an administrator issued -- the login, the
   * one-time code, and a new password of the person's own. Opens no session:
   * the person signs in afterwards like anyone else.
   */
  completePasswordReset: (username: string, code: string, password: string) =>
    request<{ ok: true }>('/auth/password-reset', {
      method: 'POST',
      body: { username, code, password },
      anonymous: true,
    }),
  logout: async (): Promise<void> => {
    try {
      if (tokenStore.access()) await api.post<void>('/auth/logout')
    } finally {
      tokenStore.clear()
    }
  },
}

/* ------------------------------------------------------------------ tasks */

export const taskApi = {
  list: (filters: {
    scope: 'mine' | 'team' | 'department'
    status?: string
    type?: string
    overdue?: boolean
    cursor?: string
    limit?: number
  }) => api.get<Paginated<Task>>('/tasks', filters),
  update: (id: string, patch: Partial<Pick<Task, 'status' | 'due_at' | 'result'>>) =>
    api.patch<Task>(`/tasks/${id}`, patch, newIdempotencyKey()),
}

/* ------------------------------------------------------------------ admin */

/** GET /admin/* -- read-only, super_admin only (COMM.ADMIN_INSPECTION_DENIED otherwise). */
export interface AdminOverview {
  organization: { id: string; slug: string; displayName: string }
  accounts: Record<string, { active: number; inactive: number }>
  staffByRole: Record<string, number>
  teachers: number
  families: number
  contacts: number
  conversationsByType: Record<string, number>
  messages: number
  storiesByState: Record<string, number>
  generatedAt: string
}

export interface AdminUser {
  principalKind: 'staff' | 'teacher' | 'contact'
  id: string
  displayName: string
  staffRole: string | null
  familyId: string | null
  isActive: boolean
  hasLogin: boolean
  accountStatus: string | null
  lastLoginAt: string | null
  createdAt: string
}

export interface AdminConversation {
  id: string
  type: string
  state: string
  title: string | null
  familyId: string | null
  familyName: string | null
  liveMembers: number
  lastActivityAt: string
  createdAt: string
  archivedAt: string | null
}

export interface AdminMessage {
  id: string
  seq: string | null
  authorKind: string
  authorName: string | null
  type: string
  visibility: string
  moderation: string
  body: string | null
  deleted: boolean
  attachments: number
  createdAt: string
}


export const adminApi = {
  overview: () => api.get<AdminOverview>('/admin/overview'),
  users: () => api.get<{ users: AdminUser[]; truncated: boolean }>('/admin/users'),
  conversations: () =>
    api.get<{ conversations: AdminConversation[]; truncated: boolean }>('/admin/conversations'),
  messages: (conversationId: string) =>
    api
      .get<{ messages: AdminMessage[] }>(`/admin/conversations/${encodeURIComponent(conversationId)}/messages`)
      .then((r) => r.messages),
}

/**
 * Teacher professional profile review.
 *
 * Mirrors the API exactly and adds nothing. In particular the shapes carry NO
 * object key, NO storage path and NO reviewer id -- the server does not send
 * them, so there is nothing here to render by accident.
 *
 * `revisionId` IS present, because it is the resource handle every mutation
 * takes, exactly as a story id is. It is used in paths and query keys and is
 * never displayed.
 */
export interface ReviewCertificate {
  id: string
  title: string
  issuingOrganization: string | null
  issuedOn: string | null
  state: 'pending' | 'approved' | 'rejected'
  reviewNote: string | null
  mimeType: string
  byteSize: number
}

/**
 * One teacher with credentials awaiting a decision.
 *
 * V2 removed profile-level review: a teacher saves their own profile and the
 * save IS the publish, so there is no revision, no state and nothing to
 * approve. What survives is CERTIFICATE review -- a document claiming a
 * qualification does not become verified by being uploaded -- which is why this
 * is keyed by profile and carries no revision id.
 */
export interface CertificateReviewItem {
  /** Used as a React key and a query key. Never rendered. */
  profileId: string
  /** From chat.teacher through the server's join. Never stored client-side. */
  teacherName: string
  pendingCertificates: number
  certificates: ReviewCertificate[]
}

export const teacherProfileReviewApi = {
  pending: () =>
    api
      .get<{ profiles: CertificateReviewItem[] }>('/teacher-profiles/review')
      .then((r) => r.profiles),

  decideCertificate: (certificateId: string, approved: boolean, note?: string) =>
    api.post<CertificateReviewItem>(
      `/teacher-profiles/certificates/${certificateId}/decide`,
      { approved, note },
      newIdempotencyKey(),
    ),

  /**
   * A fresh short-lived signed URL. Requested at the moment of opening and
   * never cached: it expires, and a held URL outlives the authorization it was
   * granted under.
   */
  certificateUrl: (certificateId: string) =>
    api
      .get<{ url: string }>(`/teacher-profiles/certificates/${certificateId}/download`)
      .then((r) => r.url),
}
