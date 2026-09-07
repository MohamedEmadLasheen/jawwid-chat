import type { ReactElement, ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '@/core/i18n/I18nProvider'
import { SessionProvider } from '@/core/auth/SessionProvider'
import { qk } from '@/core/api/queryKeys'
import type { Me } from '@/core/api/endpoints'
import type { Locale } from '@/core/i18n/messages'
import type {
  Case,
  Contact,
  FamilyCapabilities,
  FamilyDetail,
  InboxRow,
  Message,
  Staff,
  StaffRole,
} from '@/shared/types/domain'

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
  // `/me` returns an ACTOR, not a Staff row: since Phase 1 the server answers
  // "who is this" with a kind, a role, a department and an effective permission
  // set, and SessionProvider converts that into the Staff shape the pages use.
  // Seeding the cache with the wire shape is what keeps this harness honest.
  if (staff) queryClient.setQueryData(qk.me, toMe(staff))

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
/** The `/me` payload for a staff fixture, as the API would return it. */
export function toMe(staff: Staff): Me {
  return {
    actorId: staff.id,
    kind: 'staff',
    displayName: staff.name,
    locale: 'ar',
    organizationId: 'org_jawwid',
    staffRole: staff.role,
    department: staff.department ?? null,
    familyId: null,
    canMessage: null,
    permissions: [],
  }
}

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

export function makeCapabilities(overrides: Partial<FamilyCapabilities> = {}): FamilyCapabilities {
  return {
    can_send_customer_message: true,
    can_reply_as_assist: false,
    assist_blocked_reason: null,
    can_close_owner_locked: true,
    can_transfer_ownership: false,
    can_create_task: true,
    can_escalate: true,
    ...overrides,
  }
}

export function makeInboxRow(overrides: Partial<InboxRow> = {}): InboxRow {
  return {
    family_id: 'fam_1',
    display_name: 'Family One',
    bucket: 'now',
    top_reason: 'class started 5 minutes ago',
    waiting_since: new Date(Date.now() - 12 * 60_000).toISOString(),
    needs_reply: true,
    tier: 'standard',
    state: 'active',
    owner_id: 'staff_a',
    on_duty_id: 'staff_a',
    handling_mode: 'owner',
    open_case_count: 0,
    response_target: null,
    ...overrides,
  }
}

export function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg_1',
    case_id: null,
    author_type: 'contact',
    author_id: 'contact_1',
    author_name: 'Parent',
    on_behalf_mode: null,
    body: 'Hello',
    attachments: [],
    visibility: 'customer',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

export function makeCase(overrides: Partial<Case> = {}): Case {
  return {
    id: 'case_1',
    family_id: 'fam_1',
    learner_id: null,
    type: 'general',
    severity: null,
    is_blocking: false,
    status: 'open',
    handler_id: 'staff_a',
    owner_locked: false,
    due_at: null,
    follow_up_reason: null,
    escalation_level: 0,
    escalated_to_id: null,
    resolved_at: null,
    reopen_count: 0,
    ...overrides,
  }
}

export function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact_1',
    name: 'Guardian A',
    relationship: 'mother',
    role_preset: 'primary_guardian',
    can_message: true,
    can_view_progress: true,
    can_manage_schedule: true,
    can_manage_billing: true,
    can_manage_contacts: true,
    can_cancel: true,
    is_active: true,
    ...overrides,
  }
}

export function makeFamilyDetail(overrides: Partial<FamilyDetail> = {}): FamilyDetail {
  return {
    family: {
      id: 'fam_1',
      display_name: 'Family One',
      tier: 'standard',
      tier_reason: null,
      state: 'active',
      state_reason: null,
      state_changed_at: null,
      language: 'ar',
      manual_flag: null,
      manual_flag_reason: null,
    },
    owner: { id: 'staff_a', name: 'Admin A' },
    on_duty: { id: 'staff_a', name: 'Admin A', mode: 'owner' },
    contacts: [makeContact()],
    learners: [],
    subscription: null,
    pinned_notes: [],
    recent_cases: [],
    open_tasks: [],
    capabilities: makeCapabilities(),
    ...overrides,
  }
}

/**
 * The canonical staff roles (PD-5). `coverage` was renamed `coverage_admin`,
 * `super_admin` exists from day one, and finance/technical/academic are
 * DEPARTMENTS rather than roles -- see DEPARTMENTS below.
 */
export const ROLES: StaffRole[] = [
  'super_admin',
  'manager',
  'admin',
  'coverage_admin',
  'system',
]

export const DEPARTMENTS = ['finance', 'technical', 'academic'] as const
