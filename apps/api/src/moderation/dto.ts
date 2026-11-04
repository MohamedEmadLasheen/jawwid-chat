import { createHash } from 'node:crypto';
import type { ContentReport } from '@prisma/client';
import { CommError, CommErrorCode } from '../platform/errors';

/**
 * PD-57 WP-1 (roadmap 2026-11-03 §5.4): the Report API's request parsing and
 * response shapes, kept free of I/O so the unit spec can hold them to the
 * privacy rules (§5.5):
 *
 *   - the reporter reads their own reports: status and the answer, never the
 *     evidence, the reviewer, the resolution or the note of the staff;
 *   - staff read the queue and the evidence, never the reporter: no reporter
 *     id, kind or account, and not the conversation (in a direct conversation
 *     the other member IS the reporter).
 */

/** A-1's five reasons. `blocked` is the server's (WP-2) and is never accepted here. */
export const REPORT_REASONS = ['harassment', 'inappropriate', 'spam', 'child_safety', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_STATUSES = ['open', 'in_review', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const UNRESOLVED: readonly ReportStatus[] = ['open', 'in_review'];
export const RESOLUTIONS = ['no_action', 'message_removed', 'warned', 'account_suspended', 'reassigned'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const SUBJECT_KINDS = ['contact', 'teacher', 'staff'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** The database's CHECKs (20261104100000), checked here first for a readable 400. */
export const NOTE_MAX = 500;
export const ANSWER_MAX = 1000;
export const RESOLUTION_NOTE_MAX = 2000;
export const IDEMPOTENCY_KEY_MAX = 200;

export type ReportInput =
  | { targetKind: 'message'; messageId: string; reason: ReportReason; note: string | null }
  | { targetKind: 'person'; subject: { kind: string; id: string }; reason: ReportReason; note: string | null };

const BODY_KEYS = new Set(['targetKind', 'messageId', 'subject', 'reason', 'note']);

export function invalid(reason: string): CommError {
  return new CommError(CommErrorCode.VALIDATION, reason, 400);
}

/**
 * POST /reports. A message: `{targetKind: 'message', messageId, reason, note?}`;
 * a person: `{targetKind: 'person', subject: {kind, id}, reason, note?}`. The
 * conversation is never sent: the server derives it. An empty (or blank) note
 * is no note. Unknown fields are refused, so a client cannot believe it set one.
 *
 * The target ids are NOT checked for shape here: a malformed id answers as an
 * unknown one does (404), so the shape never tells ids apart.
 */
export function parseReportInput(body: Record<string, unknown>): ReportInput {
  const extra = Object.keys(body).filter((k) => !BODY_KEYS.has(k));
  if (extra.length) throw invalid(`unknown field: ${extra.sort().join(', ')}`);
  const reason = body.reason;
  if (typeof reason !== 'string' || !(REPORT_REASONS as readonly string[]).includes(reason)) {
    throw invalid(`reason: must be one of ${REPORT_REASONS.join(', ')}`);
  }
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') throw invalid('note: must be text');
    const trimmed = body.note.trim();
    if (trimmed.length > NOTE_MAX) throw invalid(`note: must be at most ${NOTE_MAX} characters`);
    note = trimmed.length ? trimmed : null;
  }
  if (reason === 'other' && note === null) {
    throw new CommError(CommErrorCode.REPORT_NOTE_REQUIRED, 'a report for "other" needs a note', 400);
  }
  if (body.targetKind === 'message') {
    if (body.subject !== undefined) throw invalid('subject: a message report names its message only');
    if (typeof body.messageId !== 'string' || body.messageId.length === 0) throw invalid('messageId: is required');
    return { targetKind: 'message', messageId: body.messageId, reason: reason as ReportReason, note };
  }
  if (body.targetKind === 'person') {
    if (body.messageId !== undefined) throw invalid('messageId: a person report names its subject only');
    const subject = body.subject as Record<string, unknown> | undefined;
    if (!subject || typeof subject !== 'object' || typeof subject.kind !== 'string' || typeof subject.id !== 'string') {
      throw invalid('subject: {kind, id} is required');
    }
    return { targetKind: 'person', subject: { kind: subject.kind, id: subject.id }, reason: reason as ReportReason, note };
  }
  throw invalid("targetKind: must be 'message' or 'person'");
}

/** Idempotency-Key (Admin Web) or X-Idempotency-Key (the Flutter app); absent or empty is none. */
export function parseIdempotencyKey(...headers: Array<string | undefined>): string | null {
  const key = headers.find((h) => h !== undefined && h !== '');
  if (key === undefined) return null;
  if (key.length > IDEMPOTENCY_KEY_MAX || !/^[\x21-\x7e]+$/.test(key)) {
    throw invalid(`Idempotency-Key: 1-${IDEMPOTENCY_KEY_MAX} visible characters`);
  }
  return key;
}

/**
 * What the audit row keeps of a reporter's Idempotency-Key: a digest bound to
 * the reporter, so the trail (read more widely than the reports) never names
 * who filed the report, and a key never matches another person's request.
 */
export function requestDigest(reporterKind: string, reporterId: string, key: string): string {
  return createHash('sha256').update(`report-request\0${reporterKind}\0${reporterId}\0${key}`).digest('hex');
}

/** The request a key was used for, so a replay with another body is told apart. */
export function bodyDigest(input: ReportInput): string {
  const target = input.targetKind === 'message' ? ['message', input.messageId.toLowerCase()] : ['person', input.subject.kind, input.subject.id.toLowerCase()];
  return createHash('sha256').update([...target, input.reason, input.note ?? ''].join('\0')).digest('hex');
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** POST /reports: 201 for a new report, 200 (the same shape) for the open one it folds into. */
export function receipt(r: Pick<ContentReport, 'id' | 'status' | 'dueAt'>) {
  return { id: r.id, status: r.status as ReportStatus, dueAt: r.dueAt.toISOString() };
}

/** GET /me/reports: the reporter's own row. No evidence, no reviewer, no resolution, no staff note. */
export function forReporter(r: ContentReport) {
  return {
    id: r.id,
    targetKind: r.targetKind as 'message' | 'person',
    reason: r.reason,
    status: r.status as ReportStatus,
    createdAt: r.createdAt.toISOString(),
    ...(r.answerText !== null && r.reporterAnsweredAt !== null
      ? { answer: { text: r.answerText, at: r.reporterAnsweredAt.toISOString() } }
      : {}),
  };
}

export type StaffNames = ReadonlyMap<string, string>;

/** GET /moderation/reports: a queue row. Never the reporter, never the content. */
export function queueRow(r: ContentReport, staff: StaffNames) {
  return {
    id: r.id,
    targetKind: r.targetKind as 'message' | 'person',
    reason: r.reason,
    priority: r.priority as 'urgent' | 'normal',
    status: r.status as ReportStatus,
    createdAt: r.createdAt.toISOString(),
    dueAt: r.dueAt.toISOString(),
    overdueAt: r.overdueAt?.toISOString() ?? null,
    /** The staff member who took it (a reviewer, never the reporter). */
    takenBy: r.takenBy,
    takenByName: r.takenBy ? (staff.get(r.takenBy) ?? null) : null,
    reporterAnsweredAt: r.reporterAnsweredAt?.toISOString() ?? null,
  };
}

/** The evidence snapshot as 20261104100000 stores it (written by ReportsService.file). */
export interface EvidenceSnapshot {
  type?: string | null;
  body?: string | null;
  attachments?: Array<{ kind?: string; objectKey?: string; mimeType?: string; byteSize?: number; name?: string | null }>;
  author?: { kind?: string; id?: string; name?: string | null };
  sentAt?: string | null;
  editedAt?: string | null;
  forwarded?: boolean;
}

/**
 * GET /moderation/reports/:id: the row, the reporter's note, the evidence and
 * the decision. `evidence.deletedAt` is read live (the author may delete the
 * message after the report); the rest is the snapshot. Attachment object keys
 * stay on the server: a key is a name, not a capability.
 */
export function detail(
  r: ContentReport,
  staff: StaffNames,
  live: { deletedAt: Date | null; subjectName: string | null },
) {
  const e = (r.evidence ?? {}) as EvidenceSnapshot;
  return {
    ...queueRow(r, staff),
    subject: { kind: r.subjectKind as SubjectKind, id: r.subjectId, name: live.subjectName ?? e.author?.name ?? null },
    note: r.note,
    evidence: {
      type: e.type ?? null,
      body: e.body ?? null,
      attachments: (e.attachments ?? []).map((a) => ({ kind: a.kind ?? null, mimeType: a.mimeType ?? null, byteSize: a.byteSize ?? null, name: a.name ?? null })),
      author: { kind: e.author?.kind ?? r.subjectKind, name: e.author?.name ?? null },
      sentAt: e.sentAt ?? null,
      editedAt: e.editedAt ?? null,
      forwarded: e.forwarded ?? false,
      deletedAt: live.deletedAt?.toISOString() ?? null,
    },
    takenAt: r.takenAt?.toISOString() ?? null,
    resolution: (r.resolution as Resolution | null) ?? null,
    resolutionNote: r.resolutionNote,
    resolvedBy: r.resolvedBy,
    resolvedByName: r.resolvedBy ? (staff.get(r.resolvedBy) ?? null) : null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    answerText: r.answerText,
  };
}

/** POST take / resolve: the row and the decision, without the evidence (reading it is a view of its own). */
export function decisionRow(r: ContentReport, staff: StaffNames) {
  return {
    ...queueRow(r, staff),
    takenAt: r.takenAt?.toISOString() ?? null,
    resolution: (r.resolution as Resolution | null) ?? null,
    resolutionNote: r.resolutionNote,
    resolvedBy: r.resolvedBy,
    resolvedByName: r.resolvedBy ? (staff.get(r.resolvedBy) ?? null) : null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    answerText: r.answerText,
  };
}

export interface ResolveInput {
  resolution: Resolution;
  note: string | null;
  answer: string;
}

const RESOLVE_KEYS = new Set(['resolution', 'note', 'answer']);

/** `{resolution, note?, answer}`: the answer to the reporter is required (<= 1000), the staff note optional (<= 2000). */
export function parseResolveInput(body: Record<string, unknown>): ResolveInput {
  const extra = Object.keys(body).filter((k) => !RESOLVE_KEYS.has(k));
  if (extra.length) throw invalid(`unknown field: ${extra.sort().join(', ')}`);
  if (typeof body.resolution !== 'string' || !(RESOLUTIONS as readonly string[]).includes(body.resolution)) {
    throw invalid(`resolution: must be one of ${RESOLUTIONS.join(', ')}`);
  }
  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  if (!answer) throw invalid('answer: the answer to the reporter is required');
  if (answer.length > ANSWER_MAX) throw invalid(`answer: must be at most ${ANSWER_MAX} characters`);
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string') throw invalid('note: must be text');
    note = body.note.trim() || null;
    if (note && note.length > RESOLUTION_NOTE_MAX) throw invalid(`note: must be at most ${RESOLUTION_NOTE_MAX} characters`);
  }
  return { resolution: body.resolution as Resolution, note, answer };
}

export interface QueueFilter {
  status?: ReportStatus;
  priority?: 'urgent' | 'normal';
  overdue?: boolean;
}

/** `?status&priority&overdue` (overdue: true | false). Anything else is a 400. */
export function parseQueueFilter(query: { status?: string; priority?: string; overdue?: string }): QueueFilter {
  const filter: QueueFilter = {};
  if (query.status !== undefined && query.status !== '') {
    if (!(REPORT_STATUSES as readonly string[]).includes(query.status)) throw invalid(`status: must be one of ${REPORT_STATUSES.join(', ')}`);
    filter.status = query.status as ReportStatus;
  }
  if (query.priority !== undefined && query.priority !== '') {
    if (query.priority !== 'urgent' && query.priority !== 'normal') throw invalid('priority: must be urgent or normal');
    filter.priority = query.priority;
  }
  if (query.overdue !== undefined && query.overdue !== '') {
    if (query.overdue !== 'true' && query.overdue !== 'false') throw invalid('overdue: must be true or false');
    filter.overdue = query.overdue === 'true';
  }
  return filter;
}

/** The staff ids a set of rows names (takers and resolvers), for one name lookup. */
export function staffIdsOf(rows: readonly ContentReport[]): string[] {
  return [...new Set(rows.flatMap((r) => [r.takenBy, r.resolvedBy].filter((x): x is string => typeof x === 'string')))];
}
