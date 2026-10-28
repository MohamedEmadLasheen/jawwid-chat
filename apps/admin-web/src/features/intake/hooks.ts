import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/core/api/errors'
import { profileKeys } from '@/features/profiles/api'
import { trialKeys } from '@/features/trials/api'
import { subscriptionKeys } from '@/features/subscriptions/api'
import { intakeApi, intakeKeys, type AddChildrenInput, type CarriedOverInput, type IntakeInput } from './api'

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
  return () => {
    void qc.invalidateQueries({ queryKey: profileKeys.all })
    void qc.invalidateQueries({ queryKey: intakeKeys.all })
  }
}

/** A refusal (403/404) is an answer, not a failure to retry: the panel stays hidden. */
const refusedOnce = (count: number, error: unknown) =>
  !(error instanceof ApiError && (error.status === 403 || error.status === 404)) && count < 2

/** PR-3: New Students' families entered by hand (refreshed like the trial forms, for the sign-up code). */
export function useEnteredFamilies() {
  return useQuery({ queryKey: intakeKeys.entered, queryFn: () => intakeApi.entered(), retry: refusedOnce, staleTime: 15_000, refetchInterval: 15_000 })
}

/** The family's sign-in and owners, for the Parent Profile and the choose / suggest dialogs. */
export function useFamilyOwnership(familyId: string | undefined) {
  return useQuery({
    queryKey: intakeKeys.family(familyId ?? ''),
    queryFn: () => intakeApi.family(familyId as string),
    enabled: !!familyId,
    retry: refusedOnce,
  })
}

export function useCarriedOver(learnerId: string) {
  return useQuery({ queryKey: intakeKeys.carriedOver(learnerId), queryFn: () => intakeApi.carriedOver(learnerId), enabled: !!learnerId, retry: refusedOnce })
}

/** Every PR-3 change can move a family between New Students' filters and change both profiles. */
function useRefreshOwnership() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: intakeKeys.all })
    void qc.invalidateQueries({ queryKey: trialKeys.newStudents })
    void qc.invalidateQueries({ queryKey: profileKeys.all })
    void qc.invalidateQueries({ queryKey: ['chat'] })
  }
}

export function useAssignSupervisor(familyId: string) {
  const refresh = useRefreshOwnership()
  return useMutation({ mutationFn: (supervisorId: string) => intakeApi.assignSupervisor(familyId, supervisorId), onSuccess: refresh })
}

export function useSuggestSupervisor(familyId: string) {
  const refresh = useRefreshOwnership()
  return useMutation({ mutationFn: (supervisorId: string) => intakeApi.suggestSupervisor(familyId, supervisorId), onSuccess: refresh })
}

export function useChangeSalesOwner(familyId: string) {
  const refresh = useRefreshOwnership()
  return useMutation({ mutationFn: (body: { staffId: string; reason: string }) => intakeApi.changeSalesOwner(familyId, body), onSuccess: refresh })
}

export function useSetSignInEmail(familyId: string) {
  const refresh = useRefreshOwnership()
  return useMutation({ mutationFn: (email: string) => intakeApi.setSignInEmail(familyId, email), onSuccess: refresh })
}

function useRefreshPackage(learnerId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: intakeKeys.carriedOver(learnerId) })
    void qc.invalidateQueries({ queryKey: subscriptionKeys.learner(learnerId) })
  }
}

export function useCarryOver(learnerId: string) {
  const refresh = useRefreshPackage(learnerId)
  return useMutation({ mutationFn: (body: CarriedOverInput) => intakeApi.carryOver(learnerId, body), onSuccess: refresh })
}

export function useVoidCarryOver(learnerId: string) {
  const refresh = useRefreshPackage(learnerId)
  return useMutation({ mutationFn: (reason: string) => intakeApi.voidCarryOver(learnerId, reason), onSuccess: refresh })
}

export function useEnterFamily() {
  const refresh = useRefreshParents()
  return useMutation({ mutationFn: (body: IntakeInput) => intakeApi.enter(body), onSuccess: refresh })
}

export function useAddChildren(familyId: string) {
  const refresh = useRefreshParents()
  return useMutation({ mutationFn: (body: AddChildrenInput) => intakeApi.addChildren(familyId, body), onSuccess: refresh })
}
