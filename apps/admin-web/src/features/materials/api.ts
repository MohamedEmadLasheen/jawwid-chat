import { api, download } from '@/core/api/client'
import { signedPutHeaders } from '@/features/chat/chatApi'

/**
 * PD-29 Materials, mirrored from apps/api/src/materials. The library is
 * managed by the super admin and the Teachers manager; the server decides
 * every request (GET /materials/admin/access only decides whether to offer the
 * page). An item never carries its storage key: `open` is the one call that
 * returns something to play, and it is the access decision.
 */

export type Subject = 'quran' | 'arabic' | 'islamic_studies'
export type Strand = 'memorization' | 'recitation' | 'word_meanings' | 'tafsir'
export type Kind = 'activity_package' | 'activity_link' | 'audio' | 'video' | 'pdf' | 'image'
export type ItemStatus = 'draft' | 'published' | 'retired'
export type AgeGroup = '4-6' | '7-9' | '10-12' | '13-17' | '18+'
export type MarkStatus = 'not_started' | 'in_progress' | 'memorized' | 'needs_revision'

export const SUBJECTS: readonly Subject[] = ['quran', 'arabic', 'islamic_studies']
export const STRANDS: readonly Strand[] = ['memorization', 'recitation', 'word_meanings', 'tafsir']
export const KINDS: readonly Kind[] = ['activity_package', 'activity_link', 'audio', 'video', 'pdf', 'image']
export const AGE_GROUPS: readonly AgeGroup[] = ['4-6', '7-9', '10-12', '13-17', '18+']
export const MARK_STATUSES: readonly MarkStatus[] = ['not_started', 'in_progress', 'memorized', 'needs_revision']

export interface MaterialItem {
  id: string
  externalRef: string | null
  titleAr: string | null
  titleEn: string | null
  subject: Subject
  strand: Strand | null
  kind: Kind
  source: 'url' | 'file' | 'package'
  url: string | null
  mimeType: string | null
  byteSize: number | null
  packageEntry: string | null
  ageGroups: AgeGroup[]
  surah: number | null
  description: string | null
  status: ItemStatus
  createdAt: string
  updatedAt: string
  /** On a package just added: files the package held that are never served. */
  skipped?: string[]
}

export interface ItemInput {
  externalRef?: string | null
  titleAr?: string | null
  titleEn?: string | null
  subject?: Subject
  strand?: Strand | null
  kind?: Kind | null
  ageGroups?: AgeGroup[]
  surah?: number | null
  description?: string | null
  status?: ItemStatus
  url?: string | null
  uploadToken?: string
}

export interface Surah {
  number: number
  nameAr: string
  nameEn: string
  ayahCount: number
  juz: number
  juzEnd: number
}

export interface UploadGrant {
  name: string
  uploadToken: string
  uploadUrl: string
  method: string
  headers: Record<string, string>
  expiresAt: string
}

export interface OpenResult {
  itemId: string
  kind: Kind
  mode: 'link' | 'file' | 'package'
  url: string
  mimeType?: string | null
  expiresAt?: string
}

export interface ImportFileRef {
  name: string
  mimeType?: string
  byteSize?: number
  uploadToken?: string
}

export interface ImportRow {
  row: number
  ref: string | null
  title: string | null
  action: 'create' | 'update' | 'error'
  file: string | null
  errors: string[]
  warnings: string[]
  itemId?: string
}

export interface ImportReport {
  dryRun: boolean
  committed: boolean
  summary: { rows: number; create: number; update: number; errors: number }
  unmatchedFiles: string[]
  rows: ImportRow[]
}

export interface RecitationSource {
  id: string
  name: string
  urlTemplate: string | null
  isDefault: boolean
  isActive: boolean
  tracks?: Array<{ surah: number; kind: 'url' | 'file'; url: string | null }>
}

export interface ProgressSurah {
  number: number
  nameAr: string
  nameEn: string
  ayahCount: number
  juzEnd: number
  status: MarkStatus
  updatedAt: string | null
  source: 'report' | 'report_edit' | 'correction' | null
  hasRecitation: boolean
}

export interface ProgressMap {
  child: { id: string; name: string }
  counts: Record<MarkStatus, number>
  juz: Array<{ juz: number; surahs: ProgressSurah[] }>
  canCorrect: boolean
  viewer: 'family' | 'teacher' | 'staff'
}

export interface SurahHistory {
  surah: { number: number; nameAr: string; nameEn: string }
  marks: Array<{
    id: string
    status: MarkStatus
    source: 'report' | 'report_edit' | 'correction'
    lessonId: string | null
    reason: string | null
    by: { kind: 'teacher' | 'staff'; name: string | null }
    at: string
  }>
}

