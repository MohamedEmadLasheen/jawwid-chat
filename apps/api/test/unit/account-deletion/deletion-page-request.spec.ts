import { deadlineDate, renderDeletionPage } from '../../../src/account-deletion/account-deletion-page';

/**
 * PD-56 O-3: the public deletion page, for a teacher with work open: a request
 * is recorded and the page says by when the account is deleted -- never
 * "contact the academy". A fixed instant (AGENTS.md: no today + N).
 */
describe('the deletion page: a teacher\'s request', () => {
  const at = '2026-12-07T13:45:00.000Z';

  it('says the request is recorded and names the deadline day, in English and Arabic', () => {
    const en = renderDeletionPage('en', { kind: 'requested', deadlineAt: at }, 'n', 't');
    expect(deadlineDate('en', at)).toBe('7 December 2026');
    expect(en).toContain('Your deletion request is recorded');
    expect(en).toContain('by 7 December 2026 at the latest');
    expect(en).not.toMatch(/contact the academy/i);
    expect(en).not.toContain('<form');

    const ar = renderDeletionPage('ar', { kind: 'requested', deadlineAt: at }, 'n', 't');
    expect(ar).toContain('سُجّل طلب حذف حسابك');
    expect(ar).toContain(deadlineDate('ar', at));
    expect(ar).toContain('dir="rtl"');
  });

  it('the form no longer has a "contact the academy" refusal', () => {
    const html = renderDeletionPage('en', { kind: 'form' }, 'n', 't');
    expect(html).not.toMatch(/contact the academy/i);
  });
});
