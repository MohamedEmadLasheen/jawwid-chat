import { describe, expect, it } from 'vitest'
import {
  humanDuration,
  overloadTone,
  severityTone,
  MODERATION_CATEGORIES,
  SEVERITIES,
} from '@/core/api/phase6'
import { canOpenArea, visibleAreas } from '@/core/permissions/capabilities'

/**
 * The Phase 6 console surfaces, at the level the console is actually
 * responsible for.
 *
 * The MEANING of every number and every decision is the server's, and is proved
 * against a real database in apps/api/test/integration/phase6-*.spec.ts. What
 * is genuinely this layer's to get right is: which roles reach which area, and
 * that nothing here conveys state by colour alone.
 */

describe('who reaches the Phase 6 areas', () => {
  it('every operator role reaches MODERATION', () => {
    // Mirrors `messages.moderate`: an admin decides approvals for their own
    // families, and the queue is scoped server-side to conversations they could
    // already read.
    for (const role of ['admin', 'coverage_admin', 'manager', 'super_admin'] as const) {
      expect(canOpenArea(role, 'moderation')).toBe(true)
    }
  })

  it('only management reaches the COMMAND CENTER', () => {
    // Every figure on it is an aggregate over the WHOLE organization, including
    // families an admin has no scope for. There is no honest way to narrow a
    // total to one supervisor's families.
    expect(canOpenArea('manager', 'command')).toBe(true)
    expect(canOpenArea('super_admin', 'command')).toBe(true)
    expect(canOpenArea('admin', 'command')).toBe(false)
    expect(canOpenArea('coverage_admin', 'command')).toBe(false)
  })

  it('a DEPARTMENTAL staff member reaches neither', () => {
    // Departments complete task work and take no part in family communication
    // (PD-5), so they hold no caseload to moderate and no operation to run.
    expect(visibleAreas('admin', 'finance')).toEqual([])
    expect(canOpenArea('admin', 'moderation', 'finance')).toBe(false)
    expect(canOpenArea('manager', 'command', 'academic')).toBe(false)
  })

  it('the rail gating grants nothing on its own', () => {
    // Route gating is navigation UX. Every query behind these pages is
    // authorized server-side, so this list is a convenience and not a boundary.
    expect(visibleAreas('admin')).toContain('moderation')
    expect(visibleAreas('admin')).not.toContain('command')
  })
})

describe('severity and overload never rely on colour alone', () => {
  it('maps onto the tones the console already uses -- no new visual language', () => {
    for (const s of SEVERITIES) {
      expect(['danger', 'today', 'ok', 'neutral']).toContain(severityTone(s))
    }
    for (const level of ['ok', 'warning', 'overloaded'] as const) {
      expect(['danger', 'today', 'ok', 'neutral']).toContain(overloadTone(level))
    }
  })

  it('collapses critical and high to one "act now" tone', () => {
    // An operator scanning a queue reads two levels of urgency, not four. The
    // exact word is rendered on the badge beside the colour.
    expect(severityTone('critical')).toBe('danger')
    expect(severityTone('high')).toBe('danger')
    expect(severityTone('medium')).toBe('today')
    expect(severityTone('low')).toBe('neutral')
    expect(severityTone(null)).toBe('neutral')
  })

  it('an overloaded supervisor is never merely a warning', () => {
    expect(overloadTone('overloaded')).toBe('danger')
    expect(overloadTone('warning')).toBe('today')
    expect(overloadTone('ok')).toBe('ok')
  })
})

describe('elapsed time is rendered in words', () => {
  it('never shows a raw millisecond count', () => {
    expect(humanDuration(30_000)).toBe('just now')
    expect(humanDuration(5 * 60_000)).toBe('5m')
    expect(humanDuration(90 * 60_000)).toBe('1h 30m')
    expect(humanDuration(26 * 3600_000)).toBe('1d 2h')
  })

  it('is stable at the boundaries rather than flickering', () => {
    expect(humanDuration(59_999)).toBe('just now')
    expect(humanDuration(60_000)).toBe('1m')
    expect(humanDuration(3600_000)).toBe('1h 0m')
  })
})

describe('the rule vocabulary mirrors the server', () => {
  it('lists every category the database CHECK accepts', () => {
    // If these drift, Rule Management offers a category the server refuses --
    // or silently hides one the academy configured.
    expect([...MODERATION_CATEGORIES].sort()).toEqual(
      [
        'cancellation', 'custom', 'email_address', 'forbidden_phrase',
        'forbidden_word', 'phone_number', 'resignation', 'url',
      ].sort(),
    )
  })

  it('lists the four severities, in order', () => {
    expect(SEVERITIES).toEqual(['low', 'medium', 'high', 'critical'])
  })
})
