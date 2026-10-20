import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { QueryBoundary } from '@/shared/components/States'
import { chatKeys, labelApi, type ChatConversation, type ChatLabel } from './chatApi'
import { chatCopyFor, type ChatCopy } from './copy'
import { useChatLabels, useLabelToggle } from './useChatActions'

/**
 * Chat labels, staff only (owner request 2026-10-19): the organization's shared
 * tags for chats. Each label is a name and one of eight tones; the tone is a
 * dot beside the name, so the name itself always reads at full contrast.
 */

export const LABEL_TONES = [1, 2, 3, 4, 5, 6, 7, 8] as const

/** A label as a compact pill: its tone as a dot, then its name. */
export function LabelPill({ label }: { label: ChatLabel }) {
  return (
    <span className="cw-label" title={label.name}>
      <span className={`cw-label__dot cw-label-tone--${label.color}`} aria-hidden="true" />
      <span className="cw-label__name" dir="auto">{label.name}</span>
    </span>
  )
}

function labelError(error: unknown, copy: ChatCopy, locale: 'ar' | 'en'): string | null {
  if (!error) return null
  if (error instanceof ApiError) {
    if (error.code === 'COMM.LABEL_NAME_TAKEN') return copy.labelTaken
    if (error.code === 'COMM.LABEL_LIMIT_REACHED') return copy.labelLimit
    return error.localized(locale)
  }
  return copy.labelFailed
}

/** The next tone after the ones in use, so new labels come out distinct. */
function nextTone(labels: ChatLabel[]): number {
  return LABEL_TONES[labels.length % LABEL_TONES.length]!
}

function TonePicker({ value, onChange, copy }: { value: number; onChange: (n: number) => void; copy: ChatCopy }) {
  return (
    <div className="cw-tones" role="radiogroup" aria-label={copy.labelColor}>
      {LABEL_TONES.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={copy.colorN(n)}
          title={copy.colorN(n)}
          className={`cw-tone-swatch cw-label-tone--${n}`}
          onClick={() => onChange(n)}
        />
      ))}
    </div>
  )
}

