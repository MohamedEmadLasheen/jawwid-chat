import { api } from '@/core/api/client'

/**
 * The signed-in staff member's own photo.
 *
 * Nothing here takes an actor id, and that is the whole authorization story: the server
 * reads the caller from the session and writes that row. An admin could not point these at
 * somebody else's avatar if they tried, because there is no parameter through which to name
 * one — the same property the parent and teacher flows rely on.
 */

export interface MyAvatar {
  displayName: string
  avatarUrl: string | null
}

export interface UploadGrant {
  objectKey: string
  uploadUrl: string
  headers?: Record<string, string>
}

export const avatarApi = {
  mine: () => api.get<MyAvatar>('/me/avatar'),

  /** Type and size are enforced server-side; this just asks. */
  authorize: (mimeType: string, byteSize: number) =>
    api.post<UploadGrant>('/me/avatar/authorize', { mimeType, byteSize }),

  commit: (objectKey: string) => api.post<MyAvatar>('/me/avatar', { objectKey }),

  remove: () => api.delete<MyAvatar>('/me/avatar'),
}

/**
 * Put the bytes where the grant says, then tell the API the key.
 *
 * The bytes go STRAIGHT to storage on the signed URL and never pass through the API
 * process, and no storage credential ever reaches this browser — the same two-step the
 * mobile client uses. The content type is part of what storage signed, so the grant's
 * headers are sent back verbatim rather than guessed at.
 */
export async function uploadAvatar(file: File): Promise<MyAvatar> {
  const grant = await avatarApi.authorize(file.type, file.size)

  const response = await fetch(grant.uploadUrl, {
    method: 'PUT',
    headers: grant.headers ?? { 'content-type': file.type },
    body: file,
  })
  if (!response.ok) {
    throw new Error(`storage refused the upload (${response.status})`)
  }

  return avatarApi.commit(grant.objectKey)
}
