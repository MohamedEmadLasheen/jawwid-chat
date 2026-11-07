import { WordMatcher } from '../../../src/platform/content-filter/word-matcher';

/**
 * LD-12 / MG-3: whole words and whole phrases only, never a substring. The
 * list here is neutral and injected; the draft list is not used.
 */
const matcher = new WordMatcher(['pineapple', 'blue whale', 'برتقالة', 'قطة سوداء']);

describe('LD-12: matching listed words and phrases', () => {
  it('finds a listed word on its own, whatever its case', () => {
    expect(matcher.matches('I like pineapple')).toBe(true);
    expect(matcher.matches('PINEAPPLE!')).toBe(true);
    expect(matcher.matches('pineapple')).toBe(true);
  });

  it('never matches inside a longer word, or a part of a listed word', () => {
    expect(matcher.matches('pineapples are sweet')).toBe(false);
    expect(matcher.matches('an apple a day')).toBe(false);
    expect(matcher.matches('pine trees')).toBe(false);
    expect(matcher.matches('والبرتقالة')).toBe(false);
    expect(matcher.matches('برتقالات')).toBe(false);
  });

  it('matches a phrase only as consecutive whole words', () => {
    expect(matcher.matches('a blue whale swims')).toBe(true);
    expect(matcher.matches('blue \n  whale')).toBe(true);
    expect(matcher.matches('blue whales')).toBe(false);
    expect(matcher.matches('the whale is blue')).toBe(false);
    expect(matcher.matches('blue')).toBe(false);
  });

  it('sees through diacritics, tatweel, letter variants and stretched letters in Arabic', () => {
    expect(matcher.matches('أكلتُ بُرْتُقَالَةً')).toBe(true);
    expect(matcher.matches('برتقاله')).toBe(true);
    expect(matcher.matches('رأيت قطـة سوداااء')).toBe(true);
    expect(matcher.matches('قطه')).toBe(false);
  });

  it('sees through digit substitutions and stretched letters in English', () => {
    expect(matcher.matches('p1ne4pple')).toBe(true);
    expect(matcher.matches('piiiineappple')).toBe(true);
    expect(matcher.matches('bl00 whale')).toBe(false);
  });

  it('an empty list, or a list of blanks, matches nothing', () => {
    expect(new WordMatcher([]).matches('pineapple')).toBe(false);
    expect(new WordMatcher(['', '  ', '؟']).matches('anything at all')).toBe(false);
  });
});
