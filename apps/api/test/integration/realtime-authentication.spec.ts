/**
 * RT-001, WebSocket half — closed.
 *
 * The gateway used to read `handshake.auth.actorId` and resolve it verbatim, so
 * anyone who could reach the socket could name any active actor and receive
 * that actor's conversation traffic, call events and presence. This suite is
 * the proof that it no longer can, and the tripwire that stops it coming back.
 *
 * WHAT IS REAL HERE, AND WHAT IS NOT.
 *
 * Real: the database, the accounts, the Argon2id credentials, `AuthService`
 * (the same instance method the HTTP guard calls), genuinely signed and
 * genuinely verified tokens, real sessions and real revocation, the real
 * `AuthorizationService`, and the real conversation/call services.
 *
 * Faked: the socket transport. A `Socket` here is an object with a `handshake`,
 * a `join` that records rooms, and a `disconnect` that records refusal —
 * because what is under test is the gateway's decision, not socket.io's
 * plumbing. Driving a real socket.io server would prove the same decisions plus
 * the wire format; the wire format is covered by the contract, not by this
 * property. That boundary is stated in the phase report as NOT VERIFIED rather
 * than quietly implied.
 */
import { randomUUID } from "node:crypto";
import { PrismaService } from "@platform/prisma.service";
import { PrismaIdentityService } from "@platform/identity.service";
import { PrismaAuditService } from "@platform/audit.service";
import { AuthService } from "@platform/auth/auth.service";
import { AuthorizationService } from "@platform/authorization.service";
import { PrismaRelationshipService } from "@platform/relationship.service";
import { ConversationService } from "@communication/conversations/conversation.service";
import { MessageService } from "@communication/messages/message.service";
import { AttachmentService } from "@communication/attachments/attachment.service";
import { SignedLocalObjectStorage } from "@communication/attachments/object-storage";
import { OutboxService } from "@communication/outbox/outbox.service";
import { AppConfigService } from "@platform/app-config.service";
import { RealtimeGateway } from "@communication/realtime/realtime.gateway";
import { TypingService } from "@communication/realtime/typing.service";
import { PresenceService } from "@communication/realtime/presence.service";
import { room } from "@communication/contracts/events";
import { PinnedCoverage, withAssignmentGate } from "./harness";

process.env.JWT_ACCESS_SECRET ??= "integration-access-secret-32-chars-min!";
process.env.JWT_REFRESH_SECRET ??= "integration-refresh-secret-32-chars-min!";

jest.setTimeout(60_000);

const PASSWORD = "a-realtime-integration-password-1";

/** A socket that records what the gateway did to it. */
class FakeSocket {
  readonly id = `sock-${randomUUID()}`;
  readonly rooms: string[] = [];
  disconnected = false;
  forcedDisconnect = false;
  actor?: unknown;
  accountId?: string;
  sessionId?: string;

  constructor(
    readonly handshake: {
      auth?: Record<string, unknown>;
      headers?: Record<string, unknown>;
    },
  ) {
    this.handshake.headers ??= {};
  }

  async join(name: string): Promise<void> {
    this.rooms.push(name);
  }

  disconnect(force?: boolean): void {
    this.disconnected = true;
    this.forcedDisconnect = force === true;
  }
}

const socketWith = (
  auth: Record<string, unknown>,
  headers: Record<string, unknown> = {},
) => new FakeSocket({ auth, headers });

