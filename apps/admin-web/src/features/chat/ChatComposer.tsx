import { useLayoutEffect, useRef, useState } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Icon } from '@/shared/components/Icon'
import { Menu } from '@/shared/components/Menu'
import { chatCopyFor } from './copy'
import { VoiceRecorder } from './VoiceRecorder'

export interface ComposerSend {
  body: string
  visibility: 'customer' | 'internal'
  files: File[]
}

/** The viewer's own message being edited, and the wording it has now. */
export interface EditTarget {
  messageId: string
  body: string
}

export interface ReplyTarget {
  messageId: string
  author: string
  preview: string
}

const MAX_LINES_PX = 160

/**
 * The message box: one bar -- attach, the text, send -- like every messaging
 * app, with the Message / Internal note choice above it. Internal is staff-only
 * by construction (the server refuses it for parents and teachers), and the bar
 * is tinted while it is on so a note is never sent to a family by mistake.
 */
export function ChatComposer({
  onSend,
  reply,
  onCancelReply,
  conversationId,
  autoStartVoice = false,
  onVoiceAutoStarted,
  onVoiceSent,
  editing = null,
  onSaveEdit,
  onCancelEdit,
}: {
  onSend: (input: ComposerSend) => void
  /** Editing one of the viewer's messages: the box holds its text, Enter saves. */
  editing?: EditTarget | null
  onSaveEdit?: (body: string) => void
  onCancelEdit?: () => void
  reply: ReplyTarget | null
  onCancelReply: () => void
  conversationId: string
  /** "Record voice message" from the call window opens the chat recording. */
  autoStartVoice?: boolean
  onVoiceAutoStarted?: () => void
  onVoiceSent?: () => void
}) {
  const { locale } = useI18n()
  const copy = chatCopyFor(locale)
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [visibility, setVisibility] = useState<'customer' | 'internal'>('customer')
  const isInternal = visibility === 'internal'
  const input = useRef<HTMLTextAreaElement>(null)
  const media = useRef<HTMLInputElement>(null)
  const doc = useRef<HTMLInputElement>(null)

  // Grow with the text up to a few lines, then scroll.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_LINES_PX)}px`
  }, [body])

  // A reply puts the cursor in the box, ready to type.
  useLayoutEffect(() => {
    if (reply) input.current?.focus()
  }, [reply])

  // Editing puts the message's text in the box; whatever was being typed is
  // kept aside and comes back when the edit is saved or cancelled.
  const draft = useRef<string | null>(null)
  const editingId = editing?.messageId ?? null
  useLayoutEffect(() => {
    if (editingId) {
      if (draft.current === null) draft.current = body
      setBody(editing?.body ?? '')
      const el = input.current
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      }
    } else if (draft.current !== null) {
      setBody(draft.current)
      draft.current = null
    }
    // Only when the edited message changes; `body` is read, not tracked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  const canSend = editing ? body.trim().length > 0 : body.trim().length > 0 || files.length > 0

  function submit() {
    if (!canSend) return
    if (editing) {
      onSaveEdit?.(body.trim())
      return
    }
    onSend({ body: body.trim(), visibility, files })
    setBody('')
    setFiles([])
  }

  const pick = (list: FileList | null) => {
    if (list && list.length > 0) setFiles((all) => [...all, ...Array.from(list)])
  }

  return (
    <div className={isInternal && !editing ? 'cw-composer cw-composer--internal' : 'cw-composer'}>
      {editing && (
        <div className="cw-reply-banner cw-edit-banner">
          <div className="cw-quote">
            <span className="cw-quote__author">
              <Icon name="pencil" size={12} /> {copy.editing}
            </span>
            <span className="cw-quote__text" dir="auto">
              {editing.body}
            </span>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            aria-label={copy.cancelEdit}
            title={copy.cancelEdit}
            onClick={onCancelEdit}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {!editing && (
        <div className="cw-composer__modes" role="group" aria-label={copy.sendAs}>
          <button
            type="button"
            className="cw-mode"
            aria-pressed={!isInternal}
            onClick={() => setVisibility('customer')}
          >
            {copy.customer}
          </button>
          <button
            type="button"
            className="cw-mode cw-mode--internal"
            aria-pressed={isInternal}
            onClick={() => setVisibility('internal')}
          >
            <Icon name="lock" size={14} />
            {copy.internal}
          </button>
        </div>
      )}

      {reply && !editing && (
        <div className="cw-reply-banner">
          <div className="cw-quote">
            <span className="cw-quote__author">{copy.replyingTo(reply.author)}</span>
            <span className="cw-quote__text">{reply.preview}</span>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            aria-label={copy.cancelReply}
            title={copy.cancelReply}
            onClick={onCancelReply}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {files.length > 0 && !editing && (
        <ul className="cw-files" aria-label={copy.attach}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="cw-file">
              <Icon name={f.type.startsWith('image/') ? 'image' : f.type.startsWith('video/') ? 'video' : 'paperclip'} size={14} />
              <span dir="auto" className="cw-file__name">{f.name}</span>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                aria-label={`${copy.removeAttachment}: ${f.name}`}
                onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="cw-composer__bar">
        {!editing && (
          <Menu
            label={copy.attach}
            icon="plus"
            align="start"
            className="cw-composer__attach"
            items={[
              {
                key: 'media',
                label: copy.attachPhoto,
                icon: 'image',
                onSelect: () => media.current?.click(),
              },
              {
                key: 'file',
                label: copy.attachFile,
                icon: 'paperclip',
                onSelect: () => doc.current?.click(),
              },
            ]}
          />
        )}
        <input
          ref={media}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          data-testid="attach-media"
          onChange={(e) => {
            pick(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={doc}
          type="file"
          multiple
          hidden
          data-testid="attach-file"
          onChange={(e) => {
            pick(e.target.files)
            e.target.value = ''
          }}
        />
        <textarea
          ref={input}
          rows={1}
          className="cw-composer__input"
          value={body}
          dir="auto"
          onChange={(e) => setBody(e.target.value)}
          placeholder={isInternal ? copy.internalPlaceholder : copy.placeholder}
          aria-label={editing ? copy.editing : isInternal ? copy.internal : copy.customer}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && editing) {
              e.preventDefault()
              onCancelEdit?.()
              return
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          onPaste={(e) => {
            // A pasted screenshot becomes an attachment, as in other chat apps.
            const pasted = Array.from(e.clipboardData.files)
            if (pasted.length > 0 && !editing) {
              e.preventDefault()
              setFiles((all) => [...all, ...pasted])
            }
          }}
        />
        {!editing && (
          <VoiceRecorder
            conversationId={conversationId}
            visibility={visibility}
            copy={copy}
            locale={locale}
            autoStart={autoStartVoice}
            onAutoStarted={onVoiceAutoStarted}
            onSent={onVoiceSent}
          />
        )}
        <button
          type="button"
          className="cw-send"
          disabled={!canSend}
          onClick={submit}
          aria-label={editing ? copy.saveEdit : copy.send}
          title={editing ? copy.saveEdit : copy.send}
        >
          <Icon name={editing ? 'check' : 'send'} size={18} />
        </button>
      </div>
    </div>
  )
}
