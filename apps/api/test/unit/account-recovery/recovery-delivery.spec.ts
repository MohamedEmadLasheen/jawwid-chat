/**
 * PD-25: how a recovery code leaves the API. No network: the WhatsApp sender
 * takes a fetch, the SMTP mailer a transport.
 */
import {
  LoggingRecoverySender,
  SmtpRecoveryMailer,
  WhatsAppCloudSender,
  recoveryMail,
  selectRecoveryMailer,
  selectRecoveryWhatsApp,
} from '../../../src/account-recovery/recovery-delivery';
import { toE164 } from '../../../src/parent-profile/parent-phone-directory';

const WHATSAPP_ENV = {
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
  WHATSAPP_ACCESS_TOKEN: 'test-token',
  WHATSAPP_RECOVERY_TEMPLATE: 'jawwid_recovery',
};

describe('choosing a channel at boot', () => {
  it('is unavailable when nothing is configured, and never sends', async () => {
    const mail = selectRecoveryMailer({});
    const wa = selectRecoveryWhatsApp({});
    expect([mail.available, wa.available]).toEqual([false, false]);
    await expect(mail.sendCode('a@b.co', '123456', 10)).rejects.toThrow(/not configured/);
  });

  it('needs every variable of a channel, not some of them', () => {
    expect(selectRecoveryMailer({ SMTP_URL: 'smtp://localhost:2525' }).available).toBe(false);
    expect(selectRecoveryWhatsApp({ WHATSAPP_ACCESS_TOKEN: 'x', WHATSAPP_PHONE_NUMBER_ID: '1' }).available).toBe(false);
  });

  it('picks SMTP and the WhatsApp Cloud API when configured', () => {
    expect(selectRecoveryMailer({ SMTP_URL: 'smtp://localhost:2525', RECOVERY_MAIL_FROM: 'no-reply@jawwid.test' })).toBeInstanceOf(SmtpRecoveryMailer);
    expect(selectRecoveryWhatsApp(WHATSAPP_ENV)).toBeInstanceOf(WhatsAppCloudSender);
  });

  it('logs codes only when asked, and refuses to boot so in production', () => {
    expect(selectRecoveryMailer({ RECOVERY_DELIVERY_LOG: 'true', NODE_ENV: 'development' })).toBeInstanceOf(LoggingRecoverySender);
    expect(selectRecoveryWhatsApp({ RECOVERY_DELIVERY_LOG: 'true' })).toBeInstanceOf(LoggingRecoverySender);
    expect(() => selectRecoveryMailer({ RECOVERY_DELIVERY_LOG: 'true', NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => selectRecoveryWhatsApp({ RECOVERY_DELIVERY_LOG: 'true', NODE_ENV: 'production' })).toThrow(/production/);
    // A real provider wins over the log switch.
    expect(selectRecoveryWhatsApp({ ...WHATSAPP_ENV, RECOVERY_DELIVERY_LOG: 'true' })).toBeInstanceOf(WhatsAppCloudSender);
  });
});

describe('the e-mail', () => {
  it('carries the code and its lifetime, in Arabic first and in English', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    await new SmtpRecoveryMailer({ sendMail }, 'Jawwid <no-reply@jawwid.test>').sendCode('parent@jawwid.test', '042917', 10);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const sent = sendMail.mock.calls[0][0];
    expect(sent).toMatchObject({ from: 'Jawwid <no-reply@jawwid.test>', to: 'parent@jawwid.test' });
    expect(sent.subject).toContain('042917');
    expect(sent.text.split('\n')).toContain('042917');
    expect(sent.text.indexOf('جوّد')).toBeLessThan(sent.text.indexOf('Jawwid'));
    expect(recoveryMail('1', 10).text).toContain('10 minutes');
  });
});

describe('the WhatsApp message', () => {
  it('posts an authentication template with the code in the body and the copy button', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const sender = new WhatsAppCloudSender(
      { phoneNumberId: '1234567890', accessToken: 'test-token', template: 'jawwid_recovery', language: 'ar', apiVersion: 'v21.0' },
      fetchImpl as unknown as typeof fetch,
    );
    await sender.sendCode('+201005550123', '042917');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect(init.headers.authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      to: '201005550123',
      type: 'template',
      template: {
        name: 'jawwid_recovery',
        language: { code: 'ar' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '042917' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '042917' }] },
        ],
      },
    });
  });

  it('fails on a refusal without repeating the response (it names the recipient)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 400, text: async () => '+201005550123' });
    const sender = new WhatsAppCloudSender(
      { phoneNumberId: '1', accessToken: 't', template: 'x', language: 'ar', apiVersion: 'v21.0' },
      fetchImpl as unknown as typeof fetch,
    );
    await expect(sender.sendCode('+201005550123', '042917')).rejects.toThrow(/^WhatsApp Cloud API answered 400$/);
  });
});

describe('matching a typed phone (toE164)', () => {
  it.each([
    ['010 0555 0123', 'EG', '+201005550123'],
    ['+20 100 555 0123', 'EG', '+201005550123'],
    ['0020-100-555-0123', 'EG', '+201005550123'],
    ['(010) 0555-0123', 'EG', '+201005550123'],
    ['050 123 4567', 'AE', '+971501234567'],
    ['+971 50 123 4567', 'EG', '+971501234567'],
  ] as const)('%s in %s is %s', (typed, region, e164) => {
    expect(toE164(typed, region)).toBe(e164);
  });

  it.each(['', '12', 'call me', '+20 abc', '1'.repeat(40)])('%p is not a phone', (typed) => {
    expect(toE164(typed, 'EG')).toBeNull();
  });
});
