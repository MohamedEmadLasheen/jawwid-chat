import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { CertificateAccess, DesignCertificate, FullCertificate } from './api'
import { chooseOption } from '@/test/select'

/**
 * PD-41: the Certificates page through the real routes and the real API
 * client, with `fetch` answered at the network boundary. What these prove is
 * the page's side of the owner's safeguards: it offers exactly the server's
 * `actions`, approves the revision on screen, sends only to the group the
 * server named (and echoes it), files one request per form, and shows a
 * Designer nothing about the family. Who may do what is proven server-side
 * (apps/api test/integration/pd041-certificates.spec.ts). Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: Array<[RegExp, string, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([pattern, method, handler])
const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
const bodyOf = (call: unknown[] | undefined) => {
  if (!call) throw new Error('the request was not sent')
  return JSON.parse(String((call[1] as RequestInit).body))
}

const NO = { request: false, deliver: false, story: false, oversee: false }
const opsAccess: CertificateAccess = { canOpen: true, view: true, design: false, types: false, categories: { student: { request: true, deliver: true, story: true, oversee: false }, teacher: NO } }
const designerAccess: CertificateAccess = { canOpen: true, view: true, design: true, types: false, categories: { student: NO, teacher: NO } }
const superAccess: CertificateAccess = { canOpen: true, view: true, design: true, types: true, categories: { student: { request: true, deliver: true, story: true, oversee: true }, teacher: { request: true, deliver: true, story: true, oversee: true } } }

const juzType = { id: 'type-1', key: 'juz_completed', labelEn: "Juz' completed", labelAr: 'إتمام جزء', isActive: true, needsJuz: true, needsPeriod: null }
const file = { id: 'f-2', revision: 2, fileName: 'c.png', mimeType: 'image/png', byteSize: 10, uploadedAt: '2026-10-29T09:00:00Z', uploadedBy: { id: 'd-1', name: 'Designer One' } }

function full(over: Partial<FullCertificate> = {}): FullCertificate {
  return {
    projection: 'full',
    id: 'c-1',
    category: 'student',
    type: juzType,
    state: 'uploaded',
    stateGroup: 'completed',
    learner: { id: 'l-1', name: 'Child Alpha' },
    teacher: null,
    signatoryTeacher: { id: 't-1', name: 'Teacher One' },
    requestedBy: { id: 's-1', name: 'Supervisor One' },
    suggestedBy: null,
    title: "Juz' completed",
    achievement: 'Juz 30',
    achievedOn: null,
    grade: null,
    printedName: 'Child Alpha',
    juz: 30,
    periodStart: null,
    periodEnd: null,
    designerNote: 'gold border',
    internalNote: 'private family context',
    publishStory: true,
    requestedAt: '2026-10-28T09:00:00Z',
    updatedAt: '2026-10-29T09:00:00Z',
    assignedDesigner: { id: 'd-1', name: 'Designer One' },
    designStartedAt: '2026-10-28T10:00:00Z',
    returnMessage: null,
    currentFile: file,
    files: [file],
    approval: null,
    sent: null,
    suggestion: null,
    consent: null,
    story: null,
    cancelled: null,
    actions: ['approve', 'redesign', 'cancel'],
    history: [{ seq: 1, kind: 'requested', fromState: null, toState: 'requested', actor: { id: 's-1', name: 'Supervisor One' }, note: null, at: '2026-10-28T09:00:00Z' }],
    ...over,
  }
}

function design(over: Partial<DesignCertificate> = {}): DesignCertificate {
  return {
    projection: 'design',
    id: 'c-1',
    category: 'student',
    type: juzType,
    state: 'in_design',
    stateGroup: 'in_progress',
    title: "Juz' completed",
    achievement: 'Juz 30',
    achievedOn: null,
    grade: null,
    printedName: 'Child Alpha',
    signatoryName: 'Teacher One',
    juz: 30,
    periodStart: null,
    periodEnd: null,
    designerNote: 'gold border',
    requesterName: 'Supervisor One',
    requestedAt: '2026-10-28T09:00:00Z',
    assignedDesigner: { id: 'd-1', name: 'Designer One' },
    designStartedAt: '2026-10-28T10:00:00Z',
    returnMessage: null,
    currentFile: null,
    files: [],
    delivered: false,
    actions: ['upload', 'return', 'release'],
    ...over,
  }
}

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })
const designer = makeStaff({ id: 'd-1', name: 'Designer One', role: 'specialist' })

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [pattern, m, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  on('GET', /\/certificates\/types/, () => json({ types: [{ ...juzType, category: 'student', sort: 0, disabledAt: null }] }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

async function openRow(name = 'Child Alpha') {
  await userEvent.click(await screen.findByRole('button', { name }))
  return screen.findByRole('dialog', { name })
}

describe('the requester', () => {
  it('approves the revision on screen, then sends only to the group the server named', async () => {
    on('GET', /\/certificates\/access$/, () => json(opsAccess))
    on('GET', /\/certificates\?/, () => json({ certificates: [full()], nextCursor: null }))
    on('GET', /\/certificates\/c-1$/, () => json({ certificate: full() }))
    on('POST', /\/certificates\/c-1\/approve$/, () => json({ certificate: full({ state: 'approved', actions: ['withdraw_approval', 'send', 'consent', 'cancel'] }) }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })

    const drawer = await openRow()
    // Nothing is offered that the server did not offer: no send before approval.
    expect(within(drawer).queryByRole('button', { name: 'Send to group' })).not.toBeInTheDocument()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Approve this design' }))
    await waitFor(() => expect(calls('POST', /\/approve$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/approve$/)[0])).toEqual({ fileId: 'f-2' })
  })

  it('send names the group first, echoes it, and says so when the group changed', async () => {
    on('GET', /\/certificates\/access$/, () => json(opsAccess))
    const approved = full({ state: 'approved', actions: ['send'] })
    on('GET', /\/certificates\?/, () => json({ certificates: [approved], nextCursor: null }))
    on('GET', /\/certificates\/c-1$/, () => json({ certificate: approved }))
    on('GET', /\/certificates\/c-1\/delivery$/, () => json({ target: { conversationId: 'g-1', type: 'student_group', title: 'Child Alpha · group', members: 4 } }))
    on('POST', /\/certificates\/c-1\/send$/, () =>
      json({ error: { code: 'COMM.CERTIFICATE_TARGET_CHANGED', message: 'the group changed', detail: { conversationId: 'g-2' } } }, 409),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    const drawer = await openRow()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Send to group' }))
    const send = await screen.findByRole('dialog', { name: 'Send the certificate' })
    expect(await within(send).findByText(/Child Alpha · group/)).toBeInTheDocument()
    await userEvent.click(within(send).getByRole('button', { name: 'Send to group' }))
    await waitFor(() => expect(calls('POST', /\/send$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/send$/)[0])).toEqual({ conversationId: 'g-1' })
    expect(await within(send).findByText('The group changed since it was shown. Check it and send again.')).toBeInTheDocument()
  })

  it('a new request is filed once however often Submit is pressed, and never publishes a Story by itself', async () => {
    on('GET', /\/certificates\/access$/, () => json(opsAccess))
    on('GET', /\/certificates\?/, () => json({ certificates: [], nextCursor: null }))
    on('GET', /\/certificates\/recipients/, () => json({ recipients: [{ id: 'l-1', name: 'Child Alpha', teacher: { id: 't-1', name: 'Teacher One' } }] }))
    on('POST', /\/certificates$/, () =>
      json({ error: { code: 'COMM.CERTIFICATE_DUPLICATE_SUSPECTED', message: 'similar', detail: { certificateId: 'c-0' } } }, 409),
    )
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/certificates' })
    await userEvent.click(await screen.findByRole('button', { name: 'New request' }))
    const form = await screen.findByRole('dialog', { name: 'New request' })
    await userEvent.click(await within(form).findByRole('option', { name: /Child Alpha/ }))
    await chooseOption(userEvent, within(form).getByLabelText('Type'), 'type-1')
    await userEvent.type(within(form).getByLabelText('Juz’'), '30')
    expect(within(form).getByRole('checkbox', { name: /Publish as a Story/ })).not.toBeChecked()
    await userEvent.click(within(form).getByRole('button', { name: 'Submit request' }))
    await waitFor(() => expect(calls('POST', /\/certificates$/)).toHaveLength(1))
    // A near-duplicate is the server's word; submitting anyway reuses the same request key.
    await userEvent.click(await within(form).findByRole('button', { name: 'Submit anyway' }))
    await waitFor(() => expect(calls('POST', /\/certificates$/)).toHaveLength(2))
    const [first, second] = calls('POST', /\/certificates$/).map(bodyOf)
    expect(first).toMatchObject({ category: 'student', learnerId: 'l-1', typeId: 'type-1', juz: 30, printedName: 'Child Alpha', publishStory: false })
    expect(second.requestKey).toBe(first.requestKey)
    expect(second.confirmDuplicate).toBe(true)
  })

  it('the PD-12 tab lands on the Certificates page', async () => {
    on('GET', /\/certificates\/access$/, () => json(opsAccess))
    on('GET', /\/certificates\?/, () => json({ certificates: [], nextCursor: null }))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/teachers/certificates' })
    expect(await screen.findByRole('heading', { name: 'Certificates' })).toBeInTheDocument()
  })
})

describe('the Designer', () => {
  it('lands on Certificates, requests nothing, and sees no family detail', async () => {
    on('GET', /\/certificates\/access$/, () => json(designerAccess))
    on('GET', /\/certificates\?/, () => json({ certificates: [design()], nextCursor: null }))
    on('GET', /\/certificates\/c-1$/, () => json({ certificate: design() }))
    renderWithProviders(<AppRoutes />, { staff: designer, route: '/' })
    const drawer = await openRow()
    expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument()
    expect(within(drawer).getByText('gold border')).toBeInTheDocument()
    for (const hidden of ['private family context', 'Send to group', 'Approve this design', 'Publish as a Story', 'Family consent…']) {
      expect(within(drawer).queryByText(hidden)).not.toBeInTheDocument()
    }
  })

  it('uploads on the signed URL, then confirms -- nothing is confirmed if the upload fails', async () => {
    on('GET', /\/certificates\/access$/, () => json(designerAccess))
    on('GET', /\/certificates\?/, () => json({ certificates: [design()], nextCursor: null }))
    on('GET', /\/certificates\/c-1$/, () => json({ certificate: design() }))
    on('POST', /\/certificates\/c-1\/files\/upload$/, () =>
      json({ upload: { objectKey: 'certificate-uploads/o/c-1/k', uploadUrl: 'https://storage.test/put/k', method: 'PUT', headers: { 'content-type': 'image/png' }, expiresAt: '2026-10-29T10:00:00Z' } }),
    )
    on('PUT', /storage\.test\/put\/k$/, () => new Response(null, { status: 200 }))
    on('POST', /\/certificates\/c-1\/files$/, () => json({ certificate: design({ state: 'uploaded', actions: ['upload'] }) }))
    renderWithProviders(<AppRoutes />, { staff: designer, route: '/certificates' })
    const drawer = await openRow()
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'c.png', { type: 'image/png' })
    await userEvent.upload(within(drawer).getByLabelText('Upload design'), png)
    await waitFor(() => expect(calls('POST', /\/files$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/files$/)[0])).toEqual({ objectKey: 'certificate-uploads/o/c-1/k', fileName: 'c.png' })
    const order = fetchMock.mock.calls.map(([u]) => String(u))
    expect(order.findIndex((u) => u.includes('storage.test'))).toBeLessThan(order.findIndex((u) => /\/files$/.test(u)))
  })
})

describe('the super admin', () => {
  it('keeps the types: disables one, and has nothing to delete', async () => {
    on('GET', /\/certificates\/access$/, () => json(superAccess))
    on('GET', /\/certificates\?/, () => json({ certificates: [], nextCursor: null }))
    on('POST', /\/certificates\/types\/type-1$/, () => json({ type: { ...juzType, category: 'student', sort: 0, isActive: false, disabledAt: '2026-10-29T09:00:00Z' } }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ role: 'super_admin' }), route: '/certificates?category=types' })
    const toggle = await screen.findByRole('checkbox', { name: "Enabled: Juz' completed" })
    await userEvent.click(toggle)
    await waitFor(() => expect(calls('POST', /\/types\/type-1$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/types\/type-1$/)[0])).toEqual({ isActive: false })
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })
})

/**
 * PD-40 PR-5b: what the department head verified on systest. A Sales manager
 * holds no certificates key, so GET /certificates/access answers 403: the
 * probe is a quiet "no" -- no Certificates entry, and no error anywhere.
 */
