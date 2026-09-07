/**
 * THE WHOLE ATTACHMENT PATH, with the bytes never touching the API.
 *
 *   authorize -> PUT straight to storage -> send the message with the object
 *   key -> the recipient's read mints a signed URL -> that URL serves the bytes
 *
 * This is the canonical boundary from `JAWUID-CHAT-ARCHITECTURE.md` §2.5, and
 * it is the only check that proves the Phase 2 storage item actually works:
 * every step can be individually correct while the URLs the API hands out
 * point somewhere nothing serves, which is precisely what was true before
 * S3ObjectStorage landed.
 *
 * Requires the API and a MinIO the API is configured against.
 */
const HTTP = process.env.API_BASE_URL ?? 'http://127.0.0.1:3999/api/v1'
const ids = JSON.parse(process.argv[2])
let failures = 0
const check = (l, ok, d = '') => { console.log(`${ok?'PASS':'FAIL'}  ${l}${ok?'':`  <- ${d}`}`); if (!ok) failures++ }
const call = async (m, p, { token, body } = {}) => {
  const r = await fetch(`${HTTP}${p}`, { method: m, headers: { 'content-type': 'application/json', ...(token?{authorization:`Bearer ${token}`}:{}) }, body: body===undefined?undefined:JSON.stringify(body) })
  const t = await r.text(); return { status: r.status, body: t?JSON.parse(t):null }
}
const login = async s => (await call('POST','/auth/login',{body:{subject:s,password:'smoke-password-long-enough'}})).body

const A = await login('smoke_parent')
const B = await login('smoke_supervisor')
const conv = (await call('POST','/conversations/direct',{token:A.accessToken,body:{withActorId:ids.supervisor}})).body

// 1. Authorize an upload.
const auth = await call('POST', `/conversations/${conv.id}/messages/attachments/authorize`, {
  token: A.accessToken, body: { kind: 'image', mimeType: 'image/png', byteSize: 12 },
})
check('the API authorizes an upload', auth.status < 300 && auth.body.objectKey, JSON.stringify(auth.body))
// The distinguishing fact: a SigV4 signature means the URL is addressed to
// object storage. The local reference signer produces `?expires=&sig=` and
// points at a path this API does not serve.
check('the upload URL points at real object storage, not at this API',
  auth.body.uploadUrl.includes('X-Amz-Signature'), auth.body.uploadUrl)

// 2. Upload the bytes directly to storage — they never transit the API.
const put = await fetch(auth.body.uploadUrl, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: Buffer.from('hello jawwid') })
check('the client uploads straight to storage', put.ok, String(put.status))

// 3. Send a message carrying the object key.
const sent = await call('POST', `/conversations/${conv.id}/messages`, {
  token: A.accessToken,
  body: { type: 'image', clientMessageId: crypto.randomUUID(), attachments: [{ kind: 'image', objectKey: auth.body.objectKey, mimeType: 'image/png', byteSize: 12 }] },
})
check('the message links the attachment', sent.status < 300 && sent.body.attachments?.length === 1, JSON.stringify(sent.body))

// 4. The recipient reads it and gets a signed URL.
const read = await call('GET', `/conversations/${conv.id}/messages`, { token: B.accessToken })
const attachment = read.body.messages.find(m => m.id === sent.body.id)?.attachments?.[0]
check('the recipient is served a short-lived signed URL', Boolean(attachment?.url) && attachment.url.includes('X-Amz-Signature'), JSON.stringify(attachment))

// 5. And the URL actually serves the bytes.
const got = await fetch(attachment.url)
check('the signed URL returns the uploaded bytes', got.ok && (await got.text()) === 'hello jawwid', String(got.status))

// 6. The served URL always expires. A permanent public URL would outlive
//    every authorization decision that produced it.
check('the served URL is short-lived, never permanent',
  attachment.url.includes('X-Amz-Expires'), attachment.url)

// 7. Oversize and wrong MIME are refused before a key exists.
const tooBig = await call('POST', `/conversations/${conv.id}/messages/attachments/authorize`, {
  token: A.accessToken, body: { kind: 'image', mimeType: 'image/png', byteSize: 999_999_999 },
})
check('an oversize upload is refused before an object key exists',
  tooBig.body?.error?.code === 'COMM.ATTACHMENT_TOO_LARGE', JSON.stringify(tooBig.body))
const badMime = await call('POST', `/conversations/${conv.id}/messages/attachments/authorize`, {
  token: A.accessToken, body: { kind: 'image', mimeType: 'application/x-msdownload', byteSize: 10 },
})
check('a disallowed MIME type is refused',
  badMime.body?.error?.code === 'COMM.ATTACHMENT_TYPE_NOT_ALLOWED', JSON.stringify(badMime.body))

console.log(failures === 0 ? '\nATTACHMENT E2E: ALL PASS' : `\nATTACHMENT E2E: ${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
