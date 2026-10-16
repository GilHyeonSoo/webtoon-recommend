import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { validateAdminConfig } from '../src/security/admin';
import { runExclusive, submitJob, getJob, JobBusy } from '../src/security/jobs';
import { jobSleep } from '../src/security/context';
import { mapConcurrent } from '../src/modules/common/mapConcurrent';

const directory = mkdtempSync(join(tmpdir(), 'webtoon-crawler-security-'));
process.env.SQLITE_PATH = join(directory, 'database.sqlite');
const { AppDataSource } = require('../src/database/datasource');
const { NaverWebtoon } = require('../src/database/entity');
const { recreateNormalizedWebtoonView } = require('../src/database/migrateExtendedFields');
const { createCrawlerApp } = require('../src/app');
const { createUpdateMethod } = require('../src/routes/update/functions/createUpdateMethod');
const { enrichNaverMetadataBatch } = require('../src/modules/naver/enrichNaverMetadataBatch');
let server: ReturnType<ReturnType<typeof createCrawlerApp>['listen']>;
let base: string;
const key = 'test-secret-with-at-least-32-characters';
const headers = { 'x-crawler-secret': key };
const row = { id: 'naver_1', title: 'Test', provider: 'NAVER', updateDays: [], url: 'https://comic.naver.com/webtoon/list?titleId=1', thumbnail: [], isEnd: false, isFree: true, isUpdated: false, ageGrade: 0, freeWaitHour: null, authors: [], synopsis: null, genres: [], tags: [], averageRating: null, primaryGenre: 'unknown', totalEpisodeCount: null, isOnHiatus: null, popularityCount: null };

before(async () => {
  delete process.env.ENABLE_ADMIN_HTTP;
  await AppDataSource.initialize();
  await AppDataSource.synchronize();
  await AppDataSource.query('DROP TABLE normalized_webtoon');
  await recreateNormalizedWebtoonView();
  await AppDataSource.getRepository(NaverWebtoon).save(row);
  const app = createCrawlerApp();
  // Additional test route uses the real update handler and isolated SQLite, no external network.
  app.put('/test-update', createUpdateMethod({ provider: 'NAVER', webtoonCrawler: async () => [row] }));
  app.put('/test-failure', createUpdateMethod({ provider: 'NAVER', webtoonCrawler: async () => { throw new Error('synthetic failure'); } }));
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await AppDataSource.destroy();
  await rm(directory, { recursive: true, force: true });
});

test('disabled admin, missing keys, GET mutation and invalid bounds fail before work', async () => {
  assert.equal((await fetch(base + '/update/naver?force=true', { method: 'PUT' })).status, 404);
  process.env.ENABLE_ADMIN_HTTP = 'true';
  delete process.env.CRAWLER_ADMIN_SECRET;
  assert.throws(validateAdminConfig);
  assert.equal((await fetch(base + '/update/naver', { method: 'PUT' })).status, 401);
  process.env.CRAWLER_ADMIN_SECRET = key;
  for (const q of ['perPage=-1', 'perPage=0', 'perPage=1.5', 'perPage=Infinity', 'page=0', 'perPage=1&perPage=2', 'keyword[]=x']) {
    assert.equal((await fetch(base + '/webtoons?' + q)).status, 400, q);
  }
  for (const q of ['limit=-1', 'limit=0', 'limit=501', 'delayMs=0', 'delayMs=199', 'delayMs=5001']) {
    assert.equal((await fetch(base + '/enrich/naver?' + q, { method: 'PUT', headers })).status, 400, q);
  }
  assert.equal((await fetch(base + '/webtoons/naver_1?persist=true')).status, 400);
  assert.equal((await fetch(base + '/webtoons/naver_1?enrich=true')).status, 400);
  assert.equal((await fetch(base + '/webtoons?perPage=1')).status, 200);
  const plain = await fetch(base + '/webtoons/naver_1');
  assert.equal(plain.status, 200); assert.equal((await plain.json()).webtoon.id, 'naver_1');
  const status = await fetch(base + '/health-check');
  assert.equal(status.status, 200); assert.deepEqual(await status.json(), []);
  assert.equal(existsSync(process.env.SQLITE_PATH + '.job.lock'), false);
  await assert.rejects(enrichNaverMetadataBatch({ limit: -1, delayMs: 200 }));
});

async function completed(id: string) {
  for (let i = 0; i < 200; i++) { const job = getJob(id); if (job?.state !== 'running') return job; await delay(5); }
  throw new Error('Job did not settle');
}
test('authenticated update commits and failures are recorded without unhandled rejection', async () => {
  const ok = await fetch(base + '/test-update?force=true', { method: 'PUT', headers });
  assert.equal(ok.status, 202);
  const first = await completed((await ok.json()).job.id); assert.equal(first.state, 'succeeded');
  const failure = await fetch(base + '/test-failure?force=true', { method: 'PUT', headers });
  assert.equal(failure.status, 202);
  const second = await completed((await failure.json()).job.id); assert.equal(second.state, 'failed');
  assert.equal(existsSync(process.env.SQLITE_PATH + '.job.lock'), false);
  const recover = await fetch(base + '/test-update?force=true', { method: 'PUT', headers });
  assert.equal((await completed((await recover.json()).job.id)).state, 'succeeded');
});

test('exclusive jobs reject overlap, abort deadlines and release file leases after settlement', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const job = await submitJob('test-hold', () => gate);
  await assert.rejects(submitJob('duplicate', async () => {}), JobBusy);
  release(); await completed(job.id);
  await assert.rejects(runExclusive(() => jobSleep(1000), 10));
  assert.equal(existsSync(process.env.SQLITE_PATH + '.job.lock'), false);
  await runExclusive(async () => {});
});

test('transaction start failure is captured, connection released and a later job succeeds', async () => {
  const original = AppDataSource.createQueryRunner.bind(AppDataSource);
  let starts = 0, releases = 0;
  AppDataSource.createQueryRunner = (...args: any[]) => {
    const runner = original(...args);
    const start = runner.startTransaction.bind(runner);
    const release = runner.release.bind(runner);
    runner.startTransaction = async (...parameters: any[]) => {
      if (++starts === 2) throw new Error('Synthetic transaction start failure');
      return start(...parameters);
    };
    runner.release = async () => { releases++; return release(); };
    return runner;
  };
  try {
    const response = await fetch(base + '/test-update?force=true', { method: 'PUT', headers });
    assert.equal(response.status, 202);
    assert.equal((await completed((await response.json()).job.id)).state, 'failed');
    assert.ok(releases > 0);
  } finally { AppDataSource.createQueryRunner = original; }
  assert.equal(existsSync(process.env.SQLITE_PATH + '.job.lock'), false);
  const recovery = await fetch(base + '/test-update?force=true', { method: 'PUT', headers });
  assert.equal((await completed((await recovery.json()).job.id)).state, 'succeeded');
});

test('bounded mapper waits for active failures and never exceeds its configured concurrency', async () => {
  let active = 0, peak = 0;
  const result = await mapConcurrent(Array.from({ length: 30 }, (_, i) => i), 3, async (i) => {
    active++; peak = Math.max(peak, active);
    try { await delay(1); return i * 2; } finally { active--; }
  });
  assert.equal(peak, 3); assert.equal(active, 0); assert.equal(result[29], 58);
  await assert.rejects(mapConcurrent([1, 2, 3, 4], 2, async (i) => {
    active++; try { if (i === 1) throw new Error('failed'); await delay(10); return i; } finally { active--; }
  }));
  assert.equal(active, 0);
});
