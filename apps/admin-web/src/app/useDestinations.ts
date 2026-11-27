import { useCallback, useMemo } from 'react'
import { useI18n } from '@/core/i18n/I18nProvider'
import { useSession } from '@/core/auth/SessionProvider'
import { useLessonAccess } from '@/features/teachers/hooks'
import { useInstalmentAccess } from '@/features/instalments/hooks'
import { useMaterialsAccess } from '@/features/materials/hooks'
import { useCertificateAccess } from '@/features/certificates/hooks'
import { useLessonAudioAccess } from '@/features/lesson-audio/hooks'
import { useTeacherRecordsAccess } from '@/features/teacher-records/hooks'
import { holdsAny, isSuperAdmin } from '@/core/permissions/capabilities'
import { useText } from '@/features/admin/copy'
import { destinationsFor, type Destination, type NavEntry } from './navigation'

/** The destinations the signed-in account may open: the rail, the drawer, the top bar and search all read this. */
export function useDestinations(): Destination[] {
  const { staff } = useSession()
  // Only operators need the answer; the super admin reaches statistics as a section.
  const operator = staff !== null && !isSuperAdmin(staff.role)
  const access = useLessonAccess(operator)
  const billing = useInstalmentAccess(operator)
  const lessonManager = access.data?.lessonManager === true
  const billingReader = billing.data?.billingReader === true
  const sales = access.data?.sales === true
  const operations = access.data?.operations === true
  const calendar = access.data?.calendar === true
  const supervisionPage = access.data?.supervisionPage === true
  // Educational materials: the library's managers, its authors and its reviewers (the super admin's entry is a section).
  const materialsAccess = useMaterialsAccess(operator)
  const materialsWorkspace = materialsAccess.data?.canOpen === true
  // PD-41: the Certificates page, for whoever holds a certificates key (the Designer included).
  const certificateAccess = useCertificateAccess(operator)
  const certificates = certificateAccess.data?.canOpen === true
  // PD-48: the Lesson audio page, for whoever may listen (the Pronunciation reviewer included).
  const lessonAudioAccess = useLessonAudioAccess(operator)
  const lessonAudio = lessonAudioAccess.data?.view === true
  // PD-52: the teacher-records pages, on the server's basis-and-key answer.
  const recordsAccess = useTeacherRecordsAccess(operator)
  const teacherAttendance = recordsAccess.data?.attendance.view === true
  const teacherGrants = recordsAccess.data?.grants.view === true
  // PD-57: the moderation queue, on GET /me's permission keys (the super admin holds all).
  const moderation = holdsAny(staff, ['moderation.view'])
  return useMemo(
    () =>
      staff
        ? destinationsFor(staff.role, { moderation, lessonManager, sales, operations, billingReader, materialsWorkspace, calendar, supervisionPage, certificates, lessonAudio, teacherAttendance, teacherGrants })
        : [],
    [staff, moderation, lessonManager, sales, operations, billingReader, materialsWorkspace, calendar, supervisionPage, certificates, lessonAudio, teacherAttendance, teacherGrants],
  )
}

export function useEntryLabel() {
  const { t } = useI18n()
  const tx = useText()
  return useCallback(
    (entry: NavEntry) => ('text' in entry.label ? tx(entry.label.text) : t(entry.label.message)),
    [t, tx],
  )
}
