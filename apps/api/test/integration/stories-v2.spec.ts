/**
 * Stories v2 (owner decisions, 2026-10-17) -- what changed, and every way it
 * could leak or lie.
 *
 *   §1 content      text / photo / video / voice; no caption, no title
 *   §2 the button   WhatsApp, message the publisher, link -- validated, and
 *                   the reply button never widens PD-8
 *   §3 the feed     what a reader receives, and what they never do
 *   §4 targeting    the `segment` clause: user type, plan, children, country
 *   §5 taps         recorded per tap, recipients only, answered correctly
 *   §6 analytics    reach, views, taps, rates, daily and country breakdowns
 *   §7 audience data  who may read and set a family's country and plan
 *   §8 super admin  publishes, and acts on others' stories like a manager
 *
 * Expiry is covered where it always was (stories.spec.ts,
 * stories-hardening.spec.ts): legacy rows with an expiry still expire; a story
 * published now has none.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, withAssignmentGate, type Scenario } from './harness';
import { CommErrorCode } from '@platform/errors';
import { StoryAudienceKind, StoryState } from '@communication/contracts/vocab';
import type { AudienceClause } from '@communication/stories/story-audience.resolver';

const g = buildGraph();
const { prisma, stories } = g;

let s: Scenario;
let superAdminId: string;
/** family_y: AE, 1-month plan, 1 child, supervised by admin_b. */
let familyY: string;
let parentR: string;
/** family_z: KW, 12-month plan, 4 children, nobody supervises it. */
let familyZ: string;
let parentZ: string;
/** family_w: no country, no plan, no children. */
let familyW: string;
let parentW: string;
/** Another organization's family, for the tenant cases. */
let foreignFamily: string;

const segment = (filter: Record<string, unknown>): AudienceClause[] => [
  { kind: StoryAudienceKind.SEGMENT, filter },
];

async function publish(
  authorId: string,
  audiences: AudienceClause[],
  extra: Record<string, unknown> = {},
): Promise<string> {
  const draft = await stories.create(authorId, { body: 'hello', audiences, ...extra });
  await stories.publish(draft.id, authorId);
  return draft.id;
}

async function recipientsOf(storyId: string): Promise<string[]> {
  const rows = await prisma.storyRecipient.findMany({ where: { storyId }, select: { actorId: true } });
  return rows.map((r) => r.actorId).sort();
}

async function addFamily(opts: {
  name: string;
  country: string | null;
  plan: number | null;
  children: number;
  supervisor?: string;
}): Promise<{ familyId: string; contactId: string }> {
  const familyId = randomUUID();
  const contactId = randomUUID();
  await prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language, country_code, subscription_plan_months)
     values ($1::uuid, $2, $3::uuid, 'ar', $4, $5)`,
    familyId, opts.name, s.ownerId, opts.country, opts.plan,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ($1::uuid, $2::uuid, $3, 'primary_guardian', true, true)`,
    contactId, familyId, `${opts.name}_parent`,
  );
  const learners: string[] = [];
  for (let i = 0; i < opts.children; i += 1) {
    const id = randomUUID();
    learners.push(id);
    await withAssignmentGate(
      prisma,
      `insert into chat.learner (id, family_id, name) values ('${id}'::uuid, '${familyId}'::uuid, '${opts.name}_child_${i}')`,
    );
  }
  if (opts.supervisor) {
    for (const id of learners) {
      // Placed by the seed's Operations manager (PD-42: a supervision names its assigner).
      await prisma.$executeRawUnsafe(
        `insert into chat.learner_supervision (learner_id, organization_id, supervisor_id, assigned_by)
         values ($1::uuid, chat.default_organization_id(), $2::uuid, $3::uuid)`,
        id, opts.supervisor, s.managerId,
      );
    }
  }
  return { familyId, contactId };
}

