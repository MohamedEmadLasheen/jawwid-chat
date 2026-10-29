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

  it('a trial\'s two steps name the prospect only, and lead to the trials', () => {
    const at = '2026-10-29T10:00:00Z'
    expect(titleOf(task('trial_attendance', 'l1', { prospectName: 'prospect_p', startsAt: at }), en, fmt))
      .toBe('Record attendance: prospect_p, trial at 2026-10-29T10:00:00Z')
    expect(titleOf(task('trial_outcome', 'l1', { prospectName: 'prospect_p', startsAt: at }), en, fmt))
      .toBe('Record the trial outcome: prospect_p, trial at 2026-10-29T10:00:00Z')
    expect(sourceLink(task('trial_attendance', 'l1', {}))).toBe('/trials')
    expect(sourceLink(task('trial_outcome', 'l1', {}))).toBe('/trials')
  })

  it('a certificate step names the printed name and opens its certificate, not the event', () => {
    const t = task('certificate_review', 'event1', { printedName: 'learner_l', certificateId: 'c7' })
    expect(titleOf(t, en, fmt)).toBe('Review the certificate design: learner_l')
    expect(sourceLink(t)).toBe('/certificates?id=c7')
    expect(sourceLink(task('certificate_send', 'event1', {}))).toBe('/certificates')
  })

  it('every one has its label and title in both languages, with no placeholder left unfilled', () => {
    for (const type of ['teacher_unsupervised', 'trial_attendance', 'trial_outcome', 'certificate_accept', 'certificate_design',
      'certificate_resubmit', 'certificate_review', 'certificate_send'] as const) {
      expect(SOURCE_LABEL[type].en && SOURCE_LABEL[type].ar).toBeTruthy()
      expect(SOURCE_TITLE[type].ar.match(/\{\w+\}/g)?.sort()).toEqual(SOURCE_TITLE[type].en.match(/\{\w+\}/g)?.sort())
    }
  })
})

describe('PD-47 PR-6c: the Teachers department\'s decisions', () => {
  it('a complaint names the teacher only, and leads to the complaints', () => {
    const t = task('complaint', 'e1', { teacherName: 'teacher_c', teacherId: 't1' })
    expect(titleOf(t, en, fmt)).toBe('Resolve a complaint about teacher_c')
    expect(sourceLink(t)).toBe('/teachers/supervision?section=complaints')
  })

  it('a parent\'s feedback names the teacher and the child, never what was written', () => {
    const t = task('feedback', 'f1', { teacherName: 'teacher_c', learnerName: 'learner_l', category: 'praise' })
    expect(titleOf(t, en, fmt)).toBe('Answer a parent about teacher_c: learner_l')
    expect(sourceLink(t)).toBe('/teachers/supervision?section=feedback')
  })

  it('a schedule request names the child and leads to Needs action', () => {
    const t = task('schedule_change', 'q1', { learnerName: 'learner_l', learnerId: 'l1' })
    expect(titleOf(t, en, fmt)).toBe('Decide on new lesson times: learner_l')
    expect(sourceLink(t)).toBe('/teachers/needs-action')
  })

  it('a make-up owed names the child and the lesson\'s time', () => {
    const t = task('makeup_owed', 'l1', { learnerName: 'learner_l', startsAt: '2026-10-29T10:00:00Z', lessonId: 'l1' })
    expect(titleOf(t, en, fmt)).toBe('Make sure a lesson is made up: learner_l, at 2026-10-29T10:00:00Z')
    expect(sourceLink(t)).toBe('/teachers/needs-action')
  })

  it('every one has its label and title in both languages, with no placeholder left unfilled', () => {
    for (const type of ['complaint', 'feedback', 'schedule_change', 'makeup_owed'] as const) {
      expect(SOURCE_LABEL[type].en && SOURCE_LABEL[type].ar).toBeTruthy()
      expect(SOURCE_TITLE[type].ar.match(/\{\w+\}/g)?.sort()).toEqual(SOURCE_TITLE[type].en.match(/\{\w+\}/g)?.sort())
    }
  })
})
