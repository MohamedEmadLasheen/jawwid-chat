/**
 * TEACHER-025 -- a teacher's certificate suggestion (QA T-CERT-01): the server
 * took a future achievement date and the same suggestion three times, filling
 * the supervisor's queue with duplicates. The app's picker limits the date;
 * the server now does too, and refuses a duplicate as it does for staff.
 *
 *   date        never in the future; at most five years back (the app's picker:
 *               1 January five years ago .. today), measured on the widest
 *               calendars so no device's "today" is refused
 *   duplicate   the same child, title and achievement (case and spacing aside),
 *               still open: 409 CERTIFICATE_DUPLICATE naming the first;
 *               a declined or cancelled one does not count; a double submit
 *               at once makes one
 *
 * Synthetic fixtures only (G-16).
 */
import { PrismaAuditService } from '@platform/audit.service';
import { CommError, CommErrorCode } from '@platform/errors';
import { PermissionService } from '@platform/permissions/permission.service';
import { SupervisionConversationService } from '../../src/supervision/supervision-conversation.service';
import { CardPoster } from '../../src/supervision/card-poster';
import { CertificateService } from '../../src/certificates/certificate.service';
import { buildGraph, seed, truncate, Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const audit = new PrismaAuditService();
const supervision = new SupervisionConversationService(g.prisma, g.authz, g.conversations, g.outbox, audit);
const cards = new CardPoster(g.conversations, g.outbox, audit);
const certificates = new CertificateService(g.prisma, g.conversations, supervision, cards, g.storage, audit, new PermissionService(g.prisma), g.stories);

let s: Scenario;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const suggestion = (over: Record<string, unknown> = {}) => ({
  learnerId: s.learnerId,
  title: 'Juz Amma part 1',
  achievement: 'Memorized the first half of Juz Amma',
  achievedOn: daysFromNow(-3),
  printedName: 'learner_l',
  ...over,
});
async function answer(p: Promise<unknown>): Promise<{ code: string; message?: string; detail?: unknown } | 'created'> {
  try {
    await p;
    return 'created';
  } catch (e) {
    if (e instanceof CommError) return { code: e.code, message: e.message, detail: (e as CommError & { detail?: unknown }).detail };
    throw e;
  }
}
const proposals = () => g.prisma.appreciationCertificate.count({ where: { learnerId: s.learnerId } });

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  // seed(): teacher_c teaches learner_l.
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
});

describe('TEACHER-025: the achievement date', () => {
  it('today and a date in the past are accepted; tomorrow-and-beyond and 2027-01-01 (QA) are refused', async () => {
    expect(await answer(certificates.suggest(s.teacherId, suggestion({ achievedOn: daysFromNow(0) })))).toBe('created');
    expect(await answer(certificates.suggest(s.teacherId, suggestion({ title: 'Another', achievedOn: daysFromNow(-400) })))).toBe('created');
    for (const achievedOn of [daysFromNow(2), daysFromNow(30), '2027-01-01'].filter((d) => d > daysFromNow(1))) {
      expect(await answer(certificates.suggest(s.teacherId, suggestion({ title: `Future ${achievedOn}`, achievedOn })))).toMatchObject({
        code: CommErrorCode.VALIDATION,
        message: 'achievedOn: an achievement date is not in the future',
      });
    }
    expect(await proposals()).toBe(2);
  });

  it('at most five years back, from 1 January -- as the app\'s picker offers', async () => {
    const year = new Date().getUTCFullYear();
    expect(await answer(certificates.suggest(s.teacherId, suggestion({ achievedOn: `${year - 5}-01-02` })))).toBe('created');
    expect(await answer(certificates.suggest(s.teacherId, suggestion({ title: 'Older', achievedOn: `${year - 6}-12-31` })))).toMatchObject({
      code: CommErrorCode.VALIDATION,
      message: 'achievedOn: at most five years ago',
    });
  });
});

describe('TEACHER-025: the same suggestion twice', () => {
  it('is refused while the first is open, naming it; case and spacing do not make it new', async () => {
    const first = await certificates.suggest(s.teacherId, suggestion());
    for (const over of [{}, { title: '  juz amma   PART 1 ', achievement: 'memorized the first half of juz  amma' }]) {
      expect(await answer(certificates.suggest(s.teacherId, suggestion(over)))).toMatchObject({
        code: CommErrorCode.CERTIFICATE_DUPLICATE,
        detail: { certificateId: first.certificate.id },
      });
    }
    expect(await proposals()).toBe(1);
  });

  it('another achievement for the same child is not a duplicate', async () => {
    await certificates.suggest(s.teacherId, suggestion());
    expect(await answer(certificates.suggest(s.teacherId, suggestion({ achievement: 'Memorized the second half of Juz Amma' })))).toBe('created');
  });

  it('a declined suggestion may be suggested again', async () => {
    const first = await certificates.suggest(s.teacherId, suggestion());
    // The child's Operations supervisor decides a teacher's suggestion (PD-41).
    await certificates.decline(s.ownerId, first.certificate.id, { reason: 'not this term, try again later' });
    expect(await answer(certificates.suggest(s.teacherId, suggestion()))).toBe('created');
  });

  it('a double submit at once makes ONE suggestion', async () => {
    const both = await Promise.all([answer(certificates.suggest(s.teacherId, suggestion())), answer(certificates.suggest(s.teacherId, suggestion()))]);
    expect(both.filter((x) => x === 'created')).toHaveLength(1);
    expect(both.filter((x) => x !== 'created')).toEqual([expect.objectContaining({ code: CommErrorCode.CERTIFICATE_DUPLICATE })]);
    expect(await proposals()).toBe(1);
  });
});
