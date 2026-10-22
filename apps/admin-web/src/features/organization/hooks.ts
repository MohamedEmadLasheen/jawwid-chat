import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { chatKeys } from '@/features/chat/chatApi'
import { orgApi, orgKeys, type NewFamilyGroup } from './api'

export function useStructure(enabled = true) {
  return useQuery({ queryKey: orgKeys.structure, queryFn: orgApi.structure, staleTime: 30_000, enabled })
}

export function useLearners(enabled: boolean) {
  return useQuery({ queryKey: orgKeys.learners, queryFn: orgApi.learners, enabled, staleTime: 30_000 })
}

export function useGroupCandidates() {
  return useQuery({ queryKey: orgKeys.candidates, queryFn: orgApi.groupCandidates, staleTime: 30_000 })
}

/** Any structure change can move access: refresh everything that shows it. */
function useInvalidateOrg() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['org'] })
    void qc.invalidateQueries({ queryKey: chatKeys.list })
  }
}

export function useAssignSupervisor() {
  const done = useInvalidateOrg()
  return useMutation({
    mutationFn: (v: { learnerId: string; supervisorId: string; reason: string }) =>
      orgApi.assignSupervisor(v.learnerId, { supervisorId: v.supervisorId, reason: v.reason }),
    onSuccess: done,
  })
}

export type BackupAction = 'activate' | 'deactivate' | 'end'

export function useBackupAction() {
  const done = useInvalidateOrg()
  return useMutation({
    mutationFn: (v: { id: string; action: BackupAction; reason: string; until?: string }) =>
      v.action === 'activate'
        ? orgApi.activateBackup(v.id, { reason: v.reason, ...(v.until ? { until: v.until } : {}) })
        : v.action === 'deactivate'
          ? orgApi.deactivateBackup(v.id, { reason: v.reason })
          : orgApi.endBackup(v.id, { reason: v.reason }),
    onSuccess: done,
  })
}

export function useCreateBackup() {
  const done = useInvalidateOrg()
  return useMutation({ mutationFn: orgApi.createBackup, onSuccess: done })
}

export function useCreateFamilyGroup() {
  const done = useInvalidateOrg()
  return useMutation({ mutationFn: (body: NewFamilyGroup) => orgApi.createFamilyGroup(body), onSuccess: done })
}
