/**
 * PD-38: the supervisor color keys, the same list as the CHECK on
 * chat.staff_calendar_color.color_key (20261026210000). The fills, borders and
 * AA text colors for each key live in the Admin Web palette; the server only
 * stores and validates the key.
 */
export const PALETTE_KEYS = [
  'sky', 'red', 'peach', 'green', 'purple', 'teal',
  'amber', 'pink', 'indigo', 'olive', 'brown', 'slate',
] as const;

export type PaletteKey = (typeof PALETTE_KEYS)[number];

export function isPaletteKey(v: unknown): v is PaletteKey {
  return typeof v === 'string' && (PALETTE_KEYS as readonly string[]).includes(v);
}