export interface ItemQuery {
  subject?: Subject | ''
  status?: ItemStatus | ''
  ageGroup?: AgeGroup | ''
  q?: string
}

function clean(q: ItemQuery): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(q)) if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  return Object.keys(out).length ? out : undefined
}

export const materialsApi = {
  access: () => api.get<{ canManage: boolean }>('/materials/admin/access'),
  surahs: () => api.get<{ surahs: Surah[] }>('/materials/quran/surahs'),
  items: (q: ItemQuery) => api.get<{ items: MaterialItem[] }>('/materials/admin/items', clean(q)),
  create: (body: ItemInput) => api.post<MaterialItem>('/materials/admin/items', body),
  update: (id: string, body: ItemInput) => api.post<MaterialItem>(`/materials/admin/items/${encodeURIComponent(id)}`, body),
  open: (id: string) => api.post<OpenResult>(`/materials/items/${encodeURIComponent(id)}/open`),
  uploads: (files: Array<{ name: string; mimeType: string; byteSize: number }>, purpose: 'item' | 'recitation' = 'item') =>
    api.post<{ uploads: UploadGrant[] }>('/materials/admin/uploads', { purpose, files }),
  import: (body: { manifest: string; format: 'csv' | 'json'; files: ImportFileRef[]; dryRun: boolean }) =>
    api.post<ImportReport>('/materials/admin/import', body),
  template: () => download('/materials/admin/import/template.csv'),
  recitations: () => api.get<{ sources: RecitationSource[] }>('/materials/admin/recitations'),
  createSource: (body: { name: string; urlTemplate?: string | null; isDefault?: boolean }) =>
    api.post<RecitationSource>('/materials/admin/recitations/sources', body),
  updateSource: (id: string, body: Partial<Pick<RecitationSource, 'name' | 'urlTemplate' | 'isDefault' | 'isActive'>>) =>
    api.post<RecitationSource>(`/materials/admin/recitations/sources/${encodeURIComponent(id)}`, body),
  setTrack: (id: string, surah: number, body: { url: string } | { uploadToken: string } | { clear: true }) =>
    api.post<{ sources: RecitationSource[] }>(`/materials/admin/recitations/sources/${encodeURIComponent(id)}/surahs/${surah}`, body),
  progress: (learnerId: string) => api.get<ProgressMap>(`/learners/${encodeURIComponent(learnerId)}/materials/progress`),
  history: (learnerId: string, surah: number) =>
    api.get<SurahHistory>(`/learners/${encodeURIComponent(learnerId)}/materials/progress/${surah}`),
  correct: (learnerId: string, surah: number, body: { status: MarkStatus; reason: string }) =>
    api.post<SurahHistory>(`/learners/${encodeURIComponent(learnerId)}/materials/progress/${surah}/correct`, body),
}

export const materialsKeys = {
  all: ['materials'] as const,
  access: ['materials', 'access'] as const,
  surahs: ['materials', 'surahs'] as const,
  items: (q: ItemQuery) => ['materials', 'items', q] as const,
  recitations: ['materials', 'recitations'] as const,
  progress: (learnerId: string) => ['materials', 'progress', learnerId] as const,
  history: (learnerId: string, surah: number) => ['materials', 'progress', learnerId, surah] as const,
}

/**
 * PUT one file's bytes to its signed URL. Plain fetch, never `api`: the URL is
 * self-authorizing and in production addresses object storage, which must not
 * receive the session bearer.
 */
export async function putToStorage(grant: UploadGrant, file: Blob): Promise<void> {
  const res = await fetch(grant.uploadUrl, {
    method: grant.method || 'PUT',
    headers: signedPutHeaders(file.type, grant.headers),
    body: file,
    credentials: 'omit',
  })
  if (!res.ok) throw new Error(`upload failed (${res.status})`)
}

/** The MIME type a picked file is uploaded as: the browser's, or by extension for types browsers often leave blank. */
export function mimeOf(file: File): string {
  if (file.type) return file.type === 'application/x-zip-compressed' ? 'application/zip' : file.type
  const ext = file.name.split('.').pop()?.toLowerCase()
  const byExt: Record<string, string> = {
    zip: 'application/zip', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', pdf: 'application/pdf',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  }
  return (ext && byExt[ext]) || 'application/octet-stream'
}

/** Upload one picked file for an item or a recitation; returns its upload token. */
export async function uploadOne(file: File, purpose: 'item' | 'recitation' = 'item'): Promise<string> {
  const mimeType = mimeOf(file)
  const { uploads } = await materialsApi.uploads([{ name: file.name, mimeType, byteSize: file.size }], purpose)
  const grant = uploads[0]!
  await putToStorage(grant, file.type === mimeType ? file : new Blob([file], { type: mimeType }))
  return grant.uploadToken
}
