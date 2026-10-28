import { PARENT_NOTICES, acknowledgeParentNotice } from '../../lesson-audio/parent-notices';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AUDIT_SERVICE } from '../tokens';
import type { AuditService } from '../audit.service';
import { AuthError, AuthErrorCode } from './auth.errors';
import { hashPassword } from './password';
import { isPasswordLengthAcceptable } from './password-policy';
import { subjectHash } from './subject-hash';

/** Wrong tries before a code is spent and a new one must be asked for. */
export const SIGNUP_CODE_TRIES = 5;
/** Codes one parent may ask for in an hour. */
const CODES_PER_HOUR = 5;
/**
 * PD-32: wrong codes one e-mail may enter in a rolling 24 hours, across all its
 * codes (chat.config `signup.wrong_codes_per_day`; this is the compiled default).
 */
export const SIGNUP_WRONG_CODES_PER_DAY = 10;
const WRONG_CODES_KEY = 'signup.wrong_codes_per_day';
const DAY_MS = 24 * 3_600_000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * PD-16: a parent whose account Chat created at enrolment sets their own
 * password, with a one-time code.
 *
 *   1. request(email)  -- the parent types the e-mail Sales recorded. If it is
 *      an enrolled parent who has not signed up, a 6-digit code is issued
 *      (5 tries); any earlier live code is superseded.
 *   2. verify(email, code, password) -- the code is checked and the password
 *      set. The client then signs in through POST /auth/login like anyone else,
 *      so a sign-up never opens a session of its own.
 *
 * DELIVERY. Until a WhatsApp sender is connected the code is RELAYED: it is
 * kept (hashed, and in plain text only while it is live) for the family's
 * supervisor, who reads it on the New Students page and sends it on WhatsApp.
 * The code is still the parent's proof: only someone the supervisor trusts
 * with it can finish the sign-up.
 *
 * NO TIME EXPIRY (PD-32, amending PD-16). A code lives until it is used, a new
 * one supersedes it, five wrong tries spend it, staff invalidate it, any
 * password is set on the account, or the account stops being active (the last
 * two are database triggers, whatever path does them).
 *
 * THE WRONG-CODE CAP (PD-32). The ten minutes never limited guessing -- anyone
 * who knows the e-mail can ask for fresh codes -- so wrong codes are counted per
 * e-mail across all codes: ten in a rolling 24 hours refuse further tries
 * (SIGNUP_LOCKED, "contact your supervisor") until the window rolls or staff
 * reset it (resetAttempts, audited). A new code does not reset it.
 *
 * NO ENUMERATION. request() answers the same for any e-mail; verify() refuses
 * with one code whether the e-mail is unknown, the code wrong, spent or
 * superseded. The cap counts wrong tries for ANY e-mail typed, known or not, so
 * reaching it says nothing about the e-mail. Both spend the login limiter (per
 * identifier and per source) before anything else.
 */
