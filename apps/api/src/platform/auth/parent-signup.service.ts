import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AUDIT_SERVICE } from '../tokens';
import type { AuditService } from '../audit.service';
import { AuthError, AuthErrorCode } from './auth.errors';
import { hashPassword, spendComparableTime } from './password';
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
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
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
    // A capped e-mail gets no new code: it could not be used anyway.
    if (await this.locked(email as string)) return { ok: true, delivery: 'relay' };

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

  async verify(rawEmail: string, rawCode: string, password: string): Promise<{ ok: true }> {
    const email = normalizeEmail(rawEmail);
    const code = rawCode.trim();
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      throw new AuthError(AuthErrorCode.PASSWORD_TOO_WEAK);
    }
    if (email && (await this.locked(email))) {
      await spendComparableTime(password);
      throw new AuthError(AuthErrorCode.SIGNUP_LOCKED);
    }
    const account = email && /^[0-9]{6}$/.test(code) ? await this.signupAccount(email) : null;
    const live = account
      ? await this.prisma.parentSignupCode.findFirst({
          // Codes from before PD-32 keep their expiry; it is still honoured.
          where: { accountId: account.id, usedAt: null, supersededAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        })
      : null;
    if (!account || !live || live.attempts >= SIGNUP_CODE_TRIES) {
      // A wrong try, whatever the e-mail: the cap must not tell known from unknown.
      if (email) await this.recordFailure(email);
      // As costly as a real attempt, so timing does not tell a known e-mail apart.
      await spendComparableTime(password);
      throw new AuthError(AuthErrorCode.SIGNUP_CODE_INVALID);
    }

    if (!sameHash(live.codeHash, codeHash(account.id, code))) {
      const attempts = live.attempts + 1;
      await this.prisma.$transaction([
        this.prisma.parentSignupCode.update({
          where: { id: live.id },
          data: attempts >= SIGNUP_CODE_TRIES
            ? { attempts, supersededAt: new Date(), relayCode: null }
            : { attempts },
        }),
        this.prisma.parentSignupFailure.create({ data: { subjectHash: subjectHash(email as string) } }),
      ]);
      await spendComparableTime(password);
      throw new AuthError(AuthErrorCode.SIGNUP_CODE_INVALID);
    }

    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      // Re-read under the transaction: two submissions of one code finish once.
      const spent = await tx.parentSignupCode.updateMany({
        where: { id: live.id, usedAt: null, supersededAt: null },
        data: { usedAt: new Date(), relayCode: null },
      });
      if (spent.count !== 1) throw new AuthError(AuthErrorCode.SIGNUP_CODE_INVALID);
      await tx.accountCredential.create({ data: { accountId: account.id, passwordHash } });
      // The parent is not staff (audit_log.actor_id names staff): no actor, the account as entity.
      await this.audit.audit(tx, {
        actorId: null,
        action: 'parent.signed_up',
        entity: 'account',
        entityId: account.id,
        after: { familyId: account.familyId, contactId: account.contactId },
        reason: 'parent completed sign-up with a one-time code',
      });
    });
    this.log.log(`account ${account.id} completed its parent sign-up`);
    return { ok: true };
  }

  private async locked(email: string): Promise<boolean> {
    return (await signupWrongCodes(this.prisma, email)).locked;
  }

  private async recordFailure(email: string): Promise<void> {
    await this.prisma.parentSignupFailure.create({ data: { subjectHash: subjectHash(email) } });
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
 * PD-32: an e-mail's wrong sign-up codes in the last 24 hours that staff have
 * not reset, against the cap. Shared with the New Students page.
 */
export async function signupWrongCodes(
  prisma: Pick<PrismaService, 'parentSignupFailure' | 'config'>,
  email: string,
): Promise<{ wrong: number; cap: number; locked: boolean }> {
  const [wrong, row] = await Promise.all([
    prisma.parentSignupFailure.count({
      where: { subjectHash: subjectHash(email), clearedAt: null, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
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
