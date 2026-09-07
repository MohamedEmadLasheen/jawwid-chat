import {
  assertUsablePattern,
  InvalidPatternError,
  scan,
  type ScanRule,
} from '@communication/moderation/content-scanner';
import { MatchType, ModerationCategory, ModerationSeverity } from '@communication/contracts/vocab';

/**
 * The moderation engine, exhaustively, with no database.
 *
 * Every rule here is CONSTRUCTED BY THE TEST rather than read from a seed. The
 * engine's contract is "apply the rules you are given"; which rules the academy
 * actually enables is a business decision and belongs in the integration suite,
 * where the real catalogue is loaded.
 */

const rule = (over: Partial<ScanRule> & Pick<ScanRule, 'pattern'>): ScanRule => ({
  id: over.id ?? 'rule-1',
  name: over.name ?? 'Test rule',
  category: over.category ?? ModerationCategory.CUSTOM,
  severity: over.severity ?? ModerationSeverity.MEDIUM,
  matchType: over.matchType ?? MatchType.REGEX,
  pattern: over.pattern,
});

/** The built-in catalogue, mirroring 20260907170000's enabled rows. */
const PHONE_INTL = rule({
  id: 'phone-intl',
  name: 'International phone number',
  category: ModerationCategory.PHONE_NUMBER,
  severity: ModerationSeverity.HIGH,
  pattern: '\\+\\d{8,15}',
});
const PHONE_EG = rule({
  id: 'phone-eg',
  name: 'Egyptian mobile number',
  category: ModerationCategory.PHONE_NUMBER,
  severity: ModerationSeverity.HIGH,
  pattern: '(?<!\\d)01[0125]\\d{8}(?!\\d)',
});
const PHONE_GULF = rule({
  id: 'phone-gulf',
  name: 'Gulf mobile number',
  category: ModerationCategory.PHONE_NUMBER,
  severity: ModerationSeverity.HIGH,
  pattern: '(?<!\\d)05\\d{8}(?!\\d)',
});
const EMAIL = rule({
  id: 'email',
  name: 'E-mail address',
  category: ModerationCategory.EMAIL_ADDRESS,
  severity: ModerationSeverity.HIGH,
  pattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
});
const URL = rule({
  id: 'url',
  name: 'Web link',
  category: ModerationCategory.URL,
  severity: ModerationSeverity.MEDIUM,
  pattern: '(?:https?://|www\\.)\\S{2,}',
});

const BUILTINS = [PHONE_INTL, PHONE_EG, PHONE_GULF, EMAIL, URL];

