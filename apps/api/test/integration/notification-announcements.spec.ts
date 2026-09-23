/**
 * ACADEMY ANNOUNCEMENTS, END TO END AND UNDER ATTACK.
 *
 * An announcement is the one thing in this product that reaches every family at
 * once. That makes it the highest-value target in the API and the least
 * forgiving thing to get wrong: a duplicate publish buzzes the whole academy
 * twice, a leaked audience tells one family who else was written to, and an
 * escalated priority wakes four hundred people at 2am.
 *
 * Two halves. The first follows one announcement from draft to a parent's
 * notification centre, including the ways publishing goes wrong. The second
 * assumes a client that lies: about who it is, what it may declare, who it is
 * writing to, and what state the announcement is in.
 *
 * Requires the migrated database (DATABASE_URL).
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { NotificationType } from '@communication/contracts/notifications';

const g = buildGraph();
let s: Scenario;

const staff = (actorId: string, staffRole: string) => ({
  actorId,
  kind: 'staff' as const,
  displayName: 'staff',
  locale: 'ar' as const,
  isActive: true,
  staffRole: staffRole as never,
});

const admin = () => staff(s.ownerId, 'admin');
const manager = () => staff(s.managerId, 'manager');

const parent = () => ({
  actorId: s.parentId,
  kind: 'contact' as const,
  displayName: 'parent_p',
  locale: 'ar' as const,
  isActive: true,
});

const teacher = () => ({
  actorId: s.teacherId,
  kind: 'teacher' as const,
  displayName: 'teacher_c',
  locale: 'ar' as const,
  isActive: true,
});

/**
 * A second family that reads English.
 *
 * Locale is the FAMILY's, not the contact's -- a household shares a language --
 * so a bilingual audience needs a second family rather than a second contact.
 */