beforeAll(async () => {
  await truncate(prisma);
  s = await seed(prisma);
  // family_x (seed): parent_p + parent_q, two children supervised by admin_a.
  await prisma.$executeRawUnsafe(
    `update chat.family set country_code = 'AE', subscription_plan_months = 6 where id = $1::uuid`,
    s.familyId,
  );
  ({ familyId: familyY, contactId: parentR } = await addFamily({
    name: 'family_y', country: 'AE', plan: 1, children: 1, supervisor: s.otherAdminId,
  }));
  ({ familyId: familyZ, contactId: parentZ } = await addFamily({
    name: 'family_z', country: 'KW', plan: 12, children: 4,
  }));
  ({ familyId: familyW, contactId: parentW } = await addFamily({
    name: 'family_w', country: null, plan: null, children: 0,
  }));

  superAdminId = randomUUID();
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`select set_config('chat.provisioning_super_admin', 'on', true)`),
    prisma.$executeRawUnsafe(`insert into chat.staff (id, name, role) values ('${superAdminId}'::uuid, 'owner_s', 'super_admin')`),
  ]);

  const otherOrg = randomUUID();
  const otherStaff = randomUUID();
  foreignFamily = randomUUID();
  await prisma.$executeRawUnsafe(
    `insert into chat.organization (id, slug, display_name) values ($1::uuid, $2, 'Org V2 B')`,
    otherOrg, `org-v2-b-${otherOrg.slice(0, 8)}`,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.staff (id, name, role, organization_id) values ($1::uuid, 'admin_v2b', 'admin', $2::uuid)`,
    otherStaff, otherOrg,
  );
  await prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language, organization_id)
     values ($1::uuid, 'family_foreign', $2::uuid, 'ar', $3::uuid)`,
    foreignFamily, otherStaff, otherOrg,
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    `truncate chat.story_cta_click, chat.story_view, chat.story_recipient, chat.story_audience, chat.story cascade`,
  );
  await prisma.outboxEvent.deleteMany({});
});

// ---------------------------------------------------------------------------

describe('§1 content: text, photo, video, voice -- and no caption', () => {
  const photo = { mediaObjectKey: 'stories/p1', mediaKind: 'image', mediaMime: 'image/png' };
  const families = [{ kind: StoryAudienceKind.ALL_FAMILIES }];

  it('a text story is its words, on a background (teal unless chosen)', async () => {
    const plain = await stories.create(s.ownerId, { body: 'Eid holiday', audiences: families });
    expect(plain).toMatchObject({ kind: 'text', body: 'Eid holiday', background: 'teal' });
    const plum = await stories.create(s.ownerId, { body: 'x', background: 'plum', audiences: families });
    expect(plum.background).toBe('plum');
  });

  it('refuses a caption under a photo, a video or a voice story', async () => {
    for (const media of [
      photo,
      { mediaObjectKey: 'stories/v', mediaKind: 'video', mediaMime: 'video/mp4' },
      { mediaObjectKey: 'stories/a', mediaKind: 'audio', mediaMime: 'audio/mp4' },
    ]) {
      await expect(
        stories.create(s.ownerId, { body: 'a caption', ...media, audiences: families }),
      ).rejects.toMatchObject({ code: CommErrorCode.STORY_CAPTION_NOT_ALLOWED });
    }
  });

  it('refuses a title -- a story has none; the publisher names it with internalName', async () => {
    await expect(
      stories.create(s.ownerId, { title: 'Headline', body: 'x', audiences: families }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_CAPTION_NOT_ALLOWED });
    const named = await stories.create(s.ownerId, { internalName: 'Eid 2026', body: 'x', audiences: families });
    expect(named).toMatchObject({ internalName: 'Eid 2026', title: null });
  });

  it('a voice story is audio with a background and a duration', async () => {
    const voice = await stories.create(s.ownerId, {
      mediaObjectKey: 'stories/a1', mediaKind: 'audio', mediaMime: 'audio/mp4', mediaDurationMs: 42_000,
      background: 'sunset', audiences: families,
    });
    expect(voice).toMatchObject({ kind: 'voice', background: 'sunset', mediaDurationMs: 42_000, body: null });
  });

  it('refuses a background on a photo, an unknown background, and a mime that is not its kind', async () => {
    await expect(
      stories.create(s.ownerId, { ...photo, background: 'teal', audiences: families }),
    ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED });
    await expect(
      stories.create(s.ownerId, { body: 'x', background: 'neon', audiences: families }),
    ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED });
    await expect(
      stories.create(s.ownerId, {
        mediaObjectKey: 'stories/a2', mediaKind: 'audio', mediaMime: 'video/mp4', audiences: families,
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED });
  });

  it('voice uploads are limited to what both phone platforms play', async () => {
    const ok = await stories.authorizeMediaUpload(s.ownerId, { mimeType: 'audio/mp4', byteSize: 1_000_000 });
    expect(ok.objectKey).toMatch(/^stories\//);
    for (const mimeType of ['audio/webm', 'audio/ogg']) {
      await expect(
        stories.authorizeMediaUpload(s.ownerId, { mimeType, byteSize: 1000 }),
      ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TYPE_NOT_ALLOWED });
    }
    await expect(
      stories.authorizeMediaUpload(s.ownerId, { mimeType: 'audio/mpeg', byteSize: 21 * 1024 * 1024 }),
    ).rejects.toMatchObject({ code: CommErrorCode.ATTACHMENT_TOO_LARGE });
  });
});

