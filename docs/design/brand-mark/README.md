# Jawwid mark (folded sidebar and favicon)

**Source:** the owner's logo file `Layer 0.png` (348×126 RGBA; sha256 starts `dd52096dac8e9d22`), supplied on 2026-11-27.

**What was done (no redraw, no recolour):**
- Rows 0–44 and columns 69–292 hold the open-book glyph above the wordmark; they were cut out pixel for pixel.
- The last two of those rows (43–44) also touch the tops of the dark-teal letters. Those 185 letter pixels were made transparent. Every book pixel is byte-identical to the source; this was verified, with 0 changed.
- The book (224×45) was placed in a 256×256 transparent square at its own resolution, not scaled, with 16 px on the left and right and 105/106 px at the top and bottom. The 1 px difference is unavoidable: the book is 45 px tall and the square is 256 px.

| File | Use |
|---|---|
| `jawwid-mark.svg` | Wraps `jawwid-mark-256.png` losslessly; the logo is not traced. Used in the folded sidebar (`apps/admin-web/src/assets/brand/jawwid-mark.svg`) and as `favicon.svg`. |
| `jawwid-mark-256.png` | Master square, at the source's own pixels. |
| `jawwid-mark-64/48/32/16.png` | Favicon sizes, scaled down only (never up). |
| `jawwid-book.png` | The book alone, tight crop (224×45). |

**Colour.** The book is the logo's gold. The dark teal belongs to the letters, so it is not in a book-only crop.

**Small sizes.** The book is about 5:1 wide, so at 16 px it is about 3 px tall. Browsers on high-density screens use the 32 px or SVG icon.

**Where it is used.** The opened sidebar, the phone top bar and the sign-in page keep the full JAWWID wordmark.

## Wordmark on dark (`jawwid-lockup-on-dark.png`)
This is the dark-theme logo: the light lockup (`apps/admin-web/src/assets/brand/jawwid-lockup.png`, 372×148) transformed pixel by pixel. Nothing is redrawn and the shapes are identical.
- **Letters.** The teal lettering becomes light cream (#f5f0e4). An antialiased edge between teal and gold gets a proportional share, so edges stay as drawn.
- **Gold.** The book and the gold W keep their original gold; 10,789 pixels are untouched.
- **White matte.** The source carries a faint white matte left by its background removal. It is invisible on light and showed as a haze on dark. On near-white pixels, only the white share of alpha is removed; teal and gold pixels are untouched.

It is used in dark mode in the opened sidebar, the phone top bar and on sign-in. The light theme keeps the original lockup, and there is no cream plate anywhere. The folded sidebar keeps the gold book mark.
