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
}

export interface ChatAttachment {
  id: string
  kind: string
  mimeType: string
  url: string | null
  originalName?: string | null
  /** Voice notes only: the recorded length, as the sender reported it. */
  durationMs?: number | null
}

/** A signed, single-object upload (POST .../attachments/authorize). */
export interface UploadGrant {
  objectKey: string
  uploadUrl: string
  method?: string
  headers?: Record<string, string>
  expiresAt?: string
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

export interface SendInput {
  body: string
  clientMessageId: string
  visibility: 'customer' | 'internal'
}

const conv = (id: string) => `/conversations/${encodeURIComponent(id)}`

export const chatApi = {
  list: () => api.get<{ conversations: ChatConversation[] }>('/conversations').then((r) => r.conversations),
  get: (id: string) => api.get<ChatConversation>(conv(id)),
  /** Newest page first (`before` walks back); never `after` here -- see useThread. */
  messages: (id: string, before?: string, limit = 50) =>
    api.get<MessagePage>(`${conv(id)}/messages`, { before, limit }),
  /**
   * `clientMessageId` makes a retry return the original message instead of a
   * second one (server-side unique index), so Retry is always safe.
   */
  send: (id: string, input: SendInput) =>
    api.post<ChatMessage>(`${conv(id)}/messages`, {
      type: 'text',
      body: input.body,
      visibility: input.visibility,
      clientMessageId: input.clientMessageId,
    }),
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
