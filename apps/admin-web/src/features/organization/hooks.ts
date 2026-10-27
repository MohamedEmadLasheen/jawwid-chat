import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { chatKeys } from '@/features/chat/chatApi'
import { orgApi, orgKeys, type NewFamilyGroup, type StartCover } from './api'

export function useStructure(enabled = true) {
  return useQuery({ queryKey: orgKeys.structure, queryFn: orgApi.structure, staleTime: 30_000, enabled })
}

export function useLearners(enabled: boolean) {
  return useQuery({ queryKey: orgKeys.learners, queryFn: orgApi.learners, enabled, staleTime: 30_000 })
}

/** PD-35: every teacher with their supervisor (the Teachers Manager and the super admin). */
export function useTeacherAssignments(enabled: boolean) {
  return useQuery({ queryKey: orgKeys.teacherAssignments, queryFn: orgApi.teacherAssignments, enabled, staleTime: 30_000 })
}

export function useAssignTeacher() {
  const done = useInvalidateOrg()
  return useMutation({
    mutationFn: (v: { teacherId: string; supervisorId: string | null }) => orgApi.assignTeacher(v.teacherId, v.supervisorId),
    onSuccess: done,
  })
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

// PD-33 "Hand over to backup". A cover moves who reaches which chats, so every
// change refreshes the structure, the chat list and the covers themselves.

export function useCovers(enabled = true) {
  return useQuery({ queryKey: orgKeys.covers, queryFn: orgApi.covers, staleTime: 30_000, enabled })
}

export function useMyCover(enabled = true) {
  return useQuery({ queryKey: orgKeys.myCover, queryFn: orgApi.myCover, staleTime: 60_000, enabled })
}

export function useCoverPreview(supervisorId: string, backupId: string) {
  return useQuery({
    queryKey: orgKeys.coverPreview(supervisorId, backupId),
    queryFn: () => orgApi.coverPreview(supervisorId, backupId || undefined),
    staleTime: 10_000,
  })
}

export function useStartCover() {
  const done = useInvalidateOrg()
  return useMutation({ mutationFn: (body: StartCover) => orgApi.startCover(body), onSuccess: done })
}

export function useExtendCover() {
  const done = useInvalidateOrg()
  return useMutation({ mutationFn: (id: string) => orgApi.extendCover(id), onSuccess: done })
}

export function useEndCover() {
  const done = useInvalidateOrg()
  return useMutation({ mutationFn: (id: string) => orgApi.endCover(id), onSuccess: done })
}
