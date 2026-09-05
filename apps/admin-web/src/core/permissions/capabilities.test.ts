import { describe, expect, it } from 'vitest'
import {
  canOpenArea,
  isDepartment,
  isManager,
  isOperator,
  managerOnly,
  taskScopeFor,
  visibleAreas,
} from './capabilities'
import { ROLES } from '@/test/utils'

/**
 * These assert the NAVIGATION contract only. They are not security tests —
 * AI #5's matrix requires every DENY to be proven against the API, because a
 * hidden button is not a control.
 */
describe('role → navigation', () => {
  it('has no super_admin role', () => {
    expect(ROLES).not.toContain('super_admin')
  })

  it('gives only the manager coverage, dashboard and settings', () => {
    for (const role of ROLES) {
      const areas = visibleAreas(role)
      if (role === 'manager') {
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

  it('restricts every manager-only action to the manager', () => {
    for (const role of ROLES) {
      const expected = role === 'manager'
      expect(isManager(role)).toBe(expected)
      for (const [, check] of Object.entries(managerOnly)) {
        expect(check(role)).toBe(expected)
      }
    }
  })

  it('requests the task scope that matches the role', () => {
    expect(taskScopeFor('admin')).toBe('mine')
    expect(taskScopeFor('coverage')).toBe('mine')
    expect(taskScopeFor('manager')).toBe('team')
    expect(taskScopeFor('finance')).toBe('department')
  })
})
