import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { ImportReport, MaterialItem } from './api'

/**
 * PD-29: the Materials page (Library, Import, Recitations), through the real
 * routes and the real API client, with `fetch` answered at the network
 * boundary. These prove each control sends its route and body, that the
 * library shows one subject at a time (Quran first, no "All"), that the
 * preview is sandboxed without same-origin, that an import is checked before
 * anything is written, that a file goes to storage without the session
 * bearer, and that the Student Profile no longer has a memorization map
 * (retired by the 2026-10-26 amendment).
 */

vi.setConfig({ testTimeout: 20_000 })
configure({ asyncUtilTimeout: 4_000 })

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: Array<[RegExp, string, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
function on(method: string, pattern: RegExp, handler: Handler) {
  routes.unshift([pattern, method, handler])
}
const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
const bodyOf = (call: unknown[] | undefined) => {
  if (!call) throw new Error('the request was not sent')
  return JSON.parse(String((call[1] as RequestInit).body))
}

function item(over: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'm-1', externalRef: 'naba-game', titleAr: 'لعبة سورة النبأ', titleEn: 'An-Naba game', subject: 'quran', strand: 'memorization',
    kind: 'activity_package', source: 'package', sitePath: null, url: null, mimeType: 'application/zip', byteSize: 1200, packageEntry: 'index.html',
    ageGroups: ['4-6', '7-9'], surah: 78, description: null, status: 'published', sortOrder: 1, createdAt: '2026-10-24T10:00:00Z', updatedAt: '2026-10-24T10:00:00Z',
    ...over,
  }
}

const LIBRARY: MaterialItem[] = [
  item(),
  item({ id: 'm-2', externalRef: null, titleAr: 'أنشودة الحروف', titleEn: 'Letters song', subject: 'arabic', strand: null, kind: 'video', source: 'url', url: 'https://videos.example.test/1', status: 'draft', surah: null, ageGroups: [], sortOrder: null }),
]

/** The library opens on Quran; the Arabic item is one chip away. */
async function showArabic() {
  await userEvent.click(await screen.findByRole('button', { name: 'Arabic language' }))
  await screen.findByText('Letters song')
}

const SURAHS = [
  { number: 1, nameAr: 'الفاتحة', nameEn: 'Al-Fatihah', ayahCount: 7, juz: 1, juzEnd: 1 },
  { number: 78, nameAr: 'النبأ', nameEn: 'An-Naba', ayahCount: 40, juz: 30, juzEnd: 30 },
]

