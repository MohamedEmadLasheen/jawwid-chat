/**
 * PHASE 6 -- SMART MODERATION, END TO END.
 *
 * The engine itself is proved exhaustively and without a database in
 * test/unit/moderation/content-scanner.spec.ts. This suite proves the things
 * that only exist once the engine is wired to the product:
 *
 *   - a safe message is SENT, and a flagged one is HELD, through the real
 *     send path;
 *   - approve, reject, EDIT THEN SEND and delete each do what they say;
 *   - the original submitted content survives every one of them;
 *   - a rule an administrator writes actually changes what is detected, and
 *     disabling it actually stops it;
 *   - escalation happens on the configured threshold and reaches a manager;
 *   - none of the above is reachable by somebody who should not have it.
 */
import { PrismaService } from '@platform/prisma.service';
import { CommErrorCode } from '@platform/errors';
import { buildGraph, seed, truncate, Scenario } from './harness';
import {
  MatchType,
  Moderation,
  ModerationCategory,
  ModerationSeverity,
} from '@communication/contracts/vocab';

const prisma = new PrismaService();
const g = buildGraph();
let s: Scenario;

const SAFE_BODY = 'Assalamu alaikum, your child did very well today.';
const PHONE_BODY = 'Well done today. Call me on +201012345678 if you need anything.';

beforeEach(async () => {
  await truncate(prisma);
  s = await seed(prisma);
  // on_duty() is AI #1's engine; it is pinned so this suite asserts OUR
  // behaviour and not the coverage engine's. The family's owner is on duty, so
  // they are the active handler and therefore the approver.
  g.coverage.onDutyId = s.ownerId;
  g.moderationRules.invalidate();
  g.config.invalidate();
  // chat.config is seed data and is NOT truncated, so a test that changes a
  // threshold would leak it into every test after it.
  await prisma.config.deleteMany({ where: { key: 'moderation.escalation_hours' } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** The group every test speaks in, on the Phase 6 default (`smart`). */
async function group() {
  return g.conversations.ensureStudentGroup(s.learnerId, s.ownerId);
}

async function approvalOf(messageId: string) {
  const a = await prisma.messageApproval.findUnique({ where: { messageId } });
  if (!a) throw new Error(`no approval for message ${messageId}`);
  return a;
}

// =========================================================================
describe('the send path', () => {
  it('SENDS a safe message rather than holding it -- the objective of the phase', async () => {
    const conv = await group();
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: SAFE_BODY,
    });

    expect(msg.moderation).toBe(Moderation.PUBLISHED);
    expect(await prisma.messageApproval.count({ where: { messageId: msg.id } })).toBe(0);
    // Delivered, which is the whole point: the teacher is not waiting.
    expect(await prisma.messageReceipt.count({ where: { messageId: msg.id } })).toBeGreaterThan(0);

    const parentView = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    expect(parentView.messages.map((m) => m.body)).toContain(SAFE_BODY);
  });

  it('HOLDS a flagged message, and records which rule held it', async () => {
    const conv = await group();
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: PHONE_BODY,
    });

    expect(msg.moderation).toBe(Moderation.PENDING);

    const approval = await approvalOf(msg.id);
    expect(approval.decision).toBe('pending');
    expect(approval.triggerSource).toBe('scan');
    expect(approval.highestSeverity).toBe(ModerationSeverity.HIGH);

    const flags = await prisma.messageModerationFlag.findMany({ where: { messageId: msg.id } });
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.map((f) => f.category)).toContain(ModerationCategory.PHONE_NUMBER);
    // The excerpt is the evidence the moderator reads.
    expect(flags[0].matchedExcerpt).toContain('+201012345678');
  });

  it('a held message is not delivered and not visible to the group', async () => {
    const conv = await group();
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: PHONE_BODY,
    });

    expect(await prisma.messageReceipt.count({ where: { messageId: msg.id } })).toBe(0);
    const parentView = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    expect(parentView.messages.map((m) => m.id)).not.toContain(msg.id);
  });

  it('a parent sharing contact details is held too, not only a teacher', async () => {
    const conv = await group();
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.parentId, body: 'my email is name@example.com',
    });
    expect(msg.moderation).toBe(Moderation.PENDING);
    const flags = await prisma.messageModerationFlag.findMany({ where: { messageId: msg.id } });
    expect(flags.map((f) => f.category)).toContain(ModerationCategory.EMAIL_ADDRESS);
  });

  it('records EVERY matched rule and the highest severity, not the first', async () => {
    const conv = await group();
    await g.moderationRules.create(s.managerId, {
      name: 'Cancellation intent',
      category: ModerationCategory.CANCELLATION,
      severity: ModerationSeverity.CRITICAL,
      matchType: MatchType.PHRASE,
      pattern: 'cancel my subscription',
    });

    const msg = await g.messages.send({
      conversationId: conv.id,
      senderId: s.parentId,
      body: 'I want to cancel my subscription, call +201012345678',
    });

    const flags = await prisma.messageModerationFlag.findMany({ where: { messageId: msg.id } });
    const categories = flags.map((f) => f.category);
    expect(categories).toContain(ModerationCategory.PHONE_NUMBER);
    expect(categories).toContain(ModerationCategory.CANCELLATION);

    const approval = await approvalOf(msg.id);
    expect(approval.highestSeverity).toBe(ModerationSeverity.CRITICAL);
  });

  it('the scanner is on the SERVER path, so it cannot be skipped by the caller', async () => {
    // There is no argument to send() that turns moderation off. The intent
    // fields a client may set are visibility and requestedMode, and neither
    // reaches the scan decision -- which is what makes the frontend not the
    // security boundary.
    const conv = await group();
    const msg = await g.messages.send({
      conversationId: conv.id,
      senderId: s.teacherId,
      body: PHONE_BODY,
      visibility: 'customer',
      requestedMode: 'owner',
    });
    expect(msg.moderation).toBe(Moderation.PENDING);
  });

  it('an admin message is never held, whatever it says', async () => {
    // Staff moderation was never the policy, and the scan does not change it:
    // a supervisor sharing the academy's own number is doing their job.
    const conv = await group();
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.ownerId, body: PHONE_BODY,
    });
    expect(msg.moderation).toBe(Moderation.PUBLISHED);
  });

  it('a 1:1 family conversation is not moderated: approval applies to groups', async () => {
    const direct = await g.conversations.getOrCreateDirect(s.ownerId, s.parentId);
    const msg = await g.messages.send({
      conversationId: direct.id, senderId: s.parentId, body: PHONE_BODY,
    });
    expect(msg.moderation).toBe(Moderation.PUBLISHED);
  });
});

