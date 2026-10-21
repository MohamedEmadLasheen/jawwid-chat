import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  payrollApi,
  payrollKeys,
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