const teachersManager = makeStaff({ id: 'tm-1', name: 'Teachers Manager', role: 'manager' })
const superAdmin = makeStaff({ id: 'sa-1', name: 'Owner', role: 'super_admin' })

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [pattern, m, handler] of routes) {
      if (m === method && pattern.test(url)) return handler(url, init)
    }
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: true, sales: false, operations: false }))
  on('GET', /\/instalments\/access$/, () => json({ billingReader: false }))
  on('GET', /\/materials\/admin\/access$/, () => json({ canManage: true }))
  on('GET', /\/materials\/quran\/surahs$/, () => json({ surahs: SURAHS }))
  on('GET', /\/materials\/admin\/items(\?.*)?$/, (url) => {
    const subject = new URL(url, 'https://api.example.test').searchParams.get('subject')
    return json({ items: LIBRARY.filter((i) => !subject || i.subject === subject) })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('Materials > Library', () => {
  it('is offered to the Teachers manager on the server\'s word, and lists items with status, subject, type and ages', async () => {
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/materials' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Materials' })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Library' })
    // One subject at a time, Quran first: there is no subject "All".
    expect(screen.getByRole('button', { name: 'Quran' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
    expect(String(calls('GET', /\/materials\/admin\/items/)[0]?.[0])).toContain('subject=quran')
    const [game] = within(list).getAllByRole('listitem')
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(game!).getByText('An-Naba game')).toBeInTheDocument()
    expect(within(game!).getByText('Published')).toBeInTheDocument()
    expect(within(game!).getByText('Activity (HTML5)')).toBeInTheDocument()
    expect(within(game!).getByText('4–6 years، 7–9 years')).toBeInTheDocument()
    expect(within(game!).getByText('Order 1')).toBeInTheDocument()
    await showArabic()
    const [song] = within(screen.getByRole('list', { name: 'Library' })).getAllByRole('listitem')
    expect(within(song!).getByText('Draft')).toBeInTheDocument()
    expect(within(song!).getByText('All ages')).toBeInTheDocument()
    expect(within(song!).getByRole('button', { name: 'Publish' })).toBeInTheDocument()
  })

  it('adds a link item: the form sends exactly the fields and the source', async () => {
    on('POST', /\/materials\/admin\/items$/, (_u, init) => json({ ...item({ id: 'm-3', source: 'url', kind: 'video' }), ...JSON.parse(String(init.body)) }, 201))
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/materials' })
    await userEvent.click(await screen.findByRole('button', { name: 'Add item' }))
    const dialog = await screen.findByRole('dialog', { name: 'New item' })
    await userEvent.type(within(dialog).getByLabelText('Title (Arabic)'), 'قصة الوضوء')
    await userEvent.selectOptions(within(dialog).getByLabelText('Subject'), 'islamic_studies')
    await userEvent.click(within(dialog).getByLabelText('7–9 years'))
    await userEvent.type(within(dialog).getByLabelText('Link'), 'https://stories.example.test/wudu')
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'video')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/materials\/admin\/items$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/materials\/admin\/items$/)[0])).toEqual({
      titleAr: 'قصة الوضوء', titleEn: null, subject: 'islamic_studies', strand: null, ageGroups: ['7-9'], surah: null,
      description: null, externalRef: null, url: 'https://stories.example.test/wudu', kind: 'video',
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New item' })).not.toBeInTheDocument())
  })

  it('publishes a draft with one request', async () => {
    on('POST', /\/materials\/admin\/items\/m-2$/, () => json(item({ id: 'm-2', status: 'published' })))
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/materials' })
    await showArabic()
    const list = await screen.findByRole('list', { name: 'Library' })
    await userEvent.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(bodyOf(calls('POST', /\/materials\/admin\/items\/m-2$/)[0])).toEqual({ status: 'published' }))
  })

  it('previews a package in an iframe sandboxed WITHOUT same-origin', async () => {
    const playUrl = 'https://api.example.test/api/v1/materials/play/m-1/token/index.html'
    on('POST', /\/materials\/items\/m-1\/open$/, () => json({ itemId: 'm-1', kind: 'activity_package', mode: 'package', presentation: 'frame-isolated', url: playUrl }, 201))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/materials' })
    const list = await screen.findByRole('list', { name: 'Library' })
    await userEvent.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Preview' }))
    const dialog = await screen.findByRole('dialog', { name: 'An-Naba game' })
    const frame = await waitFor(() => {
      const f = dialog.querySelector('iframe')
      if (!f) throw new Error('no frame yet')
      return f
    })
    expect(frame).toHaveAttribute('src', playUrl)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    // A package is never offered as a top-level tab: its URL carries a play token.
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
  })

  it('a framed lesson takes the whole window, with a way back and real full screen', async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve())
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true })
    HTMLElement.prototype.requestFullscreen = requestFullscreen
    try {
      const dialog = await preview('frame-site', 'https://lessons.example.test/lessons/quran/surah-78')
      // Above the navigation, not a side sheet beside it.
      expect(dialog).toHaveClass('dialog--full')
      expect(dialog).not.toHaveClass('dialog--sheet')
      const frame = await waitFor(() => {
        const f = dialog.querySelector('.mt-stage iframe')
        if (!f) throw new Error('no frame yet')
        return f
      })
      expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms')
      await userEvent.click(within(dialog).getByRole('button', { name: 'Full screen' }))
      expect(requestFullscreen).toHaveBeenCalledTimes(1)
      expect(requestFullscreen.mock.contexts[0]).toBe(dialog.querySelector('.mt-stage'))
      await userEvent.click(within(dialog).getByRole('button', { name: 'Back to the library' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Letters song' })).not.toBeInTheDocument())
      expect(screen.getByRole('list', { name: 'Library' })).toBeInTheDocument()
    } finally {
      delete (document as { fullscreenEnabled?: boolean }).fullscreenEnabled
      delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen
    }
  })

  async function preview(presentation: string, url: string) {
    on('POST', /\/materials\/items\/m-2\/open$/, () => json({ itemId: 'm-2', kind: 'activity_link', mode: 'link', presentation, url }, 201))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/materials' })
    await showArabic()
    const list = await screen.findByRole('list', { name: 'Library' })
    await userEvent.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Preview' }))
    return screen.findByRole('dialog', { name: 'Letters song' })
  }

  it('an allowlisted link (the lessons site) is framed with EXACTLY allow-scripts allow-same-origin allow-forms', async () => {
    const dialog = await preview('frame-site', 'https://lessons.example.test/lessons/quran/surah-78')
    const frame = await waitFor(() => {
      const f = dialog.querySelector('iframe')
      if (!f) throw new Error('no frame yet')
      return f
    })
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms')
    expect(frame.getAttribute('sandbox')).not.toMatch(/allow-popups|allow-top-navigation|allow-modals/)
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(frame.getAttribute('allow') ?? '').not.toMatch(/camera|microphone|geolocation/)
  })

  it('any other link is never framed: it is offered to open in the browser', async () => {
    const dialog = await preview('browser', 'https://elsewhere.example.test/game')
    expect(await within(dialog).findByRole('link', { name: 'Open in a new tab' })).toHaveAttribute('href', 'https://elsewhere.example.test/game')
    // Nothing to frame, so the side sheet is enough; no full-screen control.
    await waitFor(() => expect(dialog).toHaveClass('dialog--sheet'))
    expect(within(dialog).queryByRole('button', { name: 'Full screen' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Open in a new tab' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(dialog.querySelector('iframe')).toBeNull()
  })

  it('adds a lesson of the lessons site by its path only', async () => {
    on('POST', /\/materials\/admin\/items$/, (_u, init) => json({ ...item({ id: 'm-4', source: 'site', kind: 'activity_link' }), ...JSON.parse(String(init.body)) }, 201))
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/materials' })
    await userEvent.click(await screen.findByRole('button', { name: 'Add item' }))
    const dialog = await screen.findByRole('dialog', { name: 'New item' })
    await userEvent.type(within(dialog).getByLabelText('Title (Arabic)'), 'سورة النبأ')
    await userEvent.click(within(dialog).getByLabelText('A lesson of the lessons site'))
    await userEvent.type(within(dialog).getByLabelText('Lesson path'), '/lessons/quran/surah-78')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/materials\/admin\/items$/)).toHaveLength(1))
    const body = bodyOf(calls('POST', /\/materials\/admin\/items$/)[0])
    expect(body).toMatchObject({ path: '/lessons/quran/surah-78', kind: 'activity_link' })
    expect(body).not.toHaveProperty('url')
    // Left empty, the order is the server's (a new item goes last).
    expect(body).not.toHaveProperty('sortOrder')
  })

  it('edits an item\'s place in the order', async () => {
    on('POST', /\/materials\/admin\/items\/m-1$/, (_u, init) => json({ ...item(), ...JSON.parse(String(init.body)) }))
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/materials' })
    const list = await screen.findByRole('list', { name: 'Library' })
    await userEvent.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit item' })
    const order = within(dialog).getByLabelText('Order')
    expect(order).toHaveValue(1)
    await userEvent.clear(order)
    await userEvent.type(order, '9')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/materials\/admin\/items\/m-1$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/materials\/admin\/items\/m-1$/)[0])).toMatchObject({ sortOrder: 9 })
  })
})

