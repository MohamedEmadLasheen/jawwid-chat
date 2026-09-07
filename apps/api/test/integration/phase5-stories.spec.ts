/**
 * PHASE 5 -- stories, their audiences, and who may publish one.
 *
 * The two properties the whole feature rests on:
 *
 *   PUBLISHING IS RESTRICTED  -- Manager/Admin, checked server-side against
 *                                effective permissions, never a client role.
 *   VISIBILITY IS RESOLVED    -- server-side, once, into chat.story_recipient.
 *                                There is no query anywhere that returns a
 *                                story to somebody outside its audience, so
 *                                there is nothing for a client to filter.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { AudienceKind, StoryState } from '@communication/contracts/vocab';

const prisma = new PrismaService();
const g = buildGraph();
let s: Scenario;

const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
  g.coverage.onDutyId = s.ownerId;
});
afterAll(async () => {
  await truncate(prisma);
  await prisma.$disconnect();
});

const draft = (audiences: Array<{ kind: string; refId?: string | null }>) => ({
  title: 'Eid holiday',
  body: 'The academy is closed on Monday.',
  audiences,
});

describe('who may publish', () => {
  it('a manager may', async () => {
    const story = await g.stories.create(s.managerId, draft([{ kind: AudienceKind.ALL_FAMILIES }]));
    const published = await g.stories.publish(story.id, s.managerId);
    expect(published.state).toBe(StoryState.PUBLISHED);
  });

  it('an admin may, narrowed to their own families by scope', async () => {
    const story = await g.stories.create(
      s.ownerId,
      draft([{ kind: AudienceKind.ASSIGNED_FAMILIES }]),
    );
    const published = await g.stories.publish(story.id, s.ownerId);
    expect(published.state).toBe(StoryState.PUBLISHED);
    expect(published.recipientCount).toBeGreaterThan(0);
  });

  it('a TEACHER may not publish', async () => {
    await expect(
      g.stories.create(s.teacherId, draft([{ kind: AudienceKind.ALL_FAMILIES }])),
    ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
  });

  it('a PARENT may not publish', async () => {
    await expect(
      g.stories.create(s.parentId, draft([{ kind: AudienceKind.ALL_FAMILIES }])),
    ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
  });

  it('a per-account DENY beats the role default', async () => {
    // Publishing is checked against EFFECTIVE permissions, so restricting one
    // manager does not require inventing a role for them.
    await prisma.$executeRawUnsafe(
      `insert into chat.account_permission_override (account_id, permission, effect, reason)
       values ('${s.accounts[s.managerId]}'::uuid, 'stories.publish', 'deny', 'under review')`,
    );
    await expect(
      g.stories.create(s.managerId, draft([{ kind: AudienceKind.ALL_FAMILIES }])),
    ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
  });
});

describe('audience resolution', () => {
  it('an ADMIN cannot target every family in the academy', async () => {
    // For a supervisor, "everyone" would silently mean "my families", which is
    // a different message than the one they think they are sending.
    await expect(
      g.stories.create(s.ownerId, draft([{ kind: AudienceKind.ALL_FAMILIES }])),
    ).rejects.toMatchObject({ code: CommErrorCode.AUDIENCE_TOO_BROAD });
  });

  it('resolves a LABEL to the families carrying it', async () => {
    const manager = await actorOf(s.managerId);
    const label = await g.labels.create(manager, { name: 'Installments' });
    await g.labels.addFamilies(manager, label.id, [s.familyId]);

    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.LABEL, refId: label.id }]),
    );
    const published = await g.stories.publish(story.id, s.managerId);

    const recipients = await prisma.storyRecipient.findMany({ where: { storyId: story.id } });
    expect(recipients.map((r) => r.actorId).sort()).toEqual([s.parentId, s.otherParentId].sort());
    expect(published.recipientCount).toBe(2);
  });

  it('resolves a GROUP to the families of its current members', async () => {
    const manager = await actorOf(s.managerId);
    const group = await g.groups.create(manager, { name: 'Thursday', ownerId: s.ownerId });
    await g.groups.addMember(manager, group.id, s.learnerId);

    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.GROUP, refId: group.id }]),
    );
    await g.stories.publish(story.id, s.managerId);

    const recipients = await prisma.storyRecipient.findMany({ where: { storyId: story.id } });
    expect(recipients.map((r) => r.actorId).sort()).toEqual([s.parentId, s.otherParentId].sort());
  });

  it('resolves a TEACHER audience', async () => {
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.ALL_TEACHERS }]),
    );
    await g.stories.publish(story.id, s.managerId);

    const recipients = await prisma.storyRecipient.findMany({ where: { storyId: story.id } });
    expect(recipients.map((r) => r.actorId).sort()).toEqual(
      [s.teacherId, s.newTeacherId].sort(),
    );
  });

  it('resolves a NAMED USER without dragging in their whole household', async () => {
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.USER, refId: s.parentId }]),
    );
    await g.stories.publish(story.id, s.managerId);

    const recipients = await prisma.storyRecipient.findMany({ where: { storyId: story.id } });
    expect(recipients.map((r) => r.actorId)).toEqual([s.parentId]);
  });

  it('MULTIPLE audiences combine, and an overlapping person appears ONCE', async () => {
    // The deduplication requirement, exactly as the brief states it: family +
    // group + label all matching the same household is one recipient.
    const manager = await actorOf(s.managerId);
    const label = await g.labels.create(manager, { name: 'Installments' });
    await g.labels.addFamilies(manager, label.id, [s.familyId]);
    const group = await g.groups.create(manager, { name: 'Thursday', ownerId: s.ownerId });
    await g.groups.addMember(manager, group.id, s.learnerId);

    const story = await g.stories.create(
      s.managerId,
      draft([
        { kind: AudienceKind.FAMILY, refId: s.familyId },
        { kind: AudienceKind.GROUP, refId: group.id },
        { kind: AudienceKind.LABEL, refId: label.id },
        { kind: AudienceKind.ALL_TEACHERS },
      ]),
    );
    const published = await g.stories.publish(story.id, s.managerId);

    const recipients = await prisma.storyRecipient.findMany({ where: { storyId: story.id } });
    // Two contacts + two teachers. Not six.
    expect(recipients).toHaveLength(4);
    expect(published.recipientCount).toBe(4);
    expect(new Set(recipients.map((r) => r.actorId)).size).toBe(4);
  });

  it('is deterministic -- the same audience resolves identically every time', async () => {
    const manager = await actorOf(s.managerId);
    const clauses = [
      { kind: AudienceKind.ALL_FAMILIES },
      { kind: AudienceKind.ALL_TEACHERS },
    ];
    const first = await g.audience.resolve(manager, clauses);
    const second = await g.audience.resolve(manager, clauses);
    expect(first.recipients.map((r) => r.actorId)).toEqual(
      second.recipients.map((r) => r.actorId),
    );
  });

  it('excludes an inactive contact', async () => {
    await prisma.contact.updateMany({
      where: { id: s.otherParentId },
      data: { isActive: false },
    });
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await g.stories.publish(story.id, s.managerId);

    const recipients = await prisma.storyRecipient.findMany({ where: { storyId: story.id } });
    expect(recipients.map((r) => r.actorId)).toEqual([s.parentId]);
  });

  it('excludes a contact who may not be messaged', async () => {
    await prisma.contact.updateMany({
      where: { id: s.otherParentId },
      data: { canMessage: false },
    });
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.FAMILY, refId: s.familyId }]),
    );
    await g.stories.publish(story.id, s.managerId);

    const recipients = await prisma.storyRecipient.findMany({ where: { storyId: story.id } });
    expect(recipients.map((r) => r.actorId)).toEqual([s.parentId]);
  });
});

describe('forged and out-of-scope targets', () => {
  it('a forged family id is refused', async () => {
    await expect(
      g.stories.create(s.managerId, draft([{ kind: AudienceKind.FAMILY, refId: randomUUID() }])),
    ).rejects.toMatchObject({ code: CommErrorCode.AUDIENCE_TARGET_NOT_FOUND });
  });

  it('a forged label id is refused', async () => {
    await expect(
      g.stories.create(s.managerId, draft([{ kind: AudienceKind.LABEL, refId: randomUUID() }])),
    ).rejects.toMatchObject({ code: CommErrorCode.AUDIENCE_TARGET_NOT_FOUND });
  });

  it('a REAL family outside the author’s scope is refused identically', async () => {
    // Same code as a forged id, deliberately: distinguishing them would turn
    // this into an existence oracle for other people's families.
    const otherFamily = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, language)
       values ('${otherFamily}'::uuid, 'family_y', '${s.otherAdminId}'::uuid, 'ar')`,
    );
    await expect(
      g.stories.create(s.ownerId, draft([{ kind: AudienceKind.FAMILY, refId: otherFamily }])),
    ).rejects.toMatchObject({ code: CommErrorCode.AUDIENCE_TARGET_NOT_FOUND });
  });

  it('an unknown audience kind is refused', async () => {
    await expect(
      g.stories.create(s.managerId, draft([{ kind: 'everyone_everywhere' }])),
    ).rejects.toMatchObject({ code: CommErrorCode.AUDIENCE_KIND_INVALID });
  });

  it('an audience kind that takes no id is refused when given one', async () => {
    await expect(
      g.stories.create(
        s.managerId,
        draft([{ kind: AudienceKind.ALL_FAMILIES, refId: randomUUID() }]),
      ),
    ).rejects.toMatchObject({ code: CommErrorCode.AUDIENCE_KIND_INVALID });
  });

  it('an empty audience is refused', async () => {
    await expect(g.stories.create(s.managerId, draft([]))).rejects.toMatchObject({
      code: CommErrorCode.AUDIENCE_EMPTY,
    });
  });
});

describe('visibility', () => {
  it('a story reaches its audience and NOBODY else', async () => {
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.USER, refId: s.parentId }]),
    );
    await g.stories.publish(story.id, s.managerId);

    expect((await g.stories.feed(s.parentId)).map((x) => x.id)).toContain(story.id);
    // The other parent is in the same FAMILY and still does not see it.
    expect((await g.stories.feed(s.otherParentId)).map((x) => x.id)).not.toContain(story.id);
    expect((await g.stories.feed(s.teacherId)).map((x) => x.id)).not.toContain(story.id);
  });

  it('a DRAFT is invisible to its intended audience', async () => {
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.ALL_FAMILIES }]),
    );
    expect((await g.stories.feed(s.parentId)).map((x) => x.id)).not.toContain(story.id);
  });

  it('an EXPIRED story drops out of the feed', async () => {
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.ALL_FAMILIES }]),
    );
    await g.stories.publish(story.id, s.managerId);
    expect((await g.stories.feed(s.parentId)).map((x) => x.id)).toContain(story.id);

    await prisma.story.updateMany({
      where: { id: story.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await g.stories.feed(s.parentId)).map((x) => x.id)).not.toContain(story.id);

    expect(await g.stories.expireDue()).toBe(1);
    const row = await prisma.story.findUniqueOrThrow({ where: { id: story.id } });
    expect(row.state).toBe(StoryState.EXPIRED);
  });

  it('the reader’s feed never carries the audience definition', async () => {
    // A parent learning that they were reached via "the Installments label"
    // learns how the academy files its customers.
    const manager = await actorOf(s.managerId);
    const label = await g.labels.create(manager, { name: 'Installments' });
    await g.labels.addFamilies(manager, label.id, [s.familyId]);
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.LABEL, refId: label.id }]),
    );
    await g.stories.publish(story.id, s.managerId);

    const feed = await g.stories.feed(s.parentId);
    const seen = feed.find((x) => x.id === story.id)!;
    expect(seen.audiences).toBeUndefined();
    expect(seen.recipientCount).toBeUndefined();
    expect(JSON.stringify(seen)).not.toContain(label.id);
  });
});

describe('views', () => {
  it('records a view, idempotently', async () => {
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.ALL_FAMILIES }]),
    );
    await g.stories.publish(story.id, s.managerId);

    await g.stories.markViewed(story.id, s.parentId);
    await g.stories.markViewed(story.id, s.parentId);

    expect(await prisma.storyView.count({ where: { storyId: story.id } })).toBe(1);
    expect((await g.stories.feed(s.parentId)).find((x) => x.id === story.id)!.viewed).toBe(true);
  });

  it('somebody outside the audience cannot mark a story viewed', async () => {
    // Otherwise this route is an oracle: post ids until one succeeds and the
    // academy's publications are enumerated.
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.USER, refId: s.parentId }]),
    );
    await g.stories.publish(story.id, s.managerId);

    await expect(g.stories.markViewed(story.id, s.otherParentId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
  });

  it('the DATABASE refuses a view from outside the audience', async () => {
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.USER, refId: s.parentId }]),
    );
    await g.stories.publish(story.id, s.managerId);

    await expect(
      prisma.$executeRawUnsafe(
        `insert into chat.story_view (story_id, actor_id)
         values ('${story.id}'::uuid, '${s.otherParentId}'::uuid)`,
      ),
    ).rejects.toThrow(/audience/);
  });
});

describe('publishing lifecycle', () => {
  it('publishing twice is refused', async () => {
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.ALL_FAMILIES }]),
    );
    await g.stories.publish(story.id, s.managerId);
    await expect(g.stories.publish(story.id, s.managerId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_ALREADY_PUBLISHED,
    });
  });

  it('a published story always has an expiry', async () => {
    const story = await g.stories.create(
      s.managerId,
      draft([{ kind: AudienceKind.ALL_FAMILIES }]),
    );
    const published = await g.stories.publish(story.id, s.managerId);
    expect(published.expiresAt).not.toBeNull();
    expect(published.publishedAt).not.toBeNull();
  });

  it('an admin cannot publish another admin’s draft', async () => {
    const story = await g.stories.create(
      s.ownerId,
      draft([{ kind: AudienceKind.ASSIGNED_FAMILIES }]),
    );
    await expect(g.stories.publish(story.id, s.otherAdminId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
  });

  it('a story with neither words nor media is refused', async () => {
    await expect(
      g.stories.create(s.managerId, {
        body: '   ',
        audiences: [{ kind: AudienceKind.ALL_FAMILIES }],
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_EMPTY });
  });
});
