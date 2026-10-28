import pin from '../../quran-pin.json';
import { approvalSha256, BANDS, type Band } from '../content/quran-content';
import registry from './mechanics.json';
import playApprovals from '../content/approvals/play.json';
import { TIERS, type Tier } from './adapt';

/**
 * PD-49 game mechanics (plan §C). A mechanic reaches a child only when a
 * teacher and the scholar signed exactly its record (scope 'play': the review
 * system's approval hash of {datasetId, lessonKey: 'play', mechanic}), as for
 * content items -- the respect rules of §C.4 and the game's code (codeSha256)
 * are part of what they sign.
 * None is signed yet, so no child sees a game.
 */
export type Skill = 'listening' | 'recitation' | 'recognition' | 'structure';

export interface Mechanic {
  id: string;
  version: number;
  nameAr: string;
  skill: Skill;
  bands: Band[];
  tiers: Tier[];
  needsAudio: boolean;
  respect: string[];
  /** The game's file in play/games/, and SHA-256 of its bytes, a NUL, then common.tsx's bytes: what is signed includes the code (check-quran-content.py verifies it). */
  code: string;
  codeSha256: string;
}

const SKILLS: readonly Skill[] = ['listening', 'recitation', 'recognition', 'structure'];
const ID = /^[a-z][a-z0-9_]{1,62}$/;
const CODE = /^[A-Z][A-Za-z0-9]*\.tsx$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** The registry, validated: one malformed mechanic refuses them all (fail closed). */
export function parseMechanics(raw: unknown): Mechanic[] | null {
  const list = (raw as { mechanics?: unknown } | null)?.mechanics;
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  for (const m of list as Partial<Mechanic>[]) {
    const keys = m && typeof m === 'object' ? Object.keys(m).sort().join() : '';
    if (keys !== 'bands,code,codeSha256,id,nameAr,needsAudio,respect,skill,tiers,version') return null;
    if (typeof m.code !== 'string' || !CODE.test(m.code) || typeof m.codeSha256 !== 'string' || !SHA256.test(m.codeSha256)) return null;
    if (typeof m.id !== 'string' || !ID.test(m.id) || seen.has(m.id)) return null;
    if (!Number.isInteger(m.version) || (m.version as number) < 1 || typeof m.nameAr !== 'string' || !m.nameAr.trim()) return null;
    if (!SKILLS.includes(m.skill as Skill) || typeof m.needsAudio !== 'boolean') return null;
    if (!Array.isArray(m.bands) || m.bands.length === 0 || !m.bands.every((b) => BANDS.includes(b))) return null;
    if (!Array.isArray(m.tiers) || m.tiers.length === 0 || !m.tiers.every((t) => TIERS.includes(t))) return null;
    if (!Array.isArray(m.respect) || m.respect.length === 0 || !m.respect.every((r) => typeof r === 'string' && r.trim())) return null;
    seen.add(m.id);
  }
  return list as Mechanic[];
}

export const MECHANICS: readonly Mechanic[] = parseMechanics(registry) ?? [];

export interface PlayApprovals {
  scope: 'play';
  approvals: { id: string; approvalSha256: string; steps: string[] }[];
}

/**
 * The mechanics a child may play: signed by a teacher AND the scholar, for the
 * record as it is now. Anything malformed approves nothing.
 */
export async function approvedMechanics(
  mechanics: readonly Mechanic[],
  approvals: unknown = playApprovals,
  datasetId: string = pin.datasetId,
): Promise<Set<string>> {
  const out = new Set<string>();
  const a = approvals as Partial<PlayApprovals> | null;
  if (!a || a.scope !== 'play' || !Array.isArray(a.approvals)) return out;
  const byId = new Map<string, { approvalSha256: string; steps: string[] }>();
  for (const e of a.approvals as unknown[]) {
    const x = e as { id?: unknown; approvalSha256?: unknown; steps?: unknown } | null;
    if (!x || typeof x.id !== 'string' || typeof x.approvalSha256 !== 'string' || !Array.isArray(x.steps) || byId.has(x.id)) return new Set();
    byId.set(x.id, { approvalSha256: x.approvalSha256, steps: x.steps as string[] });
  }
  for (const m of mechanics) {
    const x = byId.get(m.id);
    if (!x || !x.steps.includes('teacher') || !x.steps.includes('scholar')) continue;
    if (x.approvalSha256 === (await approvalSha256(datasetId, 'play', m))) out.add(m.id);
  }
  return out;
}
