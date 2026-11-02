import { describe, expect, it } from 'vitest'
import { notTaught, statusOf } from './copy'

/** CHATSCHED-014: a cancelled or excused lesson says so in the grid, never "Active". */
describe('statusOf', () => {
  it('a lesson nobody teaches shows its outcome; a booked or held one its calendar status', () => {
    expect(statusOf({ status: 'active', outcome: 'admin_cancelled' }).en).toBe('Cancelled')
    expect(statusOf({ status: 'active', outcome: 'student_apology' }).en).toBe('Student apologised')
    expect(statusOf({ status: 'active', outcome: 'teacher_apology' }).ar).toBe('اعتذر المعلم')
    expect(statusOf({ status: 'active', outcome: 'teacher_no_show' }).en).toBe('Teacher absent')
    expect(statusOf({ status: 'active', outcome: null }).en).toBe('Active')
    expect(statusOf({ status: 'active', outcome: 'held' }).en).toBe('Active')
    expect(statusOf({ status: 'trial', outcome: null }).en).toBe('Trial')
  })

  it('another supervisor’s child (anonymous) keeps its status: no outcome is told', () => {
    expect(statusOf({ status: 'active', anonymous: true }).en).toBe('Active')
    expect(notTaught({ anonymous: true })).toBe(false)
    expect(notTaught({ outcome: 'admin_cancelled' })).toBe(true)
  })
})
