import { describe, expect, it } from 'vitest'
import {
  canOpenArea,
  isDepartment,
  isManager,
  isSuperAdmin,
  isOperator,
  managerOnly,
  navAreas,
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
  // PD-5 (closed 2026-09-07) replaced the old "has no super_admin role"
  // assertion, which the product boundary recorded as known wrong.
  it('has a super_admin role, and it is nobody else', () => {
    expect(ROLES).toContain('super_admin')
    for (const role of ROLES) expect(isSuperAdmin(role)).toBe(role === 'super_admin')
  })

  it('gives the super admin every area, so no existing screen is hidden from it', () => {
    expect(visibleAreas('super_admin')).toEqual(
      expect.arrayContaining(['tasks', 'dashboard', 'stories', 'settings']),
    )
  })

  it('gives only the manager and the super admin dashboard and settings', () => {
    for (const role of ROLES) {
      const areas = visibleAreas(role)
      // The Coverage page is retired (PD-8 backups and PD-33 covers replaced it).
      expect(areas).not.toContain('coverage')
      if (role === 'manager' || role === 'super_admin') {
        expect(areas).toEqual(
          expect.arrayContaining(['dashboard', 'settings']),
        )
      } else {
        expect(areas).not.toContain('dashboard')
        expect(areas).not.toContain('settings')
      }
    }
  })

  it('gives departments tasks and, PD-21, account administration -- nothing else', () => {
    for (const role of ['finance', 'technical', 'academic'] as const) {
      expect(isDepartment(role)).toBe(true)
      expect(visibleAreas(role)).toEqual(['tasks', 'accounts'])
      // Departments must never reach a family record (AI #5 matrix §1).
      expect(canOpenArea(role, 'chat')).toBe(false)
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

  it('requests the task scope that matches the role', () => {
    expect(taskScopeFor('admin')).toBe('mine')
    expect(taskScopeFor('coverage')).toBe('mine')
    expect(taskScopeFor('manager')).toBe('team')
    expect(taskScopeFor('finance')).toBe('department')
    expect(taskScopeFor('super_admin')).toBe('team')
  })
})

describe('navigation lists what a role may open', () => {
  it('operators and managers are offered Chat exactly once, and no navigation list repeats an entry', () => {
    for (const role of ROLES) {
      const areas = navAreas(role)
      expect(new Set(areas).size).toBe(areas.length)
      if (isManager(role) || isOperator(role)) expect(areas.filter((a) => a === 'chat')).toHaveLength(1)
    }
  })

  it('nothing else is hidden: navigation is the openable areas minus Teacher statistics, Instalments, Parents, Payments, Materials and the Schedule until the server confirms the department', () => {
    const money = (a: string) => a === 'instalments' || a === 'parents' || a === 'payments'
    for (const role of ROLES) {
      expect(navAreas(role)).toEqual(
        visibleAreas(role).filter((a) => a !== 'teachers' && a !== 'trials' && a !== 'materials' && a !== 'schedule' && !money(a)),
      )
      expect(navAreas(role, { lessonManager: true })).toEqual(visibleAreas(role).filter((a) => a !== 'materials' && a !== 'schedule' && !money(a)))
      expect(navAreas(role, { lessonManager: true, billingReader: true })).toEqual(visibleAreas(role).filter((a) => a !== 'materials' && a !== 'schedule'))
      expect(navAreas(role, { lessonManager: true, billingReader: true, materialsManager: true })).toEqual(visibleAreas(role).filter((a) => a !== 'schedule'))
      // PD-38: the Schedule on GET /lessons/access's `calendar`.
      expect(navAreas(role, { lessonManager: true, billingReader: true, materialsManager: true, calendar: true })).toEqual(visibleAreas(role))
    }
  })

  it('PD-29: Materials is offered to the super admin and a manager the server confirms -- never to an operator or a department', () => {
    expect(visibleAreas('super_admin')).toContain('materials')
    expect(navAreas('manager', { materialsManager: true })).toContain('materials')
    expect(navAreas('manager')).not.toContain('materials')
    for (const role of ['admin', 'coverage', 'finance', 'technical', 'academic'] as const) {
      expect(navAreas(role, { materialsManager: true })).not.toContain('materials')
    }
  })

  it('PD-11 T4: Trials is offered to Sales, Operations or the Teachers department -- and Teachers to none but the last', () => {
    for (const role of ['admin', 'manager'] as const) {
      for (const opts of [{ sales: true }, { operations: true }]) {
        expect(navAreas(role, opts)).toContain('trials')
        expect(navAreas(role, opts)).not.toContain('teachers')
      }
    }
    expect(navAreas('finance', { sales: true })).not.toContain('trials')
  })
})
