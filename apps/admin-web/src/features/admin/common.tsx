import { useEffect } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import type { MessageKey } from '@/core/i18n/messages'
import type { AdminConversation } from '@/core/api/endpoints'
import { Badge, type Tone } from '@/shared/components/Badge'
import { Icon } from '@/shared/components/Icon'
import { CONVERSATION_STATE, fill, TEXT, useLabel, useText } from './copy'
import { ADMIN_GROUPS, type AdminSection, type AdminSectionStatus } from './sections'

/** The browser tab names the page, so several open tabs stay tellable apart. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return
    const previous = document.title
    document.title = `${title} · Jawwid`
    return () => {
      document.title = previous
    }
  }, [title])
}

/** Shown beside an unbuilt section's title. A built section needs no badge. */
export function StatusBadge({ status }: { status: AdminSectionStatus }) {
  const tx = useText()
  if (status === 'read_only') return null
  return (
    <Badge tone="outline">
      <span className="status-ring" aria-hidden="true" />
      {tx(TEXT.inDevelopment)}
    </Badge>
  )
}

/**
 * When the figures on screen were read, and a way to read them again. The
 * data is request/response (no realtime), so the time is the honest claim.
 */
export function RefreshAction({
  updatedAt,
  fetching,
  onRefresh,
}: {
  updatedAt: number
  fetching: boolean
  onRefresh: () => void
}) {
  const tx = useText()
  const { time } = useI18n()
  return (
    <>
      {updatedAt > 0 && (
        <span className="page-header__meta">
          {fill(tx(TEXT.updatedAt), { time: time(new Date(updatedAt).toISOString()) })}
        </span>
      )}
      <button type="button" className="btn btn--sm" onClick={onRefresh} disabled={fetching}>
        <Icon name="refresh" size={16} />
        {tx(TEXT.refresh)}
      </button>
    </>
  )
}

/** Case- and diacritic-insensitive match, so Arabic search ignores tashkeel. */
export function matches(haystack: string | null | undefined, needle: string): boolean {
  if (!needle) return true
  if (!haystack) return false
  const norm = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
      .toLocaleLowerCase()
  return norm(haystack).includes(norm(needle.trim()))
}

/** A staff role's label; an unknown role shows as itself, never as a key. */
export function useRoleLabel() {
  const { t } = useI18n()
  return (role: string | null): string | null => {
    if (!role) return null
    const key = `role.${role}` as MessageKey
    const text = t(key)
    // t() echoes an unknown key back.
    return text === key ? role : text
  }
}

/** A conversation's name: its title, else its family's, else "Untitled". */
export function conversationName(c: AdminConversation, untitled: string): string {
  return c.title ?? c.familyName ?? untitled
}

/**
 * A conversation's status. Every state carries a word and a dot, never colour
 * alone; "open" is the default, so lists hide it unless `showOpen` asks.
 */
const CONVERSATION_TONE: Record<string, Tone> = {
  waiting_on_jawwid: 'warn',
  waiting_on_customer: 'info',
  open: 'outline',
  resolved: 'ok',
}

export function ConversationStateBadge({ state, showOpen }: { state: string; showOpen?: boolean }) {
  const label = useLabel()
  if (state === 'open' && !showOpen) return null
  return (
    <Badge tone={CONVERSATION_TONE[state] ?? 'neutral'} dot>
      {label(CONVERSATION_STATE, state)}
    </Badge>
  )
}

/** The section's group, shown above its title so the page says where it sits. */
export function useEyebrow(section: AdminSection): string | undefined {
  const tx = useText()
  const group = ADMIN_GROUPS.find((g) => g.key === section.group)
  return group ? tx(group.label) : undefined
}
