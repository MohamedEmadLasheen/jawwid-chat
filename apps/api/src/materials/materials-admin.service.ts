import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type MaterialItem } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { CommError, CommErrorCode } from '../platform/errors';
import { AUDIT_SERVICE, OBJECT_STORAGE } from '../platform/tokens';
import type { AuditService } from '../platform/audit.service';
import type { Actor } from '../platform/types';
import type { ObjectStorage } from '../communication/attachments/object-storage';
import { ConversationService, isUuid } from '../communication/conversations/conversation.service';
import { ActorKind } from '../communication/contracts/vocab';
import { surahOf } from './quran-surahs';
import {
  canonicalRow,
  checkHttpsUrl,
  MAX_IMPORT_ROWS,
  parseCsv,
  parseItemRow,
  type ItemFields,
} from './manifest';
import { PackageRefused, validatePackage, type PackageEntry } from './package-validation';
import {
  bytesMatchMime,
  FILE_RULES,
  kindOfMime,
  PACKAGE_MAX_BYTES,
  type Kind,
} from './vocab';

type Tx = Prisma.TransactionClient;

/** Where an item's bytes or link come from, checked and ready to write. */
type Source =
  | { source: 'site'; kind: 'activity_link'; sitePath: string }
  | { source: 'url'; kind: Kind; url: string }
  | { source: 'file'; kind: Kind; objectKey: string; mimeType: string; byteSize: number }
  | { source: 'package'; kind: 'activity_package'; objectKey: string; mimeType: string; byteSize: number; packageEntry: string; entries: PackageEntry[]; skipped: string[] };

const MAX_UPLOADS_PER_CALL = 200;

export function invalid(reason: string, status = 400) {
  return new CommError(CommErrorCode.MATERIAL_INVALID, reason, status);
}
function refused(reason: string) {
  return new CommError(CommErrorCode.MATERIAL_FILE_REFUSED, reason, 400);
}
function notFound(what = 'library item') {
  return new CommError(CommErrorCode.MATERIAL_NOT_FOUND, `no such ${what}`);
}

/**
 * PD-29: managing the library -- the super admin and the manager of the
 * Teachers department (chat.can_manage_materials, which the database checks
 * again on every write). Nothing is authored here: the academy's materials
 * already exist, and an item only says how to PLAY one -- an https link, an
 * uploaded file, or an uploaded HTML5 package (validated, then played
 * sandboxed).
 *
 * Uploads go straight from the browser to storage under a signed, size- and
 * type-bound grant; the API records every key it granted
 * (chat.material_upload) and lets an item name only a key granted to its own
 * organization -- an object key is a name, not a capability. Before an item
 * may use a file, the server reads its real first bytes; a package is read
 * whole once and validated (package-validation.ts).
 *
 * The bulk import is the cheap path for existing content: a CSV or JSON
 * manifest plus the files it names, previewed row by row (dry run) and then
 * committed all-or-nothing. A stable `ref` makes it idempotent: importing the
 * same manifest again updates the same items instead of adding new ones.
 */
