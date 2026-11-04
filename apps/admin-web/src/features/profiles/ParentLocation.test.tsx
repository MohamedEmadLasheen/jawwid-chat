import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from '@/app/AppRoutes'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { chooseOption } from '@/test/select'
import { mockGeo } from '@/test/geo'
import type { ParentListItem, ParentProfile, StudentProfile } from './api'

/**
 * PD-45 PR-2b (plan §5.2 E1, §6.1, §6.2, §7): staff edit a parent's location on
 * the Parent Profile with the shared LocationPicker, see the old free-text
 * region as an "Old note", a parent's own answer before overwriting it, and the
 * staff-only suggestion from the phone; the Parents list shows each family's
 * location and filters "Missing location"; clocks are an estimate and a hint.
 * `fetch` is answered at the network boundary.
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
const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call![1] as RequestInit).body))

const DUBAI = { country: { code: 'AE', en: 'United Arab Emirates', ar: 'الإمارات العربية المتحدة' }, subdivision: { code: 'AE-DU', en: 'Dubai', ar: 'دبي' }, label: { en: 'Emirate', ar: 'الإمارة' } }

function parent(over: Partial<ParentProfile> = {}, contact: Partial<ParentProfile['contact']> = {}): ParentProfile {
  return {
    id: 'p-1',
    name: 'Parent Alpha',
    relationship: 'parent',
    isActive: true,
    avatarUrl: null,
    family: { id: 'f-1', name: 'Family Alpha' },
    contact: {
      phone: '+971 50 123 4567',
      email: 'alpha@example.test',
      countryCode: 'AE',
      subdivisionCode: 'AE-DU',
      location: DUBAI,
      locationSource: 'staff',
      locationUpdatedAt: '2026-10-20T10:00:00.000Z',
      region: null,
      ...contact,
    },
    suggestedCountryCode: null,
    suggestedCallingCode: null,
    timeZone: { app: null, estimate: null, mismatch: false },
    adminNote: null,
    childrenCount: 1,
    children: [{ id: 'k-1', name: 'Child One', avatarUrl: null }],
    updatedAt: null,
    access: { canEdit: true },
    ...over,
  }
}

const supervisor = makeStaff({ id: 's-1', name: 'Supervisor One', role: 'admin' })

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
  on('GET', /\/instalments\/access$/, () => json({ billingReader: true, canAssignBillingSupervisor: false }))
  on('GET', /\/families\/f-1\/billing$/, () => json({ error: { code: 'COMM.BILLING_DENIED', message: 'no' } }, 403))
  mockGeo((m, p, h) => on(m, p, (url) => h(url)), json)
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

async function openDialog(profile: ParentProfile, locale: 'en' | 'ar' = 'en') {
  on('GET', /\/parent-profiles\/p-1$/, () => json(profile))
  renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1', locale })
  await userEvent.click(await screen.findByRole('button', { name: locale === 'ar' ? 'تعديل بيانات التواصل' : 'Edit contact information' }))
  return screen.getByRole('dialog', { name: locale === 'ar' ? 'تعديل بيانات التواصل' : 'Edit contact information' })
}

describe('the Parent Profile shows the location', () => {
  it('the country, the subdivision under its own label, and nothing about an old note once the subdivision is set', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent({}, { region: 'Dubai (old text)' })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    const contact = await screen.findByRole('region', { name: 'Contact information' })
    expect(within(contact).getByText('United Arab Emirates')).toBeInTheDocument()
    expect(within(contact).getByText('Emirate')).toBeInTheDocument()
    expect(within(contact).getByText('Dubai')).toBeInTheDocument()
    expect(within(contact).queryByText(/Old note/)).not.toBeInTheDocument()
    expect(within(contact).queryByText(/old text/)).not.toBeInTheDocument()
  })

  it('shows the old free-text region as an "Old note" until a subdivision is set', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent({}, { subdivisionCode: null, location: { ...DUBAI, subdivision: null }, region: 'Dubayy' })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    const contact = await screen.findByRole('region', { name: 'Contact information' })
    expect(within(contact).getByText('Old note')).toBeInTheDocument()
    expect(within(contact).getByText('Dubayy')).toBeInTheDocument()
    expect(within(contact).getByText('Not recorded')).toBeInTheDocument()
  })

  it('says when the parent set it themselves', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent({}, { locationSource: 'parent' })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    const contact = await screen.findByRole('region', { name: 'Contact information' })
    expect(within(contact).getByText(/^Set by the parent on .*2026/)).toBeInTheDocument()
  })

  it('reads the same in Arabic', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent({}, { locationSource: 'parent', subdivisionCode: null, location: { ...DUBAI, subdivision: null }, region: 'دبي القديمة' })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1', locale: 'ar' })
    const contact = await screen.findByRole('region', { name: 'بيانات التواصل' })
    expect(within(contact).getByText('الإمارات العربية المتحدة')).toBeInTheDocument()
    expect(within(contact).getByText('الإمارة')).toBeInTheDocument()
    expect(within(contact).getByText('ملاحظة قديمة')).toBeInTheDocument()
    expect(within(contact).getByText(/^حدّده ولي الأمر في .*2026/)).toBeInTheDocument()
  })

  it('§7: with no app clock, the clock the country implies, marked approximate', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent({ timeZone: { app: null, estimate: 'Africa/Cairo', mismatch: false } }, { countryCode: 'EG', subdivisionCode: null, location: { ...DUBAI, country: { code: 'EG', en: 'Egypt', ar: 'مصر' }, subdivision: null } })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    expect(await screen.findByText('≈ Cairo time (from location)')).toBeInTheDocument()
  })

  it('§7: the estimate in Arabic', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent({ timeZone: { app: null, estimate: 'Africa/Cairo', mismatch: false } })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1', locale: 'ar' })
    expect(await screen.findByText('≈ توقيت القاهرة (حسب الموقع)')).toBeInTheDocument()
  })

  it('§7: a hint, not a change, when the app clock disagrees with the location', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent({ timeZone: { app: 'Africa/Cairo', estimate: 'Asia/Dubai', mismatch: true } })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    expect(await screen.findByText('Location: United Arab Emirates · App clock: Cairo')).toBeInTheDocument()
    expect(screen.queryByText(/from location/)).not.toBeInTheDocument()
  })

  it('§7: no line at all when the clocks agree, or there is nothing to compare', async () => {
    on('GET', /\/parent-profiles\/p-1$/, () => json(parent({ timeZone: { app: 'Asia/Muscat', estimate: 'Asia/Dubai', mismatch: false } })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents/p-1' })
    await screen.findByRole('region', { name: 'Contact information' })
    expect(screen.queryByText(/App clock/)).not.toBeInTheDocument()
    expect(screen.queryByText(/from location/)).not.toBeInTheDocument()
  })
})

describe('EditContactDialog', () => {
  it('opens on the stored location, and a change sends the country and subdivision -- never region, even for a parent with an old note', async () => {
    const dialog = await openDialog(parent({}, { region: 'Dubayy', subdivisionCode: null, location: { ...DUBAI, subdivision: null } }))
    expect(within(dialog).getByRole('combobox', { name: 'Country' })).toHaveValue('🇦🇪 United Arab Emirates')
    // The old note stays visible under the picker while the subdivision is unset.
    expect(within(dialog).getByText('Old note: Dubayy')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/Emirate or governorate/)).not.toBeInTheDocument()

    on('POST', /\/parent-profiles\/p-1$/, () => json(parent()))
    const emirate = await within(dialog).findByRole('combobox', { name: 'Emirate' })
    await waitFor(() => expect(emirate).toBeEnabled())
    await chooseOption(userEvent, emirate, 'AE-DU')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/parent-profiles\/p-1$/)).toHaveLength(1))
    const body = bodyOf(calls('POST', /\/parent-profiles\/p-1$/)[0])
    expect(body).toEqual({ countryCode: 'AE', subdivisionCode: 'AE-DU' })
    expect(body).not.toHaveProperty('region')
  })

  it('changing the country sends both: the new country and a cleared subdivision', async () => {
    const dialog = await openDialog(parent())
    on('POST', /\/parent-profiles\/p-1$/, () => json(parent()))
    await chooseOption(userEvent, within(dialog).getByRole('combobox', { name: 'Country' }), 'EG')
    expect(await within(dialog).findByRole('combobox', { name: 'Governorate' })).toHaveValue('')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/parent-profiles\/p-1$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/parent-profiles\/p-1$/)[0])).toEqual({ countryCode: 'EG', subdivisionCode: null })
  })

  it('an edit that leaves the location alone sends no location and no region', async () => {
    const dialog = await openDialog(parent({}, { region: 'Dubayy', subdivisionCode: null, location: { ...DUBAI, subdivision: null } }))
    on('POST', /\/parent-profiles\/p-1$/, () => json(parent()))
    const email = within(dialog).getByLabelText('Email address')
    await userEvent.clear(email)
    await userEvent.type(email, 'new@example.test')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/parent-profiles\/p-1$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/parent-profiles\/p-1$/)[0])).toEqual({ email: 'new@example.test' })
  })

  it('Q6: staff see "Set by the parent on <date>" before they save over a parent\'s own answer', async () => {
    const dialog = await openDialog(parent({}, { locationSource: 'parent' }))
    expect(within(dialog).getByText(/^Set by the parent on .*2026/)).toBeInTheDocument()
  })

  it('...and not when staff set it', async () => {
    const dialog = await openDialog(parent({}, { locationSource: 'staff' }))
    expect(within(dialog).queryByText(/Set by the parent/)).not.toBeInTheDocument()
  })

  it('§6.2: offers the phone\'s country as a chip -- staff only, Use fills the picker, nothing is saved until Save', async () => {
    const dialog = await openDialog(parent({ suggestedCountryCode: 'AE', suggestedCallingCode: '971' }, { countryCode: null, subdivisionCode: null, location: null }))
    expect(await within(dialog).findByText('The number starts with +971: United Arab Emirates?')).toBeInTheDocument()
    // Saving without choosing it sends no country.
    on('POST', /\/parent-profiles\/p-1$/, () => json(parent()))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Use' }))
    expect(within(dialog).getByRole('combobox', { name: 'Country' })).toHaveValue('🇦🇪 United Arab Emirates')
    expect(within(dialog).queryByText(/The number starts with/)).not.toBeInTheDocument()
    expect(calls('POST', /\/parent-profiles\/p-1$/)).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST', /\/parent-profiles\/p-1$/)).toHaveLength(1))
    expect(bodyOf(calls('POST', /\/parent-profiles\/p-1$/)[0])).toEqual({ countryCode: 'AE', subdivisionCode: null })
  })

  it('§6.2: Dismiss hides the chip and saves nothing; no chip once a country is chosen', async () => {
    const dialog = await openDialog(parent({ suggestedCountryCode: 'AE', suggestedCallingCode: '971' }, { countryCode: null, subdivisionCode: null, location: null }))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Dismiss' }))
    expect(within(dialog).queryByText(/The number starts with/)).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(calls('POST', /\/parent-profiles\/p-1$/)).toHaveLength(0)
  })

  it('has no free-text region box and no "other country" box any more', async () => {
    const dialog = await openDialog(parent())
    expect(within(dialog).queryByLabelText(/Two-letter country code/)).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/Emirate or governorate/)).not.toBeInTheDocument()
    expect(dialog.querySelector('select')).toBeNull()
  })

  it('works in Arabic: the chip, its buttons, the old note and the parent\'s own answer', async () => {
    const dialog = await openDialog(
      parent({ suggestedCountryCode: 'AE', suggestedCallingCode: '971' }, { countryCode: null, subdivisionCode: null, location: null, region: 'دبي', locationSource: 'parent' }),
      'ar',
    )
    expect(await within(dialog).findByText('الرقم يبدأ بـ ‎+971: الإمارات العربية المتحدة؟')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'استخدام' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'تجاهل' })).toBeInTheDocument()
    expect(within(dialog).getByText('ملاحظة قديمة: دبي')).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: 'الدولة' })).toBeInTheDocument()
  })
})

describe('the Parents list', () => {
  const item = (id: string, name: string, location: ParentListItem['location']): ParentListItem => ({
    id, name, avatarUrl: null, family: { id: `f-${id}`, name: `${name} family` }, childrenCount: 1, location,
  })

  it('asks for the location, shows it as "Egypt · Giza" (or a dash), and filters "Missing location" through the API', async () => {
    on('GET', /\/parent-profiles(\?|$)/, (url) => {
      const missing = new URL(url, 'http://x').searchParams.get('location') === 'missing'
      return json({
        items: missing
          ? [item('b', 'Bravo', { countryCode: null, subdivisionCode: null })]
          : [item('a', 'Alpha', { countryCode: 'EG', subdivisionCode: 'EG-GZ' }), item('b', 'Bravo', { countryCode: null, subdivisionCode: null })],
        truncated: false,
      })
    })
    on('GET', /\/intake\/options/, () => json({ error: { code: 'x', message: 'no' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents' })
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Location' })).toBeInTheDocument()
    expect(await within(table).findByText('Egypt · Giza')).toBeInTheDocument()
    expect(within(table).getByText('—')).toBeInTheDocument()
    const first = new URL(String(calls('GET', /\/parent-profiles(\?|$)/)[0]![0]), 'http://x')
    expect(first.searchParams.get('with')).toBe('location')
    expect(first.searchParams.get('location')).toBeNull()

    const filter = screen.getByRole('group', { name: 'Location' })
    await userEvent.click(within(filter).getByRole('button', { name: 'Missing location' }))
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Alpha')).not.toBeInTheDocument())
    const last = new URL(String(calls('GET', /\/parent-profiles(\?|$)/).at(-1)![0]), 'http://x')
    expect(last.searchParams.get('location')).toBe('missing')
    expect(within(screen.getByRole('group', { name: 'Location' })).getByRole('button', { name: 'Missing location' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens already filtered from ?location=missing', async () => {
    on('GET', /\/parent-profiles(\?|$)/, () => json({ items: [item('b', 'Bravo', { countryCode: null, subdivisionCode: null })], truncated: false }))
    on('GET', /\/intake\/options/, () => json({ error: { code: 'x', message: 'no' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents?location=missing' })
    await screen.findByRole('table')
    expect(new URL(String(calls('GET', /\/parent-profiles(\?|$)/)[0]![0]), 'http://x').searchParams.get('location')).toBe('missing')
  })

  it('reads in Arabic', async () => {
    on('GET', /\/parent-profiles(\?|$)/, () => json({ items: [item('a', 'Alpha', { countryCode: 'EG', subdivisionCode: 'EG-GZ' })], truncated: false }))
    on('GET', /\/intake\/options/, () => json({ error: { code: 'x', message: 'no' } }, 403))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/parents', locale: 'ar' })
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'الموقع' })).toBeInTheDocument()
    expect(await within(table).findByText('مصر · الجيزة')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'بلا موقع' })).toBeInTheDocument()
  })
})

describe('the Student Profile (§7)', () => {
  const student = (over: Partial<StudentProfile>): StudentProfile => ({
    id: 'k-1', name: 'Child One', avatarUrl: null, age: 9, birthDate: null, course: null, teacher: null,
    schedule: [{ weekday: 1, start: '16:30', durationMinutes: 30, timezone: 'Africa/Cairo', nextStartsAt: '2027-01-18T14:30:00.000Z' }],
    family: { id: 'f-1', name: 'Family Alpha', parents: [] }, viewer: 'staff', ...over,
  })

  it('shows the family\'s time from the location, marked approximate, when no parent has an app clock', async () => {
    on('GET', /\/learners\/k-1\/profile$/, () => json(student({ familyTimeZone: null, familyTimeZoneEstimate: 'Asia/Dubai' })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/students/k-1' })
    expect(await screen.findByText(/family's time ≈ .*Dubai time.* \(from location\)/)).toBeInTheDocument()
  })

  it('a real app clock wins over the estimate', async () => {
    on('GET', /\/learners\/k-1\/profile$/, () => json(student({ familyTimeZone: 'Asia/Riyadh', familyTimeZoneEstimate: null })))
    renderWithProviders(<AppRoutes />, { staff: supervisor, route: '/students/k-1' })
    expect(await screen.findByText(/family's time: .*Riyadh time/)).toBeInTheDocument()
    expect(screen.queryByText(/from location/)).not.toBeInTheDocument()
  })
})