@Injectable()
export class ParentSignupService {
  private readonly log = new Logger('ParentSignup');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async request(rawEmail: string): Promise<{ ok: true; delivery: 'relay' }> {
    const email = normalizeEmail(rawEmail);
    const account = email ? await this.signupAccount(email) : null;
    if (!account) return { ok: true, delivery: 'relay' };
    // A capped account gets no new code: it could not be used anyway.
    if ((await signupWrongCodes(this.prisma, { accountId: account.id })).locked) return { ok: true, delivery: 'relay' };

    const recent = await this.prisma.parentSignupCode.count({
      where: { accountId: account.id, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= CODES_PER_HOUR) return { ok: true, delivery: 'relay' };

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.$transaction(async (tx) => {
      await tx.parentSignupCode.updateMany({
        where: { accountId: account.id, usedAt: null, supersededAt: null },
        data: { supersededAt: new Date(), relayCode: null },
      });
      await tx.parentSignupCode.create({
        data: {
          organizationId: account.organizationId,
          accountId: account.id,
          codeHash: codeHash(account.id, code),
          relayCode: code,
          delivery: 'relay',
          // PD-32: no time expiry.
        },
      });
    });
    return { ok: true, delivery: 'relay' };
  }

  /**
   * ONE DECISION PER ATTEMPT, SERIALISED (PD-32). Everything that decides an
   * attempt -- the 24-hour cap, the code's five tries, spending it -- happens in
   * one transaction holding an advisory lock on the attempt's key (the account,
   * or the e-mail's hash when it is not an enrolled parent's). A burst of
   * parallel guesses therefore queues: exactly `cap` of them are compared, the
   * rest are refused as locked. Nothing is checked outside the lock and acted
   * on inside it.
   */
  async verify(rawEmail: string, rawCode: string, password: string, lessonAudioNotice: number | null = null): Promise<{ ok: true }> {
    const email = normalizeEmail(rawEmail);
    const code = rawCode.trim();
    if (!isPasswordLengthAcceptable(password)) {
      throw new AuthError(AuthErrorCode.PASSWORD_TOO_WEAK);
    }
    // Hashed for every attempt, before anything is looked up: as costly for an
    // unknown e-mail or a wrong code as for a right one, so timing tells nothing.
    const passwordHash = await hashPassword(password);
    if (!email) throw new AuthError(AuthErrorCode.SIGNUP_CODE_INVALID);
    const key = await failureKey(this.prisma, email);
    const account = await this.signupAccount(email);

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockName(key)}, 0))`;
      if ((await signupWrongCodes(tx, key)).locked) return 'locked' as const;

      const live = account && /^[0-9]{6}$/.test(code)
        ? await tx.parentSignupCode.findFirst({
            // Codes from before PD-32 keep their expiry; it is still honoured.
            where: { accountId: account.id, usedAt: null, supersededAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          })
        : null;
      if (!account || !live || !sameHash(live.codeHash, codeHash(account.id, code))) {
        // A wrong try, whatever the e-mail: the cap must not tell known from unknown.
        await tx.parentSignupFailure.create({ data: key });
        if (live) {
          const tried = await tx.parentSignupCode.update({ where: { id: live.id }, data: { attempts: { increment: 1 } } });
          if (tried.attempts >= SIGNUP_CODE_TRIES) {
            await tx.parentSignupCode.update({ where: { id: live.id }, data: { supersededAt: new Date(), relayCode: null } });
          }
        }
        return 'invalid' as const;
      }

      // Two submissions of one code finish once (the lock already serialises them).
      const spent = await tx.parentSignupCode.updateMany({
        where: { id: live.id, usedAt: null, supersededAt: null },
        data: { usedAt: new Date(), relayCode: null },
      });
      if (spent.count !== 1) return 'invalid' as const;
      await tx.accountCredential.create({ data: { accountId: account.id, passwordHash } });
      // PD-48: the sign-up acknowledgement of the lesson-audio notice is the SAME
      // record the next-sign-in prompt looks for, so a new parent is never asked again.
      // Only the current version counts; an older app's tick records nothing.
      if (lessonAudioNotice === PARENT_NOTICES.lesson_audio) {
        await acknowledgeParentNotice(tx, account.contactId, 'lesson_audio', PARENT_NOTICES.lesson_audio);
      }
      // The parent is not staff (audit_log.actor_id names staff): no actor, the account as entity.
      await this.audit.audit(tx, {
        actorId: null,
        action: 'parent.signed_up',
        entity: 'account',
        entityId: account.id,
        after: { familyId: account.familyId, contactId: account.contactId },
        reason: 'parent completed sign-up with a one-time code',
      });
      return 'ok' as const;
    });

    if (outcome === 'locked') throw new AuthError(AuthErrorCode.SIGNUP_LOCKED);
    if (outcome === 'invalid') throw new AuthError(AuthErrorCode.SIGNUP_CODE_INVALID);
    this.log.log(`account ${(account as { id: string }).id} completed its parent sign-up`);
    return { ok: true };
  }

  /**
   * The account a sign-up may finish: a family account Chat created at
   * enrolment, active, linked to its parent, and without a password yet.
   */
  private async signupAccount(email: string) {
    const account = await this.prisma.account.findUnique({
      where: { subject: email },
      include: { credential: true, contacts: { select: { id: true, familyId: true }, take: 1 } },
    });
    if (!account || account.kind !== 'family' || account.credential || !account.isActive || account.status !== 'active') return null;
    const enrolled = await this.prisma.studentEnrolment.findFirst({ where: { accountId: account.id }, select: { lessonId: true } });
    const contact = account.contacts[0];
    if (!enrolled || !contact) return null;
    return { id: account.id, organizationId: account.organizationId, contactId: contact.id, familyId: contact.familyId };
  }
}

/**
 * PD-32: whose wrong codes an attempt counts against -- the enrolled parent's
 * ACCOUNT when the e-mail is one (so a changed e-mail does not reset the count),
 * otherwise the hash of the e-mail typed (never the e-mail itself).
 */
export type FailureKey = { accountId: string } | { subjectHash: string };

export async function failureKey(prisma: Pick<PrismaService, 'account'>, email: string): Promise<FailureKey> {
  const account = await prisma.account.findUnique({ where: { subject: email }, select: { id: true, kind: true } });
  return account && account.kind === 'family' ? { accountId: account.id } : { subjectHash: subjectHash(email) };
}

function lockName(key: FailureKey): string {
  return 'accountId' in key ? `pd032-signup:account:${key.accountId}` : `pd032-signup:subject:${key.subjectHash}`;
}

/**
 * PD-32: the wrong sign-up codes counted against a key in the last 24 hours that
 * staff have not reset, against the cap. Shared with the New Students page.
 */
export async function signupWrongCodes(
  prisma: Pick<PrismaService, 'parentSignupFailure' | 'config'>,
  key: FailureKey,
): Promise<{ wrong: number; cap: number; locked: boolean }> {
  const [wrong, row] = await Promise.all([
    prisma.parentSignupFailure.count({
      where: { ...key, clearedAt: null, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    }),
    prisma.config.findUnique({ where: { key: WRONG_CODES_KEY } }),
  ]);
  const n = row?.value;
  const cap = typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : SIGNUP_WRONG_CODES_PER_DAY;
  return { wrong, cap, locked: wrong >= cap };
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length >= 3 && email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function codeHash(accountId: string, code: string): string {
  return createHash('sha256').update(`${accountId}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}
