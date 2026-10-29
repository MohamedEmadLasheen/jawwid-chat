import { NavLink } from 'react-router-dom'
import { useSession } from '@/core/auth/SessionProvider'
import { holdsAny } from '@/core/permissions/capabilities'
import { SA, useCopy, type Pair } from './copy'
import './staff-accounts.css'

/**
 * PD-40 PR-5 (plan §8: "a new tab on the existing Accounts page"): the
 * Accounts area's tabs. Staff accounts and Roles are tabs of the page every
 * staff role already has at /accounts, so the navigation is unchanged; each
 * tab is offered only for the permission keys GET /me reports. UX only: every
 * request behind them is decided by the server.
 */
export const STAFF_ACCOUNT_KEYS = ['staff_accounts.view'] as const
export const ROLE_PAGE_KEYS = ['staff_accounts.view', 'access_roles.manage'] as const

interface AccountsTab {
  key: string
  path: string
  label: Pair
  keys: readonly string[] | null
}

const TABS: AccountsTab[] = [
  { key: 'accounts', path: '/accounts', label: SA.tabAccounts, keys: null },
  { key: 'staff', path: '/accounts/staff', label: SA.tabStaff, keys: STAFF_ACCOUNT_KEYS },
  { key: 'roles', path: '/accounts/roles', label: SA.tabRoles, keys: ROLE_PAGE_KEYS },
]

/** Links, not buttons: every tab is a real URL. One tab needs no strip. */
export function AccountsTabs() {
  const tx = useCopy()
  const { staff } = useSession()
  const tabs = TABS.filter((t) => t.keys === null || holdsAny(staff, t.keys))
  if (tabs.length < 2) return null
  return (
    <nav className="sa-tabs" aria-label={tx(SA.tabsLabel)}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.path}
          end
          className={({ isActive }) => `sa-tab${isActive ? ' sa-tab--active' : ''}`}
        >
          {tx(tab.label)}
        </NavLink>
      ))}
    </nav>
  )
}
