import { CommError, CommErrorCode } from '../platform/errors';

/** One grant that blocks a role edit: who holds the role, and the manager who granted it. */
export interface BlockingGrant {
  staffId: string;
  grantedBy: string;
}

const MESSAGE_MAX = 600;

/**
 * The grants chat.update_access_role names when an edit would give a
 * manager's grantees a key that manager may not grant (PD-40 H5, review of
 * #212 P2). Its text reads "... may not grant to: <staff> (granted by
 * <grantor>), ...; revoke those grants first". Read from the FULL error text:
 * the message the API sends is cut short, and with many grants the cut used to
 * drop names (review of #239). A grant the driver repeats counts once.
 */
export function blockingGrantsOf(text: string): BlockingGrant[] {
  const seen = new Set<string>();
  const out: BlockingGrant[] = [];
  for (const list of text.matchAll(/may not grant to:\s*([\s\S]*?);\s*revoke those grants/g)) {
    for (const m of list[1]!.matchAll(/([^\s,()]+)\s*\(granted by ([^\s,()]+)\)/g)) {
      const key = `${m[1]}:${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ staffId: m[1]!, grantedBy: m[2]! });
    }
  }
  return out;
}

/** COMM.ACCESS_ROLE_CONFLICT from the database's text: a short message, and every blocking grant in `detail.grants`. */
export function accessRoleConflict(text: string): CommError {
  const body = /ERROR:\s*([\s\S]*)$/.exec(text)?.[1] ?? text.replace(/^[\s\S]*?Message:\s*/i, '');
  const message = body.split('\n')[0]!.replace(/`$/, '').slice(0, MESSAGE_MAX);
  const grants = blockingGrantsOf(text);
  return new CommError(CommErrorCode.ACCESS_ROLE_CONFLICT, message, 409, grants.length > 0 ? { grants } : undefined);
}
