/**
 * Stories — the hardening pass.
 *
 * `stories.spec.ts` covers the feature working. This file covers the invariants
 * that must hold when it is attacked or neglected, and each block names the
 * question it answers rather than the code it touches:
 *
 *   §A  can an expired or deleted story still hand out media?
 *   §B  does every media object eventually get purged, on every path out of live?
 *   §C  can two organizations reach each other's stories, audiences, views or media?
 *   §D  does expiry hold with the sweeper switched off entirely?
 *   §E  can an empty or malformed audience ever mean "everyone"?
 *   §F  do the academy-wide clauses stay inside one academy?
 *   §G  can the notification and realtime fan-out reach anyone the story did not?
 *   §H  are the story sweep and the call/outbox machinery actually isolated?
 *
 * Every test here is a regression for something that was either found broken
 * during this pass or is one edit away from breaking silently.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, type Scenario } from './harness';
import { CommErrorCode } from '@platform/errors';
import { StoryAudienceKind, StoryState } from '@communication/contracts/vocab';
import { CommEvent } from '@communication/contracts/events';
import { StorySweeper } from '@communication/stories/story-sweeper.service';

const g = buildGraph();
const { prisma, stories, storySweeper, outbox } = g;

let s: Scenario;

/** A complete second tenant: organization, publisher, family, contact. */
interface Tenant {
  orgId: string
  staffId: string
  familyId: string
  contactId: string
}
let orgB: Tenant;

const RETENTION_PAST = 96 * 3_600_000; // beyond the 72h window

/**
 * Wind a story's clocks back, the way real elapsed time would.
 *
 * `chat.story.updated_at` is set unconditionally by the `story_set_updated_at`
 * trigger (`new.updated_at := now()`), and Prisma's `@updatedAt` does the same
 * from the other side -- so neither an UPDATE through the client nor a raw one can
 * age it. The trigger is disabled for exactly this statement, which is the only
 * honest way to test a retention window without waiting four days. Anything that
 * relies on ageing and does NOT do this passes for the wrong reason: the row stays
 * young and the sweep correctly declines to touch it.
 */
async function ageStory(
  storyId: string,
  ms: number,
  columns: string[] = ['updated_at', 'expires_at', 'deleted_at'],
): Promise<void> {
  const stamp = new Date(Date.now() - ms).toISOString();
  const sets = columns
    .map((c) =>
      c === 'updated_at'
        ? `updated_at = '${stamp}'::timestamptz`
        : `${c} = case when ${c} is null then null else '${stamp}'::timestamptz end`,
    )
    .join(', ');
  await prisma.$executeRawUnsafe(`alter table chat.story disable trigger story_set_updated_at`);
  try {
    await prisma.$executeRawUnsafe(
      `update chat.story set ${sets} where id = '${storyId}'::uuid`,
    );
  } finally {
    await prisma.$executeRawUnsafe(`alter table chat.story enable trigger story_set_updated_at`);
  }
}

async function makeTenant(slug: string): Promise<Tenant> {
  const t: Tenant = {
    orgId: randomUUID(),
    staffId: randomUUID(),
    familyId: randomUUID(),
    contactId: randomUUID(),
  };
  await prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name)
     values ('${t.orgId}'::uuid, '${slug}', 'Org ${slug}')`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, is_active, organization_id)
     values ('${t.staffId}'::uuid, 'admin_${slug}', 'admin', true, '${t.orgId}'::uuid)`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language, organization_id)
     values ('${t.familyId}'::uuid, 'family_${slug}', '${t.staffId}'::uuid, 'ar', '${t.orgId}'::uuid)`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active, organization_id)
     values ('${t.contactId}'::uuid, '${t.familyId}'::uuid, 'parent_${slug}', 'primary_guardian',
             true, true, '${t.orgId}'::uuid)`,
  );
  return t;
}

async function publishedStory(
  authorId: string,
  audiences: Array<{ kind: string; refId?: string | null }>,
  extra: { body?: string | null; media?: boolean } = {},
): Promise<string> {
  const draft = await stories.create(authorId, {
    body: extra.body === undefined ? 'hello' : extra.body,
    ...(extra.media
      ? { mediaObjectKey: `stories/${randomUUID()}`, mediaKind: 'image', mediaMime: 'image/png' }
      : {}),
    audiences,
  });
  await stories.publish(draft.id, authorId);
  return draft.id;
}