/** Create a label: a name, a tone, Add. Calls `onCreated` with the new label. */
function NewLabelForm({ labels, onCreated }: { labels: ChatLabel[]; onCreated?: (l: ChatLabel) => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [tone, setTone] = useState(() => nextTone(labels))
  const create = useMutation({
    mutationFn: () => labelApi.create({ name: name.trim(), color: tone }),
    onSuccess: (label) => {
      queryClient.setQueryData<ChatLabel[]>(chatKeys.labels, (all) => [...(all ?? []), label])
      void queryClient.invalidateQueries({ queryKey: chatKeys.labels })
      setName('')
      setTone(nextTone([...labels, label]))
      onCreated?.(label)
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (name.trim()) create.mutate()
  }
  const error = labelError(create.error, copy, locale)

  return (
    <form className="cw-label-form" onSubmit={submit}>
      <div className="cw-label-form__row">
        <input
          className="input"
          value={name}
          maxLength={40}
          dir="auto"
          placeholder={copy.newLabel}
          aria-label={copy.labelName}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn--primary btn--sm" disabled={!name.trim() || create.isPending}>
          <Icon name="plus" size={14} />
          {copy.addLabel}
        </button>
      </div>
      <TonePicker value={tone} onChange={setTone} copy={copy} />
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

/**
 * Which labels this chat carries: one checkbox per label, applied the moment it
 * is ticked. A new label made here is applied to the chat straight away.
 */
export function LabelPickerDialog({
  conversation,
  onClose,
  onManage,
}: {
  conversation: ChatConversation
  onClose: () => void
  onManage: () => void
}) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const labels = useChatLabels()
  const toggle = useLabelToggle()
  const all = labels.data ?? []
  // The cached list row is updated optimistically; read the chat's labels from it.
  const on = new Set(conversation.labelIds ?? [])
  const error = labelError(toggle.error, copy, locale)

  return (
    <Dialog
      title={copy.labelChat}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onManage}>
            <Icon name="settings" size={16} />
            {copy.manageLabels}
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {copy.done}
          </button>
        </>
      }
    >
      <QueryBoundary isLoading={labels.isLoading} error={null} onRetry={() => void labels.refetch()}>
        {all.length > 0 ? (
          <ul className="cw-label-list" aria-label={copy.labels}>
            {all.map((l) => (
              <li key={l.id}>
                <label className="cw-label-check">
                  <input
                    type="checkbox"
                    checked={on.has(l.id)}
                    onChange={(e) => toggle.mutate({ conversationId: conversation.id, labelId: l.id, on: e.target.checked })}
                  />
                  <LabelPill label={l} />
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field__hint">{copy.labelsEmpty}</p>
        )}
      </QueryBoundary>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      <NewLabelForm
        labels={all}
        onCreated={(l) => toggle.mutate({ conversationId: conversation.id, labelId: l.id, on: true })}
      />
    </Dialog>
  )
}

/** Create, rename, recolour and delete the organization's labels. */
export function ManageLabelsDialog({ onClose }: { onClose: () => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const labels = useChatLabels()
  const all = labels.data ?? []
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <Dialog
      title={copy.manageLabels}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--primary" onClick={onClose}>
          {copy.done}
        </button>
      }
    >
      <p className="field__hint">{copy.labelsHint}</p>
      <NewLabelForm labels={all} />
      <QueryBoundary isLoading={labels.isLoading} error={null} onRetry={() => void labels.refetch()}>
        {all.length > 0 ? (
          <ul className="cw-label-list cw-label-list--manage" aria-label={copy.labels}>
            {all.map((l) =>
              editing === l.id ? (
                <li key={l.id}>
                  <EditLabelRow label={l} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={l.id} className="cw-label-row">
                  <LabelPill label={l} />
                  <span className="cw-label-row__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon btn--sm"
                      aria-label={`${copy.renameLabel}: ${l.name}`}
                      title={copy.renameLabel}
                      onClick={() => setEditing(l.id)}
                    >
                      <Icon name="pencil" size={16} />
                    </button>
                    <DeleteLabelButton label={l} />
                  </span>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="field__hint">{copy.labelsEmpty}</p>
        )}
      </QueryBoundary>
    </Dialog>
  )
}

function EditLabelRow({ label, onDone }: { label: ChatLabel; onDone: () => void }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const queryClient = useQueryClient()
  const [name, setName] = useState(label.name)
  const [tone, setTone] = useState(label.color)
  const save = useMutation({
    mutationFn: () => labelApi.update(label.id, { name: name.trim(), color: tone }),
    onSuccess: (saved) => {
      queryClient.setQueryData<ChatLabel[]>(chatKeys.labels, (all) => all?.map((x) => (x.id === saved.id ? saved : x)))
      void queryClient.invalidateQueries({ queryKey: chatKeys.labels })
      onDone()
    },
  })
  const error = labelError(save.error, copy, locale)
  return (
    <form
      className="cw-label-form cw-label-form--edit"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) save.mutate()
      }}
    >
      <div className="cw-label-form__row">
        <input
          className="input"
          value={name}
          maxLength={40}
          dir="auto"
          aria-label={copy.labelName}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn--primary btn--sm" disabled={!name.trim() || save.isPending}>
          {copy.saveLabel}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onDone}>
          {copy.discard}
        </button>
      </div>
      <TonePicker value={tone} onChange={setTone} copy={copy} />
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

function DeleteLabelButton({ label }: { label: ChatLabel }) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => labelApi.remove(label.id),
    onSuccess: () => {
      queryClient.setQueryData<ChatLabel[]>(chatKeys.labels, (all) => all?.filter((x) => x.id !== label.id))
      void queryClient.invalidateQueries({ queryKey: chatKeys.labels })
      void queryClient.invalidateQueries({ queryKey: chatKeys.list })
    },
  })
  return (
    <button
      type="button"
      className="btn btn--ghost btn--icon btn--sm cw-label-row__delete"
      aria-label={`${copy.deleteLabel}: ${label.name}`}
      title={copy.deleteLabel}
      disabled={remove.isPending}
      onClick={() => {
        if (window.confirm(copy.confirmDeleteLabel(label.name))) remove.mutate()
      }}
    >
      <Icon name="trash" size={16} />
    </button>
  )
}
