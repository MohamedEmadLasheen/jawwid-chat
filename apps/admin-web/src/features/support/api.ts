import { api, requestAs } from '@/core/api/client'
import type { ChatConversation, ChatMessage, MessagePage } from '@/features/chat/chatApi'

/**
 * PD-21 support sessions, mirrored from apps/api/src/account-admin
 * (impersonation.controller.ts).
 *
 * Two clients, never mixed:
 *   - `supportAdminApi` runs on the administrator's OWN session: start, a fresh
 *     token, exit, the record.
 *   - `supportClient(token)` runs on the SUPPORT session's token, as the parent
 *     or teacher: the person's own routes. What it may write is the server's
 *     allowlist (SupportSessionInterceptor); everything else is refused there.
 *
 * The support token lives in memory only (`supportTokens` below): never in
 * storage, never in a URL, never in history state. A reload asks for a fresh
 * one with the administrator's own session.
 */

export interface SupportSession {
  id: string
  target: { accountId: string; kind: 'family' | 'teacher'; name: string; actorId: string }
  staff: { id: string; name: string }
  reason: string
  startedAt: string
  expiresAt: string
  endsAtLatest: string
  endedAt: string | null
  endedReason: string | null
  actions: number
}

export interface SupportToken {
  session: SupportSession
  accessToken: string
  expiresInSeconds: number
}

export interface SupportAction {
  method: string
  route: string
  status: number
  at: string
}

const base = (id: string) => `/admin/impersonations/${encodeURIComponent(id)}`

export const supportAdminApi = {
  start: (accountId: string, reason: string) => api.post<SupportToken>('/admin/impersonations', { accountId, reason }),
  token: (id: string) => api.post<SupportToken>(`${base(id)}/token`),
  end: (id: string) => api.post<SupportSession>(`${base(id)}/end`),
  list: (accountId?: string) =>
    api.get<{ sessions: SupportSession[] }>('/admin/impersonations', accountId ? { accountId } : undefined).then((r) => r.sessions),
  actions: (id: string) => api.get<{ session: SupportSession; actions: SupportAction[] }>(`${base(id)}/actions`),
}

/** In memory only; see the file header. */
const tokens = new Map<string, SupportToken>()
export const supportTokens = {
  get: (id: string) => tokens.get(id) ?? null,
  set: (token: SupportToken) => void tokens.set(token.session.id, token),
  forget: (id: string) => void tokens.delete(id),
}

export interface ParentSelf {
  displayName: string
  about: string | null
  children: Array<{ id: string; displayName: string; level: string | null; about: string | null }>
}

export function supportClient(token: string) {
  const conv = (id: string) => `/conversations/${encodeURIComponent(id)}`
  return {
    conversations: () =>
      requestAs<{ conversations: ChatConversation[] }>(token, '/conversations').then((r) => r.conversations),
    messages: (id: string) => requestAs<MessagePage>(token, `${conv(id)}/messages`, { query: { limit: 50 } }),
    send: (id: string, body: string, clientMessageId: string) =>
      requestAs<ChatMessage>(token, `${conv(id)}/messages`, {
        method: 'POST',
        body: { type: 'text', body, visibility: 'customer', clientMessageId },
      }),
    parentProfile: () => requestAs<ParentSelf>(token, '/me/profile'),
    updateParentProfile: (input: { name?: string; about?: string | null }) =>
      requestAs<ParentSelf>(token, '/me/profile', { method: 'PATCH', body: input }),
  }
}

export const supportKeys = {
  all: ['support'] as const,
  record: (accountId?: string) => ['support', 'record', accountId ?? 'all'] as const,
  conversations: (id: string) => ['support', id, 'conversations'] as const,
  messages: (id: string, conversationId: string) => ['support', id, 'messages', conversationId] as const,
  profile: (id: string) => ['support', id, 'profile'] as const,
}
