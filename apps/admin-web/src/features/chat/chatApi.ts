import { api, download } from '@/core/api/client'
import type { PaymentLock } from '@/features/subscriptions/api'

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
  /** Their profile photo: a signed link for this viewer in this conversation, or null. */
  avatarUrl?: string | null
}

/** The viewer's own preferences for a conversation (POST /:id/preferences). */
export interface ChatViewerState {
  pinned: boolean
  /** In the viewer's own Favorites list. Absent from servers that predate it. */
  favorite?: boolean
  archived: boolean
  mutedUntil: string | null
  /** The viewer's OWN background preset for this chat; null/absent = default. */
  theme?: ChatTheme | null
  /** The viewer's OWN wallpaper photo, signed for them; null/absent = none. */
  wallpaperUrl?: string | null
  /**
   * PD-36: the viewer's own open or unseen mention here. An unseen `summons`
   * puts the row at the very top ("Mentioned"); a `member` mention is an "@"
   * on the row until the chat is opened.
   */
  mention?: ChatViewerMention | null
  /** PD-35, staff: the viewer's open visible seat here (joined by choice); null/absent = none. */
  seat?: { reason: string; joinedAt: string; effective: boolean } | null
}

/** PD-36: the viewer was mentioned here. */
export interface ChatViewerMention {
  mentionId: string
  /** 'summons': asked to step in while not a member. 'member': a highlight and a ping. */
  kind: 'member' | 'summons'
  /** 'pending' (a summons waiting for an answer) or 'notified' (a member's). */
  state: string
  mentionedById: string
  at: string
  seen: boolean
  expiresAt: string | null
}

/** PD-36: someone asked in who is not a member -- the top of Group Info. */
export interface ChatSummoned {
  mentionId: string
  actorId: string
  displayName: string
  staffRole: string
  /** 'pending': asked in and waiting. */
  state: string
  mentionedById: string
  mentionedByName: string | null
  at: string
  expiresAt: string | null
}

/** PD-36: an "@..." chip in a message, by UTF-16 offset into `body`. */
export interface ChatMention {
  start: number
  length: number
  actorId: string | null
  role: 'supervisor' | 'admin' | null
}

/** PD-36: who the @ picker offers -- exactly who a send would accept. */
export interface MentionCandidates {
  people: Array<{ actorId: string; actorKind: string; displayName: string; staffRole: string | null; isMember: boolean }>
  roles: Array<'supervisor' | 'admin'>
}


/** PD-35: a group of one of the viewer's teachers that they may join. Never its messages. */
export interface SeatCandidate {
  conversationId: string
  type: string
  title: string | null
  teacher: { id: string; name: string }
  learners: string[]
  lastActivityAt: string | null
  /** 'none' = may join; 'seated' = joined (may leave); 'member' = a member in their own right. */
  membership: 'none' | 'seated' | 'member'
}

/** The eight background presets (the server's CHAT_THEMES). */
export const CHAT_THEMES = ['lagoon', 'sand', 'rose', 'sky', 'lilac', 'olive', 'slate', 'dusk'] as const
export type ChatTheme = (typeof CHAT_THEMES)[number]

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
  learner?: { id: string; name: string; avatarUrl?: string | null } | null
  unreadCount?: number
  viewerState?: ChatViewerState
  /**
   * PD-14: the author kinds ('teacher' | 'contact' | 'staff') whose sent
   * messages this viewer may edit or delete for everyone. Detail route only; a
   * hint for the menu -- the server decides again.
   */
  viewerModerates?: string[]
  lastMessage?: ChatLastMessage | null
  /** A group's picture: its one child's photo, signed for this viewer; null otherwise. */
  avatarUrl?: string | null
  /** The viewer's OWN private labels on this chat (staff only). */
  labels?: ChatLabel[]
  /** PD-33: the supervisor here is away and this backup covers until `until`; null when nobody covers. */
  cover?: ChatCover | null
  /** PD-36: people asked to step in who are not members (detail route). */
  summoned?: ChatSummoned[]
  /** PD-30: the group is locked for payment (detail route only); null otherwise. */
  paymentLock?: PaymentLock | null
}

