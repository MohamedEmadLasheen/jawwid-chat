import { crc32, inflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';

/**
 * PD-39 §4.6: a board as a PDF, one page per board page. The client draws
 * every page itself (the one renderer, so the PDF never drifts from the
 * board) and uploads it as a PNG; this lays the PNGs out, 16:9, with the
 * Quran text's credit under every page when the board carries a verse (§4.3).
 *
 * RUNS IN A WORKER THREAD (whiteboard-export-runner.ts), never on the API's
 * own thread (review of #305): a PNG is a parser's input, and a fault in a
 * parser -- pdfkit's PNG reader throws from an async zlib callback, which
 * nothing can catch -- must take down that worker, not the process. So this
 * module stays loadable on its own: node builtins and pdfkit only, no
 * relative imports, nothing that needs __dirname (the font path is passed in).
 */

/** A page in points: the board's 16:9 page, and a strip under it for the credit. */
export const EXPORT_PAGE = { width: 960, height: 540, footer: 22 } as const;

/** An export page is the board's own page at most: 1920 x 1080 px (review of #305, P1). */
export const EXPORT_PAGE_MAX = { width: 1920, height: 1080 } as const;
/** An export page's file, and all of one export's pages together. */
export const EXPORT_PAGE_MAX_BYTES = 8 * 1024 * 1024;
export const EXPORT_TOTAL_MAX_BYTES = 64 * 1024 * 1024;

export interface ExportInput {
  title: string;
  /** The pages' PNGs, in board order; each must pass checkExportPng. */
  pages: Buffer[];
  /** "Quran text: Tanzil Project — tanzil.net", when a verse is on the board; null otherwise. */
  credit: string | null;
  /** The font for the credit and page numbers (IBM Plex Sans Arabic). */
  font: string;
}

/**
 * An export page DECODED, not just read: every chunk and its CRC, an 8-bit
 * RGB or RGBA image, not interlaced, at most 1920 x 1080, whose image data
 * inflates to exactly the size its header promises (never more -- the
 * inflate is capped) with a valid filter on every row, and IEND last. Only a
 * PNG this accepts is given to pdfkit. Returns why it is refused, or its size.
 * Synchronous and pure.
 */
export function checkExportPng(b: Buffer): { width: number; height: number } | { refused: string } {
  const refuse = (refused: string) => ({ refused });
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 8 || sig.some((v, i) => b[i] !== v)) return refuse('the page is not a PNG');
  let at = 8;
  let header: { width: number; height: number; channels: number } | null = null;
  const idat: Buffer[] = [];
  let ended = false;
  while (at < b.length) {
    if (at + 12 > b.length) return refuse('the PNG is cut short');
    const length = b.readUInt32BE(at);
    if (length > b.length - at - 12) return refuse('the PNG is cut short');
    const type = b.toString('latin1', at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + length);
    if ((crc32(b.subarray(at + 4, at + 8 + length)) >>> 0) !== b.readUInt32BE(at + 8 + length)) return refuse(`the PNG's ${type} chunk is damaged`);
    if (!header && type !== 'IHDR') return refuse('the PNG does not start with its header');
    if (type === 'IHDR') {
      if (header || length !== 13) return refuse('the PNG header is not valid');
      const [depth, color, compression, filter, interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || (color !== 2 && color !== 6) || compression !== 0 || filter !== 0 || interlace !== 0) {
        return refuse('an export page is an 8-bit RGB or RGBA PNG, not interlaced');
      }
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), channels: color === 6 ? 4 : 3 };
      if (header.width < 1 || header.height < 1 || header.width > EXPORT_PAGE_MAX.width || header.height > EXPORT_PAGE_MAX.height) {
        return refuse(`an export page is at most ${EXPORT_PAGE_MAX.width} x ${EXPORT_PAGE_MAX.height} px`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      ended = at + 12 === b.length;
      if (!ended) return refuse('the PNG has bytes after its end');
    } else if (type === 'acTL') {
      return refuse('an export page is a still image');
    }
    at += 12 + length;
  }
  if (!header || !ended || idat.length === 0) return refuse('the PNG is incomplete');
  const stride = header.width * header.channels + 1;
  const expected = stride * header.height;
  let pixels: Buffer;
  try {
    // Capped: a page never inflates past what its header promises (plus one byte, to see "more").
    pixels = inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
  } catch (e) {
    // More than the header promises stops the inflate at the cap.
    if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return refuse('the PNG image data is not the size its header says');
    return refuse('the PNG image data is damaged');
  }
  if (pixels.length !== expected) return refuse('the PNG image data is not the size its header says');
  for (let row = 0; row < header.height; row++) if (pixels[row * stride] > 4) return refuse('the PNG image data is damaged');
  return { width: header.width, height: header.height };
}

export function composeBoardPdf(input: ExportInput): Promise<Buffer> {
  const { width, height, footer } = EXPORT_PAGE;
  const doc = new PDFDocument({
    size: [width, height + footer],
    margin: 0,
    autoFirstPage: false,
    info: { Title: input.title, Producer: 'Jawwid', Creator: 'Jawwid whiteboard' },
  });
  doc.registerFont('plex', input.font);
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  input.pages.forEach((png, i) => {
    doc.addPage();
    doc.image(png, 0, 0, { fit: [width, height], align: 'center', valign: 'center' });
    doc.font('plex').fontSize(9).fillColor('#5C6B69');
    if (input.credit) doc.text(input.credit, 12, height + 6, { width: width - 80, lineBreak: false });
    doc.text(`${i + 1} / ${input.pages.length}`, width - 64, height + 6, { width: 52, align: 'right', lineBreak: false });
  });
  doc.end();
  return done;
}

/**
 * The worker's whole job: check every page, then compose. A page that fails
 * the check is refused by its number before pdfkit ever sees one.
 */
export async function checkAndCompose(input: ExportInput): Promise<{ pdf: Buffer } | { refused: string }> {
  for (const [i, page] of input.pages.entries()) {
    const verdict = checkExportPng(page);
    if ('refused' in verdict) return { refused: `page ${i + 1}: ${verdict.refused}` };
  }
  return { pdf: await composeBoardPdf(input) };
}