describe('§2 the button', () => {
  const families = [{ kind: StoryAudienceKind.ALL_FAMILIES }];

  it('normalizes a WhatsApp number typed the way people type it', async () => {
    for (const phone of ['+971 50-123 4567', '00971501234567', '(971) 50 123 4567']) {
      const d = await stories.create(s.ownerId, { body: 'x', cta: { kind: 'whatsapp', phone }, audiences: families });
      expect(d.cta).toEqual({ kind: 'whatsapp', label: null, url: 'https://wa.me/971501234567', phone: '971501234567' });
    }
  });

  it('refuses a link that is not https, a short number, an unknown kind and a long label', async () => {
    const bad = [
      { kind: 'link', url: 'http://jawwid.example/offer' },
      { kind: 'link', url: 'javascript:alert(1)' },
      { kind: 'link', url: 'not a url' },
      { kind: 'whatsapp', phone: '12345' },
      { kind: 'call', phone: '971501234567' },
      { kind: 'message_publisher', label: 'x'.repeat(41) },
    ];
    for (const cta of bad) {
      await expect(stories.create(s.ownerId, { body: 'x', cta, audiences: families })).rejects.toMatchObject({
        code: CommErrorCode.STORY_CTA_INVALID,
      });
    }
  });

  it('the database refuses a malformed button even if the service is bypassed', async () => {
    const d = await stories.create(s.ownerId, { body: 'x', audiences: families });
    await expect(
      prisma.story.update({ where: { id: d.id }, data: { ctaKind: 'link', ctaUrl: 'http://x.example' } }),
    ).rejects.toThrow(/story_cta_shape/);
  });

  it('a reply button narrows the audience to families the publisher supervises (PD-8), and says so', async () => {
    // admin_a supervises family_x only. "Message me" to every family would hand
    // family_y/z/w a button whose conversation PD-8 refuses.
    const audiences = segment({ who: 'families' });
    const estimate = await stories.estimate(s.ownerId, { audiences, ctaKind: 'message_publisher' });
    expect(estimate).toMatchObject({ recipients: 2, contacts: 2, families: 1, excludedByReplyScope: 3 });

    const id = await publish(s.ownerId, audiences, { cta: { kind: 'message_publisher' } });
    expect(await recipientsOf(id)).toEqual([s.parentId, s.otherParentId].sort());
  });

  it('teachers keep a reply button -- teacher <-> staff is always open', async () => {
    const estimate = await stories.estimate(s.ownerId, {
      audiences: segment({ who: 'everyone' }),
      ctaKind: 'message_publisher',
    });
    expect(estimate).toMatchObject({ recipients: 5, teachers: 3, contacts: 2, excludedByReplyScope: 3 });
  });

  it('the super admin reaches every family, so nothing is narrowed', async () => {
    const estimate = await stories.estimate(superAdminId, {
      audiences: segment({ who: 'families' }),
      ctaKind: 'message_publisher',
    });
    expect(estimate).toMatchObject({ recipients: 5, families: 4, excludedByReplyScope: 0 });
  });

  it('no other button narrows anything', async () => {
    for (const ctaKind of [null, 'link', 'whatsapp']) {
      const e = await stories.estimate(s.ownerId, { audiences: segment({ who: 'families' }), ctaKind });
      expect(e).toMatchObject({ recipients: 5, excludedByReplyScope: 0 });
    }
  });
});

