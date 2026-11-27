import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { destinationsFor, entriesOf } from '@/app/navigation'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { chooseOption } from '@/test/select'
import type { IntakeOptions } from '@/features/intake/api'
import type { LeadDetail, LeadPage, LeadRow } from './api'

/**
 * PD-59: the Sales pipeline through the real routes and API client, with
 * `fetch` answered at the network boundary. These prove the page's side: it is
 * offered on the server's `sales` word, a list row never shows a contact value,
 * the contact arrives with the lead's own panel, and each action sends exactly
 * the request the server expects. Who may use the pipeline, and the audit, are
 * proven server-side (apps/api test/unit/sales-pipeline).
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: Array<[string, RegExp, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([method, pattern, handler])
const calls = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
const bodyOf = (call: unknown[] | undefined) => {
  if (!call) throw new Error('the request was not sent')
  return JSON.parse(String((call[1] as RequestInit).body))
}

const SECRET_PHONE = '+201001234567'
const SECRET_EMAIL = 'parent.one@example.com'

const row = (over: Partial<LeadRow> = {}): LeadRow => ({
  id: 'lead-1',
  owner: { id: 's-1', name: 'Rep One' },
  displayName: 'Lead Alpha',
  level: null,
  stage: 'contacted',
  lostReason: null,
  manualStage: true,
  lastContactedAt: '2026-11-18T10:00:00Z',
  nextFollowUpOn: '2026-11-20',
  followUpDue: true,
  followUpNote: null,
  createdAt: '2026-11-10T09:00:00Z',
  handedOver: false,
  contact: { phone: true, whatsapp: false, email: true },
  ...over,
})

const PAGE: LeadPage = {
  leads: [row(), row({ id: 'lead-2', displayName: 'Lead Beta', stage: 'trial_booked', manualStage: false, nextFollowUpOn: null, followUpDue: false, contact: { phone: false, whatsapp: false, email: false } })],
  total: 2,
  counts: { new_lead: 0, contacted: 1, trial_booked: 1, trial_completed: 0, converted: 0, lost: 0 },
  dueCount: 1,
  limit: 25,
  offset: 0,
  truncated: false,
}

const DETAIL: LeadDetail = {
  id: 'lead-1',
  owner: { id: 's-1', name: 'Rep One' },
  displayName: 'Lead Alpha',
  level: null,
  note: null,
  stage: 'contacted',
  lostReason: null,
  manualStage: true,
  lastContactedAt: '2026-11-18T10:00:00Z',
  nextFollowUpOn: '2026-11-20',
  followUpDue: true,
  followUpNote: null,
  createdAt: '2026-11-10T09:00:00Z',
  convertedAt: null,
  familyId: null,
  canConvert: true,
  trial: null,
  contact: { parentName: 'Parent One', phone: SECRET_PHONE, whatsapp: null, email: SECRET_EMAIL, country: 'EG' },
}

const OPTIONS: IntakeOptions = { standing: 'sales_member', manager: false, ready: true, onBehalfOf: [], teachers: [] }

const sales = makeStaff({ id: 's-1', name: 'Sales One', role: 'admin' })

function access(a: { sales?: boolean; operations?: boolean; lessonManager?: boolean }) {
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: false, operations: false, ...a }))
}

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [m, pattern, handler] of routes) if (m === method && pattern.test(url)) return handler(url, init)
    return json({ error: { code: 'unrouted', message: `no mock for ${method} ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  access({ sales: true })
  on('GET', /\/sales-pipeline\/leads(\?.*)?$/, () => json(PAGE))
  on('GET', /\/sales-pipeline\/leads\/lead-1$/, () => json(DETAIL))
  on('GET', /\/family-intake\/options$/, () => json(OPTIONS))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

describe('the Sales pipeline in the navigation', () => {
  it('is offered on the server\'s `sales` word, first among the Sales pages, and to no one else', () => {
    const paths = (role: Parameters<typeof destinationsFor>[0], opts: Parameters<typeof destinationsFor>[1]) =>
      destinationsFor(role, opts).find((d) => d.key === 'sales')?.groups.flatMap((g) => g.entries.map((e) => e.path)) ?? []
    for (const role of ['super_admin', 'admin', 'manager'] as const) {
      expect(paths(role, { sales: true })[0], role).toBe('/sales/pipeline')
    }
    // The super admin's rail is the portal's and the server calls it `sales` anyway; operators wait for the word.
    for (const role of ['admin', 'manager'] as const) {
      expect(paths(role, { operations: true }), role).not.toContain('/sales/pipeline')
      expect(paths(role, {}), role).not.toContain('/sales/pipeline')
    }
    expect(destinationsFor('finance', { sales: true }).flatMap(entriesOf).map((e) => e.path)).not.toContain('/sales/pipeline')
  })
})

describe('the Sales pipeline page', () => {
  it('lists leads with their stage, shows that a channel is on file and never a contact value', async () => {
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    // The board: a lead is a card, and its stage is the column it stands in.
    const alpha = (await screen.findByText('Lead Alpha')).closest('article')!
    expect(within(alpha.closest('section')!).getByRole('heading', { name: 'Contacted' })).toBeInTheDocument()
    expect(within(alpha).getByText('Follow-up due')).toBeInTheDocument()
    expect(within(alpha).getByText('Phone, E-mail')).toBeInTheDocument()
    const beta = screen.getByText('Lead Beta').closest('article')!
    expect(within(beta.closest('section')!).getByRole('heading', { name: 'Trial booked' })).toBeInTheDocument()
    expect(within(beta).getByText('None')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(SECRET_PHONE)
    expect(document.body.textContent).not.toContain(SECRET_EMAIL)
    // The list's own request never asked for a contact; the detail has not been read.
    expect(calls('GET', /\/sales-pipeline\/leads\/lead-1$/)).toHaveLength(0)
    expect(screen.getByText('Names only. Do not type phone numbers or e-mails here.')).toBeInTheDocument()
    // The stage filter shows its counts.
    const chips = screen.getByRole('group', { name: 'Stage' })
    expect(within(chips).getByRole('button', { name: /Trial booked/ })).toHaveTextContent('1')
  })

  it('filters by stage, by search and by follow-up due, as server queries', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    await screen.findByText('Lead Alpha')
    await user.click(within(screen.getByRole('group', { name: 'Stage' })).getByRole('button', { name: /Contacted/ }))
    await waitFor(() => expect(calls('GET', /stage=contacted/).length).toBeGreaterThan(0))
    await user.click(screen.getByRole('button', { name: /Follow-up due/ }))
    await waitFor(() => expect(calls('GET', /followUp=due/).length).toBeGreaterThan(0))
    await user.type(screen.getByRole('searchbox'), 'alp')
    await waitFor(() => expect(calls('GET', /q=alp/).length).toBeGreaterThan(0))
  })

  it('says so when the server refuses (not Sales): an error, no contact, no list', async () => {
    on('GET', /\/sales-pipeline\/leads(\?.*)?$/, () =>
      json({ error: { code: 'COMM.SALES_LEAD_DENIED', message: 'the Sales pipeline is for the Sales department and the super admin' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'ops', role: 'admin' }), route: '/sales/pipeline' })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Lead Alpha')).not.toBeInTheDocument()
  })

  it('shows the Arabic page right to left', async () => {
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline', locale: 'ar' })
    expect(await screen.findByRole('heading', { name: 'مسار المبيعات' })).toBeInTheDocument()
    expect(document.documentElement.dir).toBe('rtl')
    // The stage names its column and its switch.
    expect((await screen.findAllByText('تم التواصل')).length).toBeGreaterThan(0)
  })
})

describe('creating a lead', () => {
  it('needs a name, and a parent name with a channel when any contact is typed', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    await user.click(await screen.findByRole('button', { name: 'New lead' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Create lead' }))
    expect(within(dialog).getByText('Enter the name.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/Child or prospect name/), 'Lead Gamma')
    await user.type(within(dialog).getByLabelText('Parent name'), 'Parent Two')
    await user.click(within(dialog).getByRole('button', { name: 'Create lead' }))
    expect(within(dialog).getByText('Enter the parent name with at least one way to reach them.')).toBeInTheDocument()
    expect(calls('POST', /\/sales-pipeline\/leads$/)).toHaveLength(0)
  })

  it('posts the lead with its contact and opens it', async () => {
    const user = userEvent.setup()
    on('POST', /\/sales-pipeline\/leads$/, () => json({ ...DETAIL, id: 'lead-1', displayName: 'Lead Gamma' }, 201))
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    await user.click(await screen.findByRole('button', { name: 'New lead' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Child or prospect name/), 'Lead Gamma')
    await user.type(within(dialog).getByLabelText('Parent name'), 'Parent Two')
    await user.type(within(dialog).getByLabelText('Phone number'), '+201005550000')
    await chooseOption(user, within(dialog).getByRole('combobox', { name: 'Country of the number' }), 'EG')
    await user.click(within(dialog).getByRole('button', { name: 'Create lead' }))
    await waitFor(() => expect(calls('POST', /\/sales-pipeline\/leads$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/sales-pipeline\/leads$/)[0])).toMatchObject({
      displayName: 'Lead Gamma',
      contact: { parentName: 'Parent Two', phone: '+201005550000', whatsapp: null, email: null, country: 'EG' },
    })
    // The lead's own panel opens next.
    expect(await screen.findByText('Contact details')).toBeInTheDocument()
  })
})

describe('a lead\'s panel', () => {
  async function open() {
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    await user.click(await screen.findByRole('button', { name: 'Open Lead Alpha' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Parent One')
    return { user, dialog }
  }

  it('reads the contact only when opened, and says the read is recorded', async () => {
    const { dialog } = await open()
    expect(calls('GET', /\/sales-pipeline\/leads\/lead-1$/)).toHaveLength(1)
    expect(within(dialog).getByText(SECRET_PHONE)).toBeInTheDocument()
    expect(within(dialog).getByText(SECRET_EMAIL)).toBeInTheDocument()
    expect(within(dialog).getByText('Opening these details is recorded in the audit log.')).toBeInTheDocument()
  })

  it('marks the lead contacted with its next follow-up', async () => {
    on('POST', /\/sales-pipeline\/leads\/lead-1\/contacted$/, () => json(DETAIL))
    const { user, dialog } = await open()
    await user.clear(within(dialog).getByLabelText('Follow up on'))
    await user.type(within(dialog).getByLabelText('Follow up on'), '2026-11-25')
    // Convert is this lead's stated action; the contact just made is behind "⋯".
    await user.click(within(dialog).getByRole('button', { name: /More actions/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Mark contacted' }))
    await waitFor(() => expect(calls('POST', /\/contacted$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/contacted$/)[0])).toEqual({ nextFollowUpOn: '2026-11-25', followUpNote: null })
    expect(await within(dialog).findByText('Contact recorded.')).toBeInTheDocument()
    // The write answered with the lead: no second (audited) read of the contact was made.
    expect(calls('GET', /\/sales-pipeline\/leads\/lead-1$/)).toHaveLength(1)
  })

  it('never re-reads the contact on a window focus (each read is an audited event)', async () => {
    await open()
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 50))
    expect(calls('GET', /\/sales-pipeline\/leads\/lead-1$/)).toHaveLength(1)
  })

  it('a subscribed-trial lead that Operations has not enrolled yet says to convert again afterwards', async () => {
    on('GET', /\/sales-pipeline\/leads\/lead-1$/, () => json({ ...DETAIL, stage: 'converted', manualStage: false, canConvert: true }))
    on('POST', /\/convert$/, () => json({ outcome: 'awaiting_enrolment', familyId: null }))
    const { user, dialog } = await open()
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))
    expect(await within(dialog).findByText(/Convert again once Operations has enrolled the family/)).toBeInTheDocument()
    expect(calls('POST', /\/family-intake$/)).toHaveLength(0)
  })

  it('offers no Convert for a lead already handed over', async () => {
    on('GET', /\/sales-pipeline\/leads\/lead-1$/, () => json({ ...DETAIL, stage: 'converted', manualStage: false, canConvert: false, contact: null, convertedAt: '2026-11-19T10:00:00Z' }))
    const { dialog } = await (async () => {
      const user = userEvent.setup()
      renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
      await user.click(await screen.findByRole('button', { name: 'Open Lead Alpha' }))
      const d = await screen.findByRole('dialog')
      await within(d).findByText('The contact now lives in the family record.')
      return { dialog: d }
    })()
    expect(within(dialog).queryByRole('button', { name: 'Convert' })).not.toBeInTheDocument()
  })

  it('marks a lead lost only with a reason', async () => {
    on('POST', /\/sales-pipeline\/leads\/lead-1$/, () => json({ ...DETAIL, stage: 'lost', lostReason: 'price' }))
    const { user, dialog } = await open()
    await user.click(within(dialog).getByRole('button', { name: /More actions/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Mark lost' }))
    const confirm = within(dialog).getAllByRole('button', { name: 'Mark lost' }).at(-1)!
    expect(confirm).toBeDisabled()
    await chooseOption(user, within(dialog).getByRole('combobox', { name: 'Why was the lead lost?' }), 'price')
    await user.click(within(dialog).getAllByRole('button', { name: 'Mark lost' }).at(-1)!)
    await waitFor(() => expect(calls('POST', /\/sales-pipeline\/leads\/lead-1$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/sales-pipeline\/leads\/lead-1$/)[0])).toEqual({ stage: 'lost', lostReason: 'price' })
  })

  it('offers no stage buttons when a trial decides the stage', async () => {
    on('GET', /\/sales-pipeline\/leads\/lead-1$/, () => json({ ...DETAIL, stage: 'trial_booked', manualStage: false }))
    const { dialog } = await open()
    expect(within(dialog).queryByRole('button', { name: 'Mark contacted' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Mark lost' })).not.toBeInTheDocument()
    // Nor behind a "⋯": there is none.
    expect(within(dialog).queryByRole('button', { name: /More actions/ })).not.toBeInTheDocument()
    expect(within(dialog).getByText('A trial decides this stage.')).toBeInTheDocument()
  })

  it('converts into the existing family when the parent is already in Chat -- no intake form, no second parent', async () => {
    on('POST', /\/convert$/, () => json({ outcome: 'linked', familyId: 'fam-1' }))
    const { user, dialog } = await open()
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))
    expect(await within(dialog).findByText(/already in Chat: the lead is now linked/)).toBeInTheDocument()
    expect(calls('POST', /\/family-intake$/)).toHaveLength(0)
  })

  it('hands over through the family intake when no family holds the parent, with the lead\'s details filled in, then links it', async () => {
    let converts = 0
    on('POST', /\/convert$/, () => {
      converts += 1
      return json(converts === 1 ? { outcome: 'intake_required', familyId: null } : { outcome: 'linked', familyId: 'fam-9' })
    })
    on('POST', /\/family-intake$/, () =>
      json({ enrolmentId: 'e-1', familyId: 'fam-9', contactId: 'c-1', learnerIds: ['l-1'], supervision: 'needs_operations_supervisor', salesOwnerId: 's-1', schedules: [], replay: false }, 201))
    const { user, dialog } = await open()
    await user.click(within(dialog).getByRole('button', { name: 'Convert' }))
    const intake = await screen.findByRole('dialog', { name: 'Add a family' })
    expect(within(intake).getByLabelText(/Parent's full name/)).toHaveValue('Parent One')
    expect(within(intake).getByLabelText(/Phone number/)).toHaveValue(SECRET_PHONE)
    expect(within(intake).getByLabelText(/E-mail/)).toHaveValue(SECRET_EMAIL)
    // The intake itself creates the family; once it is saved the lead converts again and links it.
    await user.type(within(intake).getByLabelText(/Child's name/), 'Child One')
    await user.click(within(intake).getByRole('button', { name: 'Review' }))
    await user.click(within(intake).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/family-intake$/)).toHaveLength(1))
    await waitFor(() => expect(calls('POST', /\/convert$/)).toHaveLength(2))
    expect(await screen.findByText(/already in Chat: the lead is now linked/)).toBeInTheDocument()
  })
})

describe('who gets the Sales icon, per the server\'s answers (PD-59 owner decision)', () => {
  const salesPaths = (role: Parameters<typeof destinationsFor>[0], access: Parameters<typeof destinationsFor>[1]) =>
    destinationsFor(role, access).find((d) => d.key === 'sales')?.groups.flatMap((g) => g.entries.map((e) => e.path)) ?? null
  const opsPaths = (role: Parameters<typeof destinationsFor>[0], access: Parameters<typeof destinationsFor>[1]) =>
    destinationsFor(role, access).find((d) => d.key === 'operations')?.groups.flatMap((g) => g.entries.map((e) => e.path)) ?? []

  it('the super admin: the whole Sales workspace', () => {
    expect(salesPaths('super_admin', {})).toEqual(['/sales/pipeline', '/trials', '/trials/new-students'])
  })

  it('a Sales representative or manager (the server answers `sales` for both; the pipeline itself tells them apart): pipeline, trials, new students', () => {
    for (const role of ['admin', 'manager'] as const) {
      expect(salesPaths(role, { sales: true, lessonManager: false }), role).toEqual(['/sales/pipeline', '/trials', '/trials/new-students'])
    }
  })

  it('Operations: trials and new students, no pipeline', () => {
    expect(salesPaths('admin', { operations: true })).toEqual(['/trials', '/trials/new-students'])
  })

  it('the Teachers department (lessonManager only): NO Sales icon; Trial lessons stays reachable, listed under Operations', () => {
    for (const role of ['admin', 'manager'] as const) {
      expect(salesPaths(role, { lessonManager: true }), role).toBeNull()
      expect(opsPaths(role, { lessonManager: true }), role).toContain('/trials')
      expect(opsPaths(role, { lessonManager: true }), role).not.toContain('/trials/new-students')
    }
    // Sales or Operations on top of it keeps Trial lessons under Sales, not Operations.
    expect(salesPaths('admin', { lessonManager: true, operations: true })).toContain('/trials')
    expect(opsPaths('admin', { lessonManager: true, operations: true })).not.toContain('/trials')
  })

  it('the Teachers department can still open /trials by URL (nothing it had was lost)', async () => {
    on('GET', /\/trials(\?.*)?$/, () => json({ trials: [] }))
    on('GET', /\/trials\/prospects$/, () => json({ prospects: [] }))
    access({ lessonManager: true })
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'td', role: 'manager' }), route: '/trials' })
    await waitFor(() => expect(document.querySelector('.state--forbidden')).toBeNull())
    expect(screen.queryByRole('link', { name: 'Sales pipeline' })).not.toBeInTheDocument()
  })
})

describe('an account the server refuses', () => {
  it('gets the Forbidden page, not the pipeline frame, when it types /sales/pipeline', async () => {
    access({ lessonManager: true })
    on('GET', /\/sales-pipeline\/access$/, () => json({ allowed: false, standing: null }))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'td', role: 'manager' }), route: '/sales/pipeline' })
    expect(await screen.findByText(/permission/i)).toBeInTheDocument()
    expect(document.querySelector('.state--forbidden')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'New lead' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sales pipeline' })).not.toBeInTheDocument()
  })

  it('also when the access answer is a 403', async () => {
    access({ operations: true })
    on('GET', /\/sales-pipeline\/access$/, () => json({ error: { code: 'SALES_LEAD_FORBIDDEN', message: 'Forbidden' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: makeStaff({ id: 'op', role: 'admin' }), route: '/sales/pipeline' })
    await waitFor(() => expect(document.querySelector('.state--forbidden')).not.toBeNull())
    expect(screen.queryByRole('button', { name: 'New lead' })).not.toBeInTheDocument()
  })
})

describe('ownership in the page', () => {
  const manager = makeStaff({ id: 'm-1', name: 'Sales Manager', role: 'admin' })

  it('shows each lead\'s owner in the list', async () => {
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    const alpha = (await screen.findByText('Lead Alpha')).closest('article')!
    expect(within(alpha).getByText('Rep One')).toBeInTheDocument()
  })

  it('a representative is not offered Reassign', async () => {
    on('GET', /\/sales-pipeline\/access$/, () => json({ allowed: true, standing: 'sales_member' }))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: sales, route: '/sales/pipeline' })
    await user.click(await screen.findByRole('button', { name: 'Open Lead Alpha' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Parent One')
    expect(within(dialog).queryByText('Reassign to')).not.toBeInTheDocument()
    expect(calls('GET', /\/sales-pipeline\/owners$/)).toHaveLength(0)
  })

  it('the Sales manager reassigns a lead to another representative', async () => {
    on('GET', /\/sales-pipeline\/access$/, () => json({ allowed: true, standing: 'sales_manager' }))
    on('GET', /\/sales-pipeline\/owners$/, () => json({ owners: [{ id: 's-1', name: 'Rep One', role: 'member' }, { id: 's-2', name: 'Rep Two', role: 'member' }] }))
    on('POST', /\/sales-pipeline\/leads\/lead-1\/owner$/, () => json({ ...DETAIL, owner: { id: 's-2', name: 'Rep Two' } }))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/sales/pipeline' })
    await user.click(await screen.findByRole('button', { name: 'Open Lead Alpha' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Parent One')
    const picker = await within(dialog).findByRole('combobox', { name: 'Reassign to' })
    await chooseOption(user, picker, 'Rep Two')
    await user.click(within(dialog).getByRole('button', { name: 'Reassign to' }))
    await waitFor(() => expect(calls('POST', /\/owner$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/owner$/)[0])).toEqual({ ownerId: 's-2' })
    expect(await within(dialog).findByText('The lead was reassigned.')).toBeInTheDocument()
    // the answer carries the lead: no second (audited) read of the contact
    expect(calls('GET', /\/sales-pipeline\/leads\/lead-1$/)).toHaveLength(1)
  })

  it('the manager may name the owner when creating a lead', async () => {
    on('GET', /\/sales-pipeline\/access$/, () => json({ allowed: true, standing: 'sales_manager' }))
    on('GET', /\/sales-pipeline\/owners$/, () => json({ owners: [{ id: 's-2', name: 'Rep Two', role: 'member' }] }))
    on('POST', /\/sales-pipeline\/leads$/, () => json(DETAIL, 201))
    const user = userEvent.setup()
    renderWithProviders(<AppRoutes />, { staff: manager, route: '/sales/pipeline' })
    await user.click(await screen.findByRole('button', { name: 'New lead' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Child or prospect name/), 'Lead Delta')
    await chooseOption(user, await within(dialog).findByRole('combobox', { name: /Owner/ }), 'Rep Two')
    await user.click(within(dialog).getByRole('button', { name: 'Create lead' }))
    await waitFor(() => expect(calls('POST', /\/sales-pipeline\/leads$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/sales-pipeline\/leads$/)[0])).toMatchObject({ displayName: 'Lead Delta', ownerId: 's-2' })
  })
})
