import type { AppreciationCertificate, AppreciationCertificateEvent, AppreciationCertificateFile, CertificateStoryConsent, CertificateType } from '@prisma/client';
import { CertificateState } from '../communication/contracts/vocab';
import type { CertificateAct } from '../platform/pd041-policy';

/**
 * PD-41: what the Certificates page reads. Two shapes, built from the same
 * view the service assembles:
 *   - the FULL record, for the requester's side (a requester, their cover, an
 *     overseer);
 *   - the DESIGN projection, for an account that only designs. It is an
 *     allow-list (DESIGN_DTO_KEYS, pinned by pd041-certificate-dto.spec.ts): no
 *     learner or teacher id, no family, no internal note, no delivery group, no
 *     consent, no Story -- only what goes on the certificate and the job itself.
 *
 * Pure.
 */

export interface CertificateView {
  row: AppreciationCertificate;
  type: CertificateType | null;
  learner: { id: string; name: string } | null;
  recipientTeacher: { id: string; name: string } | null;
  signatory: { id: string; name: string } | null;
  /** Staff and teacher names by id, for every person the row names. */
  names: ReadonlyMap<string, string>;
  currentFile: AppreciationCertificateFile | null;
  files: readonly AppreciationCertificateFile[];
  latestConsent: CertificateStoryConsent | null;
  history: readonly AppreciationCertificateEvent[] | null;
  acts: readonly CertificateAct[];
}

/** The page's four lists (owner: Pending, In progress, Completed, Sent), plus suggestions and closed. */
export function stateGroupOf(state: string): 'suggested' | 'pending' | 'in_progress' | 'completed' | 'sent' | 'closed' {
  switch (state) {
    case CertificateState.PROPOSED:
      return 'suggested';
    case CertificateState.REQUESTED:
      return 'pending';
    case CertificateState.IN_DESIGN:
    case CertificateState.CHANGES_REQUESTED:
      return 'in_progress';
    case CertificateState.UPLOADED:
    case CertificateState.APPROVED:
      return 'completed';
    case CertificateState.SENT:
      return 'sent';
    default:
      return 'closed';
  }
}

