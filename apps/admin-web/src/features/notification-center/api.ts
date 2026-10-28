import { api } from '@/core/api/client'

/**
 * PD-34 wire contract: the signed-in staff member's own Notification Center.
 *
 *   GET  /me/notifications?tab=&before=&limit=   { tab, entries, next }
 *   GET  /me/notifications/counts                { unread, perTab, tabs }
 *   POST /me/notifications/read                  { ids } | { all: true, tab } -> counts + { read }
 *   POST /me/notifications/{id}/acted            -> { ok: true } (404 if not yours)
 *   GET  /me/notification-settings
 *   PUT  /me/notification-settings               { quietHours?, showPreviews?, categories? }
 *
 * Text is rendered by the server in the entry's language with times in the
 * reader's zone. Every route is the caller's own.
 */
export type InboxTab = 'all' | 'unread' | 'action' | 'lessons' | 'payments' | 'conversations' | 'announcements'

export interface InboxEntryDto {
  id: string
  category: string
  severity: string
  title: string
  body: string
  at: string
  read: boolean
  acted: boolean
  requiresAction: boolean
  dueAt: string | null
  taskStatus: string | null
  count: number
  action: { kind: string; conversationId?: string; lessonId?: string; learnerId?: string; familyId?: string; caseId?: string } | null
}

export interface InboxCountsDto {
  unread: number
  perTab: Partial<Record<InboxTab, number>>
  tabs: InboxTab[]
}

export interface NotificationSettingsDto {
  quietHours: { enabled: boolean; startMinute: number; endMinute: number; isDefault: boolean }
  showPreviews: boolean
  categories: Array<{ category: string; push: boolean; locked: boolean }>
}

export const inboxKeys = {
  all: ['me', 'notifications'] as const,
  counts: ['me', 'notifications', 'counts'] as const,
  tab: (tab: InboxTab) => ['me', 'notifications', 'tab', tab] as const,
  settings: ['me', 'notification-settings'] as const,
}

const enc = encodeURIComponent

export const inboxApi = {
  list: (tab: InboxTab, before?: string | null) =>
    api.get<{ entries: InboxEntryDto[]; next: string | null }>(
      `/me/notifications?tab=${enc(tab)}${before ? `&before=${enc(before)}` : ''}`,
    ),
  counts: () => api.get<InboxCountsDto>('/me/notifications/counts'),
  readAll: (tab: InboxTab) => api.post<InboxCountsDto & { read: number }>('/me/notifications/read', { all: true, tab }),
  acted: (id: string) => api.post<{ ok: true }>(`/me/notifications/${enc(id)}/acted`),
  settings: () => api.get<NotificationSettingsDto>('/me/notification-settings'),
  setSettings: (body: Record<string, unknown>) => api.put<NotificationSettingsDto>('/me/notification-settings', body),
}

/** Where an entry's button goes in Admin Web, or null when there is no such page here. */
export function routeFor(action: InboxEntryDto['action']): string | null {
  if (!action) return null
  switch (action.kind) {
    case 'open_conversation':
      return action.conversationId ? `/chat/${enc(action.conversationId)}` : null
    case 'open_calls':
      return '/calls'
    case 'view_payments':
      return '/payments'
    // PD-35 B5: an escalation case, in Escalations (which re-checks who may see it).
    case 'open_case':
      return action.caseId ? `/cases?case=${enc(action.caseId)}` : null
    default:
      return null
  }
}
