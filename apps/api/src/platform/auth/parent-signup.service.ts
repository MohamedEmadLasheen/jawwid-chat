import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AUDIT_SERVICE } from '../tokens';
import type { AuditService } from '../audit.service';
import { AuthError, AuthErrorCode } from './auth.errors';
import { AuthService, type LoginContext, type TokenPair } from './auth.service';
import { hashPassword, spendComparableTime } from './password';

/** How long a code lives: long enough for a supervisor to pass it on by hand. */
export const SIGNUP_CODE_MINUTES = 10;
/** Wrong tries before a code is spent and a new one must be asked for. */
export const SIGNUP_CODE_TRIES = 5;
/** Codes one parent may ask for in an hour. */
const CODES_PER_HOUR = 5;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * PD-16: a parent whose account Chat created at enrolment sets their own
 * password, with a one-time code.
 *
 *   1. request(email)  -- the parent types the e-mail Sales recorded. If it is
 *      an enrolled parent who has not signed up, a 6-digit code is issued
 *      (10 minutes, 5 tries); any earlier live code is superseded.
 *   2. verify(email, code, password) -- the code is checked, the password set,
 *      and the parent is signed in.
 *
 * DELIVERY. Until a WhatsApp sender is connected the code is RELAYED: it is
 * kept (hashed, and in plain text only while it is live) for the family's
 * supervisor, who reads it on the New Students page and sends it on WhatsApp.
 * The code is still the parent's proof: only someone the supervisor trusts
 * with it can finish the sign-up.
 *
 * NO ENUMERATION. request() answers the same for any e-mail; verify() refuses
 * with one code whether the e-mail is unknown, the code wrong or expired. Both
 * spend the login limiter (per identifier and per source) before anything else.
 */
@Injectable()
export class ParentSignupService {
  private readonly log = new Logger('ParentSignup');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  async request(rawEmail: string): Promise<{ ok: true; delivery: 'relay' }> {
    const email = normalizeEmail(rawEmail);
    const account = email ? await this.signupAccount(email) : null;
    if (!account) return { ok: true, delivery: 'relay' };

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
          expiresAt: new Date(Date.now() + SIGNUP_CODE_MINUTES * 60_000),
        },
      });
    });
    return { ok: true, delivery: 'relay' };
  }

  async verify(rawEmail: string, rawCode: string, password: string, context: LoginContext = {}): Promise<TokenPair> {
    const email = normalizeEmail(rawEmail);
    const code = rawCode.trim();
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      throw new AuthError(AuthErrorCode.PASSWORD_TOO_WEAK);
    }
    const account = email && /^[0-9]{6}$/.test(code) ? await this.signupAccount(email) : null;
    const live = account
      ? await this.prisma.parentSignupCode.findFirst({
          where: { accountId: account.id, usedAt: null, supersededAt: null, expiresAt: { gt: new Date() } },
        })
      : null;
    if (!account || !live || live.attempts >= SIGNUP_CODE_TRIES) {
      // As costly as a real attempt, so timing does not tell a known e-mail apart.
      await spendComparableTime(password);
      throw new AuthError(AuthErrorCode.SIGNUP_CODE_INVALID);
    }

    if (!sameHash(live.codeHash, codeHash(account.id, code))) {
      const attempts = live.attempts + 1;
      await this.prisma.parentSignupCode.update({
        where: { id: live.id },
        data: attempts >= SIGNUP_CODE_TRIES
          ? { attempts, supersededAt: new Date(), relayCode: null }
          : { attempts },
      });
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
    return this.auth.login(email as string, password, context);
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
