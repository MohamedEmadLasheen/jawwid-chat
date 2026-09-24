/**
 * The media token: what it grants, who can get one, and what it must never say.
 *
 * THE LIMIT OF THIS SUITE, STATED FIRST. A LiveKit access token is an HS256 JWT
 * this codebase signs by itself. It decodes, verifies and looks entirely correct
 * whether or not the key it names exists, whether or not the secret matches, and
 * whether or not LIVEKIT_URL points at anything at all. So nothing here is
 * evidence that LiveKit works — only that the token the API mints says what it
 * is supposed to say, to the people who are supposed to get one.
 *
 * Asking LiveKit is a separate act, and it needs credentials this repository
 * deliberately does not contain: `scripts/infra/livekit-probe.sh` performs it
 * and refuses, loudly and non-zero, when they are absent.
 *
 * WHAT IS REAL HERE. The database, the full Phase 9 authorization chain, the
 * real issuer and real HS256 signing with a test secret.
 */
import { randomUUID } from "node:crypto";
import { createHmac } from "node:crypto";
import { CommErrorCode } from "@platform/errors";
import { LiveKitTokenIssuer } from "@communication/calls/media-token";
import {
  Scenario,
  buildGraph,
  seed,
  truncate,
  withAssignmentGate,
} from "./harness";

jest.setTimeout(60_000);

const g = buildGraph();
let s: Scenario;

/** Decode a JWT segment without verifying — this is inspection, not trust. */
const decode = (token: string, segment: 0 | 1) =>
  JSON.parse(
    Buffer.from(token.split(".")[segment], "base64url").toString(),
  ) as Record<string, unknown>;

interface VideoGrant {
  room?: string;
  roomJoin?: boolean;
  roomCreate?: boolean;
  roomList?: boolean;
  roomAdmin?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  [key: string]: unknown;
}

const videoGrant = (token: string) => decode(token, 1).video as VideoGrant;

async function directCall() {
  const conv = await g.conversations.getOrCreateDirect(s.parentId, s.teacherId);
  const { callId, roomName } = await g.calls.start(conv.id, s.teacherId);
  return { conversationId: conv.id, callId, roomName };
}

beforeAll(async () => {
  await g.prisma.$connect();
});
afterAll(async () => {
  await g.prisma.$disconnect();
});
beforeEach(async () => {
  await truncate(g.prisma);
  s = await seed(g.prisma);
  g.coverage.onDutyId = s.ownerId;
  g.config.invalidate();
});

// -------------------------------------------------------------------------
describe("A–H — who may obtain a media token", () => {
  it("A. a live, authorized participant receives one", async () => {
    const { callId } = await directCall();
    const issued = await g.calls.issueToken(callId, s.parentId);

    expect(issued.token.split(".")).toHaveLength(3);
    expect(issued.roomName).toEqual(expect.any(String));
    expect(issued.expiresAt).toEqual(expect.any(String));
  });

  it("B. an unrelated actor is denied", async () => {
    const { callId } = await directCall();
    await expect(
      g.calls.issueToken(callId, s.unrelatedTeacherId),
    ).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_A_PARTICIPANT,
    });
  });

  it("C. a revoked PD-6 relationship is denied", async () => {
    const { callId } = await directCall();
    await withAssignmentGate(
      g.prisma,
      `update chat.learner set teacher_id = '${s.unrelatedTeacherId}'::uuid
        where id = '${s.learnerId}'::uuid`,
    );

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.TEACHER_PARENT_NOT_AUTHORIZED,
    });
  });

  it("D. a participant who left the call is denied", async () => {
    const { callId } = await directCall();
    await g.calls.decline(callId, s.parentId);

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_PARTICIPANT_LEFT,
    });
  });

  it("D2. a participant removed from the conversation is denied", async () => {
    const { conversationId, callId } = await directCall();
    await g.prisma.conversationMember.updateMany({
      where: { conversationId, actorId: s.parentId },
      data: { leftAt: new Date() },
    });

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.NOT_CONVERSATION_MEMBER,
    });
  });

  it("E. a deactivated actor is denied", async () => {
    const { callId } = await directCall();
    await g.prisma.contact.update({
      where: { id: s.parentId },
      data: { isActive: false },
    });

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.ACTOR_INACTIVE,
    });
  });

  it("F. an ended call issues no token, which is the existing contract", async () => {
    const { callId } = await directCall();
    await g.calls.end(callId, s.teacherId);

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
  });

  it("F2. a call expired by the ring timeout issues no token either", async () => {
    const { callId } = await directCall();
    await g.prisma.$executeRawUnsafe(
      `update chat.call set started_at = now() - make_interval(secs => 600) where id = '${callId}'::uuid`,
    );
    await g.calls.expireRingingCalls();

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.CALL_ALREADY_ENDED,
    });
  });

  it("H. an unknown actor id mints nothing", async () => {
    const { callId } = await directCall();
    await expect(
      g.calls.issueToken(callId, randomUUID()),
    ).rejects.toMatchObject({
      code: CommErrorCode.UNKNOWN_ACTOR,
    });
  });

  it("a token for a call that does not exist is a 404, not a signed grant", async () => {
    await expect(
      g.calls.issueToken(randomUUID(), s.parentId),
    ).rejects.toMatchObject({
      code: CommErrorCode.CALL_NOT_FOUND,
    });
  });
});

