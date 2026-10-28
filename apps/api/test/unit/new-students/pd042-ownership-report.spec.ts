/**
 * PD-42 S3 / D2 -- the verification report the Operations manager and the
 * Sales manager sign off before the Sales switch goes to 'own': every family
 * has an Operations supervisor (all its children placed) or a Sales owner.
 * The summary is pure; the query is proven in pd042-ops-side-api.spec.ts.
 */
import { parseReportArgs, summariseOwnership, type FamilyOwnershipRow } from '../../../src/new-students/ownership-report';

const row = (over: Partial<FamilyOwnershipRow>): FamilyOwnershipRow => ({
  familyId: 'f', organizationId: 'o', children: 1, supervised: 1, supervisorIds: ['s1'], salesOwnerId: null, ...over,
});

describe('summariseOwnership', () => {
  it('counts each family once: supervised; Sales-owned only; neither (listed)', () => {
    const r = summariseOwnership([
      row({ familyId: 'a', supervisorIds: ['s1'], salesOwnerId: 'x1' }),
      row({ familyId: 'b', supervisorIds: ['s1'] }),
      row({ familyId: 'c', supervised: 0, supervisorIds: [], salesOwnerId: 'x1' }),
      row({ familyId: 'd', supervised: 0, supervisorIds: [], salesOwnerId: null }),
      row({ familyId: 'e', children: 0, supervised: 0, supervisorIds: [], salesOwnerId: null }),
    ]);
    expect(r).toMatchObject({ families: 5, withOperationsSupervisor: 2, salesOwnedOnly: 1, ok: false });
    expect(r.unowned).toEqual([
      { familyId: 'd', organizationId: 'o', children: 1 },
      { familyId: 'e', organizationId: 'o', children: 0 },
    ]);
    expect(r.operationsSupervisors).toEqual([{ staffId: 's1', families: 2, children: 2 }]);
    expect(r.salesOwners).toEqual([{ staffId: 'x1', families: 2 }]);
  });

  it('a family with some children unplaced is listed as partly supervised, and still waits (not ok)', () => {
    const r = summariseOwnership([row({ familyId: 'p', children: 2, supervised: 1, supervisorIds: ['s1'] })]);
    expect(r.partlySupervised).toEqual([{ familyId: 'p', organizationId: 'o', children: 2, supervised: 1 }]);
    expect(r.withOperationsSupervisor).toBe(0);
    expect(r.unowned.map((u) => u.familyId)).toEqual(['p']);
    expect(r.ok).toBe(false);
  });

  it('partly supervised but Sales-owned is owned', () => {
    const r = summariseOwnership([row({ familyId: 'p', children: 2, supervised: 1, supervisorIds: ['s1'], salesOwnerId: 'x1' })]);
    expect(r).toMatchObject({ ok: true, salesOwnedOnly: 1, unowned: [] });
    expect(r.partlySupervised.map((x) => x.familyId)).toEqual(['p']);
  });

  it('nothing to report is ok', () => {
    expect(summariseOwnership([])).toMatchObject({ families: 0, ok: true, unowned: [] });
  });
});

describe('parseReportArgs', () => {
  it('JSON by default; --text for people', () => {
    expect(parseReportArgs([])).toEqual({ format: 'json' });
    expect(parseReportArgs(['--text'])).toEqual({ format: 'text' });
    expect(() => parseReportArgs(['--apply'])).toThrow(/read-only/);
  });
});