describe("RT-001 — the socket authenticates, it does not take the client's word", () => {
  const prisma = new PrismaService();
  const identity = new PrismaIdentityService(prisma);
  const auth = new AuthService(prisma, identity, new PrismaAuditService());
  const coverage = new PinnedCoverage();
  const authz = new AuthorizationService(coverage);
  const relationships = new PrismaRelationshipService(prisma);
  const outbox = new OutboxService();
  const audit = new PrismaAuditService();
  const config = new AppConfigService(prisma);
  const conversations = new ConversationService(
    prisma,
    authz,
    outbox,
    identity,
    coverage,
    audit,
    relationships,
  );
  const attachments = new AttachmentService(
    prisma,
    authz,
    conversations,
    new SignedLocalObjectStorage(),
  );
  const messages = new MessageService(
    prisma,
    authz,
    conversations,
    outbox,
    config,
    attachments,
    audit,
  );

  // Redis-backed; neither is exercised by the assertions below, and a missing
  // Redis must not turn an authentication test into an infrastructure test.
  const typing = {
    start: async () => false,
    stop: async () => false,
  } as unknown as TypingService;
  const presence = {
    online: async () => undefined,
    offline: async () => undefined,
  } as unknown as PresenceService;

  const gateway = new RealtimeGateway(
    authz,
    conversations,
    typing,
    presence,
    messages,
    auth,
  );

  /**
   * The primary fixture lives in the DEFAULT organization, not a fresh one.
   *
   * Not cosmetic: `ConversationService.getOrCreateDirect` does not set
   * `organization_id`, so the row takes the column default
   * (`chat.default_organization_id()`). Creating the family in another
   * organization makes `chat.enforce_same_organization()` reject the
   * conversation outright -- which is the trigger doing its job, and a real
   * tenancy defect in conversation creation that is recorded in the phase
   * report rather than fixed here. Working around it would hide it.
   */
  const org = "00000000-0000-0000-0000-000000000001";
  const otherOrg = randomUUID();
  const ids = {
    staff: randomUUID(),
    staffAccount: randomUUID(),
    parent: randomUUID(),
    parentAccount: randomUUID(),
    teacher: randomUUID(),
    teacherAccount: randomUUID(),
    strangerTeacher: randomUUID(),
    strangerTeacherAccount: randomUUID(),
    otherStaff: randomUUID(),
    otherStaffAccount: randomUUID(),
    otherParent: randomUUID(),
    otherParentAccount: randomUUID(),
    family: randomUUID(),
    otherFamily: randomUUID(),
    learner: randomUUID(),
  };
  // Unique per run: the primary fixture shares the DEFAULT organization with
  // every other suite, and chat.account.subject is globally unique. Deriving the
  // suffix from the (now constant) organization id collided on the second run.
  const RUN = randomUUID().slice(0, 8);
  const subject = (name: string) => `rt001-${name}-${RUN}`;

  let parentToken = "";
  let teacherToken = "";
  let strangerToken = "";
  let otherOrgParentToken = "";
  let authorizedConversationId = "";
  let unrelatedConversationId = "";

  beforeAll(async () => {
    await prisma.$connect();

    // Only the SECOND organization is created; the default one already exists
    // and must survive this suite.
    await prisma.$executeRawUnsafe(
      `insert into chat.organization (id, slug, display_name)
       values ('${otherOrg}'::uuid, 'rt001-other-${otherOrg.slice(0, 8)}', 'RT-001 other org')`,
    );

    const accounts: Array<[string, string, string, string]> = [
      [ids.staffAccount, "staff", subject("staff"), org],
      [ids.parentAccount, "family", subject("parent"), org],
      [ids.teacherAccount, "teacher", subject("teacher"), org],
      [ids.strangerTeacherAccount, "teacher", subject("stranger"), org],
      [ids.otherStaffAccount, "staff", `rt001-other-staff-${RUN}`, otherOrg],
      [ids.otherParentAccount, "family", `rt001-other-parent-${RUN}`, otherOrg],
    ];
    for (const [id, kind, sub, organization] of accounts) {
      await prisma.$executeRawUnsafe(
        `insert into chat.account (id, organization_id, subject, kind, status, is_active)
         values ('${id}'::uuid, '${organization}'::uuid, '${sub}', '${kind}', 'active', true)`,
      );
    }

    await prisma.$executeRawUnsafe(
      `insert into chat.staff (id, organization_id, name, role, account_id) values
         ('${ids.staff}'::uuid, '${org}'::uuid, 'admin_a', 'admin', '${ids.staffAccount}'::uuid),
         ('${ids.otherStaff}'::uuid, '${otherOrg}'::uuid, 'admin_b', 'admin', '${ids.otherStaffAccount}'::uuid)`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.teacher (id, organization_id, name, is_active, account_id) values
         ('${ids.teacher}'::uuid, '${org}'::uuid, 'teacher_t', true, '${ids.teacherAccount}'::uuid),
         ('${ids.strangerTeacher}'::uuid, '${org}'::uuid, 'teacher_s', true, '${ids.strangerTeacherAccount}'::uuid)`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.family (id, organization_id, display_name, owner_id, language) values
         ('${ids.family}'::uuid, '${org}'::uuid, 'family_f', '${ids.staff}'::uuid, 'ar'),
         ('${ids.otherFamily}'::uuid, '${otherOrg}'::uuid, 'family_g', '${ids.otherStaff}'::uuid, 'ar')`,
    );
    await prisma.$executeRawUnsafe(
      `insert into chat.contact (id, organization_id, family_id, name, role_preset, can_message, account_id) values
         ('${ids.parent}'::uuid, '${org}'::uuid, '${ids.family}'::uuid, 'parent_p', 'primary_guardian', true, '${ids.parentAccount}'::uuid),
         ('${ids.otherParent}'::uuid, '${otherOrg}'::uuid, '${ids.otherFamily}'::uuid, 'parent_q', 'primary_guardian', true, '${ids.otherParentAccount}'::uuid)`,
    );
    // The learner link is what authorizes parent <-> teacher (PD-6). teacher_id
    // is the academy's fact, writable only through the ingestion gate, so this
    // fixture opens it exactly as ingestion would.
    await withAssignmentGate(
      prisma,
      `insert into chat.learner (id, organization_id, family_id, name, teacher_id)
       values ('${ids.learner}'::uuid, '${org}'::uuid, '${ids.family}'::uuid, 'learner_l', '${ids.teacher}'::uuid)`,
    );

    for (const accountId of accounts.map(([id]) => id)) {
      await auth.setPassword(accountId, PASSWORD);
    }

    parentToken = (await auth.login(subject("parent"), PASSWORD)).accessToken;
    teacherToken = (await auth.login(subject("teacher"), PASSWORD)).accessToken;
    strangerToken = (await auth.login(subject("stranger"), PASSWORD))
      .accessToken;
    otherOrgParentToken = (
      await auth.login(`rt001-other-parent-${RUN}`, PASSWORD)
    ).accessToken;

    // PD-6 authorizes this pair, so the conversation is real and legitimate.
    authorizedConversationId = (
      await conversations.getOrCreateDirect(ids.parent, ids.teacher)
    ).id;
    // A channel the parent is not in: the stranger teacher and the admin.
    unrelatedConversationId = (
      await conversations.getOrCreateDirect(ids.strangerTeacher, ids.staff)
    ).id;
  });

  afterAll(async () => {
    /**
     * Cleanup deliberately does NOT delete chat.family.
     *
     * Creating a conversation writes a `conversation_created` row to
     * chat.event_log, and `event_log.family_id` cascades on family delete —
     * straight into the append-only trigger, which refuses it:
     * `chat.event_log is append-only; DELETE is not permitted`. That trigger is
     * a control (JC-010), not an obstacle, and a test teardown has no business
     * trying to erase history to tidy up after itself.
     *
     * So the family, its owning staff row and that staff account are left
     * behind. They are synthetic, uniquely identified, and every suite that
     * cares TRUNCATEs these tables in its own setup — TRUNCATE does not fire
     * row triggers, which is exactly why the harness uses it.
     *
     * What IS removed is everything that could collide on a later run:
     * sessions, credentials and the accounts whose `subject` is globally
     * unique.
     */
    const quoted = (ids: string[]) =>
      ids.map((id) => `'${id}'::uuid`).join(",");
    const run = async (sql: string) => {
      try {
        await prisma.$executeRawUnsafe(sql);
      } catch {
        // A fixture that another suite already truncated is not a failure.
      }
    };

    const convs = [authorizedConversationId, unrelatedConversationId].filter(
      Boolean,
    );
    if (convs.length > 0) {
      await run(
        `delete from chat.conversation_member where conversation_id in (${quoted(convs)})`,
      );
      await run(`delete from chat.conversation where id in (${quoted(convs)})`);
    }

    // Children before accounts: staff/contact/teacher reference chat.account
    // ON DELETE RESTRICT.
    await run(
      `delete from chat.learner where id in (${quoted([ids.learner])})`,
    );
    await run(
      `delete from chat.contact where id in (${quoted([ids.parent, ids.otherParent])})`,
    );
    await run(
      `delete from chat.teacher where id in (${quoted([ids.teacher, ids.strangerTeacher])})`,
    );

    const releasable = [
      ids.parentAccount,
      ids.otherParentAccount,
      ids.teacherAccount,
      ids.strangerTeacherAccount,
    ];
    await run(
      `delete from chat.session where account_id in (${quoted(releasable)})`,
    );
    await run(
      `delete from chat.device where account_id in (${quoted(releasable)})`,
    );
    await run(
      `delete from chat.account_credential where account_id in (${quoted(releasable)})`,
    );
    await run(`delete from chat.account where id in (${quoted(releasable)})`);

    // The two staff accounts stay: their staff rows own the retained families.
    await run(
      `delete from chat.session where account_id in (${quoted([ids.staffAccount, ids.otherStaffAccount])})`,
    );

    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------- authentication
  describe("authentication", () => {
    it("1. a valid Parent token makes the socket the Parent", async () => {
      const socket = socketWith({ token: parentToken });
      await gateway.handleConnection(socket as never);

      expect(socket.disconnected).toBe(false);
      expect(socket.actor).toMatchObject({
        actorId: ids.parent,
        kind: "contact",
      });
      expect(socket.rooms).toEqual([room.actor(ids.parent)]);
      expect(socket.sessionId).toEqual(expect.any(String));
    });

    it("2. a valid Teacher token makes the socket the Teacher", async () => {
      const socket = socketWith({ token: teacherToken });
      await gateway.handleConnection(socket as never);

      expect(socket.actor).toMatchObject({
        actorId: ids.teacher,
        kind: "teacher",
      });
      expect(socket.rooms).toEqual([room.actor(ids.teacher)]);
    });

    it("3. a missing token is refused", async () => {
      for (const handshake of [
        {},
        { token: "" },
        { token: "   " },
        { token: 42 },
      ]) {
        const socket = socketWith(handshake as Record<string, unknown>);
        await gateway.handleConnection(socket as never);
        expect({ handshake, disconnected: socket.disconnected }).toEqual({
          handshake,
          disconnected: true,
        });
        expect(socket.actor).toBeUndefined();
        expect(socket.rooms).toEqual([]);
      }
    });

    it("4. an invalid token is refused", async () => {
      const forged = [
        "not-a-jwt",
        `${parentToken}tampered`,
        parentToken.split(".").slice(0, 2).join("."), // no signature
        // alg=none, the classic
        Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
          "base64url",
        ) +
          "." +
          parentToken.split(".")[1] +
          ".",
      ];
      for (const token of forged) {
        const socket = socketWith({ token });
        await gateway.handleConnection(socket as never);
        expect(socket.disconnected).toBe(true);
        expect(socket.actor).toBeUndefined();
      }
    });

    it("5. a revoked session is refused, even though the token itself still verifies", async () => {
      const pair = await auth.login(subject("parent"), PASSWORD);

      const before = socketWith({ token: pair.accessToken });
      await gateway.handleConnection(before as never);
      expect(before.actor).toMatchObject({ actorId: ids.parent });
      const sessionId = before.sessionId!;

      await auth.logout(sessionId);

      const after = socketWith({ token: pair.accessToken });
      await gateway.handleConnection(after as never);
      expect(after.disconnected).toBe(true);
      expect(after.actor).toBeUndefined();
    });

    it("the Authorization header is accepted as the documented fallback", async () => {
      const socket = socketWith({}, { authorization: `Bearer ${parentToken}` });
      await gateway.handleConnection(socket as never);
      expect(socket.actor).toMatchObject({ actorId: ids.parent });
    });

    it("a malformed Authorization header is refused, not partially parsed", async () => {
      for (const authorization of [
        parentToken,
        `bearer ${parentToken}`,
        `Bearer  ${parentToken}`,
        [`Bearer ${parentToken}`, `Bearer ${teacherToken}`],
      ]) {
        const socket = socketWith({}, { authorization } as Record<
          string,
          unknown
        >);
        await gateway.handleConnection(socket as never);
        expect(socket.disconnected).toBe(true);
      }
    });
  });

  // ------------------------------------------------------------ anti-impersonation
  describe("anti-impersonation — the handshake cannot name an actor", () => {
    it("6. Parent token + forged Teacher actorId → the socket is still the Parent", async () => {
      const socket = socketWith({ token: parentToken, actorId: ids.teacher });
      await gateway.handleConnection(socket as never);

      expect(socket.actor).toMatchObject({
        actorId: ids.parent,
        kind: "contact",
      });
      expect(socket.rooms).toEqual([room.actor(ids.parent)]);
      expect(socket.rooms).not.toContain(room.actor(ids.teacher));
    });

    it("7. Teacher token + forged Parent actorId → the socket is still the Teacher", async () => {
      const socket = socketWith({ token: teacherToken, actorId: ids.parent });
      await gateway.handleConnection(socket as never);

      expect(socket.actor).toMatchObject({
        actorId: ids.teacher,
        kind: "teacher",
      });
      expect(socket.rooms).toEqual([room.actor(ids.teacher)]);
      expect(socket.rooms).not.toContain(room.actor(ids.parent));
    });

    it("8. a forged actorId with no token is refused outright", async () => {
      // This is the exact pre-PR-B handshake. It used to authenticate.
      const socket = socketWith({ actorId: ids.teacher });
      await gateway.handleConnection(socket as never);

      expect(socket.disconnected).toBe(true);
      expect(socket.forcedDisconnect).toBe(true);
      expect(socket.actor).toBeUndefined();
      expect(socket.rooms).toEqual([]);
    });

    it("no other handshake field can influence identity either", async () => {
      const socket = socketWith({
        token: parentToken,
        actorId: ids.teacher,
        accountId: ids.teacherAccount,
        sessionId: randomUUID(),
        kind: "staff",
        role: "manager",
        familyId: ids.otherFamily,
        teacherId: ids.teacher,
        organizationId: otherOrg,
      });
      await gateway.handleConnection(socket as never);

      expect(socket.actor).toMatchObject({
        actorId: ids.parent,
        kind: "contact",
        familyId: ids.family,
        organizationId: org,
      });
      expect(socket.accountId).toBe(ids.parentAccount);
    });
  });

  // ------------------------------------------------------------- room authorization
  describe("conversation subscription", () => {
    const connected = async (token: string) => {
      const socket = socketWith({ token });
      await gateway.handleConnection(socket as never);
      return socket;
    };

    it("9. an authorized member may subscribe to its conversation", async () => {
      for (const token of [parentToken, teacherToken]) {
        const socket = await connected(token);
        const result = await gateway.subscribe(socket as never, {
          conversationId: authorizedConversationId,
        });
        expect(result).toEqual({ ok: true });
        expect(socket.rooms).toContain(
          room.conversation(authorizedConversationId),
        );
      }
    });

    it("10. an unrelated actor may not subscribe", async () => {
      const socket = await connected(parentToken);
      const result = await gateway.subscribe(socket as never, {
        conversationId: unrelatedConversationId,
      });

      expect(result.ok).toBe(false);
      expect(socket.rooms).not.toContain(
        room.conversation(unrelatedConversationId),
      );
    });

    it("11. a revoked PD-6 relationship does not stop the existing membership, and grants no NEW channel", async () => {
      // Revoking the learner link closes the channel for new messages and calls
      // (PD-6, proven in relationship-predicate.spec.ts). It does not delete the
      // conversation, and the member may still subscribe to read its history --
      // which is the documented behaviour, not an oversight.
      await withAssignmentGate(
        prisma,
        `update chat.learner set teacher_id = '${ids.strangerTeacher}'::uuid
          where id = '${ids.learner}'::uuid`,
      );
      try {
        const socket = await connected(teacherToken);
        const existing = await gateway.subscribe(socket as never, {
          conversationId: authorizedConversationId,
        });
        expect(existing).toEqual({ ok: true });

        // And get-or-create is refused for the revoked pair. Note this is
        // STRICTER than "no new channel": canOpenDirect runs before the
        // existing-conversation lookup, so the pair cannot re-open the channel
        // they already have through this endpoint either. Reading its history
        // still works through GET /conversations/:id and the list, which
        // canRead governs -- so PD-6's "history is preserved" holds.
        await expect(
          conversations.getOrCreateDirect(ids.parent, ids.teacher),
        ).rejects.toMatchObject({ code: "COMM.TEACHER_PARENT_NOT_AUTHORIZED" });

        // And the stranger, who now teaches the learner but shares no
        // conversation, still cannot subscribe to this one.
        const stranger = await connected(strangerToken);
        const denied = await gateway.subscribe(stranger as never, {
          conversationId: authorizedConversationId,
        });
        expect(denied.ok).toBe(false);
      } finally {
        await withAssignmentGate(
          prisma,
          `update chat.learner set teacher_id = '${ids.teacher}'::uuid
            where id = '${ids.learner}'::uuid`,
        );
      }
    });

    it("12. tenant isolation holds: another organization's parent cannot subscribe", async () => {
      const socket = await connected(otherOrgParentToken);
      const result = await gateway.subscribe(socket as never, {
        conversationId: authorizedConversationId,
      });

      expect(result.ok).toBe(false);
      expect(socket.rooms).not.toContain(
        room.conversation(authorizedConversationId),
      );
    });

    it("a subscribe with no conversationId is refused rather than joining something", async () => {
      const socket = await connected(parentToken);
      const result = await gateway.subscribe(socket as never, {});
      expect(result.ok).toBe(false);
      expect(socket.rooms).toEqual([room.actor(ids.parent)]);
    });

    it("an unauthenticated socket cannot subscribe at all", async () => {
      const socket = socketWith({ actorId: ids.parent });
      await gateway.handleConnection(socket as never);
      const result = await gateway.subscribe(socket as never, {
        conversationId: authorizedConversationId,
      });
      expect(result).toEqual({ ok: false, code: "COMM.UNKNOWN_ACTOR" });
    });
  });

  // ------------------------------------------------------------ call event routing
  describe("call event routing", () => {
    /**
     * Call events are published to `conversation:<id>` and `actor:<id>` rooms.
     * A socket receives an event if and only if it is IN that room, and the
     * only two ways into a room are handleConnection (own actor room, from the
     * verified actor) and subscribe (conversation room, behind
     * AuthorizationService). So routing security reduces to room membership,
     * which is what these assert — the delivery mechanics belong to socket.io.
     */
    const connected = async (token: string) => {
      const socket = socketWith({ token });
      await gateway.handleConnection(socket as never);
      return socket;
    };

    it("13/14. both call participants reach the conversation room the call events go to", async () => {
      const caller = await connected(parentToken);
      const callee = await connected(teacherToken);

      for (const socket of [caller, callee]) {
        const result = await gateway.subscribe(socket as never, {
          conversationId: authorizedConversationId,
        });
        expect(result).toEqual({ ok: true });
        expect(socket.rooms).toContain(
          room.conversation(authorizedConversationId),
        );
      }
      // And each holds its own actor room, which is where a targeted call
      // notification would be addressed.
      expect(caller.rooms).toContain(room.actor(ids.parent));
      expect(callee.rooms).toContain(room.actor(ids.teacher));
    });

    it("15. an unrelated actor reaches neither room, so it receives no call event", async () => {
      const stranger = await connected(strangerToken);
      const result = await gateway.subscribe(stranger as never, {
        conversationId: authorizedConversationId,
      });

      expect(result.ok).toBe(false);
      expect(stranger.rooms).toEqual([room.actor(ids.strangerTeacher)]);
      expect(stranger.rooms).not.toContain(
        room.conversation(authorizedConversationId),
      );
      expect(stranger.rooms).not.toContain(room.actor(ids.parent));
      expect(stranger.rooms).not.toContain(room.actor(ids.teacher));
    });

    it("16. a forged actorId cannot place a socket in another actor's call room", async () => {
      const impostor = socketWith({
        token: strangerToken,
        actorId: ids.parent,
      });
      await gateway.handleConnection(impostor as never);

      // The actor room is named from the verified actor, so the forgery buys
      // nothing: it is the stranger's own room or none.
      expect(impostor.rooms).toEqual([room.actor(ids.strangerTeacher)]);

      const result = await gateway.subscribe(impostor as never, {
        conversationId: authorizedConversationId,
      });
      expect(result.ok).toBe(false);
    });
  });

  // ----------------------------------------------------------------- the tripwire
  it("no source file reads the retired handshake actorId seam", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } =
      require("node:child_process") as typeof import("node:child_process");
    const hits = execSync(
      "grep -rn 'handshake.auth?.actorId\\|handshake\\.auth\\.actorId' src || true",
      { cwd: `${__dirname}/../..`, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      // Prose explaining that it is NOT read is allowed; code reading it is not.
      .filter((line) => !/^\S+:\d+:\s*(\*|\/\/)/.test(line));

    expect(hits).toEqual([]);
  });
});
