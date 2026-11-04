import { describe, expect, it } from 'vitest'
import { supervisionRedirect } from './TeacherSupervisionPage'

/**
 * PD-52 (review of #377): every old Teacher Supervision link (PD-26) lands on
 * one of the two new pages, the query kept. Parent feedback goes by its
 * category, and a link with no category -- the PD-44 Dashboard's and the
 * PD-47 task's -- lands on Complaints with its status filter intact.
 */
const to = (basePath: string, query: string) => supervisionRedirect(basePath, new URLSearchParams(query))

describe('supervisionRedirect', () => {
  it.each([
    ['section=feedback', '/teacher-attendance?section=complaints'],
    ['section=feedback&status=received', '/teacher-attendance?section=complaints&status=received'],
    ['section=feedback&status=in_review&teacher=t-1', '/teacher-attendance?section=complaints&status=in_review&teacher=t-1'],
    ['section=feedback&category=complaint', '/teacher-attendance?section=complaints'],
    ['section=feedback&category=praise&teacher=t-1', '/teacher-grants?section=testimonials&teacher=t-1'],
    ['section=feedback&category=suggestion', '/teacher-attendance?section=complaints&view=suggestions'],
    ['section=feedback&category=nonsense', '/teacher-attendance?section=complaints'],
    ['section=rewards', '/teacher-grants?section=grants'],
    ['section=absences', '/teacher-attendance?section=excuses'],
    ['section=lateness', '/teacher-attendance?section=lateness'],
    ['section=complaints', '/teacher-attendance?section=complaints'],
    ['', '/teacher-attendance?section=leave'],
    ['section=unknown', '/teacher-attendance?section=leave'],
  ])('/teachers/supervision?%s -> %s', (query, expected) => {
    expect(to('/teachers', query)).toBe(expected)
  })

  it('the super admin\'s links stay inside the Admin Portal', () => {
    expect(to('/admin/teachers', 'section=feedback&status=received')).toBe('/admin/teacher-attendance?section=complaints&status=received')
    expect(to('/admin/teachers', 'section=feedback&category=praise')).toBe('/admin/teacher-grants?section=testimonials')
  })
})
