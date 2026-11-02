/**
 * ADMIN-001: the idempotency key of one money-recording form. Generated once
 * when the form opens and sent with every submit of it -- a retry after a
 * timeout or an error is the same submit, so the server writes it once; a form
 * opened again is a new submit. (Family intake's intakeId works the same way.)
 */
export function newSubmitKey(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))
}
