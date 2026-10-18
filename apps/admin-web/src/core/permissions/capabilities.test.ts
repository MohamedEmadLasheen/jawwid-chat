import { describe, expect, it } from 'vitest'
import {
  canOpenArea,
  isDepartment,
  isManager,
  isSuperAdmin,
  isOperator,
  managerOnly,
  navAreas,
  ownershipActions,
  taskScopeFor,
  UNLISTED_AREAS,
  visibleAreas,
} from './capabilities'
import { ROLES } from '@/test/utils'

/**
 * These assert the NAVIGATION contract only. They are not security tests —
 * AI #5's matrix requires every DENY to be proven against the API, because a
 * hidden button is not a control.
 */
describe('role → navigation', () => {
  // PD-5 (closed 2026-09-07) replaced the old "has no super_admin role"
  // assertion, which the product boundary recorded as known wrong.
  it('has a super_admin role, and it is nobody else', () => {
    expect(ROLES).toContain('super_admin')
    for (const role of ROLES) expect(isSuperAdmin(role)).toBe(role === 'super_admin')
  })

  it('gives the super admin every area, so no existing screen is hidden from it', () => {
    expect(visibleAreas('super_admin')).toEqual(
      expect.arrayContaining(['inbox', 'families', 'tasks', 'coverage', 'dashboard', 'stories', 'settings']),
    )
  })

  it('gives only the manager and the super admin coverage, dashboard and settings', () => {
    for (const role of ROLES) {
      const areas = visibleAreas(role)
      if (role === 'manager' || role === 'super_admin') {
        expect(areas).toEqual(
          expect.arrayContaining(['coverage', 'dashboard', 'settings']),
        )
      } else {
        expect(areas).not.toContain('coverage')
        expect(areas).not.toContain('dashboard')
        expect(areas).not.toContain('settings')
      }
    }
  })

  it('gives departments tasks and nothing else', () => {
    for (const role of ['finance', 'technical', 'academic'] as const) {
      expect(isDepartment(role)).toBe(true)
      expect(visibleAreas(role)).toEqual(['tasks'])
      // Departments must never reach a family record (AI #5 matrix §1).
      expect(canOpenArea(role, 'families')).toBe(false)
      expect(canOpenArea(role, 'inbox')).toBe(false)
    }
  })

  it('gives admin and coverage the same areas — coverage is a label, not a lesser role', () => {
    expect(visibleAreas('admin')).toEqual(visibleAreas('coverage'))
    expect(isOperator('admin')).toBe(true)
    expect(isOperator('coverage')).toBe(true)
  })

  // super_admin is not a manager in the API either (it is read-only there), so
  // the UI must not offer it a manager's buttons.
  it('restricts every manager-only action to the manager', () => {
    for (const role of ROLES) {
      const expected = role === 'manager'
      expect(isManager(role)).toBe(expected)
      for (const [, check] of Object.entries(managerOnly)) {
        expect(check(role)).toBe(expected)
      }
    }
  })

  // The approved ownership policy: families.assign and moving families are the
  // manager's and the super admin's; deactivation (and so full offboarding) is
  // the super admin's alone.
  it('offers ownership and offboarding actions exactly per the approved policy', () => {
    for (const role of ROLES) {
      const assigner = role === 'manager' || role === 'super_admin'
      expect(ownershipActions.transferOwnership(role)).toBe(assigner)
      expect(ownershipActions.moveStaffFamilies(role)).toBe(assigner)
      expect(ownershipActions.deactivateStaff(role)).toBe(role === 'super_admin')
      expect(ownershipActions.offboardStaff(role)).toBe(role === 'super_admin')
    }
  })

  it('requests the task scope that matches the role', () => {
    expect(taskScopeFor('admin')).toBe('mine')
    expect(taskScopeFor('coverage')).toBe('mine')
    expect(taskScopeFor('manager')).toBe('team')
    expect(taskScopeFor('finance')).toBe('department')
    expect(taskScopeFor('super_admin')).toBe('team')
  })
})

describe('the legacy Inbox is routable but never offered', () => {
  // Its page calls /inbox and /families/*, which no API on any current branch
  // serves. Offering it would present a destination that cannot load.
  it('no role sees Inbox in navigation', () => {
    for (const role of ROLES) expect(navAreas(role)).not.toContain('inbox')
    expect(UNLISTED_AREAS.has('inbox')).toBe(true)
  })

  it('its route still opens for every role that could open it before (old links keep working)', () => {
    for (const role of ROLES) expect(canOpenArea(role, 'inbox')).toBe(visibleAreas(role).includes('inbox'))
    expect(canOpenArea('admin', 'inbox')).toBe(true)
  })

  it('operators and managers are offered Chat exactly once, and no navigation list repeats an entry', () => {
    for (const role of ROLES) {
      const areas = navAreas(role)
      expect(new Set(areas).size).toBe(areas.length)
      if (isManager(role) || isOperator(role)) expect(areas.filter((a) => a === 'chat')).toHaveLength(1)
    }
  })

  it('nothing else is hidden: navigation is the openable areas minus Inbox and the unconfirmed Teachers area', () => {
    for (const role of ROLES) {
      expect(navAreas(role)).toEqual(visibleAreas(role).filter((a) => a !== 'inbox' && a !== 'teachers'))
      // Once the server confirms Teacher Files for this person, it is offered.
      expect(navAreas(role, new Set(['teachers']))).toEqual(visibleAreas(role).filter((a) => a !== 'inbox'))
    }
  })

  it('PD-10: Teachers is openable by the roles a Teachers-department member can hold, and by no one else', () => {
    for (const role of ROLES) {
      expect({ role, open: visibleAreas(role).includes('teachers') }).toEqual({
        role,
        open: role === 'manager' || role === 'admin' || role === 'coverage',
      })
    }
  })
})
