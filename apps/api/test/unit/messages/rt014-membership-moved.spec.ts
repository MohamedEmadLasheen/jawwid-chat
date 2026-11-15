/**
 * RT-014: when a send's locked membership read differs from its pre-check, the
 * decision is taken again. This is the comparison that decides "differs".
 */
import { membershipMoved } from '@communication/messages/message.service';

const row = (id: string, actorId: string, memberRole = 'parent', isSilent = false) => ({ id, actorId, memberRole, isSilent });

describe('RT-014 · membershipMoved', () => {
  const me = row('m1', 'a1');
  const admin = row('m2', 'a2', 'admin');
  const teacher = row('m3', 'a3', 'teacher');

  it('the same rows, in any order: unchanged (the ordinary send re-decides nothing)', () => {
    expect(membershipMoved(me, { ...me }, [me, admin, teacher], [teacher, me, admin])).toBe(false);
  });

  it('the sender removed: moved', () => {
    expect(membershipMoved(me, null, [me, admin, teacher], [admin, teacher])).toBe(true);
  });

  it('the sender has no row before or after (staff by scope): only the live set decides', () => {
    expect(membershipMoved(null, null, [admin, teacher], [admin, teacher])).toBe(false);
    expect(membershipMoved(null, null, [admin, teacher], [teacher])).toBe(true);
  });

  it('the sender silenced, or their role changed: moved', () => {
    expect(membershipMoved(me, row('m1', 'a1', 'parent', true), [me], [row('m1', 'a1', 'parent', true)])).toBe(true);
    expect(membershipMoved(me, row('m1', 'a1', 'observer'), [me], [row('m1', 'a1', 'observer')])).toBe(true);
  });

  it('the sender left and was re-added (a new row): moved', () => {
    expect(membershipMoved(me, row('m9', 'a1'), [me, admin], [row('m9', 'a1'), admin])).toBe(true);
  });

  it('another member removed or added: moved', () => {
    expect(membershipMoved(me, me, [me, admin, teacher], [me, teacher])).toBe(true);
    expect(membershipMoved(me, me, [me, admin], [me, admin, teacher])).toBe(true);
  });

  it('a pre-check whose two reads disagreed (seat read live, set read without it) is moved', () => {
    expect(membershipMoved(me, null, [admin], [admin])).toBe(true);
  });
});
