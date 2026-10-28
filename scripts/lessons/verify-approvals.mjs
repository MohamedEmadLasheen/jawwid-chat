#!/usr/bin/env node
// PD-49: verify every lesson-content approvals file's Ed25519 signature (plan F.3).
//
//   node scripts/lessons/verify-approvals.mjs            apps/lessons/src/content/approvals/*.json
//   node scripts/lessons/verify-approvals.mjs selftest
//
// An approvals file is the API's signed export: {payload, keyId, signature}.
// It is accepted only when keyId names a key in apps/lessons/src/content/
// approvals-keys.json whose id is truly its key's id, and the signature over the
// canonical JSON of the payload verifies under that key. An unsigned file
// (keyId and signature null) may only approve nothing. The payload's dataset is
// the pinned one and its lessonKey is the file's own. CI is the trust anchor:
// the production bundle is built only by CI, after this passes.
// Node's built-in crypto only; reads files.
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTENT = join(ROOT, 'apps', 'lessons', 'src', 'content');
const APPROVALS = join(CONTENT, 'approvals');
const KEYS = join(CONTENT, 'approvals-keys.json');
const PIN = join(ROOT, 'apps', 'lessons', 'quran-pin.json');

/** The same bytes as canonicalJson() in apps/lessons and apps/api. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

/** A key's id: the first 16 hex of the SHA-256 of its SPKI DER. */
export function keyIdOf(spkiDer) {
  return createHash('sha256').update(spkiDer).digest('hex').slice(0, 16);
}

const sameKeys = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join() === keys;

/** Errors for one approvals file (empty = it verifies). */
export function check(envelope, { lessonKey, datasetId, keys }) {
  const errors = [];
  if (!sameKeys(envelope, 'keyId,payload,signature')) return ['must be exactly {payload, keyId, signature}'];
  const p = envelope.payload;
  if (!sameKeys(p, 'approvals,datasetId,lessonKey,v') || p.v !== 1 || !Array.isArray(p.approvals)) return ['payload must be exactly {v: 1, datasetId, lessonKey, approvals}'];
  if (p.datasetId !== datasetId) errors.push(`payload.datasetId ${p.datasetId} is not the pinned ${datasetId}`);
  if (p.lessonKey !== lessonKey) errors.push(`payload.lessonKey ${p.lessonKey} is not this file's ${lessonKey}`);
  if (envelope.keyId === null) {
    if (envelope.signature !== null || p.approvals.length > 0) errors.push('an unsigned file may only approve nothing');
    return errors;
  }
  const key = keys.find((k) => k.id === envelope.keyId);
  if (!key) return [...errors, `unknown key id ${envelope.keyId}: not in approvals-keys.json`];
  let pub;
  try {
    const der = Buffer.from(key.publicKey, 'base64');
    if (keyIdOf(der) !== key.id) return [...errors, `approvals-keys.json: key ${key.id} is not the id of its own public key`];
    pub = createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (pub.asymmetricKeyType !== 'ed25519') return [...errors, `key ${key.id} is not an Ed25519 key`];
  } catch {
    return [...errors, `key ${key.id}: not a base64 SPKI DER public key`];
  }
  const ok = typeof envelope.signature === 'string' && verify(null, Buffer.from(canonicalJson(p), 'utf8'), pub, Buffer.from(envelope.signature, 'base64'));
  if (!ok) errors.push(`the signature does not verify under key ${key.id} (the file was changed after the API signed it, or never signed)`);
  return errors;
}

function lessonKeyOf(file) {
  if (file === 'play.json') return 'play';
  const m = /^surah-(\d{3})\.json$/.exec(file);
  return m ? `quran-${m[1]}` : null;
}

function selftest() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  const keys = [{ id: keyIdOf(der), publicKey: der.toString('base64') }];
  const payload = { v: 1, datasetId: 'test-1', lessonKey: 'quran-112', approvals: [{ id: 'word-001', approvalSha256: 'a'.repeat(64), steps: ['check'], signers: [] }] };
  const signed = (pl) => ({ payload: pl, keyId: keys[0].id, signature: sign(null, Buffer.from(canonicalJson(pl), 'utf8'), privateKey).toString('base64') });
  const ctx = { lessonKey: 'quran-112', datasetId: 'test-1', keys };
  const cases = [
    ['signed', signed(payload), ctx, true],
    ['changed after signing', { ...signed(payload), payload: { ...payload, approvals: [] } }, ctx, false],
    ['unknown key', { ...signed(payload), keyId: 'ffffffffffffffff' }, ctx, false],
    ['unsigned with approvals', { payload, keyId: null, signature: null }, ctx, false],
    ['unsigned and empty', { payload: { ...payload, approvals: [] }, keyId: null, signature: null }, ctx, true],
    ['another lesson', signed({ ...payload, lessonKey: 'quran-113' }), ctx, false],
    ['another dataset', signed({ ...payload, datasetId: 'test-2' }), ctx, false],
    ['a key whose id is not its own', signed(payload), { ...ctx, keys: [{ ...keys[0], publicKey: generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).toString('base64') }] }, false],
    ['the pre-signature format', { surah: 112, lessonKey: 'quran-112', approvals: [] }, ctx, false],
  ];
  const failed = cases.filter(([, env, c, ok]) => (check(env, c).length === 0) !== ok).map(([name]) => name);
  for (const f of failed) console.log(`verify-approvals selftest: FAIL ${f}`);
  if (!failed.length) console.log(`verify-approvals selftest: ${cases.length} cases, each as expected`);
  return failed.length ? 1 : 0;
}

function main() {
  const datasetId = JSON.parse(readFileSync(PIN, 'utf8')).datasetId;
  const keys = JSON.parse(readFileSync(KEYS, 'utf8')).keys;
  const ids = keys.map((k) => k.id);
  if (!Array.isArray(keys) || new Set(ids).size !== ids.length) {
    console.log('verify-approvals: approvals-keys.json must list keys with unique ids');
    return 1;
  }
  const files = existsSync(APPROVALS) ? readdirSync(APPROVALS).filter((f) => f.endsWith('.json')).sort() : [];
  let failed = 0;
  for (const f of files) {
    const lessonKey = lessonKeyOf(f);
    const errors = lessonKey ? check(JSON.parse(readFileSync(join(APPROVALS, f), 'utf8')), { lessonKey, datasetId, keys }) : ['not an approvals file name (surah-NNN.json or play.json)'];
    for (const e of errors) console.log(`verify-approvals: ${f}: ${e}`);
    if (errors.length) failed++;
  }
  console.log(`verify-approvals: ${files.length} approvals file(s), ${files.length - failed} verified; ${keys.length} key(s) known`);
  return failed ? 1 : 0;
}

process.exit(process.argv[2] === 'selftest' ? selftest() : main());
