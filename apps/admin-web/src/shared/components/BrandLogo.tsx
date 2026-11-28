import lockup from '@/assets/brand/jawwid-lockup.png'
// Dark surfaces: the same lockup with its letters in light cream and the book and W in their own gold
// (made pixel by pixel from jawwid-lockup.png; see docs/design/brand-mark/README.md).
import lockupDark from '@/assets/brand/jawwid-lockup-on-dark.png'
import mark from '@/assets/brand/jawwid-mark.svg'

/**
 * The Jawwid lockup in both variants: the teal one for light surfaces, the
 * lighter one for dark surfaces. CSS shows exactly one (design-system.css), so
 * a context such as the sidebar's white tile can pick its variant regardless
 * of the colour scheme. The hidden one is display:none, so it is not announced.
 */
export function BrandLogo({ height }: { height?: number }) {
  const style = height ? { blockSize: height } : undefined
  return (
    <span className="brand">
      <img className="brand-logo brand-logo--light" src={lockup} alt="Jawwid" style={style} />
      <img className="brand-logo brand-logo--dark" src={lockupDark} alt="Jawwid" style={style} />
    </span>
  )
}

/**
 * The Jawwid mark: the open book from the lockup, cropped from the owner's logo file pixel for
 * pixel (no redraw, no recolour) and centred in a square. Used where the lockup does not fit:
 * the folded sidebar and the favicon. The gold reads on light and dark surfaces alike.
 */
export function BrandMark({ size }: { size?: number }) {
  const style = size ? { inlineSize: size, blockSize: size } : undefined
  return <img className="brand-mark" src={mark} alt="Jawwid" style={style} />
}
