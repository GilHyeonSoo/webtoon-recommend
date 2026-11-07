import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import sqlite3 from 'sqlite3';
import { crawlThumbnails, planThumbnails, type CrawlOptions } from '../src/modules/thumbnails/engine';
import { downloadImage, imageExtension, validateImageUrl, createRequestGate } from '../src/modules/thumbnails/download';
import { readCatalogWorks, readSqliteWorks, type ThumbnailWork } from '../src/modules/thumbnails/source';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64');
const imageUrl = 'https://image-comic.pstatic.net/webtoon/1/thumbnail.jpg';
const work = (id = 'naver_1', thumbnail = [imageUrl]): ThumbnailWork => ({ id, title: '테스트 작품', provider: 'NAVER', thumbnail });
const imageResponse = () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
const fetcher = (fn: (...args: any[]) => Promise<Response>) => fn as typeof fetch;
async function temporary(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'webtoon-thumbnails-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const config = (outputDir: string, overrides: Partial<CrawlOptions> = {}): CrawlOptions => ({
  outputDir, source: 'test', concurrency: 2, delayMs: 0, retries: 0, timeoutMs: 1000,
  fetcher: fetcher(async () => imageResponse()), ...overrides,
});
const downloadOptions = (fn: typeof fetch, overrides = {}) => ({
  timeoutMs: 1000, retries: 0, maxBytes: 1024, signal: new AbortController().signal,
  beforeRequest: async () => {}, fetcher: fn, ...overrides,
});
const execute = promisify(execFile);
const projectRoot = path.resolve(__dirname, '../..');
const launcher = path.join(projectRoot, 'scripts/crawl-thumbnails.mjs');

test('CLI defaults to Backend JSON from any working directory and ignores SQLITE_PATH', async () => temporary(async (dir) => {
  const catalog = path.join(projectRoot, 'Backend/data/webtoons.json');
  const original = await readFile(catalog);
  const rows = await readCatalogWorks(catalog);
  const output = path.join(dir, 'images');
  const { stdout } = await execute(process.execPath, [launcher, '--dry-run', '--output', output], {
    cwd: dir, env: { ...process.env, SQLITE_PATH: path.join(dir, 'missing.sqlite') },
  });
  assert.ok(stdout.includes(`입력: catalog:${catalog}`));
  for (const provider of ['NAVER', 'KAKAO']) {
    assert.ok(stdout.includes(`${provider}: ${rows.filter((row) => row.provider === provider).length}작품`));
  }
  assert.equal(stdout.includes('KAKAO_PAGE:'), false);
  assert.deepEqual(await readFile(catalog), original);
  assert.deepEqual(await readdir(dir), []);
}));

test('CLI excludes Kakao Page in a mixed JSON catalog and rejects explicit selection', async () => temporary(async (dir) => {
  const catalog = path.join(dir, 'catalog.json');
  await writeFile(catalog, JSON.stringify([
    work(), { ...work('kakao_2'), provider: 'KAKAO' }, { ...work('kakopage_3'), provider: 'KAKAO_PAGE' },
  ]));
  const args = [launcher, '--catalog', catalog, '--dry-run', '--output', path.join(dir, 'images')];
  const { stdout } = await execute(process.execPath, args, { cwd: dir });
  assert.ok(stdout.includes('NAVER: 1작품'));
  assert.ok(stdout.includes('KAKAO: 1작품'));
  assert.ok(stdout.includes('전체 2작품 / 2이미지'));
  assert.equal(stdout.includes('KAKAO_PAGE:'), false);
  await assert.rejects(execute(process.execPath, [...args, '--provider', 'KAKAO_PAGE'], { cwd: dir }), (error: any) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /카카오페이지는 수집 대상에서 제외/);
    return true;
  });
  assert.deepEqual(await readdir(dir), ['catalog.json']);
}));

test('CLI reports a missing catalog without falling back to the available SQLite DB', async () => temporary(async (dir) => {
  await assert.rejects(execute(process.execPath, [launcher, '--catalog', path.join(dir, 'missing.json'), '--dry-run'], {
    cwd: dir, env: { ...process.env, SQLITE_PATH: path.join(projectRoot, 'KOREA_WEBTOON_API/database.sqlite') },
  }), (error: any) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /ENOENT/);
    assert.equal(error.stdout.includes('입력: sqlite:'), false);
    return true;
  });
  assert.deepEqual(await readdir(dir), []);
}));

