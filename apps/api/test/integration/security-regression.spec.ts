/**
 * THE PHASE 1 SECURITY REGRESSION SUITE.
 *
 * One place that runs the attacks Phase 1 exists to stop, end to end, against
 * the real services and the real schema. The individual suites prove their own
 * subject in depth; this one is the standing answer to "is the foundation still
 * holding", and it is deliberately written as attacks rather than as features.
 *
 * Every case here is an ATTEMPT THAT MUST FAIL, or a legitimate action that
 * must keep working next to one -- because a security suite that only proves
 * refusals will happily pass on a system that refuses everything.
 */
import { randomUUID } from 'node:crypto';
import { buildGraph, seed, truncate, Scenario } from './harness';
import { CommErrorCode } from '@platform/errors';
import { AuthError } from '@platform/auth/auth.errors';
import { signAccessToken, verifyAccessToken } from '@platform/auth/tokens';

const g = buildGraph();
let s: Scenario;
let myConversationId: string;
let otherFamilyId: string;
let otherParentId: string;
let otherConversationId: string;

const PASSWORD = 'a-sufficiently-long-password';
const subjectOf = (actorId: string) => `subject_${actorId}`;
const actorOf = async (id: string) => (await g.identity.resolveActor(id))!;

beforeEach(async () => {
  g.coverage.onDutyId = null;
  await truncate(g.prisma);
  s = await seed(g.prisma);
  await g.prisma.$executeRawUnsafe('delete from chat.auth_throttle');

  for (const actorId of [s.ownerId, s.managerId, s.parentId]) {
    await g.accounts.setPassword(s.accounts[actorId], PASSWORD, {
      reason: 'test fixture',
      invalidateSessions: false,
    });
  }

  otherFamilyId = randomUUID();
  otherParentId = randomUUID();
  const account = randomUUID();
  await g.prisma.$executeRawUnsafe(
    `insert into chat.account (id, subject, kind, status)
     values ('${account}'::uuid, 'subject_${otherParentId}', 'family', 'active')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.family (id, display_name, owner_id, language)
     values ('${otherFamilyId}'::uuid, 'family_zeta', '${s.otherAdminId}'::uuid, 'ar')`,
  );
  await g.prisma.$executeRawUnsafe(
    `insert into chat.contact (id, account_id, family_id, name, role_preset, can_message,
                               can_view_progress, can_manage_schedule, can_manage_billing,
                               can_manage_contacts, can_cancel, is_active)
     values ('${otherParentId}'::uuid, '${account}'::uuid, '${otherFamilyId}'::uuid,
             'parent_z', 'primary_guardian', true, true, true, true, true, true, true)`,
  );

  myConversationId = (await g.conversations.getOrCreateDirect(s.ownerId, s.parentId)).id;
  otherConversationId = (
    await g.conversations.getOrCreateDirect(s.otherAdminId, otherParentId)
  ).id;
});

afterAll(async () => {
  await g.prisma.$disconnect();
});

