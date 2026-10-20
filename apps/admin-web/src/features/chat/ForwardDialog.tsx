import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { SearchField } from '@/shared/components/SearchField'
import { QueryBoundary } from '@/shared/components/States'
import { chatApi, chatKeys } from './chatApi'
import { chatCopyFor } from './copy'
import { ConversationAvatar, conversationName } from './chatView'

const MAX_TARGETS = 10

/**
 * Forward one or more messages into up to ten chats (owner decisions
 * 2026-10-19). The list is the viewer's own chats; the server checks each
 * source is readable and each destination writable, and copies media.
 */
export function ForwardDialog({
  conversationId,
  messageIds,
  onClose,
  onDone,
}: {
  conversationId: string
  messageIds: string[]
  onClose: () => void
  onDone: (sentTo: number) => void
}) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const { staff } = useSession()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const list = useQuery({ queryKey: chatKeys.list, queryFn: chatApi.list })

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return (list.data ?? [])
      .filter((c) => !c.viewerState?.archived || chosen.includes(c.id))
      .map((c) => ({ c, name: conversationName(c, staff?.id, copy) }))
      .filter(({ name }) => !needle || name.toLocaleLowerCase().includes(needle))
  }, [list.data, search, staff?.id, copy, chosen])

  const send = useMutation({
    mutationFn: () => chatApi.forward(conversationId, messageIds, chosen),
    onSuccess: () => {
      for (const id of chosen) void queryClient.invalidateQueries({ queryKey: chatKeys.messages(id) })
      void queryClient.invalidateQueries({ queryKey: chatKeys.list })
      onDone(chosen.length)
    },
  })

  const toggle = (id: string) =>
    setChosen((all) => (all.includes(id) ? all.filter((x) => x !== id) : all.length >= MAX_TARGETS ? all : [...all, id]))

  return (
    <Dialog
      title={copy.forwardTo}
      onClose={onClose}
      footer={
        <>
          <DialogCancelButton onClick={onClose} />
          <button type="button" className="btn btn--primary" disabled={chosen.length === 0 || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? copy.forwardSending : copy.forwardSend(chosen.length)}
          </button>
        </>
      }
    >
      <p className="field__hint">{copy.forwardHint}</p>
      <SearchField value={search} onChange={setSearch} label={copy.search} clearLabel={copy.clearSearch} />
      {chosen.length >= MAX_TARGETS && <p className="field__hint">{copy.forwardMax}</p>}
      {send.error !== null && (
        <p className="field__error" role="alert">
          {send.error instanceof ApiError ? send.error.localized(locale) : copy.actionFailed}
        </p>
      )}
      <QueryBoundary
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        isEmpty={rows.length === 0}
        emptyTitle={copy.noMatches}
      >
        <ul className="cw-forward">
          {rows.map(({ c, name }) => {
            const on = chosen.includes(c.id)
            return (
              <li key={c.id}>
                <label className={on ? 'cw-forward__row cw-forward__row--on' : 'cw-forward__row'}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && chosen.length >= MAX_TARGETS}
                    onChange={() => toggle(c.id)}
                  />
                  <ConversationAvatar c={c} name={name} size="sm" selfId={staff?.id} />
                  <span className="cw-forward__name" dir="auto">{name}</span>
                  <span className="cw-forward__kind">{copy.kind[c.type] ?? c.type}</span>
                </label>
              </li>
            )
          })}
        </ul>
      </QueryBoundary>
    </Dialog>
  )
}
