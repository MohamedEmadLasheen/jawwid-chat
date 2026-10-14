import { useEffect, useState } from 'react'
import { T, useCopy } from './copy'

/**
 * A staff photo, or -- whenever there is none, or it fails to load -- the same
 * initials fallback every time. A signed URL expires (minutes), so a profile
 * left open long enough will see its image 403; that must degrade to initials,
 * never to a broken-image icon.
 */
export function StaffAvatar({
  name,
  url,
  size = 40,
}: {
  name: string
  url: string | null
  size?: number
}) {
  const tx = useCopy()
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])

  const style = { inlineSize: size, blockSize: size, fontSize: Math.max(12, Math.round(size * 0.38)) }
  if (url && !failed) {
    return (
      <img
        className="sp-avatar"
        src={url}
        alt={tx(T.avatarOf, { name })}
        style={style}
        onError={() => setFailed(true)}
        referrerPolicy="no-referrer"
      />
    )
  }
  return (
    <span className="sp-avatar sp-avatar--initials" style={style} role="img" aria-label={tx(T.avatarOf, { name })}>
      {initials(name)}
    </span>
  )
}

/** First letters of the first two words; works for Arabic and Latin names alike. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '')
  return letters.join('').toLocaleUpperCase()
}