// =========================================================================
describe('AUTHENTICATION', () => {
  const secret = process.env.JWT_ACCESS_SECRET!;

  it('refuses a token forged with the wrong key', async () => {
    const forged = signAccessToken(
      { sub: s.accounts[s.ownerId], sid: randomUUID(), act: s.ownerId, knd: 'staff' },
      'a-completely-different-secret-of-32-chars',
      900,
    );
    expect(await g.auth.authenticate(forged)).toBeNull();
  });

  it('refuses alg:none and an algorithm the token chose for itself', async () => {
    const claims = { sub: s.accounts[s.ownerId], sid: randomUUID(), act: s.ownerId, knd: 'staff', iat: 1, exp: 4102444800 };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');

    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(await g.auth.authenticate(`${none}.${body}.`)).toBeNull();

    // Correctly HMAC'd, but the header claims RS256. The header is validated
    // against a constant; it never selects the algorithm.
    const real = signAccessToken(claims, secret, 900).split('.');
    const rs256 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    expect(await g.auth.authenticate(`${rs256}.${real[1]}.${real[2]}`)).toBeNull();
  });

  it('refuses a tampered payload -- the classic privilege upgrade', async () => {
    const issued = await g.auth.login(subjectOf(s.parentId), PASSWORD, { clientKey: 'a' });
    const [header, , signature] = issued.accessToken.split('.');
    const claims = verifyAccessToken(issued.accessToken, secret)!;

    // "I am the manager now."
    const escalated = Buffer.from(
      JSON.stringify({ ...claims, act: s.managerId, knd: 'staff' }),
    ).toString('base64url');
    expect(await g.auth.authenticate(`${header}.${escalated}.${signature}`)).toBeNull();
  });

  it('refuses a VALID token whose claims name a different actor than its session', async () => {
    // Signed by us, so the signature verifies. The actor in the token is not
    // the actor the session resolves to, and that mismatch is refused.
    const issued = await g.auth.login(subjectOf(s.parentId), PASSWORD, { clientKey: 'b' });
    const claims = verifyAccessToken(issued.accessToken, secret)!;
    const swapped = signAccessToken(
      { sub: claims.sub, sid: claims.sid, act: s.managerId, knd: 'staff' },
      secret,
      900,
    );
    expect(await g.auth.authenticate(swapped)).toBeNull();
  });

  it('refuses an expired token', async () => {
    const issued = await g.auth.login(subjectOf(s.ownerId), PASSWORD, { clientKey: 'c' });
    const claims = verifyAccessToken(issued.accessToken, secret)!;
    const expired = signAccessToken(
      { sub: claims.sub, sid: claims.sid, act: claims.act, knd: claims.knd },
      secret,
      -1,
    );
    expect(await g.auth.authenticate(expired)).toBeNull();
  });

  it('refuses a token whose session was revoked', async () => {
    const issued = await g.auth.login(subjectOf(s.ownerId), PASSWORD, { clientKey: 'd' });
    expect(await g.auth.authenticate(issued.accessToken)).not.toBeNull();
    await g.sessions.revokeAll(s.accounts[s.ownerId], 'test');
    expect(await g.auth.authenticate(issued.accessToken)).toBeNull();
  });

  it('refuses a token once the account is deactivated', async () => {
    const issued = await g.auth.login(subjectOf(s.parentId), PASSWORD, { clientKey: 'e' });
    await g.accounts.deactivate(s.accounts[s.parentId], s.managerId, 'test: offboarded');
    expect(await g.auth.authenticate(issued.accessToken)).toBeNull();
  });

  it('a password reset invalidates every session, including the attacker\'s', async () => {
    const attacker = await g.auth.login(subjectOf(s.ownerId), PASSWORD, { clientKey: 'f' });
    const owner = await g.auth.login(subjectOf(s.ownerId), PASSWORD, { clientKey: 'g' });

    const reset = await g.auth.beginPasswordReset(subjectOf(s.ownerId), { ip: '203.0.113.1' });
    await g.auth.completePasswordReset(reset!.token, 'the-password-after-the-reset', {
      ip: '203.0.113.1',
    });

    expect(await g.auth.authenticate(attacker.accessToken)).toBeNull();
    expect(await g.auth.authenticate(owner.accessToken)).toBeNull();
  });

  it('and a legitimate token still works, so none of the above is passing by refusing everything', async () => {
    const issued = await g.auth.login(subjectOf(s.ownerId), PASSWORD, { clientKey: 'h' });
    const authenticated = await g.auth.authenticate(issued.accessToken);
    expect(authenticated?.actor.actorId).toBe(s.ownerId);
  });
});

