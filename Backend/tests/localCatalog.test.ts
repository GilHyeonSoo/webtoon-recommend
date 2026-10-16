import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createLocalCatalogRepository, localCatalogFile, titleMatchesQuery } from '../src/lib/localCatalog.js';
import type { WebtoonDto } from '../src/lib/mapWebtoon.js';
import { normalizeText, recommendSimilar } from '../src/lib/similarity.js';

test('local catalog searches, paginates and finds the bundled backend JSON', async () => {
  const source: WebtoonDto[] = JSON.parse(await readFile(localCatalogFile, 'utf8'));
  const repository = await createLocalCatalogRepository();
  const first = await repository.list({ limit: 2, offset: 0 });
  const next = await repository.list({ limit: 2, offset: 2 });
  assert.equal(first.total, source.length);
  assert.equal(first.webtoons.length, Math.min(2, source.length));
  assert.ok(next.webtoons.every((item) => !first.webtoons.some((previous) => previous.id === item.id)));
  const expected = source.find((item) => item.title.includes('외모'))!;
  const search = await repository.list({ q: '외모', provider: 'NAVER', limit: 12, offset: 0 });
  assert.equal(search.total, source.filter((item) => item.provider === 'NAVER' && titleMatchesQuery(item.title, '외모')).length);
  assert.ok(search.webtoons.some((item) => item.id === expected.id));
  assert.deepEqual(await repository.find(expected.id), expected);
  assert.equal(await repository.find('missing'), null);
  for (const q of ['%', '_']) assert.equal((await repository.list({ q, limit: 12, offset: 0 })).total, source.filter((item) => titleMatchesQuery(item.title, q)).length);
});

test('local catalog search ignores spaces, hyphens and colons', async () => {
  const source: WebtoonDto[] = JSON.parse(await readFile(localCatalogFile, 'utf8'));
  const repository = await createLocalCatalogRepository();
  const sample = source.find((item) => /[\s\-:：]/.test(item.title) && normalizeText(item.title).length >= 6);
  assert.ok(sample, 'expected a titled work with spacing or punctuation');
  const compact = sample.title.replace(/[\s\-:：]/g, '');
  const fromCompact = await repository.list({ q: compact, limit: 20, offset: 0 });
  assert.ok(fromCompact.webtoons.some((item) => item.id === sample.id));
  if (/ /.test(sample.title)) {
    const partial = sample.title.replace(/\s+/g, '');
    const fromPartial = await repository.list({ q: partial.slice(0, Math.min(8, partial.length)), limit: 50, offset: 0 });
    assert.ok(fromPartial.webtoons.some((item) => item.id === sample.id));
  }
});

test('local HTTP API ranks JSON candidates on the backend and exposes no seed route', async () => {
  const repository = await createLocalCatalogRepository();
  const source: WebtoonDto[] = JSON.parse(await readFile(localCatalogFile, 'utf8'));
  const { webtoons: items } = await repository.list({ limit: source.length, offset: 0 });
  const selected = [items.find((item) => item.id === 'naver_641253')!, items.find((item) => item.id === 'kakao_3090')!];
  const app = createApp(repository, { rateLimits: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${url}/api/recommendations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webtoonIds: selected.map((item) => item.id), limit: 10 }),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.catalogCount, items.length);
    assert.equal(result.method, 'content-similarity-v1');
    assert.deepEqual(result.selected, selected);
    assert.deepEqual(result.recommendations, recommendSimilar(items, selected, 10));
    assert.ok(result.recommendations.every((entry: { webtoon: WebtoonDto }) => !selected.some((item) => item.id === entry.webtoon.id)));
    const detail = await fetch(`${url}/api/webtoons/${selected[0].id}`);
    assert.deepEqual((await detail.json()).webtoon, selected[0]);
    assert.equal((await fetch(`${url}/internal/seed-webtoons`, { method: 'POST' })).status, 404);
  } finally {
    await app.locals.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
