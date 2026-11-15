import { CommError, CommErrorCode } from '../../../src/platform/errors';
import { parseListCursor } from '../../../src/communication/messages/list-cursor';

/**
 * LR-38 (RT-017/RT-018): the message list's `before` / `after` cursors.
 *
 * Before this check a non-numeric cursor reached `BigInt(...)`, threw a
 * SyntaxError and came back as a 500; and a request with both silently let
 * `after` overwrite `before`. Both are now a 400 VALIDATION.
 */
const refusal = (before: unknown, after: unknown): CommError => {
  try {
    parseListCursor(before, after);
  } catch (error) {
    return error as CommError;
  }
  throw new Error(`expected before=${String(before)} after=${String(after)} to be refused`);
};

describe('LR-38: message list cursors', () => {
  it.each(['abc', '1.5', '-3', '1e3', ' 5', '5 ', '0x10', '05', '0', '1234567890123456789'])(
    'before=%p is a 400 VALIDATION, not a BigInt SyntaxError',
    (value) => {
      const error = refusal(value, undefined);
      expect(error).toBeInstanceOf(CommError);
      expect(error.code).toBe(CommErrorCode.VALIDATION);
      expect(error.status).toBe(400);
    },
  );

  it.each(['abc', '1.5', '-1', '01', '1234567890123456789'])('after=%p is a 400 VALIDATION', (value) => {
    const error = refusal(undefined, value);
    expect(error.code).toBe(CommErrorCode.VALIDATION);
    expect(error.status).toBe(400);
  });

  it('a repeated query parameter (an array) is a 400, not a coerced string', () => {
    expect(refusal(['1', '2'], undefined).status).toBe(400);
    expect(refusal(undefined, ['1', '2']).status).toBe(400);
  });

  it('before and after together are a 400; after no longer overwrites before', () => {
    const error = refusal('10', '3');
    expect(error.code).toBe(CommErrorCode.VALIDATION);
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/not both/);
  });

  it('a valid before is parsed to a bigint', () => {
    expect(parseListCursor('42', undefined)).toEqual({ before: 42n });
    expect(parseListCursor('123456789012345678', undefined)).toEqual({ before: 123456789012345678n });
  });

  it('a valid after is parsed, and after=0 stays valid (the mobile client sends seq - 1)', () => {
    expect(parseListCursor(undefined, '3')).toEqual({ after: 3n });
    expect(parseListCursor(undefined, '0')).toEqual({ after: 0n });
  });

  it('absent or empty cursors mean "no cursor", as before', () => {
    expect(parseListCursor(undefined, undefined)).toEqual({});
    expect(parseListCursor('', undefined)).toEqual({});
    expect(parseListCursor(undefined, '')).toEqual({});
    expect(parseListCursor('7', '')).toEqual({ before: 7n });
  });
});
