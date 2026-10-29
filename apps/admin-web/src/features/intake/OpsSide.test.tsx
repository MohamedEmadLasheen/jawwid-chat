import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import type { NewStudentDto } from '@/features/trials/api'
import type { ParentProfile, StudentProfile } from '@/features/profiles/api'
import type { CarriedOverView, EnteredFamily, EnteredList, FamilyOwnership } from './api'
import { chooseOption } from '@/test/select'

/**
 * PD-42 PR-3, the Operations side in Admin Web, through the real routes and the
 * real API client with `fetch` answered at the network boundary: New Students
 * lists the families entered by hand (who entered them, who owns them, who is
 * still waiting for an Operations supervisor); the Operations manager chooses
 * it, a Sales owner suggests it; a trial sibling's Assign adds the children to
 * the family the parent is already in; the Parent Profile sets the sign-in
 * e-mail and the Sales owner; the Student Profile shows and corrects the
 * package carried over from Core. Who may do what is proven server-side
 * (apps/api pd042-ops-side-api.spec.ts). Synthetic people only.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>
let routes: Array<[RegExp, string, Handler]>
let fetchMock: ReturnType<typeof vi.fn>
function on(method: string, pattern: RegExp, handler: Handler) {
  routes.unshift([pattern, method, handler])
}
const sent = (method: string, pattern: RegExp) =>
  fetchMock.mock.calls
    .filter(([u, i]) => pattern.test(String(u)) && ((i as RequestInit)?.method ?? 'GET') === method)
    .map(([, i]) => JSON.parse(String((i as RequestInit).body ?? '{}')) as Record<string, unknown>)

const staff = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })
const DAY = 24 * 60 * 60 * 1000

function family(over: Partial<EnteredFamily> = {}): EnteredFamily {
  return {
    enrolmentId: 'e-1',
    kind: 'new_family',
    familyId: 'f-1',
    contactId: 'p-1',
    parentName: 'Parent Alpha',
    children: [{ id: 'k-1', name: 'Child One' }],
    enteredBy: { id: 'sales-1', name: 'Sales One' },
    enteredAt: new Date(Date.now() - DAY).toISOString(),
    supervisor: null,
    needsOperationsSupervisor: true,
    salesOwner: { id: 'sales-1', name: 'Sales One' },
    suggestion: { id: 'sup-2', name: 'Supervisor Two' },
    groupConversationId: null,
    parentSignup: { state: 'no_email' },
    ...over,
  }
}

function ownership(over: Partial<FamilyOwnership> = {}): FamilyOwnership {
  return {
    familyId: 'f-1',
    contactId: 'p-1',
    signIn: false,
    supervisor: null,
    needsOperationsSupervisor: true,
    salesOwner: { id: 'sales-1', name: 'Sales One' },
    suggestion: { id: 'sup-2', name: 'Supervisor Two' },
    can: { setSignInEmail: true, addChild: true, suggestSupervisor: false, assignOperationsSupervisor: true, changeSalesOwner: false },
    supervisorChoices: [{ id: 'sup-1', name: 'Supervisor One' }, { id: 'sup-2', name: 'Supervisor Two' }],
    salesOwnerChoices: [],
    ...over,
  }
}

const OLD = family({
  enrolmentId: 'e-2', familyId: 'f-2', contactId: 'p-2', parentName: 'Parent Beta', children: [{ id: 'k-2', name: 'Child Two' }],
  enteredAt: new Date(Date.now() - 40 * DAY).toISOString(), needsOperationsSupervisor: false, supervisor: { id: 'sup-1', name: 'Supervisor One' },
  suggestion: null, salesOwner: null, enteredBy: { id: 'sup-1', name: 'Supervisor One' }, parentSignup: { state: 'signed_up' },
})

function list(over: Partial<EnteredList> = {}): EnteredList {
  return { viewer: 'operations_manager', canAssignSupervisor: true, families: [family(), OLD], ...over }
}

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
  on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: false, operations: true }))
  on('GET', /\/trials\/new-students$/, () => json({ students: [], canAssign: true }))
  on('GET', /\/instalments\/access$/, () => json({ billingReader: true, canAssignBillingSupervisor: false }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

async function enteredSection() {
  renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
  return screen.findByRole('region', { name: 'Families entered by hand' })
}

describe('New Students: the families entered by hand', () => {
  it('each card says who entered it, who owns it, and who still waits for an Operations supervisor', async () => {
    on('GET', /\/family-intake\/entered$/, () => json(list({ families: [family({ parentSignup: { state: 'code_waiting', code: '482913', issuedAt: '2026-10-28T08:00:00Z' } }), OLD] })))
    const region = await enteredSection()
    const card = within(region).getByRole('heading', { name: 'Parent Alpha' }).closest('article')!
    expect(within(card).getByText('Child One')).toBeInTheDocument()
    expect(within(card).getByText(/Entered by/)).toHaveTextContent('Entered by Sales One')
    expect(within(card).getByText('Needs an Operations supervisor')).toBeInTheDocument()
    expect(within(card).getByText(/Suggested:/)).toHaveTextContent('Suggested: Supervisor Two')
    expect(within(card).getByText(/Sales owner/)).toBeInTheDocument()
    expect(within(card).getByText('482913')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Open the parent/ })).toHaveAttribute('href', '/parents/p-1')
    const other = within(region).getByRole('heading', { name: 'Parent Beta' }).closest('article')!
    expect(within(other).getByText('Supervisor One')).toBeInTheDocument()
    expect(within(other).queryByText('Needs an Operations supervisor')).not.toBeInTheDocument()
  })

  it('filters: needs a supervisor, waiting for sign-up, signed up, and -- for managers -- recently entered', async () => {
    on('GET', /\/family-intake\/entered$/, () => json(list()))
    const region = await enteredSection()
    const filters = within(region).getByRole('group', { name: 'Show' })
    await userEvent.click(within(filters).getByRole('button', { name: /Needs an Operations supervisor/ }))
    expect(within(region).getByRole('heading', { name: 'Parent Alpha' })).toBeInTheDocument()
    expect(within(region).queryByRole('heading', { name: 'Parent Beta' })).not.toBeInTheDocument()
    await userEvent.click(within(filters).getByRole('button', { name: /Signed up/ }))
    expect(within(region).queryByRole('heading', { name: 'Parent Alpha' })).not.toBeInTheDocument()
    expect(within(region).getByRole('heading', { name: 'Parent Beta' })).toBeInTheDocument()
    await userEvent.click(within(filters).getByRole('button', { name: /Waiting for sign-up/ }))
    expect(within(region).getByRole('heading', { name: 'Parent Alpha' })).toBeInTheDocument()
    expect(within(region).getByText('No sign-in e-mail')).toBeInTheDocument()
    await userEvent.click(within(filters).getByRole('button', { name: /Recently entered/ }))
    expect(within(region).getByRole('heading', { name: 'Parent Alpha' })).toBeInTheDocument()
    expect(within(region).queryByRole('heading', { name: 'Parent Beta' })).not.toBeInTheDocument()
  })

  it('a Sales member gets no "Recently entered" filter, and suggests the supervisor instead of choosing it', async () => {
    on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: true, operations: false }))
    on('GET', /\/family-intake\/entered$/, () => json(list({ viewer: 'sales_member', canAssignSupervisor: false, families: [family({ suggestion: null, canSuggestSupervisor: true })] })))
    on('GET', /\/family-intake\/families\/f-1$/, () =>
      json(ownership({ suggestion: null, can: { setSignInEmail: true, addChild: true, suggestSupervisor: true, assignOperationsSupervisor: false, changeSalesOwner: false } })))
    on('POST', /\/family-intake\/families\/f-1\/supervisor-suggestion$/, () => json({ familyId: 'f-1', supervisorId: 'sup-1' }, 201))
    const region = await enteredSection()
    expect(within(region).queryByRole('button', { name: /Recently entered/ })).not.toBeInTheDocument()
    const card = within(region).getByRole('heading', { name: 'Parent Alpha' }).closest('article')!
    expect(within(card).queryByRole('button', { name: 'Choose the supervisor' })).not.toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Suggest a supervisor' }))
    const dialog = await screen.findByRole('dialog', { name: /Suggest a supervisor/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suggest' }))
    expect(sent('POST', /supervisor-suggestion$/)).toEqual([])
    await chooseOption(userEvent, await within(dialog).findByLabelText('Operations supervisor'), 'sup-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suggest' }))
    await waitFor(() => expect(sent('POST', /\/family-intake\/families\/f-1\/supervisor-suggestion$/)).toEqual([{ supervisorId: 'sup-1' }]))
  })

  it('review of #214: only the family\'s Sales owner is offered "Suggest a supervisor" -- not the Sales manager', async () => {
    on('GET', /\/lessons\/access$/, () => json({ lessonManager: false, sales: true, operations: false }))
    on('GET', /\/family-intake\/entered$/, () => json(list({ viewer: 'sales_manager', canAssignSupervisor: false, families: [family({ suggestion: null, canSuggestSupervisor: false })] })))
    const region = await enteredSection()
    const card = within(region).getByRole('heading', { name: 'Parent Alpha' }).closest('article')!
    expect(within(card).queryByRole('button', { name: 'Suggest a supervisor' })).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Choose the supervisor' })).not.toBeInTheDocument()
  })

  it('the Operations manager chooses the supervisor, the suggestion preselected', async () => {
    on('GET', /\/family-intake\/entered$/, () => json(list()))
    on('GET', /\/family-intake\/families\/f-1$/, () => json(ownership()))
    on('POST', /\/family-intake\/families\/f-1\/operations-supervisor$/, () =>
      json({ familyId: 'f-1', supervisorId: 'sup-2', learnerIds: ['k-1'], group: 'none' }, 201))
    const region = await enteredSection()
    const card = within(region).getByRole('heading', { name: 'Parent Alpha' }).closest('article')!
    await userEvent.click(within(card).getByRole('button', { name: 'Choose the supervisor' }))
    const dialog = await screen.findByRole('dialog', { name: /Choose the Operations supervisor/ })
    await waitFor(() => expect(within(dialog).getByLabelText('Operations supervisor')).toHaveAttribute('data-value', 'sup-2'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/family-intake\/families\/f-1\/operations-supervisor$/)).toEqual([{ supervisorId: 'sup-2' }]))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('a viewer the server refuses sees the trial forms only, quietly', async () => {
    on('GET', /\/family-intake\/entered$/, () => json({ error: { code: 'COMM.INTAKE_DENIED', message: 'no' } }, 403))
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    await waitFor(() => expect(sent('GET', /\/family-intake\/entered$/).length).toBeGreaterThan(0))
    expect(screen.queryByRole('region', { name: 'Families entered by hand' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('A trial sibling: Assign adds the children to the family the parent is in', () => {
  const FORM: NewStudentDto = {
    trialId: 'tr-sib',
    prospectName: 'Prospect Sib',
    trialTeacher: { id: 't-1', name: 'Teacher One' },
    trialAt: '2026-10-10T15:00:00Z',
    recordedAt: '2026-10-11T10:00:00Z',
    recordedBy: { id: 's-9', name: 'Sales One' },
    updatedAt: null,
    parent: { name: 'Parent Delta', email: 'delta@example.test', phone: '+99 000 444' },
    children: [{ name: 'Child D2', age: 7, course: 'Course A', teacher: { id: 't-1', name: 'Teacher One' }, packagePrice: 1000, lessonPrice: 125, schedule: [] }],
    payment: { currency: 'EGP', method: 'invoice' },
    enrolment: null,
  }

  it('PARENT_EXISTS offers "Add to «parent»\'s family", which assigns with the family and says the group was joined', async () => {
    on('GET', /\/trials\/new-students$/, () => json({ students: [FORM], canAssign: true }))
    on('GET', /\/org\/structure$/, () => json({ departments: [{ id: 'd-ops', kind: 'operations', displayName: 'Operations', manager: null, backups: [],
      members: [{ id: 'sup-1', name: 'Supervisor One', role: 'admin', isActive: true, position: 'supervisor', learnerCount: 4 }] }] }))
    on('POST', /\/trials\/new-students\/tr-sib\/assign$/, (_u, init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>
      if (body.familyId === 'f-9') {
        return json({ familyId: 'f-9', learnerIds: ['k-9'], schedules: [], attached: true, group: 'joined' }, 201)
      }
      return json({ error: { code: 'COMM.PARENT_EXISTS', message: 'this parent is already in Chat', detail: { familyId: 'f-9', contactId: 'p-9', parentName: 'Parent Delta' } } }, 409)
    })
    renderWithProviders(<AppRoutes />, { staff, route: '/trials/new-students' })
    const card = (await screen.findByRole('heading', { name: 'Parent Delta' })).closest('article')!
    await userEvent.click(within(card).getByRole('button', { name: 'Assign' }))
    const dialog = await screen.findByRole('dialog', { name: /Assign a supervisor/ })
    await chooseOption(userEvent, await within(dialog).findByLabelText('Supervisor'), 'sup-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }))
    expect(await within(dialog).findByText('This parent is already in Chat.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: "Add to Parent Delta's family" }))
    await waitFor(() => expect(sent('POST', /\/trials\/new-students\/tr-sib\/assign$/).at(-1)).toEqual({ familyId: 'f-9' }))
    expect(await screen.findByText(/added to Parent Delta's family/)).toHaveTextContent('and joined its group')
  })
})

function parentProfile(): ParentProfile {
  return {
    id: 'p-1', name: 'Parent Alpha', relationship: 'parent', isActive: true, avatarUrl: null,
    family: { id: 'f-1', name: 'Family Alpha' },
    contact: { phone: '+20 100 000 0000', email: null, countryCode: 'EG', region: null },
    adminNote: null, childrenCount: 1, children: [{ id: 'k-1', name: 'Child One', avatarUrl: null }],
    updatedAt: null, access: { canEdit: true },
  }
}

describe('The Parent Profile: sign-in e-mail, Sales owner, Operations supervisor', () => {
  beforeEach(() => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parentProfile()))
  })

  it('no sign-in e-mail: Set sign-in e-mail sends it', async () => {
    on('GET', /\/family-intake\/families\/f-1$/, () => json(ownership()))
    on('POST', /\/family-intake\/families\/f-1\/sign-in-email$/, () => json({ familyId: 'f-1', contactId: 'p-1', accountId: 'a-1' }, 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/parents/p-1' })
    const region = await screen.findByRole('region', { name: 'Ownership and sign-in' })
    expect(within(region).getByText('No sign-in e-mail')).toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: 'Set sign-in e-mail' }))
    const dialog = await screen.findByRole('dialog', { name: /Set sign-in e-mail/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(sent('POST', /sign-in-email$/)).toEqual([])
    await userEvent.type(within(dialog).getByLabelText('E-mail'), 'alpha@example.test')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/family-intake\/families\/f-1\/sign-in-email$/)).toEqual([{ email: 'alpha@example.test' }]))
  })

  it('the Sales manager changes the Sales owner, with a reason', async () => {
    on('GET', /\/family-intake\/families\/f-1$/, () => json(ownership({
      signIn: true, needsOperationsSupervisor: false, supervisor: { id: 'sup-1', name: 'Supervisor One' }, suggestion: null,
      can: { setSignInEmail: false, addChild: true, suggestSupervisor: false, assignOperationsSupervisor: false, changeSalesOwner: true },
      salesOwnerChoices: [{ id: 'sales-1', name: 'Sales One' }, { id: 'sales-2', name: 'Sales Two' }],
    })))
    on('POST', /\/family-intake\/families\/f-1\/sales-owner$/, () => json({ familyId: 'f-1', salesOwnerId: 'sales-2', previousSalesOwnerId: 'sales-1' }, 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/parents/p-1' })
    const region = await screen.findByRole('region', { name: 'Ownership and sign-in' })
    expect(within(region).queryByText('No sign-in e-mail')).not.toBeInTheDocument()
    expect(within(region).getByText('Sales One')).toBeInTheDocument()
    expect(within(region).getByText('Supervisor One')).toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: 'Change the Sales owner' }))
    const dialog = await screen.findByRole('dialog', { name: /Change the Sales owner/ })
    await chooseOption(userEvent, within(dialog).getByLabelText('Sales owner'), 'sales-2')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(sent('POST', /sales-owner$/)).toEqual([])
    await userEvent.type(within(dialog).getByLabelText('Reason (required)'), 'takes the renewals')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/family-intake\/families\/f-1\/sales-owner$/)).toEqual([{ staffId: 'sales-2', reason: 'takes the renewals' }]))
  })

  it('waiting for its Operations supervisor: the Operations manager chooses it here too', async () => {
    on('GET', /\/family-intake\/families\/f-1$/, () => json(ownership()))
    on('POST', /\/family-intake\/families\/f-1\/operations-supervisor$/, () => json({ familyId: 'f-1', supervisorId: 'sup-1', learnerIds: ['k-1'], group: 'none' }, 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/parents/p-1' })
    const region = await screen.findByRole('region', { name: 'Ownership and sign-in' })
    expect(within(region).getByText('Needs an Operations supervisor')).toBeInTheDocument()
    await userEvent.click(within(region).getByRole('button', { name: 'Choose the supervisor' }))
    const dialog = await screen.findByRole('dialog', { name: /Choose the Operations supervisor/ })
    await chooseOption(userEvent, within(dialog).getByLabelText('Operations supervisor'), 'sup-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/family-intake\/families\/f-1\/operations-supervisor$/)).toEqual([{ supervisorId: 'sup-1' }]))
  })

  it('a family the viewer does not own: no panel, nothing said', async () => {
    on('GET', /\/family-intake\/families\/f-1$/, () => json({ error: { code: 'COMM.INTAKE_NOT_FOUND', message: 'no' } }, 404))
    renderWithProviders(<AppRoutes />, { staff, route: '/parents/p-1' })
    expect(await screen.findByRole('heading', { level: 1, name: /^Parent Alpha/ })).toBeInTheDocument()
    await waitFor(() => expect(sent('GET', /\/family-intake\/families\/f-1$/).length).toBeGreaterThan(0))
    expect(screen.queryByRole('region', { name: 'Ownership and sign-in' })).not.toBeInTheDocument()
  })
})

describe('The Parent Profile: the family history (S4)', () => {
  beforeEach(() => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parentProfile()))
    on('GET', /\/family-intake\/families\/f-1$/, () => json({ error: { code: 'COMM.INTAKE_NOT_FOUND', message: 'no' } }, 404))
  })

  it('who entered it, who owns it, who placed it, and the package -- in order, with who did it and when', async () => {
    on('GET', /\/family-intake\/families\/f-1\/history$/, () => json({
      familyId: 'f-1',
      entries: [
        { id: 'audit:1', action: 'family.entered', at: '2026-10-20T09:00:00Z', actor: { id: 'sales-1', name: 'Sales One' },
          subject: { kind: 'family', id: 'f-1', name: 'Parent Alpha' }, details: {}, reason: null },
        { id: 'audit:2', action: 'subscription.carried_over', at: '2026-10-20T09:00:00Z', actor: { id: 'sales-1', name: 'Sales One' },
          subject: { kind: 'learner', id: 'k-1', name: 'Child One' }, details: { total: 20, completed: 12, planMonths: 3 }, reason: null },
        { id: 'audit:3', action: 'family.operations_supervisor_set', at: '2026-10-21T09:00:00Z', actor: { id: 'm-1', name: 'Manager One' },
          subject: { kind: 'family', id: 'f-1', name: 'Parent Alpha' }, details: { supervisor: { id: 'sup-1', name: 'Supervisor One' } }, reason: null },
        { id: 'audit:4', action: 'family.sales_owner_changed', at: '2026-10-22T09:00:00Z', actor: { id: 'sm-1', name: 'Sales Manager' },
          subject: { kind: 'family', id: 'f-1', name: 'Parent Alpha' },
          details: { from: { id: 'sales-1', name: 'Sales One' }, to: { id: 'sales-2', name: 'Sales Two' } }, reason: 'takes the renewals' },
      ],
    }))
    renderWithProviders(<AppRoutes />, { staff, route: '/parents/p-1' })
    const region = await screen.findByRole('region', { name: 'Family history' })
    const items = within(region).getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[0]).toHaveTextContent('Entered the family')
    expect(items[0]).toHaveTextContent('Sales One')
    expect(items[1]).toHaveTextContent('Carried over the package from Jawwid Core')
    expect(items[1]).toHaveTextContent('Child One')
    expect(items[1]).toHaveTextContent('Total lessons 20 · Completed lessons 12 · 3 months')
    expect(items[2]).toHaveTextContent('Chose the Operations supervisor')
    expect(items[2]).toHaveTextContent('Supervisor One')
    expect(items[3]).toHaveTextContent('Changed the Sales owner')
    expect(items[3]).toHaveTextContent('Sales One → Sales Two')
    expect(items[3]).toHaveTextContent('takes the renewals')
    expect(items[3]!.querySelector('time')).toHaveAttribute('dateTime', '2026-10-22T09:00:00Z')
  })

  it('a family the viewer does not own: no history, nothing said', async () => {
    on('GET', /\/family-intake\/families\/f-1\/history$/, () => json({ error: { code: 'COMM.INTAKE_NOT_FOUND', message: 'no' } }, 404))
    renderWithProviders(<AppRoutes />, { staff, route: '/parents/p-1' })
    expect(await screen.findByRole('heading', { level: 1, name: /^Parent Alpha/ })).toBeInTheDocument()
    await waitFor(() => expect(sent('GET', /\/family-intake\/families\/f-1\/history$/).length).toBeGreaterThan(0))
    expect(screen.queryByRole('region', { name: 'Family history' })).not.toBeInTheDocument()
  })
})

function studentProfile(): StudentProfile {
  return {
    id: 'k-1', name: 'Child One', avatarUrl: null, age: 9, birthDate: null, course: null, teacher: null, schedule: [],
    family: { id: 'f-1', name: 'Family Alpha', parents: [{ id: 'p-1', name: 'Parent Alpha' }] }, viewer: 'staff',
  }
}

function carried(over: Partial<CarriedOverView> = {}): CarriedOverView {
  return {
    learnerId: 'k-1',
    package: { total: 20, completed: 12, remaining: 8, planMonths: 3, enteredBy: { id: 's-1', name: 'Supervisor One' }, enteredAt: '2026-10-28T09:00:00Z' },
    access: { state: 'open', balance: 8 },
    can: { carryOver: false, correct: true },
    ...over,
  }
}

describe('The Student Profile: the package carried over from Jawwid Core', () => {
  beforeEach(() => {
    on('GET', /\/learners\/k-1\/profile$/, () => json(studentProfile()))
  })

  it('total, completed, remaining and plan; Correct voids it with a reason', async () => {
    on('GET', /\/family-intake\/learners\/k-1\/carried-over$/, () => json(carried()))
    on('POST', /\/family-intake\/learners\/k-1\/carried-over\/void$/, () => json({ learnerId: 'k-1', voided: true }, 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/students/k-1' })
    const panel = await screen.findByRole('region', { name: 'Current package' })
    expect(within(panel).getByText('Total lessons').nextElementSibling).toHaveTextContent('20')
    expect(within(panel).getByText('Completed lessons').nextElementSibling).toHaveTextContent('12')
    expect(within(panel).getByText('Remaining').nextElementSibling).toHaveTextContent('8')
    expect(within(panel).getByText(/3 months/)).toBeInTheDocument()
    expect(within(panel).getByText('Active')).toBeInTheDocument()
    expect(within(panel).getByText(/Supervisor One/)).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Correct' }))
    const dialog = await screen.findByRole('dialog', { name: /Correct the package/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove the package' }))
    expect(sent('POST', /carried-over\/void$/)).toEqual([])
    await userEvent.type(within(dialog).getByLabelText('Reason (required)'), 'typed 20 for 24')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove the package' }))
    await waitFor(() => expect(sent('POST', /\/family-intake\/learners\/k-1\/carried-over\/void$/)).toEqual([{ reason: 'typed 20 for 24' }]))
  })

  it('a used-up package says so', async () => {
    on('GET', /\/family-intake\/learners\/k-1\/carried-over$/, () =>
      json(carried({ package: { ...carried().package!, completed: 20, remaining: 0 }, can: { carryOver: false, correct: false } })))
    renderWithProviders(<AppRoutes />, { staff, route: '/students/k-1' })
    const panel = await screen.findByRole('region', { name: 'Current package' })
    expect(within(panel).getByText('Used up')).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Correct' })).not.toBeInTheDocument()
  })

  it('none yet: "Enter the package", the remaining computed as it is typed', async () => {
    on('GET', /\/family-intake\/learners\/k-1\/carried-over$/, () => json(carried({ package: null, can: { carryOver: true, correct: false } })))
    on('POST', /\/family-intake\/learners\/k-1\/carried-over$/, () => json({ learnerId: 'k-1', total: 24, completed: 3, planMonths: 6 }, 201))
    renderWithProviders(<AppRoutes />, { staff, route: '/students/k-1' })
    const panel = await screen.findByRole('region', { name: 'Current package' })
    expect(within(panel).getByText('No package entered')).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Enter the package' }))
    const dialog = await screen.findByRole('dialog', { name: /Enter the package/ })
    await userEvent.type(within(dialog).getByLabelText('Total lessons'), '24')
    await userEvent.type(within(dialog).getByLabelText('Completed lessons'), '3')
    await userEvent.type(within(dialog).getByLabelText('Plan length (months)'), '6')
    expect(within(dialog).getByTestId('carry-remaining')).toHaveTextContent('Remaining: 21')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('POST', /\/family-intake\/learners\/k-1\/carried-over$/)).toEqual([{ total: 24, completed: 3, planMonths: 6 }]))
  })

  it('a viewer the server refuses: no panel', async () => {
    on('GET', /\/family-intake\/learners\/k-1\/carried-over$/, () => json({ error: { code: 'COMM.INTAKE_NOT_FOUND', message: 'no' } }, 404))
    renderWithProviders(<AppRoutes />, { staff, route: '/students/k-1' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Child One' })).toBeInTheDocument()
    await waitFor(() => expect(sent('GET', /carried-over$/).length).toBeGreaterThan(0))
    expect(screen.queryByRole('region', { name: 'Current package' })).not.toBeInTheDocument()
  })
})
