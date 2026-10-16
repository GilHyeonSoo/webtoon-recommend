import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { RecommendationPool, ServiceBusy } from '../src/lib/recommendationPool.js';
import { createLocalCatalogRepository } from '../src/lib/localCatalog.js';
import { assertCatalogItem, safeCatalogUrl } from '../src/lib/catalogValidation.js';
import { readFile } from 'node:fs/promises';

test('HTTP limits reject spoofed IPs, unexpected origins and oversized bodies; seed is absent', async () => {
  const repository = { async list() { return { webtoons: [], total: 0 }; }, async find() { return null; } };
  const app = createApp(repository);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const allowed = await fetch(base + '/health', { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const denied = await fetch(base + '/health', { headers: { Origin: 'https://unrelated.vercel.app' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    assert.equal(denied.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(denied.headers.get('x-powered-by'), null);
    assert.equal((await fetch(base + '/internal/seed-webtoons', { method: 'POST' })).status, 404);
    const oversized = await fetch(base + '/api/webtoons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'a'.repeat(2_100_000) }) });
    assert.equal(oversized.status, 413);
    for (let i = 0; i < 3; i++) {
      const response = await fetch(base + '/api/recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `192.0.2.${i}` }, body: '{}' });
      assert.equal(response.status, 400);
    }
    const limited = await fetch(base + '/api/recommendations', { method: 'POST', headers: { 'X-Forwarded-For': '192.0.2.99' } });
    assert.equal(limited.status, 429); assert.ok(limited.headers.get('retry-after'));
    assert.equal((await fetch(base + '/health')).status, 200);
  } finally { await app.locals.close(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('worker queue is bounded, timeout terminates work and permits recovery', async () => {
  const pool = new RecommendationPool(0, 30, new URL('./slow-worker.mjs', import.meta.url));
  try {
    await pool.prepare([]);
    const first = pool.run([], [], 1);
    const rejection = assert.rejects(first, ServiceBusy);
    await assert.rejects(pool.run([], [], 1), ServiceBusy);
    await rejection;
    assert.equal(pool.waiting, 0); assert.equal(pool.ready, false);
    await pool.prepare([]); assert.equal(pool.ready, true);
    const controller = new AbortController();
    const canceled = pool.run([], [], 1, undefined, [], controller.signal);
    const canceledRejection = assert.rejects(canceled, ServiceBusy);
    controller.abort(); await canceledRejection;
    assert.equal(pool.waiting, 0);
  } finally { await pool.close(); }
});

test('catalog schema accepts every bundled work and rejects hostile links and field shapes', async () => {
  const source = JSON.parse(await readFile(new URL('../data/webtoons.json', import.meta.url), 'utf8'));
  source.forEach(assertCatalogItem);
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'https://comic.naver.com.attacker.invalid/webtoon/list?titleId=1', 'https://attacker.invalid/', 'https://user@comic.naver.com/webtoon/list?titleId=1', 'https://comic.naver.com:444/webtoon/list?titleId=1']) {
    assert.equal(safeCatalogUrl(url, 'NAVER'), false);
    assert.throws(() => assertCatalogItem({ ...source[0], provider: 'NAVER', url }));
  }
  assert.throws(() => assertCatalogItem({ ...source[0], tags: 'not-an-array' }));
  assert.throws(() => assertCatalogItem({ ...source[0], thumbnail: ['https://attacker.invalid/pixel'] }));
  assert.throws(() => assertCatalogItem({ ...source[0], synopsis: 'x'.repeat(10001) }));
  assert.equal('seed' in await createLocalCatalogRepository(), false);
});