export interface ChatCover {
  supervisorId: string
  supervisorName: string
  coverId: string
  coverName: string
  until: string
}

/** A staff member's private label. `color` is a palette tone '1'..'8'. */
export interface ChatLabel {
  id: string
  name: string
  color: string
}

export interface QuickReply {
  id: string
  shortcut: string
  body: string
  /** 'team': the shared library anyone on staff may edit; 'mine': the viewer's own. */
  scope: 'team' | 'mine'
  updatedAt: string
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
  /** When the author last edited it; `body` is already the edited wording. */
  editedAt?: string | null
  attachments: ChatAttachment[]
  replyToMessageId?: string | null
  /** The author's profile photo, signed for this viewer in this conversation; null when none. */
  authorAvatarUrl?: string | null
  /** One reaction per actor (server unique index). */
  reactions?: Array<{ actorId: string; emoji: string }>
  /**
   * Present only when `type` is `card`: what the server recorded, for the
   * client to draw (PD-11 lessons, PD-13 scheduled calls). `body` still carries
   * a plain-text rendering for a card this client does not know.
   */
  card?: { kind: string; payload: Record<string, unknown> } | null
  /** A copy forwarded by its author; shown as "Forwarded" (the source is never named). */
  forwarded?: boolean
  /** The viewer's private bookmark. */
  starred?: boolean
  /** Pinned for everyone in this conversation (at most three). */
  pinned?: boolean
  /**
   * PD-21: an administrator sent it in a support session, acting as its
   * author. Shown to everyone as "Sent by support".
   */
  sentBySupport?: boolean
  /** PD-36: the "@..." chips in `body`. */
  mentions?: ChatMention[]
  /** PD-36: this viewer is one of the people mentioned. */
  mentionsViewer?: boolean
  /** PD-36, send response only: some mentions went over a limit and stayed plain text. */
  mentionsLimited?: boolean
}

/** How long after sending the server lets an author edit (communication.edit_window_minutes). */
export const EDIT_WINDOW_MS = 15 * 60_000

export interface MessagePage {
  messages: ChatMessage[]
  nextBefore: string | null
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
  /** PD-36: the "@..." spans in `body`. */
  mentions?: SendMention[]
}

/** PD-36: one "@..." in the text being sent: a person, or (parents only) a role. */
export type SendMention =
  | { start: number; length: number; actorId: string }
  | { start: number; length: number; role: 'supervisor' | 'admin' }

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
 * The headers for a signed PUT: exactly the grant's, plus a content type only
 * when the grant does not name one. Storage signs `content-type`, and spreading
 * the grant over our own `Content-Type` sent BOTH (different case, so `fetch`
 * joined them: "image/webp, image/webp") -- a value no signature or type check
 * accepts.
 */
export function signedPutHeaders(mimeType: string, grantHeaders: Record<string, string> | undefined): Headers {
  const headers = new Headers(grantHeaders ?? {})
  if (!headers.has('content-type')) headers.set('content-type', mimeType)
  return headers
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
    headers: signedPutHeaders(mimeType, grant.headers),
    body: file,
  })
  if (!res.ok) throw new Error(`upload failed (${res.status})`)
  return { kind, objectKey: grant.objectKey, mimeType, byteSize: file.size, originalName: file.name }
}

const conv = (id: string) => `/conversations/${encodeURIComponent(id)}`