// =========================================================================
describe('AUTHORIZATION: the client cannot choose its own privileges', () => {
  it('a role claimed in a request body is read by nothing', async () => {
    // The only role that exists is the one on the staff row. Nothing in the
    // send path takes a role, and this asserts the shape rather than hoping.
    const parent = await actorOf(s.parentId);
    expect(parent.staffRole).toBeUndefined();
    expect(parent.permissions?.has('users.manage')).toBe(false);
    expect(parent.permissions?.has('messages.moderate')).toBe(false);
  });

  it('a client-supplied on_behalf_mode never widens authority (JC-005)', async () => {
    for (const requestedMode of ['owner', 'coverage', 'assist', 'escalation']) {
      await expect(
        g.messages.send({
          conversationId: myConversationId,
          senderId: s.otherAdminId,
          body: 'let me in',
          requestedMode,
        }),
      ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });
    }
  });

  it('a per-account DENY restricts somebody the role would allow', async () => {
    await g.prisma.accountPermissionOverride.create({
      data: {
        accountId: s.accounts[s.managerId],
        permission: 'families.assign',
        effect: 'deny',
        reason: 'test: an individual restriction',
      },
    });
    await expect(
      g.families.assignSupervisor(
        await actorOf(s.managerId),
        s.familyId,
        s.otherAdminId,
        'attempt',
      ),
    ).rejects.toMatchObject({ code: CommErrorCode.PERMISSION_DENIED });
  });

  it('user management is refused to everybody but a super_admin', async () => {
    for (const actorId of [s.ownerId, s.managerId, s.parentId, s.teacherId]) {
      await expect(
        g.userAdmin.list(await actorOf(actorId)),
      ).rejects.toBeInstanceOf(AuthError);
    }
  });

  it('an actor cannot add somebody to a conversation who does not belong in it', async () => {
    // The caller is fully in scope and holds conversations.manage. The id they
    // supply is the attack: adding another family's contact would hand them the
    // conversation.
    await expect(
      g.conversations.setMembership(
        myConversationId,
        s.ownerId,
        { actorId: otherParentId, actorKind: 'contact', memberRole: 'parent' },
        'add',
        'attack',
      ),
    ).rejects.toMatchObject({ code: CommErrorCode.INVALID_PARTICIPANTS });

    // ... nor an invented one, nor a real one under a false kind
    await expect(
      g.conversations.setMembership(
        myConversationId,
        s.ownerId,
        { actorId: randomUUID(), actorKind: 'contact', memberRole: 'parent' },
        'add',
        'attack',
      ),
    ).rejects.toMatchObject({ code: CommErrorCode.INVALID_PARTICIPANTS });

    await expect(
      g.conversations.setMembership(
        myConversationId,
        s.ownerId,
        { actorId: s.parentId, actorKind: 'teacher', memberRole: 'teacher' },
        'add',
        'attack',
      ),
    ).rejects.toMatchObject({ code: CommErrorCode.INVALID_PARTICIPANTS });
  });
});

