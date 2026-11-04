import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { tokenStore } from '@/core/auth/tokens'
import { renderWithProviders } from '@/test/utils'
import { listOf } from '@/test/select'
import { mockGeo } from '@/test/geo'
import { LocationPicker, LocationText, type LocationValue } from './LocationPicker'

/**
 * PD-45 PR-2b (plan §5.1, §10): the one location picker of the Admin Web, on
 * SearchableSelect. Pinned countries first, then a divider and A-Z in the
 * interface language; search in Arabic (folded), English and by ISO code; a
 * second list of the country's subdivisions, labelled per country, cleared when
 * the country changes, hidden when the country has none; a country-only mode.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
let routes: Array<[RegExp, string, (url: string) => Response]>
let fetchMock: ReturnType<typeof vi.fn>
const on = (method: string, pattern: RegExp, handler: (url: string) => Response) => routes.unshift([pattern, method, handler])

beforeEach(() => {
  routes = []
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase()
    for (const [pattern, m, handler] of routes) if (m === method && pattern.test(String(input))) return handler(String(input))
    return json({ error: { code: 'unrouted', message: 'no mock' } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  tokenStore.set({ accessToken: 'a', refreshToken: 'r' })
  mockGeo(on, json)
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const EMPTY: LocationValue = { countryCode: null, subdivisionCode: null }

function Harness({ initial = EMPTY, onChange = () => undefined, ...rest }: { initial?: LocationValue; onChange?: (v: LocationValue) => void } & Partial<React.ComponentProps<typeof LocationPicker>>) {
  const [value, setValue] = useState(initial)
  return (
    <LocationPicker
      {...rest}
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange(v)
      }}
    />
  )
}

/** The listed choices, without the "Not set" row that lets the picker be cleared. */
const rows = (box: HTMLElement) => within(listOf(box)).queryAllByRole('option').filter((o) => o.dataset.value !== '')
const labels = (box: HTMLElement) => rows(box).map((o) => o.querySelector('.ss__label')?.textContent?.trim() ?? '')
const listed = (box: HTMLElement, n: number) => waitFor(() => expect(rows(box)).toHaveLength(n))

