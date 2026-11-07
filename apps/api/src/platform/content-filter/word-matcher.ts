import { matchTokens } from './normalise';

/**
 * LD-12 / MG-3: does a text hold a listed word or phrase? Whole words only: a
 * listed word inside a longer word is not a match, and a phrase matches only
 * as the same words in a row. Never a substring search.
 *
 * Answers yes or no and nothing else, on purpose: there is no way to ask it
 * WHICH word matched, so no caller can log or echo one.
 */
export class WordMatcher {
  private readonly words = new Set<string>();
  /** Multi-word phrases, by their first word. */
  private readonly phrases = new Map<string, string[][]>();

  constructor(terms: readonly string[]) {
    for (const term of terms) {
      const tokens = matchTokens(term);
      if (tokens.length === 0) continue;
      if (tokens.length === 1) {
        this.words.add(tokens[0]);
        continue;
      }
      const list = this.phrases.get(tokens[0]) ?? [];
      list.push(tokens);
      this.phrases.set(tokens[0], list);
    }
  }

  matches(text: string): boolean {
    if (this.words.size === 0 && this.phrases.size === 0) return false;
    const tokens = matchTokens(text);
    for (let i = 0; i < tokens.length; i++) {
      if (this.words.has(tokens[i])) return true;
      for (const phrase of this.phrases.get(tokens[i]) ?? []) {
        if (phrase.every((t, k) => tokens[i + k] === t)) return true;
      }
    }
    return false;
  }
}
