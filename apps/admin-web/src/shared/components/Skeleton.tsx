import type { CSSProperties } from 'react'

/**
 * A placeholder in the shape of content that is still loading, so the layout
 * does not jump when it arrives. Purely visual: the region that holds it
 * carries the loading status for assistive tech.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  radius,
  style,
}: {
  width?: number | string
  height?: number | string
  radius?: number | string
  style?: CSSProperties
}) {
  return (
    <span
      className="skeleton"
      aria-hidden="true"
      style={{ inlineSize: width, blockSize: height, borderRadius: radius, ...style }}
    />
  )
}
