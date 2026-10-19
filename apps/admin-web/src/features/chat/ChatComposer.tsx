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
}: {
  onSend: (input: ComposerSend) => void
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

  const canSend = body.trim().length > 0 || files.length > 0

  function submit() {
    if (!canSend) return
    onSend({ body: body.trim(), visibility, files })
    setBody('')
    setFiles([])
  }

  const pick = (list: FileList | null) => {
    if (list && list.length > 0) setFiles((all) => [...all, ...Array.from(list)])
  }

  return (
    <div className={isInternal ? 'cw-composer cw-composer--internal' : 'cw-composer'}>
      <div className="cw-composer__modes" role="group" aria-label={copy.sendAs}>
        <button type="button" className="cw-mode" aria-pressed={!isInternal} onClick={() => setVisibility('customer')}>
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

      {reply && (
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

      {files.length > 0 && (
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
        <Menu
          label={copy.attach}
          icon="plus"
          align="start"
          className="cw-composer__attach"
          items={[
            { key: 'media', label: copy.attachPhoto, icon: 'image', onSelect: () => media.current?.click() },
            { key: 'file', label: copy.attachFile, icon: 'paperclip', onSelect: () => doc.current?.click() },
          ]}
        />
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
          aria-label={isInternal ? copy.internal : copy.customer}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          onPaste={(e) => {
            // A pasted screenshot becomes an attachment, as in other chat apps.
            const pasted = Array.from(e.clipboardData.files)
            if (pasted.length > 0) {
              e.preventDefault()
              setFiles((all) => [...all, ...pasted])
            }
          }}
        />
        <VoiceRecorder
          conversationId={conversationId}
          visibility={visibility}
          copy={copy}
          locale={locale}
          autoStart={autoStartVoice}
          onAutoStarted={onVoiceAutoStarted}
          onSent={onVoiceSent}
        />
        <button
          type="button"
          className="cw-send"
          disabled={!canSend}
          onClick={submit}
          aria-label={copy.send}
          title={copy.send}
        >
          <Icon name="send" size={18} />
        </button>
      </div>
    </div>
  )
}
