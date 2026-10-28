/**
 * PD-48: how a reviewer hears a clip. The bytes are fetched, hashed with
 * WebCrypto and played from memory, so what the reviewer hears is exactly
 * what they approve: the approval carries this hash, and the server refuses
 * it unless it is the clip's own audio_sha256.
 */
export interface Heard {
  /** SHA-256 of the bytes that were played. */
  audioSha256: string
  /** Whether they matched the clip's audio_sha256 (if not, nothing was played). */
  matched: boolean
}

export interface ClipPlayer {
  /** Resolves once the clip has played TO THE END (or rejects: not loaded, not matching, stopped). */
  play(url: string, expectedSha256: string): Promise<Heard>
  stop(): void
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function browserPlayer(): ClipPlayer {
  let current: { audio: HTMLAudioElement; url: string; cancel: () => void } | null = null
  const stop = () => {
    if (!current) return
    current.audio.pause()
    URL.revokeObjectURL(current.url)
    current.cancel()
    current = null
  }
  return {
    stop,
    async play(url, expectedSha256) {
      stop()
      const res = await fetch(url, { credentials: 'omit', cache: 'no-store' })
      if (!res.ok) throw new Error(`the clip could not be loaded (${res.status})`)
      const bytes = await res.arrayBuffer()
      const audioSha256 = await sha256Hex(bytes)
      if (audioSha256 !== expectedSha256) return { audioSha256, matched: false }
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))
      const audio = new Audio(blobUrl)
      return new Promise<Heard>((resolve, reject) => {
        current = { audio, url: blobUrl, cancel: () => reject(new Error('stopped')) }
        audio.onended = () => {
          URL.revokeObjectURL(blobUrl)
          current = null
          resolve({ audioSha256, matched: true })
        }
        audio.play().catch((e: unknown) => {
          stop()
          reject(e)
        })
      })
    },
  }
}
