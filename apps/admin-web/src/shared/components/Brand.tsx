/**
 * THE JAWWID LOCKUP — the single place the brand asset enters the app.
 *
 * The asset is the official file, copied byte-for-byte into
 * `public/brand/jawwid-logo.jpg`. It is never cropped, recoloured, traced or
 * redrawn, and no CSS here hides any part of it.
 *
 * ## Why the sizes look large
 *
 * The supplied artwork sits on a 567×425 canvas but occupies only 349×127 of
 * it — 18.4% of the area, with 29.4% padding above and 40.7% below. So the
 * `<img>` box is NOT the size the logo appears: to show the wordmark at 18px
 * the box has to be 60px tall. `--brand-canvas-scale` below is that ratio
 * (425 ÷ 127), stated once so the sizes read as "artwork height × scale"
 * rather than as arbitrary numbers, and so a future trimmed asset is a
 * one-value change.
 *
 * ## Why it is only used on light surfaces
 *
 * The file is a JPEG and therefore has no alpha channel: its white background
 * travels with it. On `--color-surface-default` (pure white) that background
 * is invisible and the lockup reads as if it were transparent. On the deep
 * teal auth panel it would render as a white rectangle, so the logo is placed
 * on the light card instead. That is a layout decision — the artwork is
 * untouched.
 *
 * `alt` is empty on purpose: the product name is rendered as real text beside
 * or below it in every placement, and a logo announced as "Jawwid logo" next
 * to the word "Jawwid" is said twice.
 */
export function Brand({
  size = 'md',
  showWordmark = false,
}: {
  size?: 'sm' | 'md' | 'lg'
  /**
   * Renders the product name as text beneath the lockup. The artwork already
   * contains the Latin wordmark, so this is off by default and used only where
   * the ARABIC name needs to appear too.
   */
  showWordmark?: boolean
}) {
  return (
    <span className={`brand brand--${size}`}>
      <img className="brand__logo" src="/brand/jawwid-logo.jpg" alt="" />
      {showWordmark && <span className="brand__wordmark">جَوِّد</span>}
    </span>
  )
}
