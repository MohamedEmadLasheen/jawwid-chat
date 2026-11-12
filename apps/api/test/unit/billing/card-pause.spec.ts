/**
 * W63: the card kill switch's stored value. Absent or false: not paused.
 * Anything that is not a boolean FAILS SAFE to paused, and says so in the log:
 * card is a convenience (bank transfer remains), so a switch someone meant to
 * turn on must never read as off.
 */
import { Logger } from '@nestjs/common';
import { CARD_PAUSED_KEY, isCardPaused, parseCardPaused } from '../../../src/billing/card-pause';

describe('W63: billing.card_paused', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is the global chat.config key billing.card_paused', () => {
    expect(CARD_PAUSED_KEY).toBe('billing.card_paused');
  });

  it('absent or false: not paused; true: paused', () => {
    expect(parseCardPaused(null)).toEqual({ paused: false, malformed: false });
    expect(parseCardPaused(undefined)).toEqual({ paused: false, malformed: false });
    expect(parseCardPaused({ value: false })).toEqual({ paused: false, malformed: false });
    expect(parseCardPaused({ value: true })).toEqual({ paused: true, malformed: false });
  });

  it.each([['true'], ['false'], [1], [0], [null], [{ paused: false }], [[]]])('a malformed value (%j) fails safe to paused', (value) => {
    expect(parseCardPaused({ value })).toEqual({ paused: true, malformed: true });
  });

  it('reads the key now, and logs an error for a malformed value', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const findUnique = jest.fn();
    const db = { config: { findUnique } } as never;

    findUnique.mockResolvedValueOnce(null);
    expect(await isCardPaused(db)).toBe(false);
    findUnique.mockResolvedValueOnce({ key: CARD_PAUSED_KEY, value: true });
    expect(await isCardPaused(db)).toBe(true);
    expect(error).not.toHaveBeenCalled();

    findUnique.mockResolvedValueOnce({ key: CARD_PAUSED_KEY, value: 'no' });
    expect(await isCardPaused(db)).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]![0])).toContain('PAUSED');
    expect(findUnique).toHaveBeenCalledWith({ where: { key: CARD_PAUSED_KEY } });
  });
});
