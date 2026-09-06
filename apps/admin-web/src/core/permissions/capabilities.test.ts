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
  it('includes super_admin — PRD v0.1 §3 defines it', () => {
    // This assertion was previously inverted. The superseded brief had no
    // super_admin; the PRD does, and grants it "Everything, plus users, roles,
    // policies, templates, automations, integrations, audit logs".
    expect(ROLES).toContain('super_admin')
  })

  it('carries exactly the seven PRD roles', () => {
    expect([...ROLES].sort()).toEqual(
      [
        'admin',
        'coverage_admin',
        'manager',
        'parent',
        'student',
        'super_admin',
        'teacher',
      ].sort(),
    )
  })

  it('gives only the manager coverage, dashboard and settings', () => {
    for (const role of ROLES) {
      const areas = visibleAreas(role)
      if (isManager(role)) {
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
    // Department is now a separate concept from role (product decision X-1):
    // an operator role plus a department still gets only tasks.
    for (const department of ['finance', 'technical', 'academic'] as const) {
      expect(isDepartment(department)).toBe(true)
      expect(visibleAreas('admin', department)).toEqual(['tasks'])
      // Departments must never reach a family record (AI #5 matrix §1).
      expect(canOpenArea('admin', 'families', department)).toBe(false)
      expect(canOpenArea('admin', 'inbox', department)).toBe(false)
    }
    expect(isDepartment(null)).toBe(false)
    expect(isDepartment(undefined)).toBe(false)
  })

  it('gives admin and coverage_admin the same areas — coverage is a label, not a lesser role', () => {
    expect(visibleAreas('admin')).toEqual(visibleAreas('coverage_admin'))
    expect(isOperator('admin')).toBe(true)
    expect(isOperator('coverage_admin')).toBe(true)
  })

  it('restricts every manager-only action to the manager and super_admin', () => {
    for (const role of ROLES) {
      const expected = role === 'manager' || role === 'super_admin'
      expect(isManager(role)).toBe(expected)
      for (const [, check] of Object.entries(managerOnly)) {
        expect(check(role)).toBe(expected)
      }
    }
  })

  it('requests the task scope that matches the role', () => {
    expect(taskScopeFor('admin')).toBe('mine')
    expect(taskScopeFor('coverage_admin')).toBe('mine')
    expect(taskScopeFor('manager')).toBe('team')
    expect(taskScopeFor('super_admin')).toBe('team')
    expect(taskScopeFor('admin', 'finance')).toBe('department')
  })
})