// =========================================================================
describe('the moderation queue', () => {
  async function held(body = PHONE_BODY) {
    const conv = await group();
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body,
    });
    return { conv, msg, approval: await approvalOf(msg.id) };
  }

  it('carries everything the card needs, in one request', async () => {
    const { msg } = await held();
    const [item] = await g.approvals.listPending(s.ownerId);

    expect(item.messageId).toBe(msg.id);
    expect(item.requestedBy).toBe(s.teacherId);
    expect(item.requestedByName).toBeTruthy();      // sender, by name
    expect(item.conversationType).toBe('student_group'); // where
    expect(item.familyId).toBe(s.familyId);
    expect(item.flags.length).toBeGreaterThan(0);   // reason
    expect(item.highestSeverity).toBe(ModerationSeverity.HIGH);
    expect(item.createdAt).toBeTruthy();            // timestamp
    expect(item.pendingForMs).toBeGreaterThanOrEqual(0);
    expect(item.originalBody).toBe(PHONE_BODY);     // original content
    expect(item.trigger).toBe('scan');
  });

  it('APPROVE releases the message through the normal send flow', async () => {
    const { conv, msg, approval } = await held();
    await g.approvals.approve(approval.id, s.ownerId);

    const after = await prisma.message.findUnique({ where: { id: msg.id } });
    expect(after!.moderation).toBe(Moderation.PUBLISHED);
    // Receipts, i.e. real delivery -- not merely a state change.
    expect(await prisma.messageReceipt.count({ where: { messageId: msg.id } })).toBeGreaterThan(0);
    const parentView = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    expect(parentView.messages.map((m) => m.id)).toContain(msg.id);
  });

  it('REJECT does not send it, and keeps the original for audit', async () => {
    const { conv, msg, approval } = await held();
    await g.approvals.reject(approval.id, s.ownerId, 'please do not share personal numbers');

    const after = await prisma.message.findUnique({ where: { id: msg.id } });
    expect(after!.moderation).toBe(Moderation.REJECTED);
    // The original text is untouched: rejection changes the state, not the words.
    expect(after!.body).toBe(PHONE_BODY);
    expect(await prisma.messageReceipt.count({ where: { messageId: msg.id } })).toBe(0);

    const parentView = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    expect(parentView.messages.map((m) => m.id)).not.toContain(msg.id);

    // The reason reaches the sender, which is what makes a rejection actionable.
    const mine = await g.approvals.listMine(s.teacherId);
    expect(mine[0].approvalId).toBe(approval.id);
  });

  // ---------------------------------------------------------------------
  describe('EDIT THEN SEND', () => {
    const CLEANED = 'Well done today. Please message me here if you need anything.';

    it('sends the edited body and keeps the original recoverable', async () => {
      const { conv, msg, approval } = await held();
      await g.approvals.editThenSend(approval.id, s.ownerId, CLEANED, 'removed a phone number');

      const after = await prisma.message.findUnique({ where: { id: msg.id } });
      expect(after!.moderation).toBe(Moderation.PUBLISHED);
      // The EDITED text is what the family receives.
      expect(after!.body).toBe(CLEANED);
      const parentView = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
      expect(parentView.messages.map((m) => m.body)).toContain(CLEANED);

      // THE ORIGINAL SURVIVES, in the append-only revision log.
      const revisions = await prisma.messageRevision.findMany({
        where: { messageId: msg.id }, orderBy: { revision: 'asc' },
      });
      expect(revisions).toHaveLength(1);
      expect(revisions[0].revision).toBe(1);
      expect(revisions[0].body).toBe(PHONE_BODY);
      expect(revisions[0].replacedBy).toBe(s.ownerId);
    });

    it('records the moderator, the timestamp and the decision', async () => {
      const { msg, approval } = await held();
      await g.approvals.editThenSend(approval.id, s.ownerId, CLEANED);

      const decided = await approvalOf(msg.id);
      expect(decided.decision).toBe('approved');
      expect(decided.approverId).toBe(s.ownerId);
      expect(decided.editedBy).toBe(s.ownerId);
      expect(decided.editedAt).not.toBeNull();
      expect(decided.decidedAt).not.toBeNull();

      const after = await prisma.message.findUnique({ where: { id: msg.id } });
      expect(after!.editedBy).toBe(s.ownerId);
      expect(after!.editCount).toBe(1);
    });

    it('the queue keeps serving the ORIGINAL submitted content afterwards', async () => {
      const { msg, approval } = await held();
      await g.approvals.editThenSend(approval.id, s.ownerId, CLEANED);

      // Read back through the sender's own view, which shares the enrichment.
      const mine = await g.approvals.listMine(s.teacherId);
      const item = mine.find((a) => a.messageId === msg.id);
      expect(item!.originalBody).toBe(PHONE_BODY);
      expect(item!.message.body).toBe(CLEANED);
      expect(item!.editedAt).not.toBeNull();
    });

    it('the reason the message was held survives the fix', async () => {
      const { msg, approval } = await held();
      await g.approvals.editThenSend(approval.id, s.ownerId, CLEANED);
      const flags = await prisma.messageModerationFlag.findMany({ where: { messageId: msg.id } });
      expect(flags.map((f) => f.category)).toContain(ModerationCategory.PHONE_NUMBER);
    });

    it('REFUSES an edit that is still flagged', async () => {
      // The approver removed one of the two numbers. The message is not fixed,
      // and this is the one path that could otherwise put unscanned content in
      // front of a family.
      const conv = await group();
      const msg = await g.messages.send({
        conversationId: conv.id,
        senderId: s.teacherId,
        body: 'call +201012345678 or 01098765432',
      });
      const approval = await approvalOf(msg.id);

      await expect(
        g.approvals.editThenSend(approval.id, s.ownerId, 'call me on 01098765432'),
      ).rejects.toMatchObject({ code: CommErrorCode.MODERATION_EDIT_STILL_FLAGGED });

      // Still pending, and still holding the original.
      const stillHeld = await approvalOf(msg.id);
      expect(stillHeld.decision).toBe('pending');
      const after = await prisma.message.findUnique({ where: { id: msg.id } });
      expect(after!.body).toBe('call +201012345678 or 01098765432');
    });

    it('refuses an empty edit -- rejecting is the way to refuse a message', async () => {
      const { approval } = await held();
      await expect(g.approvals.editThenSend(approval.id, s.ownerId, '   ')).rejects.toMatchObject({
        code: CommErrorCode.EMPTY_MESSAGE,
      });
    });

    it('the stamped edit is the ONLY way a body changes: a raw update is still refused', async () => {
      // The Phase 2 backstop was not weakened to allow edit-then-send. It is
      // satisfied, which is a different thing.
      const { msg } = await held();
      await expect(
        prisma.$executeRawUnsafe(
          `update chat.message set body = 'rewritten' where id = '${msg.id}'::uuid`,
        ),
      ).rejects.toThrow(/immutable/);
    });
  });

  // ---------------------------------------------------------------------
  it('DELETE rejects the message, withdraws it, and destroys no evidence', async () => {
    const { conv, msg, approval } = await held();
    // messages.delete is manager-and-above, so the manager performs it.
    await g.approvals.deleteHeld(approval.id, s.managerId, 'shared personal contact details');

    const after = await prisma.message.findUnique({ where: { id: msg.id } });
    expect(after!.moderation).toBe(Moderation.REJECTED);
    expect(after!.deletedForAll).toBe(true);
    expect(after!.deletedBy).toBe(s.managerId);
    expect(after!.redactedReason).toMatch(/personal contact/);
    // The existing deletion architecture STAMPS rather than erases, so the
    // moderation record stays complete.
    expect(after!.body).toBe(PHONE_BODY);

    // The approval and the flags survive, so the audit can still be read.
    const decided = await approvalOf(msg.id);
    expect(decided.decision).toBe('rejected');
    expect(await prisma.messageModerationFlag.count({ where: { messageId: msg.id } }))
      .toBeGreaterThan(0);

    const parentView = await g.messages.list({ conversationId: conv.id, actorId: s.parentId });
    expect(parentView.messages.map((m) => m.id)).not.toContain(msg.id);
  });

  it('an item already acted upon cannot be acted upon again', async () => {
    const { approval } = await held();
    await g.approvals.approve(approval.id, s.ownerId);
    for (const attempt of [
      () => g.approvals.approve(approval.id, s.ownerId),
      () => g.approvals.reject(approval.id, s.ownerId, 'too late'),
      () => g.approvals.editThenSend(approval.id, s.ownerId, 'too late'),
      () => g.approvals.deleteHeld(approval.id, s.managerId, 'too late'),
    ]) {
      await expect(attempt()).rejects.toMatchObject({
        code: CommErrorCode.APPROVAL_ALREADY_DECIDED,
      });
    }
  });

  it('every decision is auditable', async () => {
    const { msg, approval } = await held();
    await g.approvals.editThenSend(approval.id, s.ownerId, 'cleaned up', 'removed a number');

    const rows = await prisma.auditLog.findMany({
      where: { entityId: msg.id }, orderBy: { at: 'asc' },
    });
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('message.approved');
    expect(actions).toContain('message.moderation_edited');
    // Every row names the moderator and carries a reason.
    for (const r of rows) {
      expect(r.actorId).toBe(s.ownerId);
      expect(r.reason).toBeTruthy();
    }
  });
});

