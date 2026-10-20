import { chatApi, type ChatMessage } from './chatApi'

/**
 * Sending a voice note from Admin Web: the SAME three steps the mobile app takes
 * (lib/core/data/http/http_message_repository.dart), against the same routes.
 *
 *   1. authorize -- the server re-checks membership, MIME and size, and signs an
 *      upload bound to exactly that MIME type and byte count;
 *   2. PUT the bytes to the signed URL -- they never pass through the API, and the
 *      URL is self-authorizing, so it carries NO bearer token;
 *   3. send a `voice` message that names the uploaded object.
 *
 * Nothing here decides who may send what: a refusal at any step is the server's
 * and surfaces as its error.
 */

/** The server's voice MIME allow-list (attachment.service.ts), most preferred first. */
const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg']

/**
 * `audio/webm;codecs=opus` -> `audio/webm`. The server matches the bare type
 * exactly, and the upload is signed for the type we declare, so the parameters
 * never leave the browser.
 */
export function baseMime(type: string): string {
  return type.split(';')[0]!.trim().toLowerCase()
}

/** A container this browser can record AND the server will accept, or null. */
export function pickRecordingType(isSupported: (t: string) => boolean): string | null {
  return RECORDING_TYPES.find((t) => isSupported(t)) ?? null
}

/** The server's ceiling for one voice note (ATTACHMENT_MAX_VOICE_DURATION_MS default). */
export const MAX_VOICE_MS = 10 * 60 * 1000

export class UploadError extends Error {
  constructor(readonly status: number) {
    super(`upload refused (${status})`)
  }
}

export async function sendVoiceNote(args: {
  conversationId: string
  blob: Blob
  durationMs: number
  visibility: 'customer' | 'internal'
  clientMessageId: string
  fetchImpl?: typeof fetch
}): Promise<ChatMessage> {
  const fetchImpl = args.fetchImpl ?? fetch
  const mimeType = baseMime(args.blob.type)
  const byteSize = args.blob.size

  const grant = await chatApi.authorizeAttachment(args.conversationId, {
    kind: 'voice',
    mimeType,
    byteSize,
    visibility: args.visibility,
  })

  const put = await fetchImpl(grant.uploadUrl, {
    method: grant.method ?? 'PUT',
    headers: grant.headers ?? { 'content-type': mimeType },
    // Signed and self-authorizing: no Authorization header, no cookies.
    credentials: 'omit',
    body: args.blob,
  })
  if (!put.ok) throw new UploadError(put.status)

  return chatApi.sendVoice(args.conversationId, {
    clientMessageId: args.clientMessageId,
    visibility: args.visibility,
    attachment: { objectKey: grant.objectKey, mimeType, byteSize, durationMs: Math.round(args.durationMs) },
  })
}
