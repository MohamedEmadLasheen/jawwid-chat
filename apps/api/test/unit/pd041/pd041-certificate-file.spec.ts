/**
 * PD-41 (review of #216): a certificate file is checked whole, not by its first
 * 16 bytes -- a format that ends where it should, and a PDF that runs nothing.
 */
import { inspectCertificateFile } from '../../../src/certificates/certificate-file';

const IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0x20), IEND]);
const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`, 'latin1');
const webp = (n: number) => {
  const b = Buffer.alloc(n, 0x20);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(n - 8, 4);
  b.write('WEBP', 8, 'latin1');
  return b;
};

describe('PD-41: the whole certificate file', () => {
  it('accepts whole, plain files', () => {
    expect(inspectCertificateFile(PNG, 'image/png')).toBeNull();
    expect(inspectCertificateFile(pdf('1 0 obj << /Type /Catalog >> endobj'), 'application/pdf')).toBeNull();
    expect(inspectCertificateFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x20, 0x20, 0xff, 0xd9]), 'image/jpeg')).toBeNull();
    expect(inspectCertificateFile(webp(40), 'image/webp')).toBeNull();
  });

  it('refuses a file that does not end where its format ends, or carries more', () => {
    expect(inspectCertificateFile(PNG.subarray(0, PNG.length - 1), 'image/png')).toMatch(/IEND/);
    expect(inspectCertificateFile(Buffer.concat([PNG, Buffer.from('<script>')]), 'image/png')).toMatch(/IEND/);
    expect(inspectCertificateFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x20, 0x20]), 'image/jpeg')).toMatch(/end-of-image/);
    expect(inspectCertificateFile(Buffer.concat([webp(40), Buffer.from('x')]), 'image/webp')).toMatch(/RIFF/);
    expect(inspectCertificateFile(Buffer.from('%PDF-1.7\nno end'), 'application/pdf')).toMatch(/%%EOF/);
  });

  it.each(['/JavaScript', '/JS (x)', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA', '/SubmitForm', '/ImportData', '/GoToR'])(
    'refuses a PDF carrying %s',
    (name) => {
      expect(inspectCertificateFile(pdf(`1 0 obj << /OpenAction << /S ${name} >> >> endobj`), 'application/pdf')).toMatch(/scripts, actions or embedded files/);
    },
  );

  it('does not mistake a longer name for an active one, and refuses a file that is not what it says', () => {
    expect(inspectCertificateFile(pdf('<< /JSONData 1 >>'), 'application/pdf')).toBeNull();
    expect(inspectCertificateFile(PNG, 'application/pdf')).toMatch(/not the PDF or image/);
  });
});
