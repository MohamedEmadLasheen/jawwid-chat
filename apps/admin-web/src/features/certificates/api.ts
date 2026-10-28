import { api } from '@/core/api/client'

/**
 * PD-41 wire contract -- the Certificates page -- mirrored from
 * apps/api/src/certificates (docs/contracts/API-CONTRACT.md §3.10c). The server
 * decides every act on the locked row; `actions` is what THIS caller may do now,
 * and the page offers exactly that, never more.
 */

export type CertificateCategory = 'student' | 'teacher'
export type CertificateState =
  | 'proposed'
  | 'requested'
  | 'in_design'
  | 'changes_requested'
  | 'uploaded'
  | 'approved'
  | 'sent'
  | 'cancelled'
  | 'declined'
export type StateGroup = 'suggested' | 'pending' | 'in_progress' | 'completed' | 'sent' | 'closed'
export type CertificateAct =
  | 'edit'
  | 'resubmit'
  | 'cancel'
  | 'accept'
  | 'decline'
  | 'start'
  | 'return'
  | 'release'
  | 'upload'
  | 'approve'
  | 'redesign'
  | 'withdraw_approval'
  | 'send'
  | 'consent'
  | 'story'

export interface Person {
  id: string
  name: string
}

export interface TypeRef {
  id: string
  key: string
  labelEn: string
  labelAr: string
  isActive: boolean
  needsJuz: boolean
  needsPeriod: 'month' | 'term' | 'year' | null
}

export interface FileRef {
  id: string
  revision: number
  fileName: string
  mimeType: string
  byteSize: number
  uploadedAt: string
  uploadedBy?: Person | null
}

export interface HistoryEntry {
  seq: number
  kind: string
  fromState: CertificateState | null
  toState: CertificateState
  actor?: Person | null
  actorKind?: 'staff' | 'teacher'
  note: string | null
  at: string
}

interface Common {
  id: string
  category: CertificateCategory
  type: TypeRef | null
  state: CertificateState
  stateGroup: StateGroup
  title: string
  achievement: string
  achievedOn: string | null
  grade: string | null
  printedName: string
  juz: number | null
  periodStart: string | null
  periodEnd: string | null
  designerNote: string | null
  requestedAt: string
  assignedDesigner: Person | null
  designStartedAt: string | null
  returnMessage: string | null
  currentFile: FileRef | null
  files: FileRef[]
  actions: CertificateAct[]
  history?: HistoryEntry[]
}

/** The requester side: a requester, their cover, an overseer. */
export interface FullCertificate extends Common {
  projection: 'full'
  learner: Person | null
  teacher: Person | null
  signatoryTeacher: Person | null
  requestedBy: Person | null
  suggestedBy: Person | null
  internalNote: string | null
  publishStory: boolean
  updatedAt: string
  approval: { fileId: string; by: Person | null; at: string | null } | null
  sent: { at: string | null; by: Person | null; conversationId: string | null } | null
  suggestion: { decidedAt: string | null; decidedBy: Person | null; declineReason: string | null } | null
  consent: { kind: 'granted' | 'withdrawn'; method: string | null; recordedAt: string; recordedBy: Person | null } | null
  story: { id: string; publishedAt: string | null; withdrawnAt: string | null } | null
  cancelled: { at: string | null; by: Person | null; reason: string | null } | null
}

/** The Designer's allow-listed projection: what goes on the certificate, and the job. */
export interface DesignCertificate extends Common {
  projection: 'design'
  signatoryName: string | null
  requesterName: string | null
  delivered: boolean
}

export type Certificate = FullCertificate | DesignCertificate

export interface CategoryAccess {
  request: boolean
  deliver: boolean
  story: boolean
  oversee: boolean
}

export interface CertificateAccess {
  canOpen: boolean
  view: boolean
  design: boolean
  types: boolean
  categories: Record<CertificateCategory, CategoryAccess>
}

export interface UploadGrant {
  objectKey: string
  uploadUrl: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
}

export interface DeliveryTarget {
  conversationId: string | null
  type: string
  title: string | null
  members: number | null
}

export interface Recipient {
  id: string
  name: string
  teacher?: Person | null
}

export interface CertificateType extends TypeRef {
  category: CertificateCategory
  sort: number
  disabledAt: string | null
}

export interface ListQuery {
  category?: CertificateCategory
  status?: StateGroup
  q?: string
  cursor?: string
}

export interface RequestBody {
  category: CertificateCategory
  typeId: string
  learnerId?: string
  teacherId?: string
  printedName: string
  title?: string
  achievement?: string
  achievedOn?: string
  grade?: string
  juz?: number
  periodStart?: string
  periodEnd?: string
  designerNote?: string
  internalNote?: string
  publishStory: boolean
  requestKey: string
  confirmDuplicate?: boolean
}

