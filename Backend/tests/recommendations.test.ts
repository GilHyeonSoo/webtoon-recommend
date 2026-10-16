import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp, type CatalogRepository } from '../src/app.js';
import { recommendSimilar } from '../src/lib/similarity.js';
import type { WebtoonDto } from '../src/lib/mapWebtoon.js';

const item = (id: string, extra: Partial<WebtoonDto> = {}): WebtoonDto => ({
  id, title: id, provider: 'NAVER', updateDays: [], url: 'https://example.com', thumbnail: [],
  isEnd: false, isFree: true, isUpdated: false, ageGrade: 0, freeWaitHour: null,
  authors: [], synopsis: null, genres: [], tags: [], averageRating: null, primaryGenre: 'unknown',
  totalEpisodeCount: null, isOnHiatus: null, popularityCount: null, ...extra,
});

test('combines both tastes equally and excludes all selected titles', () => {
  const a = item('a', { genres: ['action'], tags: ['성장'] });
  const b = item('b', { genres: ['pure'], tags: ['설레는'] });
  const both = item('both', { genres: ['action', 'romance'], tags: ['성장', '#설레는'] });
  const results = recommendSimilar([a, b, both, item('one', { genres: ['action'] }), item('unknown')], [a, b]);
  assert.equal(results[0].webtoon.id, 'both');
  assert.ok(results.every((r) => !['a', 'b'].includes(r.webtoon.id)));
  assert.equal(results.at(-1)?.similarity, 0);
  assert.ok(results.at(-1)?.reasons[0].includes('정보가 부족'));
  assert.ok(results[0].reasons.some((r) => r.includes('장르')));
});

test('unknown metadata never produces artificial similarity', () => {
  const seed = item('seed');
  const results = recommendSimilar([seed, item('known', { genres: ['action'] }), item('unknown')], [seed]);
  assert.ok(results.every((r) => r.similarity === 0));
});

test('Korean synopsis stems and tag normalization give real evidence', () => {
  const seed = item('seed', { synopsis: '주인공은 복수를 결심하고 성장한다', tags: ['#학원/액션'] });
  const good = item('good', { synopsis: '주인공의 복수와 성장', tags: ['학원액션'] });
  const results = recommendSimilar([seed, good, item('other', { synopsis: '달콤한 사랑 이야기' })], [seed]);
  assert.equal(results[0].webtoon.id, 'good');
  assert.ok(results[0].reasons.some((r) => r.includes('줄거리')));
  assert.ok(results[0].reasons.some((r) => r.includes('학원액션')));
});

test('explicit genre labels in platform tags match structured genres', () => {
  const seed = item('seed', { tags: ['#학원/판타지', '#성장물'] });
  const related = item('related', { genres: ['fantasy'] });
  const results = recommendSimilar([seed, related, item('other', { genres: ['pure'] })], [seed]);
  assert.equal(results[0].webtoon.id, 'related');
  assert.ok(results[0].similarity > 0);
  assert.ok(results[0].reasons.some((reason) => reason.includes('판타지')));
});

test('preference filters restrict candidates by platform and completion', () => {
  const seed = item('seed', { genres: ['action'], provider: 'NAVER' });
  const naverOngoing = item('naver-ongoing', { genres: ['action'], provider: 'NAVER', isEnd: false });
  const kakaoComplete = item('kakao-complete', { genres: ['action'], provider: 'KAKAO', isEnd: true });
  const neutral = recommendSimilar([seed, naverOngoing, kakaoComplete], [seed], 10);
  assert.equal(neutral[0].webtoon.id, kakaoComplete.id);
  const biased = recommendSimilar([seed, naverOngoing, kakaoComplete], [seed], 10, { platform: 'naver', completion: 'ongoing' });
  assert.equal(biased[0].webtoon.id, 'naver-ongoing');
  assert.ok(biased[0].reasons.some((reason) => reason.includes('네이버')));
  const naverOnly = recommendSimilar([seed, naverOngoing, kakaoComplete], [seed], 10, { platform: 'naver', completion: 'any' });
  assert.ok(naverOnly.every((entry) => entry.webtoon.provider === 'NAVER'));
});

