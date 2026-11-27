import { useCallback } from 'react'
import { TS } from '../copy'
import type { Clause } from './priority'
import { LESSONS_AFTER, useCopy, useFormat } from './format'

/** A row's reason clauses as one sentence: "Missed 2 lessons without notice, excused from 3 lessons". */
export function useReason() {
  const tx = useCopy()
  const fmt = useFormat()
  return useCallback(
    (clauses: Clause[]): string => {
      const lessons = (n: number) => fmt.count(n, LESSONS_AFTER)
      const words = clauses.map((c) => {
        switch (c.key) {
          case 'noShow':
            return tx(TS.rNoShow, { lessons: lessons(c.n) })
          case 'lateRecent':
            return tx(TS.rLateRecent)
          case 'lateHabit':
            return tx(TS.rLateHabit)
          case 'lateNone':
            return tx(TS.rLateNone)
          case 'absences':
            return c.excused > 0
              ? tx(TS.rAbsences, { absent: lessons(c.absent), excused: lessons(c.excused) })
              : tx(TS.rAbsencesOnly, { absent: lessons(c.absent) })
          case 'absencesUnknown':
            return tx(TS.rAbsencesUnknown)
          case 'reportsLate':
            return tx(TS.rReportsLate)
          case 'teacherExcuses':
            return tx(TS.rTeacherExcuses, { lessons: lessons(c.n) })
          case 'noLessons':
            return tx(TS.rNoLessons)
        }
      })
      const sentence = words.join(fmt.locale === 'ar' ? '؛ ' : '; ')
      return fmt.locale === 'en' ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : sentence
    },
    [tx, fmt],
  )
}