describe('content scanner', () => {
  // -----------------------------------------------------------------------
  // The case the whole design exists to serve
  // -----------------------------------------------------------------------
  describe('a safe message', () => {
    it('is safe, and says so with an empty result rather than a null one', () => {
      const result = scan('Assalamu alaikum, your child did very well today.', BUILTINS);
      expect(result.status).toBe('safe');
      expect(result.matches).toEqual([]);
      expect(result.highestSeverity).toBeNull();
      expect(result.errors).toEqual([]);
    });

    it('is safe in Arabic too', () => {
      const result = scan('السلام عليكم، ابنكم يوسف كان ممتازا اليوم في الحصة.', BUILTINS);
      expect(result.status).toBe('safe');
    });

    it('does not mistake ordinary numbers for a phone number', () => {
      // Surah and verse references, ages, times and prices are the false
      // positives that would make a teacher stop trusting the queue.
      for (const body of [
        'We finished surah 2, verses 30 to 45 today.',
        'The class is at 5 pm, and he is 9 years old.',
        'Attendance this month: 12 of 16 classes.',
      ]) {
        expect(scan(body, BUILTINS).status).toBe('safe');
      }
    });

    it('treats an empty or whitespace body as safe without running a rule', () => {
      expect(scan('', BUILTINS).status).toBe('safe');
      expect(scan('   \n  ', BUILTINS).status).toBe('safe');
      expect(scan(null, BUILTINS).status).toBe('safe');
    });
  });

  // -----------------------------------------------------------------------
  // Phone numbers -- the detection PRD BR-2 is actually about
  // -----------------------------------------------------------------------
  describe('phone numbers', () => {
    it('detects an international number', () => {
      const r = scan('call me on +201012345678', BUILTINS);
      expect(r.status).toBe('flagged');
      expect(r.reasons).toContain(ModerationCategory.PHONE_NUMBER);
      expect(r.highestSeverity).toBe('high');
    });

    it('detects an Egyptian mobile written locally', () => {
      const r = scan('رقمي 01012345678 كلمني', BUILTINS);
      expect(r.status).toBe('flagged');
      expect(r.matches.map((m) => m.ruleId)).toContain('phone-eg');
    });

    it('detects a Gulf mobile written locally', () => {
      expect(scan('واتساب 0512345678', BUILTINS).status).toBe('flagged');
    });

    it('detects a number written in Arabic-Indic digits', () => {
      // The normalisation that makes the detector real rather than decorative:
      // in an Arabic-first product this is how a number is usually typed.
      const r = scan('رقمي ٠١٠١٢٣٤٥٦٧٨', BUILTINS);
      expect(r.status).toBe('flagged');
      expect(r.matches.map((m) => m.ruleId)).toContain('phone-eg');
    });

    it('detects a number whose digits are spaced or dashed apart', () => {
      for (const body of [
        'my number is +20 10 1234 5678',
        'call 010 1234 5678',
        'reach me on 010-1234-5678',
        'number: 010 - 1234 - 5678',
      ]) {
        expect(scan(body, BUILTINS).status).toBe('flagged');
      }
    });

    it('quotes the number back from the ORIGINAL text, not the folded copy', () => {
      // If the excerpt came from the folded view the moderator would be shown
      // Latin digits for a message written in Arabic ones.
      const r = scan('رقمي ٠١٠١٢٣٤٥٦٧٨ للتواصل', BUILTINS);
      const hit = r.matches.find((m) => m.ruleId === 'phone-eg');
      expect(hit?.excerpt).toContain('٠١٠١٢٣٤٥٦٧٨');
    });
  });

  // -----------------------------------------------------------------------
  describe('e-mail addresses', () => {
    it('detects one', () => {
      const r = scan('email me at name@example.com', BUILTINS);
      expect(r.status).toBe('flagged');
      expect(r.reasons).toContain(ModerationCategory.EMAIL_ADDRESS);
    });

    it('does not flag an @ that is not an address', () => {
      expect(scan('see you @ 5 today', BUILTINS).status).toBe('safe');
    });
  });

  // -----------------------------------------------------------------------
  describe('URLs', () => {
    it('detects a link, at the configured severity rather than at "block"', () => {
      const r = scan('watch https://example.com/recitation', BUILTINS);
      expect(r.status).toBe('flagged');
      expect(r.highestSeverity).toBe('medium');
    });

    it('detects a bare www link', () => {
      expect(scan('go to www.example.com', BUILTINS).status).toBe('flagged');
    });

    it('is a RULE, so the academy can turn the URL policy off', () => {
      // The engine is handed the enabled rules; a disabled URL rule is simply
      // not in the set, and the same message is safe.
      const withoutUrl = BUILTINS.filter((r) => r.id !== 'url');
      expect(scan('watch https://example.com/x', withoutUrl).status).toBe('safe');
    });
  });

  // -----------------------------------------------------------------------
  // Policy categories -- rules the academy defines, never hardcoded here
  // -----------------------------------------------------------------------
  describe('forbidden words', () => {
    const forbidden = rule({
      id: 'w1',
      name: 'Competitor name',
      category: ModerationCategory.FORBIDDEN_WORD,
      severity: ModerationSeverity.LOW,
      matchType: MatchType.WORD,
      pattern: 'competitor',
    });

    it('detects the word', () => {
      const r = scan('try competitor instead', [forbidden]);
      expect(r.status).toBe('flagged');
      expect(r.matches[0].category).toBe(ModerationCategory.FORBIDDEN_WORD);
    });

    it('matches on word boundaries, so it does not fire inside another word', () => {
      expect(scan('the competitors are many', [forbidden]).status).toBe('safe');
    });

    it('applies Arabic word boundaries, which \\b cannot', () => {
      const arabic = rule({
        id: 'w2',
        name: 'Arabic token',
        category: ModerationCategory.FORBIDDEN_WORD,
        matchType: MatchType.WORD,
        pattern: 'مدرسة',
      });
      expect(scan('هذه مدرسة جيدة', [arabic]).status).toBe('flagged');
      // Prefixed with the definite article it is a different token, and a
      // \b-based boundary would have matched it anyway.
      expect(scan('المدرسةالكبيرة هنا', [arabic]).status).toBe('safe');
    });

    it('ignores harakat and orthographic variation', () => {
      const withAlef = rule({
        id: 'w3',
        name: 'Alef variant',
        category: ModerationCategory.FORBIDDEN_WORD,
        matchType: MatchType.WORD,
        pattern: 'احمد',
      });
      // Written with hamza, and with a fatha, and both are the same word.
      expect(scan('أحمد هنا', [withAlef]).status).toBe('flagged');
      expect(scan('اَحمد هنا', [withAlef]).status).toBe('flagged');
    });
  });

  describe('forbidden phrases', () => {
    const phrase = rule({
      id: 'p1',
      name: 'Off-platform request',
      category: ModerationCategory.FORBIDDEN_PHRASE,
      severity: ModerationSeverity.HIGH,
      matchType: MatchType.PHRASE,
      pattern: 'contact me directly',
    });

    it('detects a multi-word phrase', () => {
      expect(scan('please contact me directly about this', [phrase]).status).toBe('flagged');
    });

    it('tolerates however the sender spaced it, including a line break', () => {
      expect(scan('please contact  me\ndirectly', [phrase]).status).toBe('flagged');
    });

    it('does not match the words apart', () => {
      expect(scan('contact the office and me, directly or not', [phrase]).status).toBe('safe');
    });
  });

  describe('cancellation and resignation', () => {
    const cancellation = rule({
      id: 'c1',
      name: 'Cancellation intent (Arabic)',
      category: ModerationCategory.CANCELLATION,
      severity: ModerationSeverity.CRITICAL,
      matchType: MatchType.PHRASE,
      pattern: 'الغاء الاشتراك',
    });
    const resignation = rule({
      id: 'r1',
      name: 'Resignation intent (English)',
      category: ModerationCategory.RESIGNATION,
      severity: ModerationSeverity.CRITICAL,
      matchType: MatchType.PHRASE,
      pattern: 'my resignation',
    });

    it('detects a cancellation phrase, and says which category it was', () => {
      const r = scan('اريد الغاء الاشتراك من فضلك', [cancellation]);
      expect(r.status).toBe('flagged');
      expect(r.reasons).toEqual([ModerationCategory.CANCELLATION]);
      expect(r.highestSeverity).toBe('critical');
    });

    it('detects it written with the hamza the pattern omits', () => {
      expect(scan('أريد إلغاء الاشتراك', [cancellation]).status).toBe('flagged');
    });

    it('detects a resignation phrase', () => {
      const r = scan('Please accept my resignation from the academy.', [resignation]);
      expect(r.status).toBe('flagged');
      expect(r.reasons).toEqual([ModerationCategory.RESIGNATION]);
    });
  });

  describe('custom rules', () => {
    it('applies a rule an administrator invented, in a category of its own', () => {
      const custom = rule({
        id: 'x1',
        name: 'Refund promise',
        category: ModerationCategory.CUSTOM,
        severity: ModerationSeverity.HIGH,
        matchType: MatchType.REGEX,
        pattern: 'refund (you|your money)',
      });
      const r = scan('I will refund your money tomorrow', [custom]);
      expect(r.status).toBe('flagged');
      expect(r.matches[0].ruleName).toBe('Refund promise');
    });
  });

  // -----------------------------------------------------------------------
  describe('a disabled rule', () => {
    it('never triggers, because a disabled rule is never in the set', () => {
      // The engine's contract: it applies what it is handed. Enablement is
      // ModerationRuleService's job and is asserted in the integration suite.
      expect(scan('call +201012345678', []).status).toBe('safe');
    });
  });

  // -----------------------------------------------------------------------
  describe('multiple matches', () => {
    it('returns every match, not the first', () => {
      const cancellation = rule({
        id: 'c1',
        name: 'Cancellation intent (English)',
        category: ModerationCategory.CANCELLATION,
        severity: ModerationSeverity.CRITICAL,
        matchType: MatchType.PHRASE,
        pattern: 'cancel my subscription',
      });
      const r = scan(
        'I want to cancel my subscription, call me on +201012345678 or name@example.com',
        [...BUILTINS, cancellation],
      );
      expect(r.status).toBe('flagged');
      expect(r.reasons).toEqual(
        expect.arrayContaining([
          ModerationCategory.PHONE_NUMBER,
          ModerationCategory.EMAIL_ADDRESS,
          ModerationCategory.CANCELLATION,
        ]),
      );
      expect(r.matches.length).toBeGreaterThanOrEqual(3);
    });

    it('reports the HIGHEST severity, not the first or the last', () => {
      const low = rule({ id: 'a', pattern: 'alpha', severity: ModerationSeverity.LOW });
      const critical = rule({ id: 'b', pattern: 'beta', severity: ModerationSeverity.CRITICAL });
      const medium = rule({ id: 'c', pattern: 'gamma', severity: ModerationSeverity.MEDIUM });
      const r = scan('alpha beta gamma', [low, critical, medium]);
      expect(r.matches).toHaveLength(3);
      expect(r.highestSeverity).toBe('critical');
    });

    it('orders severity low < medium < high < critical', () => {
      const pairs: Array<[string, string, string]> = [
        ['low', 'medium', 'medium'],
        ['medium', 'high', 'high'],
        ['high', 'critical', 'critical'],
      ];
      for (const [a, b, expected] of pairs) {
        const r = scan('alpha beta', [
          rule({ id: 'a', pattern: 'alpha', severity: a }),
          rule({ id: 'b', pattern: 'beta', severity: b }),
        ]);
        expect(r.highestSeverity).toBe(expected);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Failure, and the direction it fails in
  // -----------------------------------------------------------------------
  describe('a rule that cannot be evaluated', () => {
    it('fails CLOSED -- flagged, never safe', () => {
      // Only reachable by a direct database write: the service refuses to
      // store a pattern that will not compile. The engine must still be
      // correct when it happens.
      const broken = rule({ id: 'bad', name: 'Broken', pattern: '([unclosed' });
      const r = scan('an entirely ordinary message', [broken]);
      expect(r.status).toBe('flagged');
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].ruleId).toBe('bad');
      expect(r.highestSeverity).toBe('critical');
    });

    it('does not stop the other rules from running', () => {
      const broken = rule({ id: 'bad', name: 'Broken', pattern: '([unclosed' });
      const r = scan('call +201012345678', [broken, ...BUILTINS]);
      expect(r.matches.map((m) => m.ruleId)).toContain('phone-intl');
      expect(r.errors).toHaveLength(1);
    });

    it('fails closed when the scan exceeds its time budget', () => {
      let t = 0;
      // A clock that jumps past the budget after the first rule.
      const r = scan('anything', [rule({ id: 'a', pattern: 'zzz' }), rule({ id: 'b', pattern: 'zzz' })], {
        budgetMs: 10,
        now: () => (t += 100),
      });
      expect(r.status).toBe('flagged');
      expect(r.errors[0].reason).toMatch(/budget/);
    });

    it('fails closed rather than scanning part of an oversized body', () => {
      const r = scan('x'.repeat(5000), BUILTINS, { maxLength: 4000 });
      expect(r.status).toBe('flagged');
      expect(r.errors[0].reason).toMatch(/exceeds/);
    });
  });

  // -----------------------------------------------------------------------
  describe('excerpts', () => {
    it('never exceed the column the database will store them in', () => {
      const long = rule({ id: 'l', pattern: 'x{100,}' });
      const r = scan(`${'y'.repeat(50)}${'x'.repeat(400)}${'y'.repeat(50)}`, [long]);
      expect(r.matches[0].excerpt!.length).toBeLessThanOrEqual(200);
    });
  });
});

// ---------------------------------------------------------------------------
describe('pattern validation', () => {
  const MAX = 512;

  it('accepts every built-in pattern', () => {
    for (const r of BUILTINS) {
      expect(() => assertUsablePattern(r.matchType, r.pattern, MAX)).not.toThrow();
    }
  });

  it('refuses an empty pattern, which would match every message', () => {
    expect(() => assertUsablePattern(MatchType.REGEX, '   ', MAX)).toThrow(InvalidPatternError);
  });

  it('refuses a pattern that will not compile', () => {
    expect(() => assertUsablePattern(MatchType.REGEX, '([unclosed', MAX)).toThrow(
      InvalidPatternError,
    );
  });

  it('refuses a pattern longer than the database will accept', () => {
    expect(() => assertUsablePattern(MatchType.REGEX, 'a'.repeat(MAX + 1), MAX)).toThrow(
      InvalidPatternError,
    );
  });

  it('refuses nested quantifiers, the shape that backtracks catastrophically', () => {
    for (const evil of ['(a+)+$', '(a*)*b', '(x|x)*y', '(\\d{1,10})+z']) {
      expect(() => assertUsablePattern(MatchType.REGEX, evil, MAX)).toThrow(InvalidPatternError);
    }
  });

  it('refuses a word rule that is not one word', () => {
    expect(() => assertUsablePattern(MatchType.WORD, 'two words', MAX)).toThrow(
      InvalidPatternError,
    );
  });

  it('refuses an unknown match type', () => {
    expect(() => assertUsablePattern('semantic', 'anything', MAX)).toThrow(InvalidPatternError);
  });

  it('accepts an ordinary word, phrase and regex', () => {
    expect(() => assertUsablePattern(MatchType.WORD, 'competitor', MAX)).not.toThrow();
    expect(() => assertUsablePattern(MatchType.PHRASE, 'contact me directly', MAX)).not.toThrow();
    expect(() => assertUsablePattern(MatchType.REGEX, 'refund (you|your money)', MAX)).not.toThrow();
  });
});
