import { useI18n } from '@/core/i18n/I18nProvider'
import { Avatar } from '@/shared/components/Avatar'
import type { Conversation } from '@/shared/types/conversation'
import { titleOf } from './conversationDisplay'

/**
 * THE CONVERSATION LIST ITEM — the most-used component in the product.
 *
 * `design-system.md` §7.8 and `admin-inbox.md` §4: one identity mark, one
 * primary line, at most two secondary lines. Line 3 is **omitted entirely**
 * when there is nothing to say, and it never carries a fourth chip — a fourth
 * line is how a list stops being scannable.
 *
 * ## What it deliberately does not show
 *
 * No attention score, no bucket number, no priority label, no phone number.
 * The API computes no attention value and this console invents none; what a
 * row says about urgency is the section it is sitting in, which is the
 * server's `needsReply`, and nothing else.
 *
 * ## The preview is the server's
 *
 * `lastMessagePreview` is the newest message THIS operator may read — the API
 * picked it. An internal note never becomes a family's preview for somebody
 * who cannot read one, because the choice was never made here.
 */
export function ConversationListItem({
  conversation,
  isSelected,
  onSelect,
}: {
  conversation: Conversation
  isSelected: boolean
  onSelect: () => void
}) {
  const { t, duration } = useI18n()

  const title = titleOf(conversation)
  const unread = conversation.unreadCount ?? 0
  const isGroup =
    conversation.type === 'student_group' || conversation.type === 'class_group'

  /**
   * Line 3, in one fixed order, capped at three. The order is fixed so an
   * operator's eye learns one position per fact instead of re-reading the row.
   */
  const chips: Array<{ key: string; label: string; tone?: string }> = []
  if (conversation.type === 'student_group') {
    chips.push({ key: 'group', label: t('conversation.group'), tone: 'chip--brand' })
  } else if (conversation.type === 'class_group') {
    chips.push({ key: 'class', label: t('conversation.classGroup'), tone: 'chip--brand' })
  } else if (conversation.type === 'official') {
    chips.push({ key: 'official', label: t('conversation.official'), tone: 'chip--brand' })
  }
  if (conversation.teacherRequiresApproval || conversation.parentRequiresApproval) {
    chips.push({
      key: 'approval',
      label: t('message.pendingApproval'),
      tone: 'chip--warning',
    })
  }
  if (conversation.isMuted) {
    chips.push({ key: 'muted', label: t('member.silent') })
  }

  const classes = [
    'conv-row',
    isSelected ? 'conv-row--selected' : '',
    unread > 0 ? 'conv-row--unread' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li>
      <button type="button" className={classes} aria-current={isSelected} onClick={onSelect}>
        <Avatar name={title} kind={isGroup ? 'group' : 'person'} />

        <span className="conv-row__body">
          <span className="conv-row__line1">
            {/* The full name reaches assistive tech and the tooltip even when
                the visible text truncates at the logical end. */}
            <span className="conv-row__name" title={title}>
              {title}
            </span>
            <span className="conv-row__time">{duration(conversation.lastActivityAt)}</span>
          </span>

          <span className="conv-row__line2">
            <span className="conv-row__preview">{conversation.lastMessagePreview}</span>
            {unread > 0 && (
              <span className="conv-row__unread">
                {/* 99+ cap: a four-digit pill would push the name out of the
                    row it belongs to. */}
                <span aria-hidden="true">{unread > 99 ? '99+' : unread}</span>
                <span className="sr-only">
                  {t('conversation.unread', { count: String(unread) })}
                </span>
              </span>
            )}
          </span>

          {chips.length > 0 && (
            <span className="conv-row__line3">
              {chips.slice(0, 3).map((chip) => (
                <span key={chip.key} className={`chip ${chip.tone ?? ''}`}>
                  {chip.label}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

/** The list's loading state: shape-matched rows, never a spinner (§7.10). */
export function ConversationListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <div className="skeleton skeleton-row__avatar" />
          <div className="skeleton-row__lines">
            <div className="skeleton skeleton-line" style={{ inlineSize: '55%' }} />
            <div className="skeleton skeleton-line" style={{ inlineSize: '85%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