describe('LocationPicker (English)', () => {
  it('lists the pinned countries first (Egypt, Saudi Arabia, UAE), a divider, then the rest A-Z; each row shows a flag and the other language muted', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    const country = await screen.findByRole('combobox', { name: 'Country' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await user.click(country)
    await listed(country, 6)
    expect(labels(country)).toEqual([
      '🇪🇬 Egypt',
      '🇸🇦 Saudi Arabia',
      '🇦🇪 United Arab Emirates',
      '🇦🇹 Austria',
      '🇫🇷 France',
      '🇺🇸 United States',
    ])
    expect(within(listOf(country)).getAllByRole('separator')).toHaveLength(1)
    // The other language rides along, muted, and is searched with the name.
    const egypt = rows(country)[0]!
    expect(egypt.querySelector('.ss__hint')?.textContent).toContain('مصر')
  })

  it('finds a country by its Arabic name (folded), its English name and its ISO code, whatever the interface language', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    const country = await screen.findByRole('combobox', { name: 'Country' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await user.click(country)
    await listed(country, 6)
    await user.keyboard('الامارات') // no hamza: the list says الإمارات
    expect(labels(country)).toEqual(['🇦🇪 United Arab Emirates'])
    await user.clear(country)
    await user.keyboard('fran')
    expect(labels(country)).toEqual(['🇫🇷 France'])
    await user.clear(country)
    await user.keyboard('sa')
    expect(labels(country)).toContain('🇸🇦 Saudi Arabia')
    await user.clear(country)
    await user.keyboard('EG')
    expect(labels(country)[0]).toBe('🇪🇬 Egypt')
  })

  it('shows the subdivision list after a country is chosen, labelled for that country, A-Z, and searchable with folding', async () => {
    const user = userEvent.setup()
    const seen: LocationValue[] = []
    renderWithProviders(<Harness onChange={(v) => seen.push(v)} />)
    const country = await screen.findByRole('combobox', { name: 'Country' })
    // Disabled until a country is chosen.
    expect(screen.getByRole('combobox', { name: 'Region' })).toBeDisabled()
    await user.click(country)
    await listed(country, 6)
    await user.click(within(listOf(country)).getByRole('option', { name: /Egypt/ }))
    expect(seen.at(-1)).toEqual({ countryCode: 'EG', subdivisionCode: null })

    const governorate = await screen.findByRole('combobox', { name: 'Governorate' })
    await waitFor(() => expect(governorate).toBeEnabled())
    await user.click(governorate)
    await listed(governorate, 3)
    expect(labels(governorate)).toEqual(['Alexandria', 'Cairo', 'Giza'])
    await user.keyboard('EG-GZ') // the ISO code finds it too
    expect(labels(governorate)).toEqual(['Giza'])
    await user.clear(governorate)
    await user.keyboard('جيزه') // and so does the Arabic name, folded
    expect(labels(governorate)).toEqual(['Giza'])
    await user.clear(governorate)
    await user.click(within(listOf(governorate)).getByRole('option', { name: /^Giza/ }))
    expect(seen.at(-1)).toEqual({ countryCode: 'EG', subdivisionCode: 'EG-GZ' })
    expect(governorate).toHaveValue('Giza')
  })

  it('changing the country clears the subdivision, and the label follows the new country', async () => {
    const user = userEvent.setup()
    const seen: LocationValue[] = []
    renderWithProviders(<Harness initial={{ countryCode: 'EG', subdivisionCode: 'EG-GZ' }} onChange={(v) => seen.push(v)} />)
    const country = await screen.findByRole('combobox', { name: 'Country' })
    await waitFor(() => expect(country).toHaveValue('🇪🇬 Egypt'))
    expect(await screen.findByRole('combobox', { name: 'Governorate' })).toHaveValue('Giza')
    await user.click(country)
    await user.click(within(listOf(country)).getByRole('option', { name: /United Arab Emirates/ }))
    expect(seen.at(-1)).toEqual({ countryCode: 'AE', subdivisionCode: null })
    const emirate = await screen.findByRole('combobox', { name: 'Emirate' })
    expect(emirate).toHaveValue('')
  })

  it('hides the subdivision list for a country that has none', async () => {
    renderWithProviders(<Harness initial={{ countryCode: 'AT', subdivisionCode: null }} />)
    const country = await screen.findByRole('combobox', { name: 'Country' })
    await waitFor(() => expect(country).toHaveValue('🇦🇹 Austria'))
    expect(screen.queryByRole('combobox', { name: 'Region' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
  })

  it('country-only mode offers no subdivision at all', async () => {
    renderWithProviders(<Harness countryOnly initial={{ countryCode: 'EG', subdivisionCode: null }} />)
    const country = await screen.findByRole('combobox', { name: 'Country' })
    await waitFor(() => expect(country).toHaveValue('🇪🇬 Egypt'))
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(fetchMock.mock.calls.some(([u]) => /subdivisions/.test(String(u)))).toBe(false)
  })

  it('clearing the country clears both', async () => {
    const user = userEvent.setup()
    const seen: LocationValue[] = []
    renderWithProviders(<Harness initial={{ countryCode: 'EG', subdivisionCode: 'EG-C' }} onChange={(v) => seen.push(v)} />)
    const country = await screen.findByRole('combobox', { name: 'Country' })
    await waitFor(() => expect(country).toHaveValue('🇪🇬 Egypt'))
    await user.click(country.parentElement!.querySelector('.ss__clear')!)
    expect(seen.at(-1)).toEqual({ countryCode: null, subdivisionCode: null })
  })

  it('shows a stored code that is not a country of the list as such, so staff can replace it', async () => {
    renderWithProviders(<Harness initial={{ countryCode: 'UK', subdivisionCode: null }} />)
    const country = await screen.findByRole('combobox', { name: 'Country' })
    await waitFor(() => expect(country.getAttribute('value')).toMatch(/UK/))
    expect((country as HTMLInputElement).value).toContain('not in the list')
  })

  it('honours an explicit aria-label when its visible labels are hidden (a table cell)', async () => {
    renderWithProviders(<Harness countryOnly hideLabels ariaLabel="Country: Family Alpha" />)
    expect(await screen.findByRole('combobox', { name: 'Country: Family Alpha' })).toBeInTheDocument()
  })
})

describe('LocationPicker (Arabic, right to left)', () => {
  it('reads and sorts in Arabic, and labels the second list for the country', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness initial={{ countryCode: 'EG', subdivisionCode: null }} />, { locale: 'ar' })
    const country = await screen.findByRole('combobox', { name: 'الدولة' })
    await waitFor(() => expect(country).toHaveValue('🇪🇬 مصر'))
    const governorate = await screen.findByRole('combobox', { name: 'المحافظة' })
    await waitFor(() => expect(governorate).toBeEnabled())
    await user.click(governorate)
    await listed(governorate, 3)
    expect(labels(governorate)).toEqual(['الإسكندرية', 'الجيزة', 'القاهرة'])
    await user.keyboard('جيزه')
    expect(labels(governorate)).toEqual(['الجيزة'])
    await user.click(country)
    await listed(country, 6)
    // Pinned first, the rest A-Z in Arabic.
    expect(labels(country).slice(0, 3)).toEqual(['🇪🇬 مصر', '🇸🇦 المملكة العربية السعودية', '🇦🇪 الإمارات العربية المتحدة'])
    expect(labels(country).slice(3)).toEqual(['🇦🇹 النمسا', '🇺🇸 الولايات المتحدة', '🇫🇷 فرنسا'])
  })
})

describe('LocationText', () => {
  it('writes "Egypt · Giza" / "مصر · الجيزة", the country alone, or a dash', async () => {
    const { unmount } = renderWithProviders(
      <>
        <p data-testid="a"><LocationText value={{ countryCode: 'EG', subdivisionCode: 'EG-GZ' }} /></p>
        <p data-testid="b"><LocationText value={{ countryCode: 'AT', subdivisionCode: null }} /></p>
        <p data-testid="c"><LocationText value={EMPTY} /></p>
      </>,
    )
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('Egypt · Giza'))
    expect(screen.getByTestId('b')).toHaveTextContent('Austria')
    expect(screen.getByTestId('c')).toHaveTextContent('—')
    unmount()
    renderWithProviders(<p data-testid="a"><LocationText value={{ countryCode: 'EG', subdivisionCode: 'EG-GZ' }} /></p>, { locale: 'ar' })
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('مصر · الجيزة'))
  })
})
