/**
 * PD-52: where the two teacher-records pages live. Operators reach them as
 * top-level pages; the super admin from the Admin Portal (`/admin/...`). A
 * `basePath` under `/admin` is the super admin's.
 */
export const ATTENDANCE_PATH = '/teacher-attendance'
export const GRANTS_PATH = '/teacher-grants'

export function attendancePath(basePath: string): string {
  return basePath.startsWith('/admin') ? `/admin${ATTENDANCE_PATH}` : ATTENDANCE_PATH
}
