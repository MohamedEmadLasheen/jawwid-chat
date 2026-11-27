import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { FlowSteps, FlowStrip, RequestQueue, ageText, waitedOvernight, type FlowCell, type RequestDetail } from './RequestQueue'

/**
 * The shared request queue: the strip that filters, the steps, the panel that
 * is a side sheet below 1100px, and the ages it words by the academy's calendar.
 */

/** The viewport the layout asks about: jsdom has no matchMedia, which the layout reads as narrow. */
function viewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: wide, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}
afterEach(() => vi.unstubAllGlobals())

type Key = 'all' | 'new' | 'late' | 'unknown'
const CELLS: Array<FlowCell<Key>> = [
  { key: 'all', label: 'All', count: 7, apart: true },
  { key: 'new', label: 'New', count: 0 },
  { key: 'late', label: 'Overdue', count: 25, more: true, note: 'oldest 3 days ago', late: true },
  { key: 'unknown', label: 'Closed', count: null },
]

describe('FlowStrip', () => {
  it('shows each state with its count, marks the active one and filters on a click', async () => {
    const onChange = vi.fn()
    renderWithProviders(<FlowStrip label="States" cells={CELLS} value="all" onChange={onChange} />)
    const strip = screen.getByRole('group', { name: 'States' })
    expect(within(strip).getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(strip).getByRole('button', { name: /^New/ })).toHaveAttribute('aria-pressed', 'false')
    // A count of zero is a count; a list longer than was counted says so.
    expect(within(strip).getByRole('button', { name: /^New/ })).toHaveTextContent('0')
    expect(within(strip).getByRole('button', { name: /^Overdue/ })).toHaveTextContent('25+')
    // The "+" is drawn for the eye and spoken as words.
    expect(within(strip).getByRole('button', { name: /^Overdue/ })).toHaveAccessibleName(/^Overdue\s*25\s*or more\s*oldest 3 days ago$/)
    await userEvent.click(within(strip).getByRole('button', { name: /^Overdue/ }))
    expect(onChange).toHaveBeenCalledWith('late')
  })

  it('never shows a zero for a count it does not know', () => {
    renderWithProviders(<FlowStrip label="States" cells={CELLS} value="all" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Closed' })).toHaveTextContent(/^Closed$/)
  })

  it('keeps tab semantics where the page had tabs', () => {
    renderWithProviders(<FlowStrip tabs label="States" cells={CELLS} value="new" onChange={() => {}} />)
    const tabs = within(screen.getByRole('tablist', { name: 'States' })).getAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false'])
    expect(tabs[1]).not.toHaveAttribute('aria-pressed')
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
      <RequestQueue label="Details" detail={detail()} placeholder={<p>Open a row</p>}>
        <p>the queue</p>
      </RequestQueue>,
    )
    const sheet = screen.getByRole('dialog', { name: 'Child Alpha' })
    expect(within(sheet).getByText('the body')).toBeInTheDocument()
    expect(within(sheet).getByText('Certificate')).toBeInTheDocument()
    expect(within(sheet).getByText('Pending')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByText('Open a row')).not.toBeInTheDocument()
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

  it('says what a row will show while none is open, and offers no close on a panel that always shows one', () => {
    viewport(true)
    const { rerender } = renderWithProviders(
      <RequestQueue label="Details" detail={null} placeholder={<p>Open a row</p>}>
        <p>the queue</p>
      </RequestQueue>,
    )
    expect(within(screen.getByRole('complementary', { name: 'Details' })).getByText('Open a row')).toBeInTheDocument()
    rerender(
      <RequestQueue label="Details" detail={detail({ pinned: true })}>
        <p>the queue</p>
      </RequestQueue>,
    )
    expect(within(screen.getByRole('complementary', { name: 'Details' })).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('with nothing open and nothing to say, the queue has the page to itself', () => {
    viewport(true)
    renderWithProviders(
      <RequestQueue label="Details" detail={null}>
        <p>the queue</p>
      </RequestQueue>,
    )
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
