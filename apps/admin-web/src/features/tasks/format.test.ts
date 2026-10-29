import { describe, expect, it } from 'vitest'
import type { Pair } from '@/features/organization/copy'
import type { SourceType } from './api'
import { SOURCE_LABEL, SOURCE_TITLE } from './copy'
import { sourceLink, titleOf } from './format'

const en = (pair: Pair, params: Record<string, string | number> = {}) =>
  pair.en.replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k] ?? `{${k}}`))
const fmt = { locale: 'en', dateTime: (iso: string) => `at ${iso}`, date: (iso: string) => iso.slice(0, 10) }
const task = (type: SourceType, id: string, titleParams: Record<string, unknown>) => ({
  title: '',
  source: { type, id },
  titleParams,
})

describe('PD-47 PR-6a: the set-up sources', () => {
  it('say what is waiting, from their source now, and lead to where it is done', () => {
    expect(titleOf(task('family_unsupervised', 'f1', { familyName: 'family_x', count: 2 }), en, fmt))
      .toBe('Choose an Operations supervisor: family_x, 2 waiting')
    expect(titleOf(task('teacher_setup', 't1', { teacherName: 'teacher_c', count: 7 }), en, fmt))
      .toBe('Finish setting up teacher_c: 7 left')
    expect(titleOf(task('new_student_assign', 'l1', { prospectName: 'prospect_p', startsAt: '2026-10-29T10:00:00Z' }), en, fmt))
      .toBe('Assign the new family: prospect_p, trial at 2026-10-29T10:00:00Z')
    expect(titleOf(task('new_student_group', 'e1', { familyName: 'family_y' }), en, fmt)).toBe('Open the family group: family_y')

    expect(sourceLink(task('teacher_setup', 't1', {}))).toBe('/teachers/files/t1')
    for (const type of ['family_unsupervised', 'new_student_assign', 'new_student_group'] as const) {
      expect(sourceLink(task(type, 'x', {}))).toBe('/trials/new-students')
    }
  })

  it('every one has its label and title in both languages, with no placeholder left unfilled', () => {
    for (const type of ['family_unsupervised', 'teacher_setup', 'new_student_assign', 'new_student_group'] as const) {
      expect(SOURCE_LABEL[type].en && SOURCE_LABEL[type].ar).toBeTruthy()
      expect(SOURCE_TITLE[type].en && SOURCE_TITLE[type].ar).toBeTruthy()
      expect(SOURCE_TITLE[type].ar.match(/\{\w+\}/g)?.sort()).toEqual(SOURCE_TITLE[type].en.match(/\{\w+\}/g)?.sort())
    }
  })
})

describe('PD-47 PR-6b: work handed between people', () => {
  it('a teacher without a supervisor names the teacher and leads to their file, not to the spell', () => {
    const t = task('teacher_unsupervised', 'spell1', { teacherName: 'teacher_u', teacherId: 't9' })
    expect(titleOf(t, en, fmt)).toBe('Choose a supervisor for teacher_u')
    expect(sourceLink(t)).toBe('/teachers/files/t9')
    expect(sourceLink(task('teacher_unsupervised', 'spell1', {}))).toBeNull()
  })

  it('every one has its label and title in both languages, with no placeholder left unfilled', () => {
    for (const type of ['teacher_unsupervised'] as const) {
      expect(SOURCE_LABEL[type].en && SOURCE_LABEL[type].ar).toBeTruthy()
      expect(SOURCE_TITLE[type].ar.match(/\{\w+\}/g)?.sort()).toEqual(SOURCE_TITLE[type].en.match(/\{\w+\}/g)?.sort())
    }
  })
})
