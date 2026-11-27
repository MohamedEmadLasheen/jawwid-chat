import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import {
  Board,
  BoardCard,
  DetailFoot,
  FlowSteps,
  QueueGroup,
  QueueRow,
  RequestQueue,
  ageText,
  waitedOvernight,
  type BoardStage,
  type RequestDetail,
} from './RequestQueue'

/**
 * The shared request pattern: the board and its cards, headed groups of rows,
 * the steps, the inspector (a side sheet below 1100px) with its one stated
 * action, and the ages it words by the academy's calendar.
 */

/** The viewport the layout asks about: jsdom has no matchMedia, which the layout reads as narrow. */
function viewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: wide, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}
afterEach(() => vi.unstubAllGlobals())

type Key = 'new' | 'late' | 'empty' | 'unknown'
const stages = (): Array<BoardStage<Key>> => [
  { key: 'new', label: 'New', count: 2, cards: [<BoardCard key="a" title="Family Alpha" onOpen={() => {}} />, <BoardCard key="b" title="Family Beta" onOpen={() => {}} />], empty: 'None here.' },
  { key: 'late', label: 'Overdue', count: 25, more: true, urgent: true, cards: <BoardCard title="Family Gamma" onOpen={() => {}} />, empty: 'None here.' },
  { key: 'empty', label: 'Done', count: 0, cards: null, empty: 'None here.' },
  { key: 'unknown', label: 'Closed', count: null, cards: null, empty: 'None here.' },
]

