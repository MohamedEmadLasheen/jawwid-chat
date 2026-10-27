/**
 * PD-34 amendment (owner, 2026-10-27): the chat push policy's pure parts --
 * quiet-hours boundaries and daylight saving, the rolling-hour cap, and the
 * held (summary) push's bookkeeping.
 */
import {
  capFreesAt,
  deferForQuiet,
  heldAdd,
  heldCount,
  heldKeep,
  heldRead,
  heldTemplate,
  type QuietWindow,
} from '../../../src/communication/notifications/chat-push-policy';

const utc: QuietWindow = { enabled: true, startMinute: 22 * 60, endMinute: 8 * 60, zone: 'UTC' };
const iso = (d: Date) => d.toISOString();

describe('quiet hours 22:00-08:00 in the recipient zone', () => {
  it('21:59 goes now; 22:00 waits for 08:00; 07:59 waits for 08:00; 08:00 goes now', () => {
    expect(iso(deferForQuiet(new Date('2030-01-10T21:59:00Z'), utc))).toBe('2030-01-10T21:59:00.000Z');
    expect(iso(deferForQuiet(new Date('2030-01-10T22:00:00Z'), utc))).toBe('2030-01-11T08:00:00.000Z');
    expect(iso(deferForQuiet(new Date('2030-01-11T07:59:00Z'), utc))).toBe('2030-01-11T08:00:00.000Z');
    expect(iso(deferForQuiet(new Date('2030-01-11T08:00:00Z'), utc))).toBe('2030-01-11T08:00:00.000Z');
  });

  it('in the recipient zone, not the server\'s', () => {
    const dubai: QuietWindow = { ...utc, zone: 'Asia/Dubai' }; // UTC+4
    // 19:00Z is 23:00 in Dubai: held until 08:00 Dubai = 04:00Z.
    expect(iso(deferForQuiet(new Date('2030-01-10T19:00:00Z'), dubai))).toBe('2030-01-11T04:00:00.000Z');
  });

  it('a night the clocks go back (Cairo, end of Egyptian DST 2026) still ends at 08:00 local', () => {
    const cairo: QuietWindow = { ...utc, zone: 'Africa/Cairo' };
    // 23:30 Cairo on 29 Oct 2026 is still UTC+3 (20:30Z); 08:00 on 30 Oct is UTC+2 = 06:00Z.
    const end = deferForQuiet(new Date('2026-10-29T20:30:00Z'), cairo);
    expect(iso(end)).toBe('2026-10-30T06:00:00.000Z');
  });

  it('a night the clocks go forward (London, March) still ends at 08:00 local', () => {
    const london: QuietWindow = { ...utc, zone: 'Europe/London' };
    // 23:00 GMT on 28 Mar 2026; 08:00 BST on 29 Mar = 07:00Z.
    expect(iso(deferForQuiet(new Date('2026-03-28T23:00:00Z'), london))).toBe('2026-03-29T07:00:00.000Z');
  });

  it('a person who turned quiet hours off, or has none, is not held', () => {
    const at = new Date('2030-01-10T23:00:00Z');
    expect(deferForQuiet(at, { ...utc, enabled: false })).toBe(at);
    expect(deferForQuiet(at, undefined)).toBe(at);
  });
});

describe('the rolling-hour cap of 6', () => {
  const at = new Date('2030-01-10T12:00:00Z');
  const ago = (min: number) => new Date(at.getTime() - min * 60_000);

  it('the 6th push still goes (5 in the hour); the 7th waits until the oldest ages out', () => {
    expect(capFreesAt(at, [ago(50), ago(40), ago(30), ago(20), ago(10)], 6)).toBeNull();
    expect(iso(capFreesAt(at, [ago(50), ago(40), ago(30), ago(20), ago(10), ago(5)], 6)!)).toBe('2030-01-10T12:10:00.000Z');
  });

  it('pushes older than an hour do not count', () => {
    expect(capFreesAt(at, [ago(61), ago(70), ago(40), ago(30), ago(20), ago(10)], 6)).toBeNull();
  });

  it('over the cap (a race let one more through), it waits for enough to age out', () => {
    const times = [ago(55), ago(50), ago(40), ago(30), ago(20), ago(10), ago(5)];
    // Two must age out: the second-oldest (50 min ago) leaves the hour at 12:10.
    expect(iso(capFreesAt(at, times, 6)!)).toBe('2030-01-10T12:10:00.000Z');
  });

  it('cap 0 means no cap', () => {
    expect(capFreesAt(at, Array.from({ length: 20 }, (_, i) => ago(i)), 0)).toBeNull();
  });
});

describe('the held (summary) push', () => {
  it('counts every message, per chat; lastSeq only moves up', () => {
    let h = heldAdd({}, 'a', '5');
    h = heldAdd(h, 'a', '3');
    h = heldAdd(h, 'b', '1');
    expect(h).toEqual({ a: { s: '5', n: 2 }, b: { s: '1', n: 1 } });
    expect(heldCount(h)).toBe(3);
    expect(heldTemplate(h)).toBe('new_messages_summary');
    expect(heldTemplate(heldAdd({}, 'a', '1'))).toBe('new_message');
  });

  it('a read takes out what it covers, and only that', () => {
    const h = heldAdd(heldAdd({}, 'a', '5'), 'b', '2');
    expect(heldRead(h, 'a', BigInt(4))).toEqual(h); // a message after the read keeps chat a in
    expect(heldRead(h, 'a', BigInt(5))).toEqual({ b: { s: '2', n: 1 } });
    expect(heldRead(h, 'c', BigInt(9))).toEqual(h);
  });

  it('a chat the person may no longer hear is taken out', () => {
    const h = heldAdd(heldAdd({}, 'a', '1'), 'b', '1');
    expect(heldKeep(h, (id) => id === 'b')).toEqual({ b: { s: '1', n: 1 } });
  });
});
