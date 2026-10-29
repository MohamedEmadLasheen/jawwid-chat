import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '@/core/i18n/I18nProvider'
import { SessionProvider } from '@/core/auth/SessionProvider'
import { qk } from '@/core/api/queryKeys'
import type { Locale } from '@/core/i18n/messages'
import type { Staff, StaffRole } from '@/shared/types/domain'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
}

export function renderWithProviders(
  ui: ReactElement,
  { locale = 'en' as Locale, route = '/', staff }: {
    locale?: Locale
    route?: string
    /** Seeds the session cache so role-gated UI can be exercised. */
    staff?: Staff
  } = {},
) {
  const queryClient = createTestQueryClient()
  if (staff) queryClient.setQueryData(qk.me, staff)

  const Inner = ({ children }: { children: ReactNode }) =>
    staff ? <SessionProvider>{children}</SessionProvider> : <>{children}</>

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider initialLocale={locale}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[route]}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <Inner>{children}</Inner>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>
  )
  return { queryClient, ...render(ui, { wrapper: Wrapper }) }
}

/*
 * Fixtures use synthetic staff only.
 *
 * AI #5 (docs/qa/system-inventory.md §4, gate G-16) forbids the real employee
 * names from the brief appearing in seed data, fixtures or assertions — they
 * are real people, and their names plus shift patterns are personal data.
 */
export function makeStaff(overrides: Partial<Staff> = {}): Staff {
  return {
    id: 'staff_a',
    name: 'Admin A',
    role: 'admin',
    presence: 'online',
    is_active: true,
    ...overrides,
  }
}

export const ROLES: StaffRole[] = [
  'admin',
  'coverage',
  'manager',
  'finance',
  'technical',
  'academic',
  'super_admin',
  'system',
]