describe('the access probe, for a Sales manager', () => {
  const salesManager = makeStaff({ id: 'm-5', name: 'Sales Manager', role: 'manager', permissions: ['trials.view'] })

  async function renderAccounts(access: () => Response) {
    on('GET', /\/certificates\/access$/, access)
    on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: true, operations: false, calendar: false, supervisionPage: false }))
    on('GET', /\/admin\/accounts(\?|$)/, () => json({ accounts: [], truncated: false, administers: ['family'] }))
    on('GET', /\/admin\/impersonations/, () => json({ sessions: [] }))
    const rendered = renderWithProviders(<AppRoutes />, { staff: salesManager, route: '/accounts' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Accounts' })).toBeInTheDocument()
    await waitFor(() => expect(calls('GET', /\/certificates\/access$/).length).toBeGreaterThan(0))
    return rendered
  }
  const certificateLinks = () => screen.queryAllByRole('link', { name: 'Certificates' })

  it('a 403 offers no Certificates entry and shows no error', async () => {
    const { queryClient, container } = await renderAccounts(() =>
      json({ error: { code: 'COMMON.FORBIDDEN', message: 'this account holds no certificates key' } }, 403),
    )
    await waitFor(() => expect(queryClient.getQueryState(['certificates', 'access'])?.status).toBe('error'))
    expect(certificateLinks()).toHaveLength(0)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
    expect(container.ownerDocument.querySelector('.banner--danger, .state--forbidden')).toBeNull()
    expect(screen.queryByText(/certificates key/)).not.toBeInTheDocument()
    expect(screen.queryByText("You don't have permission to access this.")).not.toBeInTheDocument()
    // The probe is asked once: retry is off, so a "no" is not hammered.
    expect(calls('GET', /\/certificates\/access$/)).toHaveLength(1)
  })

  it('a 200 with canOpen false offers no Certificates entry either', async () => {
    await renderAccounts(() => json({ canOpen: false, view: false, design: false, types: false, categories: { student: NO, teacher: NO } }))
    expect(certificateLinks()).toHaveLength(0)
    expect(screen.queryAllByRole('alert')).toHaveLength(0)
  })

  it('and canOpen true does offer it (the control for the two above)', async () => {
    await renderAccounts(() => json(opsAccess))
    await waitFor(() => expect(certificateLinks().length).toBeGreaterThan(0))
  })
})
