/**
 * PD-43 (plan §3.5-§3.7, G8): what a teacher picker says beside a name -- the
 * Sales subscription form and Change teacher. Warnings only: every teacher
 * stays pickable (owner Q5, "students allowed"). Mirrored from
 * apps/api/src/platform/teacher-readiness.ts.
 */
export interface TeacherReadiness {
  setupIncomplete: boolean
  notSignedIn: boolean
  noSupervisor: boolean
  loginSuspended: boolean
}

const LABELS: Array<[keyof TeacherReadiness, { en: string; ar: string }]> = [
  ['setupIncomplete', { en: 'Setup incomplete', ar: 'التجهيز غير مكتمل' }],
  ['notSignedIn', { en: 'Not signed in yet', ar: 'لم يسجّل الدخول بعد' }],
  ['noSupervisor', { en: 'No supervisor', ar: 'بلا مشرف' }],
  ['loginSuspended', { en: 'Login suspended', ar: 'الدخول موقوف' }],
]

/** The notes, in a fixed order, joined with " · "; null when there is nothing to say (or an older server said nothing). */
export function readinessNote(r: TeacherReadiness | null | undefined, locale: 'ar' | 'en'): string | null {
  if (!r) return null
  const notes = LABELS.filter(([key]) => r[key]).map(([, label]) => (locale === 'ar' ? label.ar : label.en))
  return notes.length > 0 ? notes.join(' · ') : null
}
