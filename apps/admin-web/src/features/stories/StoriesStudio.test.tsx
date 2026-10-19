import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'

/**
 * The Stories studio's contract with the server and with the operator:
 * what it sends (an audience, never a recipient; no caption, no title), what
 * it shows before publishing (who it will reach), and what it shows after
 * (how it performed).
 */

const NOW = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()
const superAdmin = makeStaff({ id: 'owner_o', name: 'Owner O', role: 'super_admin' })
const supervisor = makeStaff({ id: 'admin_a', name: 'Admin A', role: 'admin' })

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (body: any, url: URL) => unknown
/** `METHOD /path` -> a body or a handler; anything unrouted is a 404. */
function server(routes: Record<string, Handler | object>) {
  return vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x')
    const path = url.pathname.replace(/^.*\/api\/v1/, '')
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${path}`
    if (key in routes) {
      const r = routes[key]
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      return jsonResponse(typeof r === 'function' ? (r as Handler)(body, url) : r)
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message: `no route ${key}` } }, 404)
  })
}

const FACTS = {
  families: 4, contacts: 5, teachers: 3,
  countries: [{ code: 'AE', families: 2 }, { code: 'KW', families: 1 }],
  plans: [{ months: 1, families: 1 }, { months: 3, families: 0 }, { months: 6, families: 1 }, { months: 12, families: 1 }],
  children: [{ bucket: 1, families: 1 }, { bucket: 2, families: 1 }, { bucket: 3, families: 0 }, { bucket: 4, families: 1 }],
  unknownCountry: 1, unknownPlan: 1, noChildren: 1,
}

function story(over: Record<string, unknown> = {}) {
  return {
    id: 'st1', kind: 'text', internalName: 'Eid greeting', title: null, body: 'Eid Mubarak', background: 'teal',
    mediaKind: null, mediaUrl: null, mediaDurationMs: null,
    cta: { kind: 'whatsapp', label: null, url: 'https://wa.me/971501234567', phone: '971501234567' },
    state: 'published', createdAt: iso(NOW - 86_400_000), publishedAt: iso(NOW - 86_400_000), expiresAt: null,
    deletedAt: null, createdBy: 'owner_o', creatorName: 'Owner O',
    audiences: [{ kind: 'segment', refId: null, filter: { who: 'families', countries: ['AE'], planMonths: [6] } }],
    recipientCount: 40, viewCount: 30, ctaTapCount: 12, ctaTapperCount: 9,
    ...over,
  }
}

const ANALYTICS = {
  storyId: 'st1', state: 'published', publishedAt: iso(NOW - 86_400_000),
  reach: { total: 40, contacts: 40, teachers: 0, families: 25 },
  views: { total: 30, contacts: 30, teachers: 0 },
  cta: { kind: 'whatsapp', taps: 12, tappers: 9 },
  rates: { view: 0.75, tapOfViews: 0.3, tapOfReach: 0.225 },
  firstViewAt: iso(NOW - 80_000_000), lastViewAt: iso(NOW - 1000),
  daily: [{ date: '2026-10-16', views: 22, taps: 8 }, { date: '2026-10-17', views: 8, taps: 4 }],
  byCountry: [{ code: 'AE', reach: 38, views: 29, tappers: 9 }, { code: null, reach: 2, views: 1, tappers: 0 }],
}

beforeEach(() => {
  localStorage.clear()
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('composing', () => {
  it('publishes a text story to an audience: no title, no recipients, one segment clause', async () => {
    const created: unknown[] = []
    const fetchMock = server({
      'GET /stories/audience/facts': FACTS,
      'POST /stories/audience/estimate': { recipients: 8, contacts: 5, teachers: 3, families: 4, excludedByReplyScope: 0 },
      'POST /stories': (body) => {
        created.push(body)
        return story({ id: 'new1', state: 'draft' })
      },
      'POST /stories/new1/publish': story({ id: 'new1' }),
      'GET /stories/new1': story({ id: 'new1' }),
      'GET /stories/new1/analytics': { ...ANALYTICS, storyId: 'new1' },
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories/new' })

    await userEvent.type(await screen.findByRole('textbox', { name: 'Write your story…' }), 'Eid Mubarak')
    await userEvent.click(screen.getByRole('radio', { name: 'Plum' }))
    await userEvent.click(screen.getByRole('radio', { name: /Everyone/ }))
    // The audience size is shown BEFORE anything is published.
    expect(await screen.findByText('8 people')).toBeInTheDocument()
    expect(screen.getByText('5 parents · 3 teachers · 4 families')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Publish now/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish this story?' })
    expect(within(dialog).getByText(/goes to 8 people now and stays up until you delete it/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish now' }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0]).toEqual({
      body: 'Eid Mubarak',
      background: 'plum',
      audiences: [{ kind: 'segment', filter: { who: 'everyone' } }],
    })
    // ...and lands on the new story's insights.
    expect(await screen.findByRole('heading', { level: 1, name: /Eid greeting/ })).toBeInTheDocument()
  })

  it('narrows parents by plan, children and country, and the estimate follows', async () => {
    const estimates: unknown[] = []
    vi.stubGlobal(
      'fetch',
      server({
        'GET /stories/audience/facts': FACTS,
        'POST /stories/audience/estimate': (body) => {
          estimates.push(body)
          return { recipients: 2, contacts: 2, teachers: 0, families: 1, excludedByReplyScope: 0 }
        },
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories/new' })
    await userEvent.click(await screen.findByRole('radio', { name: /Parents & students/ }))

    const plan = screen.getByRole('group', { name: 'Subscription plan' })
    await userEvent.click(within(plan).getByRole('button', { name: /6 months/ }))
    const kids = screen.getByRole('group', { name: 'Number of children' })
    await userEvent.click(within(kids).getByRole('button', { name: /4 or more/ }))
    const country = screen.getByRole('group', { name: 'Country' })
    // Countries in the data are offered with their family counts.
    const uae = within(country).getByRole('button', { name: /United Arab Emirates\s*2/ })
    await userEvent.click(uae)
    expect(uae).toHaveAttribute('aria-pressed', 'true')
    expect(within(country).getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'false')

    await waitFor(() =>
      expect(estimates.at(-1)).toEqual({
        audiences: [{ kind: 'segment', filter: { who: 'families', planMonths: [6], children: [4], countries: ['AE'] } }],
        ctaKind: null,
      }),
    )
    // A blind spot is said out loud, with a way to fix it.
    expect(screen.getByText(/1 families have no country recorded/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fill it in' })).toHaveAttribute('href', '/admin/stories?tab=audience')
  })

  it('a "Message me" button tells the publisher who is left out, and why', async () => {
    const estimates: Array<{ ctaKind: string | null }> = []
    vi.stubGlobal(
      'fetch',
      server({
        'GET /stories/audience/facts': FACTS,
        'POST /stories/audience/estimate': (body) => {
          estimates.push(body as { ctaKind: string | null })
          return { recipients: 2, contacts: 2, teachers: 0, families: 1, excludedByReplyScope: 3 }
        },
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/stories/new' })
    await userEvent.click(await screen.findByRole('radio', { name: 'Message me' }))
    await userEvent.click(screen.getByRole('radio', { name: /Parents & students/ }))
    expect(await screen.findByText(/3 left out: with a “Message me” button/)).toBeInTheDocument()
    expect(estimates.at(-1)!.ctaKind).toBe('message_publisher')
  })

  it('refuses a link that is not https before sending anything', async () => {
    const fetchMock = server({
      'GET /stories/audience/facts': FACTS,
      'POST /stories/audience/estimate': { recipients: 3, contacts: 0, teachers: 3, families: 0, excludedByReplyScope: 0 },
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories/new' })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Write your story…' }), 'Open day')
    await userEvent.click(screen.getByRole('radio', { name: 'Link' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Link' }), 'http://jawwid.example')
    await userEvent.click(screen.getByRole('radio', { name: /Teachers/ }))
    await userEvent.click(screen.getByRole('button', { name: /Publish now/ }))

    expect(screen.getByRole('textbox', { name: 'Link' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const created = fetchMock.mock.calls.some(
      ([u, init]) => init?.method === 'POST' && new URL(String(u), 'http://x').pathname.endsWith('/stories'),
    )
    expect(created).toBe(false)
  })

  it('a photo, video or voice story offers no caption field', async () => {
    vi.stubGlobal('fetch', server({ 'GET /stories/audience/facts': FACTS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories/new' })
    for (const kind of ['Photo', 'Video', 'Voice']) {
      await userEvent.click(await screen.findByRole('radio', { name: kind }))
      expect(screen.queryByRole('textbox', { name: 'Write your story…' })).not.toBeInTheDocument()
      expect(screen.getByText(/Stories have no caption/)).toBeInTheDocument()
      expect(screen.getByLabelText('Choose a file')).toBeInTheDocument()
    }
  })
})

describe('insights', () => {
  it('shows reach, views, taps and their rates, a funnel, and a country breakdown', async () => {
    vi.stubGlobal('fetch', server({ 'GET /stories/st1': story(), 'GET /stories/st1/analytics': ANALYTICS }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories/st1' })

    const kpis = await screen.findByRole('region', { name: 'Insights' })
    expect(within(kpis).getByText('40')).toBeInTheDocument()
    expect(within(kpis).getByText('75% of reach')).toBeInTheDocument()
    expect(within(kpis).getByText('9')).toBeInTheDocument()
    expect(within(kpis).getByText('30% of viewers')).toBeInTheDocument()
    expect(within(kpis).getByText('12')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'From reach to action' })).toBeInTheDocument()
    const byCountry = screen.getByRole('heading', { name: 'By country' }).closest('section')!
    expect(within(byCountry).getByText(/United Arab Emirates/)).toBeInTheDocument()
    expect(within(byCountry).getByText('Not set')).toBeInTheDocument()
    // The audience is described in words, and the story never expires.
    expect(screen.getAllByText(/Parents & students · United Arab Emirates · 6 months/).length).toBeGreaterThan(0)
    expect(screen.getByText('Stays up until deleted')).toBeInTheDocument()
  })

  it('fetches who viewed only when asked -- the most sensitive read is never prefetched', async () => {
    const fetchMock = server({
      'GET /stories/st1': story(),
      'GET /stories/st1/analytics': ANALYTICS,
      'GET /stories/st1/viewers': {
        viewers: [{ actorId: 'c1', displayName: 'Parent P', actorKind: 'contact', viewedAt: iso(NOW), ctaTaps: 2 }],
      },
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories/st1' })
    await screen.findByRole('region', { name: 'Insights' })
    const asked = () => fetchMock.mock.calls.some(([u]) => String(u).includes('/viewers'))
    expect(asked()).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'People' }))
    expect(await screen.findByText('Parent P')).toBeInTheDocument()
    expect(asked()).toBe(true)
  })

  it('deleting asks for a reason and sends it', async () => {
    const deletes: string[] = []
    vi.stubGlobal(
      'fetch',
      server({
        'GET /stories/st1': story(),
        'GET /stories/st1/analytics': ANALYTICS,
        'DELETE /stories/st1': (_b, url) => {
          deletes.push(url.searchParams.get('reason') ?? '')
          return { ok: true, alreadyDeleted: false }
        },
        'GET /stories': { stories: [] },
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories/st1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Delete story' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this story?' })
    const confirm = within(dialog).getByRole('button', { name: 'Delete story' })
    expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'wrong date')
    await userEvent.click(confirm)
    await waitFor(() => expect(deletes).toEqual(['wrong date']))
  })
})

describe('audience data', () => {
  const FAMILIES = {
    truncated: false,
    families: [
      { id: 'f1', displayName: 'family_w', countryCode: null, subscriptionPlanMonths: null, childCount: 0, segmentSource: null, segmentUpdatedAt: null },
    ],
  }

  it('the super admin sets a family’s country and plan, one audited change at a time', async () => {
    const posts: unknown[] = []
    vi.stubGlobal(
      'fetch',
      server({
        'GET /stories': { stories: [] },
        'GET /stories/audience/facts': FACTS,
        'GET /stories/audience/families': FAMILIES,
        'POST /stories/audience/families/f1': (body) => {
          posts.push(body)
          return { ...FAMILIES.families[0], countryCode: 'SA', segmentSource: 'admin' }
        },
      }),
    )
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories?tab=audience' })
    const select = await screen.findByRole('combobox', { name: 'Country: family_w' })
    await userEvent.selectOptions(select, 'SA')
    await waitFor(() => expect(posts).toEqual([{ countryCode: 'SA' }]))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('a supervisor publishes but is not offered the audience data', async () => {
    vi.stubGlobal('fetch', server({ 'GET /stories': { stories: [story()] } }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/stories?tab=audience' })
    expect(await screen.findByRole('link', { name: 'Eid greeting' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Audience data' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New story' })).toHaveAttribute('href', '/stories/new')
  })
})

describe('in Arabic', () => {
  it('speaks Arabic throughout, with the audience in Arabic words', async () => {
    vi.stubGlobal('fetch', server({ 'GET /stories': { stories: [story()] } }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/admin/stories', locale: 'ar' })
    expect(await screen.findByRole('link', { name: 'حالة جديدة' })).toBeInTheDocument()
    expect(await screen.findByText(/أولياء الأمور والطلاب · الإمارات العربية المتحدة · 6 أشهر/)).toBeInTheDocument()
    expect(screen.getAllByText('منشورة').length).toBeGreaterThan(0)
  })
})
