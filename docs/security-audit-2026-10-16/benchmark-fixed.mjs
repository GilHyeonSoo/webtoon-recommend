// Build Backend first. Optional argv[2]: original similarity.ts for exact before/after parity.
// This opens a loopback-only server; never calls production or external platform APIs.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createApp } from '../../Backend/dist/app.js';
import { createLocalCatalogRepository } from '../../Backend/dist/lib/localCatalog.js';
import { recommendSimilar } from '../../Backend/dist/lib/similarity.js';

const reference = process.argv[2]
  ? (await import(pathToFileURL(process.argv[2]).href)).recommendSimilar
  : recommendSimilar;
const repository = await createLocalCatalogRepository();
const items = (await repository.list({ limit: 50_000, offset: 0 })).webtoons;
const app = createApp(repository, { rateLimits: false }); // Quotas tested separately; measure computational capacity.
const start = performance.now();
await app.locals.prepare();
const startupMs = performance.now() - start;
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const timings = [], health = [], baseline = [];
const p95 = (values) => +[...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1].toFixed(2);
async function post(body) {
  const started = performance.now();
  const response = await fetch(base + '/api/recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  const data = await response.json(); timings.push(performance.now() - started); return data;
}
try {
  const cases = [
    { webtoonIds: [items[0].id], limit: 10 },
    { webtoonIds: [items[1].id, items[500].id, items[3000].id], limit: 10, preferences: { platform: 'kakao', completion: 'complete' } },
    { webtoonIds: [items[20].id], limit: 10, excludeIds: items.slice(0, 100).map((item) => item.id) },
  ];
  for (const body of cases) {
    const selected = body.webtoonIds.map((id) => items.find((item) => item.id === id));
    const began = performance.now();
    const expected = reference(items, selected, body.limit, body.preferences, body.excludeIds);
    baseline.push(performance.now() - began);
    const result = await post(body);
    assert.deepEqual(result.recommendations, expected);
  }
  for (let round = 0; round < 3; round++) {
    const work = Array.from({ length: 5 }, () => post(cases[0]));
    for (let i = 0; i < 5; i++) {
      const began = performance.now();
      assert.equal((await fetch(base + '/health')).status, 200);
      health.push(performance.now() - began);
    }
    await Promise.all(work);
  }
  const output = { catalogCount: items.length, node: process.version, startupMs: +startupMs.toFixed(2),
    reference: process.argv[2] ? 'original source snapshot' : 'uncached reference',
    exactParityCases: cases.length, baselineMs: baseline.map((v) => +v.toFixed(2)),
    recommendationSamples: timings.length, recommendationP95Ms: p95(timings), healthP95Ms: p95(health),
    quotaTesting: 'separate HTTP security tests', productionRequests: 0 };
  console.log(JSON.stringify(output, null, 2));
  await writeFile(new URL('remediation-benchmark.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
} finally { await app.locals.close(); await new Promise((resolve) => server.close(resolve)); }
