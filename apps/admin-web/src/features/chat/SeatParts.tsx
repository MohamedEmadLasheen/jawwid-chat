import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { describeError } from '@/features/organization/copy'
import { Dialog } from '@/shared/components/Dialog'
import { QueryBoundary } from '@/shared/components/States'
import { SearchField } from '@/shared/components/SearchField'
import { useDebounced } from '@/shared/hooks/useDebounced'
import { chatApi, chatKeys } from './chatApi'
import { chatCopyFor } from './copy'

/** PD-35: the reason a teacher supervisor sits in their teacher's group. */
export const SUPERVISION_SEAT = 'supervision'

/**
 * PD-35: the bar over the composer of a chat the viewer joined by choice --
 * a reminder that members see them, and the way out.
 */
export function SeatBar({ conversationId }: { conversationId: string }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const queryClient = useQueryClient()
  const leave = useMutation({
    mutationFn: () => chatApi.leaveSeat(conversationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.list })
      void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) })
    },
  })
  return (
    <div className="tj-bar" role="status">
      <span>{copy.seatBar}</span>
      <button type="button" className="btn btn--sm" disabled={leave.isPending} onClick={() => leave.mutate()}>
        {copy.leaveSeat}
      </button>
      {leave.error && <span className="field__error" role="alert">{describeError(leave.error, locale)}</span>}
    </div>
  )
}

/**
 * PD-35: "Join a group" -- the groups of the viewer's own teachers, by title,
 * teacher and children (never a message). Joining posts a line every member
 * reads, then opens the chat.
 */
export function JoinGroupDialog({ onClose, onJoined }: { onClose: () => void; onJoined: (conversationId: string) => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const q = useDebounced(search.trim())
  const groups = useQuery({ queryKey: chatKeys.seatCandidates(q), queryFn: () => chatApi.seatCandidates(q || undefined) })
  const join = useMutation({
    mutationFn: (id: string) => chatApi.joinSeat(id, SUPERVISION_SEAT),
    onSuccess: (_r, id) => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.list })
      onJoined(id)
    },
  })
  const rows = groups.data ?? []

  return (
    <Dialog
      title={copy.joinGroup}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {copy.close}
        </button>
      }
    >
      <p className="muted">{copy.joinGroupHint}</p>
      <SearchField value={search} onChange={setSearch} label={copy.joinGroupSearch} clearLabel={copy.clearSearch} />
      {join.error && <p className="field__error" role="alert">{describeError(join.error, locale)}</p>}
      <QueryBoundary
        isLoading={groups.isLoading}
        error={groups.error}
        onRetry={() => void groups.refetch()}
        isEmpty={rows.length === 0}
        emptyTitle={copy.joinGroupEmpty}
        emptyIcon="users"
      >
        <ul className="cw-join">
          {rows.map((g) => (
            <li key={g.conversationId} className="cw-join__row">
              <span className="cw-join__main">
                <span className="cw-join__title" dir="auto">{g.title || g.learners.join('، ')}</span>
                <span className="cw-join__meta" dir="auto">
                  {copy.kind[g.type] ?? ''} · {copy.teacherOf(g.teacher.name)}
                  {g.learners.length > 0 && g.title ? ` · ${g.learners.join(locale === 'ar' ? '، ' : ', ')}` : ''}
                </span>
              </span>
              {g.membership === 'none' ? (
                <button
                  type="button"
                  className="btn btn--sm btn--primary"
                  disabled={join.isPending}
                  onClick={() => join.mutate(g.conversationId)}
                >
                  {copy.join}
                </button>
              ) : (
                <button type="button" className="btn btn--sm" onClick={() => onJoined(g.conversationId)}>
                  {g.membership === 'seated' ? copy.seatJoined : copy.seatMember}
                </button>
              )}
            </li>
          ))}
        </ul>
      </QueryBoundary>
    </Dialog>
  )
}
