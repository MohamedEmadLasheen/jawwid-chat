import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { tokenStore } from '@/core/auth/tokens'
import { makeStaff, renderWithProviders } from '@/test/utils'
import { FamilyHistorySection } from './FamilyHistorySection'

/**
 * The family history in a line of mixed scripts: a Latin name inside the Arabic
 * line (and the reverse) is its own isolated run, the dots sit in the line's own
 * flow after the word before them, and "from, then to" follows the reading
 * direction. What the history holds is proven in OpsSide.test.tsx.
 * Synthetic people only.
 */

const ENTRIES = [
  { id: 'audit:1', action: 'learner.supervisor_assigned', at: '2026-10-21T09:00:00Z', actor: { id: 'm-1', name: 'Manager One' },
    subject: { kind: 'learner', id: 'k-1', name: 'Child One' }, details: { supervisor: { id: 'sup-1', name: 'Supervisor One' } }, reason: null },
  { id: 'audit:2', action: 'family.sales_owner_changed', at: '2026-10-22T09:00:00Z', actor: { id: 'sm-1', name: 'Sales Manager' },
    subject: { kind: 'family', id: 'f-1', name: 'Parent Alpha' }, details: { from: { id: 's-1', name: 'Sales One' }, to: { id: 's-2', name: 'Sales Two' } }, reason: 'takes the renewals' },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ familyId: 'f-1', entries: ENTRIES }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  tokenStore.clear()
})

const runs = (li: HTMLElement) => [...li.querySelectorAll('bdi')].map((b) => b.textContent)
/** The line as it is read, with the no-break spaces that hold a dot to the word before it. */
const firstLine = (li: HTMLElement) => li.textContent!.split('Manager One')[0]

describe('the family history, in Arabic with Latin names', () => {
  it('isolates every name, and keeps each dot after the word before it', async () => {
    renderWithProviders(<FamilyHistorySection familyId="f-1" />, { staff: makeStaff(), locale: 'ar' })
    const items = within(await screen.findByRole('region', { name: 'سجل الأسرة' })).getAllByRole('listitem')
    expect(runs(items[0]!)).toEqual(['Child One', 'Supervisor One', 'Manager One'])
    // The act, then each name: never run together, and the dot is glued to what precedes it.
    expect(firstLine(items[0]!)).toBe('أسند طفلًا إلى مشرف · Child One · Supervisor One')
    expect(items[0]).toHaveTextContent('أسند طفلًا إلى مشرف · Child One · Supervisor One')
    expect(items[0]!.querySelector('time')).toHaveAttribute('dateTime', '2026-10-21T09:00:00Z')
  })

  it('points "from, then to" the way the line is read', async () => {
    renderWithProviders(<FamilyHistorySection familyId="f-1" />, { staff: makeStaff(), locale: 'ar' })
    const items = within(await screen.findByRole('region', { name: 'سجل الأسرة' })).getAllByRole('listitem')
    expect(items[1]).toHaveTextContent('غيّر مسؤول المبيعات · Sales One ← Sales Two')
    expect(runs(items[1]!)).toEqual(['Sales One', 'Sales Two', 'Sales Manager', 'takes the renewals'])
  })

  it('and in English the same line reads left to right', async () => {
    renderWithProviders(<FamilyHistorySection familyId="f-1" />, { staff: makeStaff(), locale: 'en' })
    const items = within(await screen.findByRole('region', { name: 'Family history' })).getAllByRole('listitem')
    expect(items[1]).toHaveTextContent('Changed the Sales owner · Sales One → Sales Two')
  })
})
