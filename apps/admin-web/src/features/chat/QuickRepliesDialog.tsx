import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog, DialogCancelButton } from '@/shared/components/Dialog'
import { FilterChips } from '@/shared/components/FilterChips'
import { Icon } from '@/shared/components/Icon'
import { QueryBoundary } from '@/shared/components/States'
import { chatApi, chatKeys, type QuickReply } from './chatApi'
import { chatCopyFor } from './copy'

type Scope = 'team' | 'mine'

/** Both libraries as one list, the viewer's own first: what "/" suggests. */
export function useQuickReplies(enabled: boolean) {
  const query = useQuery({ queryKey: chatKeys.quickReplies, queryFn: chatApi.quickReplies, enabled, staleTime: 60_000 })
  const all: QuickReply[] = query.data ? [...query.data.mine, ...query.data.team] : []
  return { query, all }
}

/** Replies whose shortcut starts with what follows the "/", mine before the team's. */
export function matchQuickReplies(all: QuickReply[], typed: string): QuickReply[] {
  const needle = typed.toLocaleLowerCase()
  return all.filter((r) => r.shortcut.toLocaleLowerCase().startsWith(needle)).slice(0, 8)
}

/**
 * Quick replies (owner decision 2026-10-19): a team library any staff member
 * may edit, and personal ones only their owner sees. Insert puts the text in
 * the message box; nothing is sent until the admin sends it.
 */
export function QuickRepliesDialog({ onInsert, onClose }: { onInsert: (body: string) => void; onClose: () => void }) {
  const { locale, number } = useI18n()
  const copy = chatCopyFor(locale)
  const queryClient = useQueryClient()
  const { query } = useQuickReplies(true)
  const [scope, setScope] = useState<Scope>('team')
  const [editing, setEditing] = useState<{ id: string | null; shortcut: string; body: string } | null>(null)
  const shortcutId = useId()
  const bodyId = useId()

  const refresh = () => void queryClient.invalidateQueries({ queryKey: chatKeys.quickReplies })
  const save = useMutation({
    mutationFn: (e: { id: string | null; shortcut: string; body: string }) =>
      e.id
        ? chatApi.updateQuickReply(e.id, { shortcut: e.shortcut.trim(), body: e.body.trim() })
        : chatApi.createQuickReply({ shortcut: e.shortcut.trim(), body: e.body.trim(), scope }),
    onSuccess: () => setEditing(null),
    onSettled: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => chatApi.deleteQuickReply(id), onSettled: refresh })
  const error = save.error ?? remove.error

  const rows = query.data?.[scope] ?? []

  return (
    <Dialog
      title={copy.quickReplies}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {copy.close}
        </button>
      }
    >
      <p className="field__hint">{copy.quickRepliesHint}</p>
      <FilterChips
        options={[
          { value: 'team' as const, label: copy.quickTeam, count: query.data?.team.length },
          { value: 'mine' as const, label: copy.quickMine, count: query.data?.mine.length },
        ]}
        value={scope}
        onChange={(v) => {
          setScope(v)
          setEditing(null)
        }}
        label={copy.quickReplies}
        formatCount={number}
        variant="tabs"
      />
      {error && (
        <p className="field__error" role="alert">
          {error instanceof ApiError ? error.localized(locale) : copy.actionFailed}
        </p>
      )}

      <QueryBoundary isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} isEmpty={false} emptyTitle="">
        {rows.length === 0 && !editing && <p className="field__hint">{copy.quickNone}</p>}
        <ul className="cw-quick">
          {rows.map((r) => (
            <li key={r.id} className="cw-quick__row">
              <div className="cw-quick__text">
                <span className="cw-quick__shortcut" dir="auto">/{r.shortcut}</span>
                <span className="cw-quick__body" dir="auto">{r.body}</span>
              </div>
              <div className="cw-quick__actions">
                <button type="button" className="btn btn--sm btn--primary" onClick={() => onInsert(r.body)}>
                  {copy.quickInsert}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  aria-label={`${copy.quickEdit}: /${r.shortcut}`}
                  title={copy.quickEdit}
                  onClick={() => setEditing({ id: r.id, shortcut: r.shortcut, body: r.body })}
                >
                  <Icon name="text" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--sm"
                  aria-label={`${copy.quickDelete}: /${r.shortcut}`}
                  title={copy.quickDelete}
                  onClick={() => remove.mutate(r.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </QueryBoundary>

      {editing ? (
        <form
          className="cw-quick__form"
          onSubmit={(e) => {
            e.preventDefault()
            if (editing.shortcut.trim() && editing.body.trim()) save.mutate(editing)
          }}
        >
          <label className="field__label" htmlFor={shortcutId}>{copy.quickShortcut}</label>
          <input
            id={shortcutId}
            className="input"
            value={editing.shortcut}
            maxLength={25}
            dir="auto"
            autoFocus
            onChange={(e) => setEditing({ ...editing, shortcut: e.target.value.replace(/\s/g, '') })}
          />
          <label className="field__label" htmlFor={bodyId}>{copy.quickBody}</label>
          <textarea
            id={bodyId}
            className="input cw-quick__textarea"
            rows={3}
            value={editing.body}
            maxLength={2000}
            dir="auto"
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
          />
          <div className="cw-quick__form-actions">
            <DialogCancelButton onClick={() => setEditing(null)} />
            <button
              type="submit"
              className="btn btn--primary"
              disabled={!editing.shortcut.trim() || !editing.body.trim() || save.isPending}
            >
              {copy.quickSave}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn cw-quick__add" onClick={() => setEditing({ id: null, shortcut: '', body: '' })}>
          <Icon name="plus" size={14} />
          {copy.quickAdd}
        </button>
      )}
    </Dialog>
  )
}