export type ConsentBody =
  | { kind: 'granted'; contactId: string; method: 'in_chat' | 'phone' | 'in_person' | 'written'; evidenceMessageId?: string; note?: string }
  | { kind: 'withdrawn'; note: string }

const id = (v: string) => encodeURIComponent(v)
export interface ConsentContact {
  id: string
  name: string
  relationship: string | null
}
type One = { certificate: Certificate; replayed?: boolean; consentContacts?: ConsentContact[] }

function listQuery(q: ListQuery): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v) params.set(k, String(v))
  const s = params.toString()
  return s ? `?${s}` : ''
}

export const certificatesApi = {
  access: () => api.get<CertificateAccess>('/certificates/access'),
  list: (q: ListQuery) => api.get<{ certificates: Certificate[]; nextCursor: string | null }>(`/certificates${listQuery(q)}`),
  get: (certificateId: string) => api.get<One>(`/certificates/${id(certificateId)}`),
  types: (category?: CertificateCategory, includeDisabled = false) => {
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (includeDisabled) params.set('includeDisabled', 'true')
    const s = params.toString()
    return api.get<{ types: CertificateType[] }>(`/certificates/types${s ? `?${s}` : ''}`)
  },
  createType: (body: Omit<CertificateType, 'id' | 'isActive' | 'disabledAt' | 'sort'> & { sort?: number }) =>
    api.post<{ type: CertificateType }>('/certificates/types', body),
  updateType: (typeId: string, body: Partial<Pick<CertificateType, 'labelEn' | 'labelAr' | 'needsJuz' | 'needsPeriod' | 'isActive' | 'sort'>>) =>
    api.post<{ type: CertificateType }>(`/certificates/types/${id(typeId)}`, body),
  recipients: (category: CertificateCategory, q: string) =>
    api.get<{ recipients: Recipient[] }>(`/certificates/recipients?category=${category}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  create: (body: RequestBody) => api.post<One>('/certificates', body),
  act: (certificateId: string, path: string, body: Record<string, unknown> = {}) => api.post<One>(`/certificates/${id(certificateId)}/${path}`, body),
  delivery: (certificateId: string) => api.get<{ target: DeliveryTarget | null }>(`/certificates/${id(certificateId)}/delivery`),
  fileUrl: (certificateId: string, fileId: string) =>
    api.get<{ url: string; expiresInSeconds: number }>(`/certificates/${id(certificateId)}/files/${id(fileId)}`),
  authorizeUpload: (certificateId: string, mimeType: string, byteSize: number) =>
    api.post<{ upload: UploadGrant }>(`/certificates/${id(certificateId)}/files/upload`, { mimeType, byteSize }),
  confirmUpload: (certificateId: string, objectKey: string, fileName: string) =>
    api.post<One>(`/certificates/${id(certificateId)}/files`, { objectKey, fileName }),
}

export const certificateKeys = {
  all: ['certificates'] as const,
  access: ['certificates', 'access'] as const,
  list: (q: ListQuery) => ['certificates', 'list', q] as const,
  one: (certificateId: string) => ['certificates', 'one', certificateId] as const,
  types: (category?: CertificateCategory, includeDisabled = false) => ['certificates', 'types', category ?? 'all', includeDisabled] as const,
  recipients: (category: CertificateCategory, q: string) => ['certificates', 'recipients', category, q] as const,
  delivery: (certificateId: string) => ['certificates', 'delivery', certificateId] as const,
}

/**
 * The design file goes straight to storage on the signed URL. The key is the
 * server's (a staging namespace that is never served); confirming copies the
 * bytes to a pinned key and checks them whole before anything else sees them.
 */
export async function uploadDesign(certificateId: string, file: File): Promise<One> {
  const { upload } = await certificatesApi.authorizeUpload(certificateId, file.type, file.size)
  const response = await fetch(upload.uploadUrl, {
    method: upload.method,
    // content-length is set by the browser from the body; it is a forbidden header.
    headers: Object.fromEntries(Object.entries(upload.headers).filter(([k]) => k.toLowerCase() !== 'content-length')),
    body: file,
    credentials: 'omit',
  })
  if (!response.ok) throw new Error(`upload failed with ${response.status}`)
  return certificatesApi.confirmUpload(certificateId, upload.objectKey, file.name)
}

/** The types the server accepts, so the picker never offers what will be refused. */
export const CERTIFICATE_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'
export const MAX_CERTIFICATE_BYTES = 20 * 1024 * 1024
