import { CommError, CommErrorCode } from '../platform/errors';

/** Where a complaint written by STAFF came from. A parent's own form writes 'parent_app' (PD-32); staff never do. */
export type StaffComplaintSource = 'management' | 'parent';

const SOURCES: ReadonlySet<string> = new Set<StaffComplaintSource>(['management', 'parent']);

/**
 * PD-26: every complaint staff record names its source, on every route that
 * writes one (the Teacher File's and PD-11's supervision timeline). Complaints
 * written before the rule keep a null source; a new one without it is a 400
 * that names the field.
 */
export function staffComplaintSource(body: Record<string, unknown>): StaffComplaintSource {
  const raw = body.source;
  if (typeof raw !== 'string' || !SOURCES.has(raw)) {
    throw new CommError(CommErrorCode.VALIDATION, 'source: must be management or parent', 400);
  }
  return raw as StaffComplaintSource;
}
