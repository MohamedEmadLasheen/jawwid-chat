import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { Avatar } from '@/shared/components/Avatar'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { SearchField } from '@/shared/components/SearchField'
import { QueryBoundary } from '@/shared/components/States'
import { callApi, callKeys } from '@/features/calls/callApi'
import type { ChatConversation } from '@/features/chat/chatApi'
import { chatCopyFor } from '@/features/chat/copy'
import { useCallActions, useCallsCopy, useConversationNaming, useConversations } from './hooks'
import { chatPathFor, isGroupConversation, nameMatches } from './model'
import { onListKeyDown } from './listKeys'

export type PickerMode = 'call' | 'select' | 'link' | 'schedule'

/**
 * Pick one of THIS staff member's conversations -- the list the server
 * returned, never a directory of people -- split into People (1:1) and Groups,
 * searchable by name only. What happens next depends on the tile that opened
 * it; every action is decided again by the server.
 */
export function MemberPickerDialog({
  mode,
  onClose,
  onSchedule,
  onLink,
}: {
  mode: PickerMode
  onClose: () => void
  onSchedule: (c: ChatConversation) => void
  onLink: (c: ChatConversation) => void
}) {
  const copy = useCallsCopy()
  const { locale } = useI18n()
  const { staff } = useSession()
  const chat = chatCopyFor(locale)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const conversations = useConversations()
  const name = useConversationNaming()
  const actions = useCallActions()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ChatConversation | null>(null)
  const [checking, setChecking] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  const { people, groups } = useMemo(() => {
    const all = (conversations.data ?? []).filter((c) => !c.archivedAt && nameMatches(name(c), query))
    return {
      people: all.filter((c) => !isGroupConversation(c)),
      groups: all.filter((c) => isGroupConversation(c)),
    }
  }, [conversations.data, name, query])

  /**
   * Ask the server first whether a call could start here (advisory, W7): a
   * "no" is shown in place, rather than opening a call window that only fails.
   * `start` still decides again.
   */
  async function call(c: ChatConversation) {
    setRefusal(null)
    setChecking(c.id)
    try {
      const capability = await queryClient.fetchQuery({
        queryKey: callKeys.capability(c.id),
        queryFn: () => callApi.capability(c.id),
        staleTime: 15_000,
      })
      if (!capability.canCall) {
        setRefusal(copy.cannotCall)
        return
      }
    } catch (e) {
      setRefusal(e instanceof ApiError ? e.localized(locale) : copy.cannotCall)
      return
    } finally {
      setChecking(null)
    }
    onClose()
    void actions.startCall(c)
  }

  function choose(c: ChatConversation) {
    setRefusal(null)
    if (mode === 'call') return void call(c)
    if (mode === 'link') return onLink(c)
    if (mode === 'schedule') return onSchedule(c)
    setSelected(c)
  }

  const section = (label: string, items: ChatConversation[]) =>
    items.length === 0 ? null : (
      <section className="cp-picker__section" aria-label={label}>
        <h3 className="cp-section__title">{label}</h3>
        <ul className="cp-list" onKeyDown={onListKeyDown}>
          {items.map((c) => {
            const n = name(c)
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className="cp-row cp-row--button"
                  data-cp-item
                  disabled={checking !== null || (mode === 'call' && actions.busy)}
                  onClick={() => choose(c)}
                >
                  <Avatar name={n} seed={c.id} size="sm" />
                  <span className="cp-row__body">
                    <span className="cp-row__name">{n}</span>
                    <span className="cp-row__sub">{chat.kind[c.type] ?? c.type}</span>
                  </span>
                  {checking === c.id ? (
                    <span className="cp-row__sub">{copy.checking}</span>
                  ) : mode === 'call' ? (
                    <span className="cp-row__icon" aria-hidden="true">
                      <Icon name="calls" size={18} />
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    )

  if (selected) {
    const n = name(selected)
    return (
      <Dialog title={copy.pickerTitle.select} onClose={onClose}>
        <div className="cp-picked">
          <Avatar name={n} seed={selected.id} />
          <div className="cp-row__body">
            <span className="cp-row__name">{n}</span>
            <span className="cp-row__sub">{chat.kind[selected.type] ?? selected.type}</span>
          </div>
        </div>
        {refusal && (
          <p className="field__error" role="alert">
            {refusal}
          </p>
        )}
        <div className="cp-menu-list" role="menu" aria-label={n} onKeyDown={onListKeyDown}>
          <button
            type="button"
            role="menuitem"
            className="cp-menu-list__item"
            data-cp-item
            disabled={checking !== null || actions.busy || !actions.available}
            onClick={() => void call(selected)}
          >
            <Icon name="calls" size={18} />
            {checking ? copy.checking : copy.voiceCall}
          </button>
          <button
            type="button"
            role="menuitem"
            className="cp-menu-list__item"
            data-cp-item
            onClick={() => {
              onClose()
              navigate(chatPathFor(staff?.role, selected.id))
            }}
          >
            <Icon name="conversations" size={18} />
            {copy.openChat}
          </button>
          <button
            type="button"
            role="menuitem"
            className="cp-menu-list__item"
            data-cp-item
            onClick={() => onSchedule(selected)}
          >
            <Icon name="calendarPlus" size={18} />
            {copy.scheduleCall}
          </button>
        </div>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={() => setSelected(null)}>
            {copy.back}
          </button>
        </div>
      </Dialog>
    )
  }

  return (
    <Dialog
      title={copy.pickerTitle[mode]}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {copy.close}
        </button>
      }
    >
      <div className="cp-picker">
        <SearchField value={query} onChange={setQuery} label={copy.search} clearLabel={copy.clearSearch} />
        {refusal && (
          <p className="field__error" role="alert">
            {refusal}
          </p>
        )}
        <div className="cp-picker__scroll">
          <QueryBoundary
            isLoading={conversations.isLoading}
            error={conversations.error}
            onRetry={() => void conversations.refetch()}
            isEmpty={(conversations.data ?? []).length === 0}
            emptyTitle={copy.noConversations}
            compact
          >
            {people.length === 0 && groups.length === 0 ? (
              <p className="cp-empty">{copy.noMatches}</p>
            ) : (
              <>
                {section(copy.people, people)}
                {section(copy.groups, groups)}
              </>
            )}
          </QueryBoundary>
        </div>
      </div>
    </Dialog>
  )
}
