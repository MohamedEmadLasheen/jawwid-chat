import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { teacherProfileReviewApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'

/**
 * The review queue and the decisions on it.
 *
 * ## Why every mutation invalidates BOTH keys
 *
 * Two reviewers can hold the same revision open. A decision therefore changes
 * work that is on somebody else's screen, and the only honest answer to "what
 * is this revision now?" is the server's. Each mutation invalidates the list AND
 * the detail on `onSettled` -- on failure too, because the most common failure
 * here is "somebody else already acted", and the right response to that is to
 * show what actually happened rather than to leave a stale button armed.
 *
 * Nothing is optimistic. An optimistic approval would paint the outcome the
 * reviewer expected over the race they just lost.
 */
export function usePendingReviews() {
  const query = useQuery({
    queryKey: qk.teacherProfileReviews,
    queryFn: () => teacherProfileReviewApi.pending(),
  })
  return { ...query, revisions: query.data ?? [] }
}

/** One revision, fetched only once a reviewer opens it. */
export function useReviewRevision(revisionId: string | null) {
  return useQuery({
    queryKey: qk.teacherProfileReview(revisionId ?? 'none'),
    queryFn: () => teacherProfileReviewApi.get(revisionId!),
    enabled: revisionId !== null,
  })
}

function useReviewMutation<TArgs>(
  revisionId: string | null,
  run: (args: TArgs) => Promise<unknown>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.teacherProfileReviews })
      if (revisionId) {
        void queryClient.invalidateQueries({
          queryKey: qk.teacherProfileReview(revisionId),
        })
      }
    },
  })
}

export function useDecideCertificate(revisionId: string | null) {
  return useReviewMutation<{ certificateId: string; approved: boolean; note?: string }>(
    revisionId,
    ({ certificateId, approved, note }) =>
      teacherProfileReviewApi.decideCertificate(certificateId, approved, note),
  )
}

export function useApproveProfile(revisionId: string | null) {
  return useReviewMutation<string>(revisionId, (id) => teacherProfileReviewApi.approve(id))
}

export function useRequestChanges(revisionId: string | null) {
  return useReviewMutation<{ id: string; note: string }>(revisionId, ({ id, note }) =>
    teacherProfileReviewApi.requestChanges(id, note),
  )
}

/**
 * Fetch a signed URL and open it.
 *
 * Two deliberate properties: the URL is requested at the moment of opening, so a
 * short-lived grant is never held; and it is whatever the server returned, so no
 * storage path is ever constructed here.
 */
export async function openCertificate(certificateId: string): Promise<void> {
  const url = await teacherProfileReviewApi.certificateUrl(certificateId)
  globalThis.open?.(url, '_blank', 'noopener')
}