describe('Board', () => {
  it('with room it is one column per stage, in order, each headed by its name and count', () => {
    viewport(true)
    renderWithProviders(<Board label="Stages" stages={stages()} value="all" onChange={() => {}} />)
    const board = screen.getByRole('group', { name: 'Stages' })
    expect(within(board).getAllByRole('region').map((c) => c.getAttribute('aria-label'))).toEqual(['New', 'Overdue', 'Done', 'Closed'])
    const late = within(board).getByRole('region', { name: 'Overdue' })
    // A list longer than was counted says so: "+" for the eye, words for a screen reader.
    expect(late.querySelector('.count')).toHaveTextContent(/^25\+\s*or more$/)
    // The stage that holds a real problem is the one solid terracotta counter.
    expect(late.querySelector('.count')).toHaveClass('count--urgent')
    expect(within(board).getByRole('region', { name: 'New' }).querySelector('.count')).not.toHaveClass('count--urgent')
    // An empty stage keeps its column and says so in one line; a count that is not known is not shown as a zero.
    expect(within(within(board).getByRole('region', { name: 'Done' })).getByText('None here.')).toBeInTheDocument()
    expect(within(board).getByRole('region', { name: 'Closed' }).querySelector('.count')).toBeNull()
    // No tabs beside the columns.
    expect(within(board).queryByRole('button', { name: /^Overdue/ })).not.toBeInTheDocument()
  })

  it('without room the stages are tabs with their counts, and the cards a list', async () => {
    const onChange = vi.fn()
    const { rerender } = renderWithProviders(<Board label="Stages" stages={stages()} value="all" onChange={onChange} />)
    const tabs = screen.getByRole('group', { name: 'Stages' })
    expect(within(tabs).getAllByRole('button').map((t) => t.textContent)).toEqual(['All', 'New2', 'Overdue25+ or more', 'Done0', 'Closed'])
    expect(within(tabs).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true')
    // Under "All" a stage with nothing in it is left out: its tab already says so.
    expect(screen.queryByRole('region', { name: 'Done' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Family Gamma' })).toBeInTheDocument()
    await userEvent.click(within(tabs).getByRole('button', { name: /^Overdue/ }))
    expect(onChange).toHaveBeenCalledWith('late')
    rerender(<Board label="Stages" stages={stages()} value="late" onChange={onChange} />)
    expect(screen.getByRole('button', { name: /^Overdue/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('heading', { name: 'Family Alpha' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Family Gamma' })).toBeInTheDocument()
  })

  it('leaves the switch to the page when its masthead figures are the stages', () => {
    renderWithProviders(<Board label="Stages" stages={stages()} value="all" onChange={() => {}} tabs={false} />)
    expect(screen.queryByRole('group', { name: 'Stages' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Family Alpha' })).toBeInTheDocument()
  })
})

describe('BoardCard', () => {
  it('opens from its name or anywhere on it, but never from its own controls', async () => {
    const onOpen = vi.fn()
    const act = vi.fn()
    renderWithProviders(
      <BoardCard title="Family Alpha" onOpen={onOpen} selected age="2 days ago" actions={<button type="button" onClick={act}>Assign</button>}>
        <p>Child One</p>
      </BoardCard>,
    )
    const card = screen.getByRole('article')
    expect(card).toHaveAttribute('data-selected', 'true')
    await userEvent.click(within(card).getByRole('button', { name: 'Family Alpha' }))
    await userEvent.click(within(card).getByText('Child One'))
    expect(onOpen).toHaveBeenCalledTimes(2)
    await userEvent.click(within(card).getByRole('button', { name: 'Assign' }))
    expect(act).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('when its one action is "Open", the name is plain text: one control, not two', () => {
    renderWithProviders(<BoardCard title="Lead Alpha" titleOpens={false} onOpen={() => {}} actions={<button type="button">Open</button>} />)
    expect(screen.getByRole('heading', { name: 'Lead Alpha' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})

describe('QueueGroup and QueueRow', () => {
  it('a group is a headed sheet with its count; an urgent one counts in solid terracotta', () => {
    renderWithProviders(
      <>
        <QueueGroup title="Waiting since before today" count={3} tone="urgent" note="oldest 3 days ago">
          <QueueRow title="Child Alpha" sub="Needs an outcome" fact="Teacher One" />
        </QueueGroup>
        <QueueGroup title="Today" count={1}>
          <QueueRow title="Child Beta" />
        </QueueGroup>
      </>,
    )
    const late = screen.getByRole('region', { name: 'Waiting since before today' })
    expect(within(late).getByRole('heading', { level: 2 })).toHaveTextContent('Waiting since before today3')
    expect(late.querySelector('.count')).toHaveClass('count--urgent')
    expect(within(late).getByText('oldest 3 days ago')).toBeInTheDocument()
    expect(within(late).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Today' }).querySelector('.count')).not.toHaveClass('count--urgent')
  })

  it('a row that opens does so from its name and from the row; one that does not has no button', async () => {
    const onOpen = vi.fn()
    renderWithProviders(
      <ul>
        <QueueRow title="Child Alpha" onOpen={onOpen} selected actions={<button type="button">Record outcome</button>} fact="Teacher One" />
        <QueueRow title="Child Beta" />
      </ul>,
    )
    const [first, second] = screen.getAllByRole('listitem')
    expect(within(first!).getByRole('button', { name: 'Child Alpha' })).toHaveAttribute('aria-current', 'true')
    await userEvent.click(within(first!).getByText('Teacher One'))
    expect(onOpen).toHaveBeenCalledTimes(1)
    await userEvent.click(within(first!).getByRole('button', { name: 'Record outcome' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(within(second!).queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('DetailFoot', () => {
  it('states one action and keeps the rest behind "⋯", the one that ends the request marked', async () => {
    const cancel = vi.fn()
    renderWithProviders(
      <DetailFoot
        label="More actions: Child Alpha"
        primary={<button type="button">Approve</button>}
        more={[
          { key: 'redo', label: 'Ask for a redesign', onSelect: () => {} },
          { key: 'cancel', label: 'Cancel request', danger: true, onSelect: cancel },
        ]}
      />,
    )
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Approve', 'More actions: Child Alpha'])
    await userEvent.click(screen.getByRole('button', { name: 'More actions: Child Alpha' }))
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Ask for a redesign', 'Cancel request'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cancel request' }))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('is not there at all with nothing to do', () => {
    const { container } = renderWithProviders(<DetailFoot label="More actions" />)
    expect(container.querySelector('.rq-foot')).toBeNull()
  })
})

describe('FlowSteps', () => {
  const steps = [
    { key: 'a', label: 'Requested', state: 'done' as const, meta: 'Supervisor One' },
    { key: 'b', label: 'Design', state: 'current' as const },
    { key: 'c', label: 'Review', state: 'todo' as const },
  ]

  it('lists the steps in order and says where the request stands, not by colour alone', () => {
    renderWithProviders(<FlowSteps label="Steps" steps={steps} />)
    const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual(['Requested (done)Supervisor One', 'Design (now)', 'Review (next)'])
    expect(items[1]).toHaveAttribute('aria-current', 'step')
    expect(items[0]).not.toHaveAttribute('aria-current')
  })

  it('says it in Arabic too', () => {
    renderWithProviders(<FlowSteps label="الخطوات" steps={steps} />, { locale: 'ar' })
    expect(within(screen.getByRole('list', { name: 'الخطوات' })).getAllByRole('listitem')[1]).toHaveTextContent('(الآن)')
  })
})

describe('RequestQueue', () => {
  const detail = (over: Partial<RequestDetail> = {}): RequestDetail => ({
    id: 'r-1',
    title: 'Child Alpha',
    kind: { icon: 'certificates', label: 'Certificate' },
    status: <span>Pending</span>,
    body: <p>the body</p>,
    onClose: () => {},
    ...over,
  })

  it('below 1100px the detail is the side sheet, and there is no panel', () => {
    renderWithProviders(
      <RequestQueue label="Details" detail={detail()}>
        <p>the queue</p>
      </RequestQueue>,
    )
    const sheet = screen.getByRole('dialog', { name: 'Child Alpha' })
    expect(within(sheet).getByText('the body')).toBeInTheDocument()
    expect(within(sheet).getByText('Certificate')).toBeInTheDocument()
    expect(within(sheet).getByText('Pending')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('from 1100px the detail stays on screen beside the queue, with its title as a heading', async () => {
    viewport(true)
    const onClose = vi.fn()
    renderWithProviders(
      <RequestQueue label="Details" detail={detail({ onClose })}>
        <p>the queue</p>
      </RequestQueue>,
    )
    const panel = screen.getByRole('complementary', { name: 'Details' })
    expect(within(panel).getByRole('heading', { name: 'Child Alpha' })).toBeInTheDocument()
    expect(within(panel).getByText('the body')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('with no row open there is no panel: the queue has the page to itself until one opens', () => {
    viewport(true)
    const { rerender, container } = renderWithProviders(
      <RequestQueue label="Details" detail={null}>
        <p>the queue</p>
      </RequestQueue>,
    )
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(container.querySelector('.rq')).not.toHaveClass('rq--split')
    rerender(
      <RequestQueue label="Details" detail={detail({ pinned: true })}>
        <p>the queue</p>
      </RequestQueue>,
    )
    expect(container.querySelector('.rq')).toHaveClass('rq--split')
    // A panel that always shows a row offers no close.
    expect(within(screen.getByRole('complementary', { name: 'Details' })).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('a page whose panel always shows a row keeps its place while the list loads, so nothing moves when it arrives', () => {
    viewport(true)
    const { container } = renderWithProviders(
      <RequestQueue label="Details" detail={null} reserve>
        <p>the queue</p>
      </RequestQueue>,
    )
    expect(container.querySelector('.rq')).toHaveClass('rq--split')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
})

describe('ages, by the academy calendar', () => {
  // 12:00 in Cairo on Friday 27 November 2026.
  const now = new Date('2026-11-27T10:00:00Z')

  it('words an age in the reader\'s language, with Western digits in Arabic', () => {
    expect(ageText('2026-11-27T07:00:00Z', 'en', now)).toBe('3 hours ago')
    expect(ageText('2026-11-27T09:40:00Z', 'en', now)).toBe('20 minutes ago')
    expect(ageText('2026-11-29T09:00:00Z', 'en', now)).toBe('in 2 days')
    expect(ageText('2026-11-24T10:00:00Z', 'ar', now)).toMatch(/3/)
    expect(ageText('2026-11-24T10:00:00Z', 'ar', now)).not.toMatch(/[٠-٩]/)
  })

  it('counts days on the academy\'s calendar, not in blocks of 24 hours', () => {
    // 23:30 the evening before in Cairo: thirteen hours ago, and yesterday.
    expect(ageText('2026-11-26T21:30:00Z', 'en', now)).toBe('yesterday')
    expect(ageText('2026-11-28T00:30:00Z', 'en', now)).toBe('tomorrow')
  })

  it('late is "left since before today": minutes can be enough, a long same day is not', () => {
    // 23:59 on the 26th, read at 00:01 on the 27th (Cairo).
    expect(waitedOvernight('2026-11-26T21:59:00Z', new Date('2026-11-26T22:01:00Z'))).toBe(true)
    // 00:05 on the 27th, read at 23:50 the same day.
    expect(waitedOvernight('2026-11-26T22:05:00Z', new Date('2026-11-27T21:50:00Z'))).toBe(false)
    expect(waitedOvernight('not a date', now)).toBe(false)
  })
})
