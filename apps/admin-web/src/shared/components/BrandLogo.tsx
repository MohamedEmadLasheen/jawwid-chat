import lockup from '@/assets/brand/jawwid-lockup.png'
import lockupDark from '@/assets/brand/jawwid-lockup-dark.png'

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
