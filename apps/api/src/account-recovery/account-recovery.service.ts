import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service';
import { normalizeEmail } from '../platform/auth/parent-signup.service';
import { PasswordResetService, RESET_CODE_MINUTES, newCode } from '../platform/auth/password-reset.service';
import { spendComparableTime } from '../platform/auth/password';
import { AuthError, AuthErrorCode } from '../platform/auth/auth.errors';
import { ParentPhoneDirectory } from '../parent-profile/parent-phone-directory';
import { RECOVERY_MAILER, RECOVERY_WHATSAPP, type RecoverySender } from './recovery-delivery';

/**
 * PD-25: a parent recovers their own account from the sign-in screen.
 *
 *   forgot password  requestByEmail(email)   -> a code by E-MAIL to that address;
 *                    then POST /auth/password-reset { username: email, code, password }.
 *   forgot e-mail    requestByPhone(phone)   -> a code by WHATSAPP to the phone on file;
 *                    confirmByPhone(phone, code) -> the sign-in e-mail(s); the same
 *                    code may then complete POST /auth/password-reset.
 *
 * WHO. A parent (family) account that is active and has already signed up
 * (PD-16 gave it a password). A suspended account stays suspended (PD-21); a
 * parent who never signed up uses sign-up; staff and teachers go through an
 * administrator (PD-21) -- the database refuses them a self-service code.
 *
 * NO ENUMERATION. Both requests answer `{ ok: true }` whatever was typed, issue
 * nothing for an unknown address or phone, and SEND after answering, so neither
 * the answer nor its timing says an account exists. confirmByPhone() refuses
 * with the one RESET_CODE_INVALID and spends a comparable hash on every refusal.
 */
@Injectable()
export class AccountRecoveryService {
  private readonly log = new Logger('AccountRecovery');

  constructor(
    private readonly prisma: PrismaService,
    private readonly reset: PasswordResetService,
    private readonly phones: ParentPhoneDirectory,
    @Inject(RECOVERY_MAILER) private readonly mailer: RecoverySender,
    @Inject(RECOVERY_WHATSAPP) private readonly whatsapp: RecoverySender,
  ) {}

  /** What the sign-in screen may offer. Configuration only -- the same for everyone. */
  options(): { email: boolean; whatsapp: boolean; codeMinutes: number } {
    return { email: this.mailer.available, whatsapp: this.whatsapp.available, codeMinutes: RESET_CODE_MINUTES };
  }

  async requestByEmail(rawEmail: string): Promise<{ ok: true }> {
    const email = normalizeEmail(rawEmail);
    if (!email || !this.mailer.available) return { ok: true };
    const [account] = await this.recoverable({ subject: email });
    if (!account) return { ok: true };
    const issued = await this.reset.issueRecovery({ accountId: account.id, organizationId: account.organizationId, channel: 'email' });
    if (issued) this.later(`account ${account.id}: e-mail`, () => this.mailer.sendCode(email, issued.code, RESET_CODE_MINUTES));
    return { ok: true };
  }

  async requestByPhone(rawPhone: string): Promise<{ ok: true }> {
    if (!this.whatsapp.available) return { ok: true };
    const match = await this.phones.match(rawPhone);
    const accounts = match ? await this.recoverable({ contactIds: match.contacts.map((c) => c.contactId) }) : [];
    if (!match || accounts.length === 0) return { ok: true };

    // One message to the phone; one code row per account that phone belongs to.
    const code = newCode();
    let sent = 0;
    for (const a of accounts) {
      if (await this.reset.issueRecovery({ accountId: a.id, organizationId: a.organizationId, channel: 'whatsapp', code })) sent++;
    }
    if (sent > 0) this.later(`accounts ${accounts.map((a) => a.id).join(',')}: whatsapp`, () => match.deliver((to) => this.whatsapp.sendCode(to, code, RESET_CODE_MINUTES)));
    return { ok: true };
  }

  /** The sign-in e-mail of every account the code is good for; RESET_CODE_INVALID otherwise. */
  async confirmByPhone(rawPhone: string, code: string): Promise<{ emails: string[] }> {
    const match = /^[0-9]{6}$/.test(code.trim()) ? await this.phones.match(rawPhone) : null;
    const accounts = match ? await this.recoverable({ contactIds: match.contacts.map((c) => c.contactId) }) : [];
    const emails: string[] = [];
    for (const a of accounts) {
      if (await this.reset.confirmRecovery(a.id, code)) emails.push(a.subject);
    }
    if (emails.length === 0) {
      await spendComparableTime(code);
      throw new AuthError(AuthErrorCode.RESET_CODE_INVALID);
    }
    return { emails: emails.sort() };
  }

  /** Active, signed-up parent accounts, by sign-in e-mail or by parent contact. */
  private async recoverable(by: { subject: string } | { contactIds: string[] }) {
    return this.prisma.account.findMany({
      where: {
        ...('subject' in by ? { subject: by.subject } : { contacts: { some: { id: { in: by.contactIds } } } }),
        kind: 'family',
        isActive: true,
        status: 'active',
        credential: { isNot: null },
      },
      select: { id: true, organizationId: true, subject: true },
      orderBy: { subject: 'asc' },
    });
  }

  /** After the answer: a provider's latency or failure must not reach the parent's response. */
  private later(what: string, send: () => Promise<void>): void {
    setImmediate(() => {
      // Never the message: an SMTP refusal quotes the recipient's address.
      send().catch((e: unknown) => this.log.error(`recovery code not delivered (${what}): ${failureKind(e)}`));
    });
  }
}

function failureKind(e: unknown): string {
  const x = e as { name?: unknown; code?: unknown; responseCode?: unknown };
  return [x?.name, x?.code, x?.responseCode].filter((v) => typeof v === 'string' || typeof v === 'number').join(' ') || 'error';
}
