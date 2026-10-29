/**
 * PD-41: the Designer's projection is an allow-list (design §6.4).
 *
 * A row that names everything -- the learner, the family's internal note, the
 * delivery group, consent, the Story -- must come out of toDesignDto with
 * exactly DESIGN_DTO_KEYS and none of those values anywhere inside.
 */
import type { AppreciationCertificate, AppreciationCertificateEvent, AppreciationCertificateFile, CertificateStoryConsent } from '@prisma/client';
import { DESIGN_DTO_KEYS, stateGroupOf, toDesignDto, toFullDto, type CertificateView } from '../../../src/certificates/certificate-dto';

const LEARNER = '22222222-2222-2222-2222-222222222222';
const TEACHER = '33333333-3333-3333-3333-333333333333';
const GROUP = '44444444-4444-4444-4444-444444444444';
const STORY = '55555555-5555-5555-5555-555555555555';
const SUPERVISOR = '66666666-6666-6666-6666-666666666666';
const DESIGNER = '77777777-7777-7777-7777-777777777777';

const at = new Date('2026-10-29T08:00:00.000Z');
const row = {
  id: '11111111-1111-1111-1111-111111111111',
  organizationId: '00000000-0000-0000-0000-000000000001',
  category: 'student',
  typeId: null,
  learnerId: LEARNER,
  recipientTeacherId: null,
  signatoryTeacherId: TEACHER,
  suggestedByTeacher: null,
  requestedByStaff: SUPERVISOR,
  requestKey: '88888888-8888-8888-8888-888888888888',
  title: 'Juz 30',
  achievement: 'Completed Juz 30',
  achievedOn: at,
  grade: 'Excellent',
  printedName: 'QA Child',
  internalNote: 'SECRET family context: the parents are separating',
  designerNote: 'gold border, Arabic only',
  juz: 30,
  periodStart: null,
  periodEnd: null,
  publishStory: true,
  state: 'sent',
  requestedAt: at,
  requestMessageId: null,
  decidedBy: null,
  decidedAt: null,
  declineReason: null,
  assignedDesignerId: DESIGNER,
  designStartedAt: at,
  currentFileId: 'f1',
  approvedFileId: 'f1',
  approvedBy: SUPERVISOR,
  approvedAt: at,
  returnMessage: null,
  conversationId: GROUP,
  sentMessageId: '99999999-9999-9999-9999-999999999999',
  sentAt: at,
  sentBy: SUPERVISOR,
  storyId: STORY,
  storyPublishedAt: at,
  storyPublishedBy: SUPERVISOR,
  storyWithdrawnAt: null,
  cancelledBy: null,
  cancelledAt: null,
  cancelReason: null,
  actionSeq: 9,
  lastAction: 'story_published',
  lastNote: null,
  lastActorStaff: SUPERVISOR,
  lastActorTeacher: null,
  updatedAt: at,
} as AppreciationCertificate;

const file = {
  id: 'f1',
  certificateId: row.id,
  revision: 1,
  objectKey: `certificates/${row.organizationId}/${row.id}/v/abc`,
  mimeType: 'image/png',
  byteSize: 1000,
  fileName: 'c.png',
  uploadedBy: DESIGNER,
  uploadedAt: at,
  deliveredObjectKey: `conversations/${GROUP}/def`,
} as AppreciationCertificateFile;

const ev = (seq: number, kind: string, note: string | null): AppreciationCertificateEvent =>
  ({ id: `e${seq}`, certificateId: row.id, seq, kind, fromState: 'x', toState: 'y', actorStaffId: SUPERVISOR, actorTeacherId: null, before: { internalNote: row.internalNote }, after: null, note, at }) as AppreciationCertificateEvent;

const view: CertificateView = {
  row,
  type: null,
  learner: { id: LEARNER, name: 'QA Child Record' },
  recipientTeacher: null,
  signatory: { id: TEACHER, name: 'QA Teacher' },
  names: new Map([
    [SUPERVISOR, 'QA Supervisor'],
    [DESIGNER, 'QA Designer'],
  ]),
  currentFile: file,
  files: [file],
  latestConsent: { id: 'c1', certificateId: row.id, kind: 'granted', givenByContactId: 'contact-1', method: 'phone', evidenceMessageId: null, note: 'SECRET consent note by phone', recordedBy: SUPERVISOR, recordedAt: at, actionSeq: 8 } as CertificateStoryConsent,
  history: [ev(1, 'requested', null), ev(2, 'returned', 'please use the full name'), ev(3, 'edited', null), ev(4, 'consent_granted', null), ev(5, 'cancelled', 'SECRET cancel reason here')],
  acts: [],
};

describe('PD-41: the design projection', () => {
  const dto = toDesignDto(view);
  const json = JSON.stringify(dto);

  it('carries exactly the allow-listed keys', () => {
    expect(Object.keys(dto).sort()).toEqual([...DESIGN_DTO_KEYS].sort());
  });

  it('names no learner, teacher id, family note, group, consent or Story', () => {
    for (const secret of [LEARNER, TEACHER, GROUP, STORY, 'SECRET', 'contact-1', file.objectKey, file.deliveredObjectKey!, 'QA Child Record']) {
      expect(json).not.toContain(secret);
    }
  });

  it('keeps what goes on the certificate and what to change', () => {
    expect(dto).toMatchObject({ printedName: 'QA Child', signatoryName: 'QA Teacher', designerNote: 'gold border, Arabic only', juz: 30, delivered: true });
    const history = dto.history as Array<{ kind: string; note: string | null }>;
    expect(history.map((h) => h.kind)).toEqual(['requested', 'returned', 'edited', 'cancelled']);
    expect(history.find((h) => h.kind === 'returned')?.note).toBe('please use the full name');
    expect(history.find((h) => h.kind === 'cancelled')?.note).toBeNull();
  });
});

describe('PD-41: the full record', () => {
  it('shows the requester side everything, but never an object key', () => {
    const json = JSON.stringify(toFullDto(view));
    expect(json).toContain(GROUP);
    expect(json).toContain('SECRET family context');
    expect(json).not.toContain(file.objectKey);
    expect(json).not.toContain(file.deliveredObjectKey!);
  });
});

describe('PD-41: the page\'s lists', () => {
  it.each`
    state                  | group
    ${'proposed'}          | ${'suggested'}
    ${'requested'}         | ${'pending'}
    ${'in_design'}         | ${'in_progress'}
    ${'changes_requested'} | ${'in_progress'}
    ${'uploaded'}          | ${'completed'}
    ${'approved'}          | ${'completed'}
    ${'sent'}              | ${'sent'}
    ${'cancelled'}         | ${'closed'}
    ${'declined'}          | ${'closed'}
  `('$state is $group', ({ state, group }) => {
    expect(stateGroupOf(state)).toBe(group);
  });
});
