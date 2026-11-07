import { CommError, CommErrorCode } from '../../../src/platform/errors';
import type { AppConfigService } from '../../../src/platform/app-config.service';
import { COMMUNICATION_CONFIG_DEFAULTS } from '../../../src/platform/app-config.service';
import { ActorKind } from '../../../src/communication/contracts/vocab';
import {
  CONTENT_FILTER_ENABLED_KEY,
  ContentFilterService,
  type ContentFilterWordList,
} from '../../../src/platform/content-filter/content-filter.service';
import { DRAFT_WORD_LIST } from '../../../src/platform/content-filter/word-list';

/**
 * LD-12 / MG-3 (Apple 1.2): text a parent or a teacher posts is refused when it
 * holds a listed word, with one code and a message that never repeats the word.
 * A neutral list is injected; the draft list is not used here.
 */
const NEUTRAL: ContentFilterWordList = { ar: ['برتقالة'], en: ['pineapple', 'blue whale'] };

function configWith(value: unknown) {
  const get = jest.fn(async (key: string) =>
    key === CONTENT_FILTER_ENABLED_KEY ? value : (COMMUNICATION_CONFIG_DEFAULTS as Record<string, unknown>)[key],
  );
  return { config: { get } as unknown as AppConfigService, get };
}

async function refusal(p: Promise<unknown>): Promise<CommError | 'allowed'> {
  try {
    await p;
    return 'allowed';
  } catch (e) {
    if (e instanceof CommError) return e;
    throw e;
  }
}

describe('LD-12: the content filter service', () => {
  it('is on by default', () => {
    expect(COMMUNICATION_CONFIG_DEFAULTS[CONTENT_FILTER_ENABLED_KEY]).toBe(true);
  });

  it.each([ActorKind.CONTACT, ActorKind.TEACHER])('refuses a %s text holding a listed word, without naming it', async (kind) => {
    const { config } = configWith(true);
    const filter = new ContentFilterService(config, NEUTRAL);
    const e = await refusal(filter.assertAllowed(kind, 'we ate PINEAPPLE today'));
    expect(e).toBeInstanceOf(CommError);
    const err = e as CommError;
    expect(err.code).toBe(CommErrorCode.CONTENT_NOT_ALLOWED);
    expect(err.code).toBe('COMM.CONTENT_NOT_ALLOWED');
    expect(err.status).toBe(400);
    expect(err.message.toLowerCase()).not.toContain('pineapple');
    expect(JSON.stringify(err.detail ?? null).toLowerCase()).not.toContain('pineapple');
  });

  it('checks every text it is given, Arabic included, and skips empty ones', async () => {
    const filter = new ContentFilterService(configWith(true).config, NEUTRAL);
    expect(await refusal(filter.assertAllowed(ActorKind.CONTACT, null, undefined, '', 'fine', 'بُرتقالة'))).toBeInstanceOf(CommError);
    expect(await refusal(filter.assertAllowed(ActorKind.CONTACT, null, undefined, ''))).toBe('allowed');
  });

  it('lets clean text through without reading the switch', async () => {
    const { config, get } = configWith(true);
    const filter = new ContentFilterService(config, NEUTRAL);
    expect(await refusal(filter.assertAllowed(ActorKind.CONTACT, 'pineapples and a whale'))).toBe('allowed');
    expect(get).not.toHaveBeenCalled();
  });

  it('does not filter staff or the system', async () => {
    const filter = new ContentFilterService(configWith(true).config, NEUTRAL);
    expect(await refusal(filter.assertAllowed(ActorKind.STAFF, 'pineapple'))).toBe('allowed');
    expect(await refusal(filter.assertAllowed(ActorKind.SYSTEM, 'pineapple'))).toBe('allowed');
  });

  it('is turned off by the switch, and only by a boolean false', async () => {
    expect(await refusal(new ContentFilterService(configWith(false).config, NEUTRAL).assertAllowed(ActorKind.CONTACT, 'pineapple'))).toBe('allowed');
    for (const notOff of ['false', 0, null, undefined]) {
      expect(await refusal(new ContentFilterService(configWith(notOff).config, NEUTRAL).assertAllowed(ActorKind.CONTACT, 'pineapple'))).toBeInstanceOf(CommError);
    }
  });

  it('uses the draft list when none is injected, and the draft says it is a draft', async () => {
    expect(String(DRAFT_WORD_LIST.status)).toMatch(/^DRAFT/);
    expect(DRAFT_WORD_LIST.approvedBy).toBeNull();
    expect(DRAFT_WORD_LIST.ar.length).toBeGreaterThan(0);
    expect(DRAFT_WORD_LIST.en.length).toBeGreaterThan(0);
    const filter = new ContentFilterService(configWith(true).config);
    expect(await refusal(filter.assertAllowed(ActorKind.CONTACT, DRAFT_WORD_LIST.en[0]))).toBeInstanceOf(CommError);
    expect(await refusal(filter.assertAllowed(ActorKind.CONTACT, DRAFT_WORD_LIST.ar[0]))).toBeInstanceOf(CommError);
  });
});
