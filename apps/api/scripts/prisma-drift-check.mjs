#!/usr/bin/env node
/**
 * DB-5: the SQL migrations are the schema authority; Prisma is a query client.
 *
 * `prisma migrate diff --exit-code` cannot express that. A hand-written mapping
 * onto an existing schema always differs structurally from what Prisma would
 * have generated — relation declarations, generated columns and check
 * constraints all show up as "drift" — so that check fails permanently and is
 * therefore worthless as a gate.
 *
 * The invariant that does matter is narrower and exactly enforceable:
 *
 *   Every table and column Prisma declares must already exist in the migrated
 *   database.
 *
 * If it holds, Prisma cannot be the origin of any schema object: it only ever
 * names things the SQL created. Columns present in SQL but absent from Prisma
 * are fine and expected — the client is a partial read model.
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);
const source = readFileSync(schemaPath, 'utf8');

/** model Foo { ...fields... @@map("foo") } → { table, columns[] } */
function parseModels(text) {
  const models = [];
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = modelRe.exec(text)) !== null) {
    const [, name, body] = match;
    const mapped = body.match(/@@map\("([^"]+)"\)/);
    const table = mapped ? mapped[1] : name;
    const columns = [];
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;
      const field = trimmed.match(/^(\w+)\s+(\w+)/);
      if (!field) continue;
      const [, fieldName, fieldType] = field;
      // Relation fields name another model, not a column.
      if (/^[A-Z]/.test(fieldType)) continue;
      const colMap = trimmed.match(/@map\("([^"]+)"\)/);
      columns.push(colMap ? colMap[1] : fieldName);
    }
    models.push({ name, table, columns });
  }
  return models;
}

const models = parseModels(source);
if (models.length === 0) {
  console.error('drift check: parsed no models from schema.prisma');
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  `select table_name, column_name from information_schema.columns where table_schema = 'chat'`,
);
await client.end();

const actual = new Map();
for (const row of rows) {
  if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
  actual.get(row.table_name).add(row.column_name);
}

const problems = [];
for (const model of models) {
  const columns = actual.get(model.table);
  if (!columns) {
    problems.push(`model ${model.name} maps to chat.${model.table}, which does not exist`);
    continue;
  }
  for (const column of model.columns) {
    if (!columns.has(column)) {
      problems.push(`model ${model.name} declares chat.${model.table}.${column}, which does not exist`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Prisma declares ${problems.length} object(s) the SQL schema does not define:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nThe SQL migrations are authoritative. Add a migration, then map it here.');
  process.exit(1);
}

console.log(`ok: ${models.length} Prisma models map onto the migrated chat schema`);
