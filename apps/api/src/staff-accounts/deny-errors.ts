import { CommError, CommErrorCode } from '../platform/errors';

const clean = (t: string) => t.replace(/^[\s\S]*?(?:ERROR|Message):\s*/i, '').split('\n')[0]!.slice(0, 300);

/**
 * Access management M3: the database's refusals as answers. 403 for an authority refusal (Decision 3), 409 when this database does not
 * enforce denies at all, 400 for a malformed or impossible restriction, 404 for what is not the caller's to know.
 */
export function denyRefusal(e: unknown): unknown {
  if (e instanceof CommError) return e;
  const t = e instanceof Error ? e.message : String(e);
  if (/not enforced in this environment/.test(t)) return new CommError(CommErrorCode.STAFF_ACCOUNT_CONFLICT, 'restrictions are not enforced in this environment, so none is recorded', 409);
  if (/Decision 3|never denied|nobody denies|only the super admin|manager restricts|manager lifts/.test(t)) return new CommError(CommErrorCode.STAFF_ACCOUNT_DENIED, clean(t), 403);
  if (/no such (staff member|restriction)/.test(t)) return new CommError(CommErrorCode.STAFF_ACCOUNT_NOT_FOUND, 'no such staff account', 404);
  if (/cannot be denied yet|already denied|nothing to deny|expires within|permanent restriction|already lifted|a reason is required/.test(t)) return new CommError(CommErrorCode.STAFF_ACCOUNT_INVALID, clean(t), 400);
  return e;
}
