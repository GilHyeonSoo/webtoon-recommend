import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequestGate, downloadImage, imageExtension } from './download';
import type { ThumbnailProvider, ThumbnailWork } from './source';

type ItemStatus = 'pending' | 'downloaded' | 'skipped' | 'failed' | 'missing';
export type ThumbnailItem = {
  key: string;
  id: string;
  title: string;
  provider: ThumbnailProvider;
  index: number;
  url: string | null;
  status: ItemStatus;
  file?: string;
  bytes?: number;
  sha256?: string;
  error?: string;
};
export type CrawlSummary = {
  works: number;
  images: number;
  downloaded: number;
  skipped: number;
  failed: number;
  missing: number;
  pending: number;
  bytesDownloaded: number;
};
export type ThumbnailManifest = {
  version: 1;
  source: string;
  startedAt: string;
  updatedAt: string;
  state: 'running' | 'completed' | 'cancelled' | 'failed';
  summary: CrawlSummary;
  items: ThumbnailItem[];
};

export const crawlDefaults = {
  concurrency: 4,
  delayMs: 200,
  timeoutMs: 20_000,
  retries: 2,
  maxBytes: 20 * 1024 * 1024,
};
export type CrawlOptions = Partial<typeof crawlDefaults> & {
  outputDir: string;
  source: string;
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: (summary: CrawlSummary) => void;
  fetcher?: typeof fetch;
};

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const extensions = ['jpg', 'png', 'webp', 'gif', 'avif'];
function workDirectory(id: string): string {
  if (/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return id;
  return `${id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}-${hash(id).slice(0, 16)}`;
}

export function summarize(works: number, items: ThumbnailItem[]): CrawlSummary {
  const summary: CrawlSummary = { works, images: 0, downloaded: 0, skipped: 0, failed: 0, missing: 0, pending: 0, bytesDownloaded: 0 };
  for (const item of items) {
    if (item.url !== null) summary.images++;
    summary[item.status]++;
    if (item.status === 'downloaded') summary.bytesDownloaded += item.bytes ?? 0;
  }
  return summary;
}

export function planThumbnails(works: ThumbnailWork[]): ThumbnailItem[] {
  return works.flatMap((work) => (work.thumbnail.length ? work.thumbnail : [null]).map((url, index) => ({
    key: JSON.stringify([work.provider, work.id, index]),
    id: work.id,
    title: work.title,
    provider: work.provider,
    index,
    url,
    status: url === null ? 'missing' as const : 'pending' as const,
    ...(url === null ? { error: 'No thumbnail URL in source' } : {}),
  })));
}

async function readPrevious(filename: string): Promise<Map<string, ThumbnailItem>> {
  try {
    const previous = JSON.parse(await readFile(filename, 'utf8')) as ThumbnailManifest;
    if (previous.version !== 1 || !Array.isArray(previous.items)) throw new Error('Invalid thumbnail manifest');
    return new Map(previous.items.map((item) => [item.key, item]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw error;
  }
}

async function readJournal(filename: string, previous: Map<string, ThumbnailItem>) {
  let data: string;
  try { data = await readFile(filename, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  // A killed process may leave an incomplete last line. Only newline-terminated records are committed.
  for (const line of data.slice(0, data.lastIndexOf('\n') + 1).split('\n').filter(Boolean)) {
    const item = JSON.parse(line) as ThumbnailItem;
    if (typeof item.key !== 'string') throw new Error('Invalid thumbnail progress record');
    previous.set(item.key, item);
  }
}

async function atomicWrite(filename: string, bytes: string | Buffer) {
  const temporary = `${filename}.${randomUUID()}.part`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, filename);
  } finally { await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function crawlThumbnails(works: ThumbnailWork[], options: CrawlOptions): Promise<ThumbnailManifest> {
  const config = { ...crawlDefaults, ...options };
  for (const [key, min, max] of [
    ['concurrency', 1, 16], ['delayMs', 0, 60_000], ['timeoutMs', 100, 120_000],
    ['retries', 0, 5], ['maxBytes', 1, 100 * 1024 * 1024],
  ] as const) {
    if (!Number.isSafeInteger(config[key]) || config[key] < min || config[key] > max) throw new Error(`Invalid ${key}`);
  }
  const outputDir = path.resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const lockPath = path.join(outputDir, '.crawl.lock');
  let lock: Awaited<ReturnType<typeof open>>;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Thumbnail output is locked: ${lockPath}. If no crawler is running, remove the stale lock and retry.`);
    }
    throw error;
  }
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const filename = path.join(outputDir, 'manifest.json');
  const journal = path.join(outputDir, 'progress.jsonl');
  let manifest: ThumbnailManifest | undefined;
  let checkpoint = Promise.resolve();
  const save = () => {
    // Serialize at execution time, so an older write can never replace a newer checkpoint.
    checkpoint = checkpoint.then(async () => {
      manifest.updatedAt = new Date().toISOString();
      manifest.summary = summarize(works.length, manifest.items);
      await atomicWrite(filename, `${JSON.stringify(manifest, null, 2)}\n`);
    });
    return checkpoint;
  };
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const previous = await readPrevious(filename);
    await readJournal(journal, previous);
    const items = planThumbnails(works);
    for (const item of items) {
      const known = previous.get(item.key);
      if (known?.url === item.url && known.sha256) {
        Object.assign(item, { file: known.file, bytes: known.bytes, sha256: known.sha256 });
      }
    }
    manifest = {
      version: 1, source: options.source, startedAt: new Date().toISOString(), updatedAt: '',
      state: 'running', summary: summarize(works.length, items), items,
    };
    await save();
    // Compact old progress only after its checksums are captured in the new manifest.
    await atomicWrite(journal, '');
    let journalWrites = Promise.resolve();
    const changes: string[] = [];
    const flushJournal = () => {
      const data = changes.splice(0).join('');
      if (data) journalWrites = journalWrites.then(() => appendFile(journal, data));
      return journalWrites;
    };
    const beforeRequest = createRequestGate(config.delayMs, signal);
    let cursor = 0;
    let processed = 0;
    let fatal: unknown;
    const runItem = async (item: ThumbnailItem) => {
      const directory = path.join(item.provider, workDirectory(item.id));
      const basename = `${String(item.index + 1).padStart(2, '0')}-${hash(item.url).slice(0, 16)}`;
      if (!options.force) {
        const known = previous.get(item.key);
        for (const extension of extensions) {
          const file = path.join(directory, `${basename}.${extension}`);
          let bytes: Buffer;
          try { bytes = await readFile(path.join(outputDir, file)); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
          let actualExtension: string;
          try { actualExtension = imageExtension(bytes); } catch { continue; }
          const sha256 = hash(bytes);
          if (actualExtension !== extension || bytes.length > config.maxBytes) continue;
          if (known?.url === item.url && known.sha256 && (known.sha256 !== sha256 || known.bytes !== bytes.length)) continue;
          Object.assign(item, { status: 'skipped', file: file.split(path.sep).join('/'), bytes: bytes.length, sha256 });
          return;
        }
      }
      let downloaded: Awaited<ReturnType<typeof downloadImage>>;
      try {
        downloaded = await downloadImage(item.url, item.provider, {
          ...config, signal, beforeRequest, fetcher: options.fetcher,
        });
      } catch (error) {
        if (signal.aborted) return; // Keep interrupted work pending for the next run.
        item.status = 'failed';
        item.error = error instanceof Error ? error.message : String(error);
        return;
      }
      // Disk failures must stop the run; they are not remote image failures.
      const file = path.join(directory, `${basename}.${downloaded.extension}`);
      await mkdir(path.join(outputDir, directory), { recursive: true });
      await atomicWrite(path.join(outputDir, file), downloaded.bytes);
      Object.assign(item, {
        status: 'downloaded', file: file.split(path.sep).join('/'), bytes: downloaded.bytes.length, sha256: hash(downloaded.bytes),
      });
    };
    await Promise.all(Array.from({ length: Math.min(config.concurrency, items.length) }, async () => {
      try {
        while (!signal.aborted) {
          const item = items[cursor++];
          if (!item) break;
          if (item.url !== null) await runItem(item);
          changes.push(`${JSON.stringify(item)}\n`);
          processed++;
          if (processed % 25 === 0) {
            // Append only changed records; avoid rewriting tens of thousands of rows per batch.
            await flushJournal();
            manifest.summary = summarize(works.length, items);
            options.onProgress?.(manifest.summary);
          }
        }
      } catch (error) { fatal ??= error; controller.abort(error); }
    }));
    // Every worker has settled before releasing the output lease or saving the final result.
    await flushJournal().catch((error) => { fatal ??= error; });
    manifest.state = fatal ? 'failed' : signal.aborted ? 'cancelled' : 'completed';
    await save();
    await unlink(journal);
    options.onProgress?.(manifest.summary);
    if (fatal) throw fatal;
    return manifest;
  } finally {
    try { await lock.close(); } finally { await unlink(lockPath); }
  }
}