// =========================================================================
describe('SUPERVISOR SCOPE, and what a reassignment does to it', () => {
  it('Supervisor A reaches Family A and not Family B', async () => {
    expect(await g.scope.canAccessFamily(await actorOf(s.ownerId), s.familyId)).toBe(true);
    expect(await g.scope.canAccessFamily(await actorOf(s.ownerId), otherFamilyId)).toBe(false);
    expect(await g.scope.canAccessFamily(await actorOf(s.otherAdminId), s.familyId)).toBe(false);
    expect(await g.scope.canAccessFamily(await actorOf(s.otherAdminId), otherFamilyId)).toBe(true);
  });

  it('after Family A moves to Supervisor B, A is refused and B is allowed -- on the next call', async () => {
    await g.families.assignSupervisor(
      await actorOf(s.managerId),
      s.familyId,
      s.otherAdminId,
      'the family moved',
    );

    expect(await g.scope.canAccessFamily(await actorOf(s.ownerId), s.familyId)).toBe(false);
    expect(await g.scope.canAccessFamily(await actorOf(s.otherAdminId), s.familyId)).toBe(true);

    await expect(
      g.messages.list({ conversationId: myConversationId, actorId: s.ownerId }),
    ).rejects.toMatchObject({ code: CommErrorCode.OUT_OF_SCOPE });
    await expect(
      g.messages.list({ conversationId: myConversationId, actorId: s.otherAdminId }),
    ).resolves.toBeTruthy();
  });

  it('every by-id surface refuses an out-of-scope id', async () => {
    const owner = await actorOf(s.ownerId);
    // Thunks, not promises: building them eagerly would start every attempt
    // before any handler is attached, and a rejection with no handler is an
    // unhandled rejection rather than a test result.
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ['family', () => g.families.get(owner, otherFamilyId)],
      ['conversation', () => g.conversations.requireForActor(otherConversationId, s.ownerId)],
      ['messages', () => g.messages.list({ conversationId: otherConversationId, actorId: s.ownerId })],
      ['calls', () => g.calls.history(otherConversationId, s.ownerId)],
      ['send', () => g.messages.send({ conversationId: otherConversationId, senderId: s.ownerId, body: 'x' })],
      [
        'membership',
        () =>
          g.conversations.setMembership(
            otherConversationId,
            s.ownerId,
            { actorId: s.ownerId, actorKind: 'staff', memberRole: 'admin' },
            'add',
            'attack',
          ),
      ],
      ['approvals', () => g.approvals.history(otherConversationId, s.ownerId)],
      [
        'attachment upload',
        () =>
          g.attachments.authorizeUpload({
            conversationId: otherConversationId,
            actorId: s.ownerId,
            kind: 'image',
            mimeType: 'image/jpeg',
            byteSize: 1024,
          }),
      ],
      ['read cursor', () => g.messages.markReadUpTo(otherConversationId, s.ownerId, '1')],
    ];
    for (const [name, attempt] of attempts) {
      const outcome = await attempt()
        .then(() => 'ALLOWED')
        .catch((e) => (e as Error).name);
      expect({ name, outcome }).toEqual({ name, outcome: 'CommError' });
    }
  });

  it('search returns nothing for an out-of-scope family, and the same nothing for one that does not exist', async () => {
    const owner = await actorOf(s.ownerId);
    expect(await g.families.list(owner, 'family_zeta')).toEqual([]);
    expect(await g.families.list(owner, 'no_such_family')).toEqual([]);
    expect((await g.families.list(owner, 'family_x')).map((f) => f.id)).toEqual([s.familyId]);
  });

  it('the moderation queue never carries another supervisor\'s held message', async () => {
    const group = await g.conversations.ensureStudentGroup(s.learnerId);
    // Phase 6: flagged content, so the message is actually held. A group now
    // holds only what the content scanner matches.
    await g.messages.send({
      conversationId: group.id,
      senderId: s.teacherId,
      body: 'call me on +201012345678',
    });
    expect((await g.approvals.listPending(s.ownerId)).length).toBeGreaterThan(0);
    expect(await g.approvals.listPending(s.otherAdminId)).toEqual([]);
  });
});

