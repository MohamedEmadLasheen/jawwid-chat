import { api } from '@/core/api/client'

/**
 * PD-48: the Lesson audio review page's API (docs/product/pd048-lesson-voice-over-design.md §9).
 * Clips are named by id, never by an object key; every URL here is one the
 * server signed for this reviewer after its own checks.
 */
export interface LessonAudioAccess {
  view: boolean
  review: boolean
}

export type StringStatus = 'approved' | 'pending' | 'needsDecision' | 'noAudio' | 'none'

export interface UnitSummary {
  unit: string
  strings: number
  approved: number
  pending: number
  needsDecision: number
  noAudio: number
  none: number
}

export interface LessonSummary {
  lesson: string
  lessonApproved: boolean
  approvalsRequired: number
  units: UnitSummary[]
}

export interface ClipView {
  clipId: string
  state: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  attempt: number
  vendor: string
  voice: string
  renderSha256: string
  audioSha256: string
  createdAt: string
  approvals: Array<{ by: string; at: string }>
  rejections: Array<{ action: 'reject' | 'withdraw'; by: string; category: string | null; reason: string | null; at: string }>
  approvedByMe: boolean
  canReview: boolean
  url: string | null
}

export interface StringView {
  id: string
  kind: 'name' | 'word' | 'note'
  text: string
  textSha256: string
  status: StringStatus
  decisions: Array<{ decision: 'no_audio' | 'one_more_round'; by: string; reason: string; at: string }>
  clips: ClipView[]
}

export interface UnitView {
  lesson: string
  unit: string
  approvalsRequired: number
  strings: StringView[]
}

export const REJECT_CATEGORIES = ['vowel', 'final_sukun', 'shadda', 'hamza', 'letter_sound', 'stress', 'noise', 'wrong_word', 'other'] as const
export type RejectCategory = (typeof REJECT_CATEGORIES)[number]

/** The lessons with voice-over. Lesson 1 first (PD-48 §15); others follow as they are built. */
export const LESSONS = ['arabic-001'] as const

const seg = (s: string) => encodeURIComponent(s)

export const lessonAudioApi = {
  access: () => api.get<LessonAudioAccess>('/lesson-audio/access'),
  summary: (lesson: string) => api.get<LessonSummary>(`/lesson-audio/review/${seg(lesson)}`),
  unit: (lesson: string, unit: string) => api.get<UnitView>(`/lesson-audio/review/${seg(lesson)}/units/${seg(unit)}`),
  /** The hashes are what THIS browser fetched and played: the server refuses an approval of anything else. */
  approve: (clipId: string, heard: { textSha256: string; audioSha256: string }) =>
    api.post<{ clipId: string; state: string }>(`/lesson-audio/clips/${seg(clipId)}/approve`, heard),
  reject: (clipId: string, body: { textSha256: string; audioSha256: string; category: RejectCategory; reason: string }) =>
    api.post<{ clipId: string; state: string }>(`/lesson-audio/clips/${seg(clipId)}/reject`, body),
  withdraw: (clipId: string, body: { textSha256: string; audioSha256: string; category: RejectCategory; reason: string }) =>
    api.post<{ clipId: string; state: string }>(`/lesson-audio/clips/${seg(clipId)}/withdraw`, body),
  decide: (lesson: string, stringId: string, body: { decision: 'no_audio' | 'one_more_round'; reason: string }) =>
    api.post<{ decision: string }>(`/lesson-audio/strings/${seg(lesson)}/${seg(stringId)}/decision`, body),
}

export const lessonAudioKeys = {
  all: ['lesson-audio'] as const,
  access: ['lesson-audio', 'access'] as const,
  summary: (lesson: string) => ['lesson-audio', 'summary', lesson] as const,
  unit: (lesson: string, unit: string) => ['lesson-audio', 'unit', lesson, unit] as const,
}
