import { useQuery } from '@tanstack/react-query'
import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import { Dialog } from '@/shared/components/Dialog'
import { chatApi, chatKeys, type ChatMessage, type MessageInfoEntry } from './chatApi'
import { liveCopyFor } from './liveCopy'

/**
 * PD-37: the ticks on the viewer's own message -- ✓ sent, ✓✓ delivered to
 * every seated member, blue ✓✓ read by all of them. The server decides the
 * state (`status`); this only draws it. Not mirrored in Arabic: a tick reads
 * the same both ways, as in every messaging app.
 */
export function Ticks({ status }: { status: ChatMessage['status'] }) {
  const { locale } = useI18n()
  if (!status) return null
  const copy = liveCopyFor(locale)
  const label = status === 'read' ? copy.statusRead : status === 'delivered' ? copy.statusDelivered : copy.statusSent
  return (
    <span className={`cw-ticks cw-ticks--${status}`} role="img" aria-label={label} title={label}>
      <svg width={status === 'sent' ? 12 : 16} height={12} viewBox={status === 'sent' ? '0 0 12 12' : '0 0 16 12'} aria-hidden="true">
        <path d="M1.5 6.5 4.5 9.5 10.5 2.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        {status !== 'sent' && (
          <path d="M6.5 9.5 14.5 2.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  )
}

function InfoList({ title, people, empty }: { title: string; people: MessageInfoEntry[]; empty: string }) {
  const { dateTime } = useI18n()
  return (
    <section className="cw-info-list">
      <h3 className="dp-section__title">{title}</h3>
      {people.length === 0 ? (
        <p className="field__hint">{empty}</p>
      ) : (
        <ul className="cw-info-list__people">
          {people.map((p) => (
            <li key={p.actorId} className="cw-info-list__person">
              <Avatar name={p.displayName || '?'} seed={p.actorId} size="sm" src={p.avatarUrl} />
              <span className="cw-info-list__name" dir="auto">
                {p.displayName || '—'}
              </span>
              {p.at && <time dateTime={p.at}>{dateTime(p.at)}</time>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * PD-37: who read a message, who has it, who does not yet. Seated members
 * only, as the server answers it; a PD-8 reader without a seat is never in it.
 */
export function MessageInfoDialog({
  conversationId,
  messageId,
  onClose,
}: {
  conversationId: string
  messageId: string
  onClose: () => void
}) {
  const { locale } = useI18n()
  const copy = liveCopyFor(locale)
  const info = useQuery({
    queryKey: chatKeys.messageInfo(conversationId, messageId),
    queryFn: () => chatApi.messageInfo(conversationId, messageId),
  })
  return (
    <Dialog
      title={copy.messageInfo}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {copy.infoClose}
        </button>
      }
    >
      {info.isPending && <p className="field__hint">{copy.infoLoading}</p>}
      {info.isError && (
        <p className="field__error" role="alert">
          {copy.infoFailed}
        </p>
      )}
      {info.data && (
        <>
          <InfoList title={copy.infoReadBy} people={info.data.readBy} empty={copy.infoNobody} />
          <InfoList title={copy.infoDeliveredTo} people={info.data.deliveredTo} empty={copy.infoNobody} />
          <InfoList title={copy.infoPending} people={info.data.pending} empty={copy.infoNobody} />
        </>
      )}
    </Dialog>
  )
}