describe('§3 the feed', () => {
  it('a reader gets the kind, the background and the button -- never the label, the number or an expiry', async () => {
    await publish(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      internalName: 'internal: Q4 upsell',
      background: 'gold',
      cta: { kind: 'whatsapp', phone: '+971501234567', label: 'Chat with us' },
    });
    const [item] = await stories.feed(s.parentId);
    expect(item).toMatchObject({
      kind: 'text',
      body: 'hello',
      background: 'gold',
      expiresAt: null,
      cta: { kind: 'whatsapp', label: 'Chat with us', url: 'https://wa.me/971501234567' },
    });
    const wire = JSON.stringify(item);
    expect(wire).not.toContain('Q4 upsell');
    expect(wire).not.toContain('internalName');
    expect(wire).not.toContain('"phone"');
    expect(wire).not.toContain('title');
  });

  it('an older story with a picture AND a caption reaches readers without the caption', async () => {
    const id = await publish(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      body: undefined, mediaObjectKey: 'stories/legacy', mediaKind: 'image', mediaMime: 'image/png',
    });
    await prisma.story.update({ where: { id }, data: { body: 'a legacy caption', title: 'legacy title' } });
    const [item] = await stories.feed(s.parentId);
    expect(item).toMatchObject({ kind: 'image', body: null });
    expect(JSON.stringify(item)).not.toContain('legacy');
  });

  it('a published story stays in the feed with no clock running', async () => {
    const id = await publish(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await prisma.story.update({ where: { id }, data: { publishedAt: new Date(Date.now() - 400 * 86_400_000) } });
    expect(await g.storySweeper.expireDue()).toBe(0);
    expect((await stories.feed(s.parentId)).map((x) => x.id)).toEqual([id]);
    await expect(stories.markViewed(id, s.parentId)).resolves.toEqual({ ok: true });
  });
});

describe('§4 targeting: the segment clause', () => {
  const cases: Array<[string, Record<string, unknown>, () => string[]]> = [
    ['every family', { who: 'families' }, () => [s.parentId, s.otherParentId, parentR, parentZ, parentW]],
    ['teachers only', { who: 'teachers' }, () => [s.teacherId, s.newTeacherId, s.unrelatedTeacherId]],
    ['everyone', { who: 'everyone' }, () => [
      s.parentId, s.otherParentId, parentR, parentZ, parentW, s.teacherId, s.newTeacherId, s.unrelatedTeacherId,
    ]],
    ['families in the UAE', { who: 'families', countries: ['AE'] }, () => [s.parentId, s.otherParentId, parentR]],
    ['families in Kuwait', { who: 'families', countries: ['KW'] }, () => [parentZ]],
    ['UAE on a 6-month plan', { who: 'families', countries: ['AE'], planMonths: [6] }, () => [s.parentId, s.otherParentId]],
    ['one child', { who: 'families', children: [1] }, () => [parentR]],
    ['four or more children', { who: 'families', children: [4] }, () => [parentZ]],
    ['1- or 12-month plans', { who: 'families', planMonths: [1, 12] }, () => [parentR, parentZ]],
  ];

  it.each(cases)('%s', async (_name, filter, expected) => {
    const audiences = segment(filter);
    const estimate = await stories.estimate(s.ownerId, { audiences });
    const id = await publish(s.ownerId, audiences);
    const got = await recipientsOf(id);
    expect(got).toEqual(expected().sort());
    // The number a publisher confirms is the number that went out.
    expect(estimate.recipients).toBe(got.length);
  });

  it('a family with no recorded country or plan matches no filter on it', async () => {
    const id = await publish(s.ownerId, segment({ who: 'families', countries: ['AE', 'KW'], planMonths: [1, 3, 6, 12] }));
    expect(await recipientsOf(id)).not.toContain(parentW);
  });

  it('a segment that matches nobody is refused at publish, not published to nobody', async () => {
    const draft = await stories.create(s.ownerId, { body: 'x', audiences: segment({ who: 'families', countries: ['QA'] }) });
    await expect(stories.publish(draft.id, s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_AUDIENCE_EMPTY,
    });
  });

  it('a malformed segment is refused while composing', async () => {
    for (const filter of [{ who: 'everyone', countries: ['AE'] }, { who: 'families', planMonths: [2] }, { who: 'students' }]) {
      await expect(stories.create(s.ownerId, { body: 'x', audiences: segment(filter) })).rejects.toMatchObject({
        code: CommErrorCode.STORY_AUDIENCE_INVALID,
      });
    }
    await expect(
      stories.create(s.ownerId, { body: 'x', audiences: [{ kind: 'all_families', filter: { who: 'families' } }] }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_AUDIENCE_INVALID });
  });

  it('never crosses the organization: another tenant’s families are not "every family"', async () => {
    const id = await publish(superAdminId, segment({ who: 'families' }));
    const families = await prisma.contact.findMany({
      where: { id: { in: await recipientsOf(id) } },
      select: { familyId: true },
    });
    expect(families.map((f) => f.familyId)).not.toContain(foreignFamily);
  });

  it('is stored as authored, so "who did this go to?" stays answerable', async () => {
    const filter = { who: 'families', countries: ['AE'], children: [1, 2] };
    const id = await publish(s.ownerId, segment(filter));
    const item = await stories.get(id, s.ownerId);
    expect(item.audiences).toEqual([{ kind: 'segment', refId: null, filter }]);
  });
});