// =========================================================================
describe('authorization', () => {
  async function held() {
    const conv = await group();
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: PHONE_BODY,
    });
    return approvalOf(msg.id);
  }

  it('a teacher cannot approve, reject, edit-and-send or delete', async () => {
    const approval = await held();
    for (const attempt of [
      () => g.approvals.approve(approval.id, s.teacherId),
      () => g.approvals.reject(approval.id, s.teacherId, 'mine'),
      () => g.approvals.editThenSend(approval.id, s.teacherId, 'mine now'),
      () => g.approvals.deleteHeld(approval.id, s.teacherId, 'mine now'),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: CommErrorCode.CANNOT_APPROVE });
    }
  });

  it('a parent cannot decide another message', async () => {
    const approval = await held();
    await expect(g.approvals.editThenSend(approval.id, s.parentId, 'x')).rejects.toMatchObject({
      code: CommErrorCode.CANNOT_APPROVE,
    });
  });

  it('an admin outside the family\'s scope cannot decide', async () => {
    const approval = await held();
    await expect(g.approvals.editThenSend(approval.id, s.otherAdminId, 'x')).rejects.toMatchObject({
      code: CommErrorCode.OUT_OF_SCOPE,
    });
  });

  it('DELETE needs messages.delete, which an admin does not hold', async () => {
    const approval = await held();
    // The owner may approve and reject this very item -- so this is a check on
    // the ACTION, not on the person.
    await expect(
      g.approvals.deleteHeld(approval.id, s.ownerId, 'withdrawing it'),
    ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
    await g.approvals.deleteHeld(approval.id, s.managerId, 'withdrawing it');
  });

  it('a teacher never sees the moderation queue', async () => {
    await held();
    await expect(g.approvals.listPending(s.teacherId)).rejects.toMatchObject({
      code: CommErrorCode.CANNOT_APPROVE,
    });
  });

  it('a teacher sees their OWN held message, without the detection details', async () => {
    await held();
    const mine = await g.approvals.listMine(s.teacherId);
    expect(mine).toHaveLength(1);
    // Publishing the patterns to the people being detected would tell them how
    // to word their way past them.
    expect(mine[0].flags).toEqual([]);
  });
});

