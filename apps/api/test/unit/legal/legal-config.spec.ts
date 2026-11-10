/**
 * PD-58 §7.3 / §7.6 test 9: production refuses to start without the owner's
 * Terms of Use configuration (unit test on the config validator), and the
 * code carries document KEYS only -- no version, no URL, no legal wording.
 *
 * The version names here are synthetic fixtures, never the owner's.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertLegalConfiguration,
  isProduction,
  legalConfigurationProblems,
  type LegalConfigState,
} from '../../../src/legal/legal-config';
import {
  LEGAL_DOCUMENT_KEYS,
  documentsFor,
  isLegalClient,
  isLegalLocale,
  type LegalDocumentKey,
} from '../../../src/legal/legal-documents';

const PROD = { APP_ENV: 'production' } as NodeJS.ProcessEnv;
const STAGING = { APP_ENV: 'staging' } as NodeJS.ProcessEnv;

const good = (key: LegalDocumentKey): LegalConfigState => ({ documentKey: key, configured: true, version: 'qa-fixture-v1', published: true });
const all = () => LEGAL_DOCUMENT_KEYS.map(good);
const without = (key: LegalDocumentKey, state: Partial<LegalConfigState>) =>
  all().map((s) => (s.documentKey === key ? { ...s, ...state } : s));

describe('PD-58: the production configuration check (fail closed)', () => {
  it('passes when all four documents name a published version', () => {
    expect(legalConfigurationProblems(all())).toEqual([]);
    expect(assertLegalConfiguration(all(), PROD)).toEqual([]);
  });

  it.each(LEGAL_DOCUMENT_KEYS)('production refuses to start when legal.current.%s is missing', (key) => {
    const states = without(key, { configured: false, version: null, published: false });
    expect(() => assertLegalConfiguration(states, PROD)).toThrow(`legal.current.${key} is missing`);
  });

  it('production refuses when no row exists at all (an empty answer is not "no terms required")', () => {
    expect(() => assertLegalConfiguration([], PROD)).toThrow(/production refuses to start/);
    expect(legalConfigurationProblems([])).toHaveLength(4);
  });

  it('production refuses a row that names a version never published', () => {
    expect(() => assertLegalConfiguration(without('code_of_conduct', { published: false }), PROD)).toThrow(
      'legal.current.code_of_conduct names a version that was never published',
    );
  });

  it('production refuses a row that is not a version name (a JSON string)', () => {
    expect(() => assertLegalConfiguration(without('terms_staff', { version: null, published: false }), PROD)).toThrow(
      'legal.current.terms_staff is not a version name',
    );
  });

  it('outside production the same problems are returned as warnings and the boot goes on', () => {
    expect(assertLegalConfiguration([], STAGING)).toHaveLength(4);
    expect(assertLegalConfiguration([], {} as NodeJS.ProcessEnv)).toHaveLength(4);
  });

  it('production is APP_ENV=production exactly (the Stripe guard\'s test), never NODE_ENV', () => {
    expect(isProduction(PROD)).toBe(true);
    expect(isProduction({ APP_ENV: ' production ' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isProduction({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isProduction(STAGING)).toBe(false);
  });
});

describe('PD-58: each account kind accepts its own terms plus the Code of Conduct (A-3)', () => {
  it('maps the three kinds', () => {
    expect(documentsFor('family')).toEqual(['terms_family', 'code_of_conduct']);
    expect(documentsFor('teacher')).toEqual(['terms_teacher', 'code_of_conduct']);
    expect(documentsFor('staff')).toEqual(['terms_staff', 'code_of_conduct']);
  });

  it('checks the client and the locale exactly as the database does', () => {
    for (const c of ['android', 'ios', 'web_portal', 'admin_web']) expect(isLegalClient(c)).toBe(true);
    for (const c of ['web', 'app', '', null, 1]) expect(isLegalClient(c)).toBe(false);
    for (const l of ['ar', 'en', 'ar-EG']) expect(isLegalLocale(l)).toBe(true);
    for (const l of ['AR', 'arabic-language-tag-far-too-long-for-it', '', 'e', null]) expect(isLegalLocale(l)).toBe(false);
  });
});

describe('PD-58 (N-3): no legal text, version or URL in the code', () => {
  const SRC = join(__dirname, '..', '..', '..', 'src', 'legal');
  const files = readdirSync(SRC).filter((f) => statSync(join(SRC, f)).isFile());

  it('the legal module holds no https URL and no version literal', () => {
    for (const f of files) {
      const text = readFileSync(join(SRC, f), 'utf8');
      expect({ f, urls: text.match(/https:\/\/[^\s'"`]+/g) ?? [] }).toEqual({ f, urls: [] });
      // A version would be assigned to `version:` as a literal; none is.
      expect({ f, versions: text.match(/version:\s*['"`][^'"`]+['"`]/g) ?? [] }).toEqual({ f, versions: [] });
    }
  });

  it('no file in the API ships a legal_document_version row or a legal.current value', () => {
    const API = join(__dirname, '..', '..', '..', 'src');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
      });
    for (const p of walk(API)) {
      const text = readFileSync(p, 'utf8');
      expect({ p, insert: /insert\s+into\s+chat\.legal_document_version/i.test(text) }).toEqual({ p, insert: false });
      expect({ p, publish: /publish_legal_version\s*\(\s*'/.test(text) }).toEqual({ p, publish: false });
      expect({ p, config: /'legal\.current\.[a-z_]+'\s*,\s*'"/.test(text) }).toEqual({ p, config: false });
    }
  });
});
