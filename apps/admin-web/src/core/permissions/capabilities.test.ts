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

  it('gives every family-facing role the console and the Phase 3 areas, and nothing frozen', () => {
    // Phase 2: the Communication Operations Console is THE operator surface.
    // The brief-era areas are frozen and unrouted — a role that could "open"
    // one would reach a page whose every query hits an endpoint the API does
    // not serve, which is a worse experience than not offering it.
    //
    // PHASE 3 adds three live areas (directory, groups, labels) on the
    // canonical contract. The exact-equality below was written when the console
    // was the only live area; it is widened to the live SET rather than
    // loosened, so a frozen area re-entering the rail still fails here — which
    // is the assertion that was actually load-bearing.
    //
    // PHASE 5 adds `stories` for every operator role, and `broadcast` for
    // management only — so the expected set is no longer the same for all
    // roles, and the loop below is split accordingly rather than relaxed into
    // a `toContain`.
    for (const role of ROLES) {
      const areas = visibleAreas(role)
      expect(areas).toEqual([
        'console',
        'directory',
        'groups',
        'labels',
        'stories',
        ...(isManager(role) ? ['broadcast'] : []),
      ])
      for (const frozen of ['inbox', 'families', 'tasks', 'coverage', 'dashboard', 'settings'] as const) {
        expect(areas).not.toContain(frozen)
      }
    }
  })

  it('keeps BROADCAST out of a supervisor’s rail, and says why that is not a control', () => {
    // The rail mirrors `broadcasts.send`, which manager and super_admin hold.
    // It is NAVIGATION, not authorization: an admin granted the permission by a
    // per-account override reaches /broadcasts by URL and the server serves
    // them, narrowed to their own families by the audience resolver. What the
    // rail must never do is offer the page to somebody the server will refuse.
    expect(canOpenArea('admin', 'broadcast')).toBe(false)
    expect(canOpenArea('coverage_admin', 'broadcast')).toBe(false)
    expect(canOpenArea('manager', 'broadcast')).toBe(true)
    expect(canOpenArea('super_admin', 'broadcast')).toBe(true)
  })

  it('gives every operator role STORIES, including one that cannot publish', () => {
    // coverage_admin holds `stories.read` and not `stories.publish`. They still
    // get the page: seeing what the academy published to their families is a
    // legitimate reason to open it, and the compose form is what the permission
    // hides — not the whole area.
    for (const role of ROLES) {
      expect(canOpenArea(role, 'stories')).toBe(true)
    }
  })

  it('gives departmental staff NO communication surface, whatever their role', () => {
    // A department is an ATTRIBUTE: the same `admin` role is family-facing
    // without one and not family-facing with one (PD-5). The task console that
    // used to serve them is frozen, so they get nothing rather than a
    // communication console they may not operate.
    for (const department of DEPARTMENTS) {
      expect(isDepartment('admin', department)).toBe(true)
      expect(isOperator('admin', department)).toBe(false)
      expect(visibleAreas('admin', department)).toEqual([])
      expect(canOpenArea('admin', 'console', department)).toBe(false)
    }
    // Even a super_admin carrying a department is not family-facing.
    expect(visibleAreas('super_admin', 'finance')).toEqual([])
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