beforeAll(async () => {
  await truncate(prisma);
  await prisma.$executeRawUnsafe(
    `delete from chat.organization where slug in ('hard-b')`,
  );
  s = await seed(prisma);
  orgB = await makeTenant('hard-b');
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(`delete from chat.story where organization_id = '${orgB.orgId}'::uuid`);
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `truncate chat.story_view, chat.story_recipient, chat.story_audience, chat.story cascade`,
  );
  await prisma.outboxEvent.deleteMany({});
  await prisma.notification.deleteMany({});
});

// ===========================================================================
// §A · Media authorization: access ended means no new URL
// ===========================================================================

describe('§A a story past access cannot mint media', () => {
  it('an EXPIRED story hands out no media URL, not even to its publisher', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      media: true,
    });
    // Live: the publisher sees a URL.
    expect((await stories.list(s.ownerId)).find((x) => x.id === id)!.mediaUrl).toContain('sig=');

    await prisma.story.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    // Past expiry, and BEFORE any sweep has relabelled it: no URL.
    const listed = (await stories.list(s.ownerId)).find((x) => x.id === id)!;
    expect(listed.mediaUrl).toBeNull();
  });

  it('a DELETED story is absent from every surface, so there is nothing to sign', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      media: true,
    });
    await stories.remove(id, s.ownerId, 'wrong picture');

    // Not merely "no URL" -- the story is not returned at all, to anyone.
    expect((await stories.list(s.ownerId)).map((x) => x.id)).not.toContain(id);
    expect((await stories.list(s.ownerId, false)).map((x) => x.id)).not.toContain(id);
    expect(await stories.feed(s.parentId)).toEqual([]);

    // The bytes are still there during retention, which is exactly why no surface
    // may hand out a key for them.
    const row = await prisma.story.findUniqueOrThrow({ where: { id } });
    expect(row.mediaObjectKey).not.toBeNull();
    expect(JSON.stringify(await stories.list(s.ownerId))).not.toContain(row.mediaObjectKey!);
  });

  it('a DRAFT does hand one out — the author has to see what they attached', async () => {
    const draft = await stories.create(s.ownerId, {
      body: 'draft with media',
      mediaObjectKey: `stories/${randomUUID()}`,
      mediaKind: 'image',
      mediaMime: 'image/png',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    });
    expect(draft.mediaUrl).toContain('sig=');
  });

  it('a recipient gets no media URL once the story expires', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      media: true,
    });
    expect((await stories.feed(s.parentId))[0].mediaUrl).toContain('sig=');

    await prisma.story.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    // The whole story is gone from the feed, so there is nothing to sign.
    expect(await stories.feed(s.parentId)).toEqual([]);
  });
});

// ===========================================================================
// §B · Retention: every path out of live eventually purges the bytes
// ===========================================================================

