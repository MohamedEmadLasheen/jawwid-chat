/**
 * PARENT-008. A presigned PUT must not pin a body checksum.
 *
 * @aws-sdk/client-s3 >= 3.729 defaults to requestChecksumCalculation
 * WHEN_SUPPORTED, and the presigner then bakes `x-amz-checksum-crc32` -- the
 * CRC32 of the EMPTY body it saw while signing (AAAAAA==) -- and
 * `x-amz-sdk-checksum-algorithm` into every upload URL. A store that checks it
 * against the real body refuses every upload; MinIO 2025-04 happens to ignore
 * it. We never send a body to sign, so a checksum here is always wrong.
 *
 * No network: presigning is local computation.
 */
import { S3ObjectStorage } from '@communication/attachments/s3-object-storage';

const GRANTS = [
  // Every grant in the API goes through authorizeUpload; these are its callers' prefixes.
  ['chat attachment', 'conversations/0b9a3a5e-3f1e-4a47-9a2a-2b0e7c1d1f11', 'image/jpeg'],
  ['avatar', 'avatars/staff/0b9a3a5e-3f1e-4a47-9a2a-2b0e7c1d1f11', 'image/png'],
  ['bank-transfer receipt', 'payment-receipts/0b9a3a5e-3f1e-4a47-9a2a-2b0e7c1d1f11', 'application/pdf'],
  ['whiteboard asset', 'whiteboards/0b9a3a5e-3f1e-4a47-9a2a-2b0e7c1d1f11/staging', 'image/webp'],
  ['certificate upload', 'certificate-uploads/0b9a3a5e-3f1e-4a47-9a2a-2b0e7c1d1f11/9c2d1e7f-3a4b-4c5d-8e6f-7a8b9c0d1e2f', 'application/pdf'],
] as const;

describe('presigned PUT URLs carry no body checksum', () => {
  const storage = new S3ObjectStorage({
    endpoint: 'https://storage.invalid', region: 'us-east-1', bucket: 'b',
    accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', signedUrlTtlSeconds: 300,
  });
  afterAll(() => storage.destroy());

  it.each(GRANTS)('%s', async (_what, prefix, mimeType) => {
    const grant = await storage.authorizeUpload({ prefix, mimeType, byteSize: 25930 });
    const params = [...new URL(grant.uploadUrl).searchParams.keys()].map((k) => k.toLowerCase());
    expect(params.filter((k) => k.startsWith('x-amz-checksum') || k === 'x-amz-sdk-checksum-algorithm')).toEqual([]);
    // What it still binds: the type and the length (the authorization's limits).
    expect(new URL(grant.uploadUrl).searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(grant.headers).toEqual({ 'content-type': mimeType, 'content-length': '25930' });
  });

  it('a signed read URL carries none either', async () => {
    const url = await storage.signedReadUrl('conversations/0b9a3a5e-3f1e-4a47-9a2a-2b0e7c1d1f11/8a7b6c5d-4e3f-4a2b-9c1d-0e1f2a3b4c5d');
    expect([...new URL(url).searchParams.keys()].some((k) => /checksum/i.test(k))).toBe(false);
  });
});
