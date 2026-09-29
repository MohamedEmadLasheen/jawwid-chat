import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { storyApi, type StoryAudienceClause } from '@/core/api/endpoints'
import { qk } from '@/core/api/queryKeys'

export function useStories(includeDrafts = true) {
  const query = useQuery({
    queryKey: qk.stories(includeDrafts),
    queryFn: () => storyApi.list(includeDrafts),
  })
  return { ...query, stories: query.data ?? [] }
}

/**
 * The viewer list, fetched only when a publisher opens it.
 *
 * `enabled` matters: this is the most privacy-sensitive read in the feature, so
 * it is never prefetched alongside the list. Nobody's viewing history is pulled
 * into the console until somebody deliberately asks for one story's.
 */
export function useStoryViewers(storyId: string | null) {
  return useQuery({
    queryKey: qk.storyViewers(storyId ?? 'none'),
    queryFn: () => storyApi.viewers(storyId!),
    enabled: storyId !== null,
  })
}

export function useCreateStory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      title?: string
      body?: string
      mediaObjectKey?: string
      mediaKind?: string
      mediaMime?: string
      audiences: StoryAudienceClause[]
    }) => storyApi.create(input),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.storiesAll }),
  })
}

export function usePublishStory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => storyApi.publish(id),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.storiesAll }),
  })
}

export function useDeleteStory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => storyApi.remove(id, reason),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.storiesAll }),
  })
}

/**
 * Upload story media: authorize, then PUT the bytes at the signed URL.
 *
 * Two steps and one round trip through this console, because the bytes go
 * STRAIGHT to storage. They never pass through the API process, and the
 * signature they travel under is bound to the exact MIME type and byte size the
 * authorization was issued for -- so an authorization taken out for a small image
 * cannot be spent on a large video.
 *
 * Returns what the create call needs, never a readable URL: this console has no
 * business holding one.
 */
export async function uploadStoryMedia(
  file: File,
): Promise<{ mediaObjectKey: string; mediaKind: string; mediaMime: string }> {
  const auth = await storyApi.authorizeMedia(file.type, file.size)

  const response = await fetch(auth.uploadUrl, {
    method: auth.method,
    headers: auth.headers,
    body: file,
  })
  if (!response.ok) {
    throw new Error(`upload failed with ${response.status}`)
  }

  return {
    mediaObjectKey: auth.objectKey,
    mediaKind: file.type.startsWith('video/') ? 'video' : 'image',
    mediaMime: file.type,
  }
}
