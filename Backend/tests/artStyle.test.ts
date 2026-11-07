import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { artScore, loadArtStyle, matchArt, parseArtStyle, type ArtStyleIndex } from '../src/lib/artStyle.js';
import { localCatalogFile } from '../src/lib/localCatalog.js';
import type { WebtoonDto } from '../src/lib/mapWebtoon.js';
import { recommendSimilar } from '../src/lib/similarity.js';

const item = (id: string, extra: Partial<WebtoonDto> = {}): WebtoonDto => ({
  id, title: id, provider: 'NAVER', updateDays: [], url: 'https://example.com', thumbnail: [],
  isEnd: false, isFree: true, isUpdated: false, ageGrade: 0, freeWaitHour: null,
  authors: [], synopsis: null, genres: [], tags: [], averageRating: null, primaryGenre: 'unknown',
  totalEpisodeCount: null, isOnHiatus: null, popularityCount: null, ...extra,
});

const exported = (items: Record<string, number[]>, calibration = { baseline: 0, similarThreshold: 0.9 }) =>
  ({ schemaVersion: 1, dimensions: Object.values(items)[0].length, calibration,
    items: Object.fromEntries(Object.entries(items).map(([id, v]) => [id, { v, cluster: -1 }])) });

const angle = (degrees: number) => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];

test('art-style parser normalises vectors and rejects malformed exports', () => {
  const art = parseArtStyle(exported({ a: [3, 4] }));
  assert.ok(Math.abs(art.vectors.get('a')![0] - 0.6) < 1e-6);
  assert.throws(() => parseArtStyle(exported({ a: [1, 0], b: [1] })), /vector length/);
  assert.throws(() => parseArtStyle(exported({ a: [1, Number.NaN] })), /vector value/);
  assert.throws(() => parseArtStyle(exported({ a: [0, 0] })), /zero vector/);
  assert.throws(() => parseArtStyle(exported({ a: [1, 0] }, { baseline: 0.9, similarThreshold: 0.5 })), /calibration/);
  assert.throws(() => parseArtStyle({ ...exported({ a: [1, 0] }), schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => parseArtStyle([]), /not an object/);
});

test('art score is calibrated to [0, 1] and averages each selected work equally', () => {
  const art = parseArtStyle(exported({ a: angle(0), b: angle(90), c: angle(0) }, { baseline: 0.5, similarThreshold: 0.9 }));
  assert.equal(artScore(art, 0.5), 0);
  assert.equal(artScore(art, 0.2), 0);
  assert.equal(artScore(art, 1), 1);
  const [a, b] = [art.vectors.get('a')!, art.vectors.get('b')!];
  // c matches a exactly and b not at all: mean of 1 and 0, and still labelled similar to one pick.
  assert.deepEqual(matchArt(art, [a, b], 'c'), { score: 0.5, similar: true });
  assert.equal(matchArt(art, [a], 'missing'), undefined);
  assert.equal(matchArt(art, [], 'c'), undefined);
});

test('art style breaks ties between text-identical candidates and adds a reason', () => {
  const seed = item('seed', { genres: ['action'] });
  const sameStyle = item('same-style', { genres: ['action'] });
  const otherStyle = item('other-style', { genres: ['action'] });
  const catalog = [seed, otherStyle, sameStyle];
  const art = parseArtStyle(exported({ seed: angle(0), 'same-style': angle(5), 'other-style': angle(80) }, { baseline: 0.2, similarThreshold: 0.95 }));

  const textOnly = recommendSimilar(catalog, [seed]);
  assert.equal(textOnly[0].similarity, textOnly[1].similarity);

  const withArt = recommendSimilar(catalog, [seed], 10, undefined, [], art);
  assert.equal(withArt[0].webtoon.id, 'same-style');
  assert.ok(withArt[0].similarity > withArt[1].similarity);
  assert.ok(withArt[0].reasons.includes('그림체가 비슷해요'));
  assert.ok(!withArt[1].reasons.includes('그림체가 비슷해요'));
});

test('works without art keep their text-only score; art is capped at a fixed 20% share', () => {
  const seed = item('seed', { genres: ['action'], tags: ['성장'] });
  const noArt = item('no-art', { genres: ['action'] });
  const textMatch = item('text-match', { genres: ['action'], tags: ['성장'] });
  const unknownText = item('unknown-text');
  const catalog = [seed, noArt, textMatch, unknownText];
  const art: ArtStyleIndex = parseArtStyle(exported({ seed: angle(0), 'text-match': angle(90), 'unknown-text': angle(0) }));
  const textOnly = new Map(recommendSimilar(catalog, [seed]).map((r) => [r.webtoon.id, r.similarity]));
  const withArt = new Map(recommendSimilar(catalog, [seed], 10, undefined, [], art).map((r) => [r.webtoon.id, r.similarity]));
  assert.equal(withArt.get('no-art'), textOnly.get('no-art'));
  // Identical art but no shared text: only the 20% art share, not a renormalised majority.
  assert.equal(textOnly.get('unknown-text'), 0);
  assert.ok(Math.abs(withArt.get('unknown-text')! - 0.2) < 1e-9);
  // Unrelated art (score 0) costs a text match at most the 20% share.
  assert.ok(Math.abs(withArt.get('text-match')! - 0.8 * textOnly.get('text-match')!) < 1e-9);
  assert.ok(withArt.get('text-match')! > withArt.get('unknown-text')!);
});

test('bundled art-style export loads and covers every bundled catalog work', async () => {
  const art = loadArtStyle();
  assert.ok(art, 'Backend/data/art-style.json should be present');
  const catalog = JSON.parse(await readFile(localCatalogFile, 'utf8')) as { id: string }[];
  const missing = catalog.filter((entry) => !art.vectors.has(entry.id)).map((entry) => entry.id);
  assert.deepEqual(missing.slice(0, 5), []);
  assert.ok(art.baseline < art.similarThreshold);
});

test('missing art-style file falls back to text-only recommendations', () => {
  assert.equal(loadArtStyle(new URL('./does-not-exist.json', import.meta.url)), undefined);
});
