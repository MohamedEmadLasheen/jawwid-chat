import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/core/api/errors'
import { profileKeys } from '@/features/profiles/api'
import { intakeApi, intakeKeys, type AddChildrenInput, type IntakeInput } from './api'

/**
 * Whether this staff member enters families at all (the server's word): the
 * options answer, or a refusal. A UX affordance only -- every write is decided
 * by the server and the database.
 */
export function useIntakeOptions() {
  return useQuery({
    queryKey: intakeKeys.options,
    queryFn: () => intakeApi.options(),
    retry: (count, error) => !(error instanceof ApiError && (error.status === 403 || error.status === 404)) && count < 2,
    staleTime: 5 * 60_000,
  })
}

function useRefreshParents() {
  const qc = useQueryClient()
  return () => void qc.invalidateQueries({ queryKey: profileKeys.all })
}

export function useEnterFamily() {
  const refresh = useRefreshParents()
  return useMutation({ mutationFn: (body: IntakeInput) => intakeApi.enter(body), onSuccess: refresh })
}

export function useAddChildren(familyId: string) {
  const refresh = useRefreshParents()
  return useMutation({ mutationFn: (body: AddChildrenInput) => intakeApi.addChildren(familyId, body), onSuccess: refresh })
}
