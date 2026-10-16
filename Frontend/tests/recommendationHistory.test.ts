import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeWebtoons } from '../src/api/webtoons.ts'
import type { Recommendation, RecommendationPreferences, Webtoon } from '../src/api/webtoons.ts'
import { RecommendationHistory } from '../src/lib/recommendationHistory.ts'

const entry = (id: string, index = 0): Recommendation => ({
  webtoon: { id, title: id, provider: index % 2 ? 'KAKAO_PAGE' : 'NAVER', url: index % 2 ? `https://page.kakao.com/content/${index + 1}` : `https://comic.naver.com/webtoon/list?titleId=${index + 1}`, thumbnail: [], authors: [], genres: [], tags: [], updateDays: [], ageGrade: 0, isEnd: index % 3 === 0, isFree: true, isUpdated: false } as Webtoon,
  similarity: 0.5, reasons: [],
})

test('re-search accumulates history but changing or clearing filters starts fresh', async () => {
  const original = globalThis.fetch
  const catalog = Array.from({ length: 70 }, (_, index) => entry(String(index), index))
  const initial = catalog.slice(0, 10)
  let history = new RecommendationHistory(initial)
  let displayed = new Set(initial.map((item) => item.webtoon.id))
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      const excludeIds = body.excludeIds ?? []
      assert.deepEqual(new Set(excludeIds), displayed)
      const recommendations = catalog.filter((item) => !excludeIds.includes(item.webtoon.id)
        && (body.preferences.platform === 'any' || (body.preferences.platform === 'naver' ? item.webtoon.provider === 'NAVER' : item.webtoon.provider !== 'NAVER'))).slice(0, 10)
      return new Response(JSON.stringify({ selected: [], recommendations, catalogCount: catalog.length, method: 'content-similarity-v1-preferences' }))
    }
    async function search(filter: RecommendationPreferences) {
      const result = await analyzeWebtoons(['seed'], new AbortController().signal, filter, history.snapshot())
      const fresh = history.accept(result.recommendations)
      assert.equal(fresh.length, 10)
      for (const item of fresh) { assert.ok(!displayed.has(item.webtoon.id)); displayed.add(item.webtoon.id) }
      return fresh
    }
    await search({ platform: 'any' })
    await search({ platform: 'any' })
    assert.equal(history.snapshot().length, 30)
    for (const platform of ['naver', 'kakao', 'any'] as const) {
      history = new RecommendationHistory([])
      displayed = new Set()
      const first = await search({ platform })
      assert.ok(first.some((item) => initial.some((previous) => previous.webtoon.id === item.webtoon.id)))
      await search({ platform })
      assert.equal(history.snapshot().length, 20)
      assert.deepEqual(new Set(history.snapshot()), displayed)
    }
  } finally { globalThis.fetch = original }
})

test('duplicate responses are removed and a fresh filter history accepts earlier works', () => {
  const history = new RecommendationHistory([entry('initial')])
  assert.deepEqual(history.accept([entry('initial'), entry('next'), entry('next')]).map((item) => item.webtoon.id), ['next'])
  assert.deepEqual(history.accept([entry('initial'), entry('next')]), [])
  const snapshot = history.snapshot()
  snapshot.length = 0
  assert.equal(history.snapshot().length, 2)
  const newSession = new RecommendationHistory([entry('new-initial')])
  assert.deepEqual(newSession.accept([entry('initial')]).map((item) => item.webtoon.id), ['initial'])
})
