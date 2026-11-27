/**
 * When a teacher's month asks for a person's attention.
 *
 * These are the owner's product decision and have NOT been set yet. The
 * defaults below are the builder's, chosen so a typical month flags a few
 * teachers rather than most of them; change them here and nowhere else (the
 * list, its figures, the side sheet and the line under the list all read this).
 *
 * - `lateReportsUrgent` 3: a teacher gives about three lessons a day, so three
 *   lessons without a report is roughly a day's teaching left unrecorded;
 *   one or two is ordinary lag that clears itself.
 * - `attendanceWatch` 0.85: students normally attend nine lessons in ten;
 *   below 85% more than one lesson in seven is lost to a student's absence,
 *   which is worth a look at the families, not an emergency.
 * - `onTimeWatch` 0.8: fewer than four reports in five written within a day
 *   is a habit forming, not one bad week.
 *
 * Any teacher no-show this month is urgent whatever these say.
 */
export const TEACHER_ATTENTION_THRESHOLDS = {
  /** Lessons with no report, at or above which the teacher is urgent. */
  lateReportsUrgent: 3,
  /** Student attendance (0..1) below which the teacher is watched. */
  attendanceWatch: 0.85,
  /** Share of reports written within 24 h (0..1) below which the teacher is watched. */
  onTimeWatch: 0.8,
} as const

export type TeacherAttentionThresholds = {
  lateReportsUrgent: number
  attendanceWatch: number
  onTimeWatch: number
}