describe('Materials > Import', () => {
  function report(over: Partial<ImportReport> = {}): ImportReport {
    return {
      dryRun: true, committed: false, summary: { rows: 2, create: 2, update: 0, errors: 0 }, unmatchedFiles: ['extra.pdf'],
      rows: [
        { row: 1, ref: 'naba-game', title: 'لعبة النبأ', action: 'create', file: 'naba.zip', errors: [], warnings: [] },
        { row: 2, ref: 'letters', title: 'الحروف', action: 'create', file: null, errors: [], warnings: [] },
      ],
      ...over,
    }
  }

  it('checks first (nothing written), then uploads the matched files straight to storage without the bearer, then imports', async () => {
    on('POST', /\/materials\/admin\/import$/, (_u, init) => {
      const body = JSON.parse(String(init.body))
      return json(body.dryRun ? report() : report({ dryRun: false, committed: true }), 201)
    })
    on('POST', /\/materials\/admin\/uploads$/, () =>
      json({ uploads: [{ name: 'naba.zip', uploadToken: 'materials/org/up-1', uploadUrl: 'https://storage.example.test/put/up-1', method: 'PUT', headers: { 'content-type': 'application/zip' }, expiresAt: '2026-10-24T11:00:00Z' }] }, 201))
    on('PUT', /storage\.example\.test\/put\/up-1$/, () => new Response(null, { status: 200 }))

    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/materials?tab=import' })
    const csv = 'ref,title_ar,subject,file,url\nnaba-game,لعبة النبأ,quran,naba.zip,\nletters,الحروف,arabic,,https://x.example.test\n'
    await userEvent.upload(await screen.findByLabelText('Manifest (.csv or .json)'), new File([csv], 'manifest.csv', { type: 'text/csv' }))
    await userEvent.upload(screen.getByLabelText('Files named in the manifest'), [
      new File(['PK\u0003\u0004zip'], 'naba.zip', { type: 'application/zip' }),
      new File(['%PDF-1.7'], 'extra.pdf', { type: 'application/pdf' }),
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    const details = await screen.findByRole('region', { name: 'Details' })
    expect(within(details).getByText('2 new · 0 updated · 0 with errors')).toBeInTheDocument()
    expect(within(details).getByText(/Files no row names \(not uploaded\): extra\.pdf/)).toBeInTheDocument()
    const dry = bodyOf(calls('POST', /\/materials\/admin\/import$/)[0])
    expect(dry).toMatchObject({ format: 'csv', dryRun: true, manifest: csv })
    expect(dry.files).toEqual([
      { name: 'naba.zip', mimeType: 'application/zip', byteSize: 7 },
      { name: 'extra.pdf', mimeType: 'application/pdf', byteSize: 8 },
    ])
    expect(calls('POST', /\/materials\/admin\/uploads$/)).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Upload files and import' }))
    await screen.findByText(/Imported: 2 new, 0 updated/)
    // Only the file a row names is uploaded.
    expect(bodyOf(calls('POST', /\/materials\/admin\/uploads$/)[0])).toEqual({ purpose: 'item', files: [{ name: 'naba.zip', mimeType: 'application/zip', byteSize: 7 }] })
    const put = calls('PUT', /storage\.example\.test/)[0]!
    const putInit = put[1] as RequestInit
    expect(new Headers(putInit.headers).get('authorization')).toBeNull()
    expect(putInit.credentials).toBe('omit')
    const commit = bodyOf(calls('POST', /\/materials\/admin\/import$/)[1])
    expect(commit.dryRun).toBe(false)
    expect(commit.files.find((f: { name: string }) => f.name === 'naba.zip')).toMatchObject({ uploadToken: 'materials/org/up-1' })
  })

  it('a manifest with errors cannot be imported until it is fixed', async () => {
    on('POST', /\/materials\/admin\/import$/, () => json(report({
      summary: { rows: 1, create: 0, update: 0, errors: 1 }, unmatchedFiles: [],
      rows: [{ row: 1, ref: 'x', title: null, action: 'error', file: null, errors: ['subject: one of quran, arabic, islamic_studies'], warnings: [] }],
    }), 201))
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/materials?tab=import' })
    await userEvent.upload(await screen.findByLabelText('Manifest (.csv or .json)'), new File(['ref,subject\nx,maths\n'], 'm.csv', { type: 'text/csv' }))
    await userEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('subject: one of quran, arabic, islamic_studies')).toBeInTheDocument()
    expect(screen.getByText(/Fix the rows with errors/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload files and import' })).toBeDisabled()
  })
})

describe('Materials > Recitations', () => {
  it('adds the first source as the one families hear', async () => {
    let sources: unknown[] = []
    on('GET', /\/materials\/admin\/recitations$/, () => json({ sources }))
    on('POST', /\/materials\/admin\/recitations\/sources$/, (_u, init) => {
      sources = [{ id: 's-1', isActive: true, tracks: [], ...JSON.parse(String(init.body)) }]
      return json(sources[0], 201)
    })
    renderWithProviders(<AppRoutes />, { staff: teachersManager, route: '/materials?tab=recitations' })
    expect(await screen.findByText(/No recitation source yet/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Source name'), 'Authorized source')
    await userEvent.type(screen.getByLabelText('Link pattern (https)'), 'https://audio.example.test/{{surah3}.mp3')
    await userEvent.click(screen.getByRole('button', { name: 'Add source' }))
    await waitFor(() => expect(bodyOf(calls('POST', /\/recitations\/sources$/)[0])).toEqual({
      name: 'Authorized source', urlTemplate: 'https://audio.example.test/{surah3}.mp3', isDefault: true,
    }))
    expect(await screen.findByRole('listitem', { name: 'Authorized source' })).toBeInTheDocument()
  })
})

describe('Student Profile', () => {
  it('has no memorization map any more, and asks for none', async () => {
    on('GET', /\/learners\/l-1\/profile$/, () => json({ id: 'l-1', name: 'Child Alpha', avatarUrl: null, age: 8, course: null, teacher: null, schedule: [], viewer: 'staff' }))
    renderWithProviders(<AppRoutes />, { staff: superAdmin, route: '/students/l-1' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Child Alpha' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Memorization map' })).not.toBeInTheDocument()
    expect(calls('GET', /\/materials\/progress/)).toHaveLength(0)
  })
})
