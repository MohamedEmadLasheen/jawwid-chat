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
