import { api } from '@/core/api/client'

/**
 * The conversation API Admin Web chats through -- the SAME routes the parent
 * and teacher apps use (`/conversations`, `/conversations/:id/messages`). There
 * is no admin-only copy of a conversation: a parent, a teacher and an admin
 * reading one conversation read one set of rows, and the server decides, per
 * request, what each of them may see and do (staff scope, BR-1, moderation).
 *
 * Shapes mirror apps/api/src/communication/contracts/dto.ts.
 */

export interface ChatMember {
  actorId: string
  actorKind: 'contact' | 'teacher' | 'staff' | string
  memberRole: string
  isSilent: boolean
  displayName: string
  /** Whether the VIEWER may open a 1:1 with this member (server-decided, advisory). */
  canOpenDirect?: boolean
}

/** The viewer's own preferences for a conversation (POST /:id/preferences). */
export interface ChatViewerState {
  pinned: boolean
  archived: boolean
  mutedUntil: string | null
}

/** A list-row preview; `text` is null for media, system events and deletions. */
export interface ChatLastMessage {
  seq: string | null
  type: string
  text: string | null
  systemKind: string | null
  authorKind: string
  authorId: string | null
  deleted: boolean
  createdAt: string
}

export interface ChatConversation {
  id: string
  type: 'direct' | 'student_group' | 'class_group' | 'family_group' | string
  familyId: string | null
  learnerId: string | null
  title: string | null
  state: string
  needsReply: boolean
  lastSeq: string
  lastActivityAt: string
  archivedAt: string | null
  members?: ChatMember[]
  learner?: { id: string; name: string } | null
  unreadCount?: number
  viewerState?: ChatViewerState
  lastMessage?: ChatLastMessage | null
}

export interface ChatAttachment {
  id: string
  kind: string
  mimeType: string
  url: string | null
  thumbnailUrl?: string | null
  originalName?: string | null
  byteSize?: number
  durationMs?: number | null
}

export interface ChatMessage {
  id: string
  conversationId: string | null
  /** Stringified 64-bit server sequence: the ONLY ordering key. */
  seq: string | null
  authorKind: string
  authorId: string | null
  authorDisplayName: string | null
  type: string
  body: string | null
  visibility: 'customer' | 'internal' | string
  moderation: 'published' | 'pending' | 'rejected' | string
  clientMessageId: string | null
  deletedForAll: boolean
  createdAt: string
  attachments: ChatAttachment[]
  replyToMessageId?: string | null
  /** One reaction per actor (server unique index). */
  reactions?: Array<{ actorId: string; emoji: string }>
  /**
   * Present only when `type` is `card`: what the server recorded, for the
   * client to draw (PD-11 lessons, PD-13 scheduled calls). `body` still carries
   * a plain-text rendering for a card this client does not know.
   */
  card?: { kind: string; payload: Record<string, unknown> } | null
}

export interface MessagePage {
  messages: ChatMessage[]
  nextBefore: string | null
}

export interface PendingApproval {
  approvalId: string
  conversationId: string
  messageId: string
}

/** An uploaded object, ready to be attached to a message. */
export interface UploadedAttachment {
  kind: 'image' | 'video' | 'voice' | 'file'
  objectKey: string
  mimeType: string
  byteSize: number
  originalName?: string
}

export interface SendInput {
  body: string
  clientMessageId: string
  visibility: 'customer' | 'internal'
  replyToMessageId?: string
  attachments?: UploadedAttachment[]
}

/** POST /messages/attachments/authorize: a signed, single-use upload. */
export interface UploadGrant {
  objectKey: string
  uploadUrl: string
  method: string
  headers?: Record<string, string>
  expiresAt: string
}

/** The kind the server files a picked file under; anything else goes as a file. */
export function attachmentKind(mimeType: string): UploadedAttachment['kind'] {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'voice'
  return 'file'
}

/**
 * Authorize, then PUT the bytes to the signed URL. The PUT deliberately goes
 * through plain fetch, never `api`: the URL is self-authorizing and in
 * production addresses object storage, which must not receive the session
 * bearer.
 */
async function upload(conversationId: string, file: File, visibility: 'customer' | 'internal'): Promise<UploadedAttachment> {
  const kind = attachmentKind(file.type || 'application/octet-stream')
  const mimeType = file.type || 'application/octet-stream'
  const grant = await api.post<UploadGrant>(`${conv(conversationId)}/messages/attachments/authorize`, {
    kind,
    mimeType,
    byteSize: file.size,
    visibility,
  })
  const res = await fetch(grant.uploadUrl, {
    method: grant.method || 'PUT',
    headers: { 'Content-Type': mimeType, ...(grant.headers ?? {}) },
    body: file,
  })
  if (!res.ok) throw new Error(`upload failed (${res.status})`)
  return { kind, objectKey: grant.objectKey, mimeType, byteSize: file.size, originalName: file.name }
}

