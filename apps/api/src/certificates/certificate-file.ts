/**
 * PD-12: what a certificate file ACTUALLY is, read from its first bytes.
 *
 * The declared type is the uploader's claim and the upload signature binds the
 * bytes to it only as a label, so a certificate is sniffed before it is issued
 * into a family's group: a PDF, JPEG, PNG or WebP, and the type it said it was.
 */
export const CERTIFICATE_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type CertificateMime = (typeof CERTIFICATE_MIME_TYPES)[number];

/** 20 MiB -- a scanned A4 PDF fits comfortably. chat.learner_certificate checks the same bound. */
export const MAX_CERTIFICATE_BYTES = 20 * 1024 * 1024;

export function sniffCertificateFile(head: Buffer): CertificateMime | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  if (head.length >= 5 && at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf'; // %PDF-
  if (head.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (head.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (head.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

/**
 * PD-41 (review of #216): the WHOLE file, not just its first bytes. A design
 * goes into a family's group and possibly a Story, so:
 *   - an image must end where its format ends (PNG's IEND, JPEG's EOI, WebP's
 *     RIFF length), so nothing rides after it;
 *   - a PDF must end with %%EOF and carry none of the names that make a PDF
 *     run something: JavaScript, launch actions, embedded files, forms that
 *     submit or import, rich media, XFA.
 * A name hidden inside a compressed object stream is not seen here, so a
 * malware scan of every upload is a launch requirement
 * (docs/product/pd041-certificates-design.md §15).
 * Returns why the file is refused, or null. Pure.
 */
const PDF_ACTIVE_NAMES = /\/(JavaScript|JS|Launch|EmbeddedFile|EmbeddedFiles|RichMedia|XFA|SubmitForm|ImportData|GoToR)(?![A-Za-z0-9])/;

export function inspectCertificateFile(bytes: Buffer, mime: CertificateMime): string | null {
  if (sniffCertificateFile(bytes.subarray(0, 16)) !== mime) return 'the file is not the PDF or image it claims to be';
  const tail = (n: number) => bytes.subarray(Math.max(0, bytes.length - n));
  switch (mime) {
    case 'application/pdf':
      if (!tail(1024).toString('latin1').includes('%%EOF')) return 'the PDF is incomplete (no %%EOF)';
      if (PDF_ACTIVE_NAMES.test(bytes.toString('latin1'))) return 'the PDF carries scripts, actions or embedded files; export it as a plain PDF';
      return null;
    case 'image/png': {
      const iend = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
      return tail(12).equals(iend) ? null : 'the PNG does not end with its IEND chunk';
    }
    case 'image/jpeg':
      return bytes.length >= 4 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9 ? null : 'the JPEG does not end with its end-of-image marker';
    case 'image/webp':
      return bytes.length >= 12 && bytes.readUInt32LE(4) + 8 === bytes.length ? null : 'the WebP length does not match its RIFF header';
  }
}
