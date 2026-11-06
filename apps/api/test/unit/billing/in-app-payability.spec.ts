/**
 * Store payments (App Store 3.1.3(d), Google Play's 1:1 online services): the
 * app takes a card or bank-transfer payment only for live one-to-one lessons.
 * Every purpose is classified; anything that is not a lesson package is
 * refused in the app (the web pay link, outside the app, is unchanged).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { CommError, CommErrorCode } from '@platform/errors';
import { REQUEST_PURPOSES } from '../../../src/billing/payment-ledger.service';
import {
  IN_APP_PAYABLE_PURPOSES,
  LIVE_ONE_TO_ONE_DESCRIPTION,
  assertPayableInApp,
  checkoutDescription,
  isPayableInApp,
} from '../../../src/billing/in-app-payability';

describe('in-app payability', () => {
  it('classifies every request purpose, and only lesson purposes are payable in the app', () => {
    // A new purpose must be decided here, one way or the other.
    const decided = { subscription: true, renewal: true, instalment: true, balance: true, other: false };
    expect([...REQUEST_PURPOSES].sort()).toEqual(Object.keys(decided).sort());
    for (const p of REQUEST_PURPOSES) expect(isPayableInApp({ purpose: p })).toBe(decided[p]);
    expect([...IN_APP_PAYABLE_PURPOSES].sort()).toEqual(['balance', 'instalment', 'renewal', 'subscription']);
    expect(isPayableInApp({ purpose: 'other' })).toBe(false);
  });

  it('refuses an unknown or unclassified purpose (fails closed)', () => {
    expect(isPayableInApp({ purpose: 'group_class' })).toBe(false);
    expect(isPayableInApp({ purpose: '' })).toBe(false);
  });

  it('assertPayableInApp throws COMM.PAYMENT_NOT_IN_APP (409) for a non-lesson request', () => {
    expect(() => assertPayableInApp({ purpose: 'subscription' })).not.toThrow();
    let caught: unknown;
    try {
      assertPayableInApp({ purpose: 'other' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CommError);
    expect((caught as CommError).code).toBe(CommErrorCode.PAYMENT_NOT_IN_APP);
    expect((caught as CommError).status).toBe(409);
  });

  it('describes a lesson payment as live one-to-one lessons, in the family\'s language, with the period', () => {
    expect(LIVE_ONE_TO_ONE_DESCRIPTION.en).toMatch(/live one-to-one/i);
    expect(LIVE_ONE_TO_ONE_DESCRIPTION.en).toMatch(/not recorded/i);
    expect(LIVE_ONE_TO_ONE_DESCRIPTION.ar).toContain('مباشرة');
    expect(LIVE_ONE_TO_ONE_DESCRIPTION.ar).toContain('فردية');
    const p = { purpose: 'subscription', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-03-31') };
    expect(checkoutDescription(p, 'en')).toBe(`${LIVE_ONE_TO_ONE_DESCRIPTION.en} 2026-01-01 → 2026-03-31`);
    expect(checkoutDescription(p, 'ar')).toBe(`${LIVE_ONE_TO_ONE_DESCRIPTION.ar} 2026-01-01 → 2026-03-31`);
    expect(checkoutDescription({ purpose: 'instalment', periodStart: null, periodEnd: null }, 'en')).toBe(LIVE_ONE_TO_ONE_DESCRIPTION.en);
  });

  it('never calls a non-lesson payment a lesson (web pay link only): just the period, as before', () => {
    expect(checkoutDescription({ purpose: 'other', periodStart: null, periodEnd: null }, 'en')).toBeNull();
    expect(checkoutDescription({ purpose: 'other', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31') }, 'ar'))
      .toBe('2026-01-01 → 2026-01-31');
  });
});

describe('no lesson is recorded (Google Play 1:1: "not available for replay afterwards")', () => {
  it('the API starts no LiveKit egress or recording', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(__dirname, '../../../src'));
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      expect({ f, hit: /EgressClient|start\w*Egress|startRecording/.test(readFileSync(f, 'utf8')) }).toEqual({ f, hit: false });
    }
  });
});
