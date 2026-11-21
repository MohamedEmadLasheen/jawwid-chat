/**
 * PD-59 / F7: a Sales representative's view of the trial group is filtered by card KIND
 * (TRIAL_CARD_KINDS, communication/messages/trial-card-scope.ts). A card kind posted into a trial group
 * that is not in that set would silently bypass the filter, so:
 *   1. every kind any caller passes to TrialGroupService.postCard is in the set (read from the source),
 *   2. postCard itself refuses a kind outside it,
 *   3. the set is exactly the CardKind.TRIAL_* members (and so every kind the card body renderer knows).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CardKind } from '../../../src/communication/contracts/vocab';
import { TRIAL_CARD_KINDS } from '../../../src/communication/messages/trial-card-scope';
import { TrialGroupService } from '../../../src/lessons/trial-group.service';
import { renderTrialCardBody } from '../../../src/lessons/trial-cards';

const SRC = join(__dirname, '../../../src');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('PD-59 / F7: every trial-group card kind is covered by the representative filter', () => {
  it('every CardKind passed to a trial group\'s postCard is in TRIAL_CARD_KINDS', () => {
    const emitted = new Set<string>();
    let calls = 0;
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      // `this.groups.postCard(` / `trialGroups.postCard(`: the trial group's poster (the lesson cards use `lessons.postCard`).
      for (const m of text.matchAll(/\b(?:groups|trialGroups|trialGroup)\.postCard\(([^;]*?)\);/gs)) {
        calls += 1;
        for (const k of m[1].matchAll(/CardKind\.([A-Z_]+)/g)) emitted.add(k[1]);
        expect([file, /CardKind\.[A-Z_]+/.test(m[1])]).toEqual([file, true]); // a kind is named, not computed elsewhere
      }
    }
    expect(calls).toBeGreaterThanOrEqual(8);
    for (const name of emitted) {
      expect([name, TRIAL_CARD_KINDS]).toEqual([name, expect.arrayContaining([(CardKind as Record<string, string>)[name]])]);
    }
  });

  it('the set is exactly the TRIAL_* kinds, and each has its own rendered body', () => {
    const trial = Object.entries(CardKind).filter(([n]) => n.startsWith('TRIAL_')).map(([, v]) => v).sort();
    expect([...TRIAL_CARD_KINDS].sort()).toEqual(trial);
    expect(trial.length).toBeGreaterThanOrEqual(7);
    for (const kind of trial) expect([kind, renderTrialCardBody(kind, { result: 'subscribed' }, 'en')]).not.toEqual([kind, 'Update']);
  });

  it('postCard refuses a kind outside TRIAL_CARD_KINDS before it writes anything', async () => {
    const touched: string[] = [];
    const tx = new Proxy({}, { get: (_t, prop) => { touched.push(String(prop)); throw new Error('must not be reached'); } });
    const service = new TrialGroupService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const trial = { id: 't', organizationId: 'o', teacherId: 'x', startsAt: new Date(), endsAt: new Date(), prospect: null };
    await expect(service.postCard(tx as never, trial, null, CardKind.LESSON_REPORT)).rejects.toThrow(/trial kinds/);
    await expect(service.postCard(tx as never, trial, null, 'some_future_card')).rejects.toThrow(/trial kinds/);
    expect(touched).toEqual([]);
  });
});
