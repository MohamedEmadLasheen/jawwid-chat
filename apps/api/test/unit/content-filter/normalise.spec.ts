import { matchTokens } from '../../../src/platform/content-filter/normalise';

/**
 * LD-12 / MG-3 (Apple 1.2): text is normalised before it is compared, so a
 * vowel mark, a stretched letter or a digit standing for a letter does not
 * carry a listed word past the filter. These words are neutral; the filter's
 * own list is never used here.
 */
describe('LD-12: normalising text for the content filter', () => {
  it('strips Arabic diacritics, Quranic marks and tatweel', () => {
    expect(matchTokens('بُرْتُقَالَةٌ')).toEqual(['برتقاله']);
    expect(matchTokens('برتـــقالة')).toEqual(['برتقاله']);
    // Superscript alef and a small high mark, as the Uthmani text has them.
    expect(matchTokens('ٱلرَّحْمَٰنِ')).toEqual(['الرحمن']);
  });

  it('unifies alef, ya and ta marbuta variants', () => {
    expect(matchTokens('أحمد إسلام آمن ٱهدنا')).toEqual(['احمد', 'اسلام', 'امن', 'اهدنا']);
    expect(matchTokens('مستشفى کتابی')).toEqual(['مستشفي', 'کتابي']);
    expect(matchTokens('مدرسة')).toEqual(matchTokens('مدرسه'));
  });

  it('collapses repeated letters, in Arabic and in English', () => {
    expect(matchTokens('برااااافو')).toEqual(['برافو']);
    expect(matchTokens('Heeeello')).toEqual(['helo']);
  });

  it('case-folds English and reads common digit and symbol substitutions inside a word', () => {
    expect(matchTokens('PineApple')).toEqual(['pineaple']);
    expect(matchTokens('p1ne4pple')).toEqual(['pineaple']);
    expect(matchTokens('$p00n')).toEqual(['spon']);
    // A number on its own is not a word with substitutions in it.
    expect(matchTokens('call 1234 now')).toEqual(['cal', '1234', 'now']);
  });

  it('ignores invisible characters that would otherwise split a word', () => {
    expect(matchTokens('pine​apple')).toEqual(['pineaple']);
    expect(matchTokens('برت‌قالة')).toEqual(['برتقاله']);
  });

  it('splits on spaces and punctuation, and reads presentation forms as the letters they show', () => {
    expect(matchTokens('one, two!three\n«أربعة»')).toEqual(['one', 'two', 'thre', 'اربعه']);
    // U+FEFB is the lam-alef ligature.
    expect(matchTokens('ﻻ')).toEqual(['لا']);
  });
});
