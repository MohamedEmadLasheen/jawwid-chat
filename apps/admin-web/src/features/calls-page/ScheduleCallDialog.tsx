import { useId, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { ApiError } from '@/core/api/errors'
import { Avatar } from '@/shared/components/Avatar'
import { Dialog } from '@/shared/components/Dialog'
import type { ChatConversation } from '@/features/chat/chatApi'
import { useCallsCopy, useConversationNaming, useCreateScheduled } from './hooks'
import { localDateTime, toDateInput, toTimeInput } from './model'

export const TITLE_MAX = 120

/** The next half hour from now, as a sensible default start. */
function nextHalfHour(now = new Date()): Date {
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60)
  return d
}

/**
 * Schedule a voice call in ONE conversation. The server posts the card into
 * that chat, so every member sees it; nothing rings until someone joins.
 * The client checks only what it can (a date, not in the past, a short
 * title); who may schedule here is the server's call-capability decision.
 */
export function ScheduleCallDialog({
  conversation,
  onClose,
  onChangeConversation,
  onScheduled,
}: {
  conversation: ChatConversation
  onClose: () => void
  onChangeConversation: () => void
  onScheduled: (chatName: string) => void
}) {
  const copy = useCallsCopy()
  const { locale } = useI18n()
  const name = useConversationNaming()
  const create = useCreateScheduled()
  const ids = { date: useId(), time: useId(), title: useId() }
  const [initial] = useState(nextHalfHour)
  const [date, setDate] = useState(toDateInput(initial))
  const [time, setTime] = useState(toTimeInput(initial))
  const [title, setTitle] = useState('')
  const [touched, setTouched] = useState(false)
  const chatName = name(conversation)

  const at = localDateTime(date, time)
  const problem = !at ? copy.pickDateTime : at.getTime() < Date.now() ? copy.inPast : title.trim().length > TITLE_MAX ? copy.titleTooLong : null

  async function submit() {
    setTouched(true)
    if (problem || !at) return
    const trimmed = title.trim()
    try {
      await create.mutateAsync({
        conversationId: conversation.id,
        kind: 'scheduled',
        startsAt: at.toISOString(),
        ...(trimmed ? { title: trimmed } : {}),
      })
      onScheduled(chatName)
    } catch {
      // Shown below from create.error, in the server's words.
    }
  }

  const serverError = create.error
    ? create.error instanceof ApiError
      ? create.error.localized(locale)
      : copy.cannotCall
    : null

  return (
    <Dialog
      title={copy.scheduleTitle}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {copy.close}
          </button>
          <button type="button" className="btn btn--primary" disabled={create.isPending} onClick={() => void submit()}>
            {create.isPending ? copy.scheduling : copy.schedule}
          </button>
        </>
      }
    >
      <form
        className="cp-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="field">
          <span className="field__label">{copy.conversation}</span>
          <div className="cp-picked">
            <Avatar name={chatName} seed={conversation.id} size="sm" />
            <span className="cp-row__name">{chatName}</span>
            <button type="button" className="btn btn--sm btn--ghost cp-picked__change" onClick={onChangeConversation}>
              {copy.change}
            </button>
          </div>
        </div>
        <div className="cp-form__row">
          <div className="field">
            <label className="field__label" htmlFor={ids.date}>
              {copy.date}
            </label>
            <input
              id={ids.date}
              className="input"
              type="date"
              value={date}
              min={toDateInput(new Date())}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.time}>
              {copy.time}
            </label>
            <input
              id={ids.time}
              className="input"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={ids.title}>
            {copy.titleLabel}
          </label>
          <input
            id={ids.title}
            className="input"
            type="text"
            value={title}
            maxLength={TITLE_MAX + 20}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="field__hint">{copy.titleHint}</span>
        </div>
        {touched && problem && (
          <p className="field__error" role="alert">
            {problem}
          </p>
        )}
        {serverError && (
          <p className="field__error" role="alert">
            {serverError}
          </p>
        )}
      </form>
    </Dialog>
  )
}
