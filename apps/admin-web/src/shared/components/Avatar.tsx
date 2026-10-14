/**
 * Generated initials. There is no photo storage behind any principal, so an
 * avatar is always initials -- never a placeholder silhouette that suggests a
 * photo is missing. The tone is a stable hash of the id, so the same person
 * keeps the same colour across screens.
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
}: {
  name: string
  seed?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClass = size === 'md' ? '' : ` avatar--${size}`
  return (
    <span className={`avatar avatar--t${toneFor(seed ?? name)}${sizeClass}`} aria-hidden="true">
      {initials(name)}
    </span>
  )
}