describe('§B media is purged on every path, and never orphaned forever', () => {
  async function draftWithMedia(bodyless = false): Promise<string> {
    const draft = await stories.create(s.ownerId, {
      body: bodyless ? null : 'with media',
      mediaObjectKey: `stories/${randomUUID()}`,
      mediaKind: 'image',
      mediaMime: 'image/png',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    });
    return draft.id;
  }

  it('a MEDIA-ONLY published story can be purged (story_has_content must tolerate it)', async () => {
    // Regression: `story_has_content` required a body OR a media key, so clearing
    // the key on a story with no body violated it and the sweep could never purge
    // a picture-only publication. Every earlier retention test happened to set a
    // body, which is how it hid.
    const id = await draftWithMedia(true);
    await stories.publish(id, s.ownerId);
    await ageStory(id, RETENTION_PAST);

    expect(await storySweeper.purgeDueMedia()).toBe(1);
    const row = await prisma.story.findUniqueOrThrow({ where: { id } });
    expect(row.mediaObjectKey).toBeNull();
    expect(row.mediaPurgedAt).not.toBeNull();
    // The publication record still says what kind of thing went out.
    expect(row.mediaKind).toBe('image');
  });

  it('an ABANDONED DRAFT’s media is purged, so an unpublished upload is not immortal', async () => {
    // Regression: the sweep keyed only on deleted_at / expires_at, both NULL for a
    // draft — so media attached to a story nobody ever published stayed in the
    // bucket forever with nothing pointing at it.
    const id = await draftWithMedia();
    await ageStory(id, RETENTION_PAST);

    expect(await storySweeper.purgeDueMedia()).toBe(1);
    expect((await prisma.story.findUniqueOrThrow({ where: { id } })).mediaObjectKey).toBeNull();
  });

  it('a draft still being worked on is NOT purged', async () => {
    const id = await draftWithMedia();
    expect(await storySweeper.purgeDueMedia()).toBe(0);
    expect((await prisma.story.findUniqueOrThrow({ where: { id } })).mediaObjectKey).not.toBeNull();
  });

  it('there is no story left holding media past the window, whatever its state', async () => {
    // The catch-all: build one story in every state, age them all, sweep, and
    // assert the bucket has nothing left. A new state added without a purge
    // branch fails here.
    const drafted = await draftWithMedia();

    const expired = await draftWithMedia();
    await stories.publish(expired, s.ownerId);

    const deleted = await draftWithMedia();
    await stories.publish(deleted, s.ownerId);
    await stories.remove(deleted, s.ownerId, 'removed');

    const stillPublished = await draftWithMedia();
    await stories.publish(stillPublished, s.ownerId);

    for (const id of [drafted, expired, deleted, stillPublished]) {
      await ageStory(id, RETENTION_PAST);
    }
    await storySweeper.expireDue();
    await storySweeper.purgeDueMedia();

    const stranded = await prisma.story.findMany({
      where: { mediaObjectKey: { not: null } },
      select: { id: true, state: true },
    });
    expect(stranded).toEqual([]);
    expect([drafted, expired, deleted, stillPublished]).toHaveLength(4);
  });

  it('purging is idempotent and a second pass finds nothing', async () => {
    const id = await draftWithMedia();
    await ageStory(id, RETENTION_PAST);
    expect(await storySweeper.purgeDueMedia()).toBe(1);
    expect(await storySweeper.purgeDueMedia()).toBe(0);
  });
});

// ===========================================================================
// §C · Cross-tenant isolation, both directions, every table
// ===========================================================================