test('filters include hiatus with completed works, exclude it from ongoing, and preserve similarity', async () => {
  const seed = item('seed', { genres: ['action'] });
  const catalog = [seed,
    item('naver-live', { genres: ['action'], provider: 'NAVER' }),
    item('naver-paused', { genres: ['action'], provider: 'NAVER', isOnHiatus: true }),
    item('naver-end', { genres: ['action'], provider: 'NAVER', isEnd: true }),
    item('kakao-live', { genres: ['action'], provider: 'KAKAO' }),
    item('page-paused', { genres: ['action'], provider: 'KAKAO_PAGE', isOnHiatus: true }),
    item('page-end', { genres: ['action'], provider: 'KAKAO_PAGE', isEnd: true }),
  ];
  const scores = new Map(recommendSimilar(catalog, [seed], 20).map((entry) => [entry.webtoon.id, entry.similarity]));
  await withApi(repository(catalog), async (url) => {
    for (const platform of ['any', 'naver', 'kakao'] as const) {
      for (const completion of ['any', 'ongoing', 'complete'] as const) {
        const response = await post(url, { webtoonIds: ['seed'], preferences: { platform, completion } });
        const result = await response.json();
        assert.equal(response.status, 200);
        const expected = catalog.filter((candidate) => candidate.id !== seed.id
          && (platform === 'any' || (platform === 'naver' ? candidate.provider === 'NAVER' : candidate.provider !== 'NAVER'))
          && (completion === 'any' || (completion === 'complete' ? candidate.isEnd || candidate.isOnHiatus === true : !candidate.isEnd && candidate.isOnHiatus !== true)));
        assert.deepEqual(new Set(result.recommendations.map((entry: { webtoon: WebtoonDto }) => entry.webtoon.id)), new Set(expected.map((candidate) => candidate.id)));
        for (const entry of result.recommendations) assert.equal(entry.similarity, scores.get(entry.webtoon.id));
      }
    }
    const limited = await post(url, { webtoonIds: ['seed'], preferences: { platform: 'kakao', completion: 'complete' }, limit: 1 });
    const top = await limited.json();
    assert.equal(top.recommendations.length, 1);
    assert.ok(['page-paused', 'page-end'].includes(top.recommendations[0].webtoon.id));
  });
});

test('scores are bounded, deterministic and respect requested count', () => {
  const seed = item('seed', { genres: ['action'] });
  const catalog = [seed, ...Array.from({ length: 30 }, (_, i) => item(String(i), { genres: ['action'] }))];
  const first = recommendSimilar(catalog, [seed], 10);
  assert.equal(first.length, 10);
  assert.ok(first.every((r) => Number.isFinite(r.similarity) && r.similarity >= 0 && r.similarity <= 1));
  assert.deepEqual(first, recommendSimilar(catalog, [seed], 10));
});

