/**
 * PD-59 / G-07: a lead's contact (a prospective parent's phone, WhatsApp number
 * and e-mail) must stay where the communication engine cannot reach it.
 *
 * no-contact-channel-columns.spec.ts allows exactly the declarations of
 * chat.sales_lead_contact. This guard is what makes that exception safe: only
 * src/sales-pipeline may name that table, its Prisma model or its contact
 * fields. A message, card, conversation, notification, realtime, search, export
 * or log path that started reading it would restore the class of leak G-07
 * closes, so that fails the build here. The same file also pins the module's
 * own discipline: no logging, and no contact value in an error or an audit row.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..', '..', '..', 'src');
const OWNER = 'sales-pipeline/';

/** The table name and the Prisma accessors / fields that reach it. Case-sensitive on purpose. */
const NAMES = /\bsales_lead_contact\b|\bsalesLeadContact\b|\bSalesLeadContact\b|\bconfinedLeadPhone\b|\bconfinedLeadWhatsapp\b|\bconfinedLeadEmail\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

export function offenders(files: Array<{ rel: string; text: string }>): string[] {
  return files
    .filter((f) => !f.rel.startsWith(OWNER))
    .flatMap((f) =>
      f.text
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => NAMES.test(line))
        .map(({ line, i }) => `${f.rel}:${i + 1}: ${line.trim()}`),
    );
}

describe('a lead\'s contact is read only by src/sales-pipeline (PD-59, G-07)', () => {
  const files = sources(SRC).map((p) => ({ rel: relative(SRC, p), text: readFileSync(p, 'utf8') }));

  it('no other source names its table, model or contact fields', () => {
    expect(files.some((f) => f.rel.startsWith(OWNER))).toBe(true);
    expect(offenders(files)).toEqual([]);
  });

  it('the guard fires on the shapes it exists to catch, and not on the module wiring', () => {
    const fires = [
      'const c = await this.prisma.salesLeadContact.findUnique({ where: { prospectId } });',
      'select phone from chat.sales_lead_contact',
      'const p: SalesLeadContact = row;',
      'return { phone: row.confinedLeadPhone };',
      'return { w: row.confinedLeadWhatsapp };',
      'return { email: row.confinedLeadEmail };',
    ];
    for (const text of fires) {
      expect({ text, hit: offenders([{ rel: 'communication/messages/x.ts', text }]).length }).toEqual({ text, hit: 1 });
    }
    const quiet = [
      "import { SalesPipelineModule } from './sales-pipeline/sales-pipeline.module';",
      'await this.pipeline.list(actorId, query);',
    ];
    for (const text of quiet) expect(offenders([{ rel: 'app.module.ts', text }])).toEqual([]);
  });

  it('the module never logs, and its audit rows and errors carry field names, not values', () => {
    const own = files.filter((f) => f.rel.startsWith(OWNER));
    const code = own.map((f) => ({ rel: f.rel, text: f.text.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n') }));
    // No logger, no console: a contact value could not reach a log line.
    expect(code.filter((f) => /\bLogger\b|\bconsole\./.test(f.text)).map((f) => f.rel)).toEqual([]);
    // No audit write or error is built from a contact value.
    const service = code.find((f) => f.rel.endsWith('sales-pipeline.service.ts'))!.text;
    const auditCalls = service.match(/this\.audit\.audit\([\s\S]*?\}\);/g) ?? [];
    expect(auditCalls.length).toBeGreaterThan(0);
    for (const call of auditCalls) expect(call).not.toMatch(/contact\.(phone|whatsapp|email|parentName)|merged\.|\.confinedLead/);
    const errorCalls = service.match(/(invalid|stateError|unavailable|notFound|denied)\([^)]*\)/g) ?? [];
    for (const call of errorCalls) expect(call).not.toMatch(/\$\{|\+ /);
  });
});
