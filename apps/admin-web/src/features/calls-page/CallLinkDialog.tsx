import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { ApiError } from '@/core/api/errors'
import { Dialog } from '@/shared/components/Dialog'
import { Icon } from '@/shared/components/Icon'
import { LoadingState } from '@/shared/components/States'
import type { ChatConversation } from '@/features/chat/chatApi'
import { useCallActions, useCallsCopy, useConversationNaming, useCreateScheduled } from './hooks'
import { chatPathFor, joinLinkFor } from './model'

/** Clipboard API first; the legacy copy command as a fallback (older or non-secure contexts). */
export async function copyText(text: string, input?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    if (!input) return false
    input.focus()
    input.select()
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  }
}

/**
 * Create a members-only call link in one conversation (`kind: 'link'`, joinable
 * now) and show it. The link is a NAME, not a capability: opening it needs a
 * signed-in member of that chat, and nobody is rung until someone joins.
 */
export function CallLinkDialog({ conversation, onClose }: { conversation: ChatConversation; onClose: () => void }) {
  const copy = useCallsCopy()
  const { locale } = useI18n()
  const { staff } = useSession()
  const navigate = useNavigate()
  const name = useConversationNaming()
  const actions = useCallActions()
  const create = useCreateScheduled()
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)
  // One link per opening of this dialog (StrictMode mounts effects twice).
  const asked = useRef(false)

  useEffect(() => {
    if (asked.current) return
    asked.current = true
    create.mutate({ conversationId: conversation.id, kind: 'link' })
  }, [conversation.id, create])

  const link = create.data ? joinLinkFor(create.data.id) : null

  async function onCopy() {
    if (!link) return
    setCopied((await copyText(link, input.current)) ? 'yes' : 'failed')
  }

  return (
    <Dialog
      title={copy.linkTitle}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {copy.close}
        </button>
      }
    >
      <p className="cp-row__name">{name(conversation)}</p>
      {create.isPending && <LoadingState compact label={copy.creatingLink} />}
      {create.error ? (
        <p className="field__error" role="alert">
          {create.error instanceof ApiError ? create.error.localized(locale) : copy.cannotCall}
        </p>
      ) : null}
      {create.data && link && (
        <div className="cp-link">
          <label className="field__label" htmlFor={inputId}>
            {copy.linkLabel}
          </label>
          <div className="cp-link__row">
            <input
              id={inputId}
              ref={input}
              className="input cp-link__input"
              type="text"
              dir="ltr"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn btn--primary" onClick={() => void onCopy()}>
              <Icon name="copy" size={16} />
              {copy.copyLink}
            </button>
          </div>
          <p className="field__hint" role="status">
            {copied === 'yes' ? copy.copied : copied === 'failed' ? copy.copyFailed : ''}
          </p>
          <p className="cp-link__note">{copy.linkNote}</p>
          <div className="cp-link__actions">
            <button
              type="button"
              className="btn"
              disabled={!actions.available || actions.busy}
              onClick={() => {
                onClose()
                void actions.join({ id: create.data.id, conversationId: conversation.id, title: create.data.title })
              }}
            >
              <Icon name="calls" size={16} />
              {copy.joinNow}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                onClose()
                navigate(chatPathFor(staff?.role, conversation.id))
              }}
            >
              <Icon name="conversations" size={16} />
              {copy.openChat}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
