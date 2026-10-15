import { api } from '@/core/api/client'

/**
 * The call API Admin Web calls through -- the SAME `/calls` routes the parent and
 * teacher apps use. The server decides everything: who may start a call, who it
 * rings, whether an answer is allowed, and what the outcome was. Nothing here
 * names an outcome or a participant; the client only asks.
 *
 * Shapes mirror apps/api/src/communication/api/call.controller.ts.
 */

export interface CallCapability {
  /** ADVISORY: the server decides again on POST /calls. Never a permission. */
  canCall: boolean
  /** A stable COMM.* code when refused; nothing about who or why. */
  code: string | null
}

export interface StartedCall {
  callId: string
  /** Deliberately unused: the room is signed into the media token. */
  roomName: string
}

export interface MediaToken {
  token: string
  /** The media server's URL, chosen by the server (LIVEKIT_URL). */
  url: string
  roomName: string
  expiresAt: string
}

export interface CallHistoryRow {
  id: string
  conversationId: string
  type: string
  status: string
  outcome: string | null
  initiatorId: string
  startedAt: string
  endedAt: string | null
  durationSeconds: number | null
  participants: Array<{ actorId: string; actorKind: string; joinedAt: string | null; leftAt: string | null }>
}

const call = (id: string) => `/calls/${encodeURIComponent(id)}`

export const callApi = {
  capability: (conversationId: string) =>
    api.get<CallCapability>(`/conversations/${encodeURIComponent(conversationId)}/call-capability`),
  start: (conversationId: string) => api.post<StartedCall>('/calls', { conversationId }),
  token: (callId: string) => api.post<MediaToken>(`${call(callId)}/token`),
  accept: (callId: string) => api.post<{ ok: boolean }>(`${call(callId)}/accept`),
  decline: (callId: string) => api.post<{ ok: boolean }>(`${call(callId)}/decline`),
  end: (callId: string) => api.post<{ ok: boolean }>(`${call(callId)}/end`),
  history: (conversationId: string) =>
    api
      .get<{ calls: CallHistoryRow[] }>(`/calls/history/${encodeURIComponent(conversationId)}`)
      .then((r) => r.calls),
}

/** Query keys; call events invalidate through them. */
export const callKeys = {
  capability: (conversationId: string) => ['calls', 'capability', conversationId] as const,
  history: (conversationId: string) => ['calls', 'history', conversationId] as const,
}