async function englishFamily(): Promise<string> {
  const familyId = randomUUID();
  const contactId = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${familyId}'::uuid, 'family_en', '${s.ownerId}'::uuid, 'en')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, family_id, name, role_preset, can_message, is_active)
     values ('${contactId}'::uuid, '${familyId}'::uuid, 'parent_en',
             'primary_guardian', true, true)`,
  );
  return contactId;
}

async function announcementNotifications(announcementId: string) {
  return g.prisma.notification.findMany({ where: { announcementId } });
}

beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
});

afterAll(async () => {
  await truncate(g.prisma);
  await g.prisma.$disconnect();
});

// =========================================================================
describe('one announcement, draft to notification centre', () => {
  it('reaches every parent, in their own language, with the words frozen', async () => {
    const englishParent = await englishFamily();

    const a = await g.announcements.create(admin(), {
      titleAr: 'إجازة',
      bodyAr: 'الأكاديمية مغلقة يوم الجمعة.',
      titleEn: 'Holiday',
      bodyEn: 'The academy is closed on Friday.',
      targetType: 'all_parents',
    });
    expect(a.status).toBe('draft');
    // A draft reaches nobody, however many sweeps run.
    expect(await g.announcements.fanOutDue()).toBe(0);

    await g.announcements.publish(admin(), a.id);
    expect(await g.announcements.fanOutDue()).toBe(3);

    const rows = await announcementNotifications(a.id);
    expect(rows).toHaveLength(3);

    const arabic = rows.find((r) => r.recipientId === s.parentId)!;
    const english = rows.find((r) => r.recipientId === englishParent)!;
    expect(arabic.body).toContain('الجمعة');
    expect(english.body).toContain('Friday');
    // Each links to the announcement itself, which re-authorizes on landing.
    expect(arabic.deeplink).toBe(`/announcements/${a.id}`);

    // And the centre shows it to the parent it belongs to.
    const centre = await g.centre.list(s.parentId);
    expect(centre.items.map((i) => i.id)).toContain(arabic.id);
  });

  it('an announcement with no English falls back to Arabic for an English reader',
    async () => {
      const englishParent = await englishFamily();
      const a = await g.announcements.create(admin(), {
        titleAr: 'خبر', bodyAr: 'نص عربي فقط', targetType: 'all_parents',
      });
      await g.announcements.publish(admin(), a.id);
      await g.announcements.fanOut(a.id);

      const english = (await announcementNotifications(a.id)).find(
        (r) => r.recipientId === englishParent,
      )!;
      // Arabic rather than an empty card: a missing translation is a gap in the
      // content, not a reason to tell a parent nothing.
      expect(english.body).toContain('نص عربي فقط');
    });

  it('publishing twice is one publish, and fanning out twice is one notification each',
    async () => {
      const a = await g.announcements.create(admin(), {
        titleAr: 'خبر', bodyAr: 'نص', targetType: 'all_parents',
      });

      const first = await g.announcements.publish(admin(), a.id);
      const second = await g.announcements.publish(admin(), a.id);

      // The second publish is a no-op: the publish timestamp does not move, so
      // "when was the academy told" stays answerable.
      expect(second.publishedAt).toEqual(first.publishedAt);
      expect(
        await g.prisma.auditLog.count({
          where: { entityId: a.id, action: 'announcement_published' },
        }),
      ).toBe(1);

      await g.announcements.fanOut(a.id);
      await g.announcements.fanOut(a.id);
      await g.announcements.fanOutDue();

      expect(await announcementNotifications(a.id)).toHaveLength(2);
    });

  it('two workers fanning out at the same instant still send it once', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص', targetType: 'all_parents',
    });
    await g.announcements.publish(admin(), a.id);

    // fanned_out_at is an observability marker, not a lock. The dedupe key is
    // what makes this safe, so the race is run against it directly.
    await Promise.all([
      g.announcements.fanOut(a.id),
      g.announcements.fanOut(a.id),
      g.announcements.fanOut(a.id),
    ]);

    expect(await announcementNotifications(a.id)).toHaveLength(2);
  });

  it('a cancelled announcement cannot be published, and a published one stops fanning out',
    async () => {
      const cancelled = await g.announcements.create(admin(), {
        titleAr: 'ملغى', bodyAr: 'نص', targetType: 'all_parents',
      });
      await g.announcements.cancel(admin(), cancelled.id);
      await expect(g.announcements.publish(admin(), cancelled.id)).rejects.toMatchObject({
        status: 409,
      });
      expect(await g.announcements.fanOutDue()).toBe(0);

      // Cancelling AFTER publishing stops future fan-out...
      const sent = await g.announcements.create(admin(), {
        titleAr: 'منشور', bodyAr: 'نص', targetType: 'all_parents',
      });
      await g.announcements.publish(admin(), sent.id);
      await g.announcements.fanOut(sent.id);
      const before = await announcementNotifications(sent.id);
      await g.announcements.cancel(admin(), sent.id);
      await g.announcements.fanOut(sent.id);

      // ...and does NOT retract what parents were already told. A centre that
      // silently deletes things is not a record.
      expect(await announcementNotifications(sent.id)).toHaveLength(before.length);
      expect((await g.centre.unreadCounts(s.parentId)).total).toBe(1);
    });

  it('an announcement scheduled for later is not sent early', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'لاحقا', bodyAr: 'نص',
      targetType: 'all_parents',
      publishAt: new Date(Date.now() + 24 * 3600 * 1000),
    });
    await g.announcements.publish(admin(), a.id);

    expect(await g.announcements.fanOutDue(new Date())).toBe(0);
    expect(await announcementNotifications(a.id)).toHaveLength(0);

    // …and IS sent when its moment arrives.
    expect(
      await g.announcements.fanOutDue(new Date(Date.now() + 25 * 3600 * 1000)),
    ).toBe(2);
  });

  it('an expired announcement leaves the centre without leaving the database', async () => {
    // Published an hour ago, expired a minute ago. The table refuses an expiry
    // that precedes the publish outright, which is its own small guarantee: an
    // announcement cannot be created already over.
    const a = await g.announcements.create(admin(), {
      titleAr: 'منتهي', bodyAr: 'نص',
      targetType: 'all_parents',
      publishAt: new Date(Date.now() - 3600_000),
      expiresAt: new Date(Date.now() - 60_000),
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);

    // The notifications exist -- the fan-out is not silently skipped -- but the
    // parent's centre and badge do not show something that is over.
    expect(await announcementNotifications(a.id)).toHaveLength(2);
    expect((await g.centre.list(s.parentId)).items).toHaveLength(0);
    expect((await g.centre.unreadCounts(s.parentId)).total).toBe(0);
  });

  it('an audience that resolves to nobody is a no-op, not a failure', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'لا أحد', bodyAr: 'نص',
      targetType: 'contacts',
      targetIds: [randomUUID(), randomUUID()],
    });
    await g.announcements.publish(admin(), a.id);

    expect(await g.announcements.fanOut(a.id)).toBe(0);
    expect(await announcementNotifications(a.id)).toHaveLength(0);
    // Marked as handled, with an honest count, so it is not retried forever.
    const after = (await g.prisma.announcement.findUnique({ where: { id: a.id } }))!;
    expect(after.fannedOutAt).not.toBeNull();
    expect(after.recipientCount).toBe(0);
  });

  it('a target type nobody implements cannot be stored, and resolves to nobody',
    async () => {
      // Two independent guarantees, both worth having. The table's check
      // constraint refuses a target type outside the six that exist...
      await expect(
        g.announcements.create(admin(), {
          titleAr: 'غريب', bodyAr: 'نص',
          targetType: 'all_humans',
          targetIds: [s.parentId],
        }),
      ).rejects.toBeDefined();

      // ...and the resolver fails CLOSED anyway. An unrecognised target type
      // meaning "everyone" is how a typo becomes a message to the academy.
      expect(await g.recipients.forAudience('all_humans', [s.parentId])).toEqual([]);
      expect(await g.recipients.forAudience('', [])).toEqual([]);
    });

  it('a target type that requires ids is refused without them', async () => {
    await expect(
      g.announcements.create(admin(), {
        titleAr: 'بدون', bodyAr: 'نص', targetType: 'families', targetIds: [],
      }),
    ).rejects.toThrow(/requires target_ids/);
  });

  it('an inactive contact is not an audience member', async () => {
    await g.prisma.contact.update({
      where: { id: s.otherParentId },
      data: { isActive: false },
    });
    const a = await g.announcements.create(admin(), {
      titleAr: 'نشط', bodyAr: 'نص',
      targetType: 'contacts',
      targetIds: [s.parentId, s.otherParentId],
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);

    const rows = await announcementNotifications(a.id);
    expect(rows.map((r) => r.recipientId)).toEqual([s.parentId]);
  });

  it('an urgent announcement bypasses a mute, a normal one does not', async () => {
    await g.notifications.registerDevice({
      actorId: s.parentId, token: 'announce-device', platform: 'android',
    });
    await g.preferences.set(s.parentId, 'academy', false);

    const normal = await g.announcements.create(admin(), {
      titleAr: 'عادي', bodyAr: 'نص', targetType: 'contacts', targetIds: [s.parentId],
    });
    await g.announcements.publish(admin(), normal.id);
    await g.announcements.fanOut(normal.id);

    const urgent = await g.announcements.create(admin(), {
      titleAr: 'عاجل', bodyAr: 'نص', priority: 'urgent',
      targetType: 'contacts', targetIds: [s.parentId],
    });
    await g.announcements.publish(admin(), urgent.id);
    await g.announcements.fanOut(urgent.id);
    await g.notifications.dispatchDue(new Date());

    const push = async (announcementId: string) => {
      const n = (await announcementNotifications(announcementId))[0];
      return (await g.deliveries.trace(n.id)).find((d) => d.channel === 'push')!;
    };

    expect((await push(normal.id)).skipReason).toBe('PREFERENCE_OFF');
    // Rationed precisely so that this one still lands.
    expect((await push(urgent.id)).status).toBe('sent');
  });
});

// =========================================================================
describe('a client that lies', () => {
  it('a parent cannot create, publish, cancel or list announcements', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص', targetType: 'all_parents',
    });

    await expect(
      g.announcements.create(parent(), {
        titleAr: 'من ولي أمر', bodyAr: 'نص', targetType: 'all_parents',
      }),
    ).rejects.toBeDefined();
    await expect(g.announcements.publish(parent(), a.id)).rejects.toBeDefined();
    await expect(g.announcements.cancel(parent(), a.id)).rejects.toBeDefined();
    // The admin list carries targeting and authorship, so a parent reading it
    // would learn who else the academy writes to.
    await expect(g.announcements.list(parent())).rejects.toBeDefined();
  });

  it('a teacher cannot announce to the academy', async () => {
    await expect(
      g.announcements.create(teacher(), {
        titleAr: 'من معلم', bodyAr: 'نص', targetType: 'all_parents',
      }),
    ).rejects.toBeDefined();
  });

  it('a coverage staffer may announce, but may not declare it urgent', async () => {
    const coverage = staff(s.otherAdminId, 'coverage');

    const ordinary = await g.announcements.create(coverage, {
      titleAr: 'تغطية', bodyAr: 'نص', targetType: 'all_parents',
    });
    expect(ordinary.priority).toBe('normal');

    await expect(
      g.announcements.create(coverage, {
        titleAr: 'عاجل', bodyAr: 'نص', priority: 'urgent', targetType: 'all_parents',
      }),
    ).rejects.toThrow(/admin or a manager/);
  });

  it('nor may they publish somebody else’s urgent announcement', async () => {
    const urgent = await g.announcements.create(manager(), {
      titleAr: 'عاجل', bodyAr: 'نص', priority: 'urgent', targetType: 'all_parents',
    });

    // The authority check is on PUBLISH as well as create: the act that reaches
    // parents is the one that has to be authorized.
    await expect(
      g.announcements.publish(staff(s.otherAdminId, 'coverage'), urgent.id),
    ).rejects.toThrow(/admin or a manager/);
  });

  it('the database refuses an escalated priority even with the service bypassed',
    async () => {
      // A coverage staffer's id, writing directly to the table. The trigger is
      // the backstop the service check sits in front of.
      await expect(
        g.prisma.announcement.create({
          data: {
            titleAr: 'عاجل', bodyAr: 'نص', priority: 'urgent',
            targetType: 'all_parents', createdBy: s.teacherId, status: 'draft',
          },
        }),
      ).rejects.toThrow(/admin or a manager/);
    });

  it('a client cannot forge the author or the state', async () => {
    // Everything a client might try to smuggle through the body. The service
    // builds its row field by field and takes the author from the
    // authenticated actor, so these are dropped rather than honoured.
    const a = await g.announcements.create(
      admin(),
      Object.assign(
        { titleAr: 'محاولة', bodyAr: 'نص', targetType: 'all_parents' },
        {
          createdBy: s.parentId,
          status: 'published',
          publishedAt: new Date(),
          recipientCount: 9999,
          id: randomUUID(),
        },
      ),
    );

    const row = (await g.prisma.announcement.findUnique({ where: { id: a.id } }))!;
    expect(row.createdBy).toBe(s.ownerId);
    expect(row.status).toBe('draft');
    expect(row.publishedAt).toBeNull();
    // Never fanned out, so no count was ever written -- not the 9999 the body
    // asked for.
    expect(row.recipientCount).toBeNull();
  });

  it('a parent cannot read an announcement that was never sent to them', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'لمعلمين', bodyAr: 'نص', targetType: 'all_teachers',
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);

    // Authorized by the existence of a notification addressed to them, never by
    // the announcement's own targeting -- which is what stops a parent
    // discovering an announcement exists by guessing its id.
    await expect(g.announcements.readForActor(s.parentId, a.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('the parent’s view carries no targeting and no authorship', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص',
      targetType: 'contacts',
      targetIds: [s.parentId, s.otherParentId],
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);

    const view = await g.announcements.readForActor(s.parentId, a.id);
    const keys = Object.keys(view as Record<string, unknown>);

    // Telling one family who else the academy wrote to is a privacy failure
    // whether or not anyone asked for it, so the field is not on the response
    // at all rather than being filtered by a conditional.
    expect(keys).not.toContain('targetIds');
    expect(keys).not.toContain('targetType');
    expect(keys).not.toContain('createdBy');
    expect(keys).not.toContain('recipientCount');
    expect(JSON.stringify(view)).not.toContain(s.otherParentId);
  });

  it('an announcement cannot address a recipient the resolver would not', async () => {
    // A contact that cannot be messaged at all. Naming them explicitly in
    // target_ids must not be a way around that.
    await g.prisma.contact.update({
      where: { id: s.otherParentId },
      data: { canMessage: false },
    });

    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص',
      targetType: 'contacts',
      targetIds: [s.parentId, s.otherParentId],
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);

    expect((await announcementNotifications(a.id)).map((r) => r.recipientId)).toEqual([
      s.parentId,
    ]);
  });

  it('a parent of two targeted children is one recipient, not two', async () => {
    const second = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.learner (id, family_id, name, teacher_id)
       values ('${second}'::uuid, '${s.familyId}'::uuid, 'learner_o',
               '${s.teacherId}'::uuid)`,
    );

    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص',
      targetType: 'learners',
      targetIds: [s.learnerId, second],
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);

    const rows = await announcementNotifications(a.id);
    // Two parents in the family, one notification each -- not one per child.
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.recipientId))).toEqual(
      new Set([s.parentId, s.otherParentId]),
    );
  });

  it('every announcement notification goes through the ordinary engine', async () => {
    const a = await g.announcements.create(admin(), {
      titleAr: 'خبر', bodyAr: 'نص', targetType: 'all_parents',
    });
    await g.announcements.publish(admin(), a.id);
    await g.announcements.fanOut(a.id);

    const [row] = await announcementNotifications(a.id);
    // Not a special path: it has a registry type, a category, a dedupe key, a
    // template and a deep link, exactly like a message notification, which is
    // what gives it preferences, quiet hours and delivery tracking for free.
    expect(row.type).toBe(NotificationType.ACADEMY_ANNOUNCEMENT);
    expect(row.category).toBe('academy');
    expect(row.dedupeKey).toBe(`announcement:${a.id}:${row.recipientId}`);
    expect(row.templateKey).toBeTruthy();
    expect(row.deeplink).toBe(`/announcements/${a.id}`);
  });
});