describe('§5 taps', () => {
  it('a link tap is recorded and answered with the link; two taps are two taps', async () => {
    const id = await publish(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      cta: { kind: 'link', url: 'https://jawwid.example/offer?x=1' },
    });
    await expect(stories.tapCta(id, s.parentId)).resolves.toEqual({
      kind: 'link', url: 'https://jawwid.example/offer?x=1', conversationId: null,
    });
    await stories.tapCta(id, s.parentId);
    expect(await prisma.storyCtaClick.count({ where: { storyId: id } })).toBe(2);
  });

  it('a reply tap opens the direct conversation with the publisher, once', async () => {
    const id = await publish(s.ownerId, segment({ who: 'families' }), { cta: { kind: 'message_publisher' } });
    const first = await stories.tapCta(id, s.parentId);
    const second = await stories.tapCta(id, s.parentId);
    expect(first.conversationId).toBeTruthy();
    expect(second.conversationId).toBe(first.conversationId);
    const members = await prisma.conversationMember.findMany({
      where: { conversationId: first.conversationId! },
      select: { actorId: true },
    });
    expect(members.map((m) => m.actorId).sort()).toEqual([s.ownerId, s.parentId].sort());
  });

  it('a teacher’s reply tap on the super admin’s story opens teacher <-> super admin', async () => {
    const id = await publish(superAdminId, segment({ who: 'teachers' }), { cta: { kind: 'message_publisher' } });
    const tap = await stories.tapCta(id, s.teacherId);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: tap.conversationId! } });
    expect(conv.type).toBe('direct');
  });

  it('a non-recipient learns only "not found", and nothing is recorded', async () => {
    const id = await publish(s.ownerId, segment({ who: 'families', countries: ['KW'] }), {
      cta: { kind: 'link', url: 'https://jawwid.example' },
    });
    await expect(stories.tapCta(id, s.parentId)).rejects.toMatchObject({ code: CommErrorCode.STORY_NOT_FOUND });
    await expect(stories.tapCta(randomUUID(), s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
    await expect(stories.tapCta('not-a-uuid', s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
    expect(await prisma.storyCtaClick.count()).toBe(0);
  });

  it('a story with no button, and a deleted story, refuse a tap', async () => {
    const plain = await publish(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await expect(stories.tapCta(plain, s.parentId)).rejects.toMatchObject({ code: CommErrorCode.STORY_NO_CTA });

    const gone = await publish(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }], {
      cta: { kind: 'link', url: 'https://jawwid.example' },
    });
    await stories.remove(gone, s.ownerId, 'mistake');
    await expect(stories.tapCta(gone, s.parentId)).rejects.toMatchObject({ code: CommErrorCode.STORY_DELETED });
  });

  it('the database refuses a tap row from outside the audience even if the service is bypassed', async () => {
    const id = await publish(s.ownerId, segment({ who: 'families', countries: ['KW'] }));
    await expect(
      prisma.storyCtaClick.create({ data: { storyId: id, actorId: s.parentId } }),
    ).rejects.toThrow(/not in the audience/);
  });
});

describe('§6 analytics', () => {
  let id: string;

  beforeEach(async () => {
    id = await publish(s.ownerId, segment({ who: 'families' }), {
      cta: { kind: 'link', url: 'https://jawwid.example' },
    });
    await stories.markViewed(id, s.parentId);
    await stories.markViewed(id, s.otherParentId);
    await stories.markViewed(id, parentW);
    await stories.tapCta(id, s.parentId);
    await stories.tapCta(id, s.parentId);
  });

  it('reach, views, taps and their rates, from the rows that record them', async () => {
    const a = await stories.analytics(id, s.ownerId);
    expect(a.reach).toEqual({ total: 5, contacts: 5, teachers: 0, families: 4 });
    expect(a.views).toEqual({ total: 3, contacts: 3, teachers: 0 });
    expect(a.cta).toEqual({ kind: 'link', taps: 2, tappers: 1 });
    expect(a.rates.view).toBeCloseTo(3 / 5);
    expect(a.rates.tapOfViews).toBeCloseTo(1 / 3);
    expect(a.rates.tapOfReach).toBeCloseTo(1 / 5);
    expect(a.firstViewAt).not.toBeNull();
  });

  it('a daily series that sums to the totals', async () => {
    const a = await stories.analytics(id, s.ownerId, 'Asia/Dubai');
    expect(a.daily.length).toBeGreaterThanOrEqual(1);
    expect(a.daily.reduce((n, d) => n + d.views, 0)).toBe(3);
    expect(a.daily.reduce((n, d) => n + d.taps, 0)).toBe(2);
    expect(a.daily.at(-1)!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a country breakdown, with "not set" as its own row', async () => {
    const a = await stories.analytics(id, s.ownerId);
    const by = Object.fromEntries(a.byCountry.map((r) => [r.code ?? 'none', r]));
    expect(by.AE).toEqual({ code: 'AE', reach: 3, views: 2, tappers: 1 });
    expect(by.KW).toEqual({ code: 'KW', reach: 1, views: 0, tappers: 0 });
    expect(by.none).toEqual({ code: null, reach: 1, views: 1, tappers: 0 });
  });

  it('the publisher list and the viewer list carry the tap counts', async () => {
    const listed = (await stories.list(s.ownerId)).find((x) => x.id === id)!;
    expect(listed).toMatchObject({ recipientCount: 5, viewCount: 3, ctaTapCount: 2, ctaTapperCount: 1, creatorName: 'admin_a' });
    const viewers = await stories.viewers(id, s.ownerId);
    expect(viewers.find((v) => v.actorId === s.parentId)!.ctaTaps).toBe(2);
    expect(viewers.find((v) => v.actorId === parentW)!.ctaTaps).toBe(0);
  });

  it('is a publisher surface: a reader and a teacher are refused', async () => {
    for (const actor of [s.parentId, s.teacherId]) {
      await expect(stories.analytics(id, actor)).rejects.toMatchObject({ code: CommErrorCode.STORY_CANNOT_PUBLISH });
    }
  });

  it('refuses an unknown time zone before it reaches SQL', async () => {
    await expect(stories.analytics(id, s.ownerId, "UTC'; drop table chat.story; --")).rejects.toMatchObject({
      code: CommErrorCode.STORY_AUDIENCE_INVALID,
    });
  });

  it('an id that is not in the caller’s organization is "not found"', async () => {
    await expect(stories.analytics(randomUUID(), s.ownerId)).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
  });
});

describe('§7 audience data', () => {
  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      `update chat.family set country_code = null, subscription_plan_months = null, segment_source = null where id = $1::uuid`,
      familyW,
    );
  });

  it('facts are counts any publisher may read', async () => {
    const f = await stories.audienceFacts(s.ownerId);
    expect(f).toMatchObject({
      families: 4,
      contacts: 5,
      teachers: 3,
      unknownCountry: 1,
      unknownPlan: 1,
      noChildren: 1,
    });
    expect(f.countries).toEqual([{ code: 'AE', families: 2 }, { code: 'KW', families: 1 }]);
    expect(f.plans).toEqual([
      { months: 1, families: 1 }, { months: 3, families: 0 }, { months: 6, families: 1 }, { months: 12, families: 1 },
    ]);
    expect(f.children).toEqual([
      { bucket: 1, families: 1 }, { bucket: 2, families: 1 }, { bucket: 3, families: 0 }, { bucket: 4, families: 1 },
    ]);
  });

  it('the family table is for the super admin and managers only', async () => {
    for (const actor of [s.ownerId, s.parentId, s.teacherId]) {
      await expect(stories.familyAudienceData(actor, {})).rejects.toMatchObject({
        code: expect.stringMatching(/STORY_AUDIENCE_DATA_DENIED|ACTOR/),
      });
    }
    const all = await stories.familyAudienceData(s.managerId, {});
    expect(all.families.map((f) => f.displayName)).toEqual(['family_w', 'family_x', 'family_y', 'family_z']);
    expect(all.families.find((f) => f.id === familyZ)).toMatchObject({ countryCode: 'KW', subscriptionPlanMonths: 12, childCount: 4 });
    const missing = await stories.familyAudienceData(superAdminId, { missing: true });
    expect(missing.families.map((f) => f.id)).toEqual([familyW]);
    const searched = await stories.familyAudienceData(superAdminId, { search: 'FAMILY_Y' });
    expect(searched.families.map((f) => f.id)).toEqual([familyY]);
  });

  it('sets a country and plan, normalized, audited, and marked as admin-entered', async () => {
    const row = await stories.setFamilyAudienceData(s.managerId, familyW, { countryCode: 'sa', subscriptionPlanMonths: 3 });
    expect(row).toMatchObject({ countryCode: 'SA', subscriptionPlanMonths: 3, segmentSource: 'admin' });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'family.audience_data_set', entityId: familyW } });
    expect(audit).toMatchObject({ actorId: s.managerId });
    // ...and targeting sees it at once.
    const e = await stories.estimate(s.ownerId, { audiences: segment({ who: 'families', countries: ['SA'] }) });
    expect(e.recipients).toBe(1);
  });

  it('refuses a bad country, a plan that is not 1/3/6/12, a supervisor, and another tenant’s family', async () => {
    await expect(stories.setFamilyAudienceData(s.managerId, familyW, { countryCode: 'UAE' })).rejects.toMatchObject({
      code: CommErrorCode.STORY_AUDIENCE_INVALID,
    });
    // PD-45: two letters are not enough -- a code that is not a country of the
    // list is a 400 that names GB, never chat.family_country_listed's 500.
    for (const countryCode of ['UK', 'ZZ', 'AC', 'DG', 'EA', 'IC']) {
      await expect(stories.setFamilyAudienceData(s.managerId, familyW, { countryCode })).rejects.toMatchObject({
        code: CommErrorCode.STORY_AUDIENCE_INVALID, status: 400, message: expect.stringMatching(/GB/),
      });
    }
    await expect(
      stories.setFamilyAudienceData(s.managerId, familyW, { subscriptionPlanMonths: 2 }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_AUDIENCE_INVALID });
    await expect(stories.setFamilyAudienceData(s.ownerId, familyW, { countryCode: 'AE' })).rejects.toMatchObject({
      code: CommErrorCode.STORY_AUDIENCE_DATA_DENIED,
    });
    await expect(
      stories.setFamilyAudienceData(superAdminId, foreignFamily, { countryCode: 'AE' }),
    ).rejects.toMatchObject({ code: CommErrorCode.STORY_FAMILY_NOT_FOUND, status: 404 });
    const foreign = await prisma.family.findUniqueOrThrow({ where: { id: foreignFamily } });
    expect(foreign.countryCode).toBeNull();
  });

  it('null clears a value', async () => {
    await stories.setFamilyAudienceData(s.managerId, familyW, { countryCode: 'OM' });
    const row = await stories.setFamilyAudienceData(s.managerId, familyW, { countryCode: null });
    expect(row.countryCode).toBeNull();
  });
});

