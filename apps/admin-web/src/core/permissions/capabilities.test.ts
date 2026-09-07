import { describe, expect, it } from 'vitest'
import {
  canOpenArea,
  hasPermission,
  isDepartment,
  isManager,
  isOperator,
  isSuperAdmin,
  managerOnly,
  superAdminOnly,
  taskScopeFor,
  visibleAreas,
} from './capabilities'
import { DEPARTMENTS, ROLES } from '@/test/utils'

/**
 * These assert the NAVIGATION contract only. They are not security tests —
 * AI #5's matrix requires every DENY to be proven against the API, because a
 * hidden button is not a control.
 */
describe('role → navigation', () => {
  it('has a super_admin role, and no legacy `coverage` role', () => {
    // The previous version of this test asserted the opposite. It was KNOWN
    // WRONG: PD-5 (closed 2026-09-07) puts super_admin in the model from day
    // one, and renames `coverage` to `coverage_admin`.
    expect(ROLES).toContain('super_admin')
    expect(ROLES).not.toContain('coverage')
  })

  it('gives only management coverage, dashboard and settings', () => {
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

  it('gives departmental staff tasks and nothing else, whatever their role', () => {
    // A department is an ATTRIBUTE now: the same `admin` role is family-facing
    // without one and task-only with one.
    for (const department of DEPARTMENTS) {
      expect(isDepartment('admin', department)).toBe(true)
      expect(isOperator('admin', department)).toBe(false)
      expect(visibleAreas('admin', department)).toEqual(['tasks'])
      expect(canOpenArea('admin', 'families', department)).toBe(false)
      expect(canOpenArea('admin', 'inbox', department)).toBe(false)
    }
    // Even a super_admin carrying a department is not family-facing.
    expect(visibleAreas('super_admin', 'finance')).toEqual(['tasks'])
    expect(isManager('super_admin', 'finance')).toBe(false)
  })

  it('gives admin and coverage_admin the same areas — they differ only in scope', () => {
    expect(visibleAreas('admin')).toEqual(visibleAreas('coverage_admin'))
    expect(isOperator('admin')).toBe(true)
    expect(isOperator('coverage_admin')).toBe(true)
  })

  it('restricts every manager-only action to management', () => {
    for (const role of ROLES) {
      const expected = role === 'manager' || role === 'super_admin'
      expect(isManager(role)).toBe(expected)
      for (const [, check] of Object.entries(managerOnly)) {
        expect(check(role, null)).toBe(expected)
      }
    }
  })

  it('restricts user management to the super_admin alone', () => {
    for (const role of ROLES) {
      expect(superAdminOnly.manageUsers(role, null)).toBe(role === 'super_admin')
    }
    expect(isSuperAdmin('super_admin', 'finance')).toBe(false)
  })

  it('reads effective permissions from the server, so a per-person DENY is honoured', () => {
    // A role check cannot see an override. This is why anything added from
    // Phase 1 onwards asks about the permission key instead.
    expect(hasPermission(['messages.send', 'messages.read'], 'messages.send')).toBe(true)
    expect(hasPermission(['messages.read'], 'messages.send')).toBe(false)
    expect(hasPermission(undefined, 'messages.send')).toBe(false)
  })

  it('requests the task scope that matches the role', () => {
    expect(taskScopeFor('admin')).toBe('mine')
    expect(taskScopeFor('coverage_admin')).toBe('mine')
    expect(taskScopeFor('manager')).toBe('team')
    expect(taskScopeFor('admin', 'finance')).toBe('department')
  })
})