export const STATES_OF_GROUP: Readonly<Record<string, readonly string[]>> = {
  suggested: [CertificateState.PROPOSED],
  pending: [CertificateState.REQUESTED],
  in_progress: [CertificateState.IN_DESIGN, CertificateState.CHANGES_REQUESTED],
  completed: [CertificateState.UPLOADED, CertificateState.APPROVED],
  sent: [CertificateState.SENT],
  closed: [CertificateState.CANCELLED, CertificateState.DECLINED],
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

function person(names: ReadonlyMap<string, string>, id: string | null) {
  return id ? { id, name: names.get(id) ?? '' } : null;
}

function typeDto(t: CertificateType | null) {
  return t ? { id: t.id, key: t.key, labelEn: t.labelEn, labelAr: t.labelAr, isActive: t.isActive, needsJuz: t.needsJuz, needsPeriod: t.needsPeriod } : null;
}

function fileDto(f: AppreciationCertificateFile, names: ReadonlyMap<string, string>, withUploader: boolean) {
  return {
    id: f.id,
    revision: f.revision,
    fileName: f.fileName,
    mimeType: f.mimeType,
    byteSize: f.byteSize,
    uploadedAt: f.uploadedAt.toISOString(),
    ...(withUploader ? { uploadedBy: person(names, f.uploadedBy) } : {}),
  };
}

/** Acts whose note says what to change, which a Designer reads. */
const NOTES_FOR_DESIGN: ReadonlySet<string> = new Set(['returned', 'redesign_requested', 'approval_withdrawn']);
/** The family's consent and the Story are the requester's business, not the Designer's. */
const HIDDEN_FROM_DESIGN = /^(consent_|story_)/;

export function toFullDto(v: CertificateView) {
  const r = v.row;
  return {
    projection: 'full' as const,
    id: r.id,
    category: r.category,
    type: typeDto(v.type),
    state: r.state,
    stateGroup: stateGroupOf(r.state),
    learner: v.learner,
    teacher: v.recipientTeacher,
    signatoryTeacher: v.signatory,
    requestedBy: person(v.names, r.requestedByStaff),
    suggestedBy: person(v.names, r.suggestedByTeacher),
    title: r.title,
    achievement: r.achievement,
    achievedOn: day(r.achievedOn),
    grade: r.grade,
    printedName: r.printedName,
    juz: r.juz,
    periodStart: day(r.periodStart),
    periodEnd: day(r.periodEnd),
    designerNote: r.designerNote,
    internalNote: r.internalNote,
    publishStory: r.publishStory,
    requestedAt: r.requestedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    assignedDesigner: person(v.names, r.assignedDesignerId),
    designStartedAt: iso(r.designStartedAt),
    returnMessage: r.returnMessage,
    currentFile: v.currentFile ? fileDto(v.currentFile, v.names, true) : null,
    files: v.files.map((f) => fileDto(f, v.names, true)),
    approval: r.approvedFileId ? { fileId: r.approvedFileId, by: person(v.names, r.approvedBy), at: iso(r.approvedAt) } : null,
    sent: r.sentAt ? { at: iso(r.sentAt), by: person(v.names, r.sentBy), conversationId: r.conversationId } : null,
    suggestion: r.suggestedByTeacher
      ? { decidedAt: iso(r.decidedAt), decidedBy: person(v.names, r.decidedBy), declineReason: r.declineReason }
      : null,
    consent: v.latestConsent
      ? { kind: v.latestConsent.kind, method: v.latestConsent.method, recordedAt: v.latestConsent.recordedAt.toISOString(), recordedBy: person(v.names, v.latestConsent.recordedBy) }
      : null,
    story: r.storyId ? { id: r.storyId, publishedAt: iso(r.storyPublishedAt), withdrawnAt: iso(r.storyWithdrawnAt) } : null,
    cancelled: r.cancelledAt ? { at: iso(r.cancelledAt), by: person(v.names, r.cancelledBy), reason: r.cancelReason } : null,
    actions: [...v.acts],
    history: v.history
      ? v.history.map((e) => ({
          seq: e.seq,
          kind: e.kind,
          fromState: e.fromState,
          toState: e.toState,
          actor: e.actorStaffId ? person(v.names, e.actorStaffId) : person(v.names, e.actorTeacherId),
          actorKind: e.actorStaffId ? 'staff' : 'teacher',
          note: e.note,
          before: e.before,
          after: e.after,
          at: e.at.toISOString(),
        }))
      : undefined,
  };
}

/** Every key the design projection may carry. Nothing else, ever. */
export const DESIGN_DTO_KEYS = [
  'projection',
  'id',
  'category',
  'type',
  'state',
  'stateGroup',
  'title',
  'achievement',
  'achievedOn',
  'grade',
  'printedName',
  'signatoryName',
  'juz',
  'periodStart',
  'periodEnd',
  'designerNote',
  'requesterName',
  'requestedAt',
  'assignedDesigner',
  'designStartedAt',
  'returnMessage',
  'currentFile',
  'files',
  'delivered',
  'actions',
  'history',
] as const;

export function toDesignDto(v: CertificateView) {
  const r = v.row;
  const dto: Record<(typeof DESIGN_DTO_KEYS)[number], unknown> = {
    projection: 'design',
    id: r.id,
    category: r.category,
    type: typeDto(v.type),
    state: r.state,
    stateGroup: stateGroupOf(r.state),
    title: r.title,
    achievement: r.achievement,
    achievedOn: day(r.achievedOn),
    grade: r.grade,
    printedName: r.printedName,
    // The signature line of a student certificate: a name, never an id.
    signatoryName: v.signatory?.name ?? null,
    juz: r.juz,
    periodStart: day(r.periodStart),
    periodEnd: day(r.periodEnd),
    designerNote: r.designerNote,
    requesterName: r.requestedByStaff ? (v.names.get(r.requestedByStaff) ?? null) : null,
    requestedAt: r.requestedAt.toISOString(),
    assignedDesigner: person(v.names, r.assignedDesignerId),
    designStartedAt: iso(r.designStartedAt),
    returnMessage: r.returnMessage,
    currentFile: v.currentFile ? fileDto(v.currentFile, v.names, false) : null,
    files: v.files.map((f) => fileDto(f, v.names, false)),
    // "Sent ✓" -- never where to, nor when the Story went out.
    delivered: r.state === CertificateState.SENT,
    actions: [...v.acts],
    history: v.history
      ? v.history.filter((e) => !HIDDEN_FROM_DESIGN.test(e.kind)).map((e) => ({
          seq: e.seq,
          kind: e.kind,
          fromState: e.fromState,
          toState: e.toState,
          note: NOTES_FOR_DESIGN.has(e.kind) ? e.note : null,
          at: e.at.toISOString(),
        }))
      : undefined,
  };
  return dto;
}
