import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * PD-56: the public deletion page's anti-forgery token. The form carries
 * `<issued-at>.<nonce>.<mac>`; a POST without a valid one younger than
 * FORM_TOKEN_TTL_MS is refused before the password is looked at. Stateless:
 * the MAC key is derived from the server's access-token secret under its own
 * label, so it is never a token another feature accepts.
 */
export const FORM_TOKEN_TTL_MS = 60 * 60 * 1000;
const LABEL = 'jawwid:account-deletion-form:v1';

function key(): Buffer {
  const secret = (process.env.JWT_ACCESS_SECRET ?? '').trim();
  if (!secret) throw new Error('JWT_ACCESS_SECRET is required for the account-deletion form');
  return createHmac('sha256', secret).update(LABEL).digest();
}

function mac(payload: string): string {
  return createHmac('sha256', key()).update(payload).digest('base64url');
}

export function issueFormToken(now = Date.now()): string {
  const payload = `${now}.${randomBytes(12).toString('base64url')}`;
  return `${payload}.${mac(payload)}`;
}

export function formTokenValid(token: unknown, now = Date.now()): boolean {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [issued, nonce, given] = parts;
  const at = Number(issued);
  if (!Number.isSafeInteger(at) || now - at > FORM_TOKEN_TTL_MS || at - now > 60_000 || !nonce) return false;
  const expected = Buffer.from(mac(`${issued}.${nonce}`));
  const actual = Buffer.from(given ?? '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
