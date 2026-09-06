import { randomUUID } from 'node:crypto';
import { PrismaService } from '@platform/prisma.service';

/**
 * Database-level regressions for the two blockers fixed in this pass.
 *
 *   NF-006  a contact-authored message on a chat.conversation was rejected
 *           because the author check resolved the family through the legacy
 *           chat.thread, which is NULL under the canonical model.
 *   RT-025  a Student Group could exist without the family's primary owner,
 *           defeating the admin-presence condition BR-1 rests on
 *           (PRD v0.1 §7.3).
 *
 * These assert the invariants, not the implementation: any future rewrite of
 * the triggers must keep them true.
 */
describe('NF-006 / RT-025 · database invariants', () => {
  const prisma = new PrismaService();
  const ids = {
    staff: randomUUID(),
    coverage: randomUUID(),
    family: randomUUID(),
    contact: randomUUID(),
    learner: randomUUID(),
    otherLearner: randomUUID(),
    teacher: randomUUID(),
    direct: randomUUID(),
  };

  beforeAll(async () => {
    // Prisma's raw helpers take one statement at a time; $transaction keeps the
    // fixture atomic and makes the deferred constraint triggers fire at commit,
    // which is exactly the path production takes.
    await prisma.$transaction([
      prisma.$executeRawUnsafe(
        `INSERT INTO chat.staff (id, name, role) VALUES ('${ids.staff}', 'Owner', 'admin'), ('${ids.coverage}', 'Coverage', 'coverage')`,
      ),
      prisma.$executeRawUnsafe(
        `INSERT INTO chat.family (id, display_name, owner_id) VALUES ('${ids.family}', 'Test Family', '${ids.staff}')`,
      ),
      prisma.$executeRawUnsafe(
        `INSERT INTO chat.contact (id, family_id, name, role_preset, can_message) VALUES ('${ids.contact}', '${ids.family}', 'Parent', 'primary_guardian', true)`,
      ),
      prisma.$executeRawUnsafe(
        `INSERT INTO chat.learner (id, family_id, name) VALUES ('${ids.learner}', '${ids.family}', 'Child A'), ('${ids.otherLearner}', '${ids.family}', 'Child B')`,
      ),
      prisma.$executeRawUnsafe(
        `INSERT INTO chat.conversation (id, type, family_id, direct_key, title) VALUES ('${ids.direct}', 'direct', '${ids.family}', '${ids.direct}', 'Jawwid')`,
      ),
      prisma.$executeRawUnsafe(
        `INSERT INTO chat.conversation_member (conversation_id, actor_kind, actor_id, member_role) VALUES ('${ids.direct}', 'contact', '${ids.contact}', 'parent'), ('${ids.direct}', 'staff', '${ids.staff}', 'admin')`,
      ),
    ]);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM chat.family WHERE id = '${ids.family}'`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM chat.staff WHERE id IN ('${ids.staff}', '${ids.coverage}')`,
    );
    await prisma.$disconnect();
  });

  /** One transaction, so the deferred owner-presence trigger runs at COMMIT. */
  const insertGroup = (conversationId: string, learnerId: string, memberValues: string | null) =>
    prisma.$transaction([
      prisma.$executeRawUnsafe(
        `INSERT INTO chat.conversation (id, type, family_id, learner_id, title) VALUES ('${conversationId}', 'student_group', '${ids.family}', '${learnerId}', 'Group')`,
      ),
      ...(memberValues
        ? [
            prisma.$executeRawUnsafe(
              `INSERT INTO chat.conversation_member (conversation_id, actor_kind, actor_id, member_role) VALUES ${memberValues}`,
            ),
          ]
        : []),
    ]);

  describe('NF-006 · a contact may author on their family conversation', () => {
    it('accepts a contact-authored message on a conversation with no legacy thread', async () => {
      const id = randomUUID();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO chat.message
            (id, conversation_id, thread_id, author_type, author_id, body, visibility, seq, type, moderation, origin, attachments)
          VALUES
            ('${id}', '${ids.direct}', NULL, 'contact', '${ids.contact}', 'hi', 'customer', 1, 'text', 'published', 'user', '[]'::jsonb)
        `),
      ).resolves.toBeDefined();
    });

    it('still rejects a contact from another family', async () => {
      const stranger = randomUUID();
      await expect(
        prisma.$executeRawUnsafe(`
          INSERT INTO chat.message
            (id, conversation_id, thread_id, author_type, author_id, body, visibility, seq, type, moderation, origin, attachments)
          VALUES
            ('${randomUUID()}', '${ids.direct}', NULL, 'contact', '${stranger}', 'hi', 'customer', 2, 'text', 'published', 'user', '[]'::jsonb)
        `),
      ).rejects.toThrow();
    });
  });

  describe('RT-025 · a Student Group carries the family primary owner (PRD §7.3)', () => {
    it('rejects a group created with no members', async () => {
      await expect(insertGroup(randomUUID(), ids.learner, null)).rejects.toThrow();
    });

    it('rejects a group holding only a teacher and a parent', async () => {
      const id = randomUUID();
      await expect(
        insertGroup(
          id,
          ids.learner,
          `('${id}', 'teacher', '${ids.teacher}', 'teacher'), ('${id}', 'contact', '${ids.contact}', 'parent')`,
        ),
      ).rejects.toThrow();
    });

    it('rejects a group whose only admin is a coverage admin, not the owner', async () => {
      const id = randomUUID();
      await expect(
        insertGroup(
          id,
          ids.learner,
          `('${id}', 'contact', '${ids.contact}', 'parent'), ('${id}', 'staff', '${ids.coverage}', 'admin')`,
        ),
      ).rejects.toThrow();
    });

    it('accepts a compliant group, then refuses to lose its owner', async () => {
      const id = randomUUID();
      await insertGroup(
        id,
        ids.learner,
        `('${id}', 'teacher', '${ids.teacher}', 'teacher'), ('${id}', 'contact', '${ids.contact}', 'parent'), ('${id}', 'staff', '${ids.staff}', 'admin')`,
      );

      // Soft removal.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE chat.conversation_member SET left_at = now() WHERE conversation_id = '${id}' AND actor_id = '${ids.staff}'`,
        ),
      ).rejects.toThrow();

      // Hard removal.
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM chat.conversation_member WHERE conversation_id = '${id}' AND actor_id = '${ids.staff}'`,
        ),
      ).rejects.toThrow();

      const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM chat.conversation_member WHERE conversation_id = '${id}' AND actor_id = '${ids.staff}' AND left_at IS NULL`,
      );
      expect(Number(rows[0].n)).toBe(1);
    });
  });
});
