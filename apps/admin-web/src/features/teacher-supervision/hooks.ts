import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { payrollApi, supervisionTimelineApi, teacherFileKeys } from '@/features/teacher-files/api'
import type { ComplaintSource } from '@/features/teacher-files/api'
import { parentFeedbackApi, parentFeedbackKeys, supervisionHubApi, supervisionHubKeys, type FeedbackQuery } from './api'

export function useLeaveOverview() {
  return useQuery({ queryKey: supervisionHubKeys.leave(), queryFn: () => supervisionHubApi.leaveOverview(), staleTime: 15_000 })
}

export function useSupervisedComplaints(from?: ComplaintSource) {
  return useQuery({ queryKey: supervisionHubKeys.complaints(from), queryFn: () => supervisionHubApi.complaints(from), staleTime: 15_000 })
}

export function useRewards() {
  return useQuery({ queryKey: supervisionHubKeys.rewards(), queryFn: () => supervisionHubApi.rewards(), staleTime: 15_000 })
}

/** The super admin only; anyone else is refused, which hides the panel. */
export function useDeductionDefaults(enabled: boolean) {
  return useQuery({
    queryKey: supervisionHubKeys.deductionDefaults,
    queryFn: supervisionHubApi.deductionDefaults,
    enabled,
    retry: false,
  })
}

export function useSetDeductionDefault() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: supervisionHubApi.setDeductionDefault,
    onSuccess: (data) => qc.setQueryData(supervisionHubKeys.deductionDefaults, data),
  })
}

/**
 * A reward is PD-11's bonus ticket (the entry and the card to the teacher);
 * its amount, when the super admin types one, is PD-18's payroll row pricing
 * that entry. Two requests: if the second fails, the reward stays recorded and
 * waits for its amount in Payroll -- nothing is lost.
 */
export function useRecordReward() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ teacherId, reason, amount }: { teacherId: string; reason: string; amount?: string }) => {
      const entry = await supervisionTimelineApi.bonus(teacherId, reason)
      if (amount) await payrollApi.addAdjustment(teacherId, { kind: 'bonus', bonusEntryId: entry.id, amount, reason })
      return entry
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: supervisionHubKeys.all })
      void qc.invalidateQueries({ queryKey: teacherFileKeys.all })
    },
  })
}

// ---------------------------------------------------------------------------
// PD-32 parent feedback
// ---------------------------------------------------------------------------

export function useParentFeedback(q: FeedbackQuery) {
  return useQuery({ queryKey: parentFeedbackKeys.list(q), queryFn: () => parentFeedbackApi.list(q), staleTime: 15_000 })
}

/** A family's Parent File. A refusal hides the section, so it is never retried. */
export function useFamilyFeedback(familyId: string | undefined) {
  return useQuery({
    queryKey: parentFeedbackKeys.family(familyId ?? ''),
    queryFn: () => parentFeedbackApi.forFamily(familyId!),
    enabled: !!familyId,
    retry: false,
  })
}

/** Taking or replying changes the feedback, its PD-26 complaint (handler, status) and the Teacher File. */
function useInvalidateFeedback() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: parentFeedbackKeys.all })
    void qc.invalidateQueries({ queryKey: supervisionHubKeys.all })
    void qc.invalidateQueries({ queryKey: teacherFileKeys.all })
  }
}

export function useTakeFeedback() {
  const refresh = useInvalidateFeedback()
  return useMutation({ mutationFn: (id: string) => parentFeedbackApi.take(id), onSettled: refresh })
}

export function useReplyFeedback() {
  const refresh = useInvalidateFeedback()
  return useMutation({
    mutationFn: ({ id, response, resolve }: { id: string; response: string; resolve?: boolean }) =>
      parentFeedbackApi.reply(id, { response, ...(resolve ? { resolve: true } : {}) }),
    onSettled: refresh,
  })
}
