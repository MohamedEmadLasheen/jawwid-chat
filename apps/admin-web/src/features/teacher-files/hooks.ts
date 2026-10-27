import { useSession } from '@/core/auth/SessionProvider'
import { useLessonAccess } from '@/features/teachers/hooks'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  payrollApi,
  payrollKeys,
  supervisionDirectoryApi,
  supervisionDirectoryKeys,
  supervisionTimelineApi,
  teacherFileApi,
  teacherFileKeys,
  timelineKeys,
  type NewAdjustment,
  type NewEntry,
  type PayoutDetails,
  type PayoutMethod,
  type PersonalPatch,
  type SalaryType,
} from './api'

export function useTeacherList(enabled = true) {
  return useQuery({ queryKey: teacherFileKeys.list, queryFn: teacherFileApi.list, enabled, staleTime: 30_000 })
}

export function useTeacherFile(teacherId: string) {
  return useQuery({
    queryKey: teacherFileKeys.detail(teacherId),
    queryFn: () => teacherFileApi.detail(teacherId),
    staleTime: 15_000,
  })
}

function useRefresh(teacherId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: teacherFileKeys.detail(teacherId) })
    void qc.invalidateQueries({ queryKey: teacherFileKeys.list })
    // Complaints, comments and days off are on the timeline too.
    void qc.invalidateQueries({ queryKey: timelineKeys.timeline(teacherId) })
    // PD-26: the Supervision page lists complaints across teachers.
    void qc.invalidateQueries({ queryKey: ['teacher-supervision'] })
  }
}

export function useUpdatePersonal(teacherId: string) {
  const done = useRefresh(teacherId)
  return useMutation({ mutationFn: (body: PersonalPatch) => teacherFileApi.updatePersonal(teacherId, body), onSuccess: done })
}

export function useAddEntry(teacherId: string) {
  const done = useRefresh(teacherId)
  return useMutation({ mutationFn: (body: NewEntry) => teacherFileApi.addEntry(teacherId, body), onSuccess: done })
}

/** The same write, for a teacher chosen in the dialog (the Supervision page, PD-26). */
export function useAddEntryFor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ teacherId, body }: { teacherId: string; body: NewEntry }) => teacherFileApi.addEntry(teacherId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teacherFileKeys.all })
      void qc.invalidateQueries({ queryKey: ['teacher-supervision'] })
    },
  })
}

/** PD-11's supervision timeline. A refusal is an answer (the section then does not show), not retried. */
export function useSupervisionTimeline(teacherId: string) {
  return useQuery({
    queryKey: timelineKeys.timeline(teacherId),
    queryFn: () => supervisionTimelineApi.timeline(teacherId),
    staleTime: 15_000,
    retry: false,
  })
}

export function useAddNote(teacherId: string) {
  const done = useRefresh(teacherId)
  return useMutation({ mutationFn: (body: string) => supervisionTimelineApi.addNote(teacherId, body), onSuccess: done })
}

export function useRecordBonus(teacherId: string) {
  const done = useRefresh(teacherId)
  return useMutation({ mutationFn: (reason: string) => supervisionTimelineApi.bonus(teacherId, reason), onSuccess: done })
}

/** PD-18 payroll. Only asked for when the file says `canViewFinance`; never cached across months. */
export function useTeacherFinance(teacherId: string, month: string, enabled: boolean) {
  return useQuery({
    queryKey: payrollKeys.finance(teacherId, month),
    queryFn: () => payrollApi.finance(teacherId, month),
    enabled,
    staleTime: 15_000,
  })
}

function useFinanceRefresh(teacherId: string) {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: payrollKeys.all(teacherId) })
}

export function useSetTerms(teacherId: string) {
  const done = useFinanceRefresh(teacherId)
  return useMutation({
    mutationFn: (body: { effectiveMonth: string; salaryType: SalaryType; currency: string; monthlyAmount?: string; hourlyRate?: string; reason: string }) =>
      payrollApi.setTerms(teacherId, body),
    onSuccess: done,
  })
}

export function useSetPayoutAccount(teacherId: string) {
  const done = useFinanceRefresh(teacherId)
  return useMutation({
    mutationFn: (body: { method: PayoutMethod; details: PayoutDetails; reason: string }) => payrollApi.setPayoutAccount(teacherId, body),
    onSuccess: done,
  })
}

/** The details in clear live only in the mutation's result, in the dialog that asked -- never in the query cache. */
export function useRevealPayoutAccount(teacherId: string) {
  return useMutation({ mutationFn: (reason: string) => payrollApi.revealPayoutAccount(teacherId, reason) })
}

export function useAddAdjustment(teacherId: string) {
  const done = useFinanceRefresh(teacherId)
  return useMutation({ mutationFn: (body: NewAdjustment) => payrollApi.addAdjustment(teacherId, body), onSuccess: done })
}

/** PD-26 amendment: the page's teachers (the caller's) and complaint handlers. */
export function useSupervisionDirectory(enabled = true) {
  return useQuery({ queryKey: supervisionDirectoryKeys.directory, queryFn: supervisionDirectoryApi.directory, enabled, staleTime: 30_000 })
}

/** PD-26 amendment: one teacher's held lessons of the last two weeks, for recording lateness. */
export function useHeldLessons(teacherId: string, kind: 'regular' | 'trial') {
  return useQuery({
    queryKey: supervisionDirectoryKeys.held(teacherId, kind),
    queryFn: () => supervisionDirectoryApi.heldLessons(teacherId, kind),
    enabled: teacherId !== '',
  })
}

/**
 * Whether to LINK a teacher's name to their Teacher File: the super admin and
 * the Teachers department. An Operations supervisor on the Supervision page sees
 * the name only (PD-26 amendment); the server refuses the file either way.
 */
export function useOpensTeacherFiles(): boolean {
  const { staff } = useSession()
  const access = useLessonAccess(Boolean(staff) && staff?.role !== 'super_admin')
  // Until the server answers, no link: a name is never a link the viewer cannot follow.
  return staff?.role === 'super_admin' || access.data?.lessonManager === true
}

