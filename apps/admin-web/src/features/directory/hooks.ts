import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { familyApi, learnerApi, labelApi } from '@/core/api/directory'
import { qk } from '@/core/api/queryKeys'
import type { SettableInactiveState } from '@/shared/types/directory'

/**
 * Phase 3 emits no realtime events, so these queries are invalidated by their
 * own mutations and by nothing else. That is deliberate: the business model
 * changes at human speed, and adding it to the realtime fan-out would mean a
 * second event convention alongside the console's.
 */
export function useFamilies(filters: { q?: string; label?: string[]; activeOnly?: boolean }) {
  return useQuery({
    queryKey: qk.directoryFamilies(filters),
    queryFn: () => familyApi.list(filters),
    staleTime: 10_000,
  })
}

export function useFamily(id: string | null) {
  return useQuery({
    queryKey: qk.directoryFamily(id ?? ''),
    queryFn: () => familyApi.get(id!),
    enabled: Boolean(id),
  })
}

export function useFamilyLearners(id: string | null) {
  return useQuery({
    queryKey: qk.familyLearners(id ?? ''),
    queryFn: () => learnerApi.listForFamily(id!),
    enabled: Boolean(id),
  })
}

export function useFamilyAssignments(id: string | null) {
  return useQuery({
    queryKey: qk.familyAssignments(id ?? ''),
    queryFn: () => familyApi.assignments(id!),
    enabled: Boolean(id),
  })
}

export function useFamilyLifecycle(id: string | null) {
  return useQuery({
    queryKey: qk.familyLifecycle(id ?? ''),
    queryFn: () => familyApi.lifecycleHistory(id!),
    enabled: Boolean(id),
  })
}

export function useFamilyLabels(id: string | null) {
  return useQuery({
    queryKey: qk.familyLabels(id ?? ''),
    queryFn: () => familyApi.labels(id!),
    enabled: Boolean(id),
  })
}

export function useTeacherHistory(learnerId: string | null) {
  return useQuery({
    queryKey: qk.learnerTeacherHistory(learnerId ?? ''),
    queryFn: () => learnerApi.teacherHistory(learnerId!),
    enabled: Boolean(learnerId),
  })
}

export function useLabels() {
  return useQuery({ queryKey: qk.labels, queryFn: () => labelApi.list(), staleTime: 30_000 })
}

/** Lifecycle: two named operations, never a generic state setter. */
export function useFamilyLifecycleActions(familyId: string) {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.directory })
  }
  return {
    deactivate: useMutation({
      mutationFn: (input: { reason: string; state: SettableInactiveState }) =>
        familyApi.deactivate(familyId, input.reason, input.state),
      onSuccess: refresh,
    }),
    activate: useMutation({
      mutationFn: (reason: string) => familyApi.activate(familyId, reason),
      onSuccess: refresh,
    }),
  }
}

/** Assign AND transfer -- one mutation, because it is one act. */
export function useAssignTeacher(learnerId: string, familyId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { teacherId: string; reason: string }) =>
      learnerApi.assignTeacher(learnerId, input.teacherId, input.reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.learnerTeacherHistory(learnerId) })
      void qc.invalidateQueries({ queryKey: qk.familyLearners(familyId) })
    },
  })
}

export function useLearnerLifecycle(familyId: string) {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.familyLearners(familyId) })
  }
  return {
    deactivate: useMutation({
      mutationFn: (input: { id: string; reason: string }) =>
        learnerApi.deactivate(input.id, input.reason),
      onSuccess: refresh,
    }),
    activate: useMutation({
      mutationFn: (input: { id: string; reason: string }) =>
        learnerApi.activate(input.id, input.reason),
      onSuccess: refresh,
    }),
    create: useMutation({
      mutationFn: (input: { name: string; level?: string | null }) =>
        learnerApi.create(familyId, input),
      onSuccess: refresh,
    }),
  }
}
