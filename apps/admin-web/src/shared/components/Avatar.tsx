import { useState } from 'react'

/**
 * A person's picture: their photo when the server supplies one (`src`, a
 * signed URL), otherwise generated initials -- never a placeholder silhouette
 * that suggests a photo is missing. A photo that fails to load falls back to
 * the initials. The tone is a stable hash of the id, so the same person keeps
 * the same colour across screens.
 */
const TONES = 5

export function initials(name: string): string {
  // Only words with a letter in them: "Parent — Salem family" is "PS", not "P—".
  const words = name.trim().split(/[\s_-]+/u).filter((w) => /\p{L}/u.test(w))
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '')
  return letters.join('').toLocaleUpperCase() || '?'
}

function toneFor(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return (Math.abs(h) % TONES) + 1
}

export function Avatar({
  name,
  seed,
  size = 'md',
  src,
}: {
  name: string
  seed?: string
  size?: 'sm' | 'md' | 'lg'
  src?: string | null
}) {
  const [failed, setFailed] = useState<string | null>(null)
  const sizeClass = size === 'md' ? '' : ` avatar--${size}`
  const photo = src && failed !== src ? src : null
  // A malformed or partial record must not take the page down with it.
  const label = typeof name === 'string' ? name : ''
  return (
    <span className={`avatar avatar--t${toneFor(seed || label)}${sizeClass}${photo ? ' avatar--photo' : ''}`} aria-hidden="true">
      {photo ? <img src={photo} alt="" loading="lazy" onError={() => setFailed(photo)} /> : initials(label)}
    </span>
  )
}