// =========================================================================
describe('rule management', () => {
  const CUSTOM = {
    name: 'Refund promise',
    category: ModerationCategory.CUSTOM,
    severity: ModerationSeverity.HIGH,
    matchType: MatchType.PHRASE,
    pattern: 'i will refund you',
  };

  it('a custom rule an administrator creates actually changes what is detected', async () => {
    const conv = await group();
    const before = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: 'I will refund you tomorrow',
    });
    expect(before.moderation).toBe(Moderation.PUBLISHED);

    await g.moderationRules.create(s.managerId, CUSTOM);

    const after = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: 'I will refund you tomorrow, promise',
    });
    expect(after.moderation).toBe(Moderation.PENDING);
    const flags = await prisma.messageModerationFlag.findMany({ where: { messageId: after.id } });
    expect(flags[0].ruleName).toBe('Refund promise');
  });

  it('a DISABLED rule does not trigger', async () => {
    const conv = await group();
    const rule = await g.moderationRules.create(s.managerId, CUSTOM);

    await g.moderationRules.setEnabled(s.managerId, rule.id, false);

    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: 'I will refund you tomorrow',
    });
    expect(msg.moderation).toBe(Moderation.PUBLISHED);
  });

  it('disabling a BUILT-IN rule turns that detection off -- the URL policy is configurable', async () => {
    const conv = await group();
    const url = (await g.moderationRules.list(s.managerId)).find((r) => r.category === 'url');
    expect(url!.isBuiltin).toBe(true);

    const held = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: 'watch https://example.com/surah',
    });
    expect(held.moderation).toBe(Moderation.PENDING);

    await g.moderationRules.setEnabled(s.managerId, url!.id, false);

    const sent = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: 'watch https://example.com/surah-2',
    });
    expect(sent.moderation).toBe(Moderation.PUBLISHED);
  });

  it('re-enabling brings it back, and severity is editable', async () => {
    const rule = await g.moderationRules.create(s.managerId, CUSTOM);
    await g.moderationRules.setEnabled(s.managerId, rule.id, false);
    const back = await g.moderationRules.setEnabled(s.managerId, rule.id, true);
    expect(back.isEnabled).toBe(true);

    const retuned = await g.moderationRules.update(s.managerId, rule.id, {
      severity: ModerationSeverity.LOW,
    });
    expect(retuned.severity).toBe(ModerationSeverity.LOW);

    const conv = await group();
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: 'I will refund you',
    });
    expect((await approvalOf(msg.id)).highestSeverity).toBe(ModerationSeverity.LOW);
  });

  it('an INVALID regex is refused when the rule is written, not when it is applied', async () => {
    await expect(
      g.moderationRules.create(s.managerId, {
        name: 'Broken', category: ModerationCategory.CUSTOM,
        severity: ModerationSeverity.LOW, matchType: MatchType.REGEX, pattern: '([unclosed',
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.MODERATION_RULE_INVALID });

    // Nothing was stored, so the scanner never sees it.
    expect(await prisma.moderationRule.count({ where: { name: 'Broken' } })).toBe(0);
  });

  it('a catastrophically backtracking pattern is refused', async () => {
    await expect(
      g.moderationRules.create(s.managerId, {
        name: 'Evil', category: ModerationCategory.CUSTOM,
        severity: ModerationSeverity.LOW, matchType: MatchType.REGEX, pattern: '(a+)+$',
      }),
    ).rejects.toMatchObject({ code: CommErrorCode.MODERATION_RULE_INVALID });
  });

  it('a stored rule that cannot be evaluated fails CLOSED', async () => {
    // Only reachable by a direct database write, which is exactly why the
    // behaviour has to be right: the message is HELD, never sent.
    const conv = await group();
    await prisma.$executeRawUnsafe(
      `insert into chat.moderation_rule (name, category, severity, match_type, pattern)
       values ('Corrupt', 'custom', 'low', 'regex', '([unclosed')`,
    );
    g.moderationRules.invalidate();

    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: SAFE_BODY,
    });
    expect(msg.moderation).toBe(Moderation.PENDING);
    expect((await approvalOf(msg.id)).highestSeverity).toBe(ModerationSeverity.CRITICAL);
  });

  it('a rule change takes effect immediately, not when a cache expires', async () => {
    const conv = await group();
    // Warm the cache.
    await g.messages.send({ conversationId: conv.id, senderId: s.teacherId, body: SAFE_BODY });
    await g.moderationRules.create(s.managerId, CUSTOM);
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: 'I will refund you',
    });
    expect(msg.moderation).toBe(Moderation.PENDING);
  });

  describe('authorization', () => {
    it('an ADMIN may read the rules but not write them', async () => {
      const rules = await g.moderationRules.list(s.ownerId);
      expect(rules.length).toBeGreaterThan(0);

      await expect(g.moderationRules.create(s.ownerId, CUSTOM)).rejects.toMatchObject({
        code: CommErrorCode.PERMISSION_DENIED,
      });
      await expect(
        g.moderationRules.setEnabled(s.ownerId, rules[0].id, false),
      ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
    });

    it('a TEACHER may neither read nor write them', async () => {
      await expect(g.moderationRules.list(s.teacherId)).rejects.toMatchObject({
        code: CommErrorCode.PERMISSION_DENIED,
      });
      await expect(g.moderationRules.create(s.teacherId, CUSTOM)).rejects.toMatchObject({
        code: CommErrorCode.PERMISSION_DENIED,
      });
    });

    it('a PARENT may neither read nor write them', async () => {
      await expect(g.moderationRules.list(s.parentId)).rejects.toMatchObject({
        code: CommErrorCode.PERMISSION_DENIED,
      });
    });

    it('every rule change is audited with its pattern', async () => {
      const rule = await g.moderationRules.create(s.managerId, CUSTOM);
      await g.moderationRules.setEnabled(s.managerId, rule.id, false);

      const rows = await prisma.auditLog.findMany({
        where: { entity: 'moderation_rule', entityId: rule.id }, orderBy: { at: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual([
        'moderation_rule.created', 'moderation_rule.updated',
      ]);
      expect(JSON.stringify(rows[0].after)).toContain('i will refund you');
      expect(rows[1].reason).toMatch(/disabled/);
    });
  });
});

// =========================================================================
describe('escalation', () => {
  async function heldAt(ageHours: number) {
    const conv = await group();
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: PHONE_BODY,
    });
    const approval = await approvalOf(msg.id);
    // Age the row rather than the clock: the sweep takes `now`, so this proves
    // the THRESHOLD rather than the test's patience.
    await prisma.$executeRawUnsafe(
      `update chat.message_approval set created_at = now() - interval '${ageHours} hours'
        where id = '${approval.id}'::uuid`,
    );
    return { msg, approvalId: approval.id };
  }

  it('does NOT escalate an item inside the configured threshold', async () => {
    const { approvalId } = await heldAt(1); // threshold is 3
    expect(await g.moderation.escalateOverdue()).toBe(0);
    const a = await prisma.messageApproval.findUnique({ where: { id: approvalId } });
    expect(a!.escalatedAt).toBeNull();
  });

  it('escalates an item past the threshold, to a manager', async () => {
    const { approvalId } = await heldAt(5);
    expect(await g.moderation.escalateOverdue()).toBe(1);

    const a = await prisma.messageApproval.findUnique({ where: { id: approvalId } });
    expect(a!.escalatedAt).not.toBeNull();
    expect(a!.escalatedTo).toBe(s.managerId);
    // Escalation moves ACCOUNTABILITY. It does not decide the message.
    expect(a!.decision).toBe('pending');
  });

  it('follows the CONFIGURED threshold, not a hardcoded one', async () => {
    const { approvalId } = await heldAt(5);
    await prisma.config.upsert({
      where: { key: 'moderation.escalation_hours' },
      create: { key: 'moderation.escalation_hours', value: 8, scope: 'communication' },
      update: { value: 8 },
    });
    g.config.invalidate();

    expect(await g.moderation.escalateOverdue()).toBe(0);
    expect(
      (await prisma.messageApproval.findUnique({ where: { id: approvalId } }))!.escalatedAt,
    ).toBeNull();
  });

  it('is idempotent: a second sweep escalates nothing again', async () => {
    await heldAt(5);
    expect(await g.moderation.escalateOverdue()).toBe(1);
    expect(await g.moderation.escalateOverdue()).toBe(0);
  });

  it('never escalates an item that was already decided', async () => {
    const { approvalId } = await heldAt(5);
    await g.approvals.approve(approvalId, s.ownerId);
    expect(await g.moderation.escalateOverdue()).toBe(0);
  });

  it('makes the escalation visible to the manager, as a queue filter', async () => {
    const { msg } = await heldAt(5);
    await g.moderation.escalateOverdue();

    const escalated = await g.approvals.listPending(s.managerId, undefined, {
      escalatedOnly: true,
    });
    expect(escalated.map((a) => a.messageId)).toEqual([msg.id]);
    expect(escalated[0].escalatedTo).toBe(s.managerId);
    expect(escalated[0].pendingForMs).toBeGreaterThan(4 * 3600_000);
  });

  it('notifies through the outbox rather than only writing a row', async () => {
    // ES-1 in escalation-model.md: "an escalation that nobody receives is
    // worse than none, because the escalating admin believes they have handed
    // the problem over."
    await heldAt(5);
    await g.moderation.escalateOverdue();
    const events = await prisma.outboxEvent.findMany({ where: { type: 'moderation.escalated' } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0].payload)).toContain(s.managerId);
  });

  it('is audited', async () => {
    const { msg } = await heldAt(5);
    await g.moderation.escalateOverdue();
    const row = await prisma.auditLog.findFirst({
      where: { entityId: msg.id, action: 'moderation.escalated' },
    });
    expect(row).not.toBeNull();
    expect(row!.reason).toMatch(/3h/);
  });

  it('the sweeper wraps it and never throws into the worker loop', async () => {
    await heldAt(5);
    expect(await g.moderationSweeper.sweep()).toEqual({ escalated: 1 });
  });
});

