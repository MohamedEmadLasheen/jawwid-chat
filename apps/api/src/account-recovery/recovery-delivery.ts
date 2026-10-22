import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * PD-25: how a recovery code reaches a parent. Owner decision: the password
 * code goes by E-MAIL (to the sign-in address), the forgot-e-mail code by
 * WHATSAPP (to the parent-file phone).
 *
 * Each channel is chosen ONCE at boot from the environment:
 *
 *   e-mail    SMTP_URL + RECOVERY_MAIL_FROM            -> SMTP (any provider)
 *   WhatsApp  WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN
 *             + WHATSAPP_RECOVERY_TEMPLATE             -> Meta WhatsApp Cloud API
 *   neither   RECOVERY_DELIVERY_LOG=true (never in production) -> the code is
 *             written to the API log, for local development and QA
 *   otherwise the channel is UNAVAILABLE: GET /auth/recovery/options says so,
 *             the app hides that way in and sends the parent to their
 *             supervisor, and no code is issued for it.
 *
 * A sender throws on failure; the caller sends AFTER answering the parent (so a
 * slow provider cannot tell an outsider an account exists) and logs the failure.
 */
export interface RecoverySender {
  readonly available: boolean;
  /** `to` is an e-mail address or an E.164 phone, by channel. */
  sendCode(to: string, code: string, minutes: number): Promise<void>;
}

export const RECOVERY_MAILER = Symbol('RecoveryMailer');
export const RECOVERY_WHATSAPP = Symbol('RecoveryWhatsApp');

type Env = Readonly<Record<string, string | undefined>>;

class Unavailable implements RecoverySender {
  readonly available = false;
  async sendCode(): Promise<void> {
    throw new Error('recovery channel is not configured');
  }
}

/** Development only: the code goes to the API log instead of the parent. */
export class LoggingRecoverySender implements RecoverySender {
  readonly available = true;
  private readonly log: Logger;
  constructor(private readonly channel: 'email' | 'whatsapp') {
    this.log = new Logger(`RecoveryDelivery:${channel}`);
  }
  async sendCode(_to: string, code: string, minutes: number): Promise<void> {
    // Never the address or the phone: the log is not a contact directory.
    this.log.warn(`[RECOVERY_DELIVERY_LOG] ${this.channel} recovery code ${code} (valid ${minutes} min)`);
  }
}

export class SmtpRecoveryMailer implements RecoverySender {
  readonly available = true;
  constructor(
    private readonly transport: Pick<Transporter, 'sendMail'>,
    private readonly from: string,
  ) {}

  async sendCode(to: string, code: string, minutes: number): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, ...recoveryMail(code, minutes) });
  }
}

/** Arabic first, then English; the code alone on its line so a phone offers to copy it. */
export function recoveryMail(code: string, minutes: number): { subject: string; text: string } {
  return {
    subject: `رمز استعادة حساب جوّد ${code} | Jawwid recovery code`,
    text: [
      'رمز إعادة تعيين كلمة المرور في تطبيق جوّد:',
      '',
      code,
      '',
      `صالح لمدة ${minutes} دقائق. إذا لم تطلبه فتجاهل هذه الرسالة؛ كلمة مرورك لم تتغير.`,
      'لا تشارك هذا الرمز مع أي شخص، ولا حتى مع فريق جوّد.',
      '',
      '---',
      '',
      `Your Jawwid password reset code is ${code}.`,
      `It expires in ${minutes} minutes. If you did not ask for it, ignore this e-mail; your password has not changed.`,
      'Never share this code with anyone, including the Jawwid team.',
    ].join('\n'),
  };
}

/**
 * Meta WhatsApp Cloud API. A business may open a conversation only with an
 * APPROVED template; recovery uses an AUTHENTICATION template, whose body takes
 * the code as {{1}} and whose copy-code button takes it again.
 */
export class WhatsAppCloudSender implements RecoverySender {
  readonly available = true;
  constructor(
    private readonly config: { phoneNumberId: string; accessToken: string; template: string; language: string; apiVersion: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendCode(to: string, code: string): Promise<void> {
    const url = `https://graph.facebook.com/${this.config.apiVersion}/${encodeURIComponent(this.config.phoneNumberId)}/messages`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: this.config.template,
          language: { code: this.config.language },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // Never the response body: it echoes the recipient.
    if (!res.ok) throw new Error(`WhatsApp Cloud API answered ${res.status}`);
  }
}

function logSwitch(env: Env): boolean {
  if (env.RECOVERY_DELIVERY_LOG !== 'true') return false;
  if (env.NODE_ENV === 'production') {
    // infra/env/manifest.tsv forbids it in production; refuse to boot rather than log codes.
    throw new Error('RECOVERY_DELIVERY_LOG must not be set in production');
  }
  return true;
}

export function selectRecoveryMailer(env: Env = process.env): RecoverySender {
  if (env.SMTP_URL && env.RECOVERY_MAIL_FROM) {
    return new SmtpRecoveryMailer(createTransport(env.SMTP_URL), env.RECOVERY_MAIL_FROM);
  }
  return logSwitch(env) ? new LoggingRecoverySender('email') : new Unavailable();
}

export function selectRecoveryWhatsApp(env: Env = process.env): RecoverySender {
  if (env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_RECOVERY_TEMPLATE) {
    return new WhatsAppCloudSender({
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
      template: env.WHATSAPP_RECOVERY_TEMPLATE,
      language: env.WHATSAPP_TEMPLATE_LANGUAGE || 'ar',
      apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
    });
  }
  return logSwitch(env) ? new LoggingRecoverySender('whatsapp') : new Unavailable();
}
