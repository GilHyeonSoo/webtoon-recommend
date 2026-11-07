import assert from 'node:assert/strict'
import test from 'node:test'
import { baseKeywords, createKeywords, keywordGroups } from '../scripts/seo-keywords.mjs'
import { artExamples, parsePublicArt, publicSnapshotMatches, rankArtRelated } from '../scripts/art-style-related.mjs'

test('SEO keywords include over 100 distinct relevant phrases plus spelling variants', () => {
  assert(baseKeywords.length >= 100)
  assert(new Set(baseKeywords.map((term: string) => term.replace(/\s/g, ''))).size >= 100)
  assert.equal(new Set(baseKeywords).size, baseKeywords.length)
  assert(keywordGroups.spellings.includes('웹툰 추전'))
  assert(keywordGroups.english.includes('similar webtoons'))
  assert(baseKeywords.includes('그림체가 비슷한 웹툰'))
})

test('page-specific keywords lead the list and duplicates and separators are removed', () => {
  const terms = createKeywords(['약한영웅 비슷한 웹툰', '약한영웅 비슷한 웹툰', '  작품, 비교; <태그>  ', ''])
  assert.equal(terms[0], '약한영웅 비슷한 웹툰')
  assert.equal(terms.filter((term: string) => term === terms[0]).length, 1)
  assert(terms.includes('작품 비교 태그'))
  assert(terms.length > 100)
  assert(!terms.some((term: string) => /[,;<>]/.test(term)))
})

const work = (id: string, genre = 'fantasy') => ({ webtoon: { id, title: id }, editorial: { genre } })
const snapshot = (vectors: Record<string, number[]>) => ({ schemaVersion: 1, dimensions: 2,
  calibration: { baseline: 0, similarThreshold: 0.9 },
  items: Object.fromEntries(Object.entries(vectors).map(([id, v]) => [id, { v }])) })

test('public art comparison ranks actual visual vectors across genres and excludes the seed', () => {
  const seed = work('seed'), otherGenre = work('visual-match', 'action'), unrelated = work('same-genre')
  const works = [seed, unrelated, otherGenre]
  const art = parsePublicArt(snapshot({ seed: [3, 4], 'visual-match': [6, 8], 'same-genre': [1, 0] }), works.map((w) => w.webtoon.id))
  const matches = rankArtRelated(seed, works, art)
  assert.deepEqual(matches.map((match: { work: ReturnType<typeof work> }) => match.work.webtoon.id), ['visual-match', 'same-genre'])
  assert(matches[0].similar)
  assert(!matches[1].similar)
  assert(Math.abs(matches[0].cosine - 1) < 1e-6)
  assert(matches[0].reasons[0].includes('시각적 특징이 유사'))
  assert(matches[1].reasons[0].includes('비교 후보'))
})

test('public art snapshot rejects missing, malformed and zero vectors and invalid calibration', () => {
  assert.throws(() => parsePublicArt(snapshot({ seed: [1, 0] }), ['missing']), /vector/)
  assert.throws(() => parsePublicArt(snapshot({ seed: [1] }), ['seed']), /vector/)
  assert.throws(() => parsePublicArt(snapshot({ seed: [0, 0] }), ['seed']), /zero vector/)
  assert.throws(() => parsePublicArt(snapshot({ seed: [Infinity, 0] }), ['seed']), /vector/)
  assert.throws(() => parsePublicArt(snapshot({ seed: [Number.MAX_VALUE, Number.MAX_VALUE] }), ['seed']), /norm/)
  assert.throws(() => parsePublicArt({ ...snapshot({ seed: [1, 0] }), calibration: { baseline: 0.9, similarThreshold: 0.5 } }, ['seed']), /calibration/)
})

test('art guide examples use unique real pairs above the similarity threshold', () => {
  const works = [work('a'), work('b'), work('c')]
  const art = parsePublicArt(snapshot({ a: [1, 0], b: [1, 0], c: [0, 1] }), ['a', 'b', 'c'])
  const examples = artExamples(works, art)
  assert.equal(examples.length, 1)
  assert.equal(new Set([examples[0].work.webtoon.id, examples[0].other.webtoon.id]).size, 2)
  assert(examples[0].cosine >= art.similarThreshold)
})

test('snapshot freshness treats signed zero equally and rejects changed vectors or calibration', () => {
  const original = snapshot({ a: [1, -0] })
  const copy = JSON.parse(JSON.stringify(original))
  assert(publicSnapshotMatches(original, copy, ['a']))
  copy.items.a.v[1] = 0.01
  assert(!publicSnapshotMatches(original, copy, ['a']))
  copy.items.a.v[1] = 0
  copy.calibration.baseline = 0.2
  assert(!publicSnapshotMatches(original, copy, ['a']))
})
