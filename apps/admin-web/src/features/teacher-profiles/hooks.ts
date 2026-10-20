import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { teacherProfileReviewApi } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'

/**
 * The CERTIFICATE review queue and the decisions on it.
 *
 * V2 removed profile-level review entirely -- `useApproveProfile`,
 * `useRequestChanges` and `useReviewRevision` are gone with the endpoints they
 * called, because a teacher's profile is published by the teacher saving it.
 * A CREDENTIAL is still decided by a reviewer: uploading a document that claims
 * a qualification does not verify it.
 *
 * ## Why a decision invalidates the list
 *
 * Two reviewers can hold the same queue open, so a decision changes work that
 * is on somebody else's screen, and the only honest answer to "what state is
 * this credential in?" is the server's. The list is invalidated on `onSettled`
 * -- on failure too, because the most common failure here is "somebody else
 * already acted", and the right response is to show what actually happened
 * rather than to leave a stale button armed.
 *
 * Nothing is optimistic. An optimistic approval would paint the outcome the
 * reviewer expected over the race they just lost.
 */
export function usePendingReviews() {
  const query = useQuery({
    queryKey: qk.teacherProfileReviews,
    queryFn: () => teacherProfileReviewApi.pending(),
  })
  return { ...query, profiles: query.data ?? [] }
}

export function useDecideCertificate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      certificateId,
      approved,
      note,
    }: {
      certificateId: string
      approved: boolean
      note?: string
    }) => teacherProfileReviewApi.decideCertificate(certificateId, approved, note),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.teacherProfileReviews })
    },
  })
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
