import { api, newIdempotencyKey } from '@/core/api/client'

/**
 * The Stories API as the publisher sees it (apps/api story.controller.ts).
 *
 * What the console never sends is a recipient list: it states an AUDIENCE --
 * "families in the UAE on a 6-month plan" -- and the server resolves it, so
 * nothing this console gets wrong can reach a person it was not entitled to.
 */

export type StoryKind = 'text' | 'image' | 'video' | 'voice'
export type StoryState = 'draft' | 'published' | 'expired' | 'deleted'
export type CtaKind = 'whatsapp' | 'message_publisher' | 'link'
export type SegmentWho = 'everyone' | 'families' | 'teachers'

export const BACKGROUNDS = ['teal', 'gold', 'plum', 'ink', 'rose', 'sky', 'forest', 'sunset'] as const
export type Background = (typeof BACKGROUNDS)[number]

export const PLAN_MONTHS = [1, 3, 6, 12] as const
/** 4 means "four or more". */
export const CHILD_BUCKETS = [1, 2, 3, 4] as const

export interface SegmentFilter {
  who: SegmentWho
  planMonths?: number[]
  children?: number[]
  countries?: string[]
}

export interface AudienceClause {
  kind: string
  refId?: string | null
  filter?: SegmentFilter | null
}

export interface StoryCta {
  kind: CtaKind
  label: string | null
  url: string | null
  phone: string | null
}

export interface StudioStory {
  id: string
  kind: StoryKind
  internalName: string | null
  /** A pre-2026-10-17 story's title, shown to the publisher only. */
  title: string | null
  body: string | null
  background: Background | null
  mediaKind: string | null
  /** Short-lived, minted per request; null once the media is gone. */
  mediaUrl: string | null
  mediaDurationMs: number | null
  cta: StoryCta | null
  state: StoryState
  createdAt: string
  publishedAt: string | null
  expiresAt: string | null
  deletedAt: string | null
  createdBy: string
  creatorName: string
  audiences: Array<{ kind: string; refId: string | null; filter: SegmentFilter | null }>
  recipientCount: number
  viewCount: number
  ctaTapCount: number
  ctaTapperCount: number
}

export interface StoryViewerRow {
  actorId: string
  displayName: string
  actorKind: string
  viewedAt: string
  ctaTaps: number
}

export interface AudienceEstimate {
  recipients: number
  contacts: number
  teachers: number
  families: number
  excludedByReplyScope: number
}

export interface AudienceFacts {
  families: number
  contacts: number
  teachers: number
  countries: Array<{ code: string; families: number }>
  plans: Array<{ months: number; families: number }>
  children: Array<{ bucket: number; families: number }>
  unknownCountry: number
  unknownPlan: number
  noChildren: number
}

export interface FamilyAudienceRow {
  id: string
  displayName: string
  countryCode: string | null
  subscriptionPlanMonths: number | null
  childCount: number
  segmentSource: 'admin' | 'core' | null
  segmentUpdatedAt: string | null
}

export interface StoryAnalytics {
  storyId: string
  state: StoryState
  publishedAt: string | null
  reach: { total: number; contacts: number; teachers: number; families: number }
  views: { total: number; contacts: number; teachers: number }
  cta: { kind: CtaKind | null; taps: number; tappers: number }
  rates: { view: number | null; tapOfViews: number | null; tapOfReach: number | null }
  firstViewAt: string | null
  lastViewAt: string | null
  daily: Array<{ date: string; views: number; taps: number }>
  byCountry: Array<{ code: string | null; reach: number; views: number; tappers: number }>
}

export interface CreateStoryInput {
  internalName?: string
  body?: string
  background?: Background
  mediaObjectKey?: string
  mediaKind?: 'image' | 'video' | 'audio'
  mediaMime?: string
  mediaDurationMs?: number
  cta?: { kind: CtaKind; label?: string; url?: string; phone?: string } | null
  audiences: AudienceClause[]
}

interface UploadAuthorization {
  objectKey: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
}

