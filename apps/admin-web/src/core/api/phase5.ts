import { api, newIdempotencyKey } from './client'

/**
 * PHASE 5 -- stories, broadcast and call recordings.
 *
 * ONE rule shapes every signature here: a client sends an AUDIENCE, never a
 * recipient list. "The Installments label, plus the Thursday group, plus the
 * teachers" is what the operator composes and what travels on the wire; who
 * that resolves to is decided server-side by a single resolver, and this module
 * has no type that could express a recipient set even by accident.
 */

/** The audience vocabulary, mirroring `AudienceKind` on the server. */
export type AudienceKind =
  | 'all_families'
  | 'all_teachers'
  | 'assigned_families'
  | 'family'
  | 'group'
  | 'label'
  | 'teacher'
  | 'user'

/** Kinds that name no particular record, so they carry no `refId`. */
export const UNREFERENCED_AUDIENCE_KINDS: readonly AudienceKind[] = [
  'all_families',
  'all_teachers',
  'assigned_families',
]

export interface AudienceClause {
  kind: AudienceKind
  /** Omitted, not null, for the kinds above -- the server's CHECK refuses one. */
  refId?: string
}

export interface Story {
  id: string
  title: string | null
  body: string | null
  mediaKind: string | null
  mediaUrl: string | null
  state: 'draft' | 'published' | 'expired' | 'deleted'
  publishedAt: string | null
  expiresAt: string | null
  createdBy: string
  audiences?: Array<{ kind: AudienceKind; refId: string | null }>
  recipientCount?: number
  viewCount?: number
}

export interface BroadcastStatus {
  id: string
  title: string | null
  body: string
  state:
    | 'draft'
    | 'queued'
    | 'processing'
    | 'completed'
    | 'partial_failure'
    | 'failed'
    | 'cancelled'
  recipientCount: number
  /** A message was written and a notification scheduled. NOT an acknowledgement. */
  sentCount: number
  /** A real client or provider confirmed receipt. Only this is delivery. */
  deliveredCount: number
  failedCount: number
  pendingCount: number
  createdBy: string
  createdAt: string
  queuedAt: string | null
  completedAt: string | null
  audiences?: Array<{ kind: AudienceKind; refId: string | null }>
  notes?: string[]
}

export interface AudiencePreview {
  recipientCount: number
  familyCount: number
  /**
   * Clauses that reached fewer people than they name, and why.
   *
   * NOT errors. Surfaced before the send because a label spanning the academy,
   * targeted by a supervisor who holds forty of its families, legitimately
   * reaches forty -- and silently reaching forty when the operator believes
   * they are reaching four hundred is how an announcement misses the families
   * it was written for.
   */
  notes: string[]
}

export const storyApi = {
  list: () => api.get<{ stories: Story[] }>('/stories').then((r) => r.stories),

  create: (input: {
    title?: string
    body?: string
    audiences: AudienceClause[]
  }) => api.post<Story>('/stories', input),

  /** Resolve the audience and go live. Manager/Admin only, enforced server-side. */
  publish: (storyId: string) => api.post<Story>(`/stories/${storyId}/publish`),
}

export const broadcastApi = {
  list: () =>
    api.get<{ broadcasts: BroadcastStatus[] }>('/broadcasts').then((r) => r.broadcasts),

  /**
   * "How many people would this reach?"
   *
   * Answered by the SAME resolver that will do the delivery, so the number on
   * the compose screen cannot disagree with the number that gets messaged.
   */
  preview: (audiences: AudienceClause[]) =>
    api.post<AudiencePreview>('/broadcasts/preview', { audiences }),

  create: (input: { title?: string; body: string; audiences: AudienceClause[] }) =>
    // A fresh idempotency key per COMPOSE, reused by the client's own retries:
    // a request that times out and is retried must not send the announcement to
    // four hundred families twice.
    api.post<BroadcastStatus>('/broadcasts', {
      ...input,
      idempotencyKey: newIdempotencyKey(),
    }),

  /** Hand it to the workers. Returns immediately; nothing is delivered here. */
  queue: (id: string) => api.post<BroadcastStatus>(`/broadcasts/${id}/queue`),

  cancel: (id: string, reason: string) =>
    api.post<BroadcastStatus>(`/broadcasts/${id}/cancel`, { reason }),

  status: (id: string) => api.get<BroadcastStatus>(`/broadcasts/${id}`),
}

export interface RecordingPlayback {
  url: string
  expiresAt: string
  durationSeconds: number | null
}

export const recordingApi = {
  /**
   * Mint a short-lived playback URL.
   *
   * A POST rather than a GET, deliberately: minting playback is an audited act
   * that grants a capability, not a read. The URL is used immediately and never
   * stored -- it is a bearer credential, and one kept around outlives every
   * check that produced it.
   */
  playback: (recordingId: string) =>
    api.post<RecordingPlayback>(`/recordings/${recordingId}/playback`),
}
