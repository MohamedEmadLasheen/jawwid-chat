import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { QueryBoundary } from '@/shared/components/States'
import { chatApi, chatKeys, type ChatLabel } from './chatApi'
import { chatCopyFor } from './copy'

export const LABEL_COLORS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

/** A label as a small chip in its colour. */
export function LabelChip({ label }: { label: Pick<ChatLabel, 'name' | 'color'> }) {
  return (
    <span className={`cw-label cw-tone--${label.color}`}>
      <span className="cw-label__dot" aria-hidden="true" />
      <span dir="auto">{label.name}</span>
    </span>
  )
}

/**
 * The viewer's own labels for one chat (owner decision 2026-10-19: labels are
 * PRIVATE to each staff member). Ticking applies at once; labels can be made,
 * renamed and deleted here too.
 */
export function LabelsDialog({ conversationId, current, onClose }: { conversationId: string; current: ChatLabel[]; onClose: () => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const queryClient = useQueryClient()
  const nameId = useId()
  const labels = useQuery({ queryKey: chatKeys.labels, queryFn: chatApi.labels })
  const [applied, setApplied] = useState<string[]>(current.map((l) => l.id))
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>('1')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: chatKeys.labels })
    void queryClient.invalidateQueries({ queryKey: chatKeys.list })
    void queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) })
  }
  const apply = useMutation({ mutationFn: (ids: string[]) => chatApi.setLabels(conversationId, ids), onSettled: refresh })
  const create = useMutation({
    mutationFn: () => chatApi.createLabel({ name: name.trim(), color }),
    onSuccess: (label) => {
      setName('')
      const next = [...applied, label.id]
      setApplied(next)
      apply.mutate(next)
    },
    onSettled: refresh,
  })
  const rename = useMutation({
    mutationFn: (r: { id: string; name: string }) => chatApi.updateLabel(r.id, { name: r.name.trim() }),
    onSuccess: () => setRenaming(null),
    onSettled: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => chatApi.deleteLabel(id), onSettled: refresh })

  const error = [apply.error, create.error, rename.error, remove.error].find((e) => e)
  const toggle = (id: string) => {
    const next = applied.includes(id) ? applied.filter((x) => x !== id) : [...applied, id]
    setApplied(next)
    apply.mutate(next)
  }

  return (
    <Dialog
      title={copy.labels}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {copy.close}
        </button>
      }
    >
      <p className="field__hint">{copy.labelsHint}</p>
      {error && (
        <p className="field__error" role="alert">
          {error instanceof ApiError ? error.localized(locale) : copy.actionFailed}
        </p>
      )}
      <QueryBoundary
        isLoading={labels.isLoading}
        error={labels.error}
        onRetry={() => void labels.refetch()}
        isEmpty={false}
        emptyTitle=""
      >
        {(labels.data ?? []).length === 0 && <p className="field__hint">{copy.labelsNone}</p>}
        <ul className="cw-labels">
          {(labels.data ?? []).map((l) => (
            <li key={l.id} className="cw-labels__row">
              {renaming?.id === l.id ? (
                <form
                  className="cw-labels__rename"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (renaming.name.trim()) rename.mutate(renaming)
                  }}
                >
                  <input
                    className="input"
                    value={renaming.name}
                    aria-label={copy.labelName}
                    maxLength={40}
                    autoFocus
                    onChange={(e) => setRenaming({ id: l.id, name: e.target.value })}
                  />
                  <button type="submit" className="btn btn--sm btn--primary">{copy.quickSave}</button>
                </form>
              ) : (
                <label className="cw-labels__check">
                  <input type="checkbox" checked={applied.includes(l.id)} onChange={() => toggle(l.id)} />
                  <LabelChip label={l} />
                </label>
              )}
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                aria-label={`${copy.labelRename}: ${l.name}`}
                title={copy.labelRename}
                onClick={() => setRenaming({ id: l.id, name: l.name })}
              >
                <Icon name="text" size={14} />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                aria-label={`${copy.labelDelete}: ${l.name}`}
                title={copy.labelDelete}
                onClick={() => {
                  setApplied((all) => all.filter((x) => x !== l.id))
                  remove.mutate(l.id)
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      </QueryBoundary>

      <form
        className="cw-labels__new"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <label className="field__label" htmlFor={nameId}>{copy.labelNew}</label>
        <div className="cw-labels__new-row">
          <input id={nameId} className="input" value={name} maxLength={40} dir="auto" onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn--primary" disabled={!name.trim() || create.isPending}>
            {copy.labelAdd}
          </button>
        </div>
        <div className="cw-swatches" role="radiogroup" aria-label={copy.labelColor}>
          {LABEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`${copy.labelColor} ${c}`}
              className={`cw-swatch cw-tone--${c}`}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </form>
    </Dialog>
  )
}