test('SQLite source reads all provider tables read-only without creating a missing DB', async () => temporary(async (dir) => {
  const filename = path.join(dir, 'catalog.sqlite');
  const db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const connection = new sqlite3.Database(filename, (error) => error ? reject(error) : resolve(connection));
  });
  const run = (sql: string, args: unknown[] = []) => new Promise<void>((resolve, reject) => db.run(sql, args, (error) => error ? reject(error) : resolve()));
  for (const [table, provider, id] of [
    ['naver_webtoon', 'NAVER', 'naver_1'], ['kakao_webtoon', 'KAKAO', 'kakao_2'], ['kakao_page_webtoon', 'KAKAO_PAGE', 'kakopage_3'],
  ]) {
    await run(`CREATE TABLE ${table} (id TEXT, title TEXT, provider TEXT, thumbnail TEXT)`);
    await run(`INSERT INTO ${table} VALUES (?, ?, ?, ?)`, [id, '제목', provider, `${imageUrl},${imageUrl}?second=1`]);
  }
  await new Promise<void>((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
  const before = await readFile(filename);
  const rows = await readSqliteWorks(filename);
  assert.equal(rows.length, 3);
  assert.equal(planThumbnails(rows).length, 6);
  assert.deepEqual(await readFile(filename), before);
  await assert.rejects(readSqliteWorks(path.join(dir, 'missing.sqlite')), /SQLITE_CANTOPEN/);
  assert.equal((await readdir(dir)).includes('missing.sqlite'), false);
}));

test('JSON source supports runtime arrays, export wrappers, empty thumbnails and duplicates', async () => temporary(async (dir) => {
  const filename = path.join(dir, 'catalog.json');
  await writeFile(filename, JSON.stringify({ webtoons: [work(), work('naver_2', []), work('naver_3', [imageUrl, imageUrl])] }));
  const rows = await readCatalogWorks(filename);
  assert.equal(rows.length, 3); assert.equal(rows[2].thumbnail.length, 1);
  assert.equal(planThumbnails(rows).filter((item) => item.status === 'missing').length, 1);
  await writeFile(filename, JSON.stringify([work(), work()]));
  await assert.rejects(readCatalogWorks(filename), /Duplicate/);
}));

test('saves real image bytes, resumes without network, and repairs changed or corrupt files', async () => temporary(async (dir) => {
  let requests = 0;
  const options = config(dir, { fetcher: fetcher(async () => { requests++; return imageResponse(); }) });
  const first = await crawlThumbnails([work()], options);
  assert.equal(first.summary.downloaded, 1);
  assert.match(first.items[0].file, /^NAVER\/naver_1\/01-[a-f0-9]+\.png$/);
  const filename = path.join(dir, first.items[0].file);
  assert.deepEqual(await readFile(filename), png);
  const second = await crawlThumbnails([work()], options);
  assert.equal(second.summary.skipped, 1); assert.equal(requests, 1);
  // Retain valid signature and size: stored checksum must still detect a modified image.
  const altered = Buffer.from(png); altered[40] ^= 1;
  await writeFile(filename, altered);
  assert.equal((await crawlThumbnails([work()], options)).summary.downloaded, 1);
  assert.equal(requests, 2);
  await writeFile(filename, 'invalid');
  assert.equal((await crawlThumbnails([work()], options)).summary.downloaded, 1);
  assert.equal(requests, 3);
  assert.equal((await crawlThumbnails([work('naver_1', [imageUrl + '?new=1'])], options)).summary.downloaded, 1);
  assert.equal(requests, 4);
  assert.equal((await readdir(dir)).includes('.crawl.lock'), false);
  assert.equal((await readdir(dir)).includes('progress.jsonl'), false);
}));

test('downloads every image, bounds concurrency and contains unusual IDs under the output folder', async () => temporary(async (dir) => {
  let active = 0, peak = 0;
  const result = await crawlThumbnails([work('../../escape', [imageUrl, imageUrl + '?a=2', imageUrl + '?a=3'])], config(dir, {
    fetcher: fetcher(async () => { active++; peak = Math.max(peak, active); await sleep(5); active--; return imageResponse(); }),
  }));
  assert.equal(result.summary.downloaded, 3); assert.equal(peak, 2);
  for (const item of result.items) {
    assert.equal(path.resolve(dir, item.file).startsWith(dir + path.sep), true);
    assert.equal(item.file.includes('..'), false);
  }
}));

test('records missing URLs and permanent failures while saving other works; failed items retry on rerun', async () => temporary(async (dir) => {
  const works = [work('ok'), work('fail', [imageUrl + '?fail=1']), work('missing', [])];
  let requests = 0;
  const first = await crawlThumbnails(works, config(dir, { fetcher: fetcher(async (url) => {
    requests++;
    return String(url).includes('fail') ? new Response('missing', { status: 404 }) : imageResponse();
  }), retries: 2 }));
  assert.deepEqual([first.summary.downloaded, first.summary.failed, first.summary.missing, requests], [1, 1, 1, 2]);
  assert.match(first.items.find((item) => item.status === 'failed').error, /HTTP 404/);
  const second = await crawlThumbnails(works, config(dir));
  assert.deepEqual([second.summary.downloaded, second.summary.skipped, second.summary.failed], [1, 1, 0]);
}));

test('force redownloads cached files and output locks reject concurrent runs', async () => temporary(async (dir) => {
  await crawlThumbnails([work()], config(dir));
  assert.equal((await crawlThumbnails([work()], config(dir, { force: true }))).summary.downloaded, 1);
  await writeFile(path.join(dir, '.crawl.lock'), 'other process');
  await assert.rejects(crawlThumbnails([work()], config(dir)), /locked/);
  assert.equal(await readFile(path.join(dir, '.crawl.lock'), 'utf8'), 'other process');
}));