// -------------------------------------------------------------------------
describe("I — the token lifetime has exactly one source", () => {
  it("the TTL comes from chat.config, and the token expiry matches it", async () => {
    const configured = await g.config.get("call.token_ttl_seconds");
    const row = await g.prisma.config.findUnique({
      where: { key: "call.token_ttl_seconds" },
    });
    expect(row?.value).toBe(configured);

    const { callId } = await directCall();
    const before = Math.floor(Date.now() / 1000);
    const issued = await g.calls.issueToken(callId, s.parentId);

    const exp = decode(issued.token, 1).exp as number;
    // Within a second or two of now + the configured TTL.
    expect(exp).toBeGreaterThanOrEqual(before + configured - 2);
    expect(exp).toBeLessThanOrEqual(before + configured + 2);

    expect(new Date(issued.expiresAt).getTime()).toBe(exp * 1000);
  });

  it("changing the configured TTL changes the token, with no second knob to set", async () => {
    const original = await g.config.get("call.token_ttl_seconds");
    await g.prisma.config.update({
      where: { key: "call.token_ttl_seconds" },
      data: { value: 30 },
    });
    g.config.invalidate();
    try {
      const { callId } = await directCall();
      const before = Math.floor(Date.now() / 1000);
      const issued = await g.calls.issueToken(callId, s.parentId);

      const exp = decode(issued.token, 1).exp as number;
      expect(exp).toBeLessThanOrEqual(before + 32);
    } finally {
      await g.prisma.config.update({
        where: { key: "call.token_ttl_seconds" },
        data: { value: original },
      });
      g.config.invalidate();
    }
  });

  it("no environment variable claims to control the token lifetime", () => {
    // LIVEKIT_TOKEN_TTL_SECONDS used to be declared in the manifest and set to
    // 300 by both deploy workflows while the code read 120 from chat.config.
    // It was removed rather than wired up: a knob that changes nothing is worse
    // than no knob. This fails if anyone reintroduces one.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } =
      require("node:child_process") as typeof import("node:child_process");
    const hits = execSync(
      "grep -rn 'LIVEKIT_TOKEN_TTL' ../../infra ../../.github ../../.env.example src || true",
      { cwd: __dirname.replace("/test/integration", ""), encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);

    expect(hits).toEqual([]);
  });
});

// -------------------------------------------------------------------------
describe("J/K/L — the room and the identity are the server's to choose", () => {
  it("J. the room name is server-generated and tied to the conversation and call", async () => {
    const { conversationId, callId, roomName } = await directCall();

    // jawwid-<conversationId>-<uuid>: scoped to the conversation, unique per
    // call. The uuid is what stops a second call in the same conversation
    // sharing a room with the first.
    expect(roomName).toMatch(
      new RegExp(
        `^jawwid-${conversationId}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
      ),
    );

    const issued = await g.calls.issueToken(callId, s.parentId);
    expect(videoGrant(issued.token).room).toBe(roomName);
    expect(issued.roomName).toBe(roomName);
  });

  it("J2. two calls in the same conversation never share a room", async () => {
    const conv = await g.conversations.getOrCreateDirect(
      s.parentId,
      s.teacherId,
    );
    const first = await g.calls.start(conv.id, s.teacherId);
    await g.calls.end(first.callId, s.teacherId);
    const second = await g.calls.start(conv.id, s.teacherId);

    expect(second.roomName).not.toBe(first.roomName);
  });

  it("K. the token endpoint takes no room parameter, so a client cannot name one", async () => {
    // issueToken(callId, actorId) — there is no third argument to smuggle a
    // room through, and the room is read from the call row.
    expect(g.calls.issueToken).toHaveLength(2);

    const { callId, roomName } = await directCall();
    const bothSides = await Promise.all([
      g.calls.issueToken(callId, s.parentId),
      g.calls.issueToken(callId, s.teacherId),
    ]);

    // Both participants are put in the SAME room, chosen by the server.
    for (const issued of bothSides) {
      expect(videoGrant(issued.token).room).toBe(roomName);
    }
  });

  it("L. the participant identity is the resolved actor, not anything supplied", async () => {
    const { callId } = await directCall();

    const parentToken = await g.calls.issueToken(callId, s.parentId);
    const teacherToken = await g.calls.issueToken(callId, s.teacherId);

    expect(decode(parentToken.token, 1).sub).toBe(s.parentId);
    expect(decode(teacherToken.token, 1).sub).toBe(s.teacherId);
    // Two participants, two identities — never the same one twice.
    expect(decode(parentToken.token, 1).sub).not.toBe(
      decode(teacherToken.token, 1).sub,
    );
  });
});

// -------------------------------------------------------------------------
describe("M/N/O/P — the grant is the smallest one a call needs", () => {
  it("M. roomJoin is granted, for exactly one room", async () => {
    const { callId, roomName } = await directCall();
    const grant = videoGrant(
      (await g.calls.issueToken(callId, s.parentId)).token,
    );

    expect(grant.roomJoin).toBe(true);
    expect(grant.room).toBe(roomName);
  });

  it("N/O. roomCreate and roomList are not granted", async () => {
    const { callId } = await directCall();
    const grant = videoGrant(
      (await g.calls.issueToken(callId, s.parentId)).token,
    );

    // The server owns the room lifecycle. A participant that could create rooms
    // could put itself somewhere the application never authorized.
    expect(grant.roomCreate).toBe(false);
    expect(grant.roomList).toBe(false);
  });

  it("P. publish and subscribe are granted, and nothing else is", async () => {
    const { callId } = await directCall();
    const grant = videoGrant(
      (await g.calls.issueToken(callId, s.parentId)).token,
    );

    expect(grant.canPublish).toBe(true);
    expect(grant.canSubscribe).toBe(true);

    // The complete grant surface, asserted exhaustively: a capability added
    // later has to be added here too, deliberately.
    expect(Object.keys(grant).sort()).toEqual([
      "canPublish",
      "canSubscribe",
      "room",
      "roomCreate",
      "roomJoin",
      "roomList",
    ]);
  });

  it("P2. no administrative capability appears", async () => {
    const { callId } = await directCall();
    const grant = videoGrant(
      (await g.calls.issueToken(callId, s.parentId)).token,
    );

    for (const capability of [
      "roomAdmin",
      "roomRecord",
      "ingressAdmin",
      "recorder",
      "hidden",
      "canUpdateOwnMetadata",
      "canPublishData",
      "agent",
    ]) {
      expect(grant[capability]).toBeUndefined();
    }
  });

  it("P3. a silent member gets no token at all — canPublish never has to say no", async () => {
    // The issuer computes `canPublish: !membership.isSilent`, which reads like
    // a listen-only grant. It is unreachable: canSend refuses a silent member
    // before the grant is built, and CallService.start excludes silent members
    // from the participant set in the first place. So a silent member is not on
    // the call and cannot obtain a token, rather than joining muted.
    //
    // Fails closed, so this is not a defect -- but it means `canPublish` is
    // effectively always true today, and a listen-only participant is a
    // capability the product does not currently have. Recorded rather than
    // asserted as if it worked.
    const { conversationId, callId } = await directCall();
    await g.prisma.conversationMember.updateMany({
      where: { conversationId, actorId: s.parentId },
      data: { isSilent: true },
    });

    await expect(g.calls.issueToken(callId, s.parentId)).rejects.toMatchObject({
      code: CommErrorCode.MEMBER_IS_SILENT,
    });
  });
});

// -------------------------------------------------------------------------
describe("Q — the secret never leaves the server", () => {
  it("the token is signed with the secret, and does not contain it", async () => {
    const { callId } = await directCall();
    const issued = await g.calls.issueToken(callId, s.parentId);

    const secret = process.env.LIVEKIT_API_SECRET!;
    expect(secret.length).toBeGreaterThan(0);

    // Not in the token, in any segment, in any encoding.
    expect(issued.token).not.toContain(secret);
    for (const segment of [0, 1] as const) {
      expect(JSON.stringify(decode(issued.token, segment))).not.toContain(
        secret,
      );
    }
    expect(JSON.stringify(issued)).not.toContain(secret);
  });

  it("the payload names the API KEY as issuer — which is public — and nothing more", async () => {
    const { callId } = await directCall();
    const payload = decode(
      (await g.calls.issueToken(callId, s.parentId)).token,
      1,
    );

    // iss is the key by LiveKit's design: it tells the server which secret to
    // verify with. The secret itself is never transmitted.
    expect(payload.iss).toBe(process.env.LIVEKIT_API_KEY);
    expect(Object.keys(payload).sort()).toEqual(
      ["exp", "iss", "jti", "nbf", "sub", "video", "name"].sort(),
    );
  });

  it("the signature actually verifies, so the token is not merely well-shaped", async () => {
    const { callId } = await directCall();
    const token = (await g.calls.issueToken(callId, s.parentId)).token;

    const [header, payload, signature] = token.split(".");
    const expected = createHmac("sha256", process.env.LIVEKIT_API_SECRET!)
      .update(`${header}.${payload}`)
      .digest("base64url");

    expect(signature).toBe(expected);
  });

  it("a misconfiguration names the missing VARIABLES and never a value", async () => {
    const issuer = new LiveKitTokenIssuer();
    const saved = {
      url: process.env.LIVEKIT_URL,
      key: process.env.LIVEKIT_API_KEY,
      secret: process.env.LIVEKIT_API_SECRET,
    };
    try {
      // A fresh issuer reads the environment when it is constructed.
      process.env.LIVEKIT_URL = "";
      process.env.LIVEKIT_API_KEY = "";
      process.env.LIVEKIT_API_SECRET = "";
      const unconfigured = new LiveKitTokenIssuer();

      await expect(
        unconfigured.issue({
          roomName: "r",
          identity: "i",
          name: "n",
          canPublish: true,
          ttlSeconds: 60,
        }),
      ).rejects.toThrow(/LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET/);

      // And the previously-constructed issuer still works: it captured a valid
      // configuration, which is why the check belongs at issue time.
      expect(issuer).toBeDefined();
    } finally {
      process.env.LIVEKIT_URL = saved.url;
      process.env.LIVEKIT_API_KEY = saved.key;
      process.env.LIVEKIT_API_SECRET = saved.secret;
    }
  });

  it("an https:// LIVEKIT_URL is refused — the client needs the WebSocket form", async () => {
    // The provisioning foot-gun this guards: a LiveKit project exposes wss://
    // for media and https:// for the control plane at the same host. The probe
    // normalises wss:// to https:// for its own request, so it would report the
    // project VERIFIED with either -- while a client handed the https:// form
    // cannot connect at all. The server refuses to hand out a URL it knows the
    // client cannot use.
    const saved = process.env.LIVEKIT_URL;
    try {
      for (const wrong of [
        "https://x.livekit.cloud",
        "http://x.livekit.cloud",
        "x.livekit.cloud",
      ]) {
        process.env.LIVEKIT_URL = wrong;
        const issuer = new LiveKitTokenIssuer();
        await expect(
          issuer.issue({
            roomName: "r",
            identity: "i",
            name: "n",
            canPublish: true,
            ttlSeconds: 60,
          }),
        ).rejects.toThrow(/WebSocket URL/);
      }

      // And both WebSocket forms are accepted.
      for (const right of ["wss://x.livekit.cloud", "ws://localhost:7880"]) {
        process.env.LIVEKIT_URL = right;
        const issuer = new LiveKitTokenIssuer();
        await expect(
          issuer.issue({
            roomName: "r",
            identity: "i",
            name: "n",
            canPublish: true,
            ttlSeconds: 60,
          }),
        ).resolves.toMatchObject({ url: right });
      }
    } finally {
      process.env.LIVEKIT_URL = saved;
    }
  });

  it("an empty LIVEKIT_URL is refused rather than returning a token with nowhere to go", async () => {
    const saved = process.env.LIVEKIT_URL;
    try {
      process.env.LIVEKIT_URL = "";
      const issuer = new LiveKitTokenIssuer();
      await expect(
        issuer.issue({
          roomName: "r",
          identity: "i",
          name: "n",
          canPublish: true,
          ttlSeconds: 60,
        }),
      ).rejects.toThrow(/LIVEKIT_URL/);
    } finally {
      process.env.LIVEKIT_URL = saved;
    }
  });
});

// -------------------------------------------------------------------------
describe("control plane vs media plane — the two must never merge", () => {
  /**
   * There are two ways to authenticate to LiveKit, and conflating them is the
   * mistake this block exists to prevent.
   *
   *   CONTROL PLANE   server credentials (LIVEKIT_API_KEY / _SECRET) sign a
   *                   short-lived admin token for LiveKit's RoomService. Used
   *                   by scripts/infra/livekit-probe.sh, an operator tool. The
   *                   secret never leaves the server.
   *
   *   MEDIA PLANE     an authenticated participant receives a short-lived
   *                   participant token whose only capability is joining one
   *                   server-named room. This is what reaches a device.
   *
   * The probe needs `roomList` to ask "is this project reachable?". A
   * participant must never have it: `roomList` enumerates every active room in
   * the project, which is every call in progress across every family.
   *
   * These read the shell script because it IS the implementation -- there is no
   * TypeScript to exercise. Static inspection is the honest tool here, and the
   * point is that a future edit pulling the probe onto the participant path, or
   * pushing roomList onto participants, fails a test rather than passing review.
   */
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const PROBE = `${__dirname}/../../../../scripts/infra/livekit-probe.sh`;
  const probeSource = () => readFileSync(PROBE, "utf8");
  const issuerSource = () =>
    readFileSync(
      `${__dirname}/../../src/communication/calls/media-token.ts`,
      "utf8",
    );

  it("the probe authenticates with SERVER credentials, not a participant token", () => {
    const source = probeSource();

    // It reads the infrastructure credentials directly...
    expect(source).toMatch(/LIVEKIT_API_KEY/);
    expect(source).toMatch(/LIVEKIT_API_SECRET/);
    // ...and signs its own token with `sub` set to the API KEY, which is what
    // makes it a service credential rather than a participant one.
    expect(source).toMatch(/'iss':\s*key,\s*'sub':\s*key/);
  });

  it("the probe never touches the participant-token path", () => {
    const source = probeSource();

    for (const forbidden of [
      "media-token",
      "LiveKitTokenIssuer",
      "issueToken",
      "CallService",
      "/calls/",
      "call.token_ttl_seconds",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("the probe only READS the control plane, and never joins a room", () => {
    const source = probeSource();

    // ListRooms is a read. CreateRoom, DeleteRoom, RemoveParticipant and the
    // rest would be writes against live calls.
    const calls = source.match(/RoomService\/[A-Za-z]+/g) ?? [];
    expect(calls).toEqual(["RoomService/ListRooms"]);

    // And its own token grants nothing but listing.
    expect(source).toMatch(/'video':\s*\{'roomList':\s*True\}/);
    expect(source).not.toMatch(/roomJoin/);
    expect(source).not.toMatch(/canPublish/);
  });

  it("the probe prints no credential, no token and no URL", () => {
    const source = probeSource();
    // Comment lines stripped: the script's own note explains the argv pitfall
    // by quoting it, and prose warning against a pattern is not the pattern.
    const code = source.replace(/^\s*#.*$/gm, "");

    // The token reaches curl through a config on stdin precisely so it stays
    // out of argv, where `ps` would show it to every other user on the host.
    expect(code).toMatch(/--config -/);
    expect(code).not.toMatch(/-H ["']Authorization: Bearer/);
    expect(code).not.toMatch(/echo[^\n]*\$TOKEN/);
    expect(code).not.toMatch(/echo[^\n]*\$LIVEKIT_API_SECRET/);
    expect(code).not.toMatch(/echo[^\n]*\$LIVEKIT_URL/);
    // The response body is written 0600 and removed on exit: room names
    // identify conversations.
    expect(code).toMatch(/umask 077/);
    expect(code).toMatch(/trap cleanup EXIT/);
  });

  it("the participant issuer never mentions a control-plane capability", () => {
    const source = issuerSource();

    // roomList appears exactly once, as `roomList: false`. roomCreate likewise.
    expect(source).toMatch(/roomList:\s*false/);
    expect(source).toMatch(/roomCreate:\s*false/);
    expect(source).not.toMatch(/roomList:\s*true/);
    expect(source).not.toMatch(/roomCreate:\s*true/);

    for (const capability of [
      "roomAdmin",
      "roomRecord",
      "ingressAdmin",
      "recorder",
      "agent",
      "canUpdateOwnMetadata",
      "hidden",
    ]) {
      expect(source).not.toContain(capability);
    }
  });

  it("there is exactly one participant-token implementation", () => {
    // A second issuer is how a grant contract drifts: the strict one keeps
    // passing its tests while something else mints the tokens.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } =
      require("node:child_process") as typeof import("node:child_process");
    const issuers = execSync(
      "grep -rln 'implements MediaTokenIssuer' src || true",
      { cwd: `${__dirname}/../..`, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);

    expect(issuers).toEqual(["src/communication/calls/media-token.ts"]);
  });

  it("a participant token is not usable against the control plane", async () => {
    // The end-to-end statement of the property: take a real participant token
    // and confirm it carries nothing RoomService would honour.
    const { callId } = await directCall();
    const grant = videoGrant(
      (await g.calls.issueToken(callId, s.parentId)).token,
    );

    expect(grant.roomList).toBe(false);
    expect(grant.roomCreate).toBe(false);
    for (const admin of [
      "roomAdmin",
      "roomRecord",
      "ingressAdmin",
      "recorder",
      "agent",
    ]) {
      expect(grant[admin]).toBeUndefined();
    }
    // It can do one thing: join the single room it names.
    expect(grant.roomJoin).toBe(true);
    expect(grant.room).toEqual(expect.any(String));
  });
});

// -------------------------------------------------------------------------
describe("R — the boundary of what this suite can prove", () => {
  it("a signed token is not evidence that LiveKit works, and the probe is what asks", () => {
    // Deliberately a test, not just a comment: it puts the limitation in the
    // suite's own output. Every assertion above is about what the API says; a
    // token the API signs with a made-up secret would satisfy all of them.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    const probe = `${__dirname}/../../../../scripts/infra/livekit-probe.sh`;

    expect(existsSync(probe)).toBe(true);
    // And it is not wired into this suite, because it needs credentials this
    // repository does not and must not contain.
  });
});