function repository(catalog: WebtoonDto[]): CatalogRepository {
  return {
    async list({ q, provider, limit, offset }) {
      const filtered = catalog.filter((v) => (!q || v.title.includes(q)) && (!provider || v.provider === provider));
      return { webtoons: filtered.slice(offset, offset + limit), total: filtered.length };
    },
    async find(id) { return catalog.find((v) => v.id === id) ?? null; },
  };
}
async function withApi(store: CatalogRepository, run: (url: string) => Promise<void>) {
  const app = createApp(store, { rateLimits: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); }
}
const post = (url: string, body: unknown) => fetch(`${url}/api/recommendations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('HTTP search filters titles/providers and rejects malformed limits', async () => {
  await withApi(repository([item('a', { title: '성장하는 이야기' }), item('b', { title: '사랑 이야기', provider: 'KAKAO' })]), async (url) => {
    const response = await fetch(`${url}/api/webtoons?q=${encodeURIComponent('이야기')}&provider=NAVER&limit=12`);
    const result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.total, 1); assert.equal(result.webtoons[0].id, 'a');
    for (const query of ['limit=-1', 'limit=NaN', 'limit=1.5', 'provider=other', 'q[]=a']) assert.equal((await fetch(`${url}/api/webtoons?${query}`)).status, 400);
  });
});

test('HTTP enforces 1–3 distinct existing selected titles', async () => {
  await withApi(repository([item('a'), item('b')]), async (url) => {
    for (const webtoonIds of [[], ['a', 'a'], ['a', 'b', 'c', 'd'], [42], ['']]) assert.equal((await post(url, { webtoonIds })).status, 400);
    assert.equal((await post(url, { webtoonIds: ['missing'] })).status, 404);
    const response = await post(url, { webtoonIds: ['a'] });
    const result = await response.json();
    assert.equal(response.status, 200); assert.equal(result.selected[0].id, 'a'); assert.equal(result.recommendations[0].webtoon.id, 'b');
    assert.equal((await post(url, { webtoonIds: ['a'], preferences: { platform: 'invalid' } })).status, 400);
    const withPrefs = await post(url, { webtoonIds: ['a'], preferences: { platform: 'naver', completion: 'ongoing' } });
    assert.equal(withPrefs.status, 200);
    assert.equal((await withPrefs.json()).method, 'content-similarity-v1-preferences');
  });
});

test('recommendations include titles beyond the first database page', async () => {
  const catalog = Array.from({ length: 1005 }, (_, i) => item(`item-${i}`, { genres: [i === 1004 || i === 0 ? 'action' : 'daily'] }));
  // A repository may impose a smaller page limit than requested.
  const base = repository(catalog);
  const store = { ...base, list: (options: Parameters<CatalogRepository['list']>[0]) => base.list({ ...options, limit: Math.min(options.limit, 100) }) };
  await withApi(store, async (url) => {
    const response = await post(url, { webtoonIds: ['item-0'] });
    const result = await response.json();
    assert.equal(result.catalogCount, 1005); assert.equal(result.recommendations[0].webtoon.id, 'item-1004');
  });
});

test('database failure returns a recoverable error and does not poison cache', async () => {
  let fail = true;
  const base = repository([item('a'), item('b')]);
  await withApi({ ...base, async list(options) { if (fail) { fail = false; throw new Error('private database detail'); } return base.list(options); } }, async (url) => {
    const bad = await post(url, { webtoonIds: ['a'] });
    assert.equal(bad.status, 500); assert.ok(!(await bad.text()).includes('private'));
    assert.equal((await post(url, { webtoonIds: ['a'] })).status, 200);
  });
});

test('re-search excludes the current batch while preserving seeds, filters and scores', async () => {
  const seed = item('seed', { genres: ['action'] });
  const candidates = Array.from({ length: 23 }, (_, index) => item(`candidate-${index}`, { genres: ['action'], provider: 'KAKAO_PAGE', isEnd: true }));
  const catalog = [seed, ...candidates, item('other-platform', { genres: ['action'], isEnd: true }), item('other-status', { genres: ['action'], provider: 'KAKAO' })];
  const preferences = { platform: 'kakao', completion: 'complete' };
  await withApi(repository(catalog), async (url) => {
    const first = await (await post(url, { webtoonIds: ['seed'], preferences })).json();
    const excludeIds = first.recommendations.map((entry: { webtoon: WebtoonDto }) => entry.webtoon.id);
    const response = await post(url, { webtoonIds: ['seed'], preferences, excludeIds });
    const next = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(next.selected, first.selected);
    assert.equal(next.catalogCount, catalog.length);
    assert.equal(next.recommendations.length, 10);
    const scores = new Map(recommendSimilar(catalog, [seed], 30).map((entry) => [entry.webtoon.id, entry.similarity]));
    for (const entry of next.recommendations) {
      assert.ok(!excludeIds.includes(entry.webtoon.id));
      assert.equal(entry.webtoon.provider, 'KAKAO_PAGE');
      assert.equal(entry.webtoon.isEnd, true);
      assert.equal(entry.similarity, scores.get(entry.webtoon.id));
    }
    const partial = await (await post(url, { webtoonIds: ['seed'], preferences, excludeIds: candidates.slice(0, 20).map((entry) => entry.id) })).json();
    assert.equal(partial.recommendations.length, 3);
    const small = repository([seed, ...candidates.slice(0, 3)]);
    await withApi(small, async (smallUrl) => {
      const empty = await (await post(smallUrl, { webtoonIds: ['seed'], preferences, excludeIds: candidates.slice(0, 3).map((entry) => entry.id) })).json();
      assert.deepEqual(empty.recommendations, []);
    });
  });
});

test('HTTP validates re-search exclusion IDs and accepts an empty list', async () => {
  await withApi(repository([item('seed'), item('candidate')]), async (url) => {
    for (const excludeIds of [null, 'candidate', [42], [''], ['candidate', 'candidate'], Array.from({ length: 50_001 }, (_, index) => String(index)), ['x'.repeat(201)]]) {
      assert.equal((await post(url, { webtoonIds: ['seed'], excludeIds })).status, 400);
    }
    assert.equal((await post(url, { webtoonIds: ['seed'], excludeIds: [] })).status, 200);
  });
});

test('cumulative history survives repeated searches and filter changes until all candidates are exhausted', async () => {
  const seed = item('seed', { genres: ['action'] });
  const candidates = Array.from({ length: 75 }, (_, index) => item(`candidate-${String(index).padStart(2, '0')}`, {
    genres: ['action'], provider: index % 3 === 0 ? 'NAVER' : index % 3 === 1 ? 'KAKAO' : 'KAKAO_PAGE', isEnd: index % 2 === 0,
  }));
  await withApi(repository([seed, ...candidates]), async (url) => {
    const seen = new Set<string>();
    for (const preferences of [{ platform: 'any', completion: 'any' }, { platform: 'any', completion: 'any' }, { platform: 'naver', completion: 'any' }, { platform: 'kakao', completion: 'complete' }, { platform: 'any', completion: 'any' }]) {
      const response = await post(url, { webtoonIds: ['seed'], preferences, excludeIds: [...seen] });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.recommendations.length, 10);
      for (const entry of result.recommendations) {
        assert.ok(!seen.has(entry.webtoon.id));
        seen.add(entry.webtoon.id);
        if (preferences.platform === 'naver') assert.equal(entry.webtoon.provider, 'NAVER');
        if (preferences.platform === 'kakao') assert.notEqual(entry.webtoon.provider, 'NAVER');
        if (preferences.completion === 'complete') assert.equal(entry.webtoon.isEnd, true);
      }
    }
    assert.equal(seen.size, 50);
    while (seen.size < candidates.length) {
      const response = await post(url, { webtoonIds: ['seed'], excludeIds: [...seen] });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.recommendations.length, Math.min(10, candidates.length - seen.size));
      for (const entry of result.recommendations) { assert.ok(!seen.has(entry.webtoon.id)); seen.add(entry.webtoon.id); }
    }
    const exhausted = await post(url, { webtoonIds: ['seed'], excludeIds: [...seen] });
    assert.equal(exhausted.status, 200);
    assert.deepEqual((await exhausted.json()).recommendations, []);
    assert.equal(seen.size, candidates.length);
  });
});
