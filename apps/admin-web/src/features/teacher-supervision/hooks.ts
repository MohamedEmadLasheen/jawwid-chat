import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { payrollApi, supervisionTimelineApi, teacherFileKeys } from '@/features/teacher-files/api'
import { supervisionHubApi, supervisionHubKeys } from './api'

export function useLeaveOverview() {
  return useQuery({ queryKey: supervisionHubKeys.leave(), queryFn: () => supervisionHubApi.leaveOverview(), staleTime: 15_000 })
}

export function useSupervisedComplaints(from?: 'management' | 'parent') {
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