@Injectable()
export class MaterialsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Who
  // ------------------------------------------------------------------

  async mayManage(actor: Actor): Promise<boolean> {
    if (actor.kind !== ActorKind.STAFF || !actor.isActive || !actor.organizationId) return false;
    const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT chat.can_manage_materials(${actor.actorId}::uuid, ${actor.organizationId}::uuid) AS ok`;
    return rows[0]?.ok === true;
  }

  async access(actorId: string) {
    return { canManage: await this.mayManage(await this.conversations.requireActor(actorId)) };
  }

  async requireManager(actorId: string): Promise<Actor & { organizationId: string }> {
    const actor = await this.conversations.requireActor(actorId);
    if (!(await this.mayManage(actor))) {
      throw new CommError(CommErrorCode.MATERIAL_DENIED, 'the library is managed by the super admin or the Teachers manager');
    }
    return actor as Actor & { organizationId: string };
  }

  // ------------------------------------------------------------------
  // Items
  // ------------------------------------------------------------------

  async list(actorId: string, query: Record<string, unknown>) {
    const actor = await this.requireManager(actorId);
    const where: Prisma.MaterialItemWhereInput = { organizationId: actor.organizationId };
    if (typeof query.subject === 'string' && query.subject) where.subject = query.subject;
    if (typeof query.status === 'string' && query.status) where.status = query.status;
    if (typeof query.ageGroup === 'string' && query.ageGroup) where.OR = [{ ageGroups: { has: query.ageGroup } }, { ageGroups: { isEmpty: true } }];
    if (typeof query.q === 'string' && query.q.trim()) {
      const q = query.q.trim();
      where.AND = [{ OR: [
        { titleAr: { contains: q, mode: 'insensitive' } },
        { titleEn: { contains: q, mode: 'insensitive' } },
        { externalRef: { contains: q, mode: 'insensitive' } },
      ] }];
    }
    const items = await this.prisma.materialItem.findMany({ where, orderBy: [{ updatedAt: 'desc' }], take: 2000 });
    return { items: items.map(adminDto) };
  }

  async get(actorId: string, itemId: string) {
    const actor = await this.requireManager(actorId);
    return adminDto(await this.item(actor.organizationId, itemId));
  }

  /**
   * Upload grants for one or many files: each bound to its declared type and
   * size, recorded against the organization and the manager. The token
   * returned is what a form or an import names afterwards.
   */
  async uploads(actorId: string, body: Record<string, unknown>) {
    const actor = await this.requireManager(actorId);
    const purpose = body.purpose === 'recitation' ? 'recitation' : 'item';
    const files = body.files;
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_UPLOADS_PER_CALL) {
      throw invalid(`files: 1 to ${MAX_UPLOADS_PER_CALL} of {name, mimeType, byteSize}`);
    }
    const checked = files.map((raw, i) => {
      const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const name = typeof f.name === 'string' ? f.name.trim() : '';
      const mimeType = typeof f.mimeType === 'string' ? f.mimeType.trim().toLowerCase() : '';
      const byteSize = f.byteSize;
      if (!name || name.length > 255) throw invalid(`files[${i}].name: 1 to 255 characters`);
      const kind = kindOfMime(mimeType);
      if (!kind) throw refused(`files[${i}] (${name}): ${mimeType || 'no type'} is not an accepted audio, video, PDF, image or zip type`);
      if (purpose === 'recitation' && kind !== 'audio') throw refused(`files[${i}] (${name}): a recitation is an audio file`);
      const max = kind === 'activity_package' ? PACKAGE_MAX_BYTES : FILE_RULES[kind].maxBytes;
      if (typeof byteSize !== 'number' || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > max) {
        throw refused(`files[${i}] (${name}): 1 byte to ${Math.floor(max / 1024 / 1024)} MB for ${kind}`);
      }
      return { name, mimeType, byteSize };
    });
    const grants = await Promise.all(checked.map((f) =>
      this.storage.authorizeUpload({ prefix: `materials/${actor.organizationId}`, mimeType: f.mimeType, byteSize: f.byteSize })));
    await this.prisma.materialUpload.createMany({
      data: grants.map((g, i) => ({
        objectKey: g.objectKey,
        organizationId: actor.organizationId,
        issuedTo: actor.actorId,
        purpose,
        fileName: checked[i]!.name,
        mimeType: checked[i]!.mimeType,
        byteSize: BigInt(checked[i]!.byteSize),
      })),
    });
    return {
      uploads: grants.map((g, i) => ({
        name: checked[i]!.name,
        uploadToken: g.objectKey,
        uploadUrl: g.uploadUrl,
        method: g.method,
        headers: g.headers,
        expiresAt: g.expiresAt,
      })),
    };
  }

  async create(actorId: string, body: Record<string, unknown>) {
    const actor = await this.requireManager(actorId);
    const { fields, errors } = parseItemRow(body);
    if (errors.length) throw invalid(errors.join('; '));
    const source = await this.sourceFor(actor, fields, body.uploadToken);
    if (!source) throw invalid('path, url or uploadToken: an item plays a lesson of the lessons site, a link, an uploaded file or an uploaded package');
    const created = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const item = await this.insert(tx, actor, fields, source);
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'material.created', entity: 'material_item', entityId: item.id,
          after: auditView(item), reason: 'library item added',
        });
        return item;
      }),
    );
    return { ...adminDto(created), ...(source.source === 'package' ? { skipped: source.skipped } : {}) };
  }

  /** Change an item. Every field present is written; a field left out stays. `url` or `uploadToken` replaces the source. */
  async update(actorId: string, itemId: string, body: Record<string, unknown>) {
    const actor = await this.requireManager(actorId);
    const current = await this.item(actor.organizationId, itemId);
    // Canonical column names on both sides, so a changed field always wins.
    const merged: Record<string, unknown> = { ...canonicalRow(rowOf(current)), ...canonicalRow(body) };
    // A new source replaces the old one entirely.
    const newSource = ['url', 'path', 'sitePath', 'site_path', 'uploadToken'].find((k) => k in body && body[k]);
    if (newSource) {
      delete merged.url;
      delete merged.path;
      Object.assign(merged, canonicalRow(body));
      if (newSource === 'uploadToken') {
        delete merged.url;
        delete merged.path;
      }
    }
    const { fields, errors } = parseItemRow(merged);
    if (errors.length) throw invalid(errors.join('; '));
    const source = newSource ? await this.sourceFor(actor, fields, body.uploadToken) : null;
    const updated = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        const row = await this.apply(tx, actor, current, fields, source, fields.status ?? current.status);
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'material.updated', entity: 'material_item', entityId: current.id,
          before: auditView(current), after: auditView(row),
          reason: row.status !== current.status ? `library item ${row.status}` : 'library item changed',
        });
        return row;
      }),
    );
    return { ...adminDto(updated), ...(source?.source === 'package' ? { skipped: source.skipped } : {}) };
  }

  // ------------------------------------------------------------------
  // Bulk import
  // ------------------------------------------------------------------

  /**
   * One endpoint, two steps. `dryRun` (the default) validates every row and
   * writes nothing: per-row action (create / update) and every error. Without
   * it, the same checks run again, every named file is checked in storage
   * (and every package validated), and if anything is wrong nothing is
   * written; otherwise all rows are written in one transaction.
   */
  async import(actorId: string, body: Record<string, unknown>) {
    const actor = await this.requireManager(actorId);
    const dryRun = body.dryRun !== false;
    const rawRows = manifestRows(body);
    if (rawRows.length === 0) throw invalid('manifest: no rows');
    if (rawRows.length > MAX_IMPORT_ROWS) throw invalid(`manifest: at most ${MAX_IMPORT_ROWS} rows per import; split it`);

    const files = importFiles(body.files);
    const refs = rawRows.map((r) => parseItemRow(r).fields.externalRef).filter((r): r is string => !!r);
    const existing = refs.length
      ? await this.prisma.materialItem.findMany({ where: { organizationId: actor.organizationId, externalRef: { in: refs } } })
      : [];
    const byRef = new Map(existing.map((i) => [i.externalRef as string, i]));

    const seenRefs = new Set<string>();
    const usedFiles = new Set<string>();
    const rows = rawRows.map((raw, index) => {
      const { fields, errors } = parseItemRow(raw);
      const warnings: string[] = [];
      const current = fields.externalRef ? byRef.get(fields.externalRef) ?? null : null;
      if (fields.externalRef) {
        if (seenRefs.has(fields.externalRef)) errors.push(`ref: ${fields.externalRef} appears twice in this manifest`);
        seenRefs.add(fields.externalRef);
      } else {
        warnings.push('no ref: importing this manifest again will add this item again');
      }
      let file: ImportFile | null = null;
      if (fields.file) {
        file = files.find((f) => f.name === fields.file) ?? files.find((f) => f.name.toLowerCase() === fields.file!.toLowerCase()) ?? null;
        if (!file) errors.push(`file: ${fields.file} is not among the files of this import`);
        else {
          usedFiles.add(file.name);
          const kind = file.mimeType ? kindOfMime(file.mimeType) : null;
          if (file.mimeType && !kind) errors.push(`file: ${file.mimeType} is not an accepted audio, video, PDF, image or zip type`);
          else if (kind && fields.kind && fields.kind !== kind) errors.push(`kind: the file is ${kind}, the row says ${fields.kind}`);
          else if (kind && typeof file.byteSize === 'number') {
            const max = kind === 'activity_package' ? PACKAGE_MAX_BYTES : FILE_RULES[kind].maxBytes;
            if (file.byteSize > max) errors.push(`file: over ${Math.floor(max / 1024 / 1024)} MB for ${kind}`);
          }
        }
      }
      if (!current && !fields.url && !fields.sitePath && !fields.file) errors.push('path, url or file: a new item needs one');
      return { index, rowNumber: index + 1, fields, file, current, errors, warnings };
    });
    const unmatchedFiles = files.filter((f) => !usedFiles.has(f.name)).map((f) => f.name);
    const summary = () => ({
      rows: rows.length,
      create: rows.filter((r) => !r.current && r.errors.length === 0).length,
      update: rows.filter((r) => r.current && r.errors.length === 0).length,
      errors: rows.filter((r) => r.errors.length > 0).length,
    });
    const report = (committed: boolean, itemIds?: Map<number, string>) => ({
      dryRun,
      committed,
      summary: summary(),
      unmatchedFiles,
      rows: rows.map((r) => ({
        row: r.rowNumber,
        ref: r.fields.externalRef,
        title: r.fields.titleAr ?? r.fields.titleEn,
        action: r.errors.length ? 'error' : r.current ? 'update' : 'create',
        file: r.fields.file,
        errors: r.errors,
        warnings: r.warnings,
        ...(itemIds?.has(r.index) ? { itemId: itemIds.get(r.index) } : {}),
      })),
    });

    if (dryRun || rows.some((r) => r.errors.length)) return report(false);

    // Commit: every file must be in storage and be what it claims.
    const sources = new Map<number, Source | null>();
    for (const r of rows) {
      try {
        if (r.fields.sitePath) sources.set(r.index, { source: 'site', kind: 'activity_link', sitePath: r.fields.sitePath });
        else if (r.fields.url) sources.set(r.index, { source: 'url', kind: r.fields.kind ?? 'activity_link', url: r.fields.url });
        else if (r.file) {
          if (!r.file.uploadToken) throw invalid(`file: ${r.file.name} has not been uploaded`, 409);
          sources.set(r.index, await this.fileSource(actor, r.file.uploadToken, 'item', r.fields.kind));
        } else sources.set(r.index, null);
      } catch (e) {
        if (!(e instanceof CommError)) throw e;
        r.errors.push(e.message);
      }
    }
    if (rows.some((r) => r.errors.length)) return report(false);

    const itemIds = new Map<number, string>();
    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        for (const r of rows) {
          const source = sources.get(r.index) ?? null;
          if (r.current) {
            const row = await this.apply(tx, actor, r.current, r.fields, source, r.fields.status ?? r.current.status);
            itemIds.set(r.index, row.id);
          } else {
            const row = await this.insert(tx, actor, r.fields, source as Source);
            itemIds.set(r.index, row.id);
          }
        }
        const s = summary();
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'materials.imported', entity: 'organization', entityId: actor.organizationId,
          after: { created: s.create, updated: s.update, rows: s.rows }, reason: 'library import',
        });
      }, { timeout: 120_000, maxWait: 10_000 }),
    );
    return report(true, itemIds);
  }

  // ------------------------------------------------------------------
  // Recitations
  // ------------------------------------------------------------------

  async recitations(actorId: string) {
    const actor = await this.requireManager(actorId);
    const [sources, tracks] = await Promise.all([
      this.prisma.recitationSource.findMany({ where: { organizationId: actor.organizationId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      this.prisma.recitationTrack.findMany({ where: { organizationId: actor.organizationId }, orderBy: { surah: 'asc' } }),
    ]);
    return {
      sources: sources.map((s) => ({
        id: s.id, name: s.name, urlTemplate: s.urlTemplate, isDefault: s.isDefault, isActive: s.isActive,
        tracks: tracks.filter((t) => t.sourceId === s.id).map((t) => ({ surah: t.surah, kind: t.url ? 'url' : 'file', url: t.url })),
      })),
    };
  }

  async createSource(actorId: string, body: Record<string, unknown>) {
    const actor = await this.requireManager(actorId);
    const name = sourceName(body.name, true) as string;
    const urlTemplate = templateOf(body.urlTemplate);
    const isDefault = body.isDefault === true;
    const source = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        if (isDefault) await tx.recitationSource.updateMany({ where: { organizationId: actor.organizationId, isDefault: true }, data: { isDefault: false, updatedBy: actor.actorId } });
        const row = await tx.recitationSource.create({
          data: { organizationId: actor.organizationId, name, urlTemplate, isDefault, createdBy: actor.actorId, updatedBy: actor.actorId },
        });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'recitation_source.created', entity: 'recitation_source', entityId: row.id,
          after: { name, urlTemplate, isDefault }, reason: 'recitation source added',
        });
        return row;
      }),
    );
    return { id: source.id, name: source.name, urlTemplate: source.urlTemplate, isDefault: source.isDefault, isActive: source.isActive };
  }

  async updateSource(actorId: string, sourceId: string, body: Record<string, unknown>) {
    const actor = await this.requireManager(actorId);
    const current = await this.source(actor.organizationId, sourceId);
    const name = 'name' in body ? (sourceName(body.name, true) as string) : current.name;
    const urlTemplate = 'urlTemplate' in body ? templateOf(body.urlTemplate) : current.urlTemplate;
    if ('isActive' in body && typeof body.isActive !== 'boolean') throw invalid('isActive: true or false');
    if ('isDefault' in body && typeof body.isDefault !== 'boolean') throw invalid('isDefault: true or false');
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : current.isActive;
    const isDefault = isActive && (typeof body.isDefault === 'boolean' ? body.isDefault : current.isDefault);
    const row = await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        if (isDefault && !current.isDefault) {
          await tx.recitationSource.updateMany({ where: { organizationId: actor.organizationId, isDefault: true }, data: { isDefault: false, updatedBy: actor.actorId } });
        }
        const updated = await tx.recitationSource.update({ where: { id: current.id }, data: { name, urlTemplate, isActive, isDefault, updatedBy: actor.actorId } });
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'recitation_source.updated', entity: 'recitation_source', entityId: current.id,
          before: { name: current.name, urlTemplate: current.urlTemplate, isDefault: current.isDefault, isActive: current.isActive },
          after: { name, urlTemplate, isDefault, isActive }, reason: 'recitation source changed',
        });
        return updated;
      }),
    );
    return { id: row.id, name: row.name, urlTemplate: row.urlTemplate, isDefault: row.isDefault, isActive: row.isActive };
  }

  /** One surah's recitation in a source: `{url}`, `{uploadToken}` (an audio upload), or `{clear: true}` to fall back to the template. */
  async setTrack(actorId: string, sourceId: string, surahParam: string, body: Record<string, unknown>) {
    const actor = await this.requireManager(actorId);
    const source = await this.source(actor.organizationId, sourceId);
    const surah = surahOf(Number(surahParam));
    if (!surah || !/^\d{1,3}$/.test(surahParam)) throw notFound('surah');
    let data: { url: string | null; objectKey: string | null } | null = null;
    if (body.clear === true) data = null;
    else if (typeof body.url === 'string' && body.url.trim()) {
      const why = checkHttpsUrl(body.url.trim());
      if (why) throw invalid(`url: ${why}`);
      data = { url: body.url.trim(), objectKey: null };
    } else if (typeof body.uploadToken === 'string' && body.uploadToken) {
      const file = await this.fileSource(actor, body.uploadToken, 'recitation', 'audio');
      data = { url: null, objectKey: (file as { objectKey: string }).objectKey };
    } else throw invalid('url, uploadToken or clear: true');

    await this.write(() =>
      this.prisma.$transaction(async (tx) => {
        if (data === null) {
          await tx.$executeRaw`SELECT set_config('chat.materials_actor', ${actor.actorId}, true)`;
          await tx.recitationTrack.deleteMany({ where: { sourceId: source.id, surah: surah.number } });
        } else {
          await tx.recitationTrack.upsert({
            where: { sourceId_surah: { sourceId: source.id, surah: surah.number } },
            create: { sourceId: source.id, surah: surah.number, organizationId: actor.organizationId, ...data, updatedBy: actor.actorId },
            update: { ...data, updatedBy: actor.actorId },
          });
        }
        await this.audit.audit(tx, {
          actorId: actor.actorId, action: 'recitation_track.set', entity: 'recitation_source', entityId: source.id,
          after: { surah: surah.number, kind: data === null ? 'template' : data.url ? 'url' : 'file' }, reason: 'recitation changed',
        });
      }),
    );
    return this.recitations(actorId);
  }

  // ------------------------------------------------------------------

  private async item(organizationId: string, itemId: string): Promise<MaterialItem> {
    if (!isUuid(itemId)) throw notFound();
    const item = await this.prisma.materialItem.findFirst({ where: { id: itemId, organizationId } });
    if (!item) throw notFound();
    return item;
  }

  private async source(organizationId: string, sourceId: string) {
    if (!isUuid(sourceId)) throw notFound('recitation source');
    const s = await this.prisma.recitationSource.findFirst({ where: { id: sourceId, organizationId } });
    if (!s) throw notFound('recitation source');
    return s;
  }

  private async sourceFor(actor: Actor & { organizationId: string }, fields: ItemFields, uploadToken: unknown): Promise<Source | null> {
    if (typeof uploadToken === 'string' && uploadToken) {
      if (fields.url || fields.sitePath) throw invalid('path, url and uploadToken: an item has one source');
      return this.fileSource(actor, uploadToken, 'item', fields.kind);
    }
    if (fields.sitePath) {
      if (fields.kind && fields.kind !== 'activity_link') throw invalid('kind: a lesson of the lessons site is an activity_link');
      return { source: 'site', kind: 'activity_link', sitePath: fields.sitePath };
    }
    if (fields.url) {
      const kind = fields.kind ?? 'activity_link';
      if (kind === 'activity_package') throw invalid('kind: an activity_package is an uploaded zip, not a link');
      return { source: 'url', kind, url: fields.url };
    }
    return null;
  }

  /**
   * An uploaded file, checked and PINNED. The upload's signed PUT stays usable
   * until it expires, so the bytes under its key could still be replaced after
   * they were reviewed. The file is therefore first copied, server side, to a
   * key no upload grant can name (`materials/<org>/v/<uuid>`), and everything
   * after that -- the real-bytes check, the package validation, the item, the
   * play route -- uses only the copy. The original key is never served.
   */
  async fileSource(actor: Actor & { organizationId: string }, uploadToken: string, purpose: 'item' | 'recitation', declaredKind: Kind | null): Promise<Source> {
    const organizationId = actor.organizationId;
    const upload = await this.prisma.materialUpload.findUnique({ where: { objectKey: uploadToken } });
    if (!upload || upload.organizationId !== organizationId || upload.purpose !== purpose) throw notFound('upload');
    const kind = kindOfMime(upload.mimeType);
    if (!kind) throw refused('not an accepted file type');
    if (declaredKind && declaredKind !== kind) throw invalid(`kind: the file is ${kind}, not ${declaredKind}`);
    const name = upload.fileName ?? 'the file';
    if (!this.storage.copy) throw refused('this storage cannot pin an upload; the file is not accepted');
    const pinned = `materials/${organizationId}/v/${randomUUID()}`;
    if (!(await this.storage.copy(upload.objectKey, pinned))) {
      throw new CommError(CommErrorCode.MATERIAL_NOT_UPLOADED, `${name} has not been uploaded`, 409);
    }
    try {
      const source = await this.checkPinned(pinned, name, upload.mimeType, Number(upload.byteSize), kind);
      await this.prisma.materialUpload.create({
        data: {
          objectKey: pinned, organizationId, issuedTo: actor.actorId, purpose,
          fileName: upload.fileName, mimeType: upload.mimeType, byteSize: upload.byteSize,
        },
      });
      return source;
    } catch (e) {
      await this.storage.delete(pinned).catch(() => undefined);
      throw e;
    }
  }

  /** The pinned copy is what it claims: the size granted, the real bytes of its type, a valid package. */
  private async checkPinned(objectKey: string, name: string, mimeType: string, byteSize: number, kind: Kind): Promise<Source> {
    const head = await this.storage.readHead(objectKey, 64);
    if (!head) throw new CommError(CommErrorCode.MATERIAL_NOT_UPLOADED, `${name} has not been uploaded`, 409);
    if (head.byteSize !== byteSize) throw refused(`${name}: its size differs from the upload granted`);
    if (!bytesMatchMime(head.head, mimeType)) throw refused(`${name}: its contents are not ${mimeType}`);
    if (kind !== 'activity_package') return { source: 'file', kind, objectKey, mimeType, byteSize };

    const stored = await this.storage.read(objectKey);
    if (!stored || stored === 'unsatisfiable') throw new CommError(CommErrorCode.MATERIAL_NOT_UPLOADED, 'the package has not been uploaded', 409);
    const zip = await collect(stored.body, PACKAGE_MAX_BYTES);
    try {
      const pkg = validatePackage(zip);
      return { source: 'package', kind: 'activity_package', objectKey, mimeType, byteSize, packageEntry: pkg.entry, entries: pkg.entries, skipped: pkg.skipped };
    } catch (e) {
      if (e instanceof PackageRefused) throw refused(`${name}: ${e.message}`);
      throw e;
    }
  }

  private async writeEntries(tx: Tx, source: Source) {
    if (source.source !== 'package') return;
    await tx.materialPackageEntry.createMany({
      data: source.entries.map((e) => ({
        objectKey: source.objectKey,
        path: e.path,
        dataOffset: BigInt(e.dataOffset),
        compressedSize: BigInt(e.compressedSize),
        size: BigInt(e.size),
        method: e.method,
        crc32: BigInt(e.crc32),
      })),
      skipDuplicates: true,
    });
  }

  private async insert(tx: Tx, actor: Actor & { organizationId: string }, f: ItemFields, source: Source) {
    await this.writeEntries(tx, source);
    return tx.materialItem.create({
      data: {
        organizationId: actor.organizationId,
        ...itemData(f),
        ...sourceData(source),
        status: f.status ?? 'draft',
        createdBy: actor.actorId,
        updatedBy: actor.actorId,
      },
    });
  }

  private async apply(tx: Tx, actor: Actor, current: MaterialItem, f: ItemFields, source: Source | null, status: string) {
    if (source) await this.writeEntries(tx, source);
    const kind = source ? source.kind : f.kind && f.kind !== current.kind ? f.kind : current.kind;
    if (!source && kind !== current.kind) {
      // A kind change without a new source must still fit the source it has.
      if (current.source !== 'url' || kind === 'activity_package') throw invalid('kind: changing the kind of an uploaded item needs a new file');
    }
    return tx.materialItem.update({
      where: { id: current.id },
      data: {
        ...itemData(f),
        ...(source ? sourceData(source) : { kind }),
        status,
        updatedBy: actor.actorId,
      },
    });
  }

  /** Database refusals as answers. */
  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CommError) throw e;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw invalid('ref: another item already uses this ref', 409);
      }
      const text = e instanceof Error ? e.message : String(e);
      if (/insufficient_privilege|42501/.test(text)) {
        throw new CommError(CommErrorCode.MATERIAL_DENIED, /message: "([^"]+)"/.exec(text)?.[1] ?? 'not permitted');
      }
      if (/23505|23514|check_violation|unique constraint/i.test(text)) {
        throw invalid(/message: "([^"]+)"/.exec(text)?.[1] ?? 'the library does not allow this', 409);
      }
      throw e;
    }
  }
}

// ----------------------------------------------------------------------

interface ImportFile {
  name: string;
  mimeType: string | null;
  byteSize: number | null;
  uploadToken: string | null;
}

function importFiles(raw: unknown): ImportFile[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_IMPORT_ROWS) throw invalid(`files: a list of at most ${MAX_IMPORT_ROWS}`);
  const seen = new Set<string>();
  return raw.map((f, i) => {
    const r = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name) throw invalid(`files[${i}].name: required`);
    if (seen.has(name)) throw invalid(`files: ${name} is listed twice`);
    seen.add(name);
    return {
      name,
      mimeType: typeof r.mimeType === 'string' ? r.mimeType.toLowerCase() : null,
      byteSize: typeof r.byteSize === 'number' ? r.byteSize : null,
      uploadToken: typeof r.uploadToken === 'string' && r.uploadToken ? r.uploadToken : null,
    };
  });
}

function manifestRows(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const m = body.manifest;
  if (typeof m === 'string') {
    if (m.length > 5 * 1024 * 1024) throw invalid('manifest: at most 5 MB');
    if (body.format === 'json' || /^\s*[[{]/.test(m)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(m);
      } catch {
        throw invalid('manifest: not valid JSON');
      }
      return jsonRows(parsed);
    }
    try {
      return parseCsv(m);
    } catch (e) {
      throw invalid(`manifest: ${e instanceof Error ? e.message : 'not valid CSV'}`);
    }
  }
  return jsonRows(m);
}

function jsonRows(parsed: unknown): Array<Record<string, unknown>> {
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items) ? (parsed as { items: unknown[] }).items : null;
  if (!list) throw invalid('manifest: CSV text, a JSON array of items, or {items: [...]}');
  return list.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw invalid(`manifest[${i}]: an object`);
    return r as Record<string, unknown>;
  });
}

async function collect(body: Buffer | AsyncIterable<Uint8Array>, max: number): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > max) throw refused('the package is larger than allowed');
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

function sourceName(v: unknown, required: boolean): string | null {
  if (typeof v !== 'string' || !v.trim()) {
    if (required) throw invalid('name: required');
    return null;
  }
  if (v.trim().length > 120) throw invalid('name: at most 120 characters');
  return v.trim();
}

/** An https URL template with {surah} or {surah3}; null clears it. */
function templateOf(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw invalid('urlTemplate: text');
  const t = v.trim();
  if (!/\{surah3?\}/.test(t)) throw invalid('urlTemplate: must contain {surah} or {surah3}');
  const why = checkHttpsUrl(renderTemplate(t, 1));
  if (why) throw invalid(`urlTemplate: ${why}`);
  return t;
}

export function renderTemplate(template: string, surah: number): string {
  return template.replace(/\{surah3\}/g, String(surah).padStart(3, '0')).replace(/\{surah\}/g, String(surah));
}

function itemData(f: ItemFields) {
  return {
    externalRef: f.externalRef,
    subject: f.subject,
    strand: f.strand,
    titleAr: f.titleAr,
    titleEn: f.titleEn,
    description: f.description,
    ageGroups: f.ageGroups,
    surah: f.surah,
  };
}

function sourceData(s: Source) {
  if (s.source === 'site') {
    return { kind: s.kind, source: 'site', sitePath: s.sitePath, url: null, objectKey: null, mimeType: null, byteSize: null, packageEntry: null };
  }
  return s.source === 'url'
    ? { kind: s.kind, source: 'url', sitePath: null, url: s.url, objectKey: null, mimeType: null, byteSize: null, packageEntry: null }
    : {
        kind: s.kind, source: s.source, sitePath: null, url: null, objectKey: s.objectKey, mimeType: s.mimeType, byteSize: BigInt(s.byteSize),
        packageEntry: s.source === 'package' ? s.packageEntry : null,
      };
}

/** An item as an editable row, for merging a partial change. */
function rowOf(i: MaterialItem): Record<string, unknown> {
  return {
    ref: i.externalRef, title_ar: i.titleAr, title_en: i.titleEn, subject: i.subject, strand: i.strand, kind: i.kind,
    age_groups: i.ageGroups, surah: i.surah, description: i.description, url: i.url, path: i.sitePath, status: i.status,
  };
}

/** What the audit log keeps of an item: its fields, never the storage key. */
function auditView(i: MaterialItem) {
  return {
    externalRef: i.externalRef, subject: i.subject, strand: i.strand, titleAr: i.titleAr, titleEn: i.titleEn, kind: i.kind,
    source: i.source, url: i.url, sitePath: i.sitePath, ageGroups: i.ageGroups, surah: i.surah, status: i.status,
  };
}

/** An item as the library manager sees it. The object key never leaves the server. */
export function adminDto(i: MaterialItem) {
  return {
    id: i.id,
    externalRef: i.externalRef,
    titleAr: i.titleAr,
    titleEn: i.titleEn,
    subject: i.subject,
    strand: i.strand,
    kind: i.kind,
    source: i.source,
    url: i.source === 'url' ? i.url : null,
    sitePath: i.sitePath,
    mimeType: i.mimeType,
    byteSize: i.byteSize === null ? null : Number(i.byteSize),
    packageEntry: i.packageEntry,
    ageGroups: i.ageGroups,
    surah: i.surah,
    description: i.description,
    status: i.status,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}