export const studioApi = {
  list: () => api.get<{ stories: StudioStory[] }>('/stories', { drafts: 'true' }).then((r) => r.stories),
  get: (id: string) => api.get<StudioStory>(`/stories/${id}`),
  create: (input: CreateStoryInput) => api.post<StudioStory>('/stories', input, newIdempotencyKey()),
  publish: (id: string) => api.post<StudioStory>(`/stories/${id}/publish`, undefined, newIdempotencyKey()),
  remove: (id: string, reason: string) =>
    api.delete<{ ok: true; alreadyDeleted: boolean }>(`/stories/${id}`, { reason }),
  viewers: (id: string) =>
    api.get<{ viewers: StoryViewerRow[] }>(`/stories/${id}/viewers`).then((r) => r.viewers),
  analytics: (id: string, tz: string) => api.get<StoryAnalytics>(`/stories/${id}/analytics`, { tz }),
  estimate: (audiences: AudienceClause[], ctaKind: CtaKind | null) =>
    api.post<AudienceEstimate>('/stories/audience/estimate', { audiences, ctaKind }),
  facts: () => api.get<AudienceFacts>('/stories/audience/facts'),
  families: (params: { search?: string; missing?: boolean }) =>
    api.get<{ families: FamilyAudienceRow[]; truncated: boolean }>('/stories/audience/families', {
      ...(params.search ? { search: params.search } : {}),
      ...(params.missing ? { missing: 'true' } : {}),
    }),
  setFamily: (id: string, input: { countryCode?: string | null; subscriptionPlanMonths?: number | null }) =>
    api.post<FamilyAudienceRow>(`/stories/audience/families/${id}`, input),
  authorizeMedia: (mimeType: string, byteSize: number) =>
    api.post<UploadAuthorization>('/stories/media', { mimeType, byteSize }),
}

/** What a picked or recorded file becomes once it is safely in storage. */
export interface UploadedMedia {
  mediaObjectKey: string
  mediaKind: 'image' | 'video' | 'audio'
  mediaMime: string
  mediaDurationMs?: number
}

/**
 * The browser's name for a file's type, normalized to what the API accepts.
 * Chrome and Safari call an .m4a `audio/x-m4a`; the bytes are MPEG-4 audio.
 */
export function normalizeMime(type: string): string {
  const base = type.split(';')[0]!.trim().toLowerCase()
  if (base === 'audio/x-m4a' || base === 'audio/m4a') return 'audio/mp4'
  if (base === 'audio/mp3') return 'audio/mpeg'
  if (base === 'audio/x-wav' || base === 'audio/wave') return 'audio/wav'
  return base
}

export const ACCEPT: Record<'image' | 'video' | 'voice', string> = {
  image: 'image/jpeg,image/png,image/webp,image/heic',
  video: 'video/mp4,video/quicktime,video/webm',
  voice: 'audio/mp4,audio/x-m4a,audio/mpeg,audio/aac,audio/wav',
}

/**
 * Authorize, then PUT the bytes straight to storage. They never pass through
 * the API process, and the signature is bound to this exact type and size.
 * Returns what `create` needs -- never a readable URL.
 */
export async function uploadStoryMedia(file: Blob, durationMs?: number): Promise<UploadedMedia> {
  const mime = normalizeMime(file.type)
  const auth = await studioApi.authorizeMedia(mime, file.size)
  const response = await fetch(auth.uploadUrl, {
    method: auth.method,
    headers: { ...auth.headers, 'content-type': mime },
    body: file,
  })
  if (!response.ok) throw new Error(`upload failed with ${response.status}`)
  const mediaKind = mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image'
  return {
    mediaObjectKey: auth.objectKey,
    mediaKind,
    mediaMime: mime,
    ...(durationMs && durationMs > 0 ? { mediaDurationMs: Math.round(durationMs) } : {}),
  }
}

/** A media file's duration, read from its metadata; undefined when unknown. */
export function probeDuration(file: Blob, kind: 'audio' | 'video'): Promise<number | undefined> {
  return new Promise((resolve) => {
    if (typeof URL.createObjectURL !== 'function') return resolve(undefined)
    const el = document.createElement(kind)
    const url = URL.createObjectURL(file)
    const done = (ms: number | undefined) => {
      URL.revokeObjectURL(url)
      resolve(ms)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration * 1000 : undefined)
    el.onerror = () => done(undefined)
    el.src = url
  })
}
