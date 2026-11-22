import { previewOf, reportOf, type SourceRow } from '../../../src/staff-accounts/access-report';

const row = (key: string, source: SourceRow['source'], role?: string): SourceRow => ({
  permission_key: key, source, role_id: role ?? null, role_key: role ? `k-${role}` : null, name_en: role ? `Role ${role}` : null, name_ar: null,
  granted_by: role ? 'g1' : null, granted_by_name: role ? 'Granter' : null, granted_at: role ? '2026-11-01T10:00:00Z' : null, reason: role ? 'why' : null,
});

describe('access report (M1)', () => {
  it('groups keys by catalogue page and lists every source of a key', () => {
    const pages = reportOf([row('materials.view', 'tier_default'), row('materials.view', 'role', 'r1'), row('certificates.view', 'role', 'r2')]);
    expect(pages.map((p) => p.page)).toEqual(['certificates', 'materials']);
    const view = pages.find((p) => p.page === 'materials')!.keys[0]!;
    expect(view.sources.map((s) => s.type)).toEqual(['tier_default', 'role']);
    expect(view.sources[1]).toMatchObject({ roleId: 'r1', grantedBy: { id: 'g1', name: 'Granter' }, reason: 'why', grantedAt: '2026-11-01T10:00:00.000Z' });
  });

  it('shows a key the catalogue does not know as itself instead of dropping it', () => {
    const pages = reportOf([row('future.thing', 'role', 'r1')]);
    expect(pages[0]!.keys[0]).toMatchObject({ key: 'future.thing', label: { en: 'future.thing' } });
  });

  it('a removed role takes away only what no other source still gives', () => {
    const rows = [row('materials.view', 'tier_default'), row('materials.view', 'role', 'r1'), row('certificates.view', 'role', 'r1'), row('certificates.design', 'role', 'r2')];
    expect(previewOf(rows, { add: [], remove: ['r1'] })).toEqual({ gained: [], lost: ['certificates.view'], pagesGained: [], pagesLost: [] });
    expect(previewOf(rows, { add: [], remove: ['r1', 'r2'] })).toMatchObject({ lost: ['certificates.design', 'certificates.view'], pagesLost: ['certificates'] });
  });

  it('an added role gains only what the person lacks; a page counts once it has any key', () => {
    const rows = [row('materials.view', 'tier_default')];
    expect(previewOf(rows, { add: [{ roleId: 'r9', keys: ['materials.view', 'materials.author', 'certificates.view'] }], remove: [] })).toEqual({
      gained: ['certificates.view', 'materials.author'], lost: [], pagesGained: ['certificates'], pagesLost: [],
    });
  });

  it('super admin rows are one source per key and nothing is removable by a role change', () => {
    const rows = [row('materials.manage', 'super_admin'), row('certificates.types', 'super_admin')];
    expect(previewOf(rows, { add: [], remove: ['anything'] }).lost).toEqual([]);
  });
});