describe('§8 the super admin', () => {
  it('publishes, and may publish or delete a supervisor’s story like a manager', async () => {
    const own = await publish(superAdminId, [{ kind: StoryAudienceKind.ALL_TEACHERS }]);
    expect((await stories.get(own, superAdminId)).state).toBe(StoryState.PUBLISHED);

    const draft = await stories.create(s.ownerId, { body: 'x', audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }] });
    await stories.publish(draft.id, superAdminId);
    await expect(stories.remove(draft.id, superAdminId, 'off-brand')).resolves.toMatchObject({ ok: true });
  });

  it('another supervisor still may not touch admin_a’s story', async () => {
    const id = await publish(s.ownerId, [{ kind: StoryAudienceKind.ALL_FAMILIES }]);
    await expect(stories.remove(id, s.otherAdminId, 'mine now')).rejects.toMatchObject({
      code: CommErrorCode.STORY_NOT_FOUND,
    });
  });

  it('its story media is signed for it (the media route admits publishers)', async () => {
    const d = await stories.create(superAdminId, {
      mediaObjectKey: 'stories/sa', mediaKind: 'image', mediaMime: 'image/png',
      audiences: [{ kind: StoryAudienceKind.ALL_FAMILIES }],
    });
    await expect(stories.authorizeMediaRead(d.id, superAdminId)).resolves.toEqual({ objectKey: 'stories/sa' });
  });
});
