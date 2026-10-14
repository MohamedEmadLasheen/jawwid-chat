import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { profileKeys, staffProfileApi, uploadAvatar, type StaffProfile } from './api'

/**
 * Every read here is the server's answer for THIS viewer. A save writes the
 * returned profile straight into the cache (no second fetch, no flash of the
 * old value) and then invalidates the lists that summarize it.
 */
export function useStaffProfile(ref: string) {
  return useQuery({
    queryKey: profileKeys.profile(ref),
    queryFn: () => staffProfileApi.get(ref),
    // Photo URLs are signed for minutes; keep the profile fresh enough that
    // they are re-minted before they lapse.
    staleTime: 60_000,
    refetchInterval: 4 * 60_000,
    retry: false,
  })
}

export function useTeam(enabled: boolean) {
  return useQuery({ queryKey: profileKeys.team, queryFn: staffProfileApi.team, enabled, staleTime: 60_000 })
}

export function useOrganization(enabled: boolean) {
  return useQuery({ queryKey: profileKeys.organization, queryFn: staffProfileApi.organization, enabled, staleTime: 60_000 })
}

export function useActivity(ref: string, enabled: boolean) {
  return useQuery({ queryKey: profileKeys.activity(ref), queryFn: () => staffProfileApi.activity(ref), enabled })
}

function useApply(ref: string) {
  const qc = useQueryClient()
  return (profile: StaffProfile) => {
    qc.setQueryData(profileKeys.profile(ref), profile)
    void qc.invalidateQueries({ queryKey: profileKeys.team })
    void qc.invalidateQueries({ queryKey: profileKeys.organization })
    void qc.invalidateQueries({ queryKey: ['staff-profiles', 'activity'] })
    // The same person may be cached under `me` and under their id.
    void qc.invalidateQueries({ queryKey: ['staff-profiles', 'profile'], predicate: (q) => q.queryKey[2] !== ref })
  }
}

export function useUpdateProfile(ref: string) {
  const apply = useApply(ref)
  return useMutation({
    mutationFn: (body: Parameters<typeof staffProfileApi.update>[1]) => staffProfileApi.update(ref, body),
    onSuccess: apply,
  })
}

export function useAvatarUpload(ref: string) {
  const apply = useApply(ref)
  return useMutation({ mutationFn: (photo: Blob) => uploadAvatar(ref, photo), onSuccess: apply })
}

export function useAvatarRemove(ref: string) {
  const apply = useApply(ref)
  return useMutation({ mutationFn: () => staffProfileApi.removeAvatar(ref), onSuccess: apply })
}

export function useAssignResponsibility(ref: string) {
  const apply = useApply(ref)
  return useMutation({
    mutationFn: (v: { category: string; scopeNote: string | null }) => staffProfileApi.assign(ref, v.category, v.scopeNote),
    onSuccess: apply,
  })
}

export function useEndResponsibility(ref: string) {
  const apply = useApply(ref)
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => staffProfileApi.end(ref, v.id, v.reason),
    onSuccess: apply,
  })
}

export function useSetReportingLine(ref: string) {
  const apply = useApply(ref)
  return useMutation({
    mutationFn: (v: { managerStaffId: string | null; reason: string }) =>
      staffProfileApi.setReportingLine(ref, v.managerStaffId, v.reason),
    onSuccess: apply,
  })
}
