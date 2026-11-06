/**
 * Store payments (App Store 3.1.3(d), Google Play's 1:1 online services): the
 * app takes a card or bank-transfer payment only for a VERIFIED lesson package.
 * The rules here are pure; the database-backed paths are in
 * test/integration/pd027-payments-http.spec.ts (R-4).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { REQUEST_PURPOSES } from '../../../src/billing/payment-ledger.service';
import {
  LESSON_PURPOSES,
  LIVE_ONE_TO_ONE_DESCRIPTION,
  checkoutDescription,
  isInstalmentPayableInApp,
  isPayableInApp,
  type PackageFacts,
  type RequestFacts,
} from '../../../src/billing/in-app-payability';

const facts: PackageFacts = {
  instalmentPackage: new Map([['inst-linked', 'pkg-ok'], ['inst-voided', 'pkg-void'], ['inst-loose', null]]),
  standing: new Set(['pkg-ok']),
};
const req = (over: Partial<RequestFacts>): RequestFacts => ({
  purpose: 'subscription', learnerId: null, lessonsIncluded: null, instalmentId: null, lessonSubscriptionId: null, ...over,
});

describe('in-app payability', () => {
  it('every purpose is decided; only the lesson purposes can ever be payable', () => {
    expect([...REQUEST_PURPOSES].sort()).toEqual(['balance', 'instalment', 'other', 'renewal', 'subscription']);
    expect([...LESSON_PURPOSES].sort()).toEqual(['balance', 'instalment', 'renewal', 'subscription']);
    expect(isPayableInApp(req({ purpose: 'other', learnerId: 'c', lessonsIncluded: 8, lessonSubscriptionId: 'pkg-ok' }), facts)).toBe(false);
    expect(isPayableInApp(req({ purpose: 'group_class', learnerId: 'c', lessonsIncluded: 8 }), facts)).toBe(false);
  });

  it('a subscription or renewal: only with its child and the lessons it buys', () => {
    for (const purpose of ['subscription', 'renewal']) {
      expect(isPayableInApp(req({ purpose, learnerId: 'c', lessonsIncluded: 8 }), facts)).toBe(true);
      expect(isPayableInApp(req({ purpose, learnerId: 'c' }), facts)).toBe(false);
      expect(isPayableInApp(req({ purpose, lessonsIncluded: 8 }), facts)).toBe(false);
    }
  });

  it('an instalment: only when its instalment names a standing lesson package', () => {
    expect(isPayableInApp(req({ purpose: 'instalment', instalmentId: 'inst-linked' }), facts)).toBe(true);
    expect(isPayableInApp(req({ purpose: 'instalment', instalmentId: 'inst-voided' }), facts)).toBe(false);
    expect(isPayableInApp(req({ purpose: 'instalment', instalmentId: 'inst-loose' }), facts)).toBe(false);
    expect(isPayableInApp(req({ purpose: 'instalment', instalmentId: 'inst-unknown' }), facts)).toBe(false);
    expect(isPayableInApp(req({ purpose: 'instalment' }), facts)).toBe(false);
    expect(isInstalmentPayableInApp({ lessonSubscriptionId: 'pkg-ok' }, facts)).toBe(true);
    expect(isInstalmentPayableInApp({ lessonSubscriptionId: 'pkg-void' }, facts)).toBe(false);
    expect(isInstalmentPayableInApp({ lessonSubscriptionId: null }, facts)).toBe(false);
  });

  it('a balance: only when it names a standing lesson package', () => {
    expect(isPayableInApp(req({ purpose: 'balance', lessonSubscriptionId: 'pkg-ok' }), facts)).toBe(true);
    expect(isPayableInApp(req({ purpose: 'balance', lessonSubscriptionId: 'pkg-void' }), facts)).toBe(false);
    expect(isPayableInApp(req({ purpose: 'balance' }), facts)).toBe(false);
  });

  it('describes a lesson payment as live one-to-one lessons, in the family\'s language, with the period', () => {
    expect(LIVE_ONE_TO_ONE_DESCRIPTION.en).toBe('Live one-to-one Quran lessons: one teacher and one student, in real time. Lessons are not recorded.');
    expect(LIVE_ONE_TO_ONE_DESCRIPTION.ar).toBe('دروس قرآن فردية مباشرة، تجمع بين معلّم واحد وطالب واحد عبر اتصال مباشر. لا يتم تسجيل الدروس.');
    const p = { periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-03-31') };
    expect(checkoutDescription(p, true, 'en')).toBe(`${LIVE_ONE_TO_ONE_DESCRIPTION.en} 2026-01-01 → 2026-03-31`);
    expect(checkoutDescription(p, true, 'ar')).toBe(`${LIVE_ONE_TO_ONE_DESCRIPTION.ar} 2026-01-01 → 2026-03-31`);
    expect(checkoutDescription({ periodStart: null, periodEnd: null }, true, 'en')).toBe(LIVE_ONE_TO_ONE_DESCRIPTION.en);
  });

  it('never calls an unverified payment a lesson (web pay link only): just the period, as before', () => {
    expect(checkoutDescription({ periodStart: null, periodEnd: null }, false, 'en')).toBeNull();
    expect(checkoutDescription({ periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31') }, false, 'ar')).toBe('2026-01-01 → 2026-01-31');
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
