/**
 * ADMIN-003 -- a Story may not single out a family outside its author's staff
 * scope (QA AR-STY-04: sup.mona sent one to a family she cannot open, and the
 * parent's feed showed it).
 *
 *   single-family clauses   `family`, `contact` (one of its people) and
 *                           `conversation` (its student group) each need the
 *                           author to reach that family as staff
 *                           (chat.staff_reaches_family): refused otherwise,
 *                           exactly as a nonexistent id is
 *   in reach                the family's own supervisor, the super admin
 *   broadcasts              all_families / segment are unchanged
 *   publish                 re-resolves: a draft made in reach is refused at
 *                           publish once the family has moved out of it
 *
 * Synthetic fixtures only (G-16).
 */
import { randomUUID } from 'node:crypto';
import { CommError, CommErrorCode } from '@platform/errors';
import { StoryAudienceKind } from '@communication/contracts/vocab';
import { buildGraph, seed, truncate, type Scenario } from './harness';

jest.setTimeout(120_000);

const g = buildGraph();
const { prisma, stories } = g;

let s: Scenario;
let superId: string;
let groupId: string;

type Clause = { kind: string; refId?: string | null };
async function answer(authorId: string, audiences: Clause[]): Promise<string> {
  try {
    await stories.create(authorId, { body: 'hello', audiences });
    return 'created';
  } catch (e) {
    if (e instanceof CommError) return e.code;
    throw e;
  }
}
async function messageOf(authorId: string, audiences: Clause[]): Promise<string> {
  try {
    await stories.create(authorId, { body: 'hello', audiences });
    return 'created';
  } catch (e) {
    return (e as Error).message.replace(/[0-9a-f-]{36}/, '<id>');
  }
}

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(prisma);
  // seed(): admin_a (ownerId) supervises family_x's children; admin_b (otherAdminId) does not.
  s = await seed(prisma);
  g.coverage.onDutyId = s.ownerId;
  groupId = (await g.conversations.ensureStudentGroup(s.learnerId, s.ownerId)).id;
  superId = randomUUID();
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role, is_active) values ($1::uuid, 'sa_s', 'super_admin', true)`, superId),
  ]);
});

const reach = async (staffId: string, familyId: string) =>
  (await prisma.$queryRaw<Array<{ r: string | null }>>`SELECT chat.staff_reaches_family(${staffId}::uuid, ${familyId}::uuid, now()) AS r`)[0]!.r;

describe('ADMIN-003: a Story singles out only a family its author reaches', () => {
  it('the fixture: admin_b does not reach family_x; admin_a and the super admin do', async () => {
    expect(await reach(s.otherAdminId, s.familyId)).toBeNull();
    expect(await reach(s.ownerId, s.familyId)).not.toBeNull();
    expect(await reach(superId, s.familyId)).not.toBeNull();
  });

  it('out of reach: the family, one of its parents and its student group are each refused', async () => {
    for (const clause of [
      { kind: StoryAudienceKind.FAMILY, refId: s.familyId },
      { kind: StoryAudienceKind.CONTACT, refId: s.parentId },
      { kind: StoryAudienceKind.CONVERSATION, refId: groupId },
    ]) {
      expect({ clause: clause.kind, answer: await answer(s.otherAdminId, [clause]) }).toEqual({
        clause: clause.kind,
        answer: CommErrorCode.STORY_AUDIENCE_INVALID,
      });
    }
    // Nothing reached the family: no story, no recipient row.
    expect(await prisma.storyRecipient.count({ where: { actorId: s.parentId } })).toBe(0);
  });

  it('refused exactly as a nonexistent id: it tells nothing about another supervisor\'s families', async () => {
    expect(await messageOf(s.otherAdminId, [{ kind: StoryAudienceKind.FAMILY, refId: s.familyId }]))
      .toBe(await messageOf(s.otherAdminId, [{ kind: StoryAudienceKind.FAMILY, refId: randomUUID() }]));
  });

  it('in reach -- the family\'s own supervisor and the super admin -- each clause is allowed and reaches the parent', async () => {
    for (const author of [s.ownerId, superId]) {
      for (const clause of [
        { kind: StoryAudienceKind.FAMILY, refId: s.familyId },
        { kind: StoryAudienceKind.CONTACT, refId: s.parentId },
        { kind: StoryAudienceKind.CONVERSATION, refId: groupId },
      ]) {
        expect({ author, clause: clause.kind, answer: await answer(author, [clause]) }).toEqual({ author, clause: clause.kind, answer: 'created' });
      }
    }
    const draft = await stories.create(s.ownerId, { body: 'for family_x', audiences: [{ kind: StoryAudienceKind.FAMILY, refId: s.familyId }] });
    await stories.publish(draft.id, s.ownerId);
    expect((await stories.feed(s.parentId)).map((x: { id: string }) => x.id)).toContain(draft.id);
  });

  it('broadcast clauses are unchanged: admin_b may still send to all families', async () => {
    expect(await answer(s.otherAdminId, [{ kind: StoryAudienceKind.ALL_FAMILIES }])).toBe('created');
  });

  it('publish re-checks: a draft made in reach is refused once the family has left the author\'s reach', async () => {
    const draft = await stories.create(s.ownerId, { body: 'later', audiences: [{ kind: StoryAudienceKind.FAMILY, refId: s.familyId }] });
    // family_x's children move to admin_b: admin_a reaches it no more.
    await prisma.$executeRawUnsafe(`update chat.learner_supervision set supervisor_id = $1::uuid where learner_id in (select id from chat.learner where family_id = $2::uuid)`,
      s.otherAdminId, s.familyId);
    expect(await reach(s.ownerId, s.familyId)).toBeNull();
    await expect(stories.publish(draft.id, s.ownerId)).rejects.toMatchObject({ code: CommErrorCode.STORY_AUDIENCE_INVALID });
    expect(await prisma.storyRecipient.count({ where: { actorId: s.parentId } })).toBe(0);
  });
});
