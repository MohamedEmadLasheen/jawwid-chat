import { Inject, Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '../app-config.service';
import { CommError, CommErrorCode } from '../errors';
import { ActorKind } from '../../communication/contracts/vocab';
import { WordMatcher } from './word-matcher';
import { DRAFT_WORD_LIST } from './word-list';

/**
 * LD-12 / MG-3 (Apple guideline 1.2): the pre-posting filter for text that a
 * parent or a teacher writes for other people to read -- a chat message, a
 * caption or an edit; parent feedback; a name or a profile text.
 *
 * A match refuses the write with COMM.CONTENT_NOT_ALLOWED (400) before
 * anything is stored. The refusal never names the word, and nothing here logs
 * it: the matcher can only answer yes or no.
 *
 * Staff and the system are not filtered. Staff write under the academy's own
 * rules, and a moderator must be able to quote what was reported in an
 * internal note.
 *
 * `moderation.content_filter.enabled` in chat.config turns it off without a
 * deploy, should the list refuse ordinary text. Only a boolean false turns it
 * off; anything else (no row, a malformed value) leaves it on.
 */
export const CONTENT_FILTER_ENABLED_KEY = 'moderation.content_filter.enabled';

/** Injection token for the list; tests provide a neutral one. */
export const CONTENT_FILTER_WORD_LIST = Symbol('CONTENT_FILTER_WORD_LIST');

export interface ContentFilterWordList {
  ar: readonly string[];
  en: readonly string[];
}

const FILTERED_KINDS: ReadonlySet<string> = new Set([ActorKind.CONTACT, ActorKind.TEACHER]);

@Injectable()
export class ContentFilterService {
  private readonly matcher: WordMatcher;

  constructor(
    private readonly config: AppConfigService,
    @Optional() @Inject(CONTENT_FILTER_WORD_LIST) words: ContentFilterWordList = DRAFT_WORD_LIST,
  ) {
    this.matcher = new WordMatcher([...words.ar, ...words.en]);
  }

  /** Throws COMM.CONTENT_NOT_ALLOWED when any of `texts` holds a listed word. */
  async assertAllowed(authorKind: string, ...texts: Array<string | null | undefined>): Promise<void> {
    if (!FILTERED_KINDS.has(authorKind)) return;
    const hit = texts.some((t) => typeof t === 'string' && t.length > 0 && this.matcher.matches(t));
    if (!hit) return;
    // Read only on a match: a clean send costs no lookup.
    if ((await this.config.get(CONTENT_FILTER_ENABLED_KEY)) === false) return;
    throw new CommError(
      CommErrorCode.CONTENT_NOT_ALLOWED,
      'this text contains wording that is not allowed here; please rephrase it',
      400,
    );
  }
}