// =========================================================================
describe('TENANT ISOLATION, resource by resource', () => {
  const OTHER_ORG = '00000000-0000-0000-0000-0000000000fe';
  let alienAdmin: string;
  let alienSupervisor: string;
  let alienFamily: string;

  beforeEach(async () => {
    alienAdmin = randomUUID();
    alienSupervisor = randomUUID();
    alienFamily = randomUUID();
    const account = randomUUID();
    const supervisorAccount = randomUUID();
    await g.prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name)
       values ('${OTHER_ORG}'::uuid, 'other-academy-2', 'Other Academy 2')
       on conflict (id) do nothing`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.account (id, subject, kind, status, organization_id)
       values ('${account}'::uuid, 'subject_${alienAdmin}', 'staff', 'active', '${OTHER_ORG}'::uuid)`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.account (id, subject, kind, status, organization_id)
       values ('${supervisorAccount}'::uuid, 'subject_${alienSupervisor}', 'staff', 'active', '${OTHER_ORG}'::uuid)`,
    );
    await g.prisma.$executeRawUnsafe(
      `insert into chat.staff (id, account_id, name, role, organization_id) values
         ('${alienAdmin}'::uuid, '${account}'::uuid, 'alien_super', 'super_admin', '${OTHER_ORG}'::uuid),
         ('${alienSupervisor}'::uuid, '${supervisorAccount}'::uuid, 'alien_admin', 'admin', '${OTHER_ORG}'::uuid)`,
    );
    // A super_admin runs the operation and does not hold a caseload, so the
    // family is owned by the other organization's ordinary supervisor.
    await g.prisma.$executeRawUnsafe(
      `insert into chat.family (id, display_name, owner_id, organization_id)
       values ('${alienFamily}'::uuid, 'alien_family', '${alienSupervisor}'::uuid, '${OTHER_ORG}'::uuid)`,
    );
  });

  it('a SUPER_ADMIN of one organization reaches nothing in another', async () => {
    // The widest role in the model, so if the boundary holds here it holds.
    const alien = await actorOf(alienAdmin);
    expect(alien.permissions?.has('users.manage')).toBe(true);

    expect((await g.families.list(alien)).map((f) => f.id)).not.toContain(s.familyId);
    await expect(g.families.get(alien, s.familyId)).rejects.toMatchObject({
      code: CommErrorCode.CONVERSATION_NOT_FOUND,
    });
    await expect(
      g.conversations.requireForActor(myConversationId, alienAdmin),
    ).rejects.toMatchObject({ code: CommErrorCode.CONVERSATION_NOT_FOUND });
    // CROSS_TENANT rather than OUT_OF_SCOPE: the two are not in different
    // scopes of one organization, they are in different organizations, and the
    // more specific answer is the more useful one in a log.
    await expect(
      g.messages.list({ conversationId: myConversationId, actorId: alienAdmin }),
    ).rejects.toMatchObject({ code: CommErrorCode.CROSS_TENANT });
  });

  it('accounts of another organization are neither listed nor addressable', async () => {
    const alien = await actorOf(alienAdmin);
    const listed = await g.userAdmin.list(alien);
    expect(listed.map((a) => a.id)).not.toContain(s.accounts[s.ownerId]);
    await expect(g.userAdmin.get(alien, s.accounts[s.ownerId])).rejects.toMatchObject({
      code: 'AUTH.NOT_FOUND',
    });
    await expect(
      g.userAdmin.revokeSessions(alien, s.accounts[s.ownerId], 'cross-tenant attempt'),
    ).rejects.toMatchObject({ code: 'AUTH.NOT_FOUND' });
  });

  it('a conversation cannot be opened across the boundary', async () => {
    await expect(
      g.conversations.getOrCreateDirect(alienAdmin, s.parentId),
    ).rejects.toMatchObject({ code: CommErrorCode.CROSS_TENANT });
  });

  it('the database refuses a cross-organization row with the service bypassed', async () => {
    await expect(
      g.prisma.$executeRawUnsafe(
        `insert into chat.contact (family_id, name, role_preset, can_message, can_view_progress,
                                   can_manage_schedule, can_manage_billing, can_manage_contacts,
                                   can_cancel, organization_id)
         values ('${alienFamily}'::uuid, 'smuggled', 'authorized_contact', true, true, true,
                 true, true, true, chat.default_organization_id())`,
      ),
    ).rejects.toThrow(/cross-organization reference/);
  });

  it('a family cannot be assigned to a supervisor in another organization', async () => {
    // FOUND BY THIS AUDIT. Every row involved is correctly stamped with its own
    // tenant, so no RLS policy could catch it -- only the RELATIONSHIP crossed
    // the boundary, and nothing was comparing the two organizations.
    await expect(
      g.families.assignSupervisor(
        await actorOf(s.managerId),
        s.familyId,
        alienSupervisor,
        'cross-tenant assignment',
      ),
    ).rejects.toThrow(/cross-organization assignment refused/);

    // and the family is still supervised by whoever supervised it before
    const live = await g.prisma.familyAssignment.findMany({
      where: { familyId: s.familyId, kind: 'primary', endedAt: null },
    });
    expect(live).toHaveLength(1);
    expect(live[0].staffId).toBe(s.ownerId);
  });

  it('nor can cover be started for one', async () => {
    await expect(
      g.families.startCover(
        await actorOf(s.managerId),
        s.familyId,
        alienSupervisor,
        new Date(Date.now() + 86_400_000),
        'cross-tenant cover',
      ),
    ).rejects.toThrow(/cross-organization assignment refused/);
  });
});
