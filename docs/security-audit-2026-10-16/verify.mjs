// Run from project root:
// node --import ./Backend/node_modules/tsx/dist/loader.mjs docs/security-audit-2026-10-16/verify.mjs
// No external HTTP requests, real database writes, or production traffic.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from '../../Backend/node_modules/typescript/lib/typescript.js';
import { createApp } from '../../Backend/src/app.ts';
import { createLocalCatalogRepository } from '../../Backend/src/lib/localCatalog.ts';
import { recommendSimilar } from '../../Backend/src/lib/similarity.ts';

const results = [];
const record = (name, evidence) => { results.push({ name, evidence }); console.log(JSON.stringify(results.at(-1))); };
const root = new URL('../../', import.meta.url);
async function loadCrawler(relative, dependencies, context = {}) {
  const source = await readFile(new URL(`KOREA_WEBTOON_API/src/${relative}`, root), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require(name) { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; }, console: { log() {}, info() {}, error() {}, warn() {}, time() {}, timeEnd() {} }, setTimeout, Date, Promise, Number, Math, ...context }, { filename: relative });
  return exports;
}
function response() {
  return { statusCode: 200, headers: {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, sendStatus(n) { this.statusCode = n; return this; } };
}
// Invoke registered Express middleware and route handlers without opening sockets.
async function invoke(app, method, path, { body, origin, headers = {} } = {}) {
  const res = response();
  const req = { method, url: path, query: {}, params: {}, body, headers: { ...headers, ...(origin ? { origin } : {}) }, header(name) { return this.headers[name.toLowerCase()]; } };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.removeHeader = (k) => { delete res.headers[k.toLowerCase()]; };
  const cors = app._router.stack.find((layer) => layer.name === 'corsMiddleware');
  await new Promise((resolve, reject) => cors.handle(req, res, (err) => err ? reject(err) : resolve()));
  const route = app._router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method.toLowerCase()]);
  if (!route) { res.statusCode = 404; return res; }
  await route.route.stack[0].handle(req, res, () => {});
  return res;
}

const repository = await createLocalCatalogRepository();
const catalog = (await repository.list({ limit: 100_000, offset: 0 })).webtoons;
const app = createApp(repository);
const durations = [], loopDelays = [];
for (let i = 0; i < 3; i++) {
  const start = performance.now();
  const tick = new Promise((resolve) => setTimeout(() => resolve(performance.now() - start), 0));
  const count = recommendSimilar(catalog, [catalog[0]], 1).length;
  durations.push(+(performance.now() - start).toFixed(1));
  loopDelays.push(+(await tick).toFixed(1));
  assert.equal(count, 1);
}
record('BFF synchronous recommendation cost', { catalogCount: catalog.length, durationsMs: durations, zeroDelayTimerMs: loopDelays });
const externalOrigin = 'https://security-audit-unrelated.vercel.app';
const corsResult = await invoke(app, 'GET', '/health', { origin: externalOrigin });
assert.equal(corsResult.headers['access-control-allow-origin'], externalOrigin);
record('BFF unrelated Vercel origin accepted', { origin: externalOrigin, allowOrigin: corsResult.headers['access-control-allow-origin'] });
const noSeed = await invoke(app, 'POST', '/internal/seed-webtoons', { body: { webtoons: [{ id: 'audit-only' }] } });
assert.equal(noSeed.statusCode, 404);
const oldSecret = process.env.CRON_SECRET;
delete process.env.CRON_SECRET;
let saved;
try {
  const seedApp = createApp({ ...repository, async seed(items) { saved = items; } });
  const seeded = await invoke(seedApp, 'POST', '/internal/seed-webtoons', { body: { webtoons: [{ id: 'audit-only', url: 'https://example.invalid/phishing' }] } });
  assert.equal(seeded.statusCode, 200);
  assert.equal(saved.length, 1);
  record('Conditional seed route fails open', { productionRepositoryStatus: noSeed.statusCode, injectedSeedRepositoryStatus: seeded.statusCode, malformedRowPassedToSeed: true });
} finally { if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret; }

const directory = await mkdtemp(join(tmpdir(), 'webtoon-security-audit-'));
try {
  const file = join(directory, 'catalog.json');
  await writeFile(file, JSON.stringify([{ ...catalog[0], url: 'https://example.invalid/phishing', thumbnail: ['https://example.invalid/tracking'] }]));
  const injected = await createLocalCatalogRepository(pathToFileURL(file));
  assert.equal((await injected.find(catalog[0].id)).url, 'https://example.invalid/phishing');
  record('Conditional catalog URL poisoning accepted', { realCatalogModified: false, attackerHostAccepted: true });
} finally { await rm(directory, { recursive: true, force: true }); }

const entities = { DataInfo: class {}, NaverWebtoon: class {}, KakaoWebtoon: class {}, KakaoPageWebtoon: class {} };
let starts = 0, release;
const gate = new Promise((resolve) => { release = resolve; });
const dataInfo = { provider: 'NAVER', updateStartAt: new Date(), updateEndAt: new Date() };
const mockedDataSource = {
  getRepository() { return { async findOneBy() { return dataInfo; }, async save() {} }; },
  createQueryRunner() { return { async startTransaction() { starts++; }, manager: { async save() {} }, async commitTransaction() {}, async rollbackTransaction() {}, async release() {} }; },
};
const { createUpdateMethod } = await loadCrawler('routes/update/functions/createUpdateMethod.ts', { '@/database/datasource': { AppDataSource: mockedDataSource }, '@/database/entity': entities });
const update = createUpdateMethod({ provider: 'NAVER', async webtoonCrawler() { await gate; return []; } });
const skipped = response();
await update({ query: {} }, skipped);
assert.equal(skipped.body.skipped, true);
const forceResponses = [response(), response()];
await Promise.all(forceResponses.map((res) => update({ query: { force: 'true' }, headers: {} }, res)));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(starts, 2);
record('Crawler unauthenticated forced overlapping jobs', { withoutForceSkipped: skipped.body.skipped, forceRequests: 2, concurrentTransactions: starts, responseCodes: forceResponses.map((r) => r.statusCode) });
release();
await new Promise((resolve) => setTimeout(resolve, 0));

