/**
 * ATTACHMENT STORAGE, AGAINST A REAL BUCKET.
 *
 * The unit tests assert the signature's shape. This asserts the only thing that
 * finally matters: that MinIO accepts the URL, stores the bytes, gives them
 * back, and refuses everything it should refuse. A presigner can satisfy every
 * shape rule and still be rejected — one wrong character in the canonical
 * request is a 403 and nothing else.
 *
 * Requires a MinIO with a PRIVATE bucket. `docker-compose.yml` provisions
 * exactly that; the defaults below match it.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

process.env.STORAGE_ENDPOINT ??= 'http://127.0.0.1:9000'
process.env.STORAGE_BUCKET ??= 'jawwid-chat-attachments'
process.env.STORAGE_ACCESS_KEY ??= 'jawwid-dev'
process.env.STORAGE_SECRET_KEY ??= 'jawwid-dev-secret'
process.env.STORAGE_REGION ??= 'us-east-1'

const API = path.resolve(import.meta.dirname, '../../../apps/api')
const { S3ObjectStorage } = await import(
  pathToFileURL(path.join(API, 'dist/communication/attachments/s3-object-storage.js')).href
)
const storage = new S3ObjectStorage()

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  <- ${detail}`}`)
  if (!ok) failures++
}

const auth = await storage.authorizeUpload({
  prefix: 'conversations/c-1',
  mimeType: 'image/png',
  byteSize: 12,
})
check('authorizeUpload mints a server-generated key under the conversation prefix',
  auth.objectKey.startsWith('conversations/c-1/') && auth.method === 'PUT')

const bytes = Buffer.from('hello jawwid')
const put = await fetch(auth.uploadUrl, {
  method: 'PUT',
  headers: { 'content-type': 'image/png' },
  body: bytes,
})
check('the presigned PUT is accepted by MinIO', put.ok, `${put.status} ${await put.text()}`)

const readUrl = await storage.signedReadUrl(auth.objectKey, 300)
const get = await fetch(readUrl)
check('the presigned GET returns the bytes', get.ok && (await get.text()) === 'hello jawwid',
  String(get.status))

// The bucket is private: an unsigned request must be refused.
const unsigned = await fetch(
  `${process.env.STORAGE_ENDPOINT}/${process.env.STORAGE_BUCKET}/${auth.objectKey}`,
)
check('an UNSIGNED read is refused — the bucket is private', unsigned.status === 403,
  String(unsigned.status))

// A tampered signature must not verify.
const tampered = readUrl.replace(/X-Amz-Signature=(\w)/, (m, c) =>
  `X-Amz-Signature=${c === 'a' ? 'b' : 'a'}`)
const bad = await fetch(tampered)
check('a tampered signature is refused', bad.status === 403, String(bad.status))

// An expired URL must not verify. A REAL expiry: signed for one second, then
// waited out. A negative TTL would only prove that storage rejects a malformed
// request, which is a different fact.
const shortLived = await storage.signedReadUrl(auth.objectKey, 1)
check('a URL is valid while it lives', (await fetch(shortLived)).ok)
await new Promise((r) => setTimeout(r, 2500))
const afterExpiry = await fetch(shortLived)
check('the same URL is refused once expired', afterExpiry.status === 403,
  String(afterExpiry.status))

// A TTL outside SigV4's range is a configuration error, not a silent bad URL.
let rejected = false
try {
  await storage.signedReadUrl(auth.objectKey, 0)
} catch {
  rejected = true
}
check('a TTL of 0 is refused rather than minting a malformed URL', rejected)

// A key with characters encodeURIComponent leaves alone must still verify.
const odd = await storage.authorizeUpload({
  prefix: "conversations/c-1/it's (a) test*",
  mimeType: 'image/png',
  byteSize: 5,
})
const oddPut = await fetch(odd.uploadUrl, {
  method: 'PUT',
  headers: { 'content-type': 'image/png' },
  body: Buffer.from('bytes'),
})
check('a key containing !\'()* signs correctly (RFC 3986, not encodeURIComponent)',
  oddPut.ok, `${oddPut.status}`)

console.log(failures === 0 ? '\nS3 STORAGE: ALL PASS' : `\nS3 STORAGE: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
