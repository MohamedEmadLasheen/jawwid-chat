import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { CommError, CommErrorCode } from '../platform/errors';
import type { ExportInput } from './whiteboard-export';

/**
 * PD-39 (review of #305, P0): a board export is made in a worker thread with
 * its own memory limits and a time limit. The pages are a client's bytes and
 * the PDF library's PNG reader can throw where nothing catches it; in a
 * worker that ends the worker -- the API answers "could not be made" and goes
 * on serving everyone else.
 *
 * The worker loads whiteboard-export by path: the compiled .js in the image,
 * the .ts source under the tests (Node 24 strips its types). That module has
 * no relative imports, so it loads the same either way.
 */

const MODULE = join(__dirname, __filename.endsWith('.ts') ? 'whiteboard-export.ts' : 'whiteboard-export.js');
const FONT = join(__dirname, '..', '..', 'assets', 'fonts', 'IBMPlexSansArabic-Regular.ttf');

/** How long one export may take, and the worker's heap. Buffers outside the heap are bounded by the page and export byte caps. */
export const EXPORT_TIMEOUT_MS = 30_000;
const LIMITS = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 };

const SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads');
const m = require(workerData.module);
// The pages arrive as transferred ArrayBuffers: viewed, not copied.
m.checkAndCompose({ ...workerData.input, pages: workerData.input.pages.map((p) => Buffer.from(p)) })
  .then((out) => {
    if (!out.pdf) return parentPort.postMessage(out);
    // The PDF goes back transferred too: one exact-size buffer, moved, not cloned.
    const pdf = out.pdf.buffer.byteLength === out.pdf.length && out.pdf.byteOffset === 0
      ? out.pdf.buffer
      : out.pdf.buffer.slice(out.pdf.byteOffset, out.pdf.byteOffset + out.pdf.length);
    parentPort.postMessage({ pdf }, [pdf]);
  })
  .catch((e) => parentPort.postMessage({ failed: String(e && e.message || e) }));
`;

export type ExportJob = Omit<ExportInput, 'font'>;

/**
 * At most 2 export workers at once in this API process, and 4 more exports
 * waiting their turn; past that an export is refused with 429 at once
 * (review of #305): a burst of exports cannot take the process's memory or
 * CPU from everyone else.
 */
export const EXPORT_WORKERS = 2;
export const EXPORT_QUEUE = 4;
let running = 0;
const waiting: Array<() => void> = [];

/**
 * A worker slot, taken (or waited for) BEFORE any page is read: the caller
 * releases it when its export is done, made or not.
 */
export async function acquireExportSlot(): Promise<() => void> {
  await acquire();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}

async function acquire(): Promise<void> {
  if (running < EXPORT_WORKERS) {
    running += 1;
    return;
  }
  if (waiting.length >= EXPORT_QUEUE) {
    throw new CommError(CommErrorCode.WHITEBOARD_LIMIT, 'many exports are being made right now; try again in a minute', 429, { limit: 'exports' });
  }
  // The slot is handed over by release(): `running` stays as it is.
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
}

/** For tests: the slots in use and the exports waiting. */
export const exportSlots = () => ({ running, waiting: waiting.length });

/** A slot, then the worker: for a caller with nothing to read first. */
export async function composeInWorker(job: ExportJob, opts: { timeoutMs?: number; module?: string } = {}): Promise<Buffer> {
  const releaseSlot = await acquireExportSlot();
  try {
    return await runExportWorker(job, opts);
  } finally {
    releaseSlot();
  }
}

/** The worker itself; the caller holds a slot (acquireExportSlot). */
export function runExportWorker(job: ExportJob, opts: { timeoutMs?: number; module?: string } = {}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const unusable = () => new CommError(CommErrorCode.WHITEBOARD_LIMIT, 'this export could not be made; export fewer pages, or try again', 409, { limit: 'exports' });
    // The pages are MOVED to the worker (review of #325): each is copied once into
    // a buffer of its own, which is transferred, not cloned. With 2 workers at a
    // time per process, an export's pages are held at most twice, briefly.
    const pages = job.pages.map((p) => p.buffer.slice(p.byteOffset, p.byteOffset + p.length) as ArrayBuffer);
    const worker = new Worker(SCRIPT, {
      eval: true,
      resourceLimits: LIMITS,
      workerData: { module: opts.module ?? MODULE, input: { ...job, font: FONT, pages } },
      transferList: pages,
    });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      void worker.terminate();
    };
    const timer = setTimeout(() => finish(() => reject(unusable())), opts.timeoutMs ?? EXPORT_TIMEOUT_MS);
    worker.on('message', (out: { pdf?: ArrayBuffer; refused?: string; failed?: string }) => {
      // A view on the transferred buffer: no copy.
      if (out.pdf) finish(() => resolve(Buffer.from(out.pdf as ArrayBuffer)));
      else if (out.refused) finish(() => reject(new CommError(CommErrorCode.WHITEBOARD_INVALID, out.refused as string, 422)));
      else finish(() => reject(unusable()));
    });
    // A fault the module could not catch (an async throw, out of memory) ends the worker, never the API.
    worker.on('error', () => finish(() => reject(unusable())));
    worker.on('exit', () => finish(() => reject(unusable())));
  });
}