const rejected = new Promise((resolve) => process.once('unhandledRejection', resolve));
const brokenDataSource = { ...mockedDataSource, createQueryRunner() { return { async startTransaction() { throw new Error('audit transaction failure'); } }; } };
const brokenModule = await loadCrawler('routes/update/functions/createUpdateMethod.ts', { '@/database/datasource': { AppDataSource: brokenDataSource }, '@/database/entity': entities });
const brokenResponse = response();
await brokenModule.createUpdateMethod({ provider: 'NAVER', async webtoonCrawler() { return []; } })({ query: { force: 'true' } }, brokenResponse);
const uncaught = await rejected;
assert.equal(uncaught.message, 'audit transaction failure');
record('Crawler transaction start rejection escapes background task', { responseStatus: brokenResponse.statusCode, unhandledRejection: uncaught.message, verifierInterceptedRejection: true });

let enrichCalls = 0, persistCalls = 0;
const { getWebtoonById } = await loadCrawler('routes/webtoon-by-id.ts', {
  '@/database/entity': entities,
  '@/database/datasource': { AppDataSource: { getRepository() { return { async findOne() { return catalog[0]; } }; } } },
  '@/modules/enrich/enrichWebtoonMeta': { async enrichWebtoonMeta(row) { enrichCalls++; return row; }, async persistEnrichedMeta() { persistCalls++; } },
});
for (let i = 0; i < 2; i++) await getWebtoonById({ params: { id: catalog[0].id }, query: { persist: 'true' }, headers: {} }, response());
assert.equal(enrichCalls, 2);
assert.equal(persistCalls, 2);
record('Crawler unauthenticated GET runs enrichment and persistence', { requests: 2, enrichCalls, persistCalls, realDatabaseWrites: 0 });

let unblockTickets;
const tickets = new Promise((resolve) => { unblockTickets = resolve; });
const intervals = new Map();
let createdIntervals = 0;
const placements = Object.fromEntries(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'COMPLETE'].map((day) => [day, day]));
const { getKakaoWebtoonList } = await loadCrawler('modules/kakao/index.ts', {
  '@/database/entity': entities,
  './functions/kakaoApi': { KAKAO_PLACEMENT: placements, async getWebtoonListByPlacement(day) { return { data: day === 'MON' ? Array.from({ length: 14 }, (_, i) => ({ id: i + 1 })) : [] }; }, async getTicketInfo() { await tickets; return { data: { data: {} } }; } },
  './functions/normalizeWebtoon': { normalizeWebtoonList({ response }) { return Array.isArray(response) ? response : response.data; } },
}, { setInterval(callback) { const id = ++createdIntervals; intervals.set(id, callback); return id; }, clearInterval(id) { intervals.delete(id); } });
const kakaoJob = getKakaoWebtoonList();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(createdIntervals > 0);
unblockTickets();
await new Promise((resolve) => setTimeout(resolve, 0));
for (const callback of intervals.values()) callback();
await kakaoJob;
assert.equal(intervals.size, createdIntervals);
record('Crawler Kakao polling timers retained after successful job', { syntheticWorks: 14, createdIntervals, activeIntervalsAfterCompletion: intervals.size, realIntervalsCreated: 0 });

let takeValue, selfCalls = 0;
const builder = { andWhere() { return this; }, take(n) { takeValue = n; return this; }, skip() { return this; }, orderBy() { return this; }, async getManyAndCount() { return [[], 123]; } };
const { getWebtoons } = await loadCrawler('routes/webtoons.ts', {
  '@/constants': { DOMAIN: 'http://local.invalid', ROUTES: { HEALTH_CHECK: '/health-check' } },
  axios: { async get() { selfCalls++; } },
  '@/database/entity': entities,
  '@/database/datasource': { AppDataSource: { getRepository() { return { createQueryBuilder() { return builder; } }; } } },
});
for (const perPage of ['-1', '0', '100']) {
  const res = response();
  await getWebtoons({ query: { perPage } }, res);
  assert.equal(res.statusCode, 200);
  record('Crawler pagination input accepted', { perPage, ormTake: takeValue, status: res.statusCode });
}
const invalid = response();
const previous = selfCalls;
await getWebtoons({ query: { sort: 'invalid' } }, invalid);
assert.equal(invalid.statusCode, 400);
assert.equal(selfCalls, previous + 1);
record('Crawler invalid list request triggers health/update chain', { status: invalid.statusCode, healthCallsBeforeValidation: selfCalls - previous });

let batch;
const { putEnrichNaver } = await loadCrawler('routes/enrich/naver.ts', { '@/modules/naver/enrichNaverMetadataBatch': { async enrichNaverMetadataBatch(options) { batch = options; return { mocked: true }; } } });
await putEnrichNaver({ query: { limit: '-1', delayMs: '0' }, headers: {} }, response());
assert.equal(batch.limit, -1);
record('Crawler batch negative limit and no delay accepted', batch);
const output = new URL('results.json', import.meta.url);
await writeFile(output, JSON.stringify({ date: '2026-10-16', scope: 'source handlers; mocked crawler I/O; no production requests', results }, null, 2) + '\n');