const conv = (id: string) => `/conversations/${encodeURIComponent(id)}`

export const chatApi = {
  list: () => api.get<{ conversations: ChatConversation[] }>('/conversations').then((r) => r.conversations),
  get: (id: string) => api.get<ChatConversation>(conv(id)),
  /** Get or create the 1:1 with another actor; the server decides whether the pair may talk. */
  openDirect: (withActorId: string) => api.post<ChatConversation>('/conversations/direct', { withActorId }),
  /** Newest page first (`before` walks back); never `after` here -- see useThread. */
  messages: (id: string, before?: string, limit = 50) =>
    api.get<MessagePage>(`${conv(id)}/messages`, { before, limit }),
  /**
   * `clientMessageId` makes a retry return the original message instead of a
   * second one (server-side unique index), so Retry is always safe.
   */
  send: (id: string, input: SendInput) => {
    const first = input.attachments?.[0]
    return api.post<ChatMessage>(`${conv(id)}/messages`, {
      type: first ? first.kind : 'text',
      ...(input.body ? { body: input.body } : {}),
      visibility: input.visibility,
      clientMessageId: input.clientMessageId,
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    })
  },
  upload,
  react: (id: string, messageId: string, emoji: string) =>
    api.post<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}/reactions`, { emoji }),
  unreact: (id: string, messageId: string) =>
    api.delete<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}/reactions`),
  deleteForMe: (id: string, messageId: string) =>
    api.delete<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}/me`),
  /** Author within the window, or a manager; the server decides. */
  deleteForEveryone: (id: string, messageId: string) =>
    api.delete<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}`),
  /** Archive / pin / mute are the VIEWER's own preferences. */
  setPreferences: (id: string, prefs: { archived?: boolean; pinned?: boolean; mutedUntil?: string | null }) =>
    api.post<{ ok: boolean }>(`${conv(id)}/preferences`, prefs),
  /** Staff-only; every field is re-validated server-side and a reason is recorded. */
  addMember: (id: string, member: { actorId: string; actorKind: 'contact' | 'teacher'; memberRole: 'parent' | 'teacher' }, reason: string) =>
    api.post<{ ok: boolean }>(`${conv(id)}/members`, { action: 'add', ...member, reason }),
  /** Step 1 of an attachment: the server checks membership, MIME and size, then signs. */
  authorizeAttachment: (
    id: string,
    input: { kind: string; mimeType: string; byteSize: number; visibility?: 'customer' | 'internal' },
  ) =>
    api.post<UploadGrant>(`${conv(id)}/messages/attachments/authorize`, input),
  /** Step 3 of a voice note, after the bytes are uploaded. Retry-safe like `send`. */
  sendVoice: (
    id: string,
    input: {
      clientMessageId: string
      visibility: 'customer' | 'internal'
      attachment: { objectKey: string; mimeType: string; byteSize: number; durationMs: number }
    },
  ) =>
    api.post<ChatMessage>(
      `${conv(id)}/messages`,
      {
        type: 'voice',
        body: '',
        visibility: input.visibility,
        clientMessageId: input.clientMessageId,
        attachments: [{ kind: 'voice', ...input.attachment }],
      },
      input.clientMessageId,
    ),
  markRead: (id: string, upToSeq: string) =>
    api.post<{ ok: boolean }>(`${conv(id)}/messages/read`, { upToSeq }),
  /** Held teacher/parent messages in this conversation that the caller may see. */
  pendingApprovals: (id: string) =>
    api.get<{ approvals: PendingApproval[] }>('/approvals/pending', { conversationId: id }).then((r) => r.approvals),
  /** The server decides who may decide (active handler or a manager). */
  approve: (approvalId: string) => api.post<{ ok: boolean }>(`/approvals/${encodeURIComponent(approvalId)}/approve`),
  reject: (approvalId: string, reason: string) =>
    api.post<{ ok: boolean }>(`/approvals/${encodeURIComponent(approvalId)}/reject`, { reason }),
}

/** Query keys for the chat workspace; realtime events invalidate through them. */
export const chatKeys = {
  all: ['chat'] as const,
  list: ['chat', 'conversations'] as const,
  conversation: (id: string) => ['chat', 'conversation', id] as const,
  messages: (id: string) => ['chat', 'messages', id] as const,
  approvals: (id: string) => ['chat', 'approvals', id] as const,
}

/** Server order: by seq, numerically (a string compare would put "10" before "9"). */
export function bySeq(a: ChatMessage, b: ChatMessage): number {
  const x = a.seq === null ? Number.MAX_SAFE_INTEGER : Number(a.seq)
  const y = b.seq === null ? Number.MAX_SAFE_INTEGER : Number(b.seq)
  return x - y
}
