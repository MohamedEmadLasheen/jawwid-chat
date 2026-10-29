import type { PrismaClient } from '@prisma/client';
import { contactKeyHash, normaliseEmailForKey } from '../new-students/contact-key';
import { e164ForKey } from '../new-students/intake-input';

/**
 * PD-42 S1 (review of #202, P1-2): key every family that exists BEFORE anyone
 * enters families by hand, so a parent already in Chat (PD-16, the seed, an
 * earlier import) can never become a second family.
 *
 * For every active parent: the sign-in e-mail (their family account's subject)
 * and the parent file's e-mail and phone -- the phone in E.164, read in the
 * family's country (an unmistakable Egyptian mobile without one). Keys already
 * there are left alone; a key another family already holds is a COLLISION --
 * two families that may be one parent -- reported, never merged; a phone that
 * cannot be read as one number is UNREADABLE, reported.
 *
 * Idempotent: a second run inserts nothing. A dry run (the default) writes
 * nothing. --apply writes the keys and, when nothing was left unresolved (or
 * the operator accepts the gaps), sets chat.config 'intake.contact_keys_ready',
 * which opens /family-intake.
 *
 * Lives in src/parent-profile: it reads chat.parent_file (G-07,
 * parent-file-confinement.spec.ts). Nothing it returns carries a phone or an
 * e-mail -- only family ids and counts.
 */
export interface ParentKeySource {
  familyId: string;
  organizationId: string;
  countryCode: string | null;
  contactId: string;
  subject: string | null;
  fileEmail: string | null;
  filePhone: string | null;
}

export interface KeyPlan {
  inserts: Array<{ organizationId: string; keyHash: string; familyId: string; kind: 'email' | 'phone' }>;
  already: number;
  collisions: Array<{ familyId: string; otherFamilyId: string; kind: 'email' | 'phone' }>;
  unreadable: Array<{ familyId: string; contactId: string }>;
}

/** The keys to write, in the order given (oldest family first wins a shared key). Pure. */
export function planContactKeys(sources: readonly ParentKeySource[], existing: ReadonlyMap<string, string>): KeyPlan {
  const held = new Map(existing);
  const plan: KeyPlan = { inserts: [], already: 0, collisions: [], unreadable: [] };
  const claim = (s: ParentKeySource, kind: 'email' | 'phone', value: string) => {
    const keyHash = contactKeyHash(kind, value);
    const at = `${s.organizationId}|${keyHash}`;
    const owner = held.get(at);
    if (owner === s.familyId) {
      if (existing.get(at) === s.familyId) plan.already += 1;
      return;
    }
    if (owner) {
      if (!plan.collisions.some((c) => c.familyId === s.familyId && c.otherFamilyId === owner && c.kind === kind)) {
        plan.collisions.push({ familyId: s.familyId, otherFamilyId: owner, kind });
      }
      return;
    }
    held.set(at, s.familyId);
    plan.inserts.push({ organizationId: s.organizationId, keyHash, familyId: s.familyId, kind });
  };
  for (const s of sources) {
    const emails = new Set([s.subject, s.fileEmail].filter((e): e is string => !!e && e.trim() !== '').map(normaliseEmailForKey));
    for (const e of emails) claim(s, 'email', e);
    if (s.filePhone && s.filePhone.trim() !== '') {
      const e164 = e164ForKey(s.filePhone, s.countryCode);
      if (!e164 || e164 === 'ambiguous') plan.unreadable.push({ familyId: s.familyId, contactId: s.contactId });
      else claim(s, 'phone', e164);
    }
  }
  return plan;
}

export interface BackfillReport {
  apply: boolean;
  parents: number;
  /** Keys written (--apply) or that would be written (a dry run). */
  keys: number;
  already: number;
  collisions: KeyPlan['collisions'];
  unreadable: KeyPlan['unreadable'];
  /** Whether chat.config 'intake.contact_keys_ready' is set after this run. */
  ready: boolean;
}

type Db = Pick<PrismaClient, '$queryRaw' | '$transaction'>;

export async function backfillFamilyContactKeys(db: Db, opts: { apply: boolean; acceptGaps: boolean }): Promise<BackfillReport> {
  const sources = await db.$queryRaw<ParentKeySource[]>`
    SELECT f.id::text AS "familyId", f.organization_id::text AS "organizationId", f.country_code AS "countryCode",
           c.id::text AS "contactId", a.subject, pf.email AS "fileEmail", pf.phone AS "filePhone"
      FROM chat.family f
      JOIN chat.contact c ON c.family_id = f.id AND c.is_active
      LEFT JOIN chat.account a ON a.id = c.account_id AND a.kind = 'family'
      LEFT JOIN chat.parent_file pf ON pf.contact_id = c.id
     ORDER BY f.created_at, f.id, c.created_at, c.id`;
  const rows = await db.$queryRaw<Array<{ organization_id: string; key_hash: string; family_id: string }>>`
    SELECT organization_id::text, key_hash, family_id::text FROM chat.family_contact_key`;
  const plan = planContactKeys(sources, new Map(rows.map((r) => [`${r.organization_id}|${r.key_hash}`, r.family_id])));
  const gaps = plan.collisions.length + plan.unreadable.length;
  let ready = await readyFlag(db);

  if (opts.apply) {
    await db.$transaction(async (tx) => {
      for (const k of plan.inserts) {
        await tx.$executeRaw`
          INSERT INTO chat.family_contact_key (organization_id, key_hash, family_id, kind)
          VALUES (${k.organizationId}::uuid, ${k.keyHash}, ${k.familyId}::uuid, ${k.kind})`;
      }
      if (gaps === 0 || opts.acceptGaps) {
        await tx.$executeRaw`
          INSERT INTO chat.config (key, value, scope, description)
          VALUES ('intake.contact_keys_ready', 'true'::jsonb, 'intake',
                  'PD-42: every existing family''s parents are keyed (family-contact-keys-backfill); /family-intake is open.')
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
      }
    });
    ready = await readyFlag(db);
  }
  return { apply: opts.apply, parents: sources.length, keys: plan.inserts.length, already: plan.already, collisions: plan.collisions, unreadable: plan.unreadable, ready };
}

async function readyFlag(db: Db): Promise<boolean> {
  const [row] = await db.$queryRaw<Array<{ ready: boolean }>>`
    SELECT coalesce((SELECT value = 'true'::jsonb FROM chat.config WHERE key = 'intake.contact_keys_ready'), false) AS ready`;
  return row?.ready === true;
}