test('large batches checkpoint changed records and consolidate the final manifest', async () => temporary(async (dir) => {
  let checkpoints = 0;
  const works = Array.from({ length: 60 }, (_, index) => work(`naver_batch_${index}`));
  const manifest = await crawlThumbnails(works, config(dir, {
    onProgress(summary) {
      if (summary.pending > 0) {
        const lines = readFileSync(path.join(dir, 'progress.jsonl'), 'utf8').trim().split('\n');
        assert.ok(lines.length >= 25);
        assert.ok(lines.every((line) => JSON.parse(line).status === 'downloaded'));
        checkpoints++;
      }
    },
  }));
  assert.ok(checkpoints >= 1); assert.equal(manifest.summary.downloaded, 60);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')).items.length, 60);
  assert.equal((await readdir(dir)).includes('progress.jsonl'), false);
}));

test('disk errors stop the run and release the lease instead of reporting a remote failure', async () => temporary(async (dir) => {
  await writeFile(path.join(dir, 'NAVER'), 'directory is blocked by a file');
  await assert.rejects(crawlThumbnails([work('one'), work('two')], config(dir)), /ENOTDIR|EEXIST/);
  const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.state, 'failed'); assert.equal(manifest.summary.failed, 0);
  assert.equal((await readdir(dir)).includes('.crawl.lock'), false);
}));

test('cancellation leaves interrupted items pending and releases the lease after workers settle', async () => temporary(async (dir) => {
  const controller = new AbortController();
  const manifest = await crawlThumbnails([work('one'), work('two'), work('three')], config(dir, {
    signal: controller.signal,
    fetcher: fetcher(async (_url, options) => {
      controller.abort();
      options.signal.throwIfAborted();
      return imageResponse();
    }),
  }));
  assert.equal(manifest.state, 'cancelled'); assert.equal(manifest.summary.pending, 3);
  const resumed = await crawlThumbnails([work('one'), work('two'), work('three')], config(dir));
  assert.equal(resumed.summary.downloaded, 3);
}));

test('recovers journal checksums after a crash and ignores the incomplete last line', async () => temporary(async (dir) => {
  const manifest = await crawlThumbnails([work()], config(dir));
  const record = manifest.items[0];
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, items: [] }));
  await writeFile(path.join(dir, 'progress.jsonl'), JSON.stringify(record) + '\n{"incomplete":');
  const altered = Buffer.from(png); altered[40] ^= 1;
  await writeFile(path.join(dir, record.file), altered);
  const repaired = await crawlThumbnails([work()], config(dir));
  assert.equal(repaired.summary.downloaded, 1);
  assert.deepEqual(await readFile(path.join(dir, repaired.items[0].file)), png);
}));

test('rejects unsafe source and redirect hosts before fetching them', async () => {
  for (const url of ['http://image-comic.pstatic.net/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://image-comic.pstatic.net.evil.test/a', 'https://user:pass@image-comic.pstatic.net/a']) {
    assert.throws(() => validateImageUrl(url));
  }
  let requests = 0;
  await assert.rejects(downloadImage(imageUrl, 'NAVER', downloadOptions(fetcher(async () => {
    requests++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  }))), /Unsupported image URL/);
  assert.equal(requests, 1);
});

test('rejects HTML, oversized streams, incomplete bodies and truncated images', async () => {
  assert.throws(() => imageExtension(png.subarray(0, 40)), /not a supported image/);
  const cases = [
    new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } }),
    new Response(png, { headers: { 'content-length': '50000' } }),
    new Response(png, { headers: { 'content-length': String(png.length + 1) } }),
    new Response(Buffer.alloc(1025)),
  ];
  for (const response of cases) await assert.rejects(downloadImage(imageUrl, 'NAVER', downloadOptions(fetcher(async () => response))));
});

test('retries transient failures and sends the provider referer', async () => {
  let requests = 0;
  const result = await downloadImage(imageUrl, 'NAVER', downloadOptions(fetcher(async (_url, options) => {
    assert.equal(options.headers.referer, 'https://comic.naver.com/');
    requests++;
    return requests === 1 ? new Response('retry', { status: 503 }) : imageResponse();
  }), { retries: 1 }));
  assert.equal(result.attempts, 2); assert.equal(requests, 2); assert.equal(result.extension, 'png');
});

test('request timeout cancels a stalled response body, and rate limiting spaces concurrent starts', async () => {
  const stalled = fetcher(async (_url, options) => new Response(new ReadableStream({
    start(controller) { options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true }); },
  })));
  await assert.rejects(downloadImage(imageUrl, 'NAVER', downloadOptions(stalled, { timeoutMs: 100 })), /timeout/i);
  const gate = createRequestGate(20, new AbortController().signal);
  const starts: number[] = [];
  await Promise.all(Array.from({ length: 3 }, async () => { await gate(); starts.push(Date.now()); }));
  assert.ok(starts[1] - starts[0] >= 15); assert.ok(starts[2] - starts[1] >= 15);
});