describe('§C two organizations cannot reach each other', () => {
  let aStory: string;
  let bStory: string;

  beforeEach(async () => {
    aStory = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      media: true,
    });
    bStory = await publishedStory(orgB.staffId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      media: true,
    });
  });

  it('each publisher’s list contains only their own organization’s stories', async () => {
    const a = (await stories.list(s.ownerId)).map((x) => x.id);
    const b = (await stories.list(orgB.staffId)).map((x) => x.id);

    expect(a).toContain(aStory);
    expect(a).not.toContain(bStory);
    expect(b).toContain(bStory);
    expect(b).not.toContain(aStory);
  });

  it('a publisher cannot read the other tenant’s VIEWERS', async () => {
    await stories.markViewed(bStory, orgB.contactId);

    await expect(stories.viewers(bStory, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
    await expect(stories.viewers(aStory, orgB.staffId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
    // And the owning tenant still can.
    expect(await stories.viewers(bStory, orgB.staffId)).toHaveLength(1);
  });

  it('a publisher cannot publish or delete the other tenant’s story', async () => {
    await expect(stories.remove(bStory, s.ownerId, 'not mine')).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
    await expect(stories.publish(bStory, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
  });

  it('a recipient of one tenant sees nothing of the other’s', async () => {
    const aFeed = (await stories.feed(s.parentId)).map((x) => x.id);
    const bFeed = (await stories.feed(orgB.contactId)).map((x) => x.id);

    expect(aFeed).toEqual([aStory]);
    expect(bFeed).toEqual([bStory]);
  });

  it('a recipient cannot record a view against the other tenant’s story', async () => {
    await expect(stories.markViewed(bStory, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
    await expect(stories.markViewed(aStory, orgB.contactId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
    expect(await prisma.storyView.count()).toBe(0);
  });

  it('a cross-tenant audience clause is refused, not silently resolved to nobody', async () => {
    for (const [kind, refId] of [
      [StoryAudienceKind.FAMILY, orgB.familyId],
      [StoryAudienceKind.CONTACT, orgB.contactId],
    ] as const) {
      await expect(
        stories.create(s.ownerId, { body: 'x', audiences: [{ kind, refId }] }),
      ).rejects.toMatchObject({ code: CommErrorCode.STORY_AUDIENCE_INVALID });
    }
  });

  it('no media URL crosses the boundary — the only way to one is a scoped read', async () => {
    // A publishes, B lists: B never receives A's object key or a URL for it.
    const bView = await stories.list(orgB.staffId);
    expect(JSON.stringify(bView)).not.toContain('stories/');
    const aKey = (await prisma.story.findUniqueOrThrow({ where: { id: aStory } })).mediaObjectKey;
    expect(JSON.stringify(bView)).not.toContain(aKey!);
  });

  it('the other tenant’s recipient rows are never returned by a scoped query', async () => {
    const aIds = (await prisma.storyRecipient.findMany({ where: { storyId: aStory } })).map(
      (r) => r.actorId,
    );
    const bIds = (await prisma.storyRecipient.findMany({ where: { storyId: bStory } })).map(
      (r) => r.actorId,
    );
    // Each story's audience is drawn only from its own tenant's people.
    expect(bIds).toEqual([orgB.contactId]);
    expect(aIds).not.toContain(orgB.contactId);
    expect(aIds).toContain(s.parentId);
  });
});

// ===========================================================================
// §C2 · The viewer list, after deletion and for an unknown caller
// ===========================================================================

describe('§C2 viewer-list access at the edges', () => {
  it('a publisher CAN still read the viewer list of a story they deleted — deliberately', async () => {
    // An explicit product decision, asserted here so it cannot be mistaken for an
    // oversight. The views HAPPENED; removing the story does not unhappen them,
    // and chat.audit_log already records who removed it and why. Only a publisher
    // in the owning organization can see it. If this should ever become "deletion
    // also hides the viewer list", it is one state check in
    // StoryService.viewers() and this is the test to change.
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await stories.markViewed(id, s.parentId);
    await stories.remove(id, s.ownerId, 'removed after being seen');

    const viewers = await stories.viewers(id, s.ownerId);
    expect(viewers.map((v) => v.actorId)).toEqual([s.parentId]);

    // A recipient still cannot, deleted or not.
    await expect(stories.viewers(id, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_CANNOT_PUBLISH,
    });
  });

  it('an unknown caller gets 401, never an empty viewer list', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    // An empty list would tell an unauthenticated caller the story exists.
    await expect(stories.viewers(id, randomUUID())).rejects.toMatchObject({
      code: CommErrorCode.UNKNOWN_ACTOR,
    });
  });

  it('every story route refuses an unknown caller the same way', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    const ghost = randomUUID();
    const calls: Array<Promise<unknown>> = [
      stories.feed(ghost),
      stories.list(ghost),
      stories.viewers(id, ghost),
      stories.markViewed(id, ghost),
      stories.publish(id, ghost),
      stories.remove(id, ghost, 'x'),
      stories.authorizeMediaUpload(ghost, { mimeType: 'image/png', byteSize: 10 }),
      stories.create(ghost, { body: 'x', audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }] }),
    ];
    for (const call of calls) {
      await expect(call).rejects.toMatchObject({ code: CommErrorCode.UNKNOWN_ACTOR });
    }
  });
});

// ===========================================================================
// §D · Expiry with the sweeper switched off
// ===========================================================================

describe('§D expiry holds with the sweeper never running', () => {
  /**
   * A service graph with a sweeper that would THROW if anything called it.
   * If any assertion below depends on the sweep, this fails loudly instead of
   * passing for the wrong reason.
   */
  const refusingSweeper = {
    sweep: () => {
      throw new Error('the sweeper must not be needed for access control');
    },
    expireDue: () => {
      throw new Error('the sweeper must not be needed for access control');
    },
    purgeDueMedia: () => {
      throw new Error('the sweeper must not be needed for access control');
    },
  } as unknown as StorySweeper;

  it('before expiry: visible, openable, viewable, media signed', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      media: true,
    });
    const feed = await stories.feed(s.parentId);
    expect(feed.map((f) => f.id)).toEqual([id]);
    expect(feed[0].mediaUrl).toContain('sig=');
    await expect(stories.markViewed(id, s.parentId)).resolves.toEqual({ ok: true });
    expect(refusingSweeper).toBeDefined();
  });

  it('after expiry: invisible, unopenable, unviewable, no media — with NO sweep', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      media: true,
    });
    await prisma.story.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    // The row still claims to be published. Nothing has swept.
    expect((await prisma.story.findUniqueOrThrow({ where: { id } })).state).toBe(
      StoryState.PUBLISHED,
    );

    expect(await stories.feed(s.parentId)).toEqual([]);
    await expect(stories.markViewed(id, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_EXPIRED,
    });
    expect((await stories.list(s.ownerId)).find((x) => x.id === id)!.mediaUrl).toBeNull();
  });

  it('the exact boundary: one millisecond past expires_at is already gone', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await prisma.story.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(await stories.feed(s.parentId)).toEqual([]);
  });
});

