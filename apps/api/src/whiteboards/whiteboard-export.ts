import { join } from 'node:path';
import PDFDocument from 'pdfkit';

/**
 * PD-39 §4.6: a board as a PDF, one page per board page. The client draws
 * every page itself (the one renderer, so the PDF never drifts from the
 * board) and uploads it as a PNG; this only lays the PNGs out, 16:9, with the
 * Quran text's credit under every page when the board carries a verse (§4.3).
 * Vector PDF is not planned.
 */

const FONT = join(__dirname, '..', '..', 'assets', 'fonts', 'IBMPlexSansArabic-Regular.ttf');

/** A page in points: the board's 16:9 page, and a strip under it for the credit. */
export const EXPORT_PAGE = { width: 960, height: 540, footer: 22 } as const;

export interface ExportInput {
  title: string;
  /** The pages' PNGs, in board order. */
  pages: Buffer[];
  /** "Quran text: Tanzil Project — tanzil.net", when a verse is on the board; null otherwise. */
  credit: string | null;
}

export function composeBoardPdf(input: ExportInput): Promise<Buffer> {
  const { width, height, footer } = EXPORT_PAGE;
  const doc = new PDFDocument({
    size: [width, height + footer],
    margin: 0,
    autoFirstPage: false,
    info: { Title: input.title, Producer: 'Jawwid', Creator: 'Jawwid whiteboard' },
  });
  doc.registerFont('plex', FONT);
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
