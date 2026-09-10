import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { ConversationListItem } from './ConversationListItem'
import { initialsOf } from '@/shared/components/Avatar'
import { renderWithProviders } from '@/test/utils'
import type { Conversation } from '@/shared/types/conversation'

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv_1',
    type: 'direct',
    familyId: 'fam_1',
    learnerId: null,
    title: 'أسرة العبد الله',
    state: 'open',
    needsReply: true,
    lastSeq: '10',
    lastActivityAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    archivedAt: null,
    teacherRequiresApproval: false,
    parentRequiresApproval: false,
    members: [],
    unreadCount: 0,
    lastMessagePreview: 'السلام عليكم',
    ...overrides,
  }
}

/**
 * Initials are drawn from a conversation TITLE, which is often a composed
 * identity rather than a person's name. A separator that became an initial is
 * what produced «l·» for `learner_smoke · Jawwid` on the real stack.
 */
describe('avatar initials', () => {
  it('never treats a separator as a name token', () => {
    expect(initialsOf('learner_smoke · Jawwid')).toBe('LJ')
    expect(initialsOf('parent_smoke، manager_smoke')).toBe('PM')
    expect(initialsOf('نور — سارة')).toBe('نس')
    expect(initialsOf('Ahmed | Support')).toBe('AS')
  })

  it('reads Arabic names, and drops the definite article', () => {
    // «أسرة العبد الله» abbreviated through «ال» would be «أ ا», which says
    // nothing; the article is skipped so the second initial is a real letter.
    expect(initialsOf('أسرة العبد الله')).toBe('أع')
    expect(initialsOf('مجموعة الطالب سلمى')).toBe('مط')
    // A single name gives up its first two letters rather than one.
    expect(initialsOf('سلمى')).toBe('سل')
  })

  it('uppercases Latin initials and leaves Arabic untouched', () => {
    expect(initialsOf('family smoke')).toBe('FS')
    expect(initialsOf('نور المنصوري')).toBe('نم')
  })

  it('survives a name made only of punctuation, or of none at all', () => {
    expect(initialsOf('···')).toBe('؟')
    expect(initialsOf('   ')).toBe('؟')
    expect(initialsOf('')).toBe('؟')
  })

  it('trims punctuation inside a token rather than making it the initial', () => {
    expect(initialsOf('_smoke (Jawwid)')).toBe('SJ')
  })
})

/**
 * FIX 5 — the unread visual state, verified here because the real verification
 * database has no unread conversation and creating one would mean seeding it.
 */
describe('unread state', () => {
  it('marks the row, shows the count, and announces it in words', () => {
    renderWithProviders(
      <ConversationListItem
        conversation={makeConversation({ unreadCount: 3 })}
        isSelected={false}
        onSelect={() => {}}
      />,
      { locale: 'ar' },
    )

    const row = screen.getByRole('button')
    expect(row.className).toContain('conv-row--unread')
    expect(screen.getByText('3')).toBeInTheDocument()
    // Never a count by digit alone: the pill carries a real sentence for a
    // screen reader.
    expect(screen.getByText('3 غير مقروءة')).toBeInTheDocument()
  })

  it('caps the pill at 99+ so a long count cannot push the name out of the row', () => {
    renderWithProviders(
      <ConversationListItem
        conversation={makeConversation({ unreadCount: 1240 })}
        isSelected={false}
        onSelect={() => {}}
      />,
      { locale: 'ar' },
    )
    expect(screen.getByText('99+')).toBeInTheDocument()
    // The accessible name still states the true number.
    expect(screen.getByText('1240 غير مقروءة')).toBeInTheDocument()
  })

  it('renders no pill and no unread styling at zero', () => {
    renderWithProviders(
      <ConversationListItem
        conversation={makeConversation({ unreadCount: 0 })}
        isSelected={false}
        onSelect={() => {}}
      />,
      { locale: 'ar' },
    )
    const row = screen.getByRole('button')
    expect(row.className).not.toContain('conv-row--unread')
    expect(screen.queryByText(/غير مقروءة/)).not.toBeInTheDocument()
  })

  it('marks the selected row for assistive tech, not by colour alone', () => {
    renderWithProviders(
      <ConversationListItem
        conversation={makeConversation()}
        isSelected
        onSelect={() => {}}
      />,
      { locale: 'ar' },
    )
    const row = screen.getByRole('button')
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(row.className).toContain('conv-row--selected')
  })
})

/**
 * FIX 4 — the visible text may truncate, but the full identity has to remain
 * reachable by tooltip and by screen reader.
 */
describe('conversation identity', () => {
  it('keeps the whole name in the title attribute when it is long', () => {
    const long = 'parent_smoke، manager_smoke، supervisor_smoke، teacher_smoke'
    renderWithProviders(
      <ConversationListItem
        conversation={makeConversation({ title: long })}
        isSelected={false}
        onSelect={() => {}}
      />,
      { locale: 'ar' },
    )
    expect(screen.getByTitle(long)).toHaveTextContent(long)
  })
})
