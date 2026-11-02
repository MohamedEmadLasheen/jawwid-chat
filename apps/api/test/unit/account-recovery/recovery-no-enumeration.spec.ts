/**
 * PD-25 NO ENUMERATION, by timing. QA measured POST /auth/recovery/password at
 * 46–87 ms for a known e-mail and ~5 ms for an unknown one: the account lookup
 * and the code issue (a hash and a write) ran BEFORE the answer, the send after.
 *
 * Timing-free proof: at the moment the answer resolves, neither path has done
 * any work that depends on the address -- no lookup, no issue, no send -- for a
 * known account and an unknown one alike. All of it happens after the answer.
 */
import { AccountRecoveryService } from '../../../src/account-recovery/account-recovery.service';

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

function build(known: boolean) {
  const calls: string[] = [];
  const account = { id: 'acc-1', organizationId: 'org-1', subject: 'parent@example.com' };
  const prisma = {
    account: {
      findMany: jest.fn(async () => {
        calls.push('lookup');
        return known ? [account] : [];
      }),
    },
  };
  const reset = {
    issueRecovery: jest.fn(async () => {
      calls.push('issue');
      return { code: '123456' };
    }),
  };
  const phones = {
    match: jest.fn(async () => {
      calls.push('phone-match');
      return known ? { contacts: [{ contactId: 'c-1' }], deliver: async (send: (to: string) => Promise<void>) => send('+201005550123') } : null;
    }),
  };
  const sender = (channel: string) => ({
    available: true,
    sendCode: jest.fn(async () => {
      calls.push(`send:${channel}`);
    }),
  });
  const mailer = sender('email');
  const whatsapp = sender('whatsapp');
  const service = new AccountRecoveryService(prisma as never, reset as never, phones as never, mailer as never, whatsapp as never);
  return { service, calls, mailer, whatsapp };
}

describe('forgot password (e-mail): the answer comes before any work that depends on the address', () => {
  it.each([true, false])('known account = %s: nothing looked up, issued or sent when the answer resolves', async (known) => {
    const { service, calls } = build(known);
    await expect(service.requestByEmail('parent@example.com')).resolves.toEqual({ ok: true });
    expect(calls).toEqual([]); // identical for both: the same answer after the same (no) work
    await flush();
    expect(calls).toEqual(known ? ['lookup', 'issue', 'send:email'] : ['lookup']);
  });

  it('two requests in a row are handled one after the other (the resend wait still sees the first code)', async () => {
    const { service, calls } = build(true);
    await service.requestByEmail('parent@example.com');
    await service.requestByEmail('parent@example.com');
    await flush();
    expect(calls).toEqual(['lookup', 'issue', 'send:email', 'lookup', 'issue', 'send:email']);
  });

  it('a failure after the answer is logged, never thrown into the request, and the next request still runs', async () => {
    const { service, calls, mailer } = build(true);
    mailer.sendCode.mockRejectedValueOnce(Object.assign(new Error('550 parent@example.com rejected'), { responseCode: 550 }));
    await service.requestByEmail('parent@example.com');
    await service.requestByEmail('parent@example.com');
    await flush();
    expect(calls.filter((c) => c === 'issue')).toHaveLength(2);
  });
});

describe('forgot e-mail (WhatsApp): the same, for a phone', () => {
  it.each([true, false])('phone on file = %s: nothing matched, looked up, issued or sent when the answer resolves', async (known) => {
    const { service, calls } = build(known);
    await expect(service.requestByPhone('+20 100 555 0123')).resolves.toEqual({ ok: true });
    expect(calls).toEqual([]);
    await flush();
    expect(calls).toEqual(known ? ['phone-match', 'lookup', 'issue', 'send:whatsapp'] : ['phone-match']);
  });
});
