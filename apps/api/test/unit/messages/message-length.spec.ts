import { MESSAGE_MAX_CHARACTERS, MESSAGE_MAX_CODE_UNITS, messageLength, messageTooLong } from '../../../src/communication/messages/message-length';

/**
 * PARENT-003: a body is counted as a person sees it (grapheme clusters) -- as
 * the mobile composer's TextField maxLength counts it -- so the server never
 * refuses what the app let through.
 */
describe('PARENT-003: how long a message is', () => {
  it('the limit is 4000 characters, as the mobile composer\'s', () => {
    expect(MESSAGE_MAX_CHARACTERS).toBe(4000);
  });

  it('counts letters, an emoji family, a flag and a vowelled Arabic letter each as one', () => {
    expect(messageLength('abc')).toBe(3);
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
    const flag = '\u{1F1EA}\u{1F1EC}';
    const vowelled = 'بَّ'; // ba with fatha and shadda
    const long = (unit: string, n: number) => unit.repeat(n);
    expect(messageLength(long(family, 4001))).toBe(4001);
    expect(messageLength(long(flag, 4001))).toBe(4001);
    expect(messageLength(long(vowelled, 4001))).toBe(4001);
  });

  it('4000 characters pass, 4001 do not -- however many code units an emoji takes', () => {
    expect(messageTooLong('x'.repeat(4000))).toBe(false);
    expect(messageTooLong('x'.repeat(4001))).toBe(true);
    const heart = '❤️'; // two code units, one character
    expect(messageTooLong(heart.repeat(4000))).toBe(false);
    expect(messageTooLong(heart.repeat(4001))).toBe(true);
  });

  it('a few "characters" stacked with thousands of combining marks are refused by size', () => {
    const zalgo = 'a' + '́'.repeat(MESSAGE_MAX_CODE_UNITS);
    expect(messageLength(zalgo)).toBe(1);
    expect(messageTooLong(zalgo)).toBe(true);
  });
});