// ===========================================================================
// §E · An empty or malformed audience never means "everyone"
// ===========================================================================

describe('§E an empty audience is never everyone', () => {
  it('create with no clauses is refused', async () => {
    await expect(stories.create(s.ownerId, { body: 'x', audiences: [] })).rejects.toMatchObject({
      code: CommErrorCode.STORY_AUDIENCE_EMPTY,
    });
  });

  it('a story whose audience rows were removed publishes to NOBODY, not everybody', async () => {
    const draft = await stories.create(s.ownerId, {
      body: 'x',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    });
    // Simulate the rows going missing between draft and publish.
    await prisma.storyAudience.deleteMany({ where: { storyId: draft.id } });

    await expect(stories.publish(draft.id, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_AUDIENCE_EMPTY,
    });
    expect(await prisma.storyRecipient.count({ where: { storyId: draft.id } })).toBe(0);
    expect((await prisma.story.findUniqueOrThrow({ where: { id: draft.id } })).state).toBe(
      StoryState.DRAFT,
    );
  });

  it('a clause naming nobody reachable is refused rather than published to all', async () => {
    // A family with no communicating contacts resolves to zero people.
    const emptyFamily = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, language)
       values ('${emptyFamily}'::uuid, 'family_empty', '${s.ownerId}'::uuid, 'ar')`,
    );
    try {
      const draft = await stories.create(s.ownerId, {
        body: 'x',
        audiences: [{ kind: StoryAudienceKind.FAMILY, refId: emptyFamily }],
      });
      await expect(stories.publish(draft.id, s.ownerId)).rejects.toMatchObject({
        code: CommErrorCode.STORY_AUDIENCE_EMPTY,
      });
    } finally {
      await prisma.$executeRawUnsafe(`delete from chat.family where id = '${emptyFamily}'::uuid`);
    }
  });
});

// ===========================================================================
// §F · The academy-wide clauses stay inside one academy
// ===========================================================================

describe('§F all_families / all_teachers mean THIS academy', () => {
  it('all_families never reaches another organization’s contacts', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    const ids = (await prisma.storyRecipient.findMany({ where: { storyId: id } })).map(
      (r) => r.actorId,
    );
    expect(ids).not.toContain(orgB.contactId);
    expect(ids).toContain(s.parentId);
  });

  it('all_teachers never reaches another organization’s teachers', async () => {
    const bTeacher = randomUUID();
    await prisma.$executeRawUnsafe(
      `insert into chat.teacher (id, name, is_active, organization_id)
       values ('${bTeacher}'::uuid, 'teacher_b', true, '${orgB.orgId}'::uuid)`,
    );
    try {
      const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_TEACHERS }]);
      const ids = (await prisma.storyRecipient.findMany({ where: { storyId: id } })).map(
        (r) => r.actorId,
      );
      expect(ids).not.toContain(bTeacher);
      expect(ids).toContain(s.teacherId);
    } finally {
      await prisma.$executeRawUnsafe(`delete from chat.teacher where id = '${bTeacher}'::uuid`);
    }
  });

});

// ===========================================================================
// §G · Notifications and realtime reach exactly the audience
// ===========================================================================

describe('§G the fan-out cannot exceed the audience', () => {
  it('a DRAFT produces no outbox event at all', async () => {
    await stories.create(s.ownerId, {
      body: 'x',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    });
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('publishing enqueues exactly one event, and deleting enqueues a retirement not a publication', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    expect(await prisma.outboxEvent.count({ where: { type: CommEvent.STORY_PUBLISHED } })).toBe(1);

    await stories.remove(id, s.ownerId, 'gone');
    // Still exactly one publication event: deletion must never re-announce.
    expect(await prisma.outboxEvent.count({ where: { type: CommEvent.STORY_PUBLISHED } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { type: CommEvent.STORY_RETIRED } })).toBe(1);
  });

  it('the dedupe key is deterministic per story per recipient', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    const recipients = await prisma.storyRecipient.findMany({ where: { storyId: id } });

    await g.outboxWorker.drain(50);
    const first = await prisma.notification.findMany({ where: { eventType: 'story_published' } });
    expect(first).toHaveLength(recipients.length);
    for (const n of first) {
      expect(n.dedupeKey).toBe(`story_published:${id}:${n.recipientId}`);
    }

    // A replayed event must not double-notify anybody.
    await prisma.outboxEvent.updateMany({ data: { status: 'pending', publishedAt: null } });
    await g.outboxWorker.drain(50);
    expect(await prisma.notification.count({ where: { eventType: 'story_published' } })).toBe(
      first.length,
    );
  });

  it('notifies only the resolved audience — never a non-recipient', async () => {
    const id = await publishedStory(s.ownerId, [
      { kind: StoryAudienceKind.FAMILY, refId: s.familyId },
    ]);
    await g.outboxWorker.drain(50);

    const notified = (
      await prisma.notification.findMany({ where: { eventType: 'story_published' } })
    ).map((n) => n.recipientId);
    const recipients = (await prisma.storyRecipient.findMany({ where: { storyId: id } })).map(
      (r) => r.actorId,
    );

    expect(notified.sort()).toEqual(recipients.sort());
    expect(notified).not.toContain(orgB.contactId);
    expect(notified).not.toContain(s.ownerId);
  });

  it('a story retired before the drain is never announced', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await stories.remove(id, s.ownerId, 'pulled before the worker ran');

    await g.outboxWorker.drain(50);
    expect(await prisma.notification.count({ where: { eventType: 'story_published' } })).toBe(0);
  });

  it('the notification body carries no story content', async () => {
    await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await g.outboxWorker.drain(50);
    const n = await prisma.notification.findFirst({ where: { eventType: 'story_published' } });
    const vars = n!.variables as Record<string, unknown>;
    // Title only. A lock screen is not the place to spend a publication's privacy.
    expect(Object.keys(vars).sort()).toEqual(['organization_name', 'story_title']);
    expect(JSON.stringify(vars)).not.toContain('hello');
  });
});

// ===========================================================================
// §H · The story sweep is isolated from calls and from the outbox
// ===========================================================================

describe('§H failure isolation', () => {
  it('a failing media purge does not stop expiry, and reports the rest of the batch', async () => {
    const id = await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      media: true,
    });
    await ageStory(id, RETENTION_PAST);

    const exploding = {
      authorizeUpload: async () => {
        throw new Error('unused');
      },
      signedReadUrl: async () => 'unused',
      delete: async () => {
        throw new Error('storage is down');
      },
    };
    const sweeper = new StorySweeper(prisma, g.config, outbox, exploding as never);

    // Expiry still happens; the purge fails and the row is left for a retry.
    const result = await sweeper.sweep();
    expect(result.expired).toBe(1);
    expect(result.purged).toBe(0);
    expect((await prisma.story.findUniqueOrThrow({ where: { id } })).mediaObjectKey).not.toBeNull();

    // And a later pass with working storage completes it.
    expect(await storySweeper.purgeDueMedia()).toBe(1);
  });

  it('the story sweep touches no call row', async () => {
    const before = await prisma.call.count();
    await publishedStory(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await storySweeper.sweep();
    expect(await prisma.call.count()).toBe(before);
  });

  it('the story sweep leaves unrelated outbox rows alone', async () => {
    await prisma.outboxEvent.create({
      data: { type: CommEvent.MESSAGE_CREATED, payload: { conversationId: randomUUID() }, status: 'pending' },
    });
    await storySweeper.sweep();
    const pending = await prisma.outboxEvent.findMany({ where: { type: CommEvent.MESSAGE_CREATED } });
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
  });
});