/** A wallpaper: authorize, PUT the bytes (plain fetch, never the bearer), then commit. */
async function uploadWallpaper(conversationId: string, blob: Blob): Promise<{ wallpaperUrl: string }> {
  const grant = await api.post<UploadGrant>(`${conv(conversationId)}/wallpaper/upload`, { mimeType: blob.type, byteSize: blob.size })
  const res = await fetch(grant.uploadUrl, {
    method: grant.method || 'PUT',
    headers: signedPutHeaders(blob.type, grant.headers),
    body: blob,
  })
  if (!res.ok) throw new Error(`upload failed (${res.status})`)
  return api.post<{ wallpaperUrl: string }>(`${conv(conversationId)}/wallpaper`, { objectKey: grant.objectKey })
}

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
      ...(input.mentions?.length ? { mentions: input.mentions } : {}),
    })
  },
  upload,
  /** PD-36: the @ picker -- members, plus the staff in charge who may be asked in. */
  mentionCandidates: (id: string, q: string) =>
    api.get<MentionCandidates>(`${conv(id)}/mention-candidates`, q ? { q } : undefined),
  /** PD-36: the viewer opened the chat; their "Mentioned" badges here go. */
  markMentionsSeen: (id: string) => api.post<void>(`${conv(id)}/mentions/seen`),
  /** PD-36: "Not for me" -- or, after stepping into a 1:1, step back out. */
  dismissMention: (mentionId: string) =>
    api.post<{ state: string }>(`/mentions/${encodeURIComponent(mentionId)}/dismiss`),
  /**
   * PD-36 -> PD-35: answer a mention by taking a VISIBLE seat -- a member seat in
   * a group ("Laila joined"), an effective seat in a family 1:1 (no third member).
   */
  joinOnMention: (id: string, mentionId: string) =>
    api.post<{ id: string }>(`${conv(id)}/join`, { reason: 'mention', sourceId: mentionId }),
  /**
   * Forward messages of conversation `id` into up to ten others. The server
   * checks each source is readable here and each destination writable; media
   * are copied into each destination.
   */
  forward: (id: string, messageIds: string[], toConversationIds: string[]) =>
    api.post<{ sent: ChatMessage[] }>(`${conv(id)}/messages/forward`, { messageIds, toConversationIds }),
  labels: () => api.get<{ labels: Array<ChatLabel & { conversationCount: number }> }>('/me/labels').then((r) => r.labels),
  createLabel: (input: { name: string; color: string }) => api.post<ChatLabel>('/me/labels', input),
  updateLabel: (labelId: string, input: { name?: string; color?: string }) =>
    api.patch<ChatLabel>(`/me/labels/${encodeURIComponent(labelId)}`, input),
  deleteLabel: (labelId: string) => api.delete<{ ok: boolean }>(`/me/labels/${encodeURIComponent(labelId)}`),
  /** Replace the viewer's own labels on a chat. */
  setLabels: (id: string, labelIds: string[]) => api.put<{ labels: ChatLabel[] }>(`${conv(id)}/labels`, { labelIds }),
  quickReplies: () => api.get<{ team: QuickReply[]; mine: QuickReply[] }>('/quick-replies'),
  createQuickReply: (input: { shortcut: string; body: string; scope: 'team' | 'mine' }) =>
    api.post<QuickReply>('/quick-replies', input),
  updateQuickReply: (replyId: string, input: { shortcut?: string; body?: string }) =>
    api.patch<QuickReply>(`/quick-replies/${encodeURIComponent(replyId)}`, input),
  deleteQuickReply: (replyId: string) => api.delete<{ ok: boolean }>(`/quick-replies/${encodeURIComponent(replyId)}`),
  star: (id: string, messageId: string) =>
    api.post<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}/star`),
  unstar: (id: string, messageId: string) =>
    api.delete<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}/star`),
  /** Anyone who may write here may pin; a fourth pin replaces the oldest (server-side). */
  pin: (id: string, messageId: string) =>
    api.post<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}/pin`),
  unpin: (id: string, messageId: string) =>
    api.delete<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}/pin`),
  /** The pinned messages this viewer may see, oldest first. */
  pins: (id: string) =>
    api.get<{ pins: Array<{ pinnedAt: string; pinnedBy: string; message: ChatMessage }> }>(`${conv(id)}/messages/pins`).then((r) => r.pins),
  /** The viewer's starred messages, newest star first, across conversations they can still read. */
  starred: (before?: string) =>
    api.get<{ items: Array<{ starredAt: string; conversationId: string; message: ChatMessage }>; nextBefore: string | null }>(
      '/me/starred',
      before ? { before } : undefined,
    ),
  /** The viewer's own background preset for a chat (null = default). */
  setTheme: (id: string, theme: ChatTheme | null) => api.put<{ theme: ChatTheme | null }>(`${conv(id)}/theme`, { theme }),
  uploadWallpaper,
  removeWallpaper: (id: string) => api.delete<{ wallpaperUrl: null }>(`${conv(id)}/wallpaper`),
  /** Search this chat's messages, newest first; only what this viewer may read. */
  search: (id: string, q: string, before?: string) =>
    api.get<{ hits: ChatMessage[]; nextBefore: string | null }>(`${conv(id)}/messages/search`, { q, before }),
  /** PD-35: take a visible seat ("joined to support"). The server decides who may. */
  joinSeat: (id: string, reason: string) => api.post<{ seatId: string }>(`${conv(id)}/join`, { reason }),
  /** PD-35: leave one's own seat. */
  leaveSeat: (id: string) => api.post<{ left: true }>(`${conv(id)}/leave`),
  /** PD-35: the groups of the viewer's teachers they may join. */
  seatCandidates: (q?: string) =>
    api.get<{ groups: SeatCandidate[] }>('/seats/candidates', q ? { q } : undefined).then((r) => r.groups),
  /** Search message text across every chat in the viewer's list (newest matches). */
  searchAll: (q: string) => api.get<{ hits: Array<{ conversationId: string; message: ChatMessage }> }>('/me/search', { q }),
  /** The chat as a .zip (transcript + media). Super admin only; the server logs it. */
  exportChat: (id: string) => download(`${conv(id)}/export`),
  react: (id: string, messageId: string, emoji: string) =>
    api.post<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}/reactions`, { emoji }),
  unreact: (id: string, messageId: string) =>
    api.delete<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}/reactions`),
  deleteForMe: (id: string, messageId: string) =>
    api.delete<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}/me`),
  /** Author within the window, or a manager; the server decides. */
  deleteForEveryone: (id: string, messageId: string) =>
    api.delete<{ ok: boolean }>(`${conv(id)}/messages/${encodeURIComponent(messageId)}`),
  /** The author rewrites their own text message; the server decides whether it still may. */
  editMessage: (id: string, messageId: string, body: string) =>
    api.patch<ChatMessage>(`${conv(id)}/messages/${encodeURIComponent(messageId)}`, { body }),
  /** Archive / pin / mute / favorite are the VIEWER's own preferences. */
  setPreferences: (
    id: string,
    prefs: { archived?: boolean; pinned?: boolean; mutedUntil?: string | null; favorite?: boolean },
  ) =>
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
}

/** Query keys for the chat workspace; realtime events invalidate through them. */
export const chatKeys = {
  all: ['chat'] as const,
  list: ['chat', 'conversations'] as const,
  conversation: (id: string) => ['chat', 'conversation', id] as const,
  messages: (id: string) => ['chat', 'messages', id] as const,
  pins: (id: string) => ['chat', 'pins', id] as const,
  starred: ['chat', 'starred'] as const,
  labels: ['chat', 'labels'] as const,
  quickReplies: ['chat', 'quick-replies'] as const,
  search: (id: string, q: string) => ['chat', 'search', id, q] as const,
  searchAll: (q: string) => ['chat', 'search-all', q] as const,
  mentionCandidates: (id: string, q: string) => ['chat', 'mention-candidates', id, q] as const,
  seatCandidates: (q: string) => ['chat', 'seat-candidates', q] as const,
}

/** Server order: by seq, numerically (a string compare would put "10" before "9"). */
export function bySeq(a: ChatMessage, b: ChatMessage): number {
  const x = a.seq === null ? Number.MAX_SAFE_INTEGER : Number(a.seq)
  const y = b.seq === null ? Number.MAX_SAFE_INTEGER : Number(b.seq)
  return x - y
}