// =========================================================================
describe('the per-conversation policy', () => {
  it('`all` still holds everything, which is the pre-Phase-6 behaviour', async () => {
    const conv = await group();
    await prisma.conversation.update({
      where: { id: conv.id }, data: { teacherModeration: 'all' },
    });
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: SAFE_BODY,
    });
    expect(msg.moderation).toBe(Moderation.PENDING);
    expect((await approvalOf(msg.id)).triggerSource).toBe('policy');
  });

  it('`off` sends everything, flagged or not', async () => {
    const conv = await group();
    await prisma.conversation.update({
      where: { id: conv.id }, data: { teacherModeration: 'off' },
    });
    const msg = await g.messages.send({
      conversationId: conv.id, senderId: s.teacherId, body: PHONE_BODY,
    });
    expect(msg.moderation).toBe(Moderation.PUBLISHED);
  });

  it('the legacy boolean stays a live mirror of the mode, in both directions', async () => {
    const conv = await group();
    // Every pre-Phase-6 reader depends on this.
    await prisma.conversation.update({
      where: { id: conv.id }, data: { teacherModeration: 'all' },
    });
    let row = await prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(row!.teacherRequiresApproval).toBe(true);

    await prisma.conversation.update({
      where: { id: conv.id }, data: { teacherRequiresApproval: false },
    });
    row = await prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(row!.teacherModeration).toBe('off');
  });

  it('a new student group defaults to `smart`', async () => {
    const conv = await group();
    const row = await prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(row!.teacherModeration).toBe('smart');
    expect(row!.parentModeration).toBe('smart');
  });
});
