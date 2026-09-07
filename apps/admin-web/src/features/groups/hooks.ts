import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { groupApi } from '@/core/api/directory'
import { qk } from '@/core/api/queryKeys'

export function useGroups(includeArchived: boolean) {
  return useQuery({
    queryKey: qk.groups(includeArchived),
    queryFn: () => groupApi.list(includeArchived),
    staleTime: 10_000,
  })
}

export function useGroup(id: string | null) {
  return useQuery({
    queryKey: qk.group(id ?? ''),
    queryFn: () => groupApi.get(id!),
    enabled: Boolean(id),
  })
}

export function useGroupMembers(id: string | null) {
  return useQuery({
    queryKey: qk.groupMembers(id ?? ''),
    queryFn: () => groupApi.members(id!),
    enabled: Boolean(id),
  })
}

export function useGroupTeachers(id: string | null) {
  return useQuery({
    queryKey: qk.groupTeachers(id ?? ''),
    queryFn: () => groupApi.teachers(id!),
    enabled: Boolean(id),
  })
}

export function useGroupHistory(id: string | null) {
  return useQuery({
    queryKey: qk.groupHistory(id ?? ''),
    queryFn: () => groupApi.history(id!),
    enabled: Boolean(id),
  })
}

/**
 * Every group mutation invalidates the whole group subtree.
 *
 * Coarse on purpose: a membership change alters the roster, the history and
 * (for close/archive) the group itself, and a group is a small object fetched
 * rarely. Precise invalidation here would buy nothing and would be one more
 * place to get wrong.
 */
export function useGroupActions(groupId: string) {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.groupsAll })
  }
  return {
    rename: useMutation({
      mutationFn: (name: string) => groupApi.rename(groupId, name),
      onSuccess: refresh,
    }),
    addMember: useMutation({
      mutationFn: (learnerId: string) => groupApi.addMember(groupId, learnerId),
      onSuccess: refresh,
    }),
    removeMember: useMutation({
      mutationFn: (input: { learnerId: string; reason: string }) =>
        groupApi.removeMember(groupId, input.learnerId, input.reason),
      onSuccess: refresh,
    }),
    addTeacher: useMutation({
      mutationFn: (teacherId: string) => groupApi.addTeacher(groupId, teacherId),
      onSuccess: refresh,
    }),
    removeTeacher: useMutation({
      mutationFn: (input: { teacherId: string; reason: string }) =>
        groupApi.removeTeacher(groupId, input.teacherId, input.reason),
      onSuccess: refresh,
    }),
    close: useMutation({
      mutationFn: (reason: string) => groupApi.close(groupId, reason),
      onSuccess: refresh,
    }),
    archive: useMutation({
      mutationFn: (reason: string) => groupApi.archive(groupId, reason),
      onSuccess: refresh,
    }),
    replace: useMutation({
      mutationFn: (input: { name: string; reason: string }) =>
        groupApi.createReplacement(groupId, input.name, input.reason),
      onSuccess: refresh,
    }),
  }
}

export function useCreateGroup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => groupApi.create({ name }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.groupsAll }),
  })
}
